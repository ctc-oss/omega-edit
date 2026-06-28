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

#include "../include/omega_edit/edit.h"
#include "../include/omega_edit/change.h"
#include "../include/omega_edit/search.h"
#include "../include/omega_edit/segment.h"
#include "../include/omega_edit/session.h"
#include "../include/omega_edit/viewport.h"
#include "impl_/change_def.hpp"
#include "impl_/edit_private_helpers.hpp"
#include "impl_/internal_fun.hpp"
#include "impl_/macros.h"
#include "impl_/model_def.hpp"
#include "impl_/model_segment_def.hpp"
#include "impl_/safe_math.hpp"
#include "impl_/session_def.hpp"
#include "impl_/viewport_def.hpp"
#include <algorithm>
#include <cassert>
#include <cstdlib>
#include <limits>
#include <memory>
#include <new>
#include <vector>

using omega_edit::internal::add_overflows_int64_;
using omega_edit::internal::apply_builtin_transform_;
using omega_edit::internal::builtin_transform_id_;
using omega_edit::internal::builtin_transform_options_json_;
using omega_edit::internal::change_kind_t;
using omega_edit::internal::del_;
using omega_edit::internal::ins_;
using omega_edit::internal::is_builtin_transform_kind_;
using omega_edit::internal::model_segment_kind_t;
using omega_edit::internal::next_change_serial_;
using omega_edit::internal::omega_change_get_kind_;
using omega_edit::internal::omega_change_get_transaction_bit_;
using omega_edit::internal::omega_data_create_;
using omega_edit::internal::omega_data_destroy_;
using omega_edit::internal::omega_model_segment_get_kind_;
using omega_edit::internal::omega_session_get_transaction_bit_;
using omega_edit::internal::ovr_;
using omega_edit::internal::populate_data_segment_;
using omega_edit::internal::print_model_segments_;
using omega_edit::internal::restore_viewport_callbacks_;
using omega_edit::internal::safe_add_int64_;
using omega_edit::internal::scoped_search_context_t;
using omega_edit::internal::scoped_session_event_batch_t;
using omega_edit::internal::scoped_transaction_t;
using omega_edit::internal::session_stream_cursor_t;
using omega_edit::internal::transform_;
using omega_edit::internal::valid_nonnegative_range_;

#ifdef OMEGA_BUILD_WINDOWS

#include <io.h>

#define close _close
#ifdef min
#undef min
#endif
#ifdef max
#undef max
#endif
#else

#include <unistd.h>

#endif

namespace {
    constexpr int64_t OMEGA_IO_BUFFER_SIZE = 65536;
    constexpr int OMEGA_OUTPUT_PATH_SUFFIX_ATTEMPTS = 1000000;

    auto initialize_model_segments_(omega_model_segments_t &model_segments, int64_t length) -> bool;

    auto resolve_checkpoint_directory_(const char *file_path, const char *checkpoint_directory,
                                       std::string &checkpoint_directory_str) -> bool {
        if (checkpoint_directory == nullptr) {
            if ((file_path != nullptr) && file_path[0] != '\0') {
                auto *const dirname = omega_util_dirname(file_path, nullptr);
                if (dirname != nullptr) {
                    try {
                        checkpoint_directory = checkpoint_directory_str.assign(dirname).c_str();
                    } catch (const std::bad_alloc &) { return false; }
                }
            }
            if (checkpoint_directory == nullptr) {
                auto *const temp_dir = omega_util_get_temp_directory();
                if (temp_dir != nullptr) {
                    try {
                        checkpoint_directory = checkpoint_directory_str.assign(temp_dir).c_str();
                    } catch (const std::bad_alloc &) {
                        free(temp_dir);
                        return false;
                    }
                    free(temp_dir);
                } else {
                    auto *const current_dir = omega_util_get_current_dir(nullptr);
                    if (current_dir != nullptr) {
                        try {
                            checkpoint_directory = checkpoint_directory_str.assign(current_dir).c_str();
                        } catch (const std::bad_alloc &) { return false; }
                    }
                }
            }
        }
        if (checkpoint_directory == nullptr) {
            LOG_ERROR("failed to determine checkpoint directory");
            return false;
        }
        if ((omega_util_directory_exists(checkpoint_directory) == 0) &&
            0 != omega_util_create_directory(checkpoint_directory)) {
            LOG_ERROR("failed to create checkpoint directory '" << checkpoint_directory << "'");
            return false;
        }
        auto *const resolved_path = omega_util_normalize_path(checkpoint_directory, nullptr);
        if (resolved_path == nullptr) {
            LOG_ERROR("failed to resolve checkpoint_directory path '" << checkpoint_directory << "' to absolute path");
            return false;
        }
        try {
            checkpoint_directory_str.assign(resolved_path);
        } catch (const std::bad_alloc &) { return false; }
        return true;
    }

    auto create_session_with_backing_file_(FILE *file_ptr, const char *file_path, const char *checkpoint_file_name,
                                           const std::string &checkpoint_directory,
                                           int64_t original_file_modification_time,
                                           bool original_file_modification_time_valid, omega_session_event_cbk_t cbk,
                                           void *user_data_ptr, int32_t event_interest) -> omega_session_t * {
        int64_t file_size = 0;
        if (file_ptr != nullptr) {
            if (0 != FSEEK(file_ptr, 0L, SEEK_END)) {
                FCLOSE(file_ptr);
                return nullptr;
            }
            file_size = FTELL(file_ptr);
        }
        omega_session_t *session_ptr = nullptr;
        try {
            session_ptr = new omega_session_t;
            session_ptr->checkpoint_directory_ = checkpoint_directory;
            session_ptr->event_handler = cbk;
            session_ptr->user_data_ptr = user_data_ptr;
            session_ptr->event_interest_ = event_interest;
            session_ptr->num_changes_adjustment_ = 0;
            session_ptr->original_file_modification_time_ = original_file_modification_time;
            session_ptr->original_file_modification_time_valid_ = original_file_modification_time_valid;
            session_ptr->models_.push_back(std::make_unique<omega_model_t>());
            if (file_ptr != nullptr) {
                session_ptr->models_.back()->file_ptr = file_ptr;
                if (file_path != nullptr) { session_ptr->models_.back()->file_path.assign(file_path); }
                if (checkpoint_file_name != nullptr) {
                    session_ptr->checkpoint_file_name_.assign(checkpoint_file_name);
                }
            }
            if (!initialize_model_segments_(session_ptr->models_.back()->model_segments, file_size)) {
                if (file_ptr != nullptr) {
                    FCLOSE(file_ptr);
                    session_ptr->models_.back()->file_ptr = nullptr;
                    file_ptr = nullptr;
                }
                delete session_ptr;
                return nullptr;
            }
            omega_session_notify(session_ptr, SESSION_EVT_CREATE, nullptr);
            return session_ptr;
        } catch (const std::bad_alloc &) {
            if (file_ptr != nullptr) { FCLOSE(file_ptr); }
            delete session_ptr;
            return nullptr;
        }
    }

    auto reserve_output_path_(const char *requested_path, int mode, char *reserved_path,
                              size_t reserved_path_size) -> FILE * {
        if (!requested_path || !*requested_path || !reserved_path || reserved_path_size == 0) {
            errno = EINVAL;
            return nullptr;
        }

        auto open_reserved_path = [mode](const char *candidate) -> FILE * {
            const auto fd = OPEN(candidate, O_CREAT | O_EXCL | O_WRONLY | O_BINARY, mode);
            if (fd < 0) { return nullptr; }
            CLOSE(fd);
            const auto file_ptr = FOPEN(candidate, "wb");
            if (!file_ptr) {
                omega_util_remove_file(candidate);
                return nullptr;
            }
            return file_ptr;
        };

        auto copy_reserved_path = [reserved_path, reserved_path_size](const char *candidate) {
            const auto path_len = strlen(candidate);
            if (path_len >= reserved_path_size) {
                errno = ENAMETOOLONG;
                return false;
            }
            memcpy(reserved_path, candidate, path_len + 1);
            return true;
        };

        if (copy_reserved_path(requested_path)) {
            if (const auto file_ptr = open_reserved_path(reserved_path)) { return file_ptr; }
            if (errno != EEXIST) { return nullptr; }
        }

        const auto *const dirname = omega_util_dirname(requested_path, nullptr);
        const auto *const extension = omega_util_file_extension(requested_path, nullptr);
        const auto *const basename = omega_util_basename(requested_path, nullptr, 1);
        if (!dirname || !extension || !basename) {
            errno = EINVAL;
            return nullptr;
        }

        for (int suffix = 1; suffix < OMEGA_OUTPUT_PATH_SUFFIX_ATTEMPTS; ++suffix) {
            const auto count =
                    dirname[0] != '\0'
                            ? snprintf(reserved_path, reserved_path_size, "%s%c%s-%d%s", dirname,
                                       omega_util_directory_separator(), basename, suffix, extension)
                            : snprintf(reserved_path, reserved_path_size, "%s-%d%s", basename, suffix, extension);
            if (count < 0 || static_cast<size_t>(count) >= reserved_path_size) {
                errno = ENAMETOOLONG;
                return nullptr;
            }

            if (const auto file_ptr = open_reserved_path(reserved_path)) { return file_ptr; }
            if (errno != EEXIST) { return nullptr; }
        }

        errno = EEXIST;
        return nullptr;
    }

    auto original_file_modified_since_last_sync_(omega_session_t *session_ptr, const char *file_path) -> bool {
        if (!session_ptr || !file_path || !*file_path || !session_ptr->original_file_modification_time_valid_) {
            return false;
        }

        int64_t modification_time = 0;
        if (0 != omega_util_get_modification_time(file_path, &modification_time)) { return false; }
        return modification_time > session_ptr->original_file_modification_time_;
    }

    auto refresh_original_file_modification_time_(omega_session_t *session_ptr, const char *file_path) -> int {
        if (!session_ptr || !file_path || !*file_path) { return -1; }

        int64_t modification_time = 0;
        const auto result = omega_util_get_modification_time(file_path, &modification_time);
        if (result != 0) {
            session_ptr->original_file_modification_time_valid_ = false;
            return result;
        }

        session_ptr->original_file_modification_time_ = modification_time;
        session_ptr->original_file_modification_time_valid_ = true;
        return 0;
    }

    auto initialize_model_segments_(omega_model_segments_t &model_segments, int64_t length) -> bool {
        try {
            omega_model_segments_t replacement_segments;
            if (0 >= length) {
                model_segments = std::move(replacement_segments);
                return true;
            }
            const auto change_ptr = std::make_shared<omega_change_t>();
            change_ptr->serial = 0;
            change_ptr->kind = (uint8_t) (change_kind_t::CHANGE_INSERT);
            change_ptr->offset = 0;
            change_ptr->length = length;
            auto read_segment_ptr = std::make_unique<omega_model_segment_t>();
            read_segment_ptr->change_ptr = change_ptr;
            read_segment_ptr->computed_offset = 0;
            read_segment_ptr->change_offset = read_segment_ptr->change_ptr->offset;
            read_segment_ptr->computed_length = read_segment_ptr->change_ptr->length;
            replacement_segments.push_back(std::move(read_segment_ptr));
            model_segments = std::move(replacement_segments);
            return true;
        } catch (const std::bad_alloc &) { return false; }
    }

    int64_t write_file_segment_(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr,
                                omega_byte_t *io_buf);

    auto replace_bytes_impl_(omega_session_t *session_ptr, int64_t offset, int64_t delete_length,
                             const omega_byte_t *bytes, int64_t insert_length) -> int64_t {
        if (!session_ptr) { return -1; }
        if (!valid_nonnegative_range_(offset, delete_length) || insert_length < 0) { return 0; }
        if (!bytes && insert_length > 0) { return -1; }
        if (delete_length == 0 && insert_length == 0) { return 0; }
        if (delete_length == 0) { return omega_edit_insert_bytes(session_ptr, offset, bytes, insert_length); }
        if (insert_length == 0) { return omega_edit_delete(session_ptr, offset, delete_length); }
        if (delete_length == insert_length) {
            return omega_edit_overwrite_bytes(session_ptr, offset, bytes, insert_length);
        }

        const auto callbacks_were_paused = omega_session_viewport_event_callbacks_paused(session_ptr) != 0;
        if (!callbacks_were_paused) { omega_session_pause_viewport_event_callbacks(session_ptr); }

        const scoped_transaction_t transaction_scope(session_ptr);
        if (!transaction_scope.ok()) {
            restore_viewport_callbacks_(session_ptr, callbacks_were_paused, false);
            return -1;
        }

        int64_t last_serial = 0;
        bool changed = false;
        bool success = false;

        do {
            const auto delete_serial = omega_edit_delete(session_ptr, offset, delete_length);
            if (delete_serial <= 0) { break; }
            last_serial = delete_serial;
            changed = true;

            const auto insert_serial = omega_edit_insert_bytes(session_ptr, offset, bytes, insert_length);
            if (insert_serial <= 0) {
                if (0 >= omega_edit_undo_last_change(session_ptr)) { break; }
                changed = false;
                break;
            }
            last_serial = insert_serial;
            changed = true;
            success = true;
        } while (false);

        restore_viewport_callbacks_(session_ptr, callbacks_were_paused, changed);
        return success ? last_serial : 0;
    }

