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
#include "impl_/internal_fun.hpp"
#include "impl_/macros.h"
#include "impl_/model_def.hpp"
#include "impl_/model_segment_def.hpp"
#include "impl_/session_def.hpp"
#include "impl_/viewport_def.hpp"
#include <algorithm>
#include <cassert>
#include <cstdlib>
#include <memory>

#ifdef OMEGA_BUILD_WINDOWS

#include <io.h>

#define close _close
// Undefine Windows min/max macros to avoid conflicts with std::min/max
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
    // 64KB I/O buffer for save and transform operations — reduces system-call overhead vs BUFSIZ (~8KB)
    constexpr int64_t OMEGA_IO_BUFFER_SIZE = 65536;

    void initialize_model_segments_(omega_model_segments_t &model_segments, int64_t length);

    auto resolve_checkpoint_directory_(const char *file_path, const char *checkpoint_directory,
                                       std::string &checkpoint_directory_str) -> bool {
        if (checkpoint_directory == nullptr) {
            // First try to use the directory of the file being edited
            if ((file_path != nullptr) && file_path[0] != '\0') {
                auto *const dirname = omega_util_dirname(file_path, nullptr);
                if (dirname != nullptr) {
                    checkpoint_directory = checkpoint_directory_str.assign(dirname).c_str();
                }
            }
            // If that doesn't work, then try to use the system temp directory
            if (checkpoint_directory == nullptr) {
                auto *const temp_dir = omega_util_get_temp_directory();
                if (temp_dir != nullptr) {
                    checkpoint_directory = checkpoint_directory_str.assign(temp_dir).c_str();
                    free(temp_dir);
                } else {
                    // Finally, if that doesn't work, then use the current working directory
                    auto *const current_dir = omega_util_get_current_dir(nullptr);
                    if (current_dir != nullptr) {
                        checkpoint_directory = checkpoint_directory_str.assign(current_dir).c_str();
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
        checkpoint_directory_str.assign(resolved_path);
        return true;
    }

    auto create_session_with_backing_file_(FILE *file_ptr, const char *file_path, const char *checkpoint_file_name,
                                           const std::string &checkpoint_directory, omega_session_event_cbk_t cbk,
                                           void *user_data_ptr, int32_t event_interest) -> omega_session_t * {
        off_t file_size = 0;
        if (file_ptr != nullptr) {
            if (0 != FSEEK(file_ptr, 0L, SEEK_END)) {
                FCLOSE(file_ptr);
                return nullptr;
            }
            file_size = FTELL(file_ptr);
        }
        auto *const session_ptr = new omega_session_t;
        session_ptr->checkpoint_directory_ = checkpoint_directory;
        session_ptr->event_handler = cbk;
        session_ptr->user_data_ptr = user_data_ptr;
        session_ptr->event_interest_ = event_interest;
        session_ptr->num_changes_adjustment_ = 0;
        session_ptr->models_.push_back(std::make_unique<omega_model_t>());
        if (file_ptr != nullptr) {
            session_ptr->models_.back()->file_ptr = file_ptr;
            if (file_path != nullptr) { session_ptr->models_.back()->file_path.assign(file_path); }
            if (checkpoint_file_name != nullptr) { session_ptr->checkpoint_file_name_.assign(checkpoint_file_name); }
        }
        initialize_model_segments_(session_ptr->models_.back()->model_segments, file_size);
        omega_session_notify(session_ptr, SESSION_EVT_CREATE, nullptr);
        return session_ptr;
    }

    auto reserve_output_path_(const char *requested_path, int mode, char *reserved_path, size_t reserved_path_size)
            -> FILE * {
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

        for (int suffix = 1; suffix < 1000; ++suffix) {
            const auto count = dirname[0] != '\0'
                               ? snprintf(reserved_path, reserved_path_size, "%s%c%s-%d%s",
                                          dirname, omega_util_directory_separator(), basename, suffix, extension)
                               : snprintf(reserved_path, reserved_path_size, "%s-%d%s",
                                          basename, suffix, extension);
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

    void initialize_model_segments_(omega_model_segments_t &model_segments, int64_t length) {
        model_segments.clear();
        if (0 < length) {
            // Model begins with a single READ segment spanning the original file
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
            model_segments.push_back(std::move(read_segment_ptr));
        }
    }

    inline auto del_(int64_t serial, int64_t offset, int64_t length, bool transaction_bit) -> const_omega_change_ptr_t {
        const auto change_ptr = std::make_shared<omega_change_t>();
        change_ptr->serial = serial;
        change_ptr->kind =
                (transaction_bit ? OMEGA_CHANGE_TRANSACTION_BIT : 0x00) | (uint8_t) change_kind_t::CHANGE_DELETE;
        change_ptr->offset = offset;
        change_ptr->length = length;
        change_ptr->data.bytes_ptr = nullptr;
        return change_ptr;
    }

    inline auto ins_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length,
                     bool transaction_bit) -> const_omega_change_ptr_t {
        if (!bytes) { return nullptr; }
        auto change_ptr = std::make_shared<omega_change_t>();
        change_ptr->serial = serial;
        change_ptr->kind =
                (transaction_bit ? OMEGA_CHANGE_TRANSACTION_BIT : 0x00) | (uint8_t) change_kind_t::CHANGE_INSERT;
        change_ptr->offset = offset;
        change_ptr->length = length;
        if (change_ptr->length < DATA_T_SIZE) {
            // small bytes optimization
            memcpy(change_ptr->data.sm_bytes, bytes, change_ptr->length);
            change_ptr->data.sm_bytes[change_ptr->length] = '\0';
        } else {
            // allocate its capacity plus one, so we can null-terminate it
            change_ptr->data.bytes_ptr = new omega_byte_t[change_ptr->length + 1];
            memcpy(change_ptr->data.bytes_ptr, bytes, change_ptr->length);
            change_ptr->data.bytes_ptr[change_ptr->length] = '\0';
        }
        return change_ptr;
    }

    inline auto ovr_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length,
                     bool transaction_bit) -> const_omega_change_ptr_t {
        if (!bytes) { return nullptr; }
        auto change_ptr = std::make_shared<omega_change_t>();
        change_ptr->serial = serial;
        change_ptr->kind =
                (transaction_bit ? OMEGA_CHANGE_TRANSACTION_BIT : 0x00) | (uint8_t) change_kind_t::CHANGE_OVERWRITE;
        change_ptr->offset = offset;
        change_ptr->length = length;
        if (change_ptr->length < DATA_T_SIZE) {
            // small bytes optimization
            memcpy(change_ptr->data.sm_bytes, bytes, change_ptr->length);
            change_ptr->data.sm_bytes[change_ptr->length] = '\0';
        } else {
            // allocate its capacity plus one, so we can null-terminate it
            change_ptr->data.bytes_ptr = new omega_byte_t[change_ptr->length + 1];
            memcpy(change_ptr->data.bytes_ptr, bytes, change_ptr->length);
            change_ptr->data.bytes_ptr[change_ptr->length] = '\0';
        }
        return change_ptr;
    }

    inline auto restore_viewport_callbacks_(omega_session_t *session_ptr, bool callbacks_were_paused,
                                            bool notify_changed_viewports) -> void {
        if (!session_ptr || callbacks_were_paused) { return; }
        omega_session_resume_viewport_event_callbacks(session_ptr);
        if (notify_changed_viewports) { omega_session_notify_changed_viewports(session_ptr); }
    }

    class scoped_transaction_t {
    public:
        explicit scoped_transaction_t(omega_session_t *session_ptr): session_ptr_(session_ptr) {
            if (!session_ptr_) {
                begin_result_ = -1;
                return;
            }
            if (omega_session_get_transaction_state(session_ptr_) == 0) {
                begin_result_ = omega_session_begin_transaction(session_ptr_);
                owns_transaction_ = (begin_result_ == 0);
            }
        }

        ~scoped_transaction_t() {
            if (owns_transaction_) { omega_session_end_transaction(session_ptr_); }
        }

        bool ok() const { return begin_result_ == 0; }

    private:
        omega_session_t *session_ptr_{};
        int begin_result_{0};
        bool owns_transaction_{false};
    };

    class scoped_session_event_batch_t {
    public:
        scoped_session_event_batch_t(omega_session_t *session_ptr, omega_session_event_t session_event)
            : session_ptr_(session_ptr) {
            omega_session_begin_event_batch_(session_ptr_, session_event);
        }

        ~scoped_session_event_batch_t() {
            omega_session_end_event_batch_(session_ptr_);
        }

    private:
        omega_session_t *session_ptr_{};
    };

    struct session_stream_cursor_t {
        const omega_session_t *session_ptr{};
        omega_model_segments_t::const_iterator segment_iter{};
        omega_model_segments_t::const_iterator segment_end{};
        int64_t offset{};
    };

    int64_t write_file_segment_(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr,
                                omega_byte_t *io_buf);

    auto replace_bytes_impl_(omega_session_t *session_ptr, int64_t offset, int64_t delete_length,
                             const omega_byte_t *bytes, int64_t insert_length) -> int64_t {
        if (!session_ptr) { return -1; }
        if (delete_length < 0 || insert_length < 0 || offset < 0) { return 0; }
        if (!bytes && insert_length > 0) { return -1; }
        if (delete_length == 0 && insert_length == 0) { return 0; }
        if (delete_length == 0) { return omega_edit_insert_bytes(session_ptr, offset, bytes, insert_length); }
        if (insert_length == 0) { return omega_edit_delete(session_ptr, offset, delete_length); }
        if (delete_length == insert_length) { return omega_edit_overwrite_bytes(session_ptr, offset, bytes, insert_length); }

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

    inline void update_viewport_offset_adjustment_(omega_viewport_t *viewport_ptr,
                                                   const omega_change_t *change_ptr) {
        assert(0 < change_ptr->length);
        const auto offset = omega_viewport_get_offset(viewport_ptr);
        // If the viewport is floating and a change happens before or at the start of the given viewport...
        if ((omega_viewport_is_floating(viewport_ptr) != 0) && change_ptr->offset <= offset) {
            // ...and the change is a delete, or insert, update the offset adjustment accordingly
            if (change_kind_t::CHANGE_DELETE == omega_change_get_kind(change_ptr)) {
                viewport_ptr->data_segment.offset_adjustment -= change_ptr->length;
                // If the offset adjustment is now negative, adjust it to zero
                if (offset < -viewport_ptr->data_segment.offset_adjustment) {
                    viewport_ptr->data_segment.offset_adjustment = -offset;
                }
            } else if (change_kind_t::CHANGE_INSERT == omega_change_get_kind(change_ptr)) {
                viewport_ptr->data_segment.offset_adjustment += change_ptr->length;
            }
        }
    }

    inline bool change_affects_viewport_(const omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr) {
        assert(0 < change_ptr->length);
        switch (omega_change_get_kind(change_ptr)) {
            case change_kind_t::CHANGE_DELETE:// deliberate fall-through
            case change_kind_t::CHANGE_INSERT:
                // INSERT and DELETE changes that happen before the viewport end offset affect the viewport
                return (change_ptr->offset <=
                        (omega_viewport_get_offset(viewport_ptr) + omega_viewport_get_capacity(viewport_ptr)));
            case change_kind_t::CHANGE_OVERWRITE:
                // OVERWRITE changes that happen inside the viewport affect the viewport
                return omega_viewport_in_segment(viewport_ptr, change_ptr->offset, change_ptr->length) != 0;
            default:
                ABORT(LOG_ERROR("Unhandled change kind"););
        }
    }

    auto update_viewports_(const omega_session_t *session_ptr, const omega_change_t *change_ptr) -> int {
        for (auto &&viewport_ptr: session_ptr->viewports_) {
            // possibly adjust the viewport offset if it's floating and other criteria are met
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
        for (const auto &seg: segments) { result.push_back(clone_model_segment_(seg)); }
        return result;
    }

    inline void free_model_changes_(omega_model_struct *model_ptr) {
        model_ptr->model_snapshots.clear();
        for (const auto &change_ptr: model_ptr->changes) {
            if (omega_change_get_kind(change_ptr.get()) != change_kind_t::CHANGE_DELETE) {
                omega_data_destroy(&const_cast<omega_change_t *>(change_ptr.get())->data, change_ptr->length);
            }
        }
        model_ptr->changes.clear();
    }

    inline void free_model_changes_undone_(omega_model_struct *model_ptr) {
        for (const auto &change_ptr: model_ptr->changes_undone) {
            if (omega_change_get_kind(change_ptr.get()) != change_kind_t::CHANGE_DELETE) {
                omega_data_destroy(&const_cast<omega_change_t *>(change_ptr.get())->data, change_ptr->length);
            }
        }
        model_ptr->changes_undone.clear();
    }

    inline void free_session_changes_(const omega_session_t *session_ptr) {
        for (auto &&model_ptr: session_ptr->models_) { free_model_changes_(model_ptr.get()); }
    }

    inline void free_session_changes_undone_(const omega_session_t *session_ptr) {
        for (auto &&model_ptr: session_ptr->models_) { free_model_changes_undone_(model_ptr.get()); }
    }

/* --------------------------------------------------------------------------------------------------------------------
 The objective here is to model the edits using segments.  Essentially creating a contiguous model of the file by
 keeping track of what to do.  The verbs here are READ, INSERT, and OVERWRITE.  We don't need to model DELETE because
 that is covered by adjusting, or removing, the READ, INSERT, and OVERWRITE segments accordingly.  The model expects to
 take in changes with original offsets and lengths and the model will calculate computed offsets and lengths.
 -------------------------------------------------------------------------------------------------------------------- */
    auto update_model_helper_(omega_model_t *model_ptr, const const_omega_change_ptr_t &change_ptr) -> int {
        assert(change_ptr->length > 0);
        int64_t read_offset = 0;

        if (model_ptr->model_segments.empty()) {
            if (omega_change_get_kind(change_ptr.get()) != change_kind_t::CHANGE_DELETE) {
                // The model is empty, and we have a change with content
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
            if (read_offset != (*iter)->computed_offset) {
                ABORT(print_model_segments_(model_ptr, CLOG);
                              LOG_ERROR("break in model continuity, expected: " << read_offset
                                                                                << ", got: "
                                                                                << (*iter)->computed_offset););
            }
            if (change_ptr->offset >= read_offset && change_ptr->offset <= read_offset + (*iter)->computed_length) {
                if (change_ptr->offset != read_offset) {
                    const auto delta = change_ptr->offset - (*iter)->computed_offset;
                    if (delta == (*iter)->computed_length) {
                        // The update happens right at the end of the existing segment
                        ++iter;
                    } else {
                        // The update site falls in the middle of an existing segment, so we need to split the segment at
                        // the update site.  iter points to the segment on the left of the split and split_segment_ptr
                        // points to a new duplicate segment on the right of the split.
                        auto split_segment_ptr = clone_model_segment_(*iter);
                        split_segment_ptr->computed_offset += delta;
                        split_segment_ptr->computed_length -= delta;
                        split_segment_ptr->change_offset += delta;
                        (*iter)->computed_length = delta;
                        // iter will now point to the new split segment inserted into the model and who's offset falls on
                        // the update site
                        iter = model_ptr->model_segments.insert(iter + 1, std::move(split_segment_ptr));
                    }
                }
                switch (omega_change_get_kind(change_ptr.get())) {
                    case change_kind_t::CHANGE_DELETE: {
                        auto delete_length = change_ptr->length;
                        while (delete_length && iter != model_ptr->model_segments.end()) {
                            if ((*iter)->computed_length <= delete_length) {
                                // DELETE change spans the entire segment
                                delete_length -= (*iter)->computed_length;
                                iter = model_ptr->model_segments.erase(iter);
                            } else {
                                // DELETE removes a portion of the beginning of the segment
                                (*iter)->computed_length -= delete_length;
                                (*iter)->computed_offset += delete_length - change_ptr->length;
                                (*iter)->change_offset += delete_length;
                                assert((*iter)->change_offset < (*iter)->change_ptr->length);
                                delete_length = 0;
                                ++iter;// move to the next segment for adjusting
                            }
                        }
                        // adjust the computed offsets for segments beyond the DELETE site
                        for (; iter != model_ptr->model_segments.end(); ++iter) {
                            (*iter)->computed_offset -= change_ptr->length;
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
                            (*iter)->computed_offset += change_ptr->length;
                        }
                        break;
                    }
                    default:
                        ABORT(LOG_ERROR("Unhandled change kind"););
                }
                return 0;
            }
            read_offset += (*iter)->computed_length;
        }
        return -1;
    }

    auto update_model_(omega_session_t *session_ptr, const const_omega_change_ptr_t &change_ptr) -> int {
        const auto model_ptr = session_ptr->models_.back().get();
        if (omega_change_get_kind(change_ptr.get()) == change_kind_t::CHANGE_OVERWRITE) {
            // Overwrite will model just like a DELETE, followed by an INSERT
            const_omega_change_ptr_t const_change_ptr =
                    del_(0, change_ptr->offset, change_ptr->length, !omega_session_get_transaction_bit_(session_ptr));
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
                model_ptr->model_segments = clone_model_segments_(snap_it->second);
                replay_from = snap_it->first;
            } else {
                int64_t length = 0;
                if (model_ptr->file_ptr != nullptr) {
                    if (0 != FSEEK(model_ptr->file_ptr, 0L, SEEK_END)) { return -1; }
                    length = FTELL(model_ptr->file_ptr);
                }
                initialize_model_segments_(model_ptr->model_segments, length);
            }
        } else {
            int64_t length = 0;
            if (model_ptr->file_ptr != nullptr) {
                if (0 != FSEEK(model_ptr->file_ptr, 0L, SEEK_END)) { return -1; }
                length = FTELL(model_ptr->file_ptr);
            }
            initialize_model_segments_(model_ptr->model_segments, length);
        }

        for (auto i = replay_from; i < remaining_count; ++i) {
            if (0 > update_model_(session_ptr, model_ptr->changes[i])) { return -1; }
        }
        return 0;
    }

    auto update_(omega_session_t *session_ptr, const const_omega_change_ptr_t &change_ptr) -> int64_t {
        if (change_ptr->offset <= omega_session_get_computed_file_size(session_ptr)) {
            if (omega_change_get_serial(change_ptr.get()) < 0) {
                // This is a previously undone change that is being redone, so flip the serial number back to positive
                const_cast<omega_change_t *>(change_ptr.get())->serial *= -1;
            } else if (!session_ptr->models_.back()->changes_undone.empty()) {
                // This is not a redo change, so any changes undone are now invalid and must be cleared
                free_session_changes_undone_(session_ptr);
            }
            session_ptr->models_.back()->changes.push_back(change_ptr);
            if (0 != update_model_(session_ptr, change_ptr)) { return -1; }
            // Take a periodic snapshot of model segments to accelerate future undo operations
            if (session_ptr->undo_snapshot_interval_ > 0) {
                const auto count = static_cast<int64_t>(session_ptr->models_.back()->changes.size());
                if (count % session_ptr->undo_snapshot_interval_ == 0) {
                    session_ptr->models_.back()->model_snapshots[count] =
                            clone_model_segments_(session_ptr->models_.back()->model_segments);
                }
            }
            update_viewports_(session_ptr, change_ptr.get());
            omega_session_notify(session_ptr, SESSION_EVT_EDIT, change_ptr.get());
            return omega_change_get_serial(change_ptr.get());
        }
        return -1;
    }

    inline auto determine_change_transaction_bit_(omega_session_t *session_ptr) -> bool {
        switch (omega_session_get_transaction_state(session_ptr)) {
            case 0:
                // No transaction in progress, use the flipped previous change transaction bit
                return !omega_session_get_transaction_bit_(session_ptr);
            case 1:
                // This is the first change in a transaction, use the flipped previous change transaction bit and set the
                // transaction in progress flag
                session_ptr->session_flags_ |= SESSION_FLAGS_SESSION_TRANSACTION_IN_PROGRESS;
                return !omega_session_get_transaction_bit_(session_ptr);
            case 2:
                // This is the second or later change in a transaction, use the previous change transaction bit
                return omega_session_get_transaction_bit_(session_ptr);
            default:
                // This should never happen
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
                                  bool notify_transform) -> int {
        if (!session_ptr || !checkpoint_filename) { return -1; }
        session_ptr->num_changes_adjustment_ = omega_session_get_num_changes(session_ptr);
        session_ptr->models_.push_back(std::make_unique<omega_model_t>());
        session_ptr->models_.back()->file_ptr = FOPEN(checkpoint_filename, "rb");
        session_ptr->models_.back()->file_path = checkpoint_filename;
        if (session_ptr->models_.back()->file_ptr == nullptr) {
            LOG_ERROR("failed to open checkpoint file '" << checkpoint_filename << "'");
            session_ptr->models_.pop_back();
            omega_util_remove_file(checkpoint_filename);
            return -1;
        }
        initialize_model_segments_(session_ptr->models_.back()->model_segments, file_size);
        omega_session_notify(session_ptr, SESSION_EVT_CREATE_CHECKPOINT, nullptr);

        if (notify_transform) {
            for (const auto &viewport_ptr: session_ptr->viewports_) {
                viewport_ptr->data_segment.capacity =
                        -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
                omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_TRANSFORM, nullptr);
            }
            omega_session_notify(session_ptr, SESSION_EVT_TRANSFORM, nullptr);
        }
        return 0;
    }

    auto initialize_session_stream_cursor_(const omega_session_t *session_ptr, int64_t offset,
                                           session_stream_cursor_t &cursor) -> bool {
        if (!session_ptr || offset < 0) { return false; }
        const auto &segments = session_ptr->models_.back()->model_segments;
        cursor.session_ptr = session_ptr;
        cursor.segment_end = segments.cend();
        cursor.offset = offset;
        cursor.segment_iter = std::upper_bound(
                segments.cbegin(), segments.cend(), offset,
                [](int64_t logical_offset, const omega_model_segment_ptr_t &segment) {
                    return logical_offset < segment->computed_offset;
                });
        if (cursor.segment_iter != segments.cbegin()) { --cursor.segment_iter; }
        while (cursor.segment_iter != cursor.segment_end &&
               (*cursor.segment_iter)->computed_offset + (*cursor.segment_iter)->computed_length <= offset) {
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
            if (segment->computed_offset + segment->computed_length <= cursor.offset) {
                ++cursor.segment_iter;
                continue;
            }
            if (segment->computed_offset > cursor.offset) {
                ABORT(LOG_ERROR("break in model continuity, expected at most: " << cursor.offset
                                                                                << ", got: " << segment->computed_offset););
                return -1;
            }

            const auto segment_start = std::max(cursor.offset - segment->computed_offset, int64_t(0));
            const auto segment_length = std::min(end_offset - cursor.offset, segment->computed_length - segment_start);
            if (to_file_ptr != nullptr) {
                switch (omega_model_segment_get_kind(segment.get())) {
                    case model_segment_kind_t::SEGMENT_READ: {
                        if (cursor.session_ptr->models_.back()->file_ptr == nullptr) {
                            ABORT(LOG_ERROR("attempt to read segment from null file pointer"););
                            return -1;
                        }
                        if (write_file_segment_(cursor.session_ptr->models_.back()->file_ptr,
                                                segment->change_offset + segment_start, segment_length, to_file_ptr,
                                                io_buf) != segment_length) {
                            LOG_ERROR("write_file_segment_ failed");
                            return -1;
                        }
                        break;
                    }
                    case model_segment_kind_t::SEGMENT_INSERT: {
                        if (static_cast<int64_t>(fwrite(omega_change_get_bytes(segment->change_ptr.get()) +
                                                        segment->change_offset + segment_start,
                                                        sizeof(omega_byte_t), segment_length,
                                                        to_file_ptr)) != segment_length) {
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

            cursor.offset += segment_length;
            processed += segment_length;
            if (segment_start + segment_length >= segment->computed_length) { ++cursor.segment_iter; }
        }
        return processed;
    }

    auto write_bytes_to_file_(FILE *file_ptr, const omega_byte_t *bytes, int64_t length) -> int64_t {
        if (!file_ptr || length < 0 || (!bytes && length > 0)) { return -1; }
        if (length == 0) { return 0; }
        return static_cast<int64_t>(fwrite(bytes, sizeof(omega_byte_t), length, file_ptr)) == length ? length : -1;
    }

    // Write a file segment to the output file using the larger I/O buffer
    int64_t write_file_segment_(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr,
                                omega_byte_t *io_buf) {
        if (!from_file_ptr || !to_file_ptr) { return -1; }
        if (0 != FSEEK(from_file_ptr, offset, SEEK_SET)) { return -1; }
        int64_t remaining = byte_count;
        while (remaining) {
            const auto count = std::min(remaining, OMEGA_IO_BUFFER_SIZE);
            if (count != static_cast<int64_t>(fread(io_buf, sizeof(omega_byte_t), count, from_file_ptr)) ||
                count != static_cast<int64_t>(fwrite(io_buf, sizeof(omega_byte_t), count, to_file_ptr))) { break; }
            remaining -= count;
        }
        return byte_count - remaining;
    }

    // Write a segment from a source file to a destination file, applying a byte transform to bytes that
    // fall within the transform range [transform_file_begin, transform_file_end). file_write_pos tracks the current
    // position in the output file for range calculations.
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
                // Determine which portion of this buffer overlaps the transform range
                const auto buf_begin = file_write_pos;
                const auto buf_end = file_write_pos + count;
                if (buf_begin < transform_file_end && buf_end > transform_file_begin) {
                    const auto t_start = std::max(transform_file_begin - buf_begin, int64_t(0));
                    const auto t_end = std::min(transform_file_end - buf_begin, count);
                    omega_util_apply_byte_transform(io_buf + t_start, t_end - t_start, transform, user_data_ptr);
                }
            }
            if (count != static_cast<int64_t>(fwrite(io_buf, sizeof(omega_byte_t), count, to_file_ptr))) { break; }
            remaining -= count;
            file_write_pos += count;
        }
        return byte_count - remaining;
    }

    // Save the current session model to a file, applying a byte transform to bytes in [transform_offset,
    // transform_offset + transform_length). Returns 0 on success.
    int save_segment_transformed_(omega_session_t *session_ptr, const char *file_path,
                                  omega_util_byte_transform_t transform, void *user_data_ptr, int64_t transform_offset,
                                  int64_t transform_length) {
        if (!session_ptr || !file_path || !transform) { return -1; }
        const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
        const auto adjusted_transform_length =
                transform_length <= 0 ? computed_file_size - transform_offset
                                      : std::min(transform_length, computed_file_size - transform_offset);
        if (transform_offset < 0 || adjusted_transform_length < 0) { return -1; }
        const auto transform_file_begin = transform_offset;
        const auto transform_file_end = transform_offset + adjusted_transform_length;

        const auto temp_fptr = FOPEN(file_path, "wb");
        if (!temp_fptr) {
            LOG_ERRNO();
            return -1;
        }
        const auto io_buf = std::make_unique<omega_byte_t[]>(OMEGA_IO_BUFFER_SIZE);
        int64_t write_offset = 0;
        int64_t file_write_pos = 0;
        for (const auto &segment: session_ptr->models_.back()->model_segments) {
            if (write_offset != segment->computed_offset) {
                ABORT(LOG_ERROR("break in model continuity, expected: " << write_offset
                                                                        << ", got: " << segment->computed_offset););
            }
            switch (omega_model_segment_get_kind(segment.get())) {
                case model_segment_kind_t::SEGMENT_READ: {
                    if (session_ptr->models_.back()->file_ptr == nullptr) {
                        ABORT(LOG_ERROR("attempt to read segment from null file pointer"););
                    }
                    if (write_segment_to_file_transformed_(
                                session_ptr->models_.back()->file_ptr,
                                segment->change_offset, segment->computed_length, temp_fptr, file_write_pos, transform,
                                user_data_ptr, transform_file_begin, transform_file_end,
                                io_buf.get()) != segment->computed_length) {
                        FCLOSE(temp_fptr);
                        LOG_ERROR("write_segment_to_file_transformed_ failed");
                        return -1;
                    }
                    break;
                }
                case model_segment_kind_t::SEGMENT_INSERT: {
                    const auto *src = omega_change_get_bytes(segment->change_ptr.get()) + segment->change_offset;
                    const auto len = segment->computed_length;
                    // Check if any part of this segment overlaps the transform range
                    if (file_write_pos < transform_file_end && file_write_pos + len > transform_file_begin) {
                        // Need a mutable copy so we can apply the transform in-place
                        int64_t seg_remaining = len;
                        int64_t seg_offset = 0;
                        while (seg_remaining > 0) {
                            const auto chunk = std::min(seg_remaining, OMEGA_IO_BUFFER_SIZE);
                            memcpy(io_buf.get(), src + seg_offset, chunk);
                            const auto buf_begin = file_write_pos + seg_offset;
                            const auto buf_end = buf_begin + chunk;
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
                            seg_offset += chunk;
                        }
                    } else {
                        // Entirely outside the transform range — write verbatim
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
            file_write_pos += segment->computed_length;
            write_offset += segment->computed_length;
        }
        FCLOSE(temp_fptr);
        if (file_write_pos != computed_file_size) {
            LOG_ERROR("failed to write all bytes, expected: " << computed_file_size << ", got: " << file_write_pos);
            return -1;
        }
        return 0;
    }
}

omega_session_t *omega_edit_create_session(const char *file_path, omega_session_event_cbk_t cbk, void *user_data_ptr,
                                           int32_t event_interest, const char *checkpoint_directory) {
    std::string checkpoint_directory_str;
    if (!resolve_checkpoint_directory_(file_path, checkpoint_directory, checkpoint_directory_str)) { return nullptr; }
    FILE *file_ptr = nullptr;
    char checkpoint_filename[FILENAME_MAX + 1]; // +1 for null terminator
    if ((file_path != nullptr) && file_path[0] != '\0') {
        // Copy the original file to a checkpoint file to handle out of band changes to the original file
        if (FILENAME_MAX <=
            snprintf(static_cast<char *>(checkpoint_filename), FILENAME_MAX, "%s%c.OmegaEdit-orig.XXXXXX",
                     checkpoint_directory_str.c_str(), omega_util_directory_separator())) {
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
        close(checkpoint_fd);
        if (0 != omega_util_file_copy(file_path, static_cast<char *>(checkpoint_filename), mode)) {
            LOG_ERROR("failed to copy original file '" << file_path << "' to checkpoint file '"
                                                       << static_cast<char *>(checkpoint_filename)
                                                       << "'");
            return nullptr;
        }
        file_ptr = FOPEN(checkpoint_filename, "rb");
        if (file_ptr == nullptr) { return nullptr; }
    }
    return create_session_with_backing_file_(file_ptr, file_path, checkpoint_filename, checkpoint_directory_str, cbk,
                                             user_data_ptr, event_interest);
}

omega_session_t *omega_edit_create_session_from_bytes(const omega_byte_t *data_ptr, int64_t length,
                                                      omega_session_event_cbk_t cbk, void *user_data_ptr,
                                                      int32_t event_interest, const char *checkpoint_directory) {
    if (length < 0 || (length > 0 && data_ptr == nullptr)) { return nullptr; }

    std::string checkpoint_directory_str;
    if (!resolve_checkpoint_directory_(nullptr, checkpoint_directory, checkpoint_directory_str)) { return nullptr; }

    char checkpoint_filename[FILENAME_MAX + 1];
    if (FILENAME_MAX <=
        snprintf(static_cast<char *>(checkpoint_filename), FILENAME_MAX, "%s%c.OmegaEdit-bytes.XXXXXX",
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

    return create_session_with_backing_file_(file_ptr, nullptr, checkpoint_filename, checkpoint_directory_str, cbk,
                                             user_data_ptr, event_interest);
}

void omega_edit_destroy_session(omega_session_t *session_ptr) {
    if (!session_ptr) { return; }
    // Close all open files in the models
    for (const auto &model_ptr: session_ptr->models_) {
        if (model_ptr->file_ptr) { FCLOSE(model_ptr->file_ptr); }
    }
    // Destroy all search contexts
    while (!session_ptr->search_contexts_.empty()) {
        omega_search_destroy_context(session_ptr->search_contexts_.back().get());
    }
    // Destroy all viewports
    while (!session_ptr->viewports_.empty()) { omega_edit_destroy_viewport(session_ptr->viewports_.back().get()); }
    // Destroy all changes
    free_session_changes_(session_ptr);
    // Destroy all undone changes
    free_session_changes_undone_(session_ptr);
    // Remove all checkpoint files
    while (omega_session_get_num_checkpoints(session_ptr) != 0) {
        if (0 != omega_util_remove_file(session_ptr->models_.back()->file_path.c_str())) { LOG_ERRNO(); }
        session_ptr->models_.pop_back();
    }
    // Remove the session checkpoint file if it exists
    if (!session_ptr->checkpoint_file_name_.empty() &&
        0 != omega_util_remove_file(session_ptr->checkpoint_file_name_.c_str())) {
        LOG_ERRNO();
    }
    // Delete the session pointer
    delete session_ptr;
}

omega_viewport_t *omega_edit_create_viewport(omega_session_t *session_ptr, int64_t offset, int64_t capacity,
                                             int is_floating, omega_viewport_event_cbk_t cbk, void *user_data_ptr,
                                             int32_t event_interest) {
    if (capacity > 0 && capacity <= OMEGA_VIEWPORT_CAPACITY_LIMIT) {
        const auto viewport_ptr = std::make_shared<omega_viewport_t>();
        viewport_ptr->session_ptr = session_ptr;
        viewport_ptr->data_segment.offset = offset;
        viewport_ptr->data_segment.offset_adjustment = 0;
        viewport_ptr->data_segment.is_floating = (bool) is_floating;
        viewport_ptr->data_segment.capacity = -1 * capacity;// Negative capacity indicates dirty read
        viewport_ptr->data_segment.length = 0;
        omega_data_create(&viewport_ptr->data_segment.data, capacity);
        viewport_ptr->event_handler = cbk;
        viewport_ptr->user_data_ptr = user_data_ptr;
        viewport_ptr->event_interest_ = event_interest;
        omega_segment_get_data(&viewport_ptr->data_segment)[0] = '\0';
        session_ptr->viewports_.push_back(viewport_ptr);
        omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_CREATE, session_ptr->viewports_.back().get());
        omega_session_notify(session_ptr, SESSION_EVT_CREATE_VIEWPORT, session_ptr->viewports_.back().get());
        return session_ptr->viewports_.back().get();
    }
    return nullptr;
}

void omega_edit_destroy_viewport(omega_viewport_t *viewport_ptr) {
    if (!viewport_ptr) { return; }
    for (auto iter = viewport_ptr->session_ptr->viewports_.rbegin();
         iter != viewport_ptr->session_ptr->viewports_.rend(); ++iter) {
        if (viewport_ptr == iter->get()) {
            auto *const session_ptr = viewport_ptr->session_ptr;
            omega_data_destroy(&(*iter)->data_segment.data, omega_viewport_get_capacity(iter->get()));
            session_ptr->viewports_.erase(std::next(iter).base());
            omega_session_notify(session_ptr, SESSION_EVT_DESTROY_VIEWPORT, viewport_ptr);
            break;
        }
    }
}

int64_t omega_edit_delete(omega_session_t *session_ptr, int64_t offset, int64_t length) {
    if (!session_ptr) { return -1; }
    if (offset < 0 || length < 0) { return -1; }
    if (length == 0) { return 0; }
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    return (omega_session_changes_paused(session_ptr) == 0) && 0 < length && offset < computed_file_size
           ? update_(session_ptr, del_(1 + omega_session_get_num_changes(session_ptr), offset,
                                       std::min(length, static_cast<int64_t>(computed_file_size) - offset),
                                       determine_change_transaction_bit_(session_ptr)))
           : 0;
}

int64_t omega_edit_insert_bytes(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes,
                                int64_t length) {
    if (!session_ptr) { return -1; }
    if (offset < 0 || length < 0) { return -1; }
    if (length == 0) { return 0; }
    if (!bytes) { return -1; }
    return (omega_session_changes_paused(session_ptr) == 0) &&
           offset <= omega_session_get_computed_file_size(session_ptr)
           ? update_(session_ptr, ins_(1 + omega_session_get_num_changes(session_ptr), offset, bytes, length,
                                       determine_change_transaction_bit_(session_ptr)))
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
    if (offset < 0 || length < 0) { return -1; }
    if (length == 0) { return 0; }
    if (!bytes) { return -1; }
    return (omega_session_changes_paused(session_ptr) == 0) &&
           offset <= omega_session_get_computed_file_size(session_ptr)
           ? update_(session_ptr, ovr_(1 + omega_session_get_num_changes(session_ptr), offset, bytes, length,
                                       determine_change_transaction_bit_(session_ptr)))
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

int64_t omega_edit_replace(omega_session_t *session_ptr, int64_t offset, int64_t delete_length, const char *cstr,
                           int64_t insert_length) {
    if (offset < 0 || delete_length < 0 || insert_length < 0) { return -1; }
    if (!cstr) {
        return (insert_length == 0)
                   ? omega_edit_replace_bytes(session_ptr, offset, delete_length, nullptr, 0)
                   : -1;
    }
    const auto cstr_length = (insert_length == 0) ? static_cast<int64_t>(strlen(cstr)) : insert_length;
    return omega_edit_replace_bytes(session_ptr, offset, delete_length, (const omega_byte_t *) cstr, cstr_length);
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
    const auto adjusted_length = length <= 0 ? computed_file_size - offset : std::min(length, computed_file_size - offset);
    if (adjusted_length < 0) { return -1; }
    if (pattern_length > adjusted_length) { return 0; }

    auto *const search_context =
            omega_search_create_context_bytes(session_ptr, pattern, pattern_length, offset, adjusted_length,
                                              case_insensitive, 0);
    if (!search_context) { return -1; }

    if (omega_search_next_match(search_context, pattern_length) == 0) {
        omega_search_destroy_context(search_context);
        return 0;
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

    auto io_buf = std::make_unique<omega_byte_t[]>(OMEGA_IO_BUFFER_SIZE);
    const auto replace_end = offset + adjusted_length;
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
            if (stream_session_range_(cursor, match_offset + pattern_length, nullptr, io_buf.get()) != pattern_length) {
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
    for (size_t i = 0; i < op_count; ++i) {
        const auto serial = apply_script_op_(session_ptr, ops[i]);
        if (serial < 0) {
            rc = -1;
            break;
        }
        if (serial == 0 &&
            (ops[i].kind == OMEGA_EDIT_SCRIPT_DELETE ||
             ops[i].kind == OMEGA_EDIT_SCRIPT_INSERT ||
             ops[i].kind == OMEGA_EDIT_SCRIPT_OVERWRITE ||
             ops[i].kind == OMEGA_EDIT_SCRIPT_REPLACE) &&
            (ops[i].length > 0 || ops[i].bytes_length > 0)) {
            rc = -1;
            break;
        }
        if (serial > 0) { changed = true; }
    }

    restore_viewport_callbacks_(session_ptr, callbacks_were_paused, changed);
    return rc;
}

int omega_edit_apply_transform(omega_session_t *session_ptr, omega_util_byte_transform_t transform, void *user_data_ptr,
                               int64_t offset, int64_t length) {
    if (!session_ptr || !transform) { return -1; }
    if (omega_session_changes_paused(session_ptr) != 0) { return -1; }

    // Create the checkpoint file path
    const auto *const checkpoint_directory = omega_session_get_checkpoint_directory(session_ptr);
    if (omega_util_directory_exists(checkpoint_directory) == 0) {
        LOG_ERROR("checkpoint directory '" << checkpoint_directory << "' does not exist");
        return -1;
    }
    char checkpoint_filename[FILENAME_MAX + 1];
    const auto snprintf_result_transform =
            snprintf(checkpoint_filename, sizeof(checkpoint_filename), "%s%c.OmegaEdit-chk.%zu.XXXXXX",
                     checkpoint_directory, omega_util_directory_separator(), session_ptr->models_.size());
    if (snprintf_result_transform < 0 ||
        static_cast<size_t>(snprintf_result_transform) >= sizeof(checkpoint_filename)) {
        LOG_ERROR("failed to create checkpoint filename template");
        return -1;
    }
    const auto checkpoint_fd = omega_util_mkstemp(checkpoint_filename, 0600);// S_IRUSR | S_IWUSR
    if (checkpoint_fd < 0) {
        LOG_ERROR("omega_util_mkstemp failed for checkpoint file '" << checkpoint_filename << "'");
        return -1;
    }
    close(checkpoint_fd);

    // Single-pass: walk the segment model and write the transformed content directly to the checkpoint file
    if (0 != save_segment_transformed_(session_ptr, checkpoint_filename, transform, user_data_ptr, offset, length)) {
        LOG_ERROR("save_segment_transformed_ failed");
        omega_util_remove_file(checkpoint_filename);
        return -1;
    }

    // Push the new checkpoint model (same as omega_edit_create_checkpoint does after saving)
    const auto file_size = omega_session_get_computed_file_size(session_ptr);
    session_ptr->num_changes_adjustment_ = omega_session_get_num_changes(session_ptr);
    session_ptr->models_.push_back(std::make_unique<omega_model_t>());
    session_ptr->models_.back()->file_ptr = FOPEN(checkpoint_filename, "rb");
    session_ptr->models_.back()->file_path = checkpoint_filename;
    if (session_ptr->models_.back()->file_ptr == nullptr) {
        LOG_ERROR("failed to open checkpoint file '" << checkpoint_filename << "'");
        session_ptr->models_.pop_back();
        omega_util_remove_file(checkpoint_filename);
        return -1;
    }
    initialize_model_segments_(session_ptr->models_.back()->model_segments, file_size);
    omega_session_notify(session_ptr, SESSION_EVT_CREATE_CHECKPOINT, nullptr);

    // Notify viewports and session of the transform
    for (const auto &viewport_ptr: session_ptr->viewports_) {
        viewport_ptr->data_segment.capacity =
                -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
        omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_TRANSFORM, nullptr);
    }
    omega_session_notify(session_ptr, SESSION_EVT_TRANSFORM, nullptr);
    return 0;
}

int omega_edit_save_segment(omega_session_t *session_ptr, const char *file_path, int io_flags, char *saved_file_path,
                            int64_t offset, int64_t length) {
    if (!session_ptr || !file_path || !*file_path || offset < 0) { return -1; }
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    const auto adjusted_length = length <= 0 ? computed_file_size - offset : std::min(length, computed_file_size - offset);
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
    const auto *const checkpoint_file = session_ptr->checkpoint_file_name_.c_str();
    const auto mode = omega_util_compute_mode(0666);// S_IRUSR | S_IWUSR | S_IRGRP | S_IWGRP | S_IROTH | S_IWOTH
    if (saved_file_path != nullptr) { saved_file_path[0] = '\0'; }

    // If overwrite is requested and the file path is the same as the original session file, then overwrite_original
    // will be true
    const auto overwrite_original = (overwrite && (session_file_path != nullptr) &&
                                     (omega_util_file_exists(file_path) != 0) &&
                                     (omega_util_paths_equivalent(file_path, session_file_path) != 0));

    // If the original file is going to be overwritten, and the file has been modified since the session was opened, and
    // the IO_FLG_FORCE_OVERWRITE flag is not set, then return an error
    if (overwrite_original && (force_overwrite == 0) &&
        1 == omega_util_compare_modification_times(session_file_path, checkpoint_file)) {
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
        const auto temp_filename_str = std::string(temp_filename);
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
    const auto io_buf = std::make_unique<omega_byte_t[]>(OMEGA_IO_BUFFER_SIZE);
    int64_t bytes_written = 0;

    // Binary search for the first segment that could contain data at 'offset'.
    // Segments are contiguous and sorted by computed_offset.
    const auto &segments = session_ptr->models_.back()->model_segments;
    auto seg_iter = std::upper_bound(
            segments.cbegin(), segments.cend(), offset,
            [](int64_t off, const omega_model_segment_ptr_t &seg) { return off < seg->computed_offset; });
    if (seg_iter != segments.cbegin()) { --seg_iter; }

    for (; seg_iter != segments.cend() && bytes_written < adjusted_length; ++seg_iter) {
        const auto &segment = *seg_iter;
        // Skip this iteration if the segment is entirely before the start offset
        if (segment->computed_offset + segment->computed_length <= offset) { continue; }

        // Calculate how much to write from this segment
        const auto segment_start = std::max(offset - segment->computed_offset, int64_t(0));
        const auto segment_length = std::min(adjusted_length - bytes_written, segment->computed_length - segment_start);

        switch (omega_model_segment_get_kind(segment.get())) {
            case model_segment_kind_t::SEGMENT_READ: {
                if (session_ptr->models_.back()->file_ptr == nullptr) {
                    ABORT(LOG_ERROR("attempt to read segment from null file pointer"););
                }
                if (write_file_segment_(session_ptr->models_.back()->file_ptr,
                                        segment->change_offset + segment_start, segment_length,
                                        temp_fptr, io_buf.get()) != segment_length) {
                    FCLOSE(temp_fptr);
                    if (cleanup_output) { omega_util_remove_file(output_path); }
                    LOG_ERROR("write_file_segment_ failed");
                    return -6;
                }
                break;
            }
            case model_segment_kind_t::SEGMENT_INSERT: {
                if (static_cast<int64_t>(fwrite(omega_change_get_bytes(segment->change_ptr.get()) +
                                                segment->change_offset + segment_start,
                                                1, segment_length, temp_fptr)) != segment_length) {
                    FCLOSE(temp_fptr);
                    if (cleanup_output) { omega_util_remove_file(output_path); }
                    LOG_ERROR("fwrite failed");
                    return -7;
                }
                break;
            }
            default:
                ABORT(LOG_ERROR("Unhandled segment kind"););
        }
        bytes_written += segment_length;
    }
    FCLOSE(temp_fptr);
    if (bytes_written != adjusted_length) {
        LOG_ERROR("failed to write all requested bytes, expected: " << adjusted_length << ", got: " << bytes_written);
        if (cleanup_output) { omega_util_remove_file(output_path); }
        return -8;
    }
    if (bytes_written != omega_util_file_size(output_path)) {
        LOG_ERROR("failed to write all requested bytes to '" << output_path << "', expected: " << bytes_written
                                                             << ", got: " << omega_util_file_size(output_path));
        if (cleanup_output) { omega_util_remove_file(output_path); }
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
    // If required, touch the checkpoint file after the original file has been overwritten, so that the checkpoint file
    // appears to be newer than the original file, otherwise the original file will be considered newer than the
    // checkpoint and a force overwrite will be required to save the session next time.
    if (overwrite_original) {
        if (0 != omega_util_touch(checkpoint_file, 0)) {
            LOG_ERROR("failed to touch checkpoint file: " << checkpoint_file);
#ifndef OMEGA_BUILD_WINDOWS// Windows files may not have their modified times updated without elevated privileges
            return -13;
#endif
        }
        assert(0 <= omega_util_compare_modification_times(checkpoint_file, file_path));
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
    if (offset > computed_file_size) { return -1; }

    const auto remaining_length = computed_file_size - offset;
    const auto requested_length = (length == 0 || length > remaining_length) ? remaining_length : length;
    if (requested_length < 0) { return -1; }

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
        if (0 != omega_session_get_segment(session_ptr, segment, offset + bytes_copied)) {
            omega_segment_destroy(segment);
            free(data_ptr);
            return -1;
        }
        const auto segment_length = std::min<int64_t>(omega_segment_get_length(segment), requested_length - bytes_copied);
        if (segment_length <= 0) {
            omega_segment_destroy(segment);
            free(data_ptr);
            return -1;
        }
        memcpy(data_ptr + bytes_copied, omega_segment_get_data(segment), static_cast<size_t>(segment_length));
        bytes_copied += segment_length;
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
    initialize_model_segments_(session_ptr->models_.front()->model_segments, length);
    free_session_changes_(session_ptr);
    free_session_changes_undone_(session_ptr);
    for (const auto &viewport_ptr: session_ptr->viewports_) {
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
    while ((omega_session_changes_paused(session_ptr) == 0) && !session_ptr->models_.back()->changes.empty()) {
        auto *const model_ptr = session_ptr->models_.back().get();
        std::vector<const_omega_change_ptr_t> undone_changes;
        undone_changes.reserve(1);

        const auto transaction_bit = omega_change_get_transaction_bit_(model_ptr->changes.back().get());
        do {
            undone_changes.push_back(model_ptr->changes.back());
            model_ptr->changes.pop_back();
        } while ((omega_session_changes_paused(session_ptr) == 0) && !model_ptr->changes.empty() &&
                 transaction_bit == omega_change_get_transaction_bit_(model_ptr->changes.back().get()));

        const auto remaining_count = static_cast<int64_t>(model_ptr->changes.size());
        if (0 != rebuild_model_to_change_count_(session_ptr, remaining_count)) { return -1; }

        for (const auto &change_ptr: undone_changes) {
            auto *const undone_change_ptr = const_cast<omega_change_t *>(change_ptr.get());
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
    while ((omega_session_changes_paused(session_ptr) == 0) && !session_ptr->models_.back()->changes_undone.empty()) {
        const auto change_ptr = session_ptr->models_.back()->changes_undone.back();
        rc = update_(session_ptr, change_ptr);
        if (rc < 0) {
            // On failure, leave the change in changes_undone and return the error code to the caller
            return rc;
        }
        session_ptr->models_.back()->changes_undone.pop_back();
        // If the redone change is part of a transaction, continue redoing the entire transaction
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
    const auto *const checkpoint_directory = omega_session_get_checkpoint_directory(session_ptr);
    // make sure the checkpoint directory exists
    if (omega_util_directory_exists(checkpoint_directory) == 0) {
        LOG_ERROR("checkpoint directory '" << checkpoint_directory << "' does not exist");
        return -1;
    }
    char checkpoint_filename[FILENAME_MAX + 1];
    const auto snprintf_result_checkpoint =
            snprintf(checkpoint_filename, sizeof(checkpoint_filename), "%s%c.OmegaEdit-chk.%zu.XXXXXX",
                     checkpoint_directory, omega_util_directory_separator(), session_ptr->models_.size());
    if (snprintf_result_checkpoint < 0 ||
        static_cast<size_t>(snprintf_result_checkpoint) >= sizeof(checkpoint_filename)) {
        LOG_ERROR("failed to create checkpoint filename template");
        return -1;
    }
    const auto checkpoint_fd = omega_util_mkstemp(checkpoint_filename, 0600);// S_IRUSR | S_IWUSR
    if (checkpoint_fd < 0) {
        LOG_ERROR("omega_util_mkstemp failed for checkpoint file '" << checkpoint_filename << "'");
        return -1;
    }
    close(checkpoint_fd);
    if (0 != omega_edit_save(session_ptr, checkpoint_filename, IO_FLG_OVERWRITE, nullptr)) {
        LOG_ERROR("failed to save checkpoint to '" << checkpoint_filename << "'");
        return -1;
    }
    const auto file_size = omega_session_get_computed_file_size(session_ptr);
    session_ptr->num_changes_adjustment_ = omega_session_get_num_changes(session_ptr);
    session_ptr->models_.push_back(std::make_unique<omega_model_t>());
    session_ptr->models_.back()->file_ptr = FOPEN(checkpoint_filename, "rb");
    session_ptr->models_.back()->file_path = checkpoint_filename;
    initialize_model_segments_(session_ptr->models_.back()->model_segments, file_size);
    omega_session_notify(session_ptr, SESSION_EVT_CREATE_CHECKPOINT, nullptr);
    return 0;
}

int omega_edit_destroy_last_checkpoint(omega_session_t *session_ptr) {
    if (omega_session_get_num_checkpoints(session_ptr) > 0) {
        auto *const last_checkpoint_ptr = session_ptr->models_.back().get();
        FCLOSE(last_checkpoint_ptr->file_ptr);
        if (0 != omega_util_remove_file(last_checkpoint_ptr->file_path.c_str())) { LOG_ERRNO(); }
        free_model_changes_(last_checkpoint_ptr);
        free_model_changes_undone_(last_checkpoint_ptr);
        session_ptr->num_changes_adjustment_ -= (int64_t) session_ptr->models_.back()->changes.size();
        session_ptr->models_.pop_back();
        omega_session_notify(session_ptr, SESSION_EVT_DESTROY_CHECKPOINT, nullptr);
        for (const auto &viewport_ptr: session_ptr->viewports_) {
            viewport_ptr->data_segment.capacity =
                    -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
            omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_TRANSFORM, nullptr);
        }
        omega_session_notify(session_ptr, SESSION_EVT_TRANSFORM, nullptr);
        return 0;
    }
    return -1;
}
