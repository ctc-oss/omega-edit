/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed on an "AS IS" BASIS, WITHOUT    *
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the License for the specific language         *
 * governing permissions and limitations under the License.                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

#include "../include/omega_edit/transform.h"

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {
    constexpr uint32_t HOST_INFO_MAGIC = 0x4F454931U;    // OEI1
    constexpr uint32_t HOST_REQUEST_MAGIC = 0x4F455251U; // OERQ
    constexpr uint32_t HOST_RESPONSE_MAGIC = 0x4F455253U;// OERS
    constexpr uint32_t HOST_PROGRESS_MAGIC = 0x4F455047U;// OEPG

    struct dynamic_library_t {
#ifdef _WIN32
        HMODULE handle{};
#else
        void *handle{};
#endif

        explicit dynamic_library_t(const char *path) {
#ifdef _WIN32
            handle = LoadLibraryA(path);
#else
            handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
#endif
        }

        dynamic_library_t(const dynamic_library_t &) = delete;
        auto operator=(const dynamic_library_t &) -> dynamic_library_t & = delete;

        ~dynamic_library_t() {
            if (!handle) { return; }
#ifdef _WIN32
            FreeLibrary(handle);
#else
            dlclose(handle);
#endif
        }

        auto ok() const -> bool { return handle != nullptr; }

        auto symbol(const char *name) const -> void * {
            if (!handle) { return nullptr; }
#ifdef _WIN32
            return reinterpret_cast<void *>(GetProcAddress(handle, name));
#else
            return dlsym(handle, name);
#endif
        }
    };

    template<typename T>
    auto write_pod(std::ostream &out, const T &value) -> bool {
        out.write(reinterpret_cast<const char *>(&value), sizeof(T));
        return static_cast<bool>(out);
    }

    template<typename T>
    auto read_pod(std::istream &in, T &value) -> bool {
        in.read(reinterpret_cast<char *>(&value), sizeof(T));
        return static_cast<bool>(in);
    }

    auto write_string(std::ostream &out, const char *value) -> bool {
        const std::string text = value ? value : "";
        const auto length = static_cast<int64_t>(text.size());
        return write_pod(out, length) &&
               (length == 0 || static_cast<bool>(out.write(text.data(), static_cast<std::streamsize>(length))));
    }

    auto write_optional_string(std::ostream &out, const char *value) -> bool {
        const uint8_t present = value ? 1U : 0U;
        return write_pod(out, present) && (!value || write_string(out, value));
    }

    auto read_string(std::istream &in, std::string &value) -> bool {
        int64_t length = 0;
        if (!read_pod(in, length) || length < 0) { return false; }
        value.assign(static_cast<size_t>(length), '\0');
        return length == 0 || static_cast<bool>(in.read(value.data(), static_cast<std::streamsize>(value.size())));
    }

    auto write_bytes(std::ostream &out, const omega_byte_t *bytes, int64_t length) -> bool {
        if (length < 0 || (length > 0 && !bytes)) { return false; }
        return write_pod(out, length) &&
               (length == 0 || static_cast<bool>(out.write(reinterpret_cast<const char *>(bytes),
                                                           static_cast<std::streamsize>(length))));
    }

    auto read_bytes(std::istream &in, std::vector<omega_byte_t> &bytes) -> bool {
        int64_t length = 0;
        if (!read_pod(in, length) || length < 0) { return false; }
        bytes.assign(static_cast<size_t>(length), omega_byte_t{});
        return length == 0 || static_cast<bool>(in.read(reinterpret_cast<char *>(bytes.data()),
                                                        static_cast<std::streamsize>(bytes.size())));
    }

    struct allocation_state_t {
        std::vector<void *> allocations;
    };

    auto host_alloc(size_t size, void *user_data_ptr) -> void * {
        auto *state = static_cast<allocation_state_t *>(user_data_ptr);
        void *ptr = std::malloc(size == 0 ? 1 : size);
        if (ptr && state) { state->allocations.push_back(ptr); }
        return ptr;
    }

    auto response_owns(const omega_transform_plugin_response_t &response, void *ptr) -> bool {
        return ptr == response.replacement_bytes || ptr == response.result_bytes || ptr == response.result_label ||
               ptr == response.result_mime_type;
    }

    void release_allocations(allocation_state_t &state, const omega_transform_plugin_response_t &response) {
        for (auto *ptr : state.allocations) {
            if (!response_owns(response, ptr)) { std::free(ptr); }
        }
        state.allocations.clear();
    }

    void clear_response(omega_transform_plugin_response_t &response) {
        std::free(response.replacement_bytes);
        std::free(response.result_bytes);
        std::free(response.result_label);
        std::free(response.result_mime_type);
        response = {};
    }

    struct request_input_t {
        std::vector<omega_byte_t> bytes;
        int64_t session_length{};
    };

    struct callback_state_t {
        std::string progress_path;
        std::string cancel_path;
    };

    auto host_read(int64_t relative_offset, omega_byte_t *buffer, int64_t length, void *user_data_ptr) -> int64_t {
        auto *input = static_cast<request_input_t *>(user_data_ptr);
        if (!input || !buffer || relative_offset < 0 || length < 0 || relative_offset > input->session_length) {
            return -1;
        }
        const auto available = std::min<int64_t>(input->session_length - relative_offset, length);
        if (available <= 0) { return 0; }
        if (relative_offset > static_cast<int64_t>(input->bytes.size()) ||
            available > static_cast<int64_t>(input->bytes.size()) - relative_offset) {
            return -1;
        }
        std::memcpy(buffer, input->bytes.data() + relative_offset, static_cast<size_t>(available));
        return available;
    }

    auto host_is_cancelled(void *user_data_ptr) -> int {
        auto *state = static_cast<callback_state_t *>(user_data_ptr);
        if (!state || state->cancel_path.empty()) { return 0; }

        std::ifstream in(state->cancel_path, std::ios::binary);
        uint8_t cancel = 0;
        return in && read_pod(in, cancel) && cancel != 0 ? 1 : 0;
    }

    auto host_progress(const omega_transform_plugin_progress_t *progress_ptr, void *user_data_ptr) -> int {
        auto *state = static_cast<callback_state_t *>(user_data_ptr);
        if (!state || !progress_ptr) { return 0; }
        if (!state->progress_path.empty()) {
            std::ofstream out(state->progress_path, std::ios::binary | std::ios::app);
            if (!out || !write_pod(out, HOST_PROGRESS_MAGIC) || !write_pod(out, progress_ptr->processed_bytes) ||
                !write_pod(out, progress_ptr->total_bytes) || !write_pod(out, progress_ptr->percent) ||
                !write_pod(out, progress_ptr->flags) || !write_string(out, progress_ptr->phase) ||
                !write_string(out, progress_ptr->message)) {
                return -1;
            }
        }
        return host_is_cancelled(user_data_ptr);
    }

    struct apply_request_t {
        int64_t session_offset{};
        int64_t session_length{};
        int64_t preferred_chunk_size{};
        std::string options_json;
        std::vector<omega_byte_t> input;
        std::string progress_path;
        std::string cancel_path;
    };

    auto load_plugin(const char *plugin_path, dynamic_library_t &library, omega_transform_plugin_get_info_fn &get_info,
                     omega_transform_plugin_apply_fn &apply) -> bool {
        if (!plugin_path || !*plugin_path || !library.ok()) { return false; }
        get_info =
                reinterpret_cast<omega_transform_plugin_get_info_fn>(library.symbol("omega_transform_plugin_get_info"));
        apply = reinterpret_cast<omega_transform_plugin_apply_fn>(library.symbol("omega_transform_plugin_apply"));
        return get_info && apply;
    }

    auto write_info_response(const char *plugin_path, const char *response_path) -> bool {
        dynamic_library_t library(plugin_path);
        omega_transform_plugin_get_info_fn get_info = nullptr;
        omega_transform_plugin_apply_fn apply = nullptr;
        std::ofstream out(response_path, std::ios::binary | std::ios::trunc);
        if (!out || !write_pod(out, HOST_INFO_MAGIC)) { return false; }

        omega_transform_plugin_info_t info{};
        int32_t status = -1;
        if (load_plugin(plugin_path, library, get_info, apply) && get_info(&info) == 0) { status = 0; }
        if (!write_pod(out, status)) { return false; }
        if (status != 0) { return true; }

        return write_pod(out, info.abi_version) && write_pod(out, static_cast<int32_t>(info.operation)) &&
               write_pod(out, info.flags) && write_pod(out, static_cast<int32_t>(info.support)) &&
               write_string(out, info.id) && write_string(out, info.name) && write_string(out, info.description) &&
               write_string(out, info.help) && write_string(out, info.example) &&
               write_string(out, info.default_args) && write_string(out, info.args_schema);
    }

    auto read_apply_request(const char *request_path, apply_request_t &request) -> bool {
        std::ifstream in(request_path, std::ios::binary);
        uint32_t magic = 0;
        if (!in || !read_pod(in, magic) || magic != HOST_REQUEST_MAGIC) { return false; }
        return read_pod(in, request.session_offset) && read_pod(in, request.session_length) &&
               read_pod(in, request.preferred_chunk_size) && request.session_offset >= 0 &&
               request.session_length >= 0 && request.preferred_chunk_size >= 0 &&
               read_string(in, request.options_json) && read_bytes(in, request.input) &&
               static_cast<int64_t>(request.input.size()) == request.session_length &&
               read_string(in, request.progress_path) && read_string(in, request.cancel_path);
    }

    auto write_apply_response(const char *response_path, int32_t status,
                              const omega_transform_plugin_response_t &response) -> bool {
        std::ofstream out(response_path, std::ios::binary | std::ios::trunc);
        if (!out || !write_pod(out, HOST_RESPONSE_MAGIC) || !write_pod(out, status)) { return false; }
        if (status != 0) { return true; }
        return write_pod(out, response.flags) &&
               write_bytes(out, response.replacement_bytes, response.replacement_length) &&
               write_bytes(out, response.result_bytes, response.result_length) &&
               write_optional_string(out, response.result_label) &&
               write_optional_string(out, response.result_mime_type);
    }

    auto run_apply(const char *plugin_path, const char *request_path, const char *response_path) -> bool {
        dynamic_library_t library(plugin_path);
        omega_transform_plugin_get_info_fn get_info = nullptr;
        omega_transform_plugin_apply_fn apply = nullptr;
        if (!load_plugin(plugin_path, library, get_info, apply)) {
            omega_transform_plugin_response_t empty{};
            return write_apply_response(response_path, -1, empty);
        }

        apply_request_t host_request;
        if (!read_apply_request(request_path, host_request)) {
            omega_transform_plugin_response_t empty{};
            return write_apply_response(response_path, -1, empty);
        }

        allocation_state_t allocation_state;
        request_input_t input{std::move(host_request.input), host_request.session_length};
        callback_state_t callbacks{std::move(host_request.progress_path), std::move(host_request.cancel_path)};
        omega_transform_plugin_request_t request{};
        request.input_bytes = input.bytes.empty() ? nullptr : input.bytes.data();
        request.input_length = static_cast<int64_t>(input.bytes.size());
        request.session_offset = host_request.session_offset;
        request.session_length = host_request.session_length;
        request.options_json = host_request.options_json.empty() ? nullptr : host_request.options_json.c_str();
        request.alloc = host_alloc;
        request.allocator_user_data_ptr = &allocation_state;
        request.read = host_read;
        request.reader_user_data_ptr = &input;
        request.preferred_chunk_size = host_request.preferred_chunk_size;
        request.progress = callbacks.progress_path.empty() ? nullptr : host_progress;
        request.progress_user_data_ptr = &callbacks;
        request.is_cancelled = callbacks.cancel_path.empty() ? nullptr : host_is_cancelled;
        request.cancel_user_data_ptr = &callbacks;

        omega_transform_plugin_response_t response{};
        const int32_t status = apply(&request, &response) == 0 ? 0 : -1;
        release_allocations(allocation_state, response);
        const auto wrote_response = write_apply_response(response_path, status, response);
        clear_response(response);
        return wrote_response;
    }
}// namespace

int main(int argc, char **argv) {
    if (argc != 4 && argc != 5) {
        std::cerr << "usage: omega-transform-plugin-host --get-info <plugin> <response>\n"
                  << "       omega-transform-plugin-host --apply <plugin> <request> <response>\n";
        return 2;
    }

    const std::string command = argv[1] ? argv[1] : "";
    if (command == "--get-info" && argc == 4) { return write_info_response(argv[2], argv[3]) ? 0 : 1; }
    if (command == "--apply" && argc == 5) { return run_apply(argv[2], argv[3], argv[4]) ? 0 : 1; }
    return 2;
}
