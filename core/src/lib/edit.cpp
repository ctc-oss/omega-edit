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
        auto change_ptr = std::make_shared<omega_change_t>();
        change_ptr->serial = serial;
        change_ptr->kind =
                (transaction_bit ? OMEGA_CHANGE_TRANSACTION_BIT : 0x00) | (uint8_t) change_kind_t::CHANGE_INSERT;
        change_ptr->offset = offset;
        change_ptr->length = length ? length : static_cast<int64_t>(strlen((const char *) bytes));
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
        return std::move(change_ptr);
    }

    inline auto ovr_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length,
                     bool transaction_bit) -> const_omega_change_ptr_t {
        auto change_ptr = std::make_shared<omega_change_t>();
        change_ptr->serial = serial;
        change_ptr->kind =
                (transaction_bit ? OMEGA_CHANGE_TRANSACTION_BIT : 0x00) | (uint8_t) change_kind_t::CHANGE_OVERWRITE;
        change_ptr->offset = offset;
        change_ptr->length = length ? length : static_cast<int64_t>(strlen((const char *) bytes));
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
        return std::move(change_ptr);
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

    inline void free_model_changes_(omega_model_struct *model_ptr) {
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
}

omega_session_t *omega_edit_create_session(const char *file_path, omega_session_event_cbk_t cbk, void *user_data_ptr,
                                           int32_t event_interest, const char *checkpoint_directory) {
    std::string checkpoint_directory_str;
    // If no checkpoint directory is specified, then try to figure out a good default
    if (checkpoint_directory == nullptr) {
        // First try to use the directory of the file being edited
        if ((file_path != nullptr) && file_path[0] != '\0') {
            checkpoint_directory = checkpoint_directory_str.assign(omega_util_dirname(file_path, nullptr)).c_str();
        }
        // If that doesn't work, then try to use the system temp directory
        if (checkpoint_directory == nullptr) {
            auto *const temp_dir = omega_util_get_temp_directory();
            if (temp_dir != nullptr) {
                checkpoint_directory = checkpoint_directory_str.assign(temp_dir).c_str();
                free(temp_dir);
            } else {
                // Finally, if that doesn't work, then use the current working directory
                checkpoint_directory = checkpoint_directory_str.assign(omega_util_get_current_dir(nullptr)).c_str();
            }
        }
    }
    if ((omega_util_directory_exists(checkpoint_directory) == 0) &&
        0 != omega_util_create_directory(checkpoint_directory)) {
        LOG_ERROR("failed to create checkpoint directory '" << checkpoint_directory << "'");
        return nullptr;
    }
    auto *const resolved_path = omega_util_normalize_path(checkpoint_directory, nullptr);
    if (resolved_path == nullptr) {
        LOG_ERROR("failed to resolve checkpoint_directory path '" << checkpoint_directory << "' to absolute path");
        return nullptr;
    }
    checkpoint_directory_str.assign(resolved_path);
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
    off_t file_size = 0;
    if (file_ptr != nullptr) {
        if (0 != FSEEK(file_ptr, 0L, SEEK_END)) {
            FCLOSE(file_ptr);
            return nullptr;
        }
        file_size = FTELL(file_ptr);
    }
    auto *const session_ptr = new omega_session_t;
    session_ptr->checkpoint_directory_ = checkpoint_directory_str;
    session_ptr->event_handler = cbk;
    session_ptr->user_data_ptr = user_data_ptr;
    session_ptr->event_interest_ = event_interest;
    session_ptr->num_changes_adjustment_ = 0;
    session_ptr->models_.push_back(std::make_unique<omega_model_t>());
    if (file_ptr != nullptr) {
        session_ptr->models_.back()->file_ptr = file_ptr;
        session_ptr->models_.back()->file_path.assign(file_path);
        session_ptr->checkpoint_file_name_.assign(checkpoint_filename);
    }
    initialize_model_segments_(session_ptr->models_.back()->model_segments, file_size);
    omega_session_notify(session_ptr, SESSION_EVT_CREATE, nullptr);
    return session_ptr;
}

void omega_edit_destroy_session(omega_session_t *session_ptr) {
    assert(session_ptr);
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
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    return (omega_session_changes_paused(session_ptr) == 0) && 0 < length && offset < computed_file_size
           ? update_(session_ptr, del_(1 + omega_session_get_num_changes(session_ptr), offset,
                                       std::min(length, static_cast<int64_t>(computed_file_size) - offset),
                                       determine_change_transaction_bit_(session_ptr)))
           : 0;
}

int64_t omega_edit_insert_bytes(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes,
                                int64_t length) {
    return (omega_session_changes_paused(session_ptr) == 0) && 0 <= length &&
           offset <= omega_session_get_computed_file_size(session_ptr)
           ? update_(session_ptr, ins_(1 + omega_session_get_num_changes(session_ptr), offset, bytes, length,
                                       determine_change_transaction_bit_(session_ptr)))
           : 0;
}

int64_t omega_edit_insert(omega_session_t *session_ptr, int64_t offset, const char *cstr, int64_t length) {
    return omega_edit_insert_bytes(session_ptr, offset, (const omega_byte_t *) cstr, length);
}

int64_t omega_edit_overwrite_bytes(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes,
                                   int64_t length) {
    return (omega_session_changes_paused(session_ptr) == 0) && 0 <= length &&
           offset <= omega_session_get_computed_file_size(session_ptr)
           ? update_(session_ptr, ovr_(1 + omega_session_get_num_changes(session_ptr), offset, bytes, length,
                                       determine_change_transaction_bit_(session_ptr)))
           : 0;
}

int64_t omega_edit_overwrite(omega_session_t *session_ptr, int64_t offset, const char *cstr, int64_t length) {
    return omega_edit_overwrite_bytes(session_ptr, offset, (const omega_byte_t *) cstr, length);
}

int omega_edit_apply_transform(omega_session_t *session_ptr, omega_util_byte_transform_t transform, void *user_data_ptr,
                               int64_t offset, int64_t length) {
    if ((omega_session_changes_paused(session_ptr) == 0) && 0 == omega_edit_create_checkpoint(session_ptr)) {
        const auto in_file = session_ptr->models_.back()->file_path;
        const auto out_file = in_file + "_";
        if (0 == omega_util_apply_byte_transform_to_file(in_file.c_str(), out_file.c_str(), transform, user_data_ptr,
                                                         offset, length)) {
            errno = 0;// reset errno
            if (0 == FCLOSE(session_ptr->models_.back()->file_ptr) && 0 == omega_util_remove_file(in_file.c_str()) &&
                0 == rename(out_file.c_str(), in_file.c_str()) &&
                ((session_ptr->models_.back()->file_ptr = FOPEN(in_file.c_str(), "rb")) != nullptr)) {
                for (const auto &viewport_ptr: session_ptr->viewports_) {
                    viewport_ptr->data_segment.capacity =
                            -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
                    omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_TRANSFORM, nullptr);
                }
                omega_session_notify(session_ptr, SESSION_EVT_TRANSFORM, nullptr);
                return 0;
            }

            // In a bad state (I/O failure), so abort
            ABORT(LOG_ERRNO(););
        }
        // The transform failed, but we can recover from this
        if (omega_util_file_exists(out_file.c_str()) != 0) { omega_util_remove_file(out_file.c_str()); }
    }
    return -1;
}