    auto apply_script_op_(omega_session_t *session_ptr, const omega_edit_script_op_t &op) -> int64_t {
        switch (op.kind) {
            case OMEGA_EDIT_SCRIPT_DELETE:
                return (op.length > 0) ? omega_edit_delete(session_ptr, op.offset, op.length) : 0;
            case OMEGA_EDIT_SCRIPT_INSERT:
                return (op.bytes_length > 0)
                               ? omega_edit_insert_bytes(session_ptr, op.offset, op.bytes, op.bytes_length)
                               : 0;
            case OMEGA_EDIT_SCRIPT_OVERWRITE: {
                if (op.length < 0 || op.bytes_length < 0) { return -1; }
                if ((op.length > 0) && (op.bytes_length > 0) && (op.length != op.bytes_length)) { return -1; }
                const auto overwrite_length = op.bytes_length > 0 ? op.bytes_length : op.length;
                return (overwrite_length > 0)
                               ? omega_edit_overwrite_bytes(session_ptr, op.offset, op.bytes, overwrite_length)
                               : 0;
            }
            case OMEGA_EDIT_SCRIPT_REPLACE:
                return replace_bytes_impl_(session_ptr, op.offset, op.length, op.bytes, op.bytes_length);
            default:
                return -1;
        }
    }

    struct replace_match_stats_t {
        int64_t replacements = 0;
        int64_t deletes = 0;
        int64_t inserts = 0;
        int64_t overwrites = 0;
    };

    void append_optimized_replace_ops_(std::vector<omega_edit_script_op_t> &ops, replace_match_stats_t &stats,
                                       int64_t offset, const omega_byte_t *pattern, int64_t pattern_length,
                                       const omega_byte_t *replacement, int64_t replacement_length,
                                       bool overwrite_only) {
        ++stats.replacements;

        if (overwrite_only) {
            if (!replacement || replacement_length <= 0) { return; }
            const omega_edit_script_op_t op{offset, replacement_length, OMEGA_EDIT_SCRIPT_OVERWRITE, replacement,
                                            replacement_length};
            ops.push_back(op);
            ++stats.overwrites;
            return;
        }

        int64_t prefix_length = 0;
        while (prefix_length < pattern_length && prefix_length < replacement_length &&
               pattern[prefix_length] == replacement[prefix_length]) {
            ++prefix_length;
        }

        int64_t suffix_length = 0;
        while (suffix_length < pattern_length - prefix_length && suffix_length < replacement_length - prefix_length &&
               pattern[pattern_length - 1 - suffix_length] == replacement[replacement_length - 1 - suffix_length]) {
            ++suffix_length;
        }

        const auto remove_length = pattern_length - prefix_length - suffix_length;
        const auto insert_length = replacement_length - prefix_length - suffix_length;
        if (remove_length == 0 && insert_length == 0) { return; }

        const auto *insert_bytes = (insert_length > 0) ? replacement + prefix_length : nullptr;
        if (!valid_nonnegative_range_(offset, prefix_length)) { return; }
        const auto op_offset = offset + prefix_length;

        if (remove_length == 0) {
            const omega_edit_script_op_t op{op_offset, 0, OMEGA_EDIT_SCRIPT_INSERT, insert_bytes, insert_length};
            ops.push_back(op);
            ++stats.inserts;
            return;
        }

        if (insert_length == 0) {
            const omega_edit_script_op_t op{op_offset, remove_length, OMEGA_EDIT_SCRIPT_DELETE, nullptr, 0};
            ops.push_back(op);
            ++stats.deletes;
            return;
        }

        if (remove_length == insert_length) {
            const omega_edit_script_op_t op{op_offset, remove_length, OMEGA_EDIT_SCRIPT_OVERWRITE, insert_bytes,
                                            insert_length};
            ops.push_back(op);
            ++stats.overwrites;
            return;
        }

        const omega_edit_script_op_t op{op_offset, remove_length, OMEGA_EDIT_SCRIPT_REPLACE, insert_bytes,
                                        insert_length};
        ops.push_back(op);
        ++stats.deletes;
        ++stats.inserts;
    }

    inline void update_viewport_offset_adjustment_(omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr) {
        assert(0 < change_ptr->length);
        const auto offset = omega_viewport_get_offset(viewport_ptr);
        if (offset < 0) { return; }
        if ((omega_viewport_is_floating(viewport_ptr) != 0) && change_ptr->offset <= offset) {
            if (change_kind_t::CHANGE_DELETE == omega_change_get_kind_(change_ptr)) {
                int64_t adjusted = 0;
                if (!safe_add_int64_(viewport_ptr->data_segment.offset_adjustment, -change_ptr->length, adjusted)) {
                    adjusted = -viewport_ptr->data_segment.offset;
                }
                int64_t adjusted_offset = 0;
                if (!safe_add_int64_(viewport_ptr->data_segment.offset, adjusted, adjusted_offset) ||
                    adjusted_offset < 0) {
                    adjusted = -viewport_ptr->data_segment.offset;
                }
                viewport_ptr->data_segment.offset_adjustment = adjusted;
            } else if (change_kind_t::CHANGE_INSERT == omega_change_get_kind_(change_ptr)) {
                int64_t adjusted = 0;
                int64_t adjusted_offset = 0;
                if (safe_add_int64_(viewport_ptr->data_segment.offset_adjustment, change_ptr->length, adjusted) &&
                    safe_add_int64_(viewport_ptr->data_segment.offset, adjusted, adjusted_offset)) {
                    viewport_ptr->data_segment.offset_adjustment = adjusted;
                } else {
                    viewport_ptr->data_segment.offset_adjustment =
                            (std::numeric_limits<int64_t>::max)() - viewport_ptr->data_segment.offset;
                }
            }
        }
    }

    inline bool change_affects_viewport_(const omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr) {
        assert(0 < change_ptr->length);
        switch (omega_change_get_kind_(change_ptr)) {
            case change_kind_t::CHANGE_DELETE:// deliberate fall-through
            case change_kind_t::CHANGE_INSERT: {
                const auto viewport_offset = omega_viewport_get_offset(viewport_ptr);
                int64_t viewport_end = 0;
                return viewport_offset >= 0 &&
                       safe_add_int64_(viewport_offset, omega_viewport_get_capacity(viewport_ptr), viewport_end) &&
                       change_ptr->offset <= viewport_end;
            }
            case change_kind_t::CHANGE_OVERWRITE:
                return omega_viewport_in_segment(viewport_ptr, change_ptr->offset, change_ptr->length) != 0;
            default:
                ABORT(LOG_ERROR("Unhandled change kind"););
        }
    }

    auto update_viewports_(const omega_session_t *session_ptr, const omega_change_t *change_ptr) -> int {
        for (auto &&viewport_ptr : session_ptr->viewports_) {
            update_viewport_offset_adjustment_(viewport_ptr.get(), change_ptr);
            if (change_affects_viewport_(viewport_ptr.get(), change_ptr)) {
                viewport_ptr->data_segment.capacity =
                        -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
                omega_viewport_notify(viewport_ptr.get(),
                                      (0 < omega_change_get_serial(change_ptr)) ? VIEWPORT_EVT_EDIT : VIEWPORT_EVT_UNDO,
                                      change_ptr);
            }
        }
        return 0;
    }

    inline auto clone_model_segment_(const omega_model_segment_ptr_t &segment_ptr) -> omega_model_segment_ptr_t {
        auto result = std::make_unique<omega_model_segment_t>();
        result->computed_offset = segment_ptr->computed_offset;
        result->computed_length = segment_ptr->computed_length;
        result->change_offset = segment_ptr->change_offset;
        result->change_ptr = segment_ptr->change_ptr;
        return result;
    }

    inline auto clone_model_segments_(const omega_model_segments_t &segments) -> omega_model_segments_t {
        omega_model_segments_t result;
        result.reserve(segments.size());
        for (const auto &seg : segments) { result.push_back(clone_model_segment_(seg)); }
        return result;
    }

    inline void free_model_changes_(omega_model_struct *model_ptr) {
        model_ptr->model_snapshots.clear();
        model_ptr->changes.clear();
    }

    inline void free_model_changes_undone_(omega_model_struct *model_ptr) {
        for (const auto &change_ptr : model_ptr->changes_undone) {
            if (omega_change_get_kind_(change_ptr.get()) == change_kind_t::CHANGE_TRANSFORM &&
                change_ptr->transform_data && !change_ptr->transform_data->checkpoint_file_path.empty()) {
                if (0 != omega_util_remove_file(change_ptr->transform_data->checkpoint_file_path.c_str())) {
                    LOG_ERRNO();
                }
            }
        }
        model_ptr->changes_undone.clear();
    }

    inline void free_session_changes_(const omega_session_t *session_ptr) {
        for (auto &&model_ptr : session_ptr->models_) { free_model_changes_(model_ptr.get()); }
    }

    inline void free_session_changes_undone_(const omega_session_t *session_ptr) {
        for (auto &&model_ptr : session_ptr->models_) { free_model_changes_undone_(model_ptr.get()); }
    }

    auto update_model_helper_(omega_model_t *model_ptr, const const_omega_change_ptr_t &change_ptr) -> int {
        if (!change_ptr) { return -1; }
        assert(change_ptr->length > 0);
        try {
            model_ptr->model_segments.reserve(model_ptr->model_segments.size() + 2);
        } catch (const std::bad_alloc &) { return -1; }
        int64_t read_offset = 0;

        if (model_ptr->model_segments.empty()) {
            if (omega_change_get_kind_(change_ptr.get()) != change_kind_t::CHANGE_DELETE) {
                auto insert_segment_ptr = std::make_unique<omega_model_segment_t>();
                insert_segment_ptr->computed_offset = change_ptr->offset;
                insert_segment_ptr->computed_length = change_ptr->length;
                insert_segment_ptr->change_offset = 0;
                insert_segment_ptr->change_ptr = change_ptr;
                model_ptr->model_segments.push_back(std::move(insert_segment_ptr));
            }
            return 0;
        }
        for (auto iter = model_ptr->model_segments.begin(); iter != model_ptr->model_segments.end(); ++iter) {
            int64_t segment_end = 0;
            if (!safe_add_int64_((*iter)->computed_offset, (*iter)->computed_length, segment_end)) { return -1; }
            if (read_offset != (*iter)->computed_offset) {
                ABORT(print_model_segments_(model_ptr, CLOG);
                      LOG_ERROR("break in model continuity, expected: " << read_offset
                                                                        << ", got: " << (*iter)->computed_offset););
            }
            if (change_ptr->offset >= read_offset && change_ptr->offset <= segment_end) {
                if (change_ptr->offset != read_offset) {
                    const auto delta = change_ptr->offset - (*iter)->computed_offset;
                    if (delta == (*iter)->computed_length) {
                        ++iter;
                    } else {
                        auto split_segment_ptr = clone_model_segment_(*iter);
                        if (!safe_add_int64_(split_segment_ptr->computed_offset, delta,
                                             split_segment_ptr->computed_offset) ||
                            !safe_add_int64_(split_segment_ptr->change_offset, delta,
                                             split_segment_ptr->change_offset)) {
                            return -1;
                        }
                        split_segment_ptr->computed_length -= delta;
                        (*iter)->computed_length = delta;
                        iter = model_ptr->model_segments.insert(iter + 1, std::move(split_segment_ptr));
                    }
                }
                switch (omega_change_get_kind_(change_ptr.get())) {
                    case change_kind_t::CHANGE_DELETE: {
                        auto delete_length = change_ptr->length;
                        while (delete_length && iter != model_ptr->model_segments.end()) {
                            if ((*iter)->computed_length <= delete_length) {
                                delete_length -= (*iter)->computed_length;
                                iter = model_ptr->model_segments.erase(iter);
                            } else {
                                (*iter)->computed_length -= delete_length;
                                if (!safe_add_int64_((*iter)->computed_offset, delete_length - change_ptr->length,
                                                     (*iter)->computed_offset) ||
                                    !safe_add_int64_((*iter)->change_offset, delete_length, (*iter)->change_offset)) {
                                    return -1;
                                }
                                assert((*iter)->change_offset < (*iter)->change_ptr->length);
                                delete_length = 0;
                                ++iter;// move to the next segment for adjusting
                            }
                        }
                        for (; iter != model_ptr->model_segments.end(); ++iter) {
                            if (!safe_add_int64_((*iter)->computed_offset, -change_ptr->length,
                                                 (*iter)->computed_offset)) {
                                return -1;
                            }
                        }
                        break;
                    }
                    case change_kind_t::CHANGE_OVERWRITE:// deliberate fall-through
                    case change_kind_t::CHANGE_INSERT: {
                        auto insert_segment_ptr = std::make_unique<omega_model_segment_t>();
                        insert_segment_ptr->computed_offset = change_ptr->offset;
                        insert_segment_ptr->computed_length = change_ptr->length;
                        insert_segment_ptr->change_offset = 0;
                        insert_segment_ptr->change_ptr = change_ptr;
                        iter = model_ptr->model_segments.insert(iter, std::move(insert_segment_ptr));
                        for (++iter; iter != model_ptr->model_segments.end(); ++iter) {
                            if (!safe_add_int64_((*iter)->computed_offset, change_ptr->length,
                                                 (*iter)->computed_offset)) {
                                return -1;
                            }
                        }
                        break;
                    }
                    default:
                        ABORT(LOG_ERROR("Unhandled change kind"););
                }
                return 0;
            }
            if (!safe_add_int64_(read_offset, (*iter)->computed_length, read_offset)) { return -1; }
        }
        return -1;
    }

