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

#include <omega_edit.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#endif

namespace {
    struct options_t {
        std::vector<std::string> plugin_dirs;
        std::vector<std::string> plugin_paths;
        bool allow_experimental = false;
        bool list = false;
        std::string run_id;
        std::optional<std::vector<omega_byte_t>> input;
        int64_t offset = 0;
        int64_t length = 0;
        std::string options_json;
        std::optional<std::vector<omega_byte_t>> expect_output;
        std::optional<std::string> expect_result;
    };

    void print_usage(const char *argv0) {
        std::cerr
                << "Usage:\n"
                << "  " << argv0 << " [--plugin-dir DIR] --list\n"
                << "  " << argv0 << " --plugin PATH --run ID --input TEXT [--expect-output TEXT]\n"
                << "  " << argv0 << " --plugin-dir DIR --run ID --input-hex HEX [--offset N] [--length N]\n"
                << "       [--allow-experimental] [--options JSON] [--expect-output-hex HEX] [--expect-result TEXT]\n";
    }

    auto executable_path_from_argv0(const char *argv0) -> std::filesystem::path {
        if (!argv0 || !*argv0) { return {}; }
        const std::filesystem::path argv0_path(argv0);
        std::error_code error;
        if (argv0_path.has_parent_path()) { return std::filesystem::absolute(argv0_path, error); }

#if defined(_WIN32)
        char *path_env = nullptr;
        size_t path_env_size = 0;
        if (_dupenv_s(&path_env, &path_env_size, "PATH") != 0 || !path_env) { return {}; }
        const std::string path_value(path_env);
        std::free(path_env);
        constexpr char path_separator = ';';
#else
        const auto *path_env = std::getenv("PATH");
        if (!path_env) { return {}; }
        const std::string path_value(path_env);
        constexpr char path_separator = ':';
#endif
        std::stringstream paths(path_value);
        std::string directory;
        while (std::getline(paths, directory, path_separator)) {
            const auto candidate =
                    (directory.empty() ? std::filesystem::path(".") : std::filesystem::path(directory)) / argv0_path;
            if (std::filesystem::is_regular_file(candidate, error) && !error) {
                return std::filesystem::absolute(candidate, error);
            }
            error.clear();
        }
        return {};
    }

    auto running_executable_path(const char *argv0) -> std::filesystem::path {
#if defined(_WIN32)
        std::vector<wchar_t> buffer(1024);
        while (buffer.size() <= 32768) {
            const auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
            if (length == 0) { break; }
            if (length < buffer.size()) { return {buffer.data(), buffer.data() + length}; }
            buffer.resize(buffer.size() * 2);
        }
#elif defined(__APPLE__)
        uint32_t size = 0;
        if (_NSGetExecutablePath(nullptr, &size) != 0 && size > 0) {
            std::vector<char> buffer(size);
            if (_NSGetExecutablePath(buffer.data(), &size) == 0) { return buffer.data(); }
        }
#elif defined(__linux__)
        std::error_code error;
        auto executable = std::filesystem::read_symlink("/proc/self/exe", error);
        if (!error && !executable.empty()) { return executable; }
#endif
        return executable_path_from_argv0(argv0);
    }

    auto installed_plugin_directory(const char *argv0) -> std::string {
        auto executable = running_executable_path(argv0);
        if (executable.empty()) { return {}; }
        std::error_code error;
        executable = std::filesystem::weakly_canonical(executable, error);
        if (error) { return {}; }
        const auto candidate = executable.parent_path().parent_path() / "lib" / "omega_edit" / "plugins";
        return std::filesystem::is_directory(candidate, error) && !error ? candidate.string() : std::string{};
    }

    auto parse_i64(const char *value, int64_t &out) -> bool {
        if (!value || !*value) { return false; }
        char *end_ptr = nullptr;
        const auto parsed = std::strtoll(value, &end_ptr, 10);
        if (!end_ptr || *end_ptr != '\0') { return false; }
        out = static_cast<int64_t>(parsed);
        return true;
    }

    auto hex_nibble(char ch, omega_byte_t &value) -> bool {
        if (ch >= '0' && ch <= '9') {
            value = static_cast<omega_byte_t>(ch - '0');
            return true;
        }
        if (ch >= 'a' && ch <= 'f') {
            value = static_cast<omega_byte_t>(10 + ch - 'a');
            return true;
        }
        if (ch >= 'A' && ch <= 'F') {
            value = static_cast<omega_byte_t>(10 + ch - 'A');
            return true;
        }
        return false;
    }

    auto parse_hex(std::string hex, std::vector<omega_byte_t> &bytes) -> bool {
        hex.erase(std::remove_if(hex.begin(), hex.end(),
                                 [](unsigned char ch) { return std::isspace(ch) != 0 || ch == ':' || ch == '-'; }),
                  hex.end());
        if ((hex.size() % 2) != 0) { return false; }
        bytes.clear();
        bytes.reserve(hex.size() / 2);
        for (size_t i = 0; i < hex.size(); i += 2) {
            omega_byte_t high = 0;
            omega_byte_t low = 0;
            if (!hex_nibble(hex[i], high) || !hex_nibble(hex[i + 1], low)) { return false; }
            bytes.push_back(static_cast<omega_byte_t>((high << 4) | low));
        }
        return true;
    }

