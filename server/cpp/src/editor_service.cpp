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
#include <omega_edit/filesystem.h>
#include <omega_edit/utility.h>
#include <omega_edit/version.h>

#include <openssl/evp.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <optional>
#include <sstream>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <io.h>
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
        static constexpr int64_t SESSION_CONTENT_INSPECTION_CHUNK_SIZE = 1024 * 1024;
        static constexpr int64_t CHANGELOG_PAYLOAD_CHUNK_SIZE = 256 * 1024;
        static constexpr size_t CHANGELOG_TRANSFORM_ID_LIMIT = 4096;
        static constexpr size_t CHANGELOG_TRANSFORM_OPTIONS_LIMIT = 1024 * 1024;

        static bool parse_canonical_decimal(const std::string &value, const char *field_name, int64_t &result,
                                            grpc::Status &status) {
            if (value.empty() || (value.size() > 1 && value.front() == '0') ||
                std::any_of(value.begin(), value.end(), [](unsigned char ch) { return ch < '0' || ch > '9'; })) {
                status = grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                      std::string(field_name) + " must be a canonical unsigned decimal int64");
                return false;
            }
            uint64_t parsed = 0;
            for (const auto ch : value) {
                const auto digit = static_cast<uint64_t>(ch - '0');
                if (parsed > (static_cast<uint64_t>(std::numeric_limits<int64_t>::max()) - digit) / 10) {
                    status = grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                          std::string(field_name) + " exceeds signed int64 range");
                    return false;
                }
                parsed = parsed * 10 + digit;
            }
            result = static_cast<int64_t>(parsed);
            return true;
        }

        static std::string digest_hex(const unsigned char *digest, unsigned int length) {
            static constexpr char HEX[] = "0123456789abcdef";
            std::string result(length * 2, '0');
            for (unsigned int index = 0; index < length; ++index) {
                result[index * 2] = HEX[digest[index] >> 4U];
                result[index * 2 + 1] = HEX[digest[index] & 0x0FU];
            }
            return result;
        }

        class sha256_context {
        public:
            sha256_context() : context_(EVP_MD_CTX_new(), EVP_MD_CTX_free) {
                valid_ = context_ && EVP_DigestInit_ex(context_.get(), EVP_sha256(), nullptr) == 1;
            }

            bool update(const void *data, size_t length) {
                return valid_ && EVP_DigestUpdate(context_.get(), data, length) == 1;
            }

            bool finish(std::array<unsigned char, EVP_MAX_MD_SIZE> &digest, unsigned int &length) {
                if (!valid_ || EVP_DigestFinal_ex(context_.get(), digest.data(), &length) != 1 || length != 32) {
                    return false;
                }
                valid_ = false;
                return true;
            }

        private:
            std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context_;
            bool valid_{};
        };

        static bool digest_changelog_source(const omega_changelog_content_source_t &source, std::string &hex) {
            sha256_context digest;
            std::vector<omega_byte_t> buffer(static_cast<size_t>(CHANGELOG_PAYLOAD_CHUNK_SIZE));
            int64_t offset = 0;
            while (offset < source.length) {
                const auto read = source.read(source.context, offset, buffer.data(),
                                              std::min<int64_t>(source.length - offset, CHANGELOG_PAYLOAD_CHUNK_SIZE));
                if (read <= 0 || !digest.update(buffer.data(), static_cast<size_t>(read))) { return false; }
                offset += read;
            }
            std::array<unsigned char, EVP_MAX_MD_SIZE> bytes{};
            unsigned int length = 0;
            if (!digest.finish(bytes, length)) { return false; }
            hex = digest_hex(bytes.data(), length);
            return true;
        }

        class changelog_spool {
        public:
            explicit changelog_spool(int64_t byte_limit) : byte_limit_(byte_limit) {
                auto *temporary_directory = omega_util_get_temp_directory();
                if (!temporary_directory) { return; }
                std::string path_template = std::string(temporary_directory) + omega_util_directory_separator() +
                                            ".OmegaEdit-changelog.XXXXXX";
                free(temporary_directory);
                if (path_template.size() > FILENAME_MAX) { return; }
                std::vector<char> path(path_template.begin(), path_template.end());
                path.push_back('\0');
                const auto fd = omega_util_mkstemp(path.data(), 0600);
                if (fd < 0) { return; }
#ifdef _WIN32
                file_ = _fdopen(fd, "w+b");
#else
                file_ = fdopen(fd, "w+b");
#endif
                if (!file_) {
#ifdef _WIN32
                    _close(fd);
#else
                    close(fd);
#endif
                    omega_util_remove_file(path.data());
                    return;
                }
                path_ = path.data();
            }

            ~changelog_spool() {
                if (file_) { fclose(file_); }
                if (!path_.empty()) { omega_util_remove_file(path_.c_str()); }
            }

            bool valid() const { return file_ != nullptr; }
            bool exhausted() const { return exhausted_; }

            bool write(const ::omega_edit::v1::ExportChangeLogResponse &frame) {
                std::string serialized;
                if (!frame.SerializeToString(&serialized) || serialized.size() > std::numeric_limits<uint32_t>::max()) {
                    return false;
                }
                std::array<unsigned char, 5> prefix{};
                auto value = static_cast<uint32_t>(serialized.size());
                size_t prefix_length = 0;
                do {
                    auto byte = static_cast<unsigned char>(value & 0x7FU);
                    value >>= 7U;
                    if (value != 0) { byte |= 0x80U; }
                    prefix[prefix_length++] = byte;
                } while (value != 0);
                const auto frame_length = static_cast<int64_t>(prefix_length + serialized.size());
                if (bytes_written_ > byte_limit_ - frame_length) {
                    exhausted_ = true;
                    return false;
                }
                if (fwrite(prefix.data(), 1, prefix_length, file_) != prefix_length ||
                    fwrite(serialized.data(), 1, serialized.size(), file_) != serialized.size()) {
                    return false;
                }
                bytes_written_ += frame_length;
                return true;
            }

            bool finish() {
                if (!file_ || fflush(file_) != 0) { return false; }
#ifdef _WIN32
                if (_commit(_fileno(file_)) != 0) { return false; }
#else
                if (fsync(fileno(file_)) != 0) { return false; }
#endif
                if (fclose(file_) != 0) {
                    file_ = nullptr;
                    return false;
                }
                file_ = nullptr;
                return true;
            }

            bool open_for_read() {
                if (file_ || path_.empty()) { return false; }
                file_ = fopen(path_.c_str(), "rb");
                return file_ != nullptr;
            }

            bool read(::omega_edit::v1::ExportChangeLogResponse &frame, bool &end) {
                end = false;
                const auto first = fgetc(file_);
                if (first == EOF) {
                    end = feof(file_) != 0;
                    return end;
                }
                uint32_t size = static_cast<uint32_t>(first & 0x7F);
                int shift = 7;
                auto byte = first;
                while ((byte & 0x80) != 0) {
                    if (shift >= 35) { return false; }
                    byte = fgetc(file_);
                    if (byte == EOF) { return false; }
                    size |= static_cast<uint32_t>(byte & 0x7F) << shift;
                    shift += 7;
                }
                std::string serialized(size, '\0');
                if (size > 0 && fread(serialized.data(), 1, size, file_) != size) { return false; }
                return frame.ParseFromString(serialized);
            }

        private:
            std::string path_{};
            FILE *file_{};
            int64_t byte_limit_{};
            int64_t bytes_written_{};
            bool exhausted_{};
        };

        struct changelog_export_context {
            grpc::ServerContext *rpc_context{};
            changelog_spool *spool{};
            sha256_context payload_digest{};
            int64_t entry_count{};
            int64_t payload_bytes{};
            bool optimized{};
            int failure{};
        };

        static int write_changelog_summary(const omega_changelog_export_summary_t *summary, void *user_data) {
            auto &context = *static_cast<changelog_export_context *>(user_data);
            if (context.rpc_context->IsCancelled()) {
                context.failure = -10;
                return context.failure;
            }
            std::string before_digest;
            std::string after_digest;
            if (!digest_changelog_source(summary->before, before_digest) ||
                !digest_changelog_source(summary->after, after_digest)) {
                context.failure = -12;
                return context.failure;
            }
            ::omega_edit::v1::ExportChangeLogResponse frame;
            auto *header = frame.mutable_header();
            header->set_format_version(2);
            header->set_resolved_first_serial_decimal(std::to_string(summary->resolved_first_change_serial));
            header->set_resolved_last_serial_decimal(std::to_string(summary->resolved_last_change_serial));
            header->set_source_change_count_decimal(std::to_string(summary->source_change_count));
            header->set_optimized(context.optimized);
            auto *before = header->mutable_before();
            before->set_byte_length_decimal(std::to_string(summary->before.length));
            before->set_digest_algorithm("sha256");
            before->set_digest_value(before_digest);
            auto *after = header->mutable_after();
            after->set_byte_length_decimal(std::to_string(summary->after.length));
            after->set_digest_algorithm("sha256");
            after->set_digest_value(after_digest);
            if (!context.spool->write(frame)) {
                context.failure = context.spool->exhausted() ? -11 : -12;
                return context.failure;
            }
            return 0;
        }

        static ::omega_edit::v1::ChangeLogEntryKind changelog_kind(omega_changelog_plan_kind_t kind) {
            switch (kind) {
                case OMEGA_CHANGELOG_PLAN_DELETE:
                    return ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_DELETE;
                case OMEGA_CHANGELOG_PLAN_INSERT:
                    return ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_INSERT;
                case OMEGA_CHANGELOG_PLAN_OVERWRITE:
                    return ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_OVERWRITE;
                case OMEGA_CHANGELOG_PLAN_REPLACE:
                    return ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_REPLACE;
                case OMEGA_CHANGELOG_PLAN_TRANSFORM:
                    return ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_TRANSFORM;
            }
            return ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_UNSPECIFIED;
        }

        static int write_changelog_entry(const omega_changelog_plan_entry_t *entry, void *user_data) {
            auto &context = *static_cast<changelog_export_context *>(user_data);
            if (context.rpc_context->IsCancelled()) {
                context.failure = -10;
                return context.failure;
            }
            ::omega_edit::v1::ExportChangeLogResponse frame;
            auto *header = frame.mutable_entry();
            header->set_entry_index_decimal(std::to_string(context.entry_count));
            header->set_kind(changelog_kind(entry->kind));
            header->set_offset_decimal(std::to_string(entry->offset));
            header->set_length_decimal(std::to_string(entry->length));
            header->set_payload_length_decimal(std::to_string(entry->payload_length));
            if (entry->kind == OMEGA_CHANGELOG_PLAN_TRANSFORM) {
                const std::string transform_id = entry->transform_id ? entry->transform_id : "";
                const std::string options_json = entry->options_json ? entry->options_json : "";
                if (transform_id.size() > CHANGELOG_TRANSFORM_ID_LIMIT ||
                    options_json.size() > CHANGELOG_TRANSFORM_OPTIONS_LIMIT) {
                    context.failure = -11;
                    return context.failure;
                }
                auto *transform = header->mutable_transform();
                transform->set_transform_id(transform_id);
                transform->set_options_json(options_json);
                transform->set_replacement_length_decimal(std::to_string(entry->replacement_length));
                transform->set_computed_file_size_before_decimal(std::to_string(entry->computed_file_size_before));
                transform->set_computed_file_size_after_decimal(std::to_string(entry->computed_file_size_after));
            }
            if (!context.spool->write(frame)) {
                context.failure = context.spool->exhausted() ? -11 : -12;
                return context.failure;
            }

            std::vector<omega_byte_t> buffer(static_cast<size_t>(CHANGELOG_PAYLOAD_CHUNK_SIZE));
            int64_t offset = 0;
            while (offset < entry->payload_length) {
                if (context.rpc_context->IsCancelled()) {
                    context.failure = -10;
                    return context.failure;
                }
                const auto read = entry->read_payload(
                        entry->payload_context, offset, buffer.data(),
                        std::min<int64_t>(entry->payload_length - offset, CHANGELOG_PAYLOAD_CHUNK_SIZE));
                if (read <= 0 || !context.payload_digest.update(buffer.data(), static_cast<size_t>(read))) {
                    context.failure = -12;
                    return context.failure;
                }
                frame.Clear();
                auto *payload = frame.mutable_payload();
                payload->set_entry_index_decimal(std::to_string(context.entry_count));
                payload->set_chunk_offset_decimal(std::to_string(offset));
                payload->set_data(buffer.data(), static_cast<size_t>(read));
                offset += read;
                payload->set_final_chunk(offset == entry->payload_length);
                if (!context.spool->write(frame)) {
                    context.failure = context.spool->exhausted() ? -11 : -12;
                    return context.failure;
                }
                context.payload_bytes += read;
            }
            ++context.entry_count;
            return 0;
        }

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

        static std::string normalize_digest_value(std::string digest) {
            std::transform(digest.begin(), digest.end(), digest.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            return digest;
        }

        static bool digest_algorithm_is_json_safe(const std::string &algorithm) {
            return !algorithm.empty() && std::all_of(algorithm.begin(), algorithm.end(),
                                                     [](unsigned char c) { return std::isalnum(c) != 0 || c == '-'; });
        }

        static std::string make_digest_options_json(const std::string &algorithm) {
            return "{\"algorithm\":\"" + algorithm + "\"}";
        }

        using session_content_source = ::omega_edit::v1::SessionContentSource;
        using session_fingerprint_content = ::omega_edit::v1::SessionFingerprintContent;
        using search_case_folding = ::omega_edit::v1::SearchCaseFolding;

        static bool to_core_search_case_folding(search_case_folding value, omega_search_case_folding_t &result) {
            switch (value) {
                case ::omega_edit::v1::SEARCH_CASE_FOLDING_UNSPECIFIED:
                    result = OMEGA_SEARCH_CASE_FOLDING_NONE;
                    return true;
                case ::omega_edit::v1::SEARCH_CASE_FOLDING_ASCII:
                    result = OMEGA_SEARCH_CASE_FOLDING_ASCII;
                    return true;
                case ::omega_edit::v1::SEARCH_CASE_FOLDING_WINDOWS_1252:
                    result = OMEGA_SEARCH_CASE_FOLDING_WINDOWS_1252;
                    return true;
                case ::omega_edit::v1::SEARCH_CASE_FOLDING_CP437:
                    result = OMEGA_SEARCH_CASE_FOLDING_CP437;
                    return true;
                case ::omega_edit::v1::SEARCH_CASE_FOLDING_EBCDIC_037:
                    result = OMEGA_SEARCH_CASE_FOLDING_EBCDIC_037;
                    return true;
                case ::omega_edit::v1::SEARCH_CASE_FOLDING_MAC_ROMAN:
                    result = OMEGA_SEARCH_CASE_FOLDING_MAC_ROMAN;
                    return true;
                default:
                    return false;
            }
        }

        static session_content_source fingerprint_content_to_session_content(session_fingerprint_content content) {
            switch (content) {
                case ::omega_edit::v1::SESSION_FINGERPRINT_CONTENT_ORIGINAL:
                    return ::omega_edit::v1::SESSION_CONTENT_SOURCE_ORIGINAL;
                case ::omega_edit::v1::SESSION_FINGERPRINT_CONTENT_COMPUTED:
                    return ::omega_edit::v1::SESSION_CONTENT_SOURCE_COMPUTED;
                default:
                    return ::omega_edit::v1::SESSION_CONTENT_SOURCE_UNSPECIFIED;
            }
        }

        static bool is_supported_session_content_source(session_content_source content) {
            return content == ::omega_edit::v1::SESSION_CONTENT_SOURCE_ORIGINAL ||
                   content == ::omega_edit::v1::SESSION_CONTENT_SOURCE_COMPUTED ||
                   content == ::omega_edit::v1::SESSION_CONTENT_SOURCE_LATEST_CHECKPOINT;
        }

        static const char *session_content_source_label(session_content_source content) {
            switch (content) {
                case ::omega_edit::v1::SESSION_CONTENT_SOURCE_ORIGINAL:
                    return "Original snapshot";
                case ::omega_edit::v1::SESSION_CONTENT_SOURCE_COMPUTED:
                    return "Current content";
                case ::omega_edit::v1::SESSION_CONTENT_SOURCE_LATEST_CHECKPOINT:
                    return "Latest checkpoint";
                default:
                    return "Unknown";
            }
        }

        static bool session_content_source_uses_file_snapshot(session_content_source content) {
            return content == ::omega_edit::v1::SESSION_CONTENT_SOURCE_ORIGINAL ||
                   content == ::omega_edit::v1::SESSION_CONTENT_SOURCE_LATEST_CHECKPOINT;
        }

        static int64_t get_session_content_byte_length(omega_session_t *session, session_content_source content) {
            switch (content) {
                case ::omega_edit::v1::SESSION_CONTENT_SOURCE_ORIGINAL:
                    return omega_session_get_original_file_size(session);
                case ::omega_edit::v1::SESSION_CONTENT_SOURCE_COMPUTED:
                    return omega_session_get_computed_file_size(session);
                case ::omega_edit::v1::SESSION_CONTENT_SOURCE_LATEST_CHECKPOINT:
                    return omega_session_get_latest_checkpoint_file_size(session);
                default:
                    return -1;
            }
        }

        static const char *get_session_content_snapshot_file_path(const omega_session_t *session,
                                                                  session_content_source content) {
            switch (content) {
                case ::omega_edit::v1::SESSION_CONTENT_SOURCE_ORIGINAL:
                    return omega_session_get_original_snapshot_file_path(session);
                case ::omega_edit::v1::SESSION_CONTENT_SOURCE_LATEST_CHECKPOINT:
                    return omega_session_get_latest_checkpoint_file_path(session);
                default:
                    return nullptr;
            }
        }

        struct session_content_file_reader {
            std::string file_path;
            int64_t offset{};
            int64_t length{};
        };

        static grpc::Status validate_session_content_range(int64_t content_byte_length, int64_t request_offset,
                                                           int64_t request_length, int64_t &effective_offset,
                                                           int64_t &effective_length);

        struct session_content_file_source {
            std::string checkpoint_directory;
            std::string file_path;
            int64_t content_byte_length{-1};
            int64_t effective_offset{};
            int64_t effective_length{};
            int64_t reader_file_offset{};
            bool owns_file{};

            session_content_file_source() = default;
            session_content_file_source(const session_content_file_source &) = delete;
            auto operator=(const session_content_file_source &) -> session_content_file_source & = delete;
            session_content_file_source(session_content_file_source &&other) noexcept
                : checkpoint_directory(std::move(other.checkpoint_directory)), file_path(std::move(other.file_path)),
                  content_byte_length(other.content_byte_length), effective_offset(other.effective_offset),
                  effective_length(other.effective_length), reader_file_offset(other.reader_file_offset),
                  owns_file(other.owns_file) {
                other.owns_file = false;
            }
            auto operator=(session_content_file_source &&other) noexcept -> session_content_file_source & {
                if (this != &other) {
                    if (owns_file && !file_path.empty()) { omega_util_remove_file(file_path.c_str()); }
                    checkpoint_directory = std::move(other.checkpoint_directory);
                    file_path = std::move(other.file_path);
                    content_byte_length = other.content_byte_length;
                    effective_offset = other.effective_offset;
                    effective_length = other.effective_length;
                    reader_file_offset = other.reader_file_offset;
                    owns_file = other.owns_file;
                    other.owns_file = false;
                }
                return *this;
            }
            ~session_content_file_source() {
                if (owns_file && !file_path.empty()) { omega_util_remove_file(file_path.c_str()); }
            }
        };

        static FILE *open_owned_fd_as_file(int fd, const char *mode) {
            if (fd < 0 || !mode) { return nullptr; }
            FILE *file = nullptr;
#ifdef _WIN32
            file = _fdopen(fd, mode);
            if (!file) { _close(fd); }
#else
            file = fdopen(fd, mode);
            if (!file) { close(fd); }
#endif
            return file;
        }

        static grpc::Status create_computed_content_snapshot(omega_session_t *session,
                                                             session_content_file_source &source) {
            char snapshot_path[FILENAME_MAX + 1] = {};
            const auto count =
                    source.checkpoint_directory.empty()
                            ? snprintf(snapshot_path, sizeof(snapshot_path), ".OmegaEdit-inspect.XXXXXX")
                            : snprintf(snapshot_path, sizeof(snapshot_path), "%s%c.OmegaEdit-inspect.XXXXXX",
                                       source.checkpoint_directory.c_str(), omega_util_directory_separator());
            if (count < 0 || static_cast<size_t>(count) >= sizeof(snapshot_path)) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "failed to create computed content snapshot name");
            }

            const auto fd = omega_util_mkstemp(snapshot_path, 0600);
            if (fd < 0) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "failed to create computed content snapshot file");
            }
            auto *file = open_owned_fd_as_file(fd, "wb");
            if (!file) {
                omega_util_remove_file(snapshot_path);
                return grpc::Status(grpc::StatusCode::INTERNAL, "failed to open computed content snapshot file");
            }

            omega_edit_save_segment_to_file_options_t save_options{};
            save_options.skip_disk_sync = OMEGA_EDIT_TRUE;
            const auto save_ok =
                    0 == omega_edit_save_segment_to_file_with_options(session, file, source.effective_offset,
                                                                      source.effective_length, &save_options);
            const auto close_ok = std::fclose(file) == 0;
            if (!save_ok || !close_ok) {
                omega_util_remove_file(snapshot_path);
                return grpc::Status(grpc::StatusCode::INTERNAL, "failed to write computed content snapshot");
            }

            source.file_path = snapshot_path;
            source.reader_file_offset = 0;
            source.owns_file = true;
            return grpc::Status::OK;
        }

        static grpc::Status prepare_session_content_file_source(SessionManager &session_manager,
                                                                const std::string &session_id,
                                                                session_content_source content,
                                                                int64_t requested_offset, int64_t requested_length,
                                                                session_content_file_source &source,
                                                                const char *operation_name) {
            auto locked_session = session_manager.lock_session(session_id);
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + session_id);
            }

            auto *session = locked_session.session();
            source.content_byte_length = get_session_content_byte_length(session, content);
            const auto range_status =
                    validate_session_content_range(source.content_byte_length, requested_offset, requested_length,
                                                   source.effective_offset, source.effective_length);
            if (!range_status.ok()) { return range_status; }

            const auto *checkpoint_directory_ptr = omega_session_get_checkpoint_directory(session);
            source.checkpoint_directory = checkpoint_directory_ptr ? checkpoint_directory_ptr : "";

            if (session_content_source_uses_file_snapshot(content)) {
                const auto *snapshot_path_ptr = get_session_content_snapshot_file_path(session, content);
                if (!snapshot_path_ptr || !*snapshot_path_ptr) {
                    return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION,
                                        std::string(operation_name) + " content source is not file-backed");
                }
                source.file_path = snapshot_path_ptr;
                source.reader_file_offset = source.effective_offset;
                source.owns_file = false;
                return grpc::Status::OK;
            }

            return create_computed_content_snapshot(session, source);
        }

        static int64_t read_session_content_file_chunk(int64_t relative_offset, omega_byte_t *buffer, int64_t length,
                                                       void *user_data_ptr) {
            auto *reader = static_cast<session_content_file_reader *>(user_data_ptr);
            if (!reader || reader->file_path.empty() || !buffer || relative_offset < 0 || length < 0 ||
                reader->offset < 0 || reader->length < 0 || relative_offset > reader->length) {
                return -1;
            }

            const auto remaining = reader->length - relative_offset;
            const auto read_length = std::min(std::min(length, remaining), SESSION_CONTENT_INSPECTION_CHUNK_SIZE);
            if (read_length == 0) { return 0; }
            if (relative_offset > (std::numeric_limits<int64_t>::max)() - reader->offset) { return -1; }

            // Owned snapshot inspections are deliberately opportunistic: if session cleanup removes the file while a
            // calculation is running, the next chunk fails and the RPC is aborted.
            return omega_util_read_file_segment(reader->file_path.c_str(), reader->offset + relative_offset, buffer,
                                                read_length);
        }

        static grpc::Status validate_session_content_range(int64_t content_byte_length, int64_t request_offset,
                                                           int64_t request_length, int64_t &effective_offset,
                                                           int64_t &effective_length) {
            if (content_byte_length < 0) {
                return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION, "session content source is not available");
            }
            if (request_offset < 0 || request_length < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "inspection offset and length must be non-negative");
            }
            if (request_offset > content_byte_length) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "inspection range offset is outside the selected content");
            }

            const auto remaining = content_byte_length - request_offset;
            effective_offset = request_offset;
            effective_length = (request_length == 0 || request_length > remaining) ? remaining : request_length;
            return grpc::Status::OK;
        }

        static bool inspect_plugin_response_is_valid(const omega_transform_plugin_response_t &response) {
            if (response.replacement_bytes != nullptr || response.replacement_length != 0) { return false; }
            if (response.result_length < 0) { return false; }
            return response.result_length == 0 || response.result_bytes != nullptr;
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

        struct transform_plugin_metadata {
            bool found{};
            omega_transform_plugin_operation_t operation{OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT};
            uint32_t flags{};
            bool has_args_schema{};
            std::string args_schema;

            const char *args_schema_ptr() const { return has_args_schema ? args_schema.c_str() : nullptr; }
        };

        static transform_plugin_metadata
        snapshot_transform_plugin_metadata(const omega_transform_plugin_registry_t *registry,
                                           const std::string &plugin_id) {
            transform_plugin_metadata metadata{};
            const auto *info = omega_transform_plugin_registry_find_info(registry, plugin_id.c_str());
            if (!info) { return metadata; }

            metadata.found = true;
            metadata.operation = info->operation;
            metadata.flags = info->flags;
            if (info->args_schema) {
                metadata.has_args_schema = true;
                metadata.args_schema = info->args_schema;
            }
            return metadata;
        }

        static int grpc_context_is_cancelled(void *user_data_ptr);

        static grpc::Status inspect_with_streaming_plugin(
                grpc::ServerContext *context, omega_transform_plugin_registry_t *registry, std::mutex &registry_mutex,
                const std::string &plugin_id, const char *options_json, const char *checkpoint_directory,
                int64_t session_offset, int64_t session_length, omega_transform_plugin_read_t read,
                void *reader_user_data_ptr, grpc::StatusCode not_found_code, const std::string &not_found_message,
                const std::string &wrong_operation_message, const std::string &invalid_options_message,
                const std::string &cancelled_message, grpc::StatusCode failed_code, const std::string &failed_message,
                omega_transform_plugin_response_t *response) {
            transform_plugin_metadata plugin_metadata;
            {
                std::lock_guard<std::mutex> plugin_lock(registry_mutex);
                plugin_metadata = snapshot_transform_plugin_metadata(registry, plugin_id);
            }
            if (!plugin_metadata.found) { return grpc::Status(not_found_code, not_found_message); }
            if (plugin_metadata.operation != OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT ||
                (plugin_metadata.flags & OMEGA_TRANSFORM_PLUGIN_FLAG_STREAMING) == 0U) {
                return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION, wrong_operation_message);
            }
            if (0 !=
                omega_transform_plugin_options_match_args_schema(options_json, plugin_metadata.args_schema_ptr())) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, invalid_options_message);
            }

            if (0 != omega_transform_plugin_registry_inspect_reader_with_cancel(
                             registry, plugin_id.c_str(), session_offset, session_length, options_json,
                             checkpoint_directory, read, reader_user_data_ptr, SESSION_CONTENT_INSPECTION_CHUNK_SIZE,
                             nullptr, nullptr, grpc_context_is_cancelled, context, response)) {
                if (context && context->IsCancelled()) {
                    return grpc::Status(grpc::StatusCode::CANCELLED, cancelled_message);
                }
                return grpc::Status(failed_code, failed_message);
            }
            return grpc::Status::OK;
        }

        struct overwrite_fingerprint_guard_context {
            grpc::ServerContext *grpc_context{};
            omega_transform_plugin_registry_t *registry{};
            std::mutex *registry_mutex{};
            std::string checkpoint_directory;
            std::string algorithm;
            std::string expected_digest;
            int64_t expected_length{};
            grpc::Status failure_status{};
        };

        static int verify_overwrite_fingerprint(const char *file_path, void *user_data_ptr) {
            auto *context = static_cast<overwrite_fingerprint_guard_context *>(user_data_ptr);
            if (!context || !file_path || !*file_path || !context->registry || !context->registry_mutex ||
                context->expected_length < 0) {
                return -1;
            }
            if (omega_util_file_size(file_path) != context->expected_length) { return 1; }

            int64_t modification_time_before = 0;
            if (omega_util_get_modification_time(file_path, &modification_time_before) != 0) { return 1; }

            session_content_file_reader reader{file_path, 0, context->expected_length};
            transform_plugin_response_guard plugin_response;
            const auto options_json = make_digest_options_json(context->algorithm);
            const auto status = inspect_with_streaming_plugin(
                    context->grpc_context, context->registry, *context->registry_mutex,
                    SESSION_FINGERPRINT_DIGEST_PLUGIN_ID, options_json.c_str(), context->checkpoint_directory.c_str(),
                    0, context->expected_length, read_session_content_file_chunk, &reader,
                    grpc::StatusCode::FAILED_PRECONDITION,
                    "save conflict digest plugin is not registered: " +
                            std::string(SESSION_FINGERPRINT_DIGEST_PLUGIN_ID),
                    "save conflict digest plugin must be a streaming inspect plugin",
                    "unsupported save conflict digest algorithm: " + context->algorithm,
                    "save conflict digest cancelled: " + std::string(SESSION_FINGERPRINT_DIGEST_PLUGIN_ID),
                    grpc::StatusCode::ABORTED,
                    "save conflict digest failed: " + std::string(SESSION_FINGERPRINT_DIGEST_PLUGIN_ID),
                    &plugin_response.response);
            if (!status.ok()) {
                context->failure_status = status;
                return -1;
            }

            int64_t modification_time_after = 0;
            if (omega_util_get_modification_time(file_path, &modification_time_after) != 0 ||
                modification_time_before != modification_time_after ||
                omega_util_file_size(file_path) != context->expected_length ||
                plugin_response.response.result_length <= 0 || plugin_response.response.result_bytes == nullptr) {
                return 1;
            }
            const auto actual_digest = normalize_digest_value(
                    std::string(reinterpret_cast<const char *>(plugin_response.response.result_bytes),
                                static_cast<size_t>(plugin_response.response.result_length)));
            const auto actual_algorithm = normalize_digest_algorithm(
                    plugin_response.response.result_label ? plugin_response.response.result_label : context->algorithm);
            return actual_algorithm == context->algorithm && actual_digest == context->expected_digest ? 0 : 1;
        }

        struct transform_progress_context {
            SessionManager *session_manager{};
            grpc::ServerContext *grpc_context{};
            std::shared_ptr<std::atomic_bool> session_cancel_token{};
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

        static bool transform_progress_context_is_cancelled(const transform_progress_context &context) {
            return (context.grpc_context && context.grpc_context->IsCancelled()) ||
                   (context.session_cancel_token && context.session_cancel_token->load(std::memory_order_relaxed));
        }

        static int transform_progress_callback(const omega_transform_plugin_progress_t *progress_ptr,
                                               void *user_data_ptr) {
            auto *context = static_cast<transform_progress_context *>(user_data_ptr);
            if (!context || !context->session_manager || !progress_ptr) { return -1; }
            if (transform_progress_context_is_cancelled(*context)) { return -1; }

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

        static int grpc_context_is_cancelled(void *user_data_ptr) {
            const auto *context = static_cast<const grpc::ServerContext *>(user_data_ptr);
            return context && context->IsCancelled() ? 1 : 0;
        }

        static int transform_context_is_cancelled(void *user_data_ptr) {
            const auto *context = static_cast<const transform_progress_context *>(user_data_ptr);
            return context && transform_progress_context_is_cancelled(*context) ? 1 : 0;
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

        static std::optional<double> get_load_average() {
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

        static ::omega_edit::v1::TransformPluginSupport
        to_proto_transform_plugin_support(omega_transform_plugin_support_t support) {
            switch (support) {
                case OMEGA_TRANSFORM_PLUGIN_SUPPORT_PRODUCTION:
                    return ::omega_edit::v1::TRANSFORM_PLUGIN_SUPPORT_PRODUCTION;
                case OMEGA_TRANSFORM_PLUGIN_SUPPORT_EXPERIMENTAL:
                    return ::omega_edit::v1::TRANSFORM_PLUGIN_SUPPORT_EXPERIMENTAL;
                case OMEGA_TRANSFORM_PLUGIN_SUPPORT_TEST:
                    return ::omega_edit::v1::TRANSFORM_PLUGIN_SUPPORT_TEST;
                default:
                    return ::omega_edit::v1::TRANSFORM_PLUGIN_SUPPORT_UNSPECIFIED;
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
            response->set_support(to_proto_transform_plugin_support(info->support));
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

        static grpc::Status validate_materialized_segment_request(const char *operation, int64_t offset, int64_t length,
                                                                  int64_t max_read_segment_bytes) {
            if (offset < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    std::string(operation) + " offset must be non-negative");
            }
            if (length < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    std::string(operation) + " length must be non-negative");
            }
            if (length > 0 && offset > (std::numeric_limits<int64_t>::max)() - length) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, std::string(operation) + " range is invalid");
            }
            if (max_read_segment_bytes > 0 && length > max_read_segment_bytes) {
                return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                    std::string(operation) + " length exceeds configured read segment limit of " +
                                            std::to_string(max_read_segment_bytes) + " bytes");
            }
            return grpc::Status::OK;
        }

        static int64_t effective_search_limit(int64_t requested_limit, int64_t max_search_matches,
                                              bool &resource_limit_applies) {
            resource_limit_applies = false;
            if (max_search_matches > 0 && (requested_limit <= 0 || requested_limit > max_search_matches)) {
                resource_limit_applies = true;
                return max_search_matches;
            }
            return requested_limit;
        }

        static int64_t transactional_replace_match_limit(const ResourceLimits &resource_limits) {
            auto limit = static_cast<int64_t>(OMEGA_REPLACE_MATCHES_LIMIT);
            if (resource_limits.max_search_matches > 0) {
                limit = (std::min)(limit, resource_limits.max_search_matches);
            }
            return limit;
        }

        static bool match_overlaps_prior(bool is_reverse, bool has_prior, int64_t match_offset, int64_t pattern_length,
                                         int64_t last_accepted_offset, bool &ok) {
            ok = true;
            if (!has_prior) { return false; }
            if (match_offset > (std::numeric_limits<int64_t>::max)() - pattern_length ||
                last_accepted_offset > (std::numeric_limits<int64_t>::max)() - pattern_length) {
                ok = false;
                return false;
            }
            const auto match_end = match_offset + pattern_length;
            const auto last_accepted_end = last_accepted_offset + pattern_length;
            return is_reverse ? (match_end > last_accepted_offset) : (match_offset < last_accepted_end);
        }

        static grpc::Status count_replace_matches_until_limit(omega_session_t *session, const std::string &pattern,
                                                              omega_search_case_folding_t case_folding, bool is_reverse,
                                                              int64_t offset, int64_t length, int64_t session_size,
                                                              int64_t max_selected_matches,
                                                              int64_t &selected_match_count,
                                                              bool &selected_match_limit_exceeded) {
            selected_match_count = 0;
            selected_match_limit_exceeded = false;
            if (!session || pattern.empty() || max_selected_matches < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "replace preflight arguments are invalid");
            }

            const auto effective_length =
                    length > 0 ? (std::min)(length, session_size - offset) : session_size - offset;
            if (static_cast<int64_t>(pattern.size()) > effective_length) { return grpc::Status::OK; }

            auto *ctx = omega_search_create_context_bytes(
                    session, reinterpret_cast<const omega_byte_t *>(pattern.data()),
                    static_cast<int64_t>(pattern.size()), offset, effective_length, case_folding, is_reverse ? 1 : 0);
            if (!ctx) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "replace search context could not be created");
            }

            int64_t last_accepted_offset = -1;
            auto has_accepted_match = false;
            auto search_result = 0;
            while ((search_result = omega_search_next_match(ctx, 1)) > 0) {
                const auto match_offset = omega_search_context_get_match_offset(ctx);
                auto overlap_check_ok = true;
                const auto overlaps_prior = match_overlaps_prior(is_reverse, has_accepted_match, match_offset,
                                                                 static_cast<int64_t>(pattern.size()),
                                                                 last_accepted_offset, overlap_check_ok);
                if (!overlap_check_ok) {
                    omega_search_destroy_context(ctx);
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "replace match range is invalid");
                }
                if (overlaps_prior) { continue; }
                if (selected_match_count >= max_selected_matches) {
                    selected_match_limit_exceeded = true;
                    omega_search_destroy_context(ctx);
                    return grpc::Status::OK;
                }
                ++selected_match_count;
                last_accepted_offset = match_offset;
                has_accepted_match = true;
            }

            omega_search_destroy_context(ctx);
            if (search_result < 0) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "replace search failed while reading session content");
            }
            return grpc::Status::OK;
        }

        static void compute_replace_lowered_counts(const std::string &pattern, const std::string &replacement,
                                                   int64_t replacement_count, int64_t &delete_count,
                                                   int64_t &insert_count, int64_t &overwrite_count) {
            delete_count = 0;
            insert_count = 0;
            overwrite_count = 0;
            if (replacement_count <= 0) { return; }

            size_t prefix_length = 0;
            while (prefix_length < pattern.size() && prefix_length < replacement.size() &&
                   pattern[prefix_length] == replacement[prefix_length]) {
                ++prefix_length;
            }

            size_t suffix_length = 0;
            while (suffix_length < pattern.size() - prefix_length &&
                   suffix_length < replacement.size() - prefix_length &&
                   pattern[pattern.size() - 1 - suffix_length] == replacement[replacement.size() - 1 - suffix_length]) {
                ++suffix_length;
            }

            const auto remove_length = pattern.size() - prefix_length - suffix_length;
            const auto insert_length = replacement.size() - prefix_length - suffix_length;
            if (remove_length == 0 && insert_length == 0) { return; }
            if (remove_length == 0) {
                insert_count = replacement_count;
            } else if (insert_length == 0) {
                delete_count = replacement_count;
            } else if (remove_length == insert_length) {
                overwrite_count = replacement_count;
            } else {
                delete_count = replacement_count;
                insert_count = replacement_count;
            }
        }

        EditorServiceImpl::EditorServiceImpl(HeartbeatConfig heartbeat_config, ResourceLimits resource_limits,
                                             std::function<void()> shutdown_callback,
                                             std::vector<std::string> transform_plugin_directories,
                                             std::string transform_plugin_host_path,
                                             bool allow_experimental_transform_plugins,
                                             bool allow_test_transform_plugins)
            : session_manager_(resource_limits), transform_plugin_registry_(omega_transform_plugin_registry_create()),
              start_time_(std::chrono::steady_clock::now()), heartbeat_config_(heartbeat_config),
              resource_limits_(resource_limits), shutdown_callback_(std::move(shutdown_callback)) {
            if (!transform_plugin_host_path.empty()) {
                omega_transform_plugin_registry_set_host_path(transform_plugin_registry_,
                                                              transform_plugin_host_path.c_str());
            }
            omega_transform_plugin_registry_set_allow_experimental(transform_plugin_registry_,
                                                                   allow_experimental_transform_plugins ? 1 : 0);
            omega_transform_plugin_registry_set_allow_test(transform_plugin_registry_,
                                                           allow_test_transform_plugins ? 1 : 0);
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
            const auto data_length = omega_change_get_data_length(change);
            if (bytes && data_length > 0) { response->set_data(bytes, static_cast<size_t>(data_length)); }

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

            // Validate file path exists if provided.
            if (!file_path.empty()) {
                std::error_code ec;
                if (!std::filesystem::exists(file_path, ec) || ec) {
                    return grpc::Status(grpc::StatusCode::NOT_FOUND,
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

        grpc::Status EditorServiceImpl::SaveSession(grpc::ServerContext *context,
                                                    const ::omega_edit::v1::SaveSessionRequest *request,
                                                    ::omega_edit::v1::SaveSessionResponse *response) {
            if (request->file_path().empty()) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "file_path must not be empty");
            }
            const auto path_status = validate_path_argument(request->file_path(), "file_path");
            if (!path_status.ok()) { return path_status; }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            char saved_file_path[FILENAME_MAX] = {};
            int64_t offset = request->has_offset() ? request->offset() : 0;
            int64_t length = request->has_length() ? request->length() : 0;

            omega_edit_save_options_t save_options{};
            overwrite_fingerprint_guard_context guard_context;
            const omega_edit_save_options_t *save_options_ptr = nullptr;
            if (request->has_expected_original_fingerprint()) {
                const auto &expected = request->expected_original_fingerprint();
                if (!expected.has_digest() || expected.byte_length() < 0) {
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                        "expected_original_fingerprint must include a non-negative size and digest");
                }
                const auto algorithm = normalize_digest_algorithm(expected.digest().algorithm());
                if (!digest_algorithm_is_json_safe(algorithm) || expected.digest().value().empty()) {
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                        "expected_original_fingerprint contains invalid digest metadata");
                }
                const auto *checkpoint_directory = omega_session_get_checkpoint_directory(session);
                guard_context.grpc_context = context;
                guard_context.registry = transform_plugin_registry_;
                guard_context.registry_mutex = &transform_plugin_registry_mutex_;
                guard_context.checkpoint_directory = checkpoint_directory ? checkpoint_directory : "";
                guard_context.algorithm = algorithm;
                guard_context.expected_digest = normalize_digest_value(expected.digest().value());
                guard_context.expected_length = expected.byte_length();
                save_options.overwrite_guard = verify_overwrite_fingerprint;
                save_options.overwrite_guard_user_data = &guard_context;
                save_options_ptr = &save_options;
            }

            int result;
            if (offset != 0 || length != 0) {
                result =
                        omega_edit_save_segment_with_options(session, request->file_path().c_str(), request->io_flags(),
                                                             saved_file_path, offset, length, save_options_ptr);
            } else {
                result = omega_edit_save_with_options(session, request->file_path().c_str(), request->io_flags(),
                                                      saved_file_path, save_options_ptr);
            }
            if (!guard_context.failure_status.ok()) { return guard_context.failure_status; }

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

        grpc::Status
        EditorServiceImpl::RestoreToChangeCount(grpc::ServerContext * /*context*/,
                                                const ::omega_edit::v1::RestoreToChangeCountRequest *request,
                                                ::omega_edit::v1::RestoreToChangeCountResponse *response) {
            if (request->change_count() < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "change_count must be non-negative");
            }

            auto mutation_guard = session_manager_.try_begin_mutation(request->session_id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "restore to change count",
                                                          request->session_id());
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            const auto before_change_count = omega_session_get_num_changes(session);
            const auto before_undo_count = omega_session_get_num_undone_changes(session);
            if (request->change_count() > before_change_count) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "change_count cannot exceed current session change count");
            }

            if (0 != omega_edit_restore_to_change_count(session, request->change_count())) {
                return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION,
                                    "failed to restore session to requested change count");
            }

            const auto after_change_count = omega_session_get_num_changes(session);
            const auto after_undo_count = omega_session_get_num_undone_changes(session);
            response->set_session_id(request->session_id());
            response->set_change_count(after_change_count);
            response->set_discarded_change_count(
                    before_change_count > after_change_count ? before_change_count - after_change_count : 0);
            response->set_discarded_undo_count(
                    before_undo_count > after_undo_count ? before_undo_count - after_undo_count : 0);
            response->set_remaining_checkpoint_count(omega_session_get_num_checkpoints(session));
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

        grpc::Status
        EditorServiceImpl::ExportChangeLog(grpc::ServerContext *context,
                                           const ::omega_edit::v1::ExportChangeLogRequest *request,
                                           grpc::ServerWriter<::omega_edit::v1::ExportChangeLogResponse> *writer) {
            grpc::Status parse_status;
            int64_t first = 0;
            int64_t last = 0;
            int64_t max_span_bytes = 0;
            int64_t requested_entries = 0;
            int64_t requested_output_bytes = 0;
            if ((request->has_first_change_serial_decimal() &&
                 !parse_canonical_decimal(request->first_change_serial_decimal(), "first_change_serial_decimal", first,
                                          parse_status)) ||
                (request->has_last_change_serial_decimal() &&
                 !parse_canonical_decimal(request->last_change_serial_decimal(), "last_change_serial_decimal", last,
                                          parse_status)) ||
                (request->has_max_span_bytes_decimal() &&
                 !parse_canonical_decimal(request->max_span_bytes_decimal(), "max_span_bytes_decimal", max_span_bytes,
                                          parse_status)) ||
                (request->has_max_entries_decimal() &&
                 !parse_canonical_decimal(request->max_entries_decimal(), "max_entries_decimal", requested_entries,
                                          parse_status)) ||
                (request->has_max_output_bytes_decimal() &&
                 !parse_canonical_decimal(request->max_output_bytes_decimal(), "max_output_bytes_decimal",
                                          requested_output_bytes, parse_status))) {
                return parse_status;
            }

            const auto entry_cap = requested_entries == 0
                                           ? resource_limits_.max_changelog_export_entries
                                           : std::min(requested_entries, resource_limits_.max_changelog_export_entries);
            const auto output_cap = requested_output_bytes == 0 ? resource_limits_.max_changelog_spool_bytes
                                                                : std::min(requested_output_bytes,
                                                                           resource_limits_.max_changelog_spool_bytes);
            if (entry_cap <= 0 || output_cap <= 0) {
                return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                    "change-log export is disabled by server resource limits");
            }

            changelog_spool spool(output_cap);
            if (!spool.valid()) {
                return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                    "failed to create secure change-log export spool");
            }
            changelog_export_context export_context{context, &spool};
            export_context.optimized = request->optimize();

            {
                auto locked_session = session_manager_.lock_session(request->session_id());
                if (!locked_session) {
                    return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
                }
                omega_changelog_export_options_t options{};
                options.first_change_serial = first;
                options.last_change_serial = last;
                options.max_span_bytes = max_span_bytes;
                options.max_entries = entry_cap;
                options.prefer_overwrite_form = 1;
                const auto active_tip = omega_session_get_num_changes(locked_session.session());
                const auto resolved_first = first == 0 ? 1 : first;
                const auto resolved_last = last == 0 ? active_tip : last;
                if (active_tip <= 0 || resolved_first <= 0 || resolved_last < resolved_first ||
                    resolved_last > active_tip || !omega_session_get_change(locked_session.session(), resolved_first) ||
                    !omega_session_get_change(locked_session.session(), resolved_last)) {
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                        "change-log export range must identify ordered active serials");
                }
                const auto result =
                        omega_edit_export_changelog(locked_session.session(), &options, request->optimize() ? 1 : 0,
                                                    write_changelog_summary, write_changelog_entry, &export_context);
                if (result != 0) {
                    if (export_context.failure == -10 || context->IsCancelled()) {
                        return grpc::Status(grpc::StatusCode::CANCELLED, "change-log export cancelled");
                    }
                    if (result == -2 || export_context.failure == -11 || spool.exhausted()) {
                        return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                            "change-log export exceeded a configured resource limit");
                    }
                    return grpc::Status(grpc::StatusCode::INTERNAL,
                                        "change-log range validation, planning, or spool write failed");
                }

                std::array<unsigned char, EVP_MAX_MD_SIZE> payload_digest{};
                unsigned int payload_digest_length = 0;
                if (!export_context.payload_digest.finish(payload_digest, payload_digest_length)) {
                    return grpc::Status(grpc::StatusCode::INTERNAL, "failed to finalize change-log payload digest");
                }
                ::omega_edit::v1::ExportChangeLogResponse complete_frame;
                auto *complete = complete_frame.mutable_complete();
                complete->set_emitted_change_count_decimal(std::to_string(export_context.entry_count));
                complete->set_payload_byte_count_decimal(std::to_string(export_context.payload_bytes));
                complete->set_payload_sha256(payload_digest.data(), payload_digest_length);
                if (!spool.write(complete_frame)) {
                    return grpc::Status(spool.exhausted() ? grpc::StatusCode::RESOURCE_EXHAUSTED
                                                          : grpc::StatusCode::INTERNAL,
                                        "failed to finalize change-log export spool");
                }
                if (!spool.finish()) {
                    return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                        "failed to flush change-log export spool");
                }
            }

            if (context->IsCancelled()) {
                return grpc::Status(grpc::StatusCode::CANCELLED, "change-log export cancelled");
            }
            if (!spool.open_for_read()) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "failed to reopen change-log export spool");
            }
            bool saw_header = false;
            bool saw_complete = false;
            while (true) {
                ::omega_edit::v1::ExportChangeLogResponse frame;
                bool end = false;
                if (!spool.read(frame, end)) {
                    return grpc::Status(grpc::StatusCode::DATA_LOSS, "corrupt change-log export spool");
                }
                if (end) { break; }
                if (!saw_header) {
                    if (!frame.has_header()) {
                        return grpc::Status(grpc::StatusCode::DATA_LOSS,
                                            "change-log spool does not begin with a header");
                    }
                    saw_header = true;
                } else if (saw_complete) {
                    return grpc::Status(grpc::StatusCode::DATA_LOSS,
                                        "change-log spool contains frames after completion");
                }
                if (frame.has_complete()) { saw_complete = true; }
                if (context->IsCancelled() || !writer->Write(frame)) {
                    return grpc::Status(grpc::StatusCode::CANCELLED, "change-log export cancelled");
                }
            }
            if (!saw_header || !saw_complete) {
                return grpc::Status(grpc::StatusCode::DATA_LOSS, "incomplete change-log export spool");
            }
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::GetActionJournalViewport(grpc::ServerContext *context,
                                                    const ::omega_edit::v1::GetActionJournalViewportRequest *request,
                                                    ::omega_edit::v1::GetActionJournalViewportResponse *response) {
            grpc::Status parse_status;
            int64_t requested_anchor = 0;
            if (request->has_anchor_serial_decimal() &&
                !parse_canonical_decimal(request->anchor_serial_decimal(), "anchor_serial_decimal", requested_anchor,
                                         parse_status)) {
                return parse_status;
            }
            if (request->capacity() == 0 ||
                request->capacity() > static_cast<uint64_t>(resource_limits_.max_changelog_export_entries)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "action journal viewport capacity is outside the configured range");
            }
            const bool older = request->direction() == ::omega_edit::v1::ACTION_JOURNAL_DIRECTION_OLDER;
            if (!older && request->direction() != ::omega_edit::v1::ACTION_JOURNAL_DIRECTION_NEWER) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "action journal viewport direction must be OLDER or NEWER");
            }

            std::array<bool, 6> included_kinds{};
            const bool include_all_kinds = request->kinds().empty();
            for (const auto kind : request->kinds()) {
                if (kind < ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_DELETE ||
                    kind > ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_TRANSFORM) {
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "action journal kind filter is invalid");
                }
                included_kinds[static_cast<size_t>(kind)] = true;
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            if (context->IsCancelled()) {
                return grpc::Status(grpc::StatusCode::CANCELLED, "action journal request was cancelled");
            }
            const auto active_tip = omega_session_get_num_changes(locked_session.session());
            const auto undo_count = omega_session_get_num_undone_changes(locked_session.session());
            if (active_tip < 0 || undo_count < 0 || undo_count > (std::numeric_limits<int64_t>::max)() - active_tip) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "action journal history size overflow");
            }
            const auto history_tip = active_tip + undo_count;
            const auto checkpoint_count = omega_session_get_num_checkpoints(locked_session.session());
            response->set_format_version(1);
            response->set_session_id(request->session_id());
            response->set_active_tip_serial_decimal(std::to_string(active_tip));
            response->set_change_count_decimal(std::to_string(active_tip));
            response->set_undo_count_decimal(std::to_string(undo_count));
            response->set_checkpoint_count_decimal(std::to_string(checkpoint_count));
            response->set_direction(request->direction());
            response->set_capacity(request->capacity());
            if (history_tip == 0) {
                response->set_resolved_anchor_serial_decimal("0");
                return grpc::Status::OK;
            }

            const auto get_history_change = [&](int64_t serial) {
                return omega_session_get_change(locked_session.session(), serial <= active_tip ? serial : -serial);
            };
            auto anchor = requested_anchor == 0 ? (older ? history_tip : 1) : requested_anchor;
            if (anchor <= 0 || anchor > history_tip || !get_history_change(anchor)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "action journal anchor must identify a retained change serial");
            }

            const auto is_replacement_pair = [](const omega_change_t *delete_change,
                                                const omega_change_t *insert_change) {
                return delete_change && insert_change && omega_change_get_kind_as_char(delete_change) == 'D' &&
                       omega_change_get_kind_as_char(insert_change) == 'I' &&
                       omega_change_get_transaction_bit(delete_change) ==
                               omega_change_get_transaction_bit(insert_change) &&
                       omega_change_get_offset(delete_change) == omega_change_get_offset(insert_change);
            };
            const auto *anchor_change = get_history_change(anchor);
            if (older && anchor < history_tip && is_replacement_pair(anchor_change, get_history_change(anchor + 1))) {
                ++anchor;
            } else if (!older && anchor > 1 && is_replacement_pair(get_history_change(anchor - 1), anchor_change)) {
                --anchor;
            }
            response->set_resolved_anchor_serial_decimal(std::to_string(anchor));

            struct journal_source_entry {
                const omega_change_t *change{};
                int64_t serial{};
            };
            struct journal_canonical_entry {
                journal_source_entry source;
                std::optional<journal_source_entry> replacement;
            };

            const auto storage_kind = [](const omega_change_t *change, bool checkpoint_backed) {
                if (checkpoint_backed) { return ::omega_edit::v1::ACTION_JOURNAL_PAYLOAD_STORAGE_CHECKPOINT_BACKED; }
                switch (omega_change_get_data_storage(change)) {
                    case OMEGA_CHANGE_DATA_STORAGE_INLINE:
                        return ::omega_edit::v1::ACTION_JOURNAL_PAYLOAD_STORAGE_INLINE;
                    case OMEGA_CHANGE_DATA_STORAGE_FILE_BACKED:
                        return ::omega_edit::v1::ACTION_JOURNAL_PAYLOAD_STORAGE_FILE_BACKED;
                    case OMEGA_CHANGE_DATA_STORAGE_NONE:
                        return ::omega_edit::v1::ACTION_JOURNAL_PAYLOAD_STORAGE_NONE;
                }
                return ::omega_edit::v1::ACTION_JOURNAL_PAYLOAD_STORAGE_UNSPECIFIED;
            };
            const auto transaction_id_for = [](const omega_change_t *change) {
                const auto transaction_start = omega_change_get_transaction_start_serial(change);
                return transaction_start > 0 ? "transaction:" + std::to_string(transaction_start) : std::string{};
            };
            const auto append_entry = [&](const journal_canonical_entry &canonical, const std::string &transaction_id,
                                          int64_t continuation_anchor) -> bool {
                const auto kind_char = omega_change_get_kind_as_char(canonical.source.change);
                auto kind = ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_UNSPECIFIED;
                if (canonical.replacement) {
                    kind = ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_REPLACE;
                } else if (kind_char == 'D') {
                    kind = ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_DELETE;
                } else if (kind_char == 'I') {
                    kind = ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_INSERT;
                } else if (kind_char == 'O') {
                    kind = ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_OVERWRITE;
                } else if (kind_char == 'T') {
                    kind = ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_TRANSFORM;
                }
                if (kind == ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_UNSPECIFIED) { return false; }
                if (!include_all_kinds && !included_kinds[static_cast<size_t>(kind)]) { return true; }
                if (request->has_transaction_id() && request->transaction_id() != transaction_id) { return true; }
                if (response->entries_size() >= static_cast<int>(request->capacity())) {
                    response->set_has_more(true);
                    response->set_next_anchor_serial_decimal(std::to_string(continuation_anchor));
                    return false;
                }

                auto *entry = response->add_entries();
                entry->set_entry_index_decimal(std::to_string(response->entries_size() - 1));
                entry->set_first_serial_decimal(std::to_string(canonical.source.serial));
                entry->set_last_serial_decimal(std::to_string(canonical.replacement ? canonical.replacement->serial
                                                                                    : canonical.source.serial));
                const auto change_count_before = canonical.source.serial - 1;
                const auto change_count_after =
                        canonical.replacement ? canonical.replacement->serial : canonical.source.serial;
                entry->set_change_count_before_decimal(std::to_string(change_count_before));
                entry->set_change_count_after_decimal(std::to_string(change_count_after));
                const auto checkpoint_before =
                        omega_session_get_checkpoint_at_change_count(locked_session.session(), change_count_before);
                if (checkpoint_before >= 0) { entry->set_checkpoint_before_decimal(std::to_string(checkpoint_before)); }
                const auto checkpoint_after =
                        omega_session_get_checkpoint_at_change_count(locked_session.session(), change_count_after);
                if (checkpoint_after >= 0) { entry->set_checkpoint_after_decimal(std::to_string(checkpoint_after)); }
                entry->set_kind(kind);
                entry->set_offset_decimal(std::to_string(omega_change_get_offset(canonical.source.change)));
                const auto remove_length = omega_change_get_length(canonical.source.change);
                const auto *data_source =
                        canonical.replacement ? canonical.replacement->change : canonical.source.change;
                const auto data_length = kind == ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_TRANSFORM
                                                 ? 0
                                                 : omega_change_get_data_length(data_source);
                entry->set_length_decimal(
                        std::to_string(kind == ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_INSERT ? 0 : remove_length));
                entry->set_data_length_decimal(std::to_string(data_length));
                int64_t size_delta = 0;
                if (kind == ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_INSERT) {
                    size_delta = data_length;
                } else if (kind == ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_DELETE) {
                    size_delta = -remove_length;
                } else if (kind == ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_REPLACE) {
                    size_delta = data_length - remove_length;
                } else if (kind == ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_TRANSFORM) {
                    const auto before = omega_change_get_transform_computed_file_size_before(canonical.source.change);
                    const auto after = omega_change_get_transform_computed_file_size_after(canonical.source.change);
                    size_delta = before >= 0 && after >= 0 ? after - before : 0;
                    auto *transform = entry->mutable_transform();
                    const auto *transform_id = omega_change_get_transform_id(canonical.source.change);
                    const auto *options_json = omega_change_get_transform_options_json(canonical.source.change);
                    transform->set_transform_id(transform_id ? transform_id : "");
                    transform->set_options_json(options_json ? options_json : "");
                    transform->set_replacement_length_decimal(
                            std::to_string(omega_change_get_transform_replacement_length(canonical.source.change)));
                    transform->set_computed_file_size_before_decimal(std::to_string(before));
                    transform->set_computed_file_size_after_decimal(std::to_string(after));
                }
                entry->set_size_delta_decimal(std::to_string(size_delta));
                if (!transaction_id.empty()) { entry->set_transaction_id(transaction_id); }
                entry->set_payload_storage(
                        storage_kind(data_source, kind == ::omega_edit::v1::CHANGE_LOG_ENTRY_KIND_TRANSFORM));
                return true;
            };

            for (int64_t serial = anchor; older ? serial >= 1 : serial <= history_tip;) {
                if (context->IsCancelled()) {
                    return grpc::Status(grpc::StatusCode::CANCELLED, "action journal request was cancelled");
                }
                const auto *change = get_history_change(serial);
                if (!change) {
                    return grpc::Status(grpc::StatusCode::ABORTED,
                                        "action journal changed while its viewport was being read");
                }
                const auto transaction_bit = omega_change_get_transaction_bit(change);
                journal_canonical_entry canonical{{change, serial}, std::nullopt};
                int64_t continuation_anchor = serial;
                int64_t step = 1;
                if (older && omega_change_get_kind_as_char(change) == 'I' && serial > 1) {
                    const auto *delete_change = get_history_change(serial - 1);
                    if (delete_change && omega_change_get_kind_as_char(delete_change) == 'D' &&
                        omega_change_get_transaction_bit(delete_change) == transaction_bit &&
                        omega_change_get_offset(delete_change) == omega_change_get_offset(change)) {
                        canonical = {{delete_change, serial - 1}, journal_source_entry{change, serial}};
                        step = 2;
                    }
                } else if (!older && omega_change_get_kind_as_char(change) == 'D' && serial < history_tip) {
                    const auto *insert_change = get_history_change(serial + 1);
                    if (insert_change && omega_change_get_kind_as_char(insert_change) == 'I' &&
                        omega_change_get_transaction_bit(insert_change) == transaction_bit &&
                        omega_change_get_offset(insert_change) == omega_change_get_offset(change)) {
                        canonical.replacement = journal_source_entry{insert_change, serial + 1};
                        step = 2;
                    }
                }
                const auto transaction_id = transaction_id_for(canonical.source.change);
                if (!append_entry(canonical, transaction_id, continuation_anchor)) { break; }
                serial += older ? -step : step;
            }
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
        EditorServiceImpl::GetSessionFingerprint(grpc::ServerContext *context,
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

            const auto inspection_content = fingerprint_content_to_session_content(content);
            transform_plugin_response_guard plugin_response;
            session_content_file_source source;
            auto source_status = prepare_session_content_file_source(
                    session_manager_, request->session_id(), inspection_content, 0, 0, source, "session fingerprint");
            if (!source_status.ok()) { return source_status; }

            session_content_file_reader reader{source.file_path, source.reader_file_offset, source.effective_length};
            const auto inspect_status = inspect_with_streaming_plugin(
                    context, transform_plugin_registry_, transform_plugin_registry_mutex_,
                    SESSION_FINGERPRINT_DIGEST_PLUGIN_ID, options_json.c_str(), source.checkpoint_directory.c_str(), 0,
                    source.effective_length, read_session_content_file_chunk, &reader,
                    grpc::StatusCode::FAILED_PRECONDITION,
                    "session fingerprint digest plugin is not registered: " +
                            std::string(SESSION_FINGERPRINT_DIGEST_PLUGIN_ID),
                    "session fingerprint digest plugin must be a streaming inspect plugin",
                    "unsupported fingerprint digest algorithm: " + algorithm,
                    "session fingerprint digest plugin cancelled: " + std::string(SESSION_FINGERPRINT_DIGEST_PLUGIN_ID),
                    grpc::StatusCode::ABORTED,
                    "session fingerprint digest plugin failed: " + std::string(SESSION_FINGERPRINT_DIGEST_PLUGIN_ID),
                    &plugin_response.response);
            if (!inspect_status.ok()) { return inspect_status; }

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
            fingerprint->set_byte_length(source.content_byte_length);
            auto *digest_response = fingerprint->mutable_digest();
            digest_response->set_algorithm(algorithm);
            digest_response->set_value(digest_value);
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::GetSessionContentInfo(grpc::ServerContext * /*context*/,
                                                 const ::omega_edit::v1::GetSessionContentInfoRequest *request,
                                                 ::omega_edit::v1::GetSessionContentInfoResponse *response) {
            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            std::vector<session_content_source> requested;
            if (request->content().empty()) {
                requested = {
                        ::omega_edit::v1::SESSION_CONTENT_SOURCE_ORIGINAL,
                        ::omega_edit::v1::SESSION_CONTENT_SOURCE_COMPUTED,
                        ::omega_edit::v1::SESSION_CONTENT_SOURCE_LATEST_CHECKPOINT,
                };
            } else {
                requested.reserve(static_cast<size_t>(request->content_size()));
                for (const auto content_value : request->content()) {
                    requested.push_back(static_cast<session_content_source>(content_value));
                }
            }

            response->set_session_id(request->session_id());
            for (const auto content : requested) {
                if (!is_supported_session_content_source(content)) {
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "unsupported session content source");
                }

                const auto byte_length = get_session_content_byte_length(session, content);
                auto *info = response->add_info();
                info->set_content(content);
                info->set_available(byte_length >= 0);
                info->set_byte_length(byte_length >= 0 ? byte_length : 0);
                info->set_label(session_content_source_label(content));
            }
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::InspectSessionContent(grpc::ServerContext *context,
                                                 const ::omega_edit::v1::InspectSessionContentRequest *request,
                                                 ::omega_edit::v1::InspectSessionContentResponse *response) {
            const auto content = request->content();
            if (!is_supported_session_content_source(content)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "unsupported session content source");
            }
            if (request->plugin_id().empty()) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "plugin_id is required");
            }

            const int64_t requested_offset = request->has_offset() ? request->offset() : 0;
            const int64_t requested_length = request->has_length() ? request->length() : 0;
            transform_plugin_response_guard plugin_response;
            const char *options_json = request->has_options_json() ? request->options_json().c_str() : nullptr;
            session_content_file_source source;
            auto source_status = prepare_session_content_file_source(session_manager_, request->session_id(), content,
                                                                     requested_offset, requested_length, source,
                                                                     "session content inspection");
            if (!source_status.ok()) { return source_status; }

            session_content_file_reader reader{source.file_path, source.reader_file_offset, source.effective_length};
            const auto inspect_status = inspect_with_streaming_plugin(
                    context, transform_plugin_registry_, transform_plugin_registry_mutex_, request->plugin_id(),
                    options_json, source.checkpoint_directory.c_str(), source.effective_offset, source.effective_length,
                    read_session_content_file_chunk, &reader, grpc::StatusCode::NOT_FOUND,
                    "transform plugin not found: " + request->plugin_id(),
                    "session content inspection requires a streaming inspect plugin",
                    "transform options do not match schema: " + request->plugin_id(),
                    "session content inspection cancelled: " + request->plugin_id(), grpc::StatusCode::ABORTED,
                    "session content inspection failed: " + request->plugin_id(), &plugin_response.response);
            if (!inspect_status.ok()) { return inspect_status; }

            if (!inspect_plugin_response_is_valid(plugin_response.response)) {
                return grpc::Status(grpc::StatusCode::INTERNAL,
                                    "session content inspection returned an invalid result");
            }

            response->set_session_id(request->session_id());
            response->set_content(content);
            response->set_plugin_id(request->plugin_id());
            response->set_offset(source.effective_offset);
            response->set_length(source.effective_length);
            response->set_content_byte_length(source.content_byte_length);
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
            auto request_status = validate_materialized_segment_request("segment", request->offset(), request->length(),
                                                                        resource_limits_.max_read_segment_bytes);
            if (!request_status.ok()) { return request_status; }

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
            bool is_reverse = request->has_is_reverse() ? request->is_reverse() : false;
            const auto requested_case_folding = request->has_case_folding()
                                                        ? request->case_folding()
                                                        : ::omega_edit::v1::SEARCH_CASE_FOLDING_UNSPECIFIED;
            omega_search_case_folding_t case_folding = OMEGA_SEARCH_CASE_FOLDING_NONE;
            if (!to_core_search_case_folding(requested_case_folding, case_folding)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "search case folding is unsupported");
            }
            int64_t offset = request->has_offset() ? request->offset() : 0;
            int64_t length = request->has_length() ? request->length() : 0;
            int64_t limit = request->has_limit() ? request->limit() : 0;// 0 = no limit
            if (offset < 0 || length < 0 || limit < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "search offset, length, and limit must be non-negative");
            }
            if (length > 0 && offset > (std::numeric_limits<int64_t>::max)() - length) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "search range is invalid");
            }

            bool resource_limit_applies = false;
            const auto bounded_limit =
                    effective_search_limit(limit, resource_limits_.max_search_matches, resource_limit_applies);
            std::vector<int64_t> match_offsets;

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
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "search context could not be created");
                }
                const auto effective_length = length > 0 ? length : session_size - offset;
                if (length > 0 && effective_length > session_size - offset) {
                    return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "search range is invalid");
                }
                if (static_cast<int64_t>(request->pattern().size()) <= effective_length) {
                    auto *ctx = omega_search_create_context_bytes(
                            session, reinterpret_cast<const omega_byte_t *>(request->pattern().data()),
                            static_cast<int64_t>(request->pattern().size()), offset, length, case_folding,
                            is_reverse ? 1 : 0);

                    if (!ctx) {
                        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "search context could not be created");
                    }

                    int64_t num_matches = 0;
                    auto search_result = 0;
                    while ((bounded_limit <= 0 || num_matches < bounded_limit) &&
                           (search_result = omega_search_next_match(ctx, 1)) > 0) {
                        match_offsets.push_back(omega_search_context_get_match_offset(ctx));
                        ++num_matches;
                    }
                    if (search_result < 0) {
                        omega_search_destroy_context(ctx);
                        return grpc::Status(grpc::StatusCode::INTERNAL, "search failed while reading session content");
                    }
                    if (resource_limit_applies && num_matches >= bounded_limit) {
                        search_result = omega_search_next_match(ctx, 1);
                        if (search_result < 0) {
                            omega_search_destroy_context(ctx);
                            return grpc::Status(grpc::StatusCode::INTERNAL,
                                                "search failed while reading session content");
                        }
                        if (search_result > 0) {
                            omega_search_destroy_context(ctx);
                            return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                                "search matches exceed configured search match limit of " +
                                                        std::to_string(resource_limits_.max_search_matches));
                        }
                    }
                    omega_search_destroy_context(ctx);
                }
            }

            response->set_session_id(request->session_id());
            response->set_pattern(request->pattern());
            response->set_case_folding(requested_case_folding);
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

            const bool is_reverse = request->has_is_reverse() ? request->is_reverse() : false;
            const auto requested_case_folding = request->has_case_folding()
                                                        ? request->case_folding()
                                                        : ::omega_edit::v1::SEARCH_CASE_FOLDING_UNSPECIFIED;
            omega_search_case_folding_t case_folding = OMEGA_SEARCH_CASE_FOLDING_NONE;
            if (!to_core_search_case_folding(requested_case_folding, case_folding)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "replace case folding is unsupported");
            }
            const int64_t offset = request->has_offset() ? request->offset() : 0;
            const int64_t length = request->has_length() ? request->length() : 0;
            const int64_t limit = request->has_limit() ? request->limit() : 0;
            const bool front_to_back = request->has_front_to_back() ? request->front_to_back() : true;
            const bool overwrite_only = request->has_overwrite_only() ? request->overwrite_only() : false;

            if (offset < 0 || length < 0 || limit < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "replace offset, length, and limit must be non-negative");
            }
            if (length > 0 && offset > (std::numeric_limits<int64_t>::max)() - length) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "replace range is invalid");
            }

            const auto payload_status = validate_replace_payload_sizes(request->pattern(), request->replacement(),
                                                                       resource_limits_.max_change_bytes, "replace");
            if (!payload_status.ok()) { return payload_status; }

            response->set_session_id(request->session_id());
            response->set_pattern(request->pattern());
            response->set_replacement(request->replacement());
            response->set_case_folding(requested_case_folding);
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

                auto bounded_replace_limit = limit;
                const auto replace_match_limit = transactional_replace_match_limit(resource_limits_);
                if (replace_match_limit <= 0) {
                    return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                        "transactional replace match limit is disabled; use checkpointed replace");
                }
                auto replace_completed = false;
                if (limit <= 0 || limit > replace_match_limit) {
                    auto selected_match_count = int64_t{0};
                    auto selected_match_limit_exceeded = false;
                    const auto preflight_status = count_replace_matches_until_limit(
                            session, request->pattern(), case_folding, is_reverse, offset, length, session_size,
                            replace_match_limit, selected_match_count, selected_match_limit_exceeded);
                    if (!preflight_status.ok()) { return preflight_status; }
                    if (selected_match_limit_exceeded) {
                        const auto can_stream_replace_all = limit <= 0 && !overwrite_only;
                        if (!can_stream_replace_all) {
                            return grpc::Status(grpc::StatusCode::RESOURCE_EXHAUSTED,
                                                "replace matches exceed configured search match limit of " +
                                                        std::to_string(replace_match_limit) +
                                                        "; use checkpointed replace for large replace-all operations");
                        }
                        const auto rc = omega_edit_replace_all_bytes_directional(
                                session, reinterpret_cast<const omega_byte_t *>(request->pattern().data()),
                                static_cast<int64_t>(request->pattern().size()),
                                reinterpret_cast<const omega_byte_t *>(request->replacement().data()),
                                static_cast<int64_t>(request->replacement().size()), case_folding, is_reverse ? 1 : 0,
                                offset, length, &replacement_count);
                        if (rc != 0) {
                            return grpc::Status(grpc::StatusCode::INTERNAL,
                                                "checkpointed replace fallback failed for session: " +
                                                        request->session_id());
                        }
                        compute_replace_lowered_counts(request->pattern(), request->replacement(), replacement_count,
                                                       delete_count, insert_count, overwrite_count);
                        replace_completed = true;
                    }
                    bounded_replace_limit = selected_match_count;
                }

                if (!replace_completed) {
                    const auto rc = omega_edit_replace_matches_bytes(
                            session, reinterpret_cast<const omega_byte_t *>(request->pattern().data()),
                            static_cast<int64_t>(request->pattern().size()),
                            reinterpret_cast<const omega_byte_t *>(request->replacement().data()),
                            static_cast<int64_t>(request->replacement().size()), case_folding, is_reverse ? 1 : 0,
                            offset, length, bounded_replace_limit, front_to_back ? 1 : 0, overwrite_only ? 1 : 0,
                            &replacement_count, &delete_count, &insert_count, &overwrite_count);
                    if (rc != 0) {
                        return grpc::Status(grpc::StatusCode::INTERNAL,
                                            "replace failed for session: " + request->session_id());
                    }
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

            const auto requested_case_folding = request->has_case_folding()
                                                        ? request->case_folding()
                                                        : ::omega_edit::v1::SEARCH_CASE_FOLDING_UNSPECIFIED;
            omega_search_case_folding_t case_folding = OMEGA_SEARCH_CASE_FOLDING_NONE;
            if (!to_core_search_case_folding(requested_case_folding, case_folding)) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "checkpointed replace case folding is unsupported");
            }
            const int64_t offset = request->has_offset() ? request->offset() : 0;
            const int64_t length = request->has_length() ? request->length() : 0;

            if (offset < 0 || length < 0) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "checkpointed replace offset and length must be non-negative");
            }
            if (length > 0 && offset > (std::numeric_limits<int64_t>::max)() - length) {
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "checkpointed replace range is invalid");
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
                    response->set_case_folding(requested_case_folding);
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
                        static_cast<int64_t>(request->replacement().size()), case_folding, offset, length,
                        &replacement_count);
                if (rc != 0) {
                    return grpc::Status(grpc::StatusCode::INTERNAL,
                                        "checkpointed replace failed for session: " + request->session_id());
                }
            }

            response->set_session_id(request->session_id());
            response->set_pattern(request->pattern());
            response->set_replacement(request->replacement());
            response->set_case_folding(requested_case_folding);
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

        grpc::Status EditorServiceImpl::CheckoutCheckpoint(grpc::ServerContext * /*context*/,
                                                           const ::omega_edit::v1::CheckoutCheckpointRequest *request,
                                                           ::omega_edit::v1::CheckoutCheckpointResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->session_id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "checkout checkpoint",
                                                          request->session_id());
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();

            const auto requested_checkpoint_count = request->checkpoint_count();
            const auto active_checkpoint_count = omega_session_get_num_checkpoints(session);
            const auto future_checkpoint_count = omega_session_get_num_future_checkpoints(session);
            if (requested_checkpoint_count < 0 ||
                requested_checkpoint_count > active_checkpoint_count + future_checkpoint_count) {
                return grpc::Status(grpc::StatusCode::OUT_OF_RANGE,
                                    "checkpoint boundary is outside the materialized timeline");
            }

            if (0 != omega_edit_checkout_checkpoint(session, requested_checkpoint_count)) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "failed to checkout checkpoint");
            }

            response->set_session_id(request->session_id());
            response->set_checkpoint_count(omega_session_get_num_checkpoints(session));
            response->set_future_checkpoint_count(omega_session_get_num_future_checkpoints(session));
            response->set_change_count(omega_session_get_num_changes(session));
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::DiscardCheckpointFuture(grpc::ServerContext * /*context*/,
                                                   const ::omega_edit::v1::DiscardCheckpointFutureRequest *request,
                                                   ::omega_edit::v1::DiscardCheckpointFutureResponse *response) {
            auto mutation_guard = session_manager_.try_begin_mutation(request->session_id());
            if (!mutation_guard) {
                return status_for_session_operation_start(mutation_guard.result(), "discard checkpoint future",
                                                          request->session_id());
            }

            auto locked_session = session_manager_.lock_session(request->session_id());
            if (!locked_session) {
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
            }
            auto *session = locked_session.session();
            const auto discarded = omega_edit_discard_checkpoint_future(session);
            if (discarded < 0) {
                return grpc::Status(grpc::StatusCode::INTERNAL, "failed to discard checkpoint future");
            }

            response->set_session_id(request->session_id());
            response->set_discarded_checkpoint_count(discarded);
            response->set_checkpoint_count(omega_session_get_num_checkpoints(session));
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
            std::lock_guard<std::mutex> plugin_lock(transform_plugin_registry_mutex_);
            const auto count = omega_transform_plugin_registry_get_count(transform_plugin_registry_);
            for (int64_t i = 0; i < count; ++i) {
                fill_transform_plugin_info(omega_transform_plugin_registry_get_info(transform_plugin_registry_, i),
                                           response->add_plugins());
            }
            return grpc::Status::OK;
        }

        grpc::Status
        EditorServiceImpl::ApplyTransformPlugin(grpc::ServerContext *context,
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

            // Replace-capable plugins mutate the non-thread-safe core session, so transforms intentionally serialize
            // the session while the plugin runs. Read-only whole-content inspections snapshot above and stream outside
            // this lock instead.
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
                    &session_manager_,
                    context,
                    locked_session.info ? locked_session.info->transform_cancel_requested : nullptr,
                    request->session_id(),
                    request->plugin_id(),
                    operation_id,
                    {}};
            const auto cancelled_status = [&]() {
                return grpc::Status(grpc::StatusCode::CANCELLED, "transform cancelled: " + request->plugin_id());
            };
            if (transform_progress_context_is_cancelled(progress_context)) { return cancelled_status(); }
            session_manager_.publish_transform_progress(
                    request->session_id(), static_cast<int32_t>(SESSION_EVT_TRANSFORM_STARTED),
                    make_transform_progress(request->plugin_id(), operation_id, "starting", "Transform started"));
            transform_plugin_response_guard plugin_response;
            int64_t transform_serial = 0;
            transform_plugin_metadata plugin_metadata;
            {
                std::lock_guard<std::mutex> plugin_lock(transform_plugin_registry_mutex_);
                plugin_metadata = snapshot_transform_plugin_metadata(transform_plugin_registry_, request->plugin_id());
            }
            if (!plugin_metadata.found) {
                if (transform_progress_context_is_cancelled(progress_context)) { return cancelled_status(); }
                session_manager_.publish_transform_progress(
                        request->session_id(), static_cast<int32_t>(SESSION_EVT_TRANSFORM_FAILED),
                        make_transform_progress(request->plugin_id(), operation_id, "failed",
                                                "Transform plugin not found"));
                return grpc::Status(grpc::StatusCode::NOT_FOUND, "transform plugin not found: " + request->plugin_id());
            }

            operation = plugin_metadata.operation;
            const char *options_json = request->has_options_json() ? request->options_json().c_str() : nullptr;
            if (0 !=
                omega_transform_plugin_options_match_args_schema(options_json, plugin_metadata.args_schema_ptr())) {
                if (transform_progress_context_is_cancelled(progress_context)) { return cancelled_status(); }
                session_manager_.publish_transform_progress(
                        request->session_id(), static_cast<int32_t>(SESSION_EVT_TRANSFORM_FAILED),
                        make_transform_progress(request->plugin_id(), operation_id, "failed",
                                                "Transform options do not match schema"));
                return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                    "transform options do not match schema: " + request->plugin_id());
            }
            if (0 != omega_transform_plugin_registry_apply_to_session_with_progress_cancel_and_serial(
                             transform_plugin_registry_, request->plugin_id().c_str(), session, offset, length,
                             options_json, transform_progress_callback, &progress_context,
                             transform_context_is_cancelled, &progress_context, &plugin_response.response,
                             &transform_serial)) {
                if (transform_progress_context_is_cancelled(progress_context)) { return cancelled_status(); }
                session_manager_.publish_transform_progress(
                        request->session_id(), static_cast<int32_t>(SESSION_EVT_TRANSFORM_FAILED),
                        make_transform_progress(request->plugin_id(), operation_id, "failed",
                                                "Transform plugin failed"));
                return grpc::Status(grpc::StatusCode::INTERNAL, "transform plugin failed: " + request->plugin_id());
            }

            if (plugin_response.response.result_length < 0 ||
                (plugin_response.response.result_length > 0 && plugin_response.response.result_bytes == nullptr)) {
                if (transform_progress_context_is_cancelled(progress_context)) { return cancelled_status(); }
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
            if (transform_progress_context_is_cancelled(progress_context)) { return cancelled_status(); }
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
                        response->set_status(::omega_edit::v1::SERVER_CONTROL_STATUS_COMPLETED);
                        request_shutdown();
                    } else {
                        response->set_status(::omega_edit::v1::SERVER_CONTROL_STATUS_DRAINING);
                    }
                    break;

                case ::omega_edit::v1::SERVER_CONTROL_KIND_IMMEDIATE_SHUTDOWN:
                    graceful_shutdown_.store(true);
                    session_manager_.destroy_all();
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

            if (const auto load_average = get_load_average(); load_average.has_value()) {
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
