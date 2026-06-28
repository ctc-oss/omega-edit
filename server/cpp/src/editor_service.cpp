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

#include "editor_service.h"

#include <omega_edit.h>
#include <omega_edit/character_counts.h>
#include <omega_edit/check.h>
#include <omega_edit/utility.h>
#include <omega_edit/version.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <optional>
#include <sstream>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <psapi.h>
#include <windows.h>
#elif defined(__APPLE__)
#include <mach/mach.h>
#include <sys/resource.h>
#include <unistd.h>
#else
#include <sys/resource.h>
#include <unistd.h>
#endif

namespace omega_edit {
    namespace grpc_server {

        static const std::string &get_hostname() {
            static const std::string value = []() -> std::string {
                char buf[256] = {};
#ifdef _WIN32
                DWORD size = sizeof(buf);
                if (GetComputerNameA(buf, &size)) return std::string(buf, size);
#else
                if (gethostname(buf, sizeof(buf)) == 0) return std::string(buf);
#endif
                return "unknown";
            }();
            return value;
        }

        static int get_pid() {
#ifdef _WIN32
            return static_cast<int>(GetCurrentProcessId());
#else
            return static_cast<int>(getpid());
#endif
        }

        static int get_cpu_count() {
            auto n = std::thread::hardware_concurrency();
            return n > 0 ? static_cast<int>(n) : 1;
        }

        static constexpr char SESSION_FINGERPRINT_DIGEST_PLUGIN_ID[] = "omega.example.openssl_digests";
        static constexpr char DEFAULT_SESSION_FINGERPRINT_ALGORITHM[] = "sha256";
        static constexpr int64_t SESSION_FINGERPRINT_CHUNK_SIZE = 1024 * 1024;

        static bool path_argument_is_safe_for_core(const std::string &path) {
            return path.size() < FILENAME_MAX && std::none_of(path.begin(), path.end(), [](unsigned char ch) {
                       return ch == '\0' || ch < 0x20U || ch == 0x7FU;
                   });
        }

        static grpc::Status validate_path_argument(const std::string &path, const char *field_name) {
            if (path.empty() || path_argument_is_safe_for_core(path)) { return grpc::Status::OK; }
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                std::string(field_name) +
                                        " must be shorter than FILENAME_MAX and contain no NUL or control characters");
        }

        static std::string normalize_digest_algorithm(std::string algorithm) {
            if (algorithm.empty()) { return DEFAULT_SESSION_FINGERPRINT_ALGORITHM; }
            std::transform(algorithm.begin(), algorithm.end(), algorithm.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            return algorithm;
        }

        static bool digest_algorithm_is_json_safe(const std::string &algorithm) {
            return !algorithm.empty() && std::all_of(algorithm.begin(), algorithm.end(),
                                                     [](unsigned char c) { return std::isalnum(c) != 0 || c == '-'; });
        }

        static std::string make_digest_options_json(const std::string &algorithm) {
            return "{\"algorithm\":\"" + algorithm + "\"}";
        }

        using session_fingerprint_content = ::omega_edit::v1::SessionFingerprintContent;

        static int64_t get_session_fingerprint_byte_length(omega_session_t *session,
                                                           session_fingerprint_content content) {
            switch (content) {
                case ::omega_edit::v1::SESSION_FINGERPRINT_CONTENT_ORIGINAL:
                    return omega_session_get_original_file_size(session);
                case ::omega_edit::v1::SESSION_FINGERPRINT_CONTENT_COMPUTED:
                    return omega_session_get_computed_file_size(session);
                default:
                    return -1;
            }
        }

        static int read_session_fingerprint_segment(const omega_session_t *session, session_fingerprint_content content,
                                                    omega_segment_t *segment, int64_t offset) {
            switch (content) {
                case ::omega_edit::v1::SESSION_FINGERPRINT_CONTENT_ORIGINAL:
                    return omega_session_get_original_segment(session, segment, offset);
                case ::omega_edit::v1::SESSION_FINGERPRINT_CONTENT_COMPUTED:
                    return omega_session_get_segment(session, segment, offset);
                default:
                    return -1;
            }
        }

        struct session_fingerprint_reader {
            const omega_session_t *session{};
            session_fingerprint_content content{};
            int64_t byte_length{};
        };

        static int64_t read_session_fingerprint_chunk(int64_t relative_offset, omega_byte_t *buffer, int64_t length,
                                                      void *user_data_ptr) {
            auto *reader = static_cast<session_fingerprint_reader *>(user_data_ptr);
            if (!reader || !reader->session || !buffer || relative_offset < 0 || length < 0 ||
                relative_offset > reader->byte_length) {
                return -1;
            }

            const auto remaining = reader->byte_length - relative_offset;
            const auto read_length = std::min(std::min(length, remaining), SESSION_FINGERPRINT_CHUNK_SIZE);
            if (read_length == 0) { return 0; }

            auto *segment = omega_segment_create(read_length);
            if (!segment) { return -1; }
            const auto rc =
                    read_session_fingerprint_segment(reader->session, reader->content, segment, relative_offset);
            if (rc != 0) {
                omega_segment_destroy(segment);
                return -1;
            }

            const auto segment_length = std::min(read_length, omega_segment_get_length(segment));
            auto *data = omega_segment_get_data(segment);
            if (segment_length <= 0 || !data) {
                omega_segment_destroy(segment);
                return -1;
            }
            std::memcpy(buffer, data, static_cast<size_t>(segment_length));
            omega_segment_destroy(segment);
            return segment_length;
        }

        struct process_memory_metrics {
            std::optional<int64_t> resident_memory_bytes;
            std::optional<int64_t> virtual_memory_bytes;
            std::optional<int64_t> peak_resident_memory_bytes;
        };

        struct transform_plugin_response_guard {
            omega_transform_plugin_response_t response{};

            transform_plugin_response_guard() = default;
            transform_plugin_response_guard(const transform_plugin_response_guard &) = delete;
            auto operator=(const transform_plugin_response_guard &) -> transform_plugin_response_guard & = delete;
            ~transform_plugin_response_guard() { omega_transform_plugin_response_clear(&response); }
        };

        struct transform_progress_context {
            SessionManager *session_manager{};
            std::string session_id;
            std::string plugin_id;
            std::string operation_id;
            std::chrono::steady_clock::time_point last_emit{};
        };

        static std::atomic<uint64_t> g_transform_operation_counter{0};

        static std::string next_transform_operation_id() {
            return "transform_" +
                   std::to_string(g_transform_operation_counter.fetch_add(1, std::memory_order_relaxed) + 1);
        }

        static TransformProgressData make_transform_progress(const std::string &plugin_id,
                                                             const std::string &operation_id, const char *phase,
                                                             const char *message, bool indeterminate = true) {
            TransformProgressData progress;
            progress.plugin_id = plugin_id;
            progress.operation_id = operation_id;
            progress.phase = phase ? phase : "";
            progress.message = message ? message : "";
            progress.indeterminate = indeterminate;
            return progress;
        }

        static TransformProgressData make_transform_progress(const transform_progress_context &context,
                                                             const omega_transform_plugin_progress_t &reported) {
            TransformProgressData progress;
            progress.plugin_id = context.plugin_id;
            progress.operation_id = context.operation_id;
            progress.phase = reported.phase ? reported.phase : "";
            progress.message = reported.message ? reported.message : "";
            progress.indeterminate = (reported.flags & OMEGA_TRANSFORM_PROGRESS_INDETERMINATE) != 0U;
            progress.has_processed_bytes = (reported.flags & OMEGA_TRANSFORM_PROGRESS_HAS_PROCESSED_BYTES) != 0U;
            progress.has_total_bytes = (reported.flags & OMEGA_TRANSFORM_PROGRESS_HAS_TOTAL_BYTES) != 0U;
            progress.has_percent = (reported.flags & OMEGA_TRANSFORM_PROGRESS_HAS_PERCENT) != 0U;
            progress.processed_bytes = reported.processed_bytes;
            progress.total_bytes = reported.total_bytes;
            progress.percent = reported.percent;
            return progress;
        }

        static int transform_progress_callback(const omega_transform_plugin_progress_t *progress_ptr,
                                               void *user_data_ptr) {
            auto *context = static_cast<transform_progress_context *>(user_data_ptr);
            if (!context || !context->session_manager || !progress_ptr) { return -1; }

            const auto now = std::chrono::steady_clock::now();
            constexpr auto min_interval = std::chrono::milliseconds(250);
            const bool complete_percent = (progress_ptr->flags & OMEGA_TRANSFORM_PROGRESS_HAS_PERCENT) != 0U &&
                                          progress_ptr->percent >= 100.0;
            if (context->last_emit.time_since_epoch().count() != 0 && now - context->last_emit < min_interval &&
                !complete_percent) {
                return 0;
            }

            context->last_emit = now;
            const auto progress = make_transform_progress(*context, *progress_ptr);
            context->session_manager->publish_transform_progress(
                    context->session_id, static_cast<int32_t>(SESSION_EVT_TRANSFORM_PROGRESS), progress);
            return 0;
        }

        static grpc::Status status_for_session_operation_start(SessionOperationStartResult result,
                                                               const std::string &operation_name,
                                                               const std::string &session_id) {
            switch (result) {
                case SessionOperationStartResult::STARTED:
                    return grpc::Status::OK;
                case SessionOperationStartResult::SESSION_NOT_FOUND:
                    return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + session_id);
                case SessionOperationStartResult::TRANSFORM_IN_PROGRESS:
                    return grpc::Status(
                            grpc::StatusCode::FAILED_PRECONDITION,
                            operation_name + " cannot run while a transform is in progress for session: " + session_id);
                case SessionOperationStartResult::MUTATION_IN_PROGRESS:
                    return grpc::Status(
                            grpc::StatusCode::FAILED_PRECONDITION,
                            operation_name +
                                    " cannot run while a session mutation is in progress for session: " + session_id);
            }
            return grpc::Status(grpc::StatusCode::INTERNAL, "unknown session operation state");
        }

        static const std::string &get_runtime_kind() {
            static const std::string value = "native";
            return value;
        }

        static const std::string &get_runtime_name() {
            static const std::string value = "C++";
            return value;
        }