    auto update_model_(omega_session_t *session_ptr, const const_omega_change_ptr_t &change_ptr) -> int {
        if (omega_change_get_kind_(change_ptr.get()) == change_kind_t::CHANGE_TRANSFORM) { return 0; }
        const auto model_ptr = session_ptr->models_.back().get();
        if (omega_change_get_kind_(change_ptr.get()) == change_kind_t::CHANGE_OVERWRITE) {
            const_omega_change_ptr_t const_change_ptr =
                    del_(0, change_ptr->offset, change_ptr->length, !omega_session_get_transaction_bit_(session_ptr));
            if (!const_change_ptr) { return -1; }
            const auto rc = update_model_helper_(model_ptr, const_change_ptr);
            if (0 != rc) { return rc; }
        }
        return update_model_helper_(model_ptr, change_ptr);
    }

    auto rebuild_model_to_change_count_(omega_session_t *session_ptr, int64_t remaining_count) -> int {
        if (!session_ptr) { return -1; }

        auto *const model_ptr = session_ptr->models_.back().get();
        auto &snapshots = model_ptr->model_snapshots;
        auto cleanup_it = snapshots.upper_bound(remaining_count);
        snapshots.erase(cleanup_it, snapshots.end());

        int64_t replay_from = 0;
        if (!snapshots.empty()) {
            auto snap_it = snapshots.upper_bound(remaining_count);
            if (snap_it != snapshots.begin()) {
                --snap_it;
                try {
                    model_ptr->model_segments = clone_model_segments_(snap_it->second);
                } catch (const std::bad_alloc &) { return -1; }
                replay_from = snap_it->first;
            } else {
                int64_t length = 0;
                if (model_ptr->file_ptr != nullptr) {
                    if (0 != FSEEK(model_ptr->file_ptr, 0L, SEEK_END)) { return -1; }
                    length = FTELL(model_ptr->file_ptr);
                }
                if (!initialize_model_segments_(model_ptr->model_segments, length)) { return -1; }
            }
        } else {
            int64_t length = 0;
            if (model_ptr->file_ptr != nullptr) {
                if (0 != FSEEK(model_ptr->file_ptr, 0L, SEEK_END)) { return -1; }
                length = FTELL(model_ptr->file_ptr);
            }
            if (!initialize_model_segments_(model_ptr->model_segments, length)) { return -1; }
        }

        for (auto i = replay_from; i < remaining_count; ++i) {
            if (0 > update_model_(session_ptr, model_ptr->changes[i])) { return -1; }
        }
        return 0;
    }

    auto update_(omega_session_t *session_ptr, const const_omega_change_ptr_t &change_ptr) -> int64_t {
        if (!change_ptr) { return -1; }
        if (change_ptr->offset <= omega_session_get_computed_file_size(session_ptr)) {
            const auto change_serial = omega_change_get_serial(change_ptr.get());
            if (change_serial == 0 || change_serial == (std::numeric_limits<int64_t>::min)()) { return -1; }
            auto serial_was_negative = false;
            if (change_serial < 0) {
                change_ptr->serial *= -1;
                serial_was_negative = true;
            } else if (!session_ptr->models_.back()->changes_undone.empty()) {
                free_session_changes_undone_(session_ptr);
            }
            auto *const model_ptr = session_ptr->models_.back().get();
            try {
                model_ptr->changes.push_back(change_ptr);
            } catch (const std::bad_alloc &) {
                if (serial_was_negative) { change_ptr->serial *= -1; }
                return -1;
            }
            if (0 != update_model_(session_ptr, change_ptr)) {
                model_ptr->changes.pop_back();
                if (serial_was_negative) { change_ptr->serial *= -1; }
                return -1;
            }
            if (session_ptr->undo_snapshot_interval_ > 0) {
                const auto count = static_cast<int64_t>(model_ptr->changes.size());
                if (count % session_ptr->undo_snapshot_interval_ == 0) {
                    try {
                        model_ptr->model_snapshots[count] = clone_model_segments_(model_ptr->model_segments);
                    } catch (const std::bad_alloc &) { model_ptr->model_snapshots.erase(count); }
                }
            }
            update_viewports_(session_ptr, change_ptr.get());
            omega_session_notify(session_ptr, SESSION_EVT_EDIT, change_ptr.get());
            return omega_change_get_serial(change_ptr.get());
        }
        return -1;
    }

    size_t checkpoint_snapshot_change_count_(const omega_model_t *model_ptr) {
        if (!model_ptr || model_ptr->changes.empty()) { return 0; }
        const auto &first_change_ptr = model_ptr->changes.front();
        if (omega_change_get_kind_(first_change_ptr.get()) != change_kind_t::CHANGE_TRANSFORM ||
            !first_change_ptr->transform_data) {
            return 0;
        }
        return first_change_ptr->transform_data->checkpoint_file_path == model_ptr->file_path ? 1U : 0U;
    }

