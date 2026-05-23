/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed under the License is            *
 * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                   *
 * implied.  See the License for the specific language governing permissions and limitations under the License.       *
 *                                                                                                                    *
 **********************************************************************************************************************/

#include "../include/omega_edit/transform.h"
#include "../include/omega_edit/edit.h"
#include "../include/omega_edit/segment.h"
#include "../include/omega_edit/session.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#ifdef min
#undef min
#endif
#ifdef max
#undef max
#endif
#else
#include <dlfcn.h>
#endif

namespace {
    struct dynamic_library_t {
#ifdef _WIN32
        HMODULE handle{};
#else
        void *handle{};
#endif

        dynamic_library_t() = default;
        explicit dynamic_library_t(const char *path) {
#ifdef _WIN32
            handle = LoadLibraryA(path);
#else
            handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
#endif
        }

        dynamic_library_t(const dynamic_library_t &) = delete;
        auto operator=(const dynamic_library_t &) -> dynamic_library_t & = delete;

        dynamic_library_t(dynamic_library_t &&other) noexcept : handle(other.handle) { other.handle = nullptr; }

        auto operator=(dynamic_library_t &&other) noexcept -> dynamic_library_t & {
            if (this != &other) {
                close();
                handle = other.handle;
                other.handle = nullptr;
            }
            return *this;
        }

        ~dynamic_library_t() { close(); }

        auto ok() const -> bool { return handle != nullptr; }

        auto symbol(const char *name) const -> void * {
            if (!handle) { return nullptr; }
#ifdef _WIN32
            return reinterpret_cast<void *>(GetProcAddress(handle, name));
#else
            return dlsym(handle, name);
#endif
        }

    private:
        void close() {
            if (!handle) { return; }
#ifdef _WIN32
            FreeLibrary(handle);
#else
            dlclose(handle);
#endif
            handle = nullptr;
        }
    };

    struct loaded_plugin_t {
        dynamic_library_t library;
        omega_transform_plugin_info_t info{};
        omega_transform_plugin_apply_fn apply{};
        std::string path;
    };

    auto plugin_operation_is_valid_(omega_transform_plugin_operation_t operation) -> bool {
        return operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE ||
               operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT ||
               operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT;
    }

    auto plugin_buffer_is_valid_(const omega_byte_t *bytes, int64_t length) -> bool {
        return length >= 0 && (length == 0 || bytes != nullptr);
    }

    auto plugin_extension_is_supported_(const std::filesystem::path &path) -> bool {
        const auto extension = path.extension().string();
#ifdef _WIN32
        return extension == ".dll";
#elif defined(__APPLE__)
        return extension == ".dylib" || extension == ".so";
#else
        return extension == ".so";
#endif
    }

    void *plugin_malloc_(size_t size, void *) { return std::malloc(size == 0 ? 1 : size); }

    // Transfers plugin-owned response buffers to the caller. If no caller response is supplied,
    // the temporary response is cleared here so plugins never leak allocator-owned memory.
    void move_plugin_response_(omega_transform_plugin_response_t *response_ptr,
                               omega_transform_plugin_response_t &plugin_response) {
        if (!response_ptr) {
            omega_transform_plugin_response_clear(&plugin_response);
            return;
        }
        omega_transform_plugin_response_clear(response_ptr);
        *response_ptr = plugin_response;
        plugin_response = {};
    }

    auto read_session_range_(const omega_session_t *session_ptr, int64_t offset, int64_t length,
                             std::vector<omega_byte_t> &bytes) -> int {
        if (!session_ptr || offset < 0 || length < 0) { return -1; }

        const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
        if (computed_file_size < 0 || offset > computed_file_size) { return -1; }
        const auto remaining = computed_file_size - offset;
        const auto requested_length = (length == 0 || length > remaining) ? remaining : length;
        if (requested_length < 0) { return -1; }
        if (requested_length == 0) {
            bytes.clear();
            return 0;
        }

        omega_byte_t *data_ptr = nullptr;
        int64_t copied_length = 0;
        const auto rc = omega_edit_save_segment_to_bytes(session_ptr, &data_ptr, &copied_length, offset, requested_length);
        if (rc != 0) {
            std::free(data_ptr);
            return rc;
        }
        bytes.assign(data_ptr, data_ptr + copied_length);
        std::free(data_ptr);
        return 0;
    }
}

struct omega_transform_plugin_registry_struct {
    std::vector<std::unique_ptr<loaded_plugin_t>> plugins;
};

omega_transform_plugin_registry_t *omega_transform_plugin_registry_create(void) {
    return new omega_transform_plugin_registry_t();
}

void omega_transform_plugin_registry_destroy(omega_transform_plugin_registry_t *registry_ptr) {
    delete registry_ptr;
}

int omega_transform_plugin_registry_register_plugin(omega_transform_plugin_registry_t *registry_ptr,
                                                   const char *plugin_path) {
    if (!registry_ptr || !plugin_path || !*plugin_path) { return -1; }

    auto plugin = std::make_unique<loaded_plugin_t>();
    plugin->path = plugin_path;
    plugin->library = dynamic_library_t(plugin_path);
    if (!plugin->library.ok()) { return -1; }

    const auto get_info = reinterpret_cast<omega_transform_plugin_get_info_fn>(
            plugin->library.symbol("omega_transform_plugin_get_info"));
    plugin->apply = reinterpret_cast<omega_transform_plugin_apply_fn>(
            plugin->library.symbol("omega_transform_plugin_apply"));
    if (!get_info || !plugin->apply) { return -1; }
    if (0 != get_info(&plugin->info)) { return -1; }
    if (plugin->info.abi_version != OMEGA_TRANSFORM_PLUGIN_ABI_VERSION || !plugin->info.id || !*plugin->info.id ||
        !plugin_operation_is_valid_(plugin->info.operation)) {
        return -1;
    }
    if (omega_transform_plugin_registry_find_info(registry_ptr, plugin->info.id) != nullptr) { return -1; }

    registry_ptr->plugins.push_back(std::move(plugin));
    return 0;
}