int omega_edit_save_segment(omega_session_t *session_ptr, const char *file_path, int io_flags, char *saved_file_path,
                            int64_t offset, int64_t length) {
    assert(session_ptr);
    assert(file_path);
    assert(0 <= offset);
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    const auto adjusted_length = length <= 0 ? computed_file_size - offset : std::min(length, computed_file_size - offset);
    if (adjusted_length < 0) {
        LOG_ERROR("invalid offset: " << offset << ", length: " << length << ", adjusted_length: " << adjusted_length
                                     << ", computed_file_size: " << computed_file_size);
        return -1;
    }
    char temp_filename[FILENAME_MAX];
    const auto force_overwrite = io_flags & omega_io_flags_t::IO_FLG_FORCE_OVERWRITE;
    const auto overwrite = force_overwrite || io_flags & omega_io_flags_t::IO_FLG_OVERWRITE;
    const auto *const session_file_path = omega_session_get_file_path(session_ptr);
    const auto *const checkpoint_file = session_ptr->checkpoint_file_name_.c_str();
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
        LOG_ERROR("failed to create directory: " << omega_util_normalize_path(temp_filename, nullptr));
        return -2;
    }
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
    const auto mode = omega_util_compute_mode(0666);// S_IRUSR | S_IWUSR | S_IRGRP | S_IWGRP | S_IROTH | S_IWOTH
    const auto temp_fd = omega_util_mkstemp(temp_filename, mode);
    if (temp_fd < 0) {
        LOG_ERROR("mkstemp failed, temp filename: " << temp_filename);
        LOG_ERRNO();
        return -4;
    }
    CLOSE(temp_fd);
    const auto temp_fptr = FOPEN(temp_filename, "wb");
    if (!temp_fptr) {
        LOG_ERRNO();
        close(temp_fd);
        omega_util_remove_file(temp_filename);
        return -5;
    }
    int64_t write_offset = 0;
    int64_t bytes_written = 0;
    for (const auto &segment: session_ptr->models_.back()->model_segments) {
        if (write_offset != segment->computed_offset) {
            ABORT(LOG_ERROR("break in model continuity, expected: " << write_offset
                                                                    << ", got: " << segment->computed_offset););
        }
        // Skip this iteration if the segment is entirely before the start offset
        if (write_offset + segment->computed_length <= offset) {
            write_offset += segment->computed_length;
            continue;
        }

        // Break the loop if we've written all the data that needs to be written
        if (bytes_written >= adjusted_length) { break; }

        // Calculate how much to write from this segment
        auto segment_start = std::max(offset - write_offset, int64_t(0));
        auto segment_length = std::min(adjusted_length - bytes_written, segment->computed_length - segment_start);

        switch (omega_model_segment_get_kind(segment.get())) {
            case model_segment_kind_t::SEGMENT_READ: {
                if (session_ptr->models_.back()->file_ptr == nullptr) {
                    ABORT(LOG_ERROR("attempt to read segment from null file pointer"););
                }
                if (omega_util_write_segment_to_file(session_ptr->models_.back()->file_ptr,
                                                     segment->change_offset + segment_start, segment_length,
                                                     temp_fptr) != segment_length) {
                    FCLOSE(temp_fptr);
                    omega_util_remove_file(temp_filename);
                    LOG_ERROR("omega_util_write_segment_to_file failed");
                    return -6;
                }
                break;
            }
            case model_segment_kind_t::SEGMENT_INSERT: {
                if (static_cast<int64_t>(fwrite(omega_change_get_bytes(segment->change_ptr.get()) +
                                                segment->change_offset + segment_start,
                                                1, segment_length, temp_fptr)) != segment_length) {
                    FCLOSE(temp_fptr);
                    omega_util_remove_file(temp_filename);
                    LOG_ERROR("fwrite failed");
                    return -7;
                }
                break;
            }
            default:
                ABORT(LOG_ERROR("Unhandled segment kind"););
        }
        write_offset += segment->computed_length;
        bytes_written += segment_length;
    }
    FCLOSE(temp_fptr);
    if (bytes_written != adjusted_length) {
        LOG_ERROR("failed to write all requested bytes, expected: " << adjusted_length << ", got: " << bytes_written);
        omega_util_remove_file(temp_filename);
        return -8;
    }
    if (bytes_written != omega_util_file_size(temp_filename)) {
        LOG_ERROR("failed to write all requested bytes to '" << temp_filename << "', expected: " << bytes_written
                                                             << ", got: " << omega_util_file_size(temp_filename));
        //omega_util_remove_file(temp_filename);
        return -9;
    }
    if (omega_util_file_exists(file_path)) {
        if (overwrite) {
            if (0 != omega_util_remove_file(file_path)) {
                LOG_ERRNO();
                return -10;
            }
        } else if ((file_path = omega_util_available_filename(file_path, nullptr)) == nullptr) {
            LOG_ERROR("cannot find an available filename");
            return -11;
        }
    }
    if (rename(temp_filename, file_path) != 0) {
        LOG_ERRNO();
        return -12;
    }
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

    if (saved_file_path != nullptr) { omega_util_normalize_path(file_path, saved_file_path); }
    omega_session_notify(session_ptr, SESSION_EVT_SAVE, saved_file_path);
    return 0;
}