    void notify_checkpoint_restore_(omega_session_t *session_ptr) {
        for (const auto &viewport_ptr : session_ptr->viewports_) {
            viewport_ptr->data_segment.capacity =
                    -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
            omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_CHANGES, nullptr);
        }
        omega_session_notify(session_ptr, SESSION_EVT_RESTORE_CHECKPOINT, nullptr);
    }

    inline auto determine_change_transaction_bit_(omega_session_t *session_ptr) -> bool {
        switch (omega_session_get_transaction_state(session_ptr)) {
            case 0:
                return !omega_session_get_transaction_bit_(session_ptr);
            case 1:
                session_ptr->session_flags_ |= SESSION_FLAGS_SESSION_TRANSACTION_IN_PROGRESS;
                return !omega_session_get_transaction_bit_(session_ptr);
            case 2:
                return omega_session_get_transaction_bit_(session_ptr);
            default:
                ABORT(LOG_ERROR("Invalid transaction state"););
                return false;
        }
    }

    auto create_checkpoint_file_(omega_session_t *session_ptr, char *checkpoint_filename,
                                 size_t checkpoint_filename_size) -> int {
        if (!session_ptr || !checkpoint_filename || checkpoint_filename_size == 0) { return -1; }
        const auto *const checkpoint_directory = omega_session_get_checkpoint_directory(session_ptr);
        if (omega_util_directory_exists(checkpoint_directory) == 0) {
            LOG_ERROR("checkpoint directory '" << checkpoint_directory << "' does not exist");
            return -1;
        }
        const auto snprintf_result =
                snprintf(checkpoint_filename, checkpoint_filename_size, "%s%c.OmegaEdit-chk.%zu.XXXXXX",
                         checkpoint_directory, omega_util_directory_separator(), session_ptr->models_.size());
        if (snprintf_result < 0 || static_cast<size_t>(snprintf_result) >= checkpoint_filename_size) {
            LOG_ERROR("failed to create checkpoint filename template");
            return -1;
        }
        const auto checkpoint_fd = omega_util_mkstemp(checkpoint_filename, 0600);// S_IRUSR | S_IWUSR
        if (checkpoint_fd < 0) {
            LOG_ERROR("omega_util_mkstemp failed for checkpoint file '" << checkpoint_filename << "'");
            return -1;
        }
        close(checkpoint_fd);
        return 0;
    }

    auto promote_checkpoint_file_(omega_session_t *session_ptr, const char *checkpoint_filename, int64_t file_size,
                                  bool notify_transform,
                                  const const_omega_change_ptr_t &transform_change_ptr = nullptr) -> int64_t {
        if (!session_ptr || !checkpoint_filename) { return -1; }
        if (file_size < 0) {
            omega_util_remove_file(checkpoint_filename);
            return -1;
        }
        const auto change_serial_base = omega_session_get_num_changes(session_ptr);
        if (transform_change_ptr && omega_change_get_serial(transform_change_ptr.get()) != change_serial_base + 1) {
            omega_util_remove_file(checkpoint_filename);
            return -1;
        }

        std::unique_ptr<omega_model_t> checkpoint_model_ptr;
        try {
            checkpoint_model_ptr = std::make_unique<omega_model_t>();
            checkpoint_model_ptr->change_serial_base = change_serial_base;
            checkpoint_model_ptr->file_path = checkpoint_filename;
            if (!initialize_model_segments_(checkpoint_model_ptr->model_segments, file_size)) {
                omega_util_remove_file(checkpoint_filename);
                return -1;
            }
            if (transform_change_ptr) { checkpoint_model_ptr->changes.push_back(transform_change_ptr); }
        } catch (const std::bad_alloc &) {
            omega_util_remove_file(checkpoint_filename);
            return -1;
        }

        auto *checkpoint_file_ptr = FOPEN(checkpoint_filename, "rb");
        if (checkpoint_file_ptr == nullptr) {
            LOG_ERROR("failed to open checkpoint file '" << checkpoint_filename << "'");
            omega_util_remove_file(checkpoint_filename);
            return -1;
        }

        checkpoint_model_ptr->file_ptr = checkpoint_file_ptr;
        try {
            session_ptr->models_.push_back(std::move(checkpoint_model_ptr));
        } catch (const std::bad_alloc &) {
            FCLOSE(checkpoint_file_ptr);
            omega_util_remove_file(checkpoint_filename);
            return -1;
        }

        session_ptr->num_changes_adjustment_ = change_serial_base;
        omega_session_notify(session_ptr, SESSION_EVT_CREATE_CHECKPOINT, nullptr);

        if (notify_transform) {
            for (const auto &viewport_ptr : session_ptr->viewports_) {
                viewport_ptr->data_segment.capacity =
                        -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
                omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_TRANSFORM,
                                      transform_change_ptr ? transform_change_ptr.get() : nullptr);
            }
            omega_session_notify(session_ptr, SESSION_EVT_TRANSFORM,
                                 transform_change_ptr ? transform_change_ptr.get() : nullptr);
        }
        return transform_change_ptr ? omega_change_get_serial(transform_change_ptr.get()) : 0;
    }

    auto initialize_session_stream_cursor_(const omega_session_t *session_ptr, int64_t offset,
                                           session_stream_cursor_t &cursor) -> bool {
        if (!session_ptr || offset < 0) { return false; }
        const auto &segments = session_ptr->models_.back()->model_segments;
        cursor.session_ptr = session_ptr;
        cursor.segment_end = segments.cend();
        cursor.offset = offset;
        cursor.segment_iter = std::upper_bound(segments.cbegin(), segments.cend(), offset,
                                               [](int64_t logical_offset, const omega_model_segment_ptr_t &segment) {
                                                   return logical_offset < segment->computed_offset;
                                               });
        if (cursor.segment_iter != segments.cbegin()) { --cursor.segment_iter; }
        while (cursor.segment_iter != cursor.segment_end) {
            int64_t segment_end = 0;
            if (!safe_add_int64_((*cursor.segment_iter)->computed_offset, (*cursor.segment_iter)->computed_length,
                                 segment_end)) {
                return false;
            }
            if (segment_end > offset) { break; }
            ++cursor.segment_iter;
        }
        return true;
    }

    auto stream_session_range_(session_stream_cursor_t &cursor, int64_t end_offset, FILE *to_file_ptr,
                               omega_byte_t *io_buf) -> int64_t {
        if (!cursor.session_ptr || end_offset < cursor.offset) { return -1; }
        int64_t processed = 0;
        while (cursor.offset < end_offset) {
            if (cursor.segment_iter == cursor.segment_end) { return -1; }
            const auto &segment = *cursor.segment_iter;
            int64_t segment_end = 0;
            if (!safe_add_int64_(segment->computed_offset, segment->computed_length, segment_end)) { return -1; }
            if (segment_end <= cursor.offset) {
                ++cursor.segment_iter;
                continue;
            }
            if (segment->computed_offset > cursor.offset) {
                ABORT(LOG_ERROR("break in model continuity, expected at most: " << cursor.offset << ", got: "
                                                                                << segment->computed_offset););
                return -1;
            }

            const auto segment_start = std::max(cursor.offset - segment->computed_offset, int64_t(0));
            const auto segment_length = std::min(end_offset - cursor.offset, segment->computed_length - segment_start);
            if (to_file_ptr != nullptr) {
                switch (omega_model_segment_get_kind_(segment.get())) {
                    case model_segment_kind_t::SEGMENT_READ: {
                        if (cursor.session_ptr->models_.back()->file_ptr == nullptr) {
                            ABORT(LOG_ERROR("attempt to read segment from null file pointer"););
                            return -1;
                        }
                        int64_t source_offset = 0;
                        if (!safe_add_int64_(segment->change_offset, segment_start, source_offset)) { return -1; }
                        if (write_file_segment_(cursor.session_ptr->models_.back()->file_ptr, source_offset,
                                                segment_length, to_file_ptr, io_buf) != segment_length) {
                            LOG_ERROR("write_file_segment_ failed");
                            return -1;
                        }
                        break;
                    }
                    case model_segment_kind_t::SEGMENT_INSERT: {
                        int64_t source_offset = 0;
                        if (!safe_add_int64_(segment->change_offset, segment_start, source_offset)) { return -1; }
                        if (static_cast<int64_t>(
                                    fwrite(omega_change_get_bytes(segment->change_ptr.get()) + source_offset,
                                           sizeof(omega_byte_t), segment_length, to_file_ptr)) != segment_length) {
                            LOG_ERROR("fwrite failed");
                            return -1;
                        }
                        break;
                    }
                    default:
                        ABORT(LOG_ERROR("Unhandled segment kind"););
                        return -1;
                }
            }

            if (!safe_add_int64_(cursor.offset, segment_length, cursor.offset) ||
                !safe_add_int64_(processed, segment_length, processed)) {
                return -1;
            }
            int64_t segment_consumed = 0;
            if (!safe_add_int64_(segment_start, segment_length, segment_consumed)) { return -1; }
            if (segment_consumed >= segment->computed_length) { ++cursor.segment_iter; }
        }
        return processed;
    }

    auto write_bytes_to_file_(FILE *file_ptr, const omega_byte_t *bytes, int64_t length) -> int64_t {
        if (!file_ptr || length < 0 || (!bytes && length > 0)) { return -1; }
        if (length == 0) { return 0; }
        int64_t written = 0;
        while (written < length) {
            const auto count = std::min(length - written, OMEGA_IO_BUFFER_SIZE);
            if (static_cast<int64_t>(fwrite(bytes + written, sizeof(omega_byte_t), count, file_ptr)) != count) {
                break;
            }
            if (!safe_add_int64_(written, count, written)) { break; }
        }
        return written == length ? written : -1;
    }

    auto replace_bytes_checkpointed_(omega_session_t *session_ptr, int64_t offset, int64_t delete_length,
                                     const omega_byte_t *bytes, int64_t insert_length,
                                     const char *transform_id = nullptr,
                                     const char *options_json = nullptr) -> int64_t {
        if (!session_ptr || !valid_nonnegative_range_(offset, delete_length) || insert_length < 0) { return -1; }
        if (!bytes && insert_length > 0) { return -1; }
        if (omega_session_changes_paused(session_ptr) != 0) { return -1; }

        const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
        if (computed_file_size < 0 || offset > computed_file_size) { return -1; }
        const auto adjusted_delete_length = std::min(delete_length, computed_file_size - offset);
        if (adjusted_delete_length == 0 && insert_length == 0) { return 0; }

        int64_t size_after_delete = 0;
        int64_t checkpoint_file_size = 0;
        if (!safe_add_int64_(computed_file_size, -adjusted_delete_length, size_after_delete) ||
            !safe_add_int64_(size_after_delete, insert_length, checkpoint_file_size)) {
            return -1;
        }
        const auto is_transform = transform_id && *transform_id;
        std::unique_ptr<omega_byte_t[]> io_buf;
        try {
            io_buf = std::make_unique<omega_byte_t[]>(OMEGA_IO_BUFFER_SIZE);
        } catch (const std::bad_alloc &) { return -1; }

        char checkpoint_filename[FILENAME_MAX + 1];
        if (0 != create_checkpoint_file_(session_ptr, checkpoint_filename, sizeof(checkpoint_filename))) { return -1; }

        auto *checkpoint_fptr = FOPEN(checkpoint_filename, "wb");
        if (checkpoint_fptr == nullptr) {
            omega_util_remove_file(checkpoint_filename);
            return -1;
        }

        session_stream_cursor_t cursor;
        auto rc = 0;
        if (!initialize_session_stream_cursor_(session_ptr, 0, cursor)) {
            rc = -1;
        } else if (stream_session_range_(cursor, offset, checkpoint_fptr, io_buf.get()) != offset) {
            rc = -1;
        } else if (write_bytes_to_file_(checkpoint_fptr, bytes, insert_length) != insert_length) {
            rc = -1;
        } else {
            int64_t delete_end = 0;
            if (!safe_add_int64_(offset, adjusted_delete_length, delete_end) ||
                stream_session_range_(cursor, delete_end, nullptr, io_buf.get()) != adjusted_delete_length) {
                rc = -1;
            } else {
                const auto remaining_suffix = computed_file_size - cursor.offset;
                if (stream_session_range_(cursor, computed_file_size, checkpoint_fptr, io_buf.get()) !=
                    remaining_suffix) {
                    rc = -1;
                }
            }
        }

        FCLOSE(checkpoint_fptr);
        if (rc != 0 || omega_util_file_size(checkpoint_filename) != checkpoint_file_size) {
            omega_util_remove_file(checkpoint_filename);
            return -1;
        }

        const_omega_change_ptr_t transform_change_ptr;
        if (is_transform) {
            transform_change_ptr =
                    transform_(next_change_serial_(session_ptr), offset, adjusted_delete_length, transform_id,
                               options_json, insert_length, computed_file_size, checkpoint_file_size,
                               checkpoint_filename, determine_change_transaction_bit_(session_ptr));
            if (!transform_change_ptr) {
                omega_util_remove_file(checkpoint_filename);
                return -1;
            }
        }

        const auto serial = promote_checkpoint_file_(session_ptr, checkpoint_filename, checkpoint_file_size, true,
                                                     transform_change_ptr);
        if (serial < 0) { return -1; }
        return is_transform ? serial : 0;
    }

    int64_t write_file_segment_(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr,
                                omega_byte_t *io_buf) {
        if (!from_file_ptr || !to_file_ptr) { return -1; }
        if (0 != FSEEK(from_file_ptr, offset, SEEK_SET)) { return -1; }
        int64_t remaining = byte_count;
        while (remaining) {
            const auto count = std::min(remaining, OMEGA_IO_BUFFER_SIZE);
            if (count != static_cast<int64_t>(fread(io_buf, sizeof(omega_byte_t), count, from_file_ptr)) ||
                count != static_cast<int64_t>(fwrite(io_buf, sizeof(omega_byte_t), count, to_file_ptr))) {
                break;
            }
            remaining -= count;
        }
        return byte_count - remaining;
    }

    int64_t write_segment_to_file_transformed_(FILE *from_file_ptr, int64_t offset, int64_t byte_count,
                                               FILE *to_file_ptr, int64_t file_write_pos,
                                               omega_util_byte_transform_t transform, void *user_data_ptr,
                                               int64_t transform_file_begin, int64_t transform_file_end,
                                               omega_byte_t *io_buf) {
        if (!from_file_ptr || !to_file_ptr) { return -1; }
        if (0 != FSEEK(from_file_ptr, offset, SEEK_SET)) { return -1; }
        int64_t remaining = byte_count;
        while (remaining) {
            const auto count = std::min(remaining, OMEGA_IO_BUFFER_SIZE);
            if (count != static_cast<int64_t>(fread(io_buf, sizeof(omega_byte_t), count, from_file_ptr))) { break; }
            if (transform) {
                const auto buf_begin = file_write_pos;
                int64_t buf_end = 0;
                if (!safe_add_int64_(file_write_pos, count, buf_end)) { break; }
                if (buf_begin < transform_file_end && buf_end > transform_file_begin) {
                    const auto t_start = std::max(transform_file_begin - buf_begin, int64_t(0));
                    const auto t_end = std::min(transform_file_end - buf_begin, count);
                    omega_util_apply_byte_transform(io_buf + t_start, t_end - t_start, transform, user_data_ptr);
                }
            }
            if (count != static_cast<int64_t>(fwrite(io_buf, sizeof(omega_byte_t), count, to_file_ptr))) { break; }
            remaining -= count;
            if (!safe_add_int64_(file_write_pos, count, file_write_pos)) { break; }
        }
        return byte_count - remaining;
    }

    int save_segment_transformed_(omega_session_t *session_ptr, const char *file_path,
                                  omega_util_byte_transform_t transform, void *user_data_ptr, int64_t transform_offset,
                                  int64_t transform_length) {
        if (!session_ptr || !file_path || !transform) { return -1; }
        if (transform_offset < 0) { return -1; }
        const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
        if (computed_file_size < 0) { return -1; }
        const auto adjusted_transform_length =
                transform_length <= 0 ? computed_file_size - transform_offset
                                      : std::min(transform_length, computed_file_size - transform_offset);
        if (adjusted_transform_length < 0) { return -1; }
        const auto transform_file_begin = transform_offset;
        int64_t transform_file_end = 0;
        if (!safe_add_int64_(transform_offset, adjusted_transform_length, transform_file_end)) { return -1; }
        std::unique_ptr<omega_byte_t[]> io_buf;
        try {
            io_buf = std::make_unique<omega_byte_t[]>(OMEGA_IO_BUFFER_SIZE);
        } catch (const std::bad_alloc &) { return -1; }

        const auto temp_fptr = FOPEN(file_path, "wb");
        if (!temp_fptr) {
            LOG_ERRNO();
            return -1;
        }
        int64_t write_offset = 0;
        int64_t file_write_pos = 0;
        for (const auto &segment : session_ptr->models_.back()->model_segments) {
            if (write_offset != segment->computed_offset) {
                ABORT(LOG_ERROR("break in model continuity, expected: " << write_offset
                                                                        << ", got: " << segment->computed_offset););
            }
            switch (omega_model_segment_get_kind_(segment.get())) {
                case model_segment_kind_t::SEGMENT_READ: {
                    if (session_ptr->models_.back()->file_ptr == nullptr) {
                        ABORT(LOG_ERROR("attempt to read segment from null file pointer"););
                    }
                    if (write_segment_to_file_transformed_(
                                session_ptr->models_.back()->file_ptr, segment->change_offset, segment->computed_length,
                                temp_fptr, file_write_pos, transform, user_data_ptr, transform_file_begin,
                                transform_file_end, io_buf.get()) != segment->computed_length) {
                        FCLOSE(temp_fptr);
                        LOG_ERROR("write_segment_to_file_transformed_ failed");
                        return -1;
                    }
                    break;
                }
                case model_segment_kind_t::SEGMENT_INSERT: {
                    const auto *src = omega_change_get_bytes(segment->change_ptr.get()) + segment->change_offset;
                    const auto len = segment->computed_length;
                    int64_t segment_file_end = 0;
                    if (!safe_add_int64_(file_write_pos, len, segment_file_end)) {
                        FCLOSE(temp_fptr);
                        return -1;
                    }
                    if (file_write_pos < transform_file_end && segment_file_end > transform_file_begin) {
                        int64_t seg_remaining = len;
                        int64_t seg_offset = 0;
                        while (seg_remaining > 0) {
                            const auto chunk = std::min(seg_remaining, OMEGA_IO_BUFFER_SIZE);
                            memcpy(io_buf.get(), src + seg_offset, chunk);
                            int64_t buf_begin = 0;
                            if (!safe_add_int64_(file_write_pos, seg_offset, buf_begin)) {
                                FCLOSE(temp_fptr);
                                return -1;
                            }
                            int64_t buf_end = 0;
                            if (!safe_add_int64_(buf_begin, chunk, buf_end)) {
                                FCLOSE(temp_fptr);
                                return -1;
                            }
                            if (buf_begin < transform_file_end && buf_end > transform_file_begin) {
                                const auto t_start = std::max(transform_file_begin - buf_begin, int64_t(0));
                                const auto t_end = std::min(transform_file_end - buf_begin, chunk);
                                omega_util_apply_byte_transform(io_buf.get() + t_start, t_end - t_start, transform,
                                                                user_data_ptr);
                            }
                            if (static_cast<int64_t>(fwrite(io_buf.get(), 1, chunk, temp_fptr)) != chunk) {
                                FCLOSE(temp_fptr);
                                LOG_ERROR("fwrite failed");
                                return -1;
                            }
                            seg_remaining -= chunk;
                            if (!safe_add_int64_(seg_offset, chunk, seg_offset)) {
                                FCLOSE(temp_fptr);
                                return -1;
                            }
                        }
                    } else {
                        if (static_cast<int64_t>(fwrite(src, 1, len, temp_fptr)) != len) {
                            FCLOSE(temp_fptr);
                            LOG_ERROR("fwrite failed");
                            return -1;
                        }
                    }
                    break;
                }
                default:
                    ABORT(LOG_ERROR("Unhandled segment kind"););
            }
            if (!safe_add_int64_(file_write_pos, segment->computed_length, file_write_pos) ||
                !safe_add_int64_(write_offset, segment->computed_length, write_offset)) {
                FCLOSE(temp_fptr);
                return -1;
            }
        }
        FCLOSE(temp_fptr);
        if (file_write_pos != computed_file_size) {
            LOG_ERROR("failed to write all bytes, expected: " << computed_file_size << ", got: " << file_write_pos);
            return -1;
        }
        return 0;
    }

    int64_t apply_transform_checkpointed_(omega_session_t *session_ptr, omega_util_byte_transform_t byte_transform,
                                          void *user_data_ptr, int64_t offset, int64_t length, const char *transform_id,
                                          const char *options_json) {
        if (!session_ptr || !byte_transform || offset < 0) { return -1; }
        if (omega_session_changes_paused(session_ptr) != 0) { return -1; }

        const auto file_size_before = omega_session_get_computed_file_size(session_ptr);
        if (file_size_before < 0 || offset > file_size_before) { return -1; }
        const auto effective_length =
                length <= 0 ? file_size_before - offset : std::min(length, file_size_before - offset);
        if (effective_length < 0) { return -1; }

        char checkpoint_filename[FILENAME_MAX + 1];
        if (0 != create_checkpoint_file_(session_ptr, checkpoint_filename, sizeof(checkpoint_filename))) { return -1; }

        if (0 != save_segment_transformed_(session_ptr, checkpoint_filename, byte_transform, user_data_ptr, offset,
                                           effective_length)) {
            LOG_ERROR("save_segment_transformed_ failed");
            omega_util_remove_file(checkpoint_filename);
            return -1;
        }

        const auto file_size_after = omega_session_get_computed_file_size(session_ptr);
        const auto transform_change_ptr =
                transform_(next_change_serial_(session_ptr), offset, effective_length, transform_id, options_json,
                           effective_length, file_size_before, file_size_after, checkpoint_filename,
                           determine_change_transaction_bit_(session_ptr));
        if (!transform_change_ptr) {
            omega_util_remove_file(checkpoint_filename);
            return -1;
        }

        const auto serial =
                promote_checkpoint_file_(session_ptr, checkpoint_filename, file_size_after, true, transform_change_ptr);
        if (serial < 0) { return -1; }
        return serial;
    }

    void mark_all_viewports_changed_(omega_session_t *session_ptr, omega_viewport_event_t event,
                                     const omega_change_t *change_ptr) {
        for (const auto &viewport_ptr : session_ptr->viewports_) {
            viewport_ptr->data_segment.capacity =
                    -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
            omega_viewport_notify(viewport_ptr.get(), event, change_ptr);
        }
    }

    int64_t undo_transform_checkpoint_(omega_session_t *session_ptr) {
        if (!session_ptr || omega_session_get_num_checkpoints(session_ptr) <= 0) { return 0; }
        auto *const transform_model_ptr = session_ptr->models_.back().get();
        if (transform_model_ptr->changes.empty()) { return 0; }
        const auto change_ptr = transform_model_ptr->changes.back();
        if (omega_change_get_kind_(change_ptr.get()) != change_kind_t::CHANGE_TRANSFORM) { return 0; }
        auto *const previous_model_ptr = session_ptr->models_[session_ptr->models_.size() - 2].get();
        try {
            previous_model_ptr->changes_undone.reserve(previous_model_ptr->changes_undone.size() + 1);
        } catch (const std::bad_alloc &) { return -1; }

        transform_model_ptr->changes.pop_back();
        free_model_changes_undone_(transform_model_ptr);
        FCLOSE(transform_model_ptr->file_ptr);
        session_ptr->models_.pop_back();
        session_ptr->num_changes_adjustment_ = session_ptr->models_.back()->change_serial_base;

        auto *const undone_change_ptr = change_ptr.get();
        if (undone_change_ptr->serial <= 0) { return -1; }
        undone_change_ptr->serial *= -1;
        previous_model_ptr->changes_undone.push_back(change_ptr);

        mark_all_viewports_changed_(session_ptr, VIEWPORT_EVT_UNDO, undone_change_ptr);
        omega_session_notify(session_ptr, SESSION_EVT_UNDO, undone_change_ptr);
        return undone_change_ptr->serial;
    }

    int64_t redo_transform_checkpoint_(omega_session_t *session_ptr) {
        if (!session_ptr || session_ptr->models_.back()->changes_undone.empty()) { return 0; }
        auto &undone_changes = session_ptr->models_.back()->changes_undone;
        const auto change_ptr = undone_changes.back();
        if (omega_change_get_kind_(change_ptr.get()) != change_kind_t::CHANGE_TRANSFORM ||
            !change_ptr->transform_data || change_ptr->transform_data->checkpoint_file_path.empty()) {
            return 0;
        }

        const auto checkpoint_file_size = change_ptr->transform_data->computed_file_size_after;
        if (checkpoint_file_size < 0) { return -1; }
        const auto change_serial_base = omega_session_get_num_changes(session_ptr);
        auto *const redone_change_ptr = change_ptr.get();
        if (redone_change_ptr->serial >= 0) { return -1; }
        const auto redone_serial = -redone_change_ptr->serial;
        if (redone_serial != change_serial_base + 1) { return -1; }

        std::unique_ptr<omega_model_t> checkpoint_model_ptr;
        try {
            checkpoint_model_ptr = std::make_unique<omega_model_t>();
            checkpoint_model_ptr->change_serial_base = change_serial_base;
            checkpoint_model_ptr->file_path = change_ptr->transform_data->checkpoint_file_path;
            if (!initialize_model_segments_(checkpoint_model_ptr->model_segments, checkpoint_file_size)) { return -1; }
            checkpoint_model_ptr->changes.push_back(change_ptr);
        } catch (const std::bad_alloc &) { return -1; }

        auto *checkpoint_file = FOPEN(change_ptr->transform_data->checkpoint_file_path.c_str(), "rb");
        if (!checkpoint_file) { return -1; }
        checkpoint_model_ptr->file_ptr = checkpoint_file;
        try {
            session_ptr->models_.push_back(std::move(checkpoint_model_ptr));
        } catch (const std::bad_alloc &) {
            FCLOSE(checkpoint_file);
            return -1;
        }

        redone_change_ptr->serial = redone_serial;
        undone_changes.pop_back();
        session_ptr->num_changes_adjustment_ = change_serial_base;

        mark_all_viewports_changed_(session_ptr, VIEWPORT_EVT_EDIT, redone_change_ptr);
        omega_session_notify(session_ptr, SESSION_EVT_EDIT, redone_change_ptr);
        return redone_change_ptr->serial;
    }
}// namespace