int omega_transform_plugin_registry_register_directory(omega_transform_plugin_registry_t *registry_ptr,
                                                      const char *plugin_directory) {
    if (!registry_ptr || !plugin_directory || !*plugin_directory) { return -1; }
    const std::filesystem::path directory(plugin_directory);

    int loaded_count = 0;
    try {
        if (!std::filesystem::is_directory(directory)) { return -1; }
        for (const auto &entry: std::filesystem::directory_iterator(directory)) {
            if (!entry.is_regular_file() || !plugin_extension_is_supported_(entry.path())) { continue; }
            const auto path = entry.path().string();
            if (0 == omega_transform_plugin_registry_register_plugin(registry_ptr, path.c_str())) { ++loaded_count; }
        }
    } catch (const std::filesystem::filesystem_error &) {
        return loaded_count > 0 ? loaded_count : -1;
    }
    return loaded_count;
}

int64_t omega_transform_plugin_registry_get_count(const omega_transform_plugin_registry_t *registry_ptr) {
    if (!registry_ptr) { return 0; }
    return static_cast<int64_t>(registry_ptr->plugins.size());
}

const omega_transform_plugin_info_t *omega_transform_plugin_registry_get_info(
        const omega_transform_plugin_registry_t *registry_ptr, int64_t index) {
    if (!registry_ptr || index < 0 || index >= static_cast<int64_t>(registry_ptr->plugins.size())) { return nullptr; }
    return &registry_ptr->plugins[static_cast<size_t>(index)]->info;
}

const omega_transform_plugin_info_t *omega_transform_plugin_registry_find_info(
        const omega_transform_plugin_registry_t *registry_ptr, const char *plugin_id) {
    if (!registry_ptr || !plugin_id || !*plugin_id) { return nullptr; }
    const auto iter = std::find_if(registry_ptr->plugins.cbegin(), registry_ptr->plugins.cend(),
                                   [plugin_id](const auto &plugin) { return plugin->info.id == std::string(plugin_id); });
    return iter != registry_ptr->plugins.cend() ? &(*iter)->info : nullptr;
}

int omega_transform_plugin_registry_apply_to_session(omega_transform_plugin_registry_t *registry_ptr,
                                                    const char *plugin_id, omega_session_t *session_ptr,
                                                    int64_t offset, int64_t length, const char *options_json,
                                                    omega_transform_plugin_response_t *response_ptr) {
    if (response_ptr) { omega_transform_plugin_response_clear(response_ptr); }
    if (!registry_ptr || !plugin_id || !*plugin_id || !session_ptr || offset < 0 || length < 0) { return -1; }

    // The registry owns plugin lookup/lifetime, but omega_session_t itself is not thread-safe.
    // Callers that share sessions across threads must hold their session/core lock across this call.
    auto iter = std::find_if(registry_ptr->plugins.begin(), registry_ptr->plugins.end(),
                             [plugin_id](const auto &plugin) { return plugin->info.id == std::string(plugin_id); });
    if (iter == registry_ptr->plugins.end()) { return -1; }

    std::vector<omega_byte_t> input_bytes;
    if (0 != read_session_range_(session_ptr, offset, length, input_bytes)) { return -1; }

    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    const auto requested_length = length == 0 ? computed_file_size - offset
                                              : std::min(length, computed_file_size - offset);
    if (requested_length < 0) { return -1; }

    omega_transform_plugin_request_t request{};
    request.input_bytes = input_bytes.empty() ? nullptr : input_bytes.data();
    request.input_length = static_cast<int64_t>(input_bytes.size());
    request.session_offset = offset;
    request.session_length = requested_length;
    request.options_json = options_json;
    request.alloc = plugin_malloc_;
    request.allocator_user_data_ptr = nullptr;

    omega_transform_plugin_response_t plugin_response{};
    if (0 != (*iter)->apply(&request, &plugin_response)) {
        omega_transform_plugin_response_clear(&plugin_response);
        return -1;
    }
    if (!plugin_buffer_is_valid_(plugin_response.replacement_bytes, plugin_response.replacement_length) ||
        !plugin_buffer_is_valid_(plugin_response.result_bytes, plugin_response.result_length)) {
        omega_transform_plugin_response_clear(&plugin_response);
        return -1;
    }

    const auto operation = (*iter)->info.operation;
    if (operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE ||
        operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT) {
        const auto serial = omega_edit_replace_bytes(session_ptr, offset, requested_length,
                                                     plugin_response.replacement_bytes,
                                                     plugin_response.replacement_length);
        if (serial < 0 || (serial == 0 && (requested_length > 0 || plugin_response.replacement_length > 0))) {
            omega_transform_plugin_response_clear(&plugin_response);
            return -1;
        }
    }

    move_plugin_response_(response_ptr, plugin_response);
    return 0;
}

void omega_transform_plugin_response_clear(omega_transform_plugin_response_t *response_ptr) {
    if (!response_ptr) { return; }
    std::free(response_ptr->replacement_bytes);
    std::free(response_ptr->result_bytes);
    std::free(response_ptr->result_label);
    std::free(response_ptr->result_mime_type);
    *response_ptr = {};
}