int omega_edit_save(omega_session_t *session_ptr, const char *file_path, int io_flags, char *saved_file_path) {
    return omega_edit_save_segment(session_ptr, file_path, io_flags, saved_file_path, 0, 0);
}

int omega_edit_clear_changes(omega_session_t *session_ptr) {
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
    if ((omega_session_changes_paused(session_ptr) == 0) && !session_ptr->models_.back()->changes.empty()) {
        const auto change_ptr = session_ptr->models_.back()->changes.back();
        session_ptr->models_.back()->changes.pop_back();
        int64_t length = 0;
        if (session_ptr->models_.back()->file_ptr != nullptr) {
            if (0 != FSEEK(session_ptr->models_.back()->file_ptr, 0L, SEEK_END)) { return -1; }
            length = FTELL(session_ptr->models_.back()->file_ptr);
        }
        initialize_model_segments_(session_ptr->models_.back()->model_segments, length);
        for (const auto &change: session_ptr->models_.back()->changes) {
            if (0 > update_model_(session_ptr, change)) { return -1; }
        }

        // Negate the undone change's serial number to indicate that the change has been undone
        auto *const undone_change_ptr = const_cast<omega_change_t *>(change_ptr.get());
        undone_change_ptr->serial *= -1;

        session_ptr->models_.back()->changes_undone.push_back(change_ptr);
        update_viewports_(session_ptr, undone_change_ptr);
        omega_session_notify(session_ptr, SESSION_EVT_UNDO, undone_change_ptr);

        // If the undone change is part of a transaction, then undo the entire transaction
        if (!session_ptr->models_.back()->changes.empty() &&
            omega_change_get_transaction_bit_(undone_change_ptr) ==
            omega_change_get_transaction_bit_(session_ptr->models_.back()->changes.back().get())) {
            return omega_edit_undo_last_change(session_ptr);
        }

        return undone_change_ptr->serial;
    }
    return 0;
}