omega_session_t *omega_edit_create_session(const char *file_path, omega_session_event_cbk_t cbk, void *user_data_ptr,
                                           int32_t event_interest, const char *checkpoint_directory) {
    std::string checkpoint_directory_str;
    if (!resolve_checkpoint_directory_(file_path, checkpoint_directory, checkpoint_directory_str)) { return nullptr; }
    FILE *file_ptr = nullptr;
    char checkpoint_filename[FILENAME_MAX + 1];
    int64_t original_file_modification_time = 0;
    bool original_file_modification_time_valid = false;
    if ((file_path != nullptr) && file_path[0] != '\0') {
        if (FILENAME_MAX <= snprintf(static_cast<char *>(checkpoint_filename), FILENAME_MAX,
                                     "%s%c.OmegaEdit-orig.XXXXXX", checkpoint_directory_str.c_str(),
                                     omega_util_directory_separator())) {
            LOG_ERROR("failed to create original checkpoint filename template");
            return nullptr;
        }
        const auto mode = 0600;// S_IRUSR | S_IWUSR
        const auto checkpoint_fd = omega_util_mkstemp(static_cast<char *>(checkpoint_filename), mode);
        if (checkpoint_fd < 0) {
            LOG_ERROR("omega_util_mkstemp failed for original checkpoint file '"
                      << static_cast<char *>(checkpoint_filename) << "'");
            return nullptr;
        }
        CLOSE(checkpoint_fd);
        if (0 != omega_util_file_copy(file_path, static_cast<char *>(checkpoint_filename), mode)) {
            LOG_ERROR("failed to copy original file '" << file_path << "' to checkpoint file '"
                                                       << static_cast<char *>(checkpoint_filename) << "'");
            omega_util_remove_file(checkpoint_filename);
            return nullptr;
        }
        if (0 != omega_util_get_modification_time(file_path, &original_file_modification_time)) {
            LOG_ERROR("failed to read original file modification time for '" << file_path << "'");
            omega_util_remove_file(checkpoint_filename);
            return nullptr;
        }
        original_file_modification_time_valid = true;
        file_ptr = FOPEN(checkpoint_filename, "rb");
        if (file_ptr == nullptr) {
            omega_util_remove_file(checkpoint_filename);
            return nullptr;
        }
    }
    auto *const session_ptr = create_session_with_backing_file_(
            file_ptr, file_path, checkpoint_filename, checkpoint_directory_str, original_file_modification_time,
            original_file_modification_time_valid, cbk, user_data_ptr, event_interest);
    if (session_ptr == nullptr && file_ptr != nullptr) { omega_util_remove_file(checkpoint_filename); }
    return session_ptr;
}

omega_session_t *omega_edit_create_session_from_bytes(const omega_byte_t *data_ptr, int64_t length,
                                                      omega_session_event_cbk_t cbk, void *user_data_ptr,
                                                      int32_t event_interest, const char *checkpoint_directory) {
    if (length < 0 || (length > 0 && data_ptr == nullptr)) { return nullptr; }

    std::string checkpoint_directory_str;
    if (!resolve_checkpoint_directory_(nullptr, checkpoint_directory, checkpoint_directory_str)) { return nullptr; }

    char checkpoint_filename[FILENAME_MAX + 1];
    if (FILENAME_MAX <= snprintf(static_cast<char *>(checkpoint_filename), FILENAME_MAX, "%s%c.OmegaEdit-bytes.XXXXXX",
                                 checkpoint_directory_str.c_str(), omega_util_directory_separator())) {
        LOG_ERROR("failed to create memory-backed checkpoint filename template");
        return nullptr;
    }

    const auto checkpoint_fd = omega_util_mkstemp(static_cast<char *>(checkpoint_filename), 0600);// S_IRUSR | S_IWUSR
    if (checkpoint_fd < 0) {
        LOG_ERROR("omega_util_mkstemp failed for memory-backed checkpoint file '"
                  << static_cast<char *>(checkpoint_filename) << "'");
        return nullptr;
    }
    close(checkpoint_fd);

    auto *file_ptr = FOPEN(checkpoint_filename, "wb");
    if (file_ptr == nullptr) {
        omega_util_remove_file(checkpoint_filename);
        return nullptr;
    }
    if ((length > 0) && (static_cast<int64_t>(fwrite(data_ptr, sizeof(omega_byte_t), length, file_ptr)) != length)) {
        FCLOSE(file_ptr);
        omega_util_remove_file(checkpoint_filename);
        return nullptr;
    }
    FCLOSE(file_ptr);

    file_ptr = FOPEN(checkpoint_filename, "rb");
    if (file_ptr == nullptr) {
        omega_util_remove_file(checkpoint_filename);
        return nullptr;
    }

    auto *const session_ptr =
            create_session_with_backing_file_(file_ptr, nullptr, checkpoint_filename, checkpoint_directory_str, 0,
                                              false, cbk, user_data_ptr, event_interest);
    if (session_ptr == nullptr) { omega_util_remove_file(checkpoint_filename); }
    return session_ptr;
}

void omega_edit_destroy_session(omega_session_t *session_ptr) {
    if (!session_ptr) { return; }
    for (const auto &model_ptr : session_ptr->models_) {
        if (model_ptr->file_ptr) { FCLOSE(model_ptr->file_ptr); }
    }
    while (!session_ptr->search_contexts_.empty()) {
        omega_search_destroy_context(session_ptr->search_contexts_.back().get());
    }
    while (!session_ptr->viewports_.empty()) { omega_edit_destroy_viewport(session_ptr->viewports_.back().get()); }
    free_session_changes_(session_ptr);
    free_session_changes_undone_(session_ptr);
    while (omega_session_get_num_checkpoints(session_ptr) != 0) {
        if (0 != omega_util_remove_file(session_ptr->models_.back()->file_path.c_str())) { LOG_ERRNO(); }
        session_ptr->models_.pop_back();
    }
    if (!session_ptr->checkpoint_file_name_.empty() &&
        0 != omega_util_remove_file(session_ptr->checkpoint_file_name_.c_str())) {
        LOG_ERRNO();
    }
    delete session_ptr;
}

omega_viewport_t *omega_edit_create_viewport(omega_session_t *session_ptr, int64_t offset, int64_t capacity,
                                             int is_floating, omega_viewport_event_cbk_t cbk, void *user_data_ptr,
                                             int32_t event_interest) {
    int64_t viewport_end = 0;
    if (session_ptr && offset >= 0 && capacity > 0 && capacity <= OMEGA_VIEWPORT_CAPACITY_LIMIT &&
        safe_add_int64_(offset, capacity, viewport_end)) {
        try {
            const auto viewport_ptr = std::make_shared<omega_viewport_t>();
            viewport_ptr->session_ptr = session_ptr;
            viewport_ptr->data_segment.offset = offset;
            viewport_ptr->data_segment.offset_adjustment = 0;
            viewport_ptr->data_segment.is_floating = (bool) is_floating;
            viewport_ptr->data_segment.capacity = -1 * capacity;// Negative capacity indicates dirty read
            viewport_ptr->data_segment.length = 0;
            omega_data_create_(&viewport_ptr->data_segment.data, capacity);
            viewport_ptr->event_handler = cbk;
            viewport_ptr->user_data_ptr = user_data_ptr;
            viewport_ptr->event_interest_ = event_interest;
            omega_segment_get_data(&viewport_ptr->data_segment)[0] = '\0';
            session_ptr->viewports_.push_back(viewport_ptr);
            omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_CREATE, session_ptr->viewports_.back().get());
            omega_session_notify(session_ptr, SESSION_EVT_CREATE_VIEWPORT, session_ptr->viewports_.back().get());
            return session_ptr->viewports_.back().get();
        } catch (const std::bad_alloc &) { return nullptr; }
    }
    return nullptr;
}