    auto to_hex(const omega_byte_t *bytes, int64_t length) -> std::string {
        static constexpr char digits[] = "0123456789abcdef";
        std::string result;
        if (length <= 0) { return result; }
        result.reserve(static_cast<size_t>(length) * 2);
        for (int64_t i = 0; i < length; ++i) {
            result.push_back(digits[(bytes[i] >> 4) & 0x0F]);
            result.push_back(digits[bytes[i] & 0x0F]);
        }
        return result;
    }

    auto bytes_from_string(const std::string &value) -> std::vector<omega_byte_t> {
        return {reinterpret_cast<const omega_byte_t *>(value.data()),
                reinterpret_cast<const omega_byte_t *>(value.data()) + value.size()};
    }

    auto parse_options(int argc, char **argv, options_t &options) -> bool {
        for (int i = 1; i < argc; ++i) {
            const std::string arg = argv[i];
            auto require_value = [&](const char *name) -> const char * {
                if (i + 1 >= argc) {
                    std::cerr << name << " requires a value\n";
                    return nullptr;
                }
                return argv[++i];
            };

            if (arg == "--plugin-dir") {
                const auto value = require_value("--plugin-dir");
                if (!value) { return false; }
                options.plugin_dirs.emplace_back(value);
            } else if (arg == "--plugin") {
                const auto value = require_value("--plugin");
                if (!value) { return false; }
                options.plugin_paths.emplace_back(value);
            } else if (arg == "--list") {
                options.list = true;
            } else if (arg == "--allow-experimental") {
                options.allow_experimental = true;
            } else if (arg == "--run") {
                const auto value = require_value("--run");
                if (!value) { return false; }
                options.run_id = value;
            } else if (arg == "--input") {
                const auto value = require_value("--input");
                if (!value) { return false; }
                options.input = bytes_from_string(value);
            } else if (arg == "--input-hex") {
                const auto value = require_value("--input-hex");
                if (!value) { return false; }
                std::vector<omega_byte_t> bytes;
                if (!parse_hex(value, bytes)) {
                    std::cerr << "invalid --input-hex value\n";
                    return false;
                }
                options.input = bytes;
            } else if (arg == "--offset") {
                const auto value = require_value("--offset");
                if (!value || !parse_i64(value, options.offset)) { return false; }
            } else if (arg == "--length") {
                const auto value = require_value("--length");
                if (!value || !parse_i64(value, options.length)) { return false; }
            } else if (arg == "--options") {
                const auto value = require_value("--options");
                if (!value) { return false; }
                options.options_json = value;
            } else if (arg == "--expect-output") {
                const auto value = require_value("--expect-output");
                if (!value) { return false; }
                options.expect_output = bytes_from_string(value);
            } else if (arg == "--expect-output-hex") {
                const auto value = require_value("--expect-output-hex");
                if (!value) { return false; }
                std::vector<omega_byte_t> bytes;
                if (!parse_hex(value, bytes)) {
                    std::cerr << "invalid --expect-output-hex value\n";
                    return false;
                }
                options.expect_output = bytes;
            } else if (arg == "--expect-result") {
                const auto value = require_value("--expect-result");
                if (!value) { return false; }
                options.expect_result = value;
            } else if (arg == "--help" || arg == "-h") {
                return false;
            } else {
                std::cerr << "unknown option: " << arg << "\n";
                return false;
            }
        }
        return true;
    }

    auto operation_name(omega_transform_plugin_operation_t operation) -> const char * {
        switch (operation) {
            case OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE:
                return "replace";
            case OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT:
                return "inspect";
            case OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT:
                return "replace_and_inspect";
            default:
                return "unknown";
        }
    }

    auto register_plugins(omega_transform_plugin_registry_t *registry_ptr, const options_t &options) -> bool {
        for (const auto &path : options.plugin_paths) {
            if (0 != omega_transform_plugin_registry_register_plugin(registry_ptr, path.c_str())) {
                std::cerr << "failed to register plugin: " << path << "\n";
                return false;
            }
        }
        for (const auto &dir : options.plugin_dirs) {
            if (0 > omega_transform_plugin_registry_register_directory(registry_ptr, dir.c_str())) {
                std::cerr << "failed to register plugin directory: " << dir << "\n";
                return false;
            }
        }
        return true;
    }