        static const std::string &get_platform_summary() {
            static const std::string value = []() {
#ifdef _WIN32
                std::string os = "windows";
#elif defined(__APPLE__)
                std::string os = "macos";
#elif defined(__linux__)
                std::string os = "linux";
#else
                std::string os = "unknown";
#endif

#if defined(_M_X64) || defined(__x86_64__)
                std::string arch = "x64";
#elif defined(_M_ARM64) || defined(__aarch64__)
                std::string arch = "arm64";
#elif defined(_M_IX86) || defined(__i386__)
                std::string arch = "x86";
#elif defined(_M_ARM) || defined(__arm__)
                std::string arch = "arm";
#else
                std::string arch = "unknown";
#endif
                return os + "-" + arch;
            }();
            return value;
        }

        static const std::string &get_compiler_info() {
            static const std::string value =
#if defined(__clang__)
                    "Clang " + std::to_string(__clang_major__) + "." + std::to_string(__clang_minor__) + "." +
                    std::to_string(__clang_patchlevel__);
#elif defined(_MSC_FULL_VER)
                    "MSVC " + std::to_string(_MSC_FULL_VER);
#elif defined(_MSC_VER)
                    "MSVC " + std::to_string(_MSC_VER);
#elif defined(__GNUC__)
                    "GCC " + std::to_string(__GNUC__) + "." + std::to_string(__GNUC_MINOR__) + "." +
                    std::to_string(__GNUC_PATCHLEVEL__);
#else
                    "unknown";
#endif
            return value;
        }

        static const std::string &get_build_type() {
#ifdef NDEBUG
            static const std::string value = "Release";
#else
            static const std::string value = "Debug";
#endif
            return value;
        }

        static const std::string &get_cpp_standard() {
            static const std::string value = []() -> std::string {
#if __cplusplus >= 202302L
                return "C++23";
#elif __cplusplus >= 202002L
                return "C++20";
#elif __cplusplus >= 201703L
                return "C++17";
#elif __cplusplus >= 201402L
                return "C++14";
#elif __cplusplus >= 201103L
                return "C++11";
#elif defined(_MSVC_LANG)
#if _MSVC_LANG >= 202302L
                return "C++23";
#elif _MSVC_LANG >= 202002L
                return "C++20";
#elif _MSVC_LANG >= 201703L
                return "C++17";
#elif _MSVC_LANG >= 201402L
                return "C++14";
#else
                return "C++11";
#endif
#else
                return "unknown";
#endif
            }();
            return value;
        }

        static std::optional<double> get_cpu_load_average() {
#ifdef _WIN32
            return std::nullopt;
#else
            double loadavg[1] = {0.0};
            if (getloadavg(loadavg, 1) == 1) { return loadavg[0]; }
            return std::nullopt;
#endif
        }

#if defined(__linux__)
        static std::optional<int64_t> read_proc_status_kibibytes(const char *label) {
            std::ifstream status_file("/proc/self/status");
            if (!status_file.is_open()) { return std::nullopt; }

            std::string line;
            while (std::getline(status_file, line)) {
                if (line.rfind(label, 0) != 0) { continue; }

                std::istringstream stream(line.substr(std::strlen(label)));
                int64_t kibibytes = 0;
                std::string unit;
                if (stream >> kibibytes >> unit) { return kibibytes * 1024; }
            }

            return std::nullopt;
        }
#endif

        static process_memory_metrics get_process_memory_metrics() {
            process_memory_metrics metrics;

#ifdef _WIN32
            PROCESS_MEMORY_COUNTERS_EX counters = {};
            if (GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS *>(&counters),
                                     sizeof(counters))) {
                metrics.resident_memory_bytes = static_cast<int64_t>(counters.WorkingSetSize);
                metrics.peak_resident_memory_bytes = static_cast<int64_t>(counters.PeakWorkingSetSize);
            }
#elif defined(__APPLE__)
            mach_task_basic_info info = {};
            mach_msg_type_number_t info_count = MACH_TASK_BASIC_INFO_COUNT;
            if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, reinterpret_cast<task_info_t>(&info), &info_count) ==
                KERN_SUCCESS) {
                metrics.resident_memory_bytes = static_cast<int64_t>(info.resident_size);
                metrics.virtual_memory_bytes = static_cast<int64_t>(info.virtual_size);
            }

            struct rusage usage = {};
            if (getrusage(RUSAGE_SELF, &usage) == 0) {
                metrics.peak_resident_memory_bytes = static_cast<int64_t>(usage.ru_maxrss);
            }
#elif defined(__linux__)
            metrics.resident_memory_bytes = read_proc_status_kibibytes("VmRSS:");
            metrics.virtual_memory_bytes = read_proc_status_kibibytes("VmSize:");
            metrics.peak_resident_memory_bytes = read_proc_status_kibibytes("VmHWM:");

            if (!metrics.peak_resident_memory_bytes.has_value()) {
                struct rusage usage = {};
                if (getrusage(RUSAGE_SELF, &usage) == 0) {
                    metrics.peak_resident_memory_bytes = static_cast<int64_t>(usage.ru_maxrss) * 1024;
                }
            }