void omega_edit_destroy_viewport(omega_viewport_t *viewport_ptr) {
    if (!viewport_ptr) { return; }
    for (auto iter = viewport_ptr->session_ptr->viewports_.rbegin();
         iter != viewport_ptr->session_ptr->viewports_.rend(); ++iter) {
        if (viewport_ptr == iter->get()) {
            auto *const session_ptr = viewport_ptr->session_ptr;
            omega_data_destroy_(&(*iter)->data_segment.data, omega_viewport_get_capacity(iter->get()));
            session_ptr->viewports_.erase(std::next(iter).base());
            omega_session_notify(session_ptr, SESSION_EVT_DESTROY_VIEWPORT, viewport_ptr);
            break;
        }
    }
}

int64_t omega_edit_delete(omega_session_t *session_ptr, int64_t offset, int64_t length) {
    if (!session_ptr) { return -1; }
    if (!valid_nonnegative_range_(offset, length)) { return -1; }
    if (length == 0) { return 0; }
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    if (computed_file_size < 0) { return -1; }
    const auto serial = next_change_serial_(session_ptr);
    if (serial <= 0) { return -1; }
    return (omega_session_changes_paused(session_ptr) == 0) && 0 < length && offset < computed_file_size
                   ? update_(session_ptr,
                             del_(serial, offset, std::min(length, static_cast<int64_t>(computed_file_size) - offset),
                                  determine_change_transaction_bit_(session_ptr)))
                   : 0;
}

int64_t omega_edit_insert_bytes(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes,
                                int64_t length) {
    if (!session_ptr) { return -1; }
    if (!valid_nonnegative_range_(offset, length)) { return -1; }
    if (length == 0) { return 0; }
    if (!bytes) { return -1; }
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    if (computed_file_size < 0) { return -1; }
    if (add_overflows_int64_(computed_file_size, length)) { return -1; }
    const auto serial = next_change_serial_(session_ptr);
    if (serial <= 0) { return -1; }
    return (omega_session_changes_paused(session_ptr) == 0) && offset <= computed_file_size
                   ? update_(session_ptr,
                             ins_(serial, offset, bytes, length, determine_change_transaction_bit_(session_ptr)))
                   : 0;
}

int64_t omega_edit_insert(omega_session_t *session_ptr, int64_t offset, const char *cstr, int64_t length) {
    if (!cstr) { return -1; }
    const auto cstr_length = (length == 0) ? static_cast<int64_t>(strlen(cstr)) : length;
    return omega_edit_insert_bytes(session_ptr, offset, (const omega_byte_t *) cstr, cstr_length);
}

int64_t omega_edit_overwrite_bytes(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes,
                                   int64_t length) {
    if (!session_ptr) { return -1; }
    if (!valid_nonnegative_range_(offset, length)) { return -1; }
    if (length == 0) { return 0; }
    if (!bytes) { return -1; }
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    if (computed_file_size < 0) { return -1; }
    const auto serial = next_change_serial_(session_ptr);
    if (serial <= 0) { return -1; }
    return (omega_session_changes_paused(session_ptr) == 0) && offset <= computed_file_size
                   ? update_(session_ptr,
                             ovr_(serial, offset, bytes, length, determine_change_transaction_bit_(session_ptr)))
                   : 0;
}

int64_t omega_edit_overwrite(omega_session_t *session_ptr, int64_t offset, const char *cstr, int64_t length) {
    if (!cstr) { return -1; }
    const auto cstr_length = (length == 0) ? static_cast<int64_t>(strlen(cstr)) : length;
    return omega_edit_overwrite_bytes(session_ptr, offset, (const omega_byte_t *) cstr, cstr_length);
}

int64_t omega_edit_replace_bytes(omega_session_t *session_ptr, int64_t offset, int64_t delete_length,
                                 const omega_byte_t *bytes, int64_t insert_length) {
    return replace_bytes_impl_(session_ptr, offset, delete_length, bytes, insert_length);
}

int omega_edit_replace_bytes_checkpointed(omega_session_t *session_ptr, int64_t offset, int64_t delete_length,
                                          const omega_byte_t *bytes, int64_t insert_length) {
    return replace_bytes_checkpointed_(session_ptr, offset, delete_length, bytes, insert_length);
}

int64_t omega_edit_replace_bytes_as_transform(omega_session_t *session_ptr, int64_t offset, int64_t delete_length,
                                              const omega_byte_t *bytes, int64_t insert_length,
                                              const char *transform_id, const char *options_json) {
    return replace_bytes_checkpointed_(session_ptr, offset, delete_length, bytes, insert_length, transform_id,
                                       options_json);
}

int64_t omega_edit_replace(omega_session_t *session_ptr, int64_t offset, int64_t delete_length, const char *cstr,
                           int64_t insert_length) {
    if (offset < 0 || delete_length < 0 || insert_length < 0) { return -1; }
    if (!cstr) {
        return (insert_length == 0) ? omega_edit_replace_bytes(session_ptr, offset, delete_length, nullptr, 0) : -1;
    }
    const auto cstr_length = (insert_length == 0) ? static_cast<int64_t>(strlen(cstr)) : insert_length;
    return omega_edit_replace_bytes(session_ptr, offset, delete_length, (const omega_byte_t *) cstr, cstr_length);
}

int omega_edit_replace_matches_bytes(omega_session_t *session_ptr, const omega_byte_t *pattern, int64_t pattern_length,
                                     const omega_byte_t *replacement, int64_t replacement_length, int case_insensitive,
                                     int is_reverse, int64_t offset, int64_t length, int64_t limit, int front_to_back,
                                     int overwrite_only, int64_t *replacement_count_out, int64_t *delete_count_out,
                                     int64_t *insert_count_out, int64_t *overwrite_count_out) {
    if (replacement_count_out != nullptr) { *replacement_count_out = 0; }
    if (delete_count_out != nullptr) { *delete_count_out = 0; }
    if (insert_count_out != nullptr) { *insert_count_out = 0; }
    if (overwrite_count_out != nullptr) { *overwrite_count_out = 0; }

    if (!session_ptr || !pattern || pattern_length <= 0 || offset < 0 || length < 0 || limit < 0 ||
        replacement_length < 0) {
        return -1;
    }
    if (!replacement && replacement_length > 0) { return -1; }
    if (omega_session_changes_paused(session_ptr) != 0) { return -1; }

    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    if (computed_file_size < 0) { return -1; }
    if (offset > computed_file_size) { return -1; }
    const auto adjusted_length =
            length <= 0 ? computed_file_size - offset : std::min(length, computed_file_size - offset);
    if (adjusted_length < 0) { return -1; }
    if (pattern_length > adjusted_length) { return 0; }

    scoped_search_context_t search_context(omega_search_create_context_bytes(
            session_ptr, pattern, pattern_length, offset, adjusted_length, case_insensitive, is_reverse));
    if (!search_context.get()) { return -1; }

    try {
        std::vector<int64_t> match_offsets;
        int64_t last_accepted_offset = -1;
        while ((limit <= 0 || static_cast<int64_t>(match_offsets.size()) < limit) &&
               omega_search_next_match(search_context.get(), 1) > 0) {
            const auto match_offset = omega_search_context_get_match_offset(search_context.get());
            int64_t match_end = 0;
            int64_t last_accepted_end = 0;
            if (!safe_add_int64_(match_offset, pattern_length, match_end) ||
                (!match_offsets.empty() && !safe_add_int64_(last_accepted_offset, pattern_length, last_accepted_end))) {
                return -1;
            }
            const bool overlaps_prior = !match_offsets.empty() && (is_reverse ? (match_end > last_accepted_offset)
                                                                              : (match_offset < last_accepted_end));
            if (overlaps_prior) { continue; }
            match_offsets.push_back(match_offset);
            last_accepted_offset = match_offset;
        }
        search_context.reset();

        if (match_offsets.empty()) { return 0; }

        std::sort(match_offsets.begin(), match_offsets.end(), [front_to_back](const int64_t lhs, const int64_t rhs) {
            return front_to_back ? lhs < rhs : rhs < lhs;
        });

        std::vector<omega_edit_script_op_t> ops;
        ops.reserve(match_offsets.size());
        replace_match_stats_t stats;
        const auto replacement_delta = (overwrite_only != 0) ? 0LL : (replacement_length - pattern_length);
        for (size_t i = 0; i < match_offsets.size(); ++i) {
            int64_t base_offset = match_offsets[i];
            if (front_to_back) {
                const auto match_index = static_cast<int64_t>(i);
                if (replacement_delta != 0 &&
                    (match_index > (std::numeric_limits<int64_t>::max)() / std::llabs(replacement_delta))) {
                    return -1;
                }
                if (!safe_add_int64_(match_offsets[i], replacement_delta * match_index, base_offset)) { return -1; }
            }
            append_optimized_replace_ops_(ops, stats, base_offset, pattern, pattern_length, replacement,
                                          replacement_length, overwrite_only != 0);
        }

        if (!ops.empty() && 0 != omega_edit_apply_script(session_ptr, ops.data(), ops.size())) { return -1; }

        if (replacement_count_out != nullptr) { *replacement_count_out = stats.replacements; }
        if (delete_count_out != nullptr) { *delete_count_out = stats.deletes; }
        if (insert_count_out != nullptr) { *insert_count_out = stats.inserts; }
        if (overwrite_count_out != nullptr) { *overwrite_count_out = stats.overwrites; }
        return 0;
    } catch (const std::bad_alloc &) { return -1; }
}

int omega_edit_replace_matches(omega_session_t *session_ptr, const char *pattern, int64_t pattern_length,
                               const char *replacement, int64_t replacement_length, int case_insensitive,
                               int is_reverse, int64_t offset, int64_t length, int64_t limit, int front_to_back,
                               int overwrite_only, int64_t *replacement_count_out, int64_t *delete_count_out,
                               int64_t *insert_count_out, int64_t *overwrite_count_out) {
    if (!pattern) { return -1; }
    const auto resolved_pattern_length = pattern_length ? pattern_length : static_cast<int64_t>(strlen(pattern));
    if (!replacement) {
        if (replacement_length > 0) { return -1; }
        return omega_edit_replace_matches_bytes(
                session_ptr, reinterpret_cast<const omega_byte_t *>(pattern), resolved_pattern_length, nullptr, 0,
                case_insensitive, is_reverse, offset, length, limit, front_to_back, overwrite_only,
                replacement_count_out, delete_count_out, insert_count_out, overwrite_count_out);
    }
    const auto resolved_replacement_length =
            replacement_length ? replacement_length : static_cast<int64_t>(strlen(replacement));
    return omega_edit_replace_matches_bytes(
            session_ptr, reinterpret_cast<const omega_byte_t *>(pattern), resolved_pattern_length,
            reinterpret_cast<const omega_byte_t *>(replacement), resolved_replacement_length, case_insensitive,
            is_reverse, offset, length, limit, front_to_back, overwrite_only, replacement_count_out, delete_count_out,
            insert_count_out, overwrite_count_out);
}