    auto list_plugins(const omega_transform_plugin_registry_t *registry_ptr) -> int {
        const auto count = omega_transform_plugin_registry_get_count(registry_ptr);
        std::cout << "plugins=" << count << "\n";
        for (int64_t i = 0; i < count; ++i) {
            const auto *info = omega_transform_plugin_registry_get_info(registry_ptr, i);
            if (!info) { continue; }
            std::cout << info->id << "\t" << (info->name ? info->name : "") << "\t" << operation_name(info->operation)
                      << "\t" << info->flags << "\t" << (info->description ? info->description : "") << "\n";
        }
        return 0;
    }

    auto run_plugin(omega_transform_plugin_registry_t *registry_ptr, const options_t &options) -> int {
        if (options.run_id.empty()) {
            std::cerr << "--run is required unless --list is used\n";
            return 2;
        }
        if (!options.input.has_value()) {
            std::cerr << "--input or --input-hex is required with --run\n";
            return 2;
        }

        const auto &input = *options.input;
        auto *session_ptr = omega_edit_create_session_from_bytes(input.empty() ? nullptr : input.data(),
                                                                 static_cast<int64_t>(input.size()), nullptr, nullptr,
                                                                 NO_EVENTS, nullptr);
        if (!session_ptr) {
            std::cerr << "failed to create session\n";
            return 1;
        }

        omega_transform_plugin_response_t response{};
        const auto options_json = options.options_json.empty() ? nullptr : options.options_json.c_str();
        const auto rc = omega_transform_plugin_registry_apply_to_session(registry_ptr, options.run_id.c_str(),
                                                                         session_ptr, options.offset, options.length,
                                                                         options_json, &response);
        if (rc != 0) {
            omega_edit_destroy_session(session_ptr);
            std::cerr << "plugin apply failed\n";
            return 1;
        }

        omega_byte_t *output_ptr = nullptr;
        int64_t output_length = 0;
        if (0 != omega_edit_save_to_bytes(session_ptr, &output_ptr, &output_length)) {
            omega_transform_plugin_response_clear(&response);
            omega_edit_destroy_session(session_ptr);
            std::cerr << "failed to read output session bytes\n";
            return 1;
        }

        std::cout << "output_hex=" << to_hex(output_ptr, output_length) << "\n";
        if (response.result_length > 0 && response.result_bytes != nullptr) {
            std::cout << "result_label=" << (response.result_label ? response.result_label : "") << "\n";
            std::cout << "result_mime_type=" << (response.result_mime_type ? response.result_mime_type : "") << "\n";
            std::cout << "result_text="
                      << std::string(reinterpret_cast<const char *>(response.result_bytes),
                                     static_cast<size_t>(response.result_length))
                      << "\n";
            std::cout << "result_hex=" << to_hex(response.result_bytes, response.result_length) << "\n";
        }

        int result = 0;
        if (options.expect_output.has_value()) {
            const auto &expected = *options.expect_output;
            if (expected.size() != static_cast<size_t>(output_length) ||
                std::memcmp(expected.data(), output_ptr, expected.size()) != 0) {
                std::cerr << "output mismatch: expected "
                          << to_hex(expected.data(), static_cast<int64_t>(expected.size())) << " got "
                          << to_hex(output_ptr, output_length) << "\n";
                result = 1;
            }
        }
        if (options.expect_result.has_value()) {
            const std::string actual = response.result_length > 0 && response.result_bytes != nullptr
                                               ? std::string(reinterpret_cast<const char *>(response.result_bytes),
                                                             static_cast<size_t>(response.result_length))
                                               : std::string();
            if (*options.expect_result != actual) {
                std::cerr << "result mismatch: expected '" << *options.expect_result << "' got '" << actual << "'\n";
                result = 1;
            }
        }

        std::free(output_ptr);
        omega_transform_plugin_response_clear(&response);
        omega_edit_destroy_session(session_ptr);
        return result;
    }
}// namespace

int main(int argc, char **argv) {
    options_t options;
    if (!parse_options(argc, argv, options)) {
        print_usage(argv[0]);
        return 2;
    }
    if (options.plugin_dirs.empty() && options.plugin_paths.empty()) {
        const auto installed_directory = installed_plugin_directory(argv[0]);
        if (installed_directory.empty()) {
            std::cerr << "no plugin directory specified and no installed plugins found\n";
            print_usage(argv[0]);
            return 2;
        }
        options.plugin_dirs.push_back(installed_directory);
    }

    auto *registry_ptr = omega_transform_plugin_registry_create();
    if (!registry_ptr) {
        std::cerr << "failed to create plugin registry\n";
        return 1;
    }

    if (options.allow_experimental && omega_transform_plugin_registry_set_allow_experimental(registry_ptr, 1) != 0) {
        omega_transform_plugin_registry_destroy(registry_ptr);
        std::cerr << "failed to enable experimental plugins\n";
        return 1;
    }

    if (!register_plugins(registry_ptr, options)) {
        omega_transform_plugin_registry_destroy(registry_ptr);
        return 1;
    }

    const auto rc = options.list ? list_plugins(registry_ptr) : run_plugin(registry_ptr, options);
    omega_transform_plugin_registry_destroy(registry_ptr);
    return rc;
}