int64_t omega_edit_redo_last_undo(omega_session_t *session_ptr) {
    int64_t rc = 0;
    if ((omega_session_changes_paused(session_ptr) == 0) && !session_ptr->models_.back()->changes_undone.empty()) {
        const auto change_ptr = session_ptr->models_.back()->changes_undone.back();
        rc = update_(session_ptr, change_ptr);
        session_ptr->models_.back()->changes_undone.pop_back();
        // If the redone change is part of a transaction, then redo the entire transaction
        if (!session_ptr->models_.back()->changes_undone.empty() &&
            omega_change_get_transaction_bit_(change_ptr.get()) ==
            omega_change_get_transaction_bit_(session_ptr->models_.back()->changes_undone.back().get())) {
            rc = omega_edit_redo_last_undo(session_ptr);
        }
    }
    return rc;
}

int omega_edit_create_checkpoint(omega_session_t *session_ptr) {
    const auto *const checkpoint_directory = omega_session_get_checkpoint_directory(session_ptr);
    // make sure the checkpoint directory exists
    if (omega_util_directory_exists(checkpoint_directory) == 0) {
        LOG_ERROR("checkpoint directory '" << checkpoint_directory << "' does not exist");
    }
    char checkpoint_filename[FILENAME_MAX];
    if (FILENAME_MAX <= snprintf(checkpoint_filename, FILENAME_MAX, "%s%c.OmegaEdit-chk.%zu.XXXXXX",
                                 checkpoint_directory, omega_util_directory_separator(), session_ptr->models_.size())) {
        LOG_ERROR("failed to create checkpoint filename template");
        return -1;
    }
    const auto checkpoint_fd = omega_util_mkstemp(checkpoint_filename, 0600);// S_IRUSR | S_IWUSR
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
        return 0;
    }
    return -1;
}