int omega_edit_replace_all_bytes(omega_session_t *session_ptr, const omega_byte_t *pattern, int64_t pattern_length,
                                 const omega_byte_t *replacement, int64_t replacement_length, int case_insensitive,
                                 int64_t offset, int64_t length, int64_t *replacement_count_out) {
    if (replacement_count_out != nullptr) { *replacement_count_out = 0; }
    if (!session_ptr || !pattern || pattern_length <= 0 || offset < 0 || length < 0 || replacement_length < 0) {
        return -1;
    }
    if (!replacement && replacement_length > 0) { return -1; }
    if (omega_session_changes_paused(session_ptr) != 0) { return -1; }

    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    if (computed_file_size < 0) { return -1; }
    if (offset > computed_file_size) { return -1; }
    const auto adjusted_length =
            length <= 0 ? computed_file_size - offset : std::min(length, computed_file_size - offset);
    if (adjusted_length < 0) { return -1; }
    if (pattern_length > adjusted_length) { return 0; }

    auto *const search_context = omega_search_create_context_bytes(session_ptr, pattern, pattern_length, offset,
                                                                   adjusted_length, case_insensitive, 0);
    if (!search_context) { return -1; }

    if (omega_search_next_match(search_context, pattern_length) == 0) {
        omega_search_destroy_context(search_context);
        return 0;
    }

    std::unique_ptr<omega_byte_t[]> io_buf;
    try {
        io_buf = std::make_unique<omega_byte_t[]>(OMEGA_IO_BUFFER_SIZE);
    } catch (const std::bad_alloc &) {
        omega_search_destroy_context(search_context);
        return -1;
    }

    char checkpoint_filename[FILENAME_MAX + 1];
    if (0 != create_checkpoint_file_(session_ptr, checkpoint_filename, sizeof(checkpoint_filename))) {
        omega_search_destroy_context(search_context);
        return -1;
    }

    auto *checkpoint_fptr = FOPEN(checkpoint_filename, "wb");
    if (checkpoint_fptr == nullptr) {
        omega_search_destroy_context(search_context);
        omega_util_remove_file(checkpoint_filename);
        return -1;
    }

    session_stream_cursor_t cursor;
    if (!initialize_session_stream_cursor_(session_ptr, 0, cursor)) {
        FCLOSE(checkpoint_fptr);
        omega_search_destroy_context(search_context);
        omega_util_remove_file(checkpoint_filename);
        return -1;
    }

    int64_t replace_end = 0;
    if (!safe_add_int64_(offset, adjusted_length, replace_end)) {
        omega_search_destroy_context(search_context);
        FCLOSE(checkpoint_fptr);
        omega_util_remove_file(checkpoint_filename);
        return -1;
    }
    int64_t replacement_count = 0;
    auto rc = 0;

    do {
        const auto prefix_length = offset - cursor.offset;
        if (stream_session_range_(cursor, offset, checkpoint_fptr, io_buf.get()) != prefix_length) {
            rc = -1;
            break;
        }

        do {
            const auto match_offset = omega_search_context_get_match_offset(search_context);
            if (match_offset < cursor.offset) {
                rc = -1;
                break;
            }
            const auto bytes_before_match = match_offset - cursor.offset;
            if (stream_session_range_(cursor, match_offset, checkpoint_fptr, io_buf.get()) != bytes_before_match) {
                rc = -1;
                break;
            }
            if (write_bytes_to_file_(checkpoint_fptr, replacement, replacement_length) != replacement_length) {
                rc = -1;
                break;
            }
            int64_t match_end = 0;
            if (!safe_add_int64_(match_offset, pattern_length, match_end) ||
                stream_session_range_(cursor, match_end, nullptr, io_buf.get()) != pattern_length) {
                rc = -1;
                break;
            }
            ++replacement_count;
        } while (omega_search_next_match(search_context, pattern_length) > 0);

        if (rc != 0) { break; }

        const auto remaining_replace_range = replace_end - cursor.offset;
        if (stream_session_range_(cursor, replace_end, checkpoint_fptr, io_buf.get()) != remaining_replace_range) {
            rc = -1;
            break;
        }

        const auto remaining_suffix = computed_file_size - cursor.offset;
        if (stream_session_range_(cursor, computed_file_size, checkpoint_fptr, io_buf.get()) != remaining_suffix) {
            rc = -1;
            break;
        }
    } while (false);

    omega_search_destroy_context(search_context);
    FCLOSE(checkpoint_fptr);

    if (rc != 0) {
        omega_util_remove_file(checkpoint_filename);
        return rc;
    }

    const auto checkpoint_file_size = omega_util_file_size(checkpoint_filename);
    if (checkpoint_file_size < 0) {
        omega_util_remove_file(checkpoint_filename);
        return -1;
    }
    if (0 != promote_checkpoint_file_(session_ptr, checkpoint_filename, checkpoint_file_size, true)) { return -1; }
    if (replacement_count_out != nullptr) { *replacement_count_out = replacement_count; }
    return 0;
}

int omega_edit_replace_all(omega_session_t *session_ptr, const char *pattern, int64_t pattern_length,
                           const char *replacement, int64_t replacement_length, int case_insensitive, int64_t offset,
                           int64_t length, int64_t *replacement_count_out) {
    if (!pattern) { return -1; }
    const auto resolved_pattern_length = pattern_length ? pattern_length : static_cast<int64_t>(strlen(pattern));
    if (!replacement) {
        if (replacement_length > 0) { return -1; }
        return omega_edit_replace_all_bytes(session_ptr, reinterpret_cast<const omega_byte_t *>(pattern),
                                            resolved_pattern_length, nullptr, 0, case_insensitive, offset, length,
                                            replacement_count_out);
    }
    const auto resolved_replacement_length =
            replacement_length ? replacement_length : static_cast<int64_t>(strlen(replacement));
    return omega_edit_replace_all_bytes(session_ptr, reinterpret_cast<const omega_byte_t *>(pattern),
                                        resolved_pattern_length, reinterpret_cast<const omega_byte_t *>(replacement),
                                        resolved_replacement_length, case_insensitive, offset, length,
                                        replacement_count_out);
}

int omega_edit_apply_script(omega_session_t *session_ptr, const omega_edit_script_op_t *ops, size_t op_count) {
    if (!session_ptr) { return -1; }
    if (!ops && op_count > 0) { return -1; }
    if (op_count == 0) { return 0; }

    const auto callbacks_were_paused = omega_session_viewport_event_callbacks_paused(session_ptr) != 0;
    if (!callbacks_were_paused) { omega_session_pause_viewport_event_callbacks(session_ptr); }

    const auto transaction_state = omega_session_get_transaction_state(session_ptr);
    const scoped_transaction_t transaction_scope(session_ptr);
    if ((transaction_state == 0) && !transaction_scope.ok()) {
        restore_viewport_callbacks_(session_ptr, callbacks_were_paused, false);
        return -1;
    }

    bool changed = false;
    int rc = 0;
    try {
        for (size_t i = 0; i < op_count; ++i) {
            const auto serial = apply_script_op_(session_ptr, ops[i]);
            if (serial < 0) {
                rc = -1;
                break;
            }
            if (serial == 0 &&
                (ops[i].kind == OMEGA_EDIT_SCRIPT_DELETE || ops[i].kind == OMEGA_EDIT_SCRIPT_INSERT ||
                 ops[i].kind == OMEGA_EDIT_SCRIPT_OVERWRITE || ops[i].kind == OMEGA_EDIT_SCRIPT_REPLACE) &&
                (ops[i].length > 0 || ops[i].bytes_length > 0)) {
                rc = -1;
                break;
            }
            if (serial > 0) { changed = true; }
        }
    } catch (const std::bad_alloc &) { rc = -1; }

    restore_viewport_callbacks_(session_ptr, callbacks_were_paused, changed);
    return rc;
}

int omega_edit_apply_builtin_transform(omega_session_t *session_ptr, omega_edit_transform_t transform, int64_t offset,
                                       int64_t length) {
    if (!is_builtin_transform_kind_(transform.kind)) { return -1; }
    try {
        const auto options_json = builtin_transform_options_json_(transform);
        return apply_transform_checkpointed_(session_ptr, apply_builtin_transform_, &transform, offset, length,
                                             builtin_transform_id_(transform.kind),
                                             options_json.empty() ? nullptr : options_json.c_str()) > 0
                       ? 0
                       : -1;
    } catch (const std::bad_alloc &) { return -1; }
}

int omega_edit_apply_transform(omega_session_t *session_ptr, omega_util_byte_transform_t transform, void *user_data_ptr,
                               int64_t offset, int64_t length) {
    return apply_transform_checkpointed_(session_ptr, transform, user_data_ptr, offset, length, "callback", nullptr) > 0
                   ? 0
                   : -1;
}

int omega_edit_save_segment(omega_session_t *session_ptr, const char *file_path, int io_flags, char *saved_file_path,
                            int64_t offset, int64_t length) {
    if (!session_ptr || !file_path || !*file_path || offset < 0) { return -1; }
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    if (computed_file_size < 0) { return -1; }
    const auto adjusted_length =
            length <= 0 ? computed_file_size - offset : std::min(length, computed_file_size - offset);
    if (adjusted_length < 0) {
        LOG_ERROR("invalid offset: " << offset << ", length: " << length << ", adjusted_length: " << adjusted_length
                                     << ", computed_file_size: " << computed_file_size);
        return -1;
    }
    char temp_filename[FILENAME_MAX + 1];
    char reserved_output_path[FILENAME_MAX + 1];
    const auto force_overwrite = io_flags & omega_io_flags_t::IO_FLG_FORCE_OVERWRITE;
    const auto overwrite = force_overwrite || io_flags & omega_io_flags_t::IO_FLG_OVERWRITE;
    const auto *const session_file_path = omega_session_get_file_path(session_ptr);
    const auto mode = omega_util_compute_mode(0666);// S_IRUSR | S_IWUSR | S_IRGRP | S_IWGRP | S_IROTH | S_IWOTH
    if (saved_file_path != nullptr) { saved_file_path[0] = '\0'; }
    std::unique_ptr<omega_byte_t[]> io_buf;
    try {
        io_buf = std::make_unique<omega_byte_t[]>(OMEGA_IO_BUFFER_SIZE);
    } catch (const std::bad_alloc &) { return -6; }

    const auto overwrite_original =
            (overwrite && (session_file_path != nullptr) && (omega_util_file_exists(file_path) != 0) &&
             (omega_util_paths_equivalent(file_path, session_file_path) != 0));

    if (overwrite_original && (force_overwrite == 0) &&
        original_file_modified_since_last_sync_(session_ptr, session_file_path)) {
        LOG_ERROR("original file '" << session_file_path
                                    << "' has been modified since the session was created, save failed (use "
                                       "IO_FLG_FORCE_OVERWRITE to override)");
        return ORIGINAL_MODIFIED;// indicate that the original file has been modified since the session was created
    }

    omega_util_dirname(file_path, temp_filename);
    if (!temp_filename[0]) { omega_util_get_current_dir(temp_filename); }
    if ((omega_util_directory_exists(temp_filename) == 0) && 0 != omega_util_create_directory(temp_filename)) {
        LOG_ERROR("failed to create directory: " << temp_filename);
        return -2;
    }
    const auto *output_path = file_path;
    auto cleanup_output = false;
    FILE *temp_fptr = nullptr;
    if (overwrite) {
        errno = 0;// reset errno
        std::string temp_filename_str;
        try {
            temp_filename_str = temp_filename;
        } catch (const std::bad_alloc &) { return -3; }
        const auto count = temp_filename_str.empty()
                                   ? snprintf(temp_filename, FILENAME_MAX, ".OmegaEdit_XXXXXX")
                                   : snprintf(temp_filename, FILENAME_MAX, "%s%c.OmegaEdit_XXXXXX",
                                              temp_filename_str.c_str(), omega_util_directory_separator());
        if (count < 0 || FILENAME_MAX <= count) {
            LOG_ERRNO();
            return -3;
        }
        const auto temp_fd = omega_util_mkstemp(temp_filename, mode);
        if (temp_fd < 0) {
            LOG_ERROR("mkstemp failed, temp filename: " << temp_filename);
            LOG_ERRNO();
            return -4;
        }
        CLOSE(temp_fd);
        temp_fptr = FOPEN(temp_filename, "wb");
        if (!temp_fptr) {
            LOG_ERRNO();
            omega_util_remove_file(temp_filename);
            return -5;
        }
        output_path = temp_filename;
        cleanup_output = true;
    } else {
        temp_fptr = reserve_output_path_(file_path, mode, reserved_output_path, sizeof(reserved_output_path));
        if (!temp_fptr) {
            LOG_ERROR("failed to reserve unique output file for '" << file_path << "'");
            LOG_ERRNO();
            return -4;
        }
        output_path = reserved_output_path;
        cleanup_output = true;
    }
    int64_t bytes_written = 0;
    auto close_and_cleanup_output = [&]() {
        if (temp_fptr != nullptr) {
            FCLOSE(temp_fptr);
            temp_fptr = nullptr;
        }
        if (cleanup_output) { omega_util_remove_file(output_path); }
    };

    const auto &segments = session_ptr->models_.back()->model_segments;
    auto seg_iter = std::upper_bound(
            segments.cbegin(), segments.cend(), offset,
            [](int64_t off, const omega_model_segment_ptr_t &seg) { return off < seg->computed_offset; });
    if (seg_iter != segments.cbegin()) { --seg_iter; }

    for (; seg_iter != segments.cend() && bytes_written < adjusted_length; ++seg_iter) {
        const auto &segment = *seg_iter;
        int64_t segment_end = 0;
        if (!safe_add_int64_(segment->computed_offset, segment->computed_length, segment_end)) {
            close_and_cleanup_output();
            LOG_ERROR("segment offset overflow");
            return -6;
        }
        if (segment_end <= offset) { continue; }

        const auto segment_start = std::max(offset - segment->computed_offset, int64_t(0));
        const auto segment_length = std::min(adjusted_length - bytes_written, segment->computed_length - segment_start);

        switch (omega_model_segment_get_kind_(segment.get())) {
            case model_segment_kind_t::SEGMENT_READ: {
                if (session_ptr->models_.back()->file_ptr == nullptr) {
                    ABORT(LOG_ERROR("attempt to read segment from null file pointer"););
                }
                int64_t source_offset = 0;
                if (!safe_add_int64_(segment->change_offset, segment_start, source_offset)) {
                    close_and_cleanup_output();
                    return -6;
                }
                if (write_file_segment_(session_ptr->models_.back()->file_ptr, source_offset, segment_length, temp_fptr,
                                        io_buf.get()) != segment_length) {
                    close_and_cleanup_output();
                    LOG_ERROR("write_file_segment_ failed");
                    return -6;
                }
                break;
            }
            case model_segment_kind_t::SEGMENT_INSERT: {
                int64_t source_offset = 0;
                if (!safe_add_int64_(segment->change_offset, segment_start, source_offset)) {
                    close_and_cleanup_output();
                    return -7;
                }
                if (static_cast<int64_t>(fwrite(omega_change_get_bytes(segment->change_ptr.get()) + source_offset, 1,
                                                segment_length, temp_fptr)) != segment_length) {
                    close_and_cleanup_output();
                    LOG_ERROR("fwrite failed");
                    return -7;
                }
                break;
            }
            default:
                ABORT(LOG_ERROR("Unhandled segment kind"););
        }
        if (!safe_add_int64_(bytes_written, segment_length, bytes_written)) {
            close_and_cleanup_output();
            return -8;
        }
    }
    FCLOSE(temp_fptr);
    temp_fptr = nullptr;
    if (bytes_written != adjusted_length) {
        LOG_ERROR("failed to write all requested bytes, expected: " << adjusted_length << ", got: " << bytes_written);
        close_and_cleanup_output();
        return -8;
    }
    if (bytes_written != omega_util_file_size(output_path)) {
        LOG_ERROR("failed to write all requested bytes to '" << output_path << "', expected: " << bytes_written
                                                             << ", got: " << omega_util_file_size(output_path));
        close_and_cleanup_output();
        return -9;
    }
    if (overwrite && omega_util_file_exists(file_path)) {
        if (overwrite) {
            if (0 != omega_util_remove_file(file_path)) {
                LOG_ERRNO();
                omega_util_remove_file(temp_filename);
                return -10;
            }
        }
    }
    if (overwrite && rename(temp_filename, file_path) != 0) {
        LOG_ERRNO();
        omega_util_remove_file(temp_filename);
        return -12;
    }
    cleanup_output = false;
    output_path = overwrite ? file_path : output_path;
    if (overwrite_original) {
        if (0 != refresh_original_file_modification_time_(session_ptr, file_path)) {
            LOG_ERROR("failed to refresh original file modification time: " << file_path);
#ifndef OMEGA_BUILD_WINDOWS// Windows files may not have their modified times updated without elevated privileges
            return -13;
#endif
        }
    }

    if (saved_file_path != nullptr) { omega_util_normalize_path(output_path, saved_file_path); }
    omega_session_notify(session_ptr, SESSION_EVT_SAVE, saved_file_path);
    return 0;
}