#endif

            return metrics;
        }

        static grpc::Status validate_change_payload_size(const ::omega_edit::v1::SubmitChangeRequest *request,
                                                         int64_t max_change_bytes) {
            if ((request->kind() != ::omega_edit::v1::CHANGE_KIND_INSERT &&
                 request->kind() != ::omega_edit::v1::CHANGE_KIND_OVERWRITE) ||
                max_change_bytes <= 0) {
                return grpc::Status::OK;
            }

            if (request->data().size() <= static_cast<size_t>(max_change_bytes)) { return grpc::Status::OK; }

            return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED, "change payload exceeds configured limit of " +
                                                                              std::to_string(max_change_bytes) +
                                                                              " bytes");
        }

        static grpc::Status
        validate_replace_checkpointed_payload_sizes(const ::omega_edit::v1::ReplaceSessionCheckpointedRequest *request,
                                                    int64_t max_change_bytes) {
            if (max_change_bytes <= 0) { return grpc::Status::OK; }

            if (request->pattern().size() > static_cast<size_t>(max_change_bytes)) {
                return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                    "checkpointed replace pattern exceeds configured limit of " +
                                            std::to_string(max_change_bytes) + " bytes");
            }

            if (request->replacement().size() > static_cast<size_t>(max_change_bytes)) {
                return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                    "checkpointed replace replacement exceeds configured limit of " +
                                            std::to_string(max_change_bytes) + " bytes");
            }

            return grpc::Status::OK;
        }

        static grpc::Status validate_replace_payload_sizes(const std::string &pattern, const std::string &replacement,
                                                           int64_t max_change_bytes,
                                                           const std::string &operation_name) {
            if (max_change_bytes <= 0) { return grpc::Status::OK; }

            if (pattern.size() > static_cast<size_t>(max_change_bytes)) {
                return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                    operation_name + " pattern exceeds configured limit of " +
                                            std::to_string(max_change_bytes) + " bytes");
            }

            if (replacement.size() > static_cast<size_t>(max_change_bytes)) {
                return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                    operation_name + " replacement exceeds configured limit of " +
                                            std::to_string(max_change_bytes) + " bytes");
            }

            return grpc::Status::OK;
        }

        static ::omega_edit::v1::TransformPluginOperation
        to_proto_transform_plugin_operation(omega_transform_plugin_operation_t operation) {
            switch (operation) {
                case OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE:
                    return ::omega_edit::v1::TRANSFORM_PLUGIN_OPERATION_REPLACE;
                case OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT:
                    return ::omega_edit::v1::TRANSFORM_PLUGIN_OPERATION_INSPECT;
                case OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT:
                    return ::omega_edit::v1::TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT;
                default:
                    return ::omega_edit::v1::TRANSFORM_PLUGIN_OPERATION_UNSPECIFIED;
            }
        }

        static void fill_transform_plugin_info(const omega_transform_plugin_info_t *info,
                                               ::omega_edit::v1::TransformPluginInfo *response) {
            if (!info || !response) { return; }
            response->set_id(info->id ? info->id : "");
            response->set_name(info->name ? info->name : "");
            response->set_description(info->description ? info->description : "");
            response->set_operation(to_proto_transform_plugin_operation(info->operation));
            response->set_flags(info->flags);
            response->set_abi_version(info->abi_version);
            response->set_help(info->help ? info->help : "");
            response->set_example(info->example ? info->example : "");
            response->set_default_args(info->default_args ? info->default_args : "");
            response->set_args_schema(info->args_schema ? info->args_schema : "");
        }

        static grpc::Status validate_viewport_range(int64_t offset, int64_t capacity) {
            if (offset < 0 || capacity <= 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "viewport offset must be non-negative and capacity must be positive");
            }
            if (capacity > OMEGA_VIEWPORT_CAPACITY_LIMIT || offset > (std::numeric_limits<int64_t>::max)() - capacity) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "viewport range is invalid or exceeds configured capacity limit");
            }
            return grpc::Status::OK;
        }

        EditorServiceImpl::EditorServiceImpl(HeartbeatConfig heartbeat_config, ResourceLimits resource_limits,
                                             std::function<void()> shutdown_callback,
                                             std::vector<std::string> transform_plugin_directories)
            : session_manager_(resource_limits), content_type_detector_(create_default_content_type_detector()),
              language_detector_(create_default_language_detector()),
              transform_plugin_registry_(omega_transform_plugin_registry_create()),
              start_time_(std::chrono::steady_clock::now()), heartbeat_config_(heartbeat_config),
              resource_limits_(resource_limits), shutdown_callback_(std::move(shutdown_callback)) {
            for (const auto &plugin_directory : transform_plugin_directories) {
                if (plugin_directory.empty()) { continue; }
                const auto loaded_count = omega_transform_plugin_registry_register_directory(transform_plugin_registry_,
                                                                                             plugin_directory.c_str());
                if (loaded_count < 0) {
                    std::cerr << "Warning: could not register transform plugin directory: " << plugin_directory << "\n";
                } else {
                    std::cerr << "Registered " << loaded_count << " transform plugin(s) from " << plugin_directory
                              << "\n";
                }
            }

            if (heartbeat_config_.session_timeout.count() > 0 && heartbeat_config_.cleanup_interval.count() > 0) {
                reaper_thread_ = std::thread(&EditorServiceImpl::reaper_loop, this);
            }
        }

        EditorServiceImpl::~EditorServiceImpl() {
            {
                std::lock_guard<std::mutex> lock(reaper_cv_mutex_);
                reaper_stop_ = true;
            }
            reaper_cv_.notify_all();
            if (reaper_thread_.joinable()) { reaper_thread_.join(); }
            session_manager_.destroy_all();
            omega_transform_plugin_registry_destroy(transform_plugin_registry_);
            transform_plugin_registry_ = nullptr;
        }

        void EditorServiceImpl::reaper_loop() {
            while (!reaper_stop_) {
                {
                    std::unique_lock<std::mutex> lock(reaper_cv_mutex_);
                    reaper_cv_.wait_for(lock, heartbeat_config_.cleanup_interval,
                                        [this] { return reaper_stop_.load(); });
                }
                if (reaper_stop_) break;

                auto idle_ids = session_manager_.get_idle_session_ids(heartbeat_config_.session_timeout);
                for (const auto &sid : idle_ids) { session_manager_.destroy_session(sid); }

                if (heartbeat_config_.shutdown_when_no_sessions && session_manager_.session_count() == 0 &&
                    !idle_ids.empty()) {
                    // We just reaped sessions and now there are none left
                    request_shutdown();
                    break;
                }
            }
        }

        bool EditorServiceImpl::parse_viewport_id(const std::string &fqid, std::string &session_id,
                                                  std::string &viewport_id) {
            auto pos = fqid.find(':');
            if (pos == std::string::npos) return false;
            session_id = fqid.substr(0, pos);
            viewport_id = fqid.substr(pos + 1);
            return !session_id.empty() && !viewport_id.empty();
        }

        std::string EditorServiceImpl::make_viewport_fqid(const std::string &session_id,
                                                          const std::string &viewport_id) {
            std::string fqid;
            fqid.reserve(session_id.size() + 1 + viewport_id.size());
            fqid.append(session_id);
            fqid.push_back(':');
            fqid.append(viewport_id);
            return fqid;
        }

        void EditorServiceImpl::request_shutdown() {
            if (!shutdown_callback_) { return; }

            std::call_once(shutdown_once_, [callback = shutdown_callback_]() {
                std::thread([callback]() {
                    // Let the active unary RPC return before the shutdown monitor calls
                    // grpc::Server::Shutdown(); Windows can otherwise strand the client
                    // call until an external cleanup kills the process.
                    std::this_thread::sleep_for(std::chrono::milliseconds(50));
                    callback();
                }).detach();
            });
        }

        template<typename T>
        void EditorServiceImpl::fill_change_details(const omega_change_t *change, const std::string &session_id,
                                                    T *response) {
            response->set_session_id(session_id);
            response->set_serial(omega_change_get_serial(change));

            char kind_char = omega_change_get_kind_as_char(change);
            switch (kind_char) {
                case 'D':
                    response->set_kind(::omega_edit::v1::CHANGE_KIND_DELETE);
                    break;
                case 'I':
                    response->set_kind(::omega_edit::v1::CHANGE_KIND_INSERT);
                    break;
                case 'O':
                    response->set_kind(::omega_edit::v1::CHANGE_KIND_OVERWRITE);
                    break;
                case 'T':
                    response->set_kind(::omega_edit::v1::CHANGE_KIND_TRANSFORM);
                    break;
                default:
                    response->set_kind(::omega_edit::v1::CHANGE_KIND_UNSPECIFIED);
                    break;
            }

            response->set_offset(omega_change_get_offset(change));
            response->set_length(omega_change_get_length(change));

            const auto *bytes = omega_change_get_bytes(change);
            if (bytes && omega_change_get_length(change) > 0) {
                response->set_data(bytes, static_cast<size_t>(omega_change_get_length(change)));
            }

            if (omega_change_is_transform(change)) {
                auto *transform = response->mutable_transform();
                if (const auto *transform_id = omega_change_get_transform_id(change)) {
                    transform->set_transform_id(transform_id);
                }
                if (const auto *options_json = omega_change_get_transform_options_json(change)) {
                    transform->set_options_json(options_json);
                }
                transform->set_replacement_length(omega_change_get_transform_replacement_length(change));
                transform->set_computed_file_size_before(omega_change_get_transform_computed_file_size_before(change));
                transform->set_computed_file_size_after(omega_change_get_transform_computed_file_size_after(change));
            }
        }

        template<typename T>
        grpc::Status EditorServiceImpl::fill_viewport_data(const std::string &session_id,
                                                           const std::string &viewport_id, const std::string &fqid,
                                                           T *response) {
            auto locked_viewport = session_manager_.lock_viewport(session_id, viewport_id);
            if (!locked_viewport) { return grpc::Status(grpc::StatusCode::NOT_FOUND, "viewport not found: " + fqid); }
            auto *vp = locked_viewport.viewport();
            const auto *data = omega_viewport_get_data(vp);
            auto length = omega_viewport_get_length(vp);

            response->set_viewport_id(fqid);
            response->set_offset(omega_viewport_get_offset(vp));
            response->set_length(length);
            if (data && length > 0) { response->set_data(data, static_cast<size_t>(length)); }
            response->set_following_byte_count(omega_viewport_get_following_byte_count(vp));
            return grpc::Status::OK;
        }

        // ---------- Server Info ----------

        grpc::Status EditorServiceImpl::GetServerInfo(grpc::ServerContext * /*context*/,
                                                      const ::omega_edit::v1::GetServerInfoRequest * /*request*/,
                                                      ::omega_edit::v1::GetServerInfoResponse *response) {
            response->set_hostname(get_hostname());
            response->set_process_id(get_pid());
            response->set_server_version(SERVER_VERSION);
            response->set_runtime_kind(get_runtime_kind());
            response->set_runtime_name(get_runtime_name());
            response->set_platform(get_platform_summary());
            response->set_available_processors(get_cpu_count());
            response->set_compiler(get_compiler_info());
            response->set_build_type(get_build_type());
            response->set_cpp_standard(get_cpp_standard());
            return grpc::Status::OK;
        }

        // ---------- Session Lifecycle ----------

        grpc::Status EditorServiceImpl::CreateSession(grpc::ServerContext * /*context*/,
                                                      const ::omega_edit::v1::CreateSessionRequest *request,
                                                      ::omega_edit::v1::CreateSessionResponse *response) {
            if (graceful_shutdown_.load()) {
                return grpc::Status(grpc::StatusCode::UNAVAILABLE, "server is shutting down");
            }

            std::string file_path;
            if (request->has_file_path()) { file_path = request->file_path(); }
            const auto file_path_status = validate_path_argument(file_path, "file_path");
            if (!file_path_status.ok()) { return file_path_status; }

            const auto has_initial_data = request->has_initial_data();
            if (!file_path.empty() && has_initial_data) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "create session accepts either file_path or initial_data, not both");
            }

            // Validate file path exists if provided (match previous server behavior)
            if (!file_path.empty()) {
                std::error_code ec;
                if (!std::filesystem::exists(file_path, ec) || ec) {
                    return grpc::Status(grpc::StatusCode::INTERNAL,
                                        std::string("Failed to create session: file does not exist: ") + file_path);
                }
            }

            std::string desired_id;
            if (request->has_session_id_desired()) { desired_id = request->session_id_desired(); }

            std::string checkpoint_dir;
            if (request->has_checkpoint_directory()) { checkpoint_dir = request->checkpoint_directory(); }
            const auto checkpoint_dir_status = validate_path_argument(checkpoint_dir, "checkpoint_directory");
            if (!checkpoint_dir_status.ok()) { return checkpoint_dir_status; }

            int64_t file_size = 0;
            std::string checkpoint_dir_out;
            std::string session_id;
            SessionCreateError create_error = SessionCreateError::SUCCESS;
            std::string initial_data;
            if (has_initial_data) { initial_data = request->initial_data(); }
            const std::string *initial_data_ptr = has_initial_data ? &initial_data : nullptr;
            try {
                session_id = session_manager_.create_session(file_path, desired_id, checkpoint_dir, initial_data_ptr,
                                                             file_size, checkpoint_dir_out, &create_error);
            } catch (const std::exception &e) {
                return grpc::Status(grpc::StatusCode::INTERNAL, std::string("Failed to create session: ") + e.what());
            }

            if (session_id.empty()) {
                switch (create_error) {
                    case SessionCreateError::INVALID_ID:
                        return grpc::Status(
                                grpc::StatusCode::INVALID_ARGUMENT,
                                "session id must be 1-128 bytes and contain only letters, digits, '_', '.', or '-'");
                    case SessionCreateError::INVALID_FILE_PATH:
                        return grpc::Status(
                                grpc::StatusCode::INVALID_ARGUMENT,
                                "file_path must be shorter than FILENAME_MAX and contain no NUL or control characters");
                    case SessionCreateError::INVALID_CHECKPOINT_DIRECTORY:
                        return grpc::Status(
                                grpc::StatusCode::INVALID_ARGUMENT,
                                "checkpoint_directory must be shorter than FILENAME_MAX and contain no NUL or "
                                "control characters");
                    case SessionCreateError::ALREADY_EXISTS:
                        return grpc::Status(grpc::StatusCode::ALREADY_EXISTS, "session already exists: " + desired_id);
                    default:
                        return grpc::Status(grpc::StatusCode::INTERNAL, "Failed to create session");
                }
            }

            response->set_session_id(session_id);
            response->set_checkpoint_directory(checkpoint_dir_out);
            if (!file_path.empty() || has_initial_data) { response->set_file_size(file_size); }
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::SaveSession(grpc::ServerContext * /*context*/,
                                                    const ::omega_edit::v1::SaveSessionRequest *request,
                                                    ::omega_edit::v1::SaveSessionResponse *response) {
            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            char saved_file_path[FILENAME_MAX] = {};
            int64_t offset = request->has_offset() ? request->offset() : 0;
            int64_t length = request->has_length() ? request->length() : 0;

            int result;
            if (offset != 0 || length != 0) {
                result = omega_edit_save_segment(session, request->file_path().c_str(), request->io_flags(),
                                                 saved_file_path, offset, length);
            } else {
                result = omega_edit_save(session, request->file_path().c_str(), request->io_flags(), saved_file_path);
            }

            response->set_session_id(request->session_id());
            response->set_save_status(result);
            if (result == 0) {
                // Only set file_path on success
                std::string actual_path =
                        (saved_file_path[0] != '\0') ? std::string(saved_file_path) : request->file_path();
                response->set_file_path(actual_path);
            }
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::DestroySession(grpc::ServerContext * /*context*/,
                                                       const ::omega_edit::v1::DestroySessionRequest *request,
                                                       ::omega_edit::v1::DestroySessionResponse *response) {
            if (!session_manager_.detach_session(request->id())) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            response->set_id(request->id());

            // If graceful shutdown is pending and no sessions remain, trigger shutdown
            if (graceful_shutdown_.load() && session_manager_.session_count() == 0) { request_shutdown(); }

            return grpc::Status::OK;
        }

        // ---------- Edit Operations ----------

        grpc::Status EditorServiceImpl::SubmitChange(grpc::ServerContext * /*context*/,
                                                     const ::omega_edit::v1::SubmitChangeRequest *request,
                                                     ::omega_edit::v1::SubmitChangeResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->session_id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "change", request->session_id());
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            const grpc::Status payload_status =
                    validate_change_payload_size(request, resource_limits_.max_change_bytes);
            if (!payload_status.ok()) { return payload_status; }

            if (request->offset() < 0 || request->length() < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "invalid change arguments");
            }

            int64_t serial = 0;
            switch (request->kind()) {
                case ::omega_edit::v1::CHANGE_KIND_DELETE:
                    serial = omega_edit_delete(session, request->offset(), request->length());
                    break;
                case ::omega_edit::v1::CHANGE_KIND_INSERT:
                    if (request->has_data()) {
                        serial = omega_edit_insert_bytes(session, request->offset(),
                                                         reinterpret_cast<const omega_byte_t *>(request->data().data()),
                                                         static_cast<int64_t>(request->data().size()));
                    } else {
                        serial = omega_edit_insert_bytes(session, request->offset(), nullptr, 0);
                    }
                    break;
                case ::omega_edit::v1::CHANGE_KIND_OVERWRITE:
                    if (request->has_data()) {
                        serial = omega_edit_overwrite_bytes(
                                session, request->offset(),
                                reinterpret_cast<const omega_byte_t *>(request->data().data()),
                                static_cast<int64_t>(request->data().size()));
                    } else {
                        serial = omega_edit_overwrite_bytes(session, request->offset(), nullptr, 0);
                    }
                    break;
                default:
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "undefined change kind");
            }

            if (serial < 0) { return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "invalid change arguments"); }

            if (serial == 0) { return grpc::Status(grpc::StatusCode::UNKNOWN, "change operation failed"); }

            response->set_session_id(request->session_id());
            response->set_serial(serial);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::UndoLastChange(grpc::ServerContext * /*context*/,
                                                       const ::omega_edit::v1::UndoLastChangeRequest *request,
                                                       ::omega_edit::v1::UndoLastChangeResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "undo", request->id());
            }

            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            int64_t serial = omega_edit_undo_last_change(session);
            if (serial == 0) { return grpc::Status(grpc::StatusCode::UNKNOWN, "undo failed or nothing to undo"); }

            response->set_session_id(request->id());
            response->set_serial(serial);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::RedoLastUndo(grpc::ServerContext * /*context*/,
                                                     const ::omega_edit::v1::RedoLastUndoRequest *request,
                                                     ::omega_edit::v1::RedoLastUndoResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "redo", request->id());
            }

            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            int64_t serial = omega_edit_redo_last_undo(session);
            if (serial == 0) { return grpc::Status(grpc::StatusCode::UNKNOWN, "redo failed or nothing to redo"); }

            response->set_session_id(request->id());
            response->set_serial(serial);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::ClearChanges(grpc::ServerContext * /*context*/,
                                                     const ::omega_edit::v1::ClearChangesRequest *request,
                                                     ::omega_edit::v1::ClearChangesResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "clear changes", request->id());
            }

            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            int result = omega_edit_clear_changes(session);
            if (result != 0) { return grpc::Status(grpc::StatusCode::UNKNOWN, "clear changes failed"); }

            response->set_id(request->id());
            return grpc::Status::OK;
        }

        // ---------- Session Control ----------

        grpc::Status EditorServiceImpl::PauseSessionChanges(grpc::ServerContext * /*context*/,
                                                            const ::omega_edit::v1::PauseSessionChangesRequest *request,
                                                            ::omega_edit::v1::PauseSessionChangesResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "pause changes", request->id());
            }

            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            omega_session_pause_changes(session);
            response->set_id(request->id());
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::ResumeSessionChanges(grpc::ServerContext * /*context*/,
                                                const ::omega_edit::v1::ResumeSessionChangesRequest *request,
                                                ::omega_edit::v1::ResumeSessionChangesResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "resume changes", request->id());
            }

            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            omega_session_resume_changes(session);
            response->set_id(request->id());
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::PauseViewportEvents(grpc::ServerContext * /*context*/,
                                                            const ::omega_edit::v1::PauseViewportEventsRequest *request,
                                                            ::omega_edit::v1::PauseViewportEventsResponse *response) {
            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            omega_session_pause_viewport_event_callbacks(session);
            response->set_id(request->id());
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::ResumeViewportEvents(grpc::ServerContext * /*context*/,
                                                const ::omega_edit::v1::ResumeViewportEventsRequest *request,
                                                ::omega_edit::v1::ResumeViewportEventsResponse *response) {
            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            omega_session_resume_viewport_event_callbacks(session);
            response->set_id(request->id());
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::SessionBeginTransaction(grpc::ServerContext * /*context*/,
                                                   const ::omega_edit::v1::SessionBeginTransactionRequest *request,
                                                   ::omega_edit::v1::SessionBeginTransactionResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "begin transaction", request->id());
            }

            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            // Tolerate nested begin-transaction calls (no-op if already in a transaction)
            // to match the server behaviour used by the TypeScript client's
            // replace helper which wraps delete+insert in a transaction even when an
            // outer transaction is already open.
            omega_session_begin_transaction(session);

            response->set_id(request->id());
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::SessionEndTransaction(grpc::ServerContext * /*context*/,
                                                 const ::omega_edit::v1::SessionEndTransactionRequest *request,
                                                 ::omega_edit::v1::SessionEndTransactionResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "end transaction", request->id());
            }

            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            // Tolerate end-transaction when no transaction is open (no-op).
            omega_session_end_transaction(session);

            response->set_id(request->id());
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::NotifyChangedViewports(grpc::ServerContext * /*context*/,
                                                  const ::omega_edit::v1::NotifyChangedViewportsRequest *request,
                                                  ::omega_edit::v1::NotifyChangedViewportsResponse *response) {
            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            int count = omega_session_notify_changed_viewports(session);
            response->set_count(count);
            return grpc::Status::OK;
        }

        // ---------- Viewport Operations ----------

        grpc::Status EditorServiceImpl::CreateViewport(grpc::ServerContext * /*context*/,
                                                       const ::omega_edit::v1::CreateViewportRequest *request,
                                                       ::omega_edit::v1::CreateViewportResponse *response) {
            auto viewport_status = validate_viewport_range(request->offset(), request->capacity());
            if (!viewport_status.ok()) { return viewport_status; }

            std::string desired_vp_id;
            if (request->has_viewport_id_desired()) { desired_vp_id = request->viewport_id_desired(); }

            ViewportCreateError vp_error = ViewportCreateError::SUCCESS;
            std::string fqid =
                    session_manager_.create_viewport(request->session_id(), request->offset(), request->capacity(),
                                                     request->is_floating(), desired_vp_id, &vp_error);
            if (fqid.empty()) {
                switch (vp_error) {
                    case ViewportCreateError::SESSION_NOT_FOUND:
                        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
                    case ViewportCreateError::INVALID_VIEWPORT_ID:
                        return grpc::Status(
                                grpc::StatusCode::INVALID_ARGUMENT,
                                "viewport id must be 1-128 bytes and contain only letters, digits, '_', '.', or '-'");
                    case ViewportCreateError::DUPLICATE_VIEWPORT_ID:
                        return grpc::Status(grpc::StatusCode::ALREADY_EXISTS,
                                            "viewport already exists: " + desired_vp_id);
                    case ViewportCreateError::TOO_MANY_VIEWPORTS:
                        return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                            "session reached configured viewport limit of " +
                                                    std::to_string(resource_limits_.max_viewports_per_session));
                    default:
                        return grpc::Status(grpc::StatusCode::INTERNAL, "failed to create viewport");
                }
            }

            std::string sid, vid;
            if (!parse_viewport_id(fqid, sid, vid)) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "malformed viewport id: " + fqid);
            }

            session_manager_.touch_session(request->session_id());
            return fill_viewport_data(sid, vid, fqid, response);
        }

        grpc::Status EditorServiceImpl::ModifyViewport(grpc::ServerContext * /*context*/,
                                                       const ::omega_edit::v1::ModifyViewportRequest *request,
                                                       ::omega_edit::v1::ModifyViewportResponse *response) {
            auto viewport_status = validate_viewport_range(request->offset(), request->capacity());
            if (!viewport_status.ok()) { return viewport_status; }

            std::string sid, vid;
            if (!parse_viewport_id(request->viewport_id(), sid, vid)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "malformed viewport id: " + request->viewport_id());
            }

            auto locked_viewport = session_manager_.lock_viewport(sid, vid);
            if (!locked_viewport) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "viewport not found: " + request->viewport_id());
            }
            auto *vp = locked_viewport.viewport();

            int result =
                    omega_viewport_modify(vp, request->offset(), request->capacity(), request->is_floating() ? 1 : 0);
            if (result != 0) { return grpc::Status(grpc::StatusCode::UNKNOWN, "modify viewport failed"); }

            // Keep the existing core lock while returning the refreshed viewport data. Calling fill_viewport_data here would
            // attempt to acquire the same per-session lock again.
            const auto *data = omega_viewport_get_data(vp);
            auto length = omega_viewport_get_length(vp);
            response->set_viewport_id(request->viewport_id());
            response->set_offset(omega_viewport_get_offset(vp));
            response->set_length(length);
            if (data && length > 0) { response->set_data(data, static_cast<size_t>(length)); }
            response->set_following_byte_count(omega_viewport_get_following_byte_count(vp));
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::ViewportHasChanges(grpc::ServerContext * /*context*/,
                                                           const ::omega_edit::v1::ViewportHasChangesRequest *request,
                                                           ::omega_edit::v1::ViewportHasChangesResponse *response) {
            std::string sid, vid;
            if (!parse_viewport_id(request->id(), sid, vid)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "malformed viewport id: " + request->id());
            }

            auto locked_viewport = session_manager_.lock_viewport(sid, vid);
            if (!locked_viewport) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "viewport not found: " + request->id());
            }
            auto *vp = locked_viewport.viewport();

            response->set_result(omega_viewport_has_changes(vp) != 0);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::GetViewportData(grpc::ServerContext * /*context*/,
                                                        const ::omega_edit::v1::GetViewportDataRequest *request,
                                                        ::omega_edit::v1::GetViewportDataResponse *response) {
            std::string sid, vid;
            if (!parse_viewport_id(request->viewport_id(), sid, vid)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "malformed viewport id: " + request->viewport_id());
            }

            return fill_viewport_data(sid, vid, request->viewport_id(), response);
        }

        grpc::Status EditorServiceImpl::DestroyViewport(grpc::ServerContext * /*context*/,
                                                        const ::omega_edit::v1::DestroyViewportRequest *request,
                                                        ::omega_edit::v1::DestroyViewportResponse *response) {
            std::string sid, vid;
            if (!parse_viewport_id(request->id(), sid, vid)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "malformed viewport id: " + request->id());
            }

            if (!session_manager_.destroy_viewport(sid, vid)) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "viewport not found: " + request->id());
            }

            response->set_id(request->id());
            return grpc::Status::OK;
        }

        // ---------- Change Details ----------

        grpc::Status EditorServiceImpl::GetChangeDetails(grpc::ServerContext * /*context*/,
                                                         const ::omega_edit::v1::GetChangeDetailsRequest *request,
                                                         ::omega_edit::v1::GetChangeDetailsResponse *response) {
            if (!request->has_serial()) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "change serial id required");
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            const auto *change = omega_session_get_change(session, request->serial());
            if (!change) { return grpc::Status(grpc::StatusCode::NOT_FOUND, "change not found"); }

            fill_change_details(change, request->session_id(), response);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::GetLastChange(grpc::ServerContext * /*context*/,
                                                      const ::omega_edit::v1::GetLastChangeRequest *request,
                                                      ::omega_edit::v1::GetLastChangeResponse *response) {
            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            const auto *change = omega_session_get_last_change(session);
            if (!change) { return grpc::Status(grpc::StatusCode::UNKNOWN, "no changes available"); }

            fill_change_details(change, request->id(), response);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::GetLastUndo(grpc::ServerContext * /*context*/,
                                                    const ::omega_edit::v1::GetLastUndoRequest *request,
                                                    ::omega_edit::v1::GetLastUndoResponse *response) {
            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            const auto *change = omega_session_get_last_undo(session);
            if (!change) { return grpc::Status(grpc::StatusCode::UNKNOWN, "no undone changes available"); }

            fill_change_details(change, request->id(), response);
            return grpc::Status::OK;
        }

        // ---------- Computed File Size ----------

        grpc::Status EditorServiceImpl::GetComputedFileSize(grpc::ServerContext * /*context*/,
                                                            const ::omega_edit::v1::GetComputedFileSizeRequest *request,
                                                            ::omega_edit::v1::GetComputedFileSizeResponse *response) {
            auto locked_session = session_manager_.lock_session(request->id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
            }
            auto *session = locked_session.session();

            const auto computed_file_size = omega_session_get_computed_file_size(session);
            if (computed_file_size < 0) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "computed file size overflow");
            }
            response->set_session_id(request->id());
            response->set_computed_file_size(computed_file_size);
            return grpc::Status::OK;
        }

        // ---------- BOM / Content Type / Language ----------

        grpc::Status EditorServiceImpl::GetByteOrderMark(grpc::ServerContext * /*context*/,
                                                         const ::omega_edit::v1::GetByteOrderMarkRequest *request,
                                                         ::omega_edit::v1::GetByteOrderMarkResponse *response) {
            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            omega_bom_t bom = omega_session_detect_BOM(session, request->offset());
            const char *bom_str = omega_util_BOM_to_cstring(bom);
            auto bom_size = static_cast<int64_t>(omega_util_BOM_size(bom));

            response->set_session_id(request->session_id());
            response->set_offset(request->offset());
            response->set_length(bom_size);
            response->set_byte_order_mark(bom_str);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::GetContentType(grpc::ServerContext * /*context*/,
                                                       const ::omega_edit::v1::GetContentTypeRequest *request,
                                                       ::omega_edit::v1::GetContentTypeResponse *response) {
            if (request->offset() < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "offset must be non-negative");
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            if (request->length() <= 0) {
                response->set_session_id(request->session_id());
                response->set_offset(request->offset());
                response->set_length(0);
                response->set_content_type("application/octet-stream");
                return grpc::Status::OK;
            }
            auto segment = std::unique_ptr<omega_segment_t, decltype(&omega_segment_destroy)>(
                    omega_segment_create(request->length()), omega_segment_destroy);
            if (!segment) { return grpc::Status(grpc::StatusCode::INTERNAL, "failed to allocate segment"); }

            int result = omega_session_get_segment(session, segment.get(), request->offset());
            std::string content_type;
            int64_t actual_length = 0;
            if (result == 0) {
                auto *data = omega_segment_get_data(segment.get());
                actual_length = omega_segment_get_length(segment.get());
                content_type =
                        content_type_detector_->detect(data, actual_length, locked_session.info->canonical_file_path);
            } else {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "couldn't get segment");
            }

            response->set_session_id(request->session_id());
            response->set_offset(request->offset());
            response->set_length(actual_length);
            response->set_content_type(content_type);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::GetLanguage(grpc::ServerContext * /*context*/,
                                                    const ::omega_edit::v1::GetLanguageRequest *request,
                                                    ::omega_edit::v1::GetLanguageResponse *response) {
            if (request->offset() < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "offset must be non-negative");
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            if (request->length() <= 0) {
                response->set_session_id(request->session_id());
                response->set_offset(request->offset());
                response->set_length(0);
                response->set_language("unknown");
                return grpc::Status::OK;
            }
            auto segment = std::unique_ptr<omega_segment_t, decltype(&omega_segment_destroy)>(
                    omega_segment_create(request->length()), omega_segment_destroy);
            if (!segment) { return grpc::Status(grpc::StatusCode::INTERNAL, "failed to allocate segment"); }

            int result = omega_session_get_segment(session, segment.get(), request->offset());
            std::string language;
            int64_t actual_length = 0;
            if (result == 0) {
                auto *data = omega_segment_get_data(segment.get());
                actual_length = omega_segment_get_length(segment.get());
                std::string bom_str = request->byte_order_mark();
                language = language_detector_->detect(data, actual_length, bom_str);
            } else {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "couldn't get segment");
            }

            response->set_session_id(request->session_id());
            response->set_offset(request->offset());
            response->set_length(actual_length);
            response->set_language(language);
            return grpc::Status::OK;
        }

        // ---------- Counts ----------

        grpc::Status EditorServiceImpl::GetCount(grpc::ServerContext * /*context*/,
                                                 const ::omega_edit::v1::GetCountRequest *request,
                                                 ::omega_edit::v1::GetCountResponse *response) {
            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            response->set_session_id(request->session_id());

            for (int i = 0; i < request->kind_size(); ++i) {
                auto kind = request->kind(i);
                int64_t count_value = 0;
                switch (kind) {
                    case ::omega_edit::v1::COUNT_KIND_COMPUTED_FILE_SIZE:
                        count_value = omega_session_get_computed_file_size(session);
                        if (count_value < 0) {
                            return grpc::Status(grpc::StatusCode::INTERNAL, "computed file size overflow");
                        }
                        break;
                    case ::omega_edit::v1::COUNT_KIND_CHANGES:
                        count_value = omega_session_get_num_changes(session);
                        break;
                    case ::omega_edit::v1::COUNT_KIND_UNDOS:
                        count_value = omega_session_get_num_undone_changes(session);
                        break;
                    case ::omega_edit::v1::COUNT_KIND_VIEWPORTS:
                        count_value = omega_session_get_num_viewports(session);
                        break;
                    case ::omega_edit::v1::COUNT_KIND_CHECKPOINTS:
                        count_value = omega_session_get_num_checkpoints(session);
                        break;
                    case ::omega_edit::v1::COUNT_KIND_SEARCH_CONTEXTS:
                        count_value = omega_session_get_num_search_contexts(session);
                        break;
                    case ::omega_edit::v1::COUNT_KIND_CHANGE_TRANSACTIONS:
                        count_value = omega_session_get_num_change_transactions(session);
                        break;
                    case ::omega_edit::v1::COUNT_KIND_UNDO_TRANSACTIONS:
                        count_value = omega_session_get_num_undone_change_transactions(session);
                        break;
                    default:
                        return grpc::Status(grpc::StatusCode::UNKNOWN, "undefined count kind");
                }
                auto *single = response->add_counts();
                single->set_kind(kind);
                single->set_count(count_value);
            }

            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::CheckSessionModel(grpc::ServerContext * /*context*/,
                                                          const ::omega_edit::v1::CheckSessionModelRequest *request,
                                                          ::omega_edit::v1::CheckSessionModelResponse *response) {
            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }

            const auto status = omega_check_model(locked_session.session());
            response->set_session_id(request->session_id());
            response->set_valid(status == 0);
            response->set_status(status);
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::GetSessionFingerprint(grpc::ServerContext * /*context*/,
                                                 const ::omega_edit::v1::GetSessionFingerprintRequest *request,
                                                 ::omega_edit::v1::GetSessionFingerprintResponse *response) {
            const auto content = request->content();
            if (content != ::omega_edit::v1::SESSION_FINGERPRINT_CONTENT_ORIGINAL &&
                content != ::omega_edit::v1::SESSION_FINGERPRINT_CONTENT_COMPUTED) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "fingerprint content must be original or computed");
            }

            auto algorithm = normalize_digest_algorithm(request->has_algorithm() ? request->algorithm() : "");
            if (!digest_algorithm_is_json_safe(algorithm)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "unsupported fingerprint digest algorithm: " + algorithm);
            }
            const auto options_json = make_digest_options_json(algorithm);

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            const auto byte_length = get_session_fingerprint_byte_length(session, content);
            if (byte_length < 0) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "session content length unavailable for fingerprint");
            }

            transform_plugin_response_guard plugin_response;
            {
                std::lock_guard<std::mutex> plugin_lock(transform_plugin_mutex_);
                const auto *plugin_info = omega_transform_plugin_registry_find_info(
                        transform_plugin_registry_, SESSION_FINGERPRINT_DIGEST_PLUGIN_ID);
                if (!plugin_info) {
                    return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION,
                                        "session fingerprint digest plugin is not registered: " +
                                                std::string(SESSION_FINGERPRINT_DIGEST_PLUGIN_ID));
                }
                if (plugin_info->operation != OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT ||
                    (plugin_info->flags & OMEGA_TRANSFORM_PLUGIN_FLAG_STREAMING) == 0U) {
                    return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION,
                                        "session fingerprint digest plugin must be a streaming inspect plugin");
                }
                if (0 !=
                    omega_transform_plugin_options_match_args_schema(options_json.c_str(), plugin_info->args_schema)) {
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                        "unsupported fingerprint digest algorithm: " + algorithm);
                }

                session_fingerprint_reader reader{session, content, byte_length};
                if (0 != omega_transform_plugin_registry_inspect_reader(
                                 transform_plugin_registry_, SESSION_FINGERPRINT_DIGEST_PLUGIN_ID, 0, byte_length,
                                 options_json.c_str(), omega_session_get_checkpoint_directory(session),
                                 read_session_fingerprint_chunk, &reader, SESSION_FINGERPRINT_CHUNK_SIZE, nullptr,
                                 nullptr, &plugin_response.response)) {
                    return grpc::Status(grpc::StatusCode::INTERNAL,
                                        "session fingerprint digest plugin failed: " +
                                                std::string(SESSION_FINGERPRINT_DIGEST_PLUGIN_ID));
                }
            }

            if (plugin_response.response.result_length <= 0 || plugin_response.response.result_bytes == nullptr) {
                return grpc::Status(grpc::StatusCode::INTERNAL,
                                    "session fingerprint digest plugin returned an empty digest");
            }

            std::string digest_value(reinterpret_cast<const char *>(plugin_response.response.result_bytes),
                                     static_cast<size_t>(plugin_response.response.result_length));
            if (plugin_response.response.result_label && *plugin_response.response.result_label) {
                algorithm = normalize_digest_algorithm(plugin_response.response.result_label);
            }

            response->set_session_id(request->session_id());
            response->set_content(content);
            auto *fingerprint = response->mutable_fingerprint();
            fingerprint->set_byte_length(byte_length);
            auto *digest_response = fingerprint->mutable_digest();
            digest_response->set_algorithm(algorithm);
            digest_response->set_value(digest_value);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::GetSessionCount(grpc::ServerContext * /*context*/,
                                                        const ::omega_edit::v1::GetSessionCountRequest * /*request*/,
                                                        ::omega_edit::v1::GetSessionCountResponse *response) {
            response->set_count(session_manager_.session_count());
            return grpc::Status::OK;
        }

        // ---------- Segment ----------

        grpc::Status EditorServiceImpl::GetSegment(grpc::ServerContext * /*context*/,
                                                   const ::omega_edit::v1::GetSegmentRequest *request,
                                                   ::omega_edit::v1::GetSegmentResponse *response) {
            if (request->offset() < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "offset must be non-negative");
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            if (request->length() <= 0) {
                response->set_session_id(request->session_id());
                response->set_offset(request->offset());
                return grpc::Status::OK;
            }
            auto *segment = omega_segment_create(request->length());
            if (!segment) { return grpc::Status(grpc::StatusCode::INTERNAL, "failed to allocate segment"); }

            int result = omega_session_get_segment(session, segment, request->offset());
            if (result != 0) {
                omega_segment_destroy(segment);
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "couldn't find segment");
            }

            auto *data = omega_segment_get_data(segment);
            auto segment_length = omega_segment_get_length(segment);

            response->set_session_id(request->session_id());
            response->set_offset(omega_segment_get_offset(segment));
            if (data && segment_length > 0) { response->set_data(data, static_cast<size_t>(segment_length)); }

            omega_segment_destroy(segment);
            return grpc::Status::OK;
        }

        // ---------- Search ----------

        grpc::Status EditorServiceImpl::SearchSession(grpc::ServerContext * /*context*/,
                                                      const ::omega_edit::v1::SearchSessionRequest *request,
                                                      ::omega_edit::v1::SearchSessionResponse *response) {
            bool case_insensitive = request->has_is_case_insensitive() ? request->is_case_insensitive() : false;
            bool is_reverse = request->has_is_reverse() ? request->is_reverse() : false;
            int64_t offset = request->has_offset() ? request->offset() : 0;
            int64_t length = request->has_length() ? request->length() : 0;
            int64_t limit = request->has_limit() ? request->limit() : 0;// 0 = no limit
            std::vector<int64_t> match_offsets;

            {
                auto locked_session = session_manager_.lock_session(request->session_id());
                if (!locked_session) {
                    return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
                }
                auto *session = locked_session.session();

                auto *ctx = omega_search_create_context_bytes(
                        session, reinterpret_cast<const omega_byte_t *>(request->pattern().data()),
                        static_cast<int64_t>(request->pattern().size()), offset, length, case_insensitive ? 1 : 0,
                        is_reverse ? 1 : 0);

                if (ctx) {
                    int64_t num_matches = 0;
                    while ((limit <= 0 || num_matches < limit) && omega_search_next_match(ctx, 1) > 0) {
                        match_offsets.push_back(omega_search_context_get_match_offset(ctx));
                        ++num_matches;
                    }
                    omega_search_destroy_context(ctx);
                }
            }

            response->set_session_id(request->session_id());
            response->set_pattern(request->pattern());
            response->set_is_case_insensitive(case_insensitive);
            response->set_is_reverse(is_reverse);
            response->set_offset(offset);
            response->set_length(length);
            for (const auto match_offset : match_offsets) { response->add_match_offset(match_offset); }

            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::ReplaceSession(grpc::ServerContext * /*context*/,
                                                       const ::omega_edit::v1::ReplaceSessionRequest *request,
                                                       ::omega_edit::v1::ReplaceSessionResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->session_id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "replace", request->session_id());
            }
            // Session operation guard held intentionally: validation runs without holding core_mutex to avoid blocking other
            // handlers during potentially long payload and size checks, while still preventing transforms from starting until
            // the mutation attempt has completed.

            const bool case_insensitive = request->has_is_case_insensitive() ? request->is_case_insensitive() : false;
            const bool is_reverse = request->has_is_reverse() ? request->is_reverse() : false;
            const int64_t offset = request->has_offset() ? request->offset() : 0;
            const int64_t length = request->has_length() ? request->length() : 0;
            const int64_t limit = request->has_limit() ? request->limit() : 0;
            const bool front_to_back = request->has_front_to_back() ? request->front_to_back() : true;
            const bool overwrite_only = request->has_overwrite_only() ? request->overwrite_only() : false;

            if (offset < 0 || length < 0 || limit < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "replace offset, length, and limit must be non-negative");
            }

            const auto payload_status = validate_replace_payload_sizes(request->pattern(), request->replacement(),
                                                                       resource_limits_.max_change_bytes, "replace");
            if (!payload_status.ok()) { return payload_status; }

            response->set_session_id(request->session_id());
            response->set_pattern(request->pattern());
            response->set_replacement(request->replacement());
            response->set_is_case_insensitive(case_insensitive);
            response->set_is_reverse(is_reverse);
            response->set_offset(offset);
            response->set_length(length);
            response->set_limit(limit);
            response->set_front_to_back(front_to_back);
            response->set_overwrite_only(overwrite_only);

            if (request->pattern().empty()) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "replace pattern must not be empty for session: " + request->session_id());
            }

            int64_t replacement_count = 0;
            int64_t delete_count = 0;
            int64_t insert_count = 0;
            int64_t overwrite_count = 0;

            {
                auto locked_session = session_manager_.lock_session(request->session_id());
                if (!locked_session) {
                    return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
                }
                auto *session = locked_session.session();

                const auto session_size = omega_session_get_computed_file_size(session);
                if (session_size < 0) {
                    return grpc::Status(grpc::StatusCode::INTERNAL,
                                        "failed to compute session size for session: " + request->session_id());
                }
                if (offset > session_size) {
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                        "replace offset " + std::to_string(offset) + " exceeds session size " +
                                                std::to_string(session_size) +
                                                " for session: " + request->session_id());
                }

                if (omega_session_changes_paused(session) != 0) {
                    return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION,
                                        "replace requires active session changes for session: " +
                                                request->session_id());
                }

                const auto rc = omega_edit_replace_matches_bytes(
                        session, reinterpret_cast<const omega_byte_t *>(request->pattern().data()),
                        static_cast<int64_t>(request->pattern().size()),
                        reinterpret_cast<const omega_byte_t *>(request->replacement().data()),
                        static_cast<int64_t>(request->replacement().size()), case_insensitive ? 1 : 0,
                        is_reverse ? 1 : 0, offset, length, limit, front_to_back ? 1 : 0, overwrite_only ? 1 : 0,
                        &replacement_count, &delete_count, &insert_count, &overwrite_count);
                if (rc != 0) {
                    return grpc::Status(grpc::StatusCode::INTERNAL,
                                        "replace failed for session: " + request->session_id());
                }
            }

            response->set_replacement_count(replacement_count);
            response->set_delete_count(delete_count);
            response->set_insert_count(insert_count);
            response->set_overwrite_count(overwrite_count);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::ReplaceSessionCheckpointed(
                grpc::ServerContext * /*context*/, const ::omega_edit::v1::ReplaceSessionCheckpointedRequest *request,
                ::omega_edit::v1::ReplaceSessionCheckpointedResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->session_id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "checkpointed replace",
                                                          request->session_id());
            }
            // Session operation guard held intentionally: validation runs without holding core_mutex to avoid blocking other
            // handlers during potentially long payload and size checks, while still preventing transforms from starting until
            // the mutation attempt has completed.

            const bool case_insensitive = request->has_is_case_insensitive() ? request->is_case_insensitive() : false;
            const int64_t offset = request->has_offset() ? request->offset() : 0;
            const int64_t length = request->has_length() ? request->length() : 0;

            if (offset < 0 || length < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "checkpointed replace offset and length must be non-negative");
            }

            const auto payload_status =
                    validate_replace_checkpointed_payload_sizes(request, resource_limits_.max_change_bytes);
            if (!payload_status.ok()) { return payload_status; }

            int64_t replacement_count = 0;
            {
                auto locked_session = session_manager_.lock_session(request->session_id());
                if (!locked_session) {
                    return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
                }
                auto *session = locked_session.session();

                const auto session_size = omega_session_get_computed_file_size(session);
                if (session_size < 0) {
                    return grpc::Status(grpc::StatusCode::INTERNAL,
                                        "failed to compute session size for session: " + request->session_id());
                }
                if (offset > session_size) {
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                        "checkpointed replace offset " + std::to_string(offset) +
                                                " exceeds session size " + std::to_string(session_size) +
                                                " for session: " + request->session_id());
                }

                if (request->pattern().empty()) {
                    response->set_session_id(request->session_id());
                    response->set_pattern(request->pattern());
                    response->set_replacement(request->replacement());
                    response->set_is_case_insensitive(case_insensitive);
                    response->set_offset(offset);
                    response->set_length(length);
                    response->set_replacement_count(0);
                    return grpc::Status::OK;
                }

                if (omega_session_changes_paused(session) != 0) {
                    return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION,
                                        "checkpointed replace requires active session changes for session: " +
                                                request->session_id());
                }

                const auto rc = omega_edit_replace_all_bytes(
                        session, reinterpret_cast<const omega_byte_t *>(request->pattern().data()),
                        static_cast<int64_t>(request->pattern().size()),
                        reinterpret_cast<const omega_byte_t *>(request->replacement().data()),
                        static_cast<int64_t>(request->replacement().size()), case_insensitive ? 1 : 0, offset, length,
                        &replacement_count);
                if (rc != 0) {
                    return grpc::Status(grpc::StatusCode::INTERNAL,
                                        "checkpointed replace failed for session: " + request->session_id());
                }
            }

            response->set_session_id(request->session_id());
            response->set_pattern(request->pattern());
            response->set_replacement(request->replacement());
            response->set_is_case_insensitive(case_insensitive);
            response->set_offset(offset);
            response->set_length(length);
            response->set_replacement_count(replacement_count);
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::DestroyLastCheckpoint(grpc::ServerContext * /*context*/,
                                                 const ::omega_edit::v1::DestroyLastCheckpointRequest *request,
                                                 ::omega_edit::v1::DestroyLastCheckpointResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->session_id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "destroy checkpoint",
                                                          request->session_id());
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            if (0 != omega_edit_destroy_last_checkpoint(session)) {
                return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION, "no checkpoint available to destroy");
            }

            response->set_session_id(request->session_id());
            response->set_remaining_checkpoints(omega_session_get_num_checkpoints(session));
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::RestoreLastCheckpoint(grpc::ServerContext * /*context*/,
                                                 const ::omega_edit::v1::RestoreLastCheckpointRequest *request,
                                                 ::omega_edit::v1::RestoreLastCheckpointResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->session_id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "restore checkpoint",
                                                          request->session_id());
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            const auto before_change_count = omega_session_get_num_changes(session);
            if (0 != omega_edit_restore_last_checkpoint(session)) {
                return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION, "no checkpoint available to restore");
            }

            const auto after_change_count = omega_session_get_num_changes(session);
            response->set_session_id(request->session_id());
            response->set_checkpoint_count(omega_session_get_num_checkpoints(session));
            response->set_change_count(after_change_count);
            response->set_discarded_change_count(
                    before_change_count > after_change_count ? before_change_count - after_change_count : 0);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::CreateCheckpoint(grpc::ServerContext * /*context*/,
                                                         const ::omega_edit::v1::CreateCheckpointRequest *request,
                                                         ::omega_edit::v1::CreateCheckpointResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->session_id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "create checkpoint",
                                                          request->session_id());
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            if (0 != omega_edit_create_checkpoint(session)) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "failed to create checkpoint");
            }

            response->set_session_id(request->session_id());
            response->set_checkpoint_count(omega_session_get_num_checkpoints(session));
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::ListTransformPlugins(grpc::ServerContext * /*context*/,
                                                const ::omega_edit::v1::ListTransformPluginsRequest * /*request*/,
                                                ::omega_edit::v1::ListTransformPluginsResponse *response) {
            std::lock_guard<std::mutex> plugin_lock(transform_plugin_mutex_);
            const auto count = omega_transform_plugin_registry_get_count(transform_plugin_registry_);
            for (int64_t i = 0; i < count; ++i) {
                fill_transform_plugin_info(omega_transform_plugin_registry_get_info(transform_plugin_registry_, i),
                                           response->add_plugins());
            }
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::ApplyTransformPlugin(grpc::ServerContext * /*context*/,
                                                const ::omega_edit::v1::ApplyTransformPluginRequest *request,
                                                ::omega_edit::v1::ApplyTransformPluginResponse *response) {
            if (request->plugin_id().empty()) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "plugin_id is required");
            }

            const int64_t offset = request->has_offset() ? request->offset() : 0;
            const int64_t length = request->has_length() ? request->length() : 0;
            if (offset < 0 || length < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "transform offset and length must be non-negative");
            }

            auto transform_guard = session_manager_.try_begin_transform(request->session_id());
            if (!transform_guard) {
                return status_for_session_operation_start(transform_guard.result(), "transform", request->session_id());
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            if (omega_session_get_transaction_state(session) != 0) {
                return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION,
                                    "transform cannot run while a session transaction is open for session: " +
                                            request->session_id());
            }

            const auto file_size_before = omega_session_get_computed_file_size(session);
            if (file_size_before < 0 || offset > file_size_before) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "transform range offset is outside the session");
            }
            const auto remaining = file_size_before - offset;
            const auto effective_length = (length == 0 || length > remaining) ? remaining : length;

            omega_transform_plugin_operation_t operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT;
            const std::string operation_id = next_transform_operation_id();
            transform_progress_context progress_context{
                    &session_manager_, request->session_id(), request->plugin_id(), operation_id, {},
            };
            session_manager_.publish_transform_progress(
                    request->session_id(), static_cast<int32_t>(SESSION_EVT_TRANSFORM_STARTED),
                    make_transform_progress(request->plugin_id(), operation_id, "starting", "Transform started"));
            transform_plugin_response_guard plugin_response;
            int64_t transform_serial = 0;
            {
                // Serializes registry/plugin-library access while the session lock above serializes
                // access to the non-thread-safe omega_session_t.
                std::lock_guard<std::mutex> plugin_lock(transform_plugin_mutex_);
                const auto *plugin_info = omega_transform_plugin_registry_find_info(transform_plugin_registry_,
                                                                                    request->plugin_id().c_str());
                if (!plugin_info) {
                    session_manager_.publish_transform_progress(
                            request->session_id(), static_cast<int32_t>(SESSION_EVT_TRANSFORM_FAILED),
                            make_transform_progress(request->plugin_id(), operation_id, "failed",
                                                    "Transform plugin not found"));
                    return grpc::Status(grpc::StatusCode::NOT_FOUND,
                                        "transform plugin not found: " + request->plugin_id());
                }

                operation = plugin_info->operation;
                const char *options_json = request->has_options_json() ? request->options_json().c_str() : nullptr;
                if (0 != omega_transform_plugin_options_match_args_schema(options_json, plugin_info->args_schema)) {
                    session_manager_.publish_transform_progress(
                            request->session_id(), static_cast<int32_t>(SESSION_EVT_TRANSFORM_FAILED),
                            make_transform_progress(request->plugin_id(), operation_id, "failed",
                                                    "Transform options do not match schema"));
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                        "transform options do not match schema: " + request->plugin_id());
                }
                if (0 != omega_transform_plugin_registry_apply_to_session_with_progress_and_serial(
                                 transform_plugin_registry_, request->plugin_id().c_str(), session, offset, length,
                                 options_json, transform_progress_callback, &progress_context,
                                 &plugin_response.response, &transform_serial)) {
                    session_manager_.publish_transform_progress(
                            request->session_id(), static_cast<int32_t>(SESSION_EVT_TRANSFORM_FAILED),
                            make_transform_progress(request->plugin_id(), operation_id, "failed",
                                                    "Transform plugin failed"));
                    return grpc::Status(grpc::StatusCode::INTERNAL, "transform plugin failed: " + request->plugin_id());
                }
            }

            if (plugin_response.response.result_length < 0 ||
                (plugin_response.response.result_length > 0 && plugin_response.response.result_bytes == nullptr)) {
                session_manager_.publish_transform_progress(
                        request->session_id(), static_cast<int32_t>(SESSION_EVT_TRANSFORM_FAILED),
                        make_transform_progress(request->plugin_id(), operation_id, "failed",
                                                "Transform plugin returned an invalid inspection result"));
                return grpc::Status(grpc::StatusCode::INTERNAL,
                                    "transform plugin returned an invalid inspection result");
            }

            const bool operation_replaces = operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE ||
                                            operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT;
            const auto computed_file_size_after = omega_session_get_computed_file_size(session);
            response->set_session_id(request->session_id());
            response->set_plugin_id(request->plugin_id());
            response->set_offset(offset);
            response->set_length(effective_length);
            response->set_operation(to_proto_transform_plugin_operation(operation));
            response->set_content_changed(operation_replaces && transform_serial > 0);
            response->set_computed_file_size(computed_file_size_after);
            response->set_replacement_length(plugin_response.response.replacement_length);
            if (transform_serial > 0) { response->set_serial(transform_serial); }
            if (plugin_response.response.result_label) {
                response->set_result_label(plugin_response.response.result_label);
            }
            if (plugin_response.response.result_mime_type) {
                response->set_result_mime_type(plugin_response.response.result_mime_type);
            }
            if (plugin_response.response.result_length > 0) {
                response->set_result(reinterpret_cast<const char *>(plugin_response.response.result_bytes),
                                     static_cast<size_t>(plugin_response.response.result_length));
            }
            TransformProgressData completed = make_transform_progress(request->plugin_id(), operation_id, "completed",
                                                                      "Transform completed", false);
            completed.processed_bytes = effective_length;
            completed.total_bytes = effective_length;
            completed.percent = 100.0;
            completed.has_processed_bytes = true;
            completed.has_total_bytes = true;
            completed.has_percent = true;
            if (transform_serial > 0) {
                completed.serial = transform_serial;
                completed.has_serial = true;
            }
            session_manager_.publish_transform_progress(
                    request->session_id(), static_cast<int32_t>(SESSION_EVT_TRANSFORM_COMPLETED), completed);
            return grpc::Status::OK;
        }

        // ---------- Byte Frequency Profile ----------

        grpc::Status
        EditorServiceImpl::GetByteFrequencyProfile(grpc::ServerContext * /*context*/,
                                                   const ::omega_edit::v1::GetByteFrequencyProfileRequest *request,
                                                   ::omega_edit::v1::GetByteFrequencyProfileResponse *response) {
            omega_byte_frequency_profile_t profile;
            std::memset(profile, 0, sizeof(profile));

            {
                auto locked_session = session_manager_.lock_session(request->session_id());
                if (!locked_session) {
                    return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
                }
                auto *session = locked_session.session();

                int result =
                        omega_session_byte_frequency_profile(session, &profile, request->offset(), request->length());
                if (result != 0) {
                    return grpc::Status(grpc::StatusCode::UNKNOWN,
                                        "Profile function failed with error code: " + std::to_string(result));
                }
            }

            response->set_session_id(request->session_id());
            response->set_offset(request->offset());
            response->set_length(request->length());

            for (int i = 0; i < OMEGA_EDIT_BYTE_FREQUENCY_PROFILE_SIZE; ++i) { response->add_frequency(profile[i]); }

            return grpc::Status::OK;
        }

        // ---------- Character Counts ----------

        grpc::Status EditorServiceImpl::GetCharacterCounts(grpc::ServerContext * /*context*/,
                                                           const ::omega_edit::v1::GetCharacterCountsRequest *request,
                                                           ::omega_edit::v1::GetCharacterCountsResponse *response) {
            omega_bom_t bom = omega_util_cstring_to_BOM(request->byte_order_mark().c_str());
            auto *counts = omega_character_counts_create();
            omega_character_counts_set_BOM(counts, bom);

            {
                auto locked_session = session_manager_.lock_session(request->session_id());
                if (!locked_session) {
                    omega_character_counts_destroy(counts);
                    return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
                }
                auto *session = locked_session.session();

                int result = omega_session_character_counts(session, counts, request->offset(), request->length(), bom);
                if (result != 0) {
                    omega_character_counts_destroy(counts);
                    return grpc::Status(grpc::StatusCode::UNKNOWN,
                                        "CharCount function failed with error code: " + std::to_string(result));
                }
            }

            response->set_session_id(request->session_id());
            response->set_offset(request->offset());
            response->set_length(request->length());
            response->set_byte_order_mark(omega_util_BOM_to_cstring(omega_character_counts_get_BOM(counts)));
            response->set_byte_order_mark_bytes(omega_character_counts_bom_bytes(counts));
            response->set_single_byte_chars(omega_character_counts_single_byte_chars(counts));
            response->set_double_byte_chars(omega_character_counts_double_byte_chars(counts));
            response->set_triple_byte_chars(omega_character_counts_triple_byte_chars(counts));
            response->set_quad_byte_chars(omega_character_counts_quad_byte_chars(counts));
            response->set_invalid_bytes(omega_character_counts_invalid_bytes(counts));

            omega_character_counts_destroy(counts);
            return grpc::Status::OK;
        }

        // ---------- Server Control ----------

        grpc::Status EditorServiceImpl::ServerControl(grpc::ServerContext * /*context*/,
                                                      const ::omega_edit::v1::ServerControlRequest *request,
                                                      ::omega_edit::v1::ServerControlResponse *response) {
            response->set_kind(request->kind());
            response->set_pid(get_pid());

            switch (request->kind()) {
                case ::omega_edit::v1::SERVER_CONTROL_KIND_GRACEFUL_SHUTDOWN:
                    graceful_shutdown_.store(true);
                    // Check if no sessions remain - if so, we can stop immediately
                    if (session_manager_.session_count() == 0) {
                        response->set_response_code(0);
                        response->set_status(::omega_edit::v1::SERVER_CONTROL_STATUS_COMPLETED);
                        request_shutdown();
                    } else {
                        response->set_response_code(0);
                        response->set_status(::omega_edit::v1::SERVER_CONTROL_STATUS_DRAINING);
                    }
                    break;

                case ::omega_edit::v1::SERVER_CONTROL_KIND_IMMEDIATE_SHUTDOWN:
                    graceful_shutdown_.store(true);
                    session_manager_.destroy_all();
                    response->set_response_code(0);
                    response->set_status(::omega_edit::v1::SERVER_CONTROL_STATUS_COMPLETED);
                    request_shutdown();
                    break;

                default:
                    return grpc::Status(grpc::StatusCode::UNKNOWN, "undefined server control kind");
            }

            return grpc::Status::OK;
        }

        // ---------- Heartbeat ----------

        grpc::Status EditorServiceImpl::GetHeartbeat(grpc::ServerContext * /*context*/,
                                                     const ::omega_edit::v1::GetHeartbeatRequest *request,
                                                     ::omega_edit::v1::GetHeartbeatResponse *response) {
            // Touch sessions referenced in the heartbeat to keep them alive
            if (request->session_ids_size() > 0) { session_manager_.touch_sessions(request->session_ids()); }

            auto now = std::chrono::system_clock::now();
            auto uptime = std::chrono::steady_clock::now() - start_time_;

            response->set_session_count(static_cast<int32_t>(session_manager_.session_count()));
            response->set_timestamp(
                    std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count());
            response->set_uptime(std::chrono::duration_cast<std::chrono::milliseconds>(uptime).count());
            response->set_cpu_count(get_cpu_count());

            if (const auto load_average = get_cpu_load_average(); load_average.has_value()) {
                response->set_cpu_load_average(*load_average);
                response->set_load_average(*load_average);
            }

            const process_memory_metrics memory = get_process_memory_metrics();
            if (memory.resident_memory_bytes.has_value()) {
                response->set_resident_memory_bytes(*memory.resident_memory_bytes);
            }
            if (memory.virtual_memory_bytes.has_value()) {
                response->set_virtual_memory_bytes(*memory.virtual_memory_bytes);
            }
            if (memory.peak_resident_memory_bytes.has_value()) {
                response->set_peak_resident_memory_bytes(*memory.peak_resident_memory_bytes);
            }

            return grpc::Status::OK;
        }

        // ---------- Event Streams ----------

        grpc::Status EditorServiceImpl::SubscribeToSessionEvents(
                grpc::ServerContext *context, const ::omega_edit::v1::SubscribeToSessionEventsRequest *request,
                grpc::ServerWriter<::omega_edit::v1::SubscribeToSessionEventsResponse> *writer) {

            auto queue = session_manager_.subscribe_session_events(request->id(),
                                                                   request->has_interest() ? request->interest() : -1);
            if (!queue) { return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id()); }

            SessionEventData event_data;
            while (!context->IsCancelled()) {
                if (queue->pop(event_data, std::chrono::milliseconds(500))) {
                    ::omega_edit::v1::SubscribeToSessionEventsResponse event;
                    event.set_session_id(event_data.session_id);
                    event.set_session_event_kind(
                            static_cast<::omega_edit::v1::SessionEventKind>(event_data.session_event_kind));
                    event.set_computed_file_size(event_data.computed_file_size);
                    event.set_change_count(event_data.change_count);
                    event.set_undo_count(event_data.undo_count);
                    if (event_data.serial != 0) { event.set_serial(event_data.serial); }
                    if (event_data.has_transform_progress) {
                        auto *progress = event.mutable_transform_progress();
                        progress->set_plugin_id(event_data.transform_progress.plugin_id);
                        progress->set_operation_id(event_data.transform_progress.operation_id);
                        if (event_data.transform_progress.has_processed_bytes) {
                            progress->set_processed_bytes(event_data.transform_progress.processed_bytes);
                        }
                        if (event_data.transform_progress.has_total_bytes) {
                            progress->set_total_bytes(event_data.transform_progress.total_bytes);
                        }
                        if (event_data.transform_progress.has_percent) {
                            progress->set_percent(event_data.transform_progress.percent);
                        }
                        if (event_data.transform_progress.has_serial) {
                            progress->set_serial(event_data.transform_progress.serial);
                        }
                        progress->set_phase(event_data.transform_progress.phase);
                        progress->set_message(event_data.transform_progress.message);
                        progress->set_indeterminate(event_data.transform_progress.indeterminate);
                    }
                    if (!writer->Write(event)) { break; }
                }
                if (queue->is_closed()) break;
            }

            // Unsubscribe so the event queue stops accumulating events after the
            // client disconnects (prevents unbounded memory growth).
            session_manager_.unsubscribe_session_events(request->id(), queue);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::SubscribeToViewportEvents(
                grpc::ServerContext *context, const ::omega_edit::v1::SubscribeToViewportEventsRequest *request,
                grpc::ServerWriter<::omega_edit::v1::SubscribeToViewportEventsResponse> *writer) {

            std::string sid, vid;
            if (!parse_viewport_id(request->id(), sid, vid)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "malformed viewport id: " + request->id());
            }

            auto queue = session_manager_.subscribe_viewport_events(sid, vid,
                                                                    request->has_interest() ? request->interest() : -1);
            if (!queue) { return grpc::Status(grpc::StatusCode::NOT_FOUND, "viewport not found: " + request->id()); }

            ViewportEventData event_data;
            while (!context->IsCancelled()) {
                if (queue->pop(event_data, std::chrono::milliseconds(500))) {
                    ::omega_edit::v1::SubscribeToViewportEventsResponse event;
                    event.set_session_id(event_data.session_id);
                    event.set_viewport_id(make_viewport_fqid(event_data.session_id, event_data.viewport_id));
                    event.set_viewport_event_kind(
                            static_cast<::omega_edit::v1::ViewportEventKind>(event_data.viewport_event_kind));
                    if (event_data.serial != 0) { event.set_serial(event_data.serial); }
                    if (event_data.offset >= 0) { event.set_offset(event_data.offset); }
                    if (event_data.length >= 0) { event.set_length(event_data.length); }
                    if (!event_data.data.empty()) { event.set_data(event_data.data.data(), event_data.data.size()); }
                    if (!writer->Write(event)) { break; }
                }
                if (queue->is_closed()) break;
            }

            // Unsubscribe so the event queue stops accumulating events after the
            // client disconnects (prevents unbounded memory growth).
            session_manager_.unsubscribe_viewport_events(sid, vid, queue);
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::UnsubscribeToSessionEvents(
                grpc::ServerContext * /*context*/, const ::omega_edit::v1::UnsubscribeToSessionEventsRequest *request,
                ::omega_edit::v1::UnsubscribeToSessionEventsResponse *response) {
            session_manager_.unsubscribe_session_events(request->id());
            response->set_id(request->id());
            return grpc::Status::OK;
        }

        grpc::Status EditorServiceImpl::UnsubscribeToViewportEvents(
                grpc::ServerContext * /*context*/, const ::omega_edit::v1::UnsubscribeToViewportEventsRequest *request,
                ::omega_edit::v1::UnsubscribeToViewportEventsResponse *response) {
            std::string sid, vid;
            if (!parse_viewport_id(request->id(), sid, vid)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "malformed viewport id: " + request->id());
            }

            session_manager_.unsubscribe_viewport_events(sid, vid);
            response->set_id(request->id());
            return grpc::Status::OK;
        }

    }// namespace grpc_server
}// namespace omega_edit