int omega_edit_save(omega_session_t *session_ptr, const char *file_path, int io_flags, char *saved_file_path) {
    return omega_edit_save_segment(session_ptr, file_path, io_flags, saved_file_path, 0, 0);
}

int omega_edit_save_segment_to_bytes(const omega_session_t *session_ptr, omega_byte_t **data_ptr_out,
                                     int64_t *length_out, int64_t offset, int64_t length) {
    if (!session_ptr || !data_ptr_out || !length_out || offset < 0 || length < 0) { return -1; }

    *data_ptr_out = nullptr;
    *length_out = 0;

    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    if (computed_file_size < 0) { return -1; }
    if (offset > computed_file_size) { return -1; }

    const auto remaining_length = computed_file_size - offset;
    const auto requested_length = (length == 0 || length > remaining_length) ? remaining_length : length;
    if (requested_length < 0) { return -1; }
    if (requested_length > OMEGA_MEMORY_BUFFER_LIMIT ||
        static_cast<uint64_t>(requested_length) > static_cast<uint64_t>((std::numeric_limits<size_t>::max)() - 1U)) {
        LOG_ERROR("requested byte buffer length exceeds in-memory limit: " << requested_length);
        return -1;
    }

    auto *const data_ptr = static_cast<omega_byte_t *>(malloc(static_cast<size_t>(requested_length) + 1));
    if (data_ptr == nullptr) { return -1; }
    data_ptr[requested_length] = '\0';

    if (requested_length == 0) {
        *data_ptr_out = data_ptr;
        *length_out = 0;
        return 0;
    }

    const auto chunk_capacity = std::min<int64_t>(requested_length, OMEGA_IO_BUFFER_SIZE);
    auto *const segment = omega_segment_create(chunk_capacity);
    if (!segment) {
        free(data_ptr);
        return -1;
    }

    int64_t bytes_copied = 0;
    while (bytes_copied < requested_length) {
        int64_t read_offset = 0;
        if (!safe_add_int64_(offset, bytes_copied, read_offset) ||
            0 != omega_session_get_segment(session_ptr, segment, read_offset)) {
            omega_segment_destroy(segment);
            free(data_ptr);
            return -1;
        }
        const auto segment_length =
                std::min<int64_t>(omega_segment_get_length(segment), requested_length - bytes_copied);
        if (segment_length <= 0) {
            omega_segment_destroy(segment);
            free(data_ptr);
            return -1;
        }
        memcpy(data_ptr + bytes_copied, omega_segment_get_data(segment), static_cast<size_t>(segment_length));
        if (!safe_add_int64_(bytes_copied, segment_length, bytes_copied)) {
            omega_segment_destroy(segment);
            free(data_ptr);
            return -1;
        }
    }

    omega_segment_destroy(segment);
    *data_ptr_out = data_ptr;
    *length_out = requested_length;
    return 0;
}

int omega_edit_save_to_bytes(const omega_session_t *session_ptr, omega_byte_t **data_ptr_out, int64_t *length_out) {
    return omega_edit_save_segment_to_bytes(session_ptr, data_ptr_out, length_out, 0, 0);
}

int omega_edit_clear_changes(omega_session_t *session_ptr) {
    if (!session_ptr) { return -1; }
    int64_t length = 0;
    if (session_ptr->models_.front()->file_ptr != nullptr) {
        if (0 != FSEEK(session_ptr->models_.front()->file_ptr, 0L, SEEK_END)) { return -1; }
        length = FTELL(session_ptr->models_.front()->file_ptr);
    }
    if (!initialize_model_segments_(session_ptr->models_.front()->model_segments, length)) { return -1; }
    free_session_changes_(session_ptr);
    free_session_changes_undone_(session_ptr);
    for (const auto &viewport_ptr : session_ptr->viewports_) {
        viewport_ptr->data_segment.capacity = -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
        omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_CLEAR, nullptr);
    }
    omega_session_notify(session_ptr, SESSION_EVT_CLEAR, nullptr);
    return 0;
}

int64_t omega_edit_undo_last_change(omega_session_t *session_ptr) {
    if (!session_ptr) { return 0; }
    int64_t result = 0;
    const scoped_session_event_batch_t event_batch(session_ptr, SESSION_EVT_UNDO);
    if ((omega_session_changes_paused(session_ptr) == 0) && !session_ptr->models_.back()->changes.empty() &&
        omega_change_get_kind_(session_ptr->models_.back()->changes.back().get()) == change_kind_t::CHANGE_TRANSFORM) {
        return undo_transform_checkpoint_(session_ptr);
    }
    while ((omega_session_changes_paused(session_ptr) == 0) && !session_ptr->models_.back()->changes.empty()) {
        auto *const model_ptr = session_ptr->models_.back().get();
        std::vector<const_omega_change_ptr_t> undone_changes;

        const auto transaction_bit = omega_change_get_transaction_bit_(model_ptr->changes.back().get());
        auto transaction_change_count = size_t{0};
        for (auto iter = model_ptr->changes.rbegin();
             iter != model_ptr->changes.rend() && transaction_bit == omega_change_get_transaction_bit_(iter->get());
             ++iter) {
            ++transaction_change_count;
        }
        try {
            undone_changes.reserve(transaction_change_count);
            model_ptr->changes_undone.reserve(model_ptr->changes_undone.size() + transaction_change_count);
        } catch (const std::bad_alloc &) { return -1; }

        do {
            undone_changes.push_back(model_ptr->changes.back());
            model_ptr->changes.pop_back();
        } while ((omega_session_changes_paused(session_ptr) == 0) && !model_ptr->changes.empty() &&
                 transaction_bit == omega_change_get_transaction_bit_(model_ptr->changes.back().get()));

        const auto remaining_count = static_cast<int64_t>(model_ptr->changes.size());
        if (0 != rebuild_model_to_change_count_(session_ptr, remaining_count)) { return -1; }

        for (const auto &change_ptr : undone_changes) {
            auto *const undone_change_ptr = change_ptr.get();
            if (undone_change_ptr->serial <= 0) { return -1; }
            undone_change_ptr->serial *= -1;

            model_ptr->changes_undone.push_back(change_ptr);
            update_viewports_(session_ptr, undone_change_ptr);
            omega_session_notify(session_ptr, SESSION_EVT_UNDO, undone_change_ptr);

            result = undone_change_ptr->serial;
        }
        break;
    }
    return result;
}

int64_t omega_edit_redo_last_undo(omega_session_t *session_ptr) {
    if (!session_ptr) { return 0; }
    int64_t rc = 0;
    const scoped_session_event_batch_t event_batch(session_ptr, SESSION_EVT_EDIT);
    if ((omega_session_changes_paused(session_ptr) == 0) && !session_ptr->models_.back()->changes_undone.empty() &&
        omega_change_get_kind_(session_ptr->models_.back()->changes_undone.back().get()) ==
                change_kind_t::CHANGE_TRANSFORM) {
        return redo_transform_checkpoint_(session_ptr);
    }
    while ((omega_session_changes_paused(session_ptr) == 0) && !session_ptr->models_.back()->changes_undone.empty()) {
        const auto change_ptr = session_ptr->models_.back()->changes_undone.back();
        rc = update_(session_ptr, change_ptr);
        if (rc < 0) { return rc; }
        session_ptr->models_.back()->changes_undone.pop_back();
        if (!session_ptr->models_.back()->changes_undone.empty() &&
            omega_change_get_transaction_bit_(change_ptr.get()) ==
                    omega_change_get_transaction_bit_(session_ptr->models_.back()->changes_undone.back().get())) {
            continue;
        }
        break;
    }
    return rc;
}

int omega_edit_create_checkpoint(omega_session_t *session_ptr) {
    if (!session_ptr) { return -1; }
    char checkpoint_filename[FILENAME_MAX + 1];
    if (0 != create_checkpoint_file_(session_ptr, checkpoint_filename, sizeof(checkpoint_filename))) { return -1; }
    if (0 != omega_edit_save(session_ptr, checkpoint_filename, IO_FLG_OVERWRITE, nullptr)) {
        LOG_ERROR("failed to save checkpoint to '" << checkpoint_filename << "'");
        omega_util_remove_file(checkpoint_filename);
        return -1;
    }
    const auto file_size = omega_session_get_computed_file_size(session_ptr);
    return promote_checkpoint_file_(session_ptr, checkpoint_filename, file_size, false) == 0 ? 0 : -1;
}

int omega_edit_destroy_last_checkpoint(omega_session_t *session_ptr) {
    if (omega_session_get_num_checkpoints(session_ptr) > 0) {
        auto *const last_checkpoint_ptr = session_ptr->models_.back().get();
        FCLOSE(last_checkpoint_ptr->file_ptr);
        if (0 != omega_util_remove_file(last_checkpoint_ptr->file_path.c_str())) { LOG_ERRNO(); }
        free_model_changes_(last_checkpoint_ptr);
        free_model_changes_undone_(last_checkpoint_ptr);
        session_ptr->models_.pop_back();
        session_ptr->num_changes_adjustment_ = session_ptr->models_.back()->change_serial_base;
        omega_session_notify(session_ptr, SESSION_EVT_DESTROY_CHECKPOINT, nullptr);
        for (const auto &viewport_ptr : session_ptr->viewports_) {
            viewport_ptr->data_segment.capacity =
                    -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
            omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_TRANSFORM, nullptr);
        }
        omega_session_notify(session_ptr, SESSION_EVT_TRANSFORM, nullptr);
        return 0;
    }
    return -1;
}

int omega_edit_restore_last_checkpoint(omega_session_t *session_ptr) {
    if (!session_ptr || omega_session_get_num_checkpoints(session_ptr) <= 0) { return -1; }

    auto *const model_ptr = session_ptr->models_.back().get();
    const auto keep_count = checkpoint_snapshot_change_count_(model_ptr);
    if (model_ptr->changes.size() > keep_count) {
        model_ptr->changes.erase(model_ptr->changes.begin() + static_cast<std::ptrdiff_t>(keep_count),
                                 model_ptr->changes.end());
    }
    free_model_changes_undone_(model_ptr);
    if (0 != rebuild_model_to_change_count_(session_ptr, static_cast<int64_t>(keep_count))) { return -1; }

    session_ptr->num_changes_adjustment_ = session_ptr->models_.back()->change_serial_base;
    notify_checkpoint_restore_(session_ptr);
    return 0;
}
