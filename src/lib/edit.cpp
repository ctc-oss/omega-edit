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
#include "../include/omega_edit/session.h"
#include "../include/omega_edit/viewport.h"
#include "impl_/change_def.hpp"
#include "impl_/internal_fun.hpp"
#include "impl_/macros.h"
#include "impl_/model_def.hpp"
#include "impl_/model_segment_def.hpp"
#include "impl_/session_def.hpp"
#include "impl_/viewport_def.hpp"
#include <cassert>
#include <memory>
#ifdef OMEGA_BUILD_WINDOWS
#include <io.h>
#define close _close
#else
#include <unistd.h>
#endif

static void initialize_model_segments_(omega_model_segments_t &model_segments, int64_t length) {
    model_segments.clear();
    if (0 < length) {
        // Model begins with a single READ segment spanning the original file
        auto change_ptr = std::make_shared<omega_change_t>();
        change_ptr->serial = 0;
        change_ptr->kind = change_kind_t::CHANGE_INSERT;
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

static inline const_omega_change_ptr_t del_(int64_t serial, int64_t offset, int64_t length) {
    auto change_ptr = std::make_shared<omega_change_t>();
    change_ptr->serial = serial;
    change_ptr->kind = change_kind_t::CHANGE_DELETE;
    change_ptr->offset = offset;
    change_ptr->length = length;
    change_ptr->data.bytes_ptr = nullptr;
    return change_ptr;
}

static inline const_omega_change_ptr_t ins_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length) {
    auto change_ptr = std::make_shared<omega_change_t>();
    change_ptr->serial = serial;
    change_ptr->kind = change_kind_t::CHANGE_INSERT;
    change_ptr->offset = offset;
    change_ptr->length = (length) ? length : static_cast<int64_t>(strlen((const char *) bytes));
    if (change_ptr->length < 8) {
        // small bytes optimization
        memcpy(change_ptr->data.sm_bytes, bytes, change_ptr->length);
        change_ptr->data.sm_bytes[change_ptr->length] = '\0';
    } else {
        change_ptr->data.bytes_ptr = new omega_byte_t[change_ptr->length + 1];
        memcpy(change_ptr->data.bytes_ptr, bytes, change_ptr->length);
        change_ptr->data.bytes_ptr[change_ptr->length] = '\0';
    }
    return change_ptr;
}

static inline const_omega_change_ptr_t ovr_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length) {
    auto change_ptr = std::make_shared<omega_change_t>();
    change_ptr->serial = serial;
    change_ptr->kind = change_kind_t::CHANGE_OVERWRITE;
    change_ptr->offset = offset;
    change_ptr->length = (length) ? length : static_cast<int64_t>(strlen((const char *) bytes));
    if (change_ptr->length < 8) {
        // small bytes optimization
        memcpy(change_ptr->data.sm_bytes, bytes, change_ptr->length);
        change_ptr->data.sm_bytes[change_ptr->length] = '\0';
    } else {
        change_ptr->data.bytes_ptr = new omega_byte_t[change_ptr->length + 1];
        memcpy(change_ptr->data.bytes_ptr, bytes, change_ptr->length);
        change_ptr->data.bytes_ptr[change_ptr->length] = '\0';
    }
    return change_ptr;
}

static inline void update_viewport_offset_adjustment_(omega_viewport_t *viewport_ptr,
                                                      const omega_change_t *change_ptr) {
    assert(0 < change_ptr->length);
    // If the viewport is floating and a change happens before or at the start of the given viewport...
    if (omega_viewport_is_floating(viewport_ptr) && change_ptr->offset <= omega_viewport_get_offset(viewport_ptr)) {
        // ...and the change is a delete, or insert, update the offset adjustment accordingly
        if (change_kind_t::CHANGE_DELETE == change_ptr->kind) {
            viewport_ptr->data_segment.offset_adjustment -= change_ptr->length;
        } else if (change_kind_t::CHANGE_INSERT == change_ptr->kind) {
            viewport_ptr->data_segment.offset_adjustment += change_ptr->length;
        }
    }
}

static inline bool change_affects_viewport_(const omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr) {
    assert(0 < change_ptr->length);
    switch (change_ptr->kind) {
        case change_kind_t::CHANGE_DELETE:// deliberate fall-through
        case change_kind_t::CHANGE_INSERT:
            // INSERT and DELETE changes that happen before the viewport end offset affect the viewport
            return (change_ptr->offset <=
                    (omega_viewport_get_offset(viewport_ptr) + omega_viewport_get_capacity(viewport_ptr)));
        case change_kind_t::CHANGE_OVERWRITE:
            // OVERWRITE changes that happen inside the viewport affect the viewport
            return ((change_ptr->offset + change_ptr->length) >= omega_viewport_get_offset(viewport_ptr)) &&
                   (change_ptr->offset <=
                    (omega_viewport_get_offset(viewport_ptr) + omega_viewport_get_capacity(viewport_ptr)));
        default:
            ABORT(LOG_ERROR("Unhandled change kind"););
    }
}

static int update_viewports_(const omega_session_t *session_ptr, const omega_change_t *change_ptr) {
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

static inline omega_model_segment_ptr_t clone_model_segment_(const omega_model_segment_ptr_t &segment_ptr) {
    auto result = std::make_unique<omega_model_segment_t>();
    result->computed_offset = segment_ptr->computed_offset;
    result->computed_length = segment_ptr->computed_length;
    result->change_offset = segment_ptr->change_offset;
    result->change_ptr = segment_ptr->change_ptr;
    return result;
}

static inline void free_model_changes_(omega_model_struct *model_ptr) {
    for (auto &&change_ptr : model_ptr->changes) {
        if (change_ptr->kind != change_kind_t::CHANGE_DELETE && 7 < change_ptr->length) {
            delete[] const_cast<omega_change_t *>(change_ptr.get())->data.bytes_ptr;
        }
    }
    model_ptr->changes.clear();
}

static inline void free_model_changes_undone_(omega_model_struct *model_ptr) {
    for (auto &&change_ptr : model_ptr->changes_undone) {
        if (change_ptr->kind != change_kind_t::CHANGE_DELETE && 7 < change_ptr->length) {
            delete[] const_cast<omega_change_t *>(change_ptr.get())->data.bytes_ptr;
        }
    }
    model_ptr->changes_undone.clear();
}

static inline void free_session_changes_(omega_session_t *session_ptr) {
    for (auto &&model_ptr : session_ptr->models_) { free_model_changes_(model_ptr.get()); }
}

static inline void free_session_changes_undone_(omega_session_t *session_ptr) {
    for (auto &&model_ptr : session_ptr->models_) { free_model_changes_undone_(model_ptr.get()); }
}

/* --------------------------------------------------------------------------------------------------------------------
 The objective here is to model the edits using segments.  Essentially creating a contiguous model of the file by
 keeping track of what to do.  The verbs here are READ, INSERT, and OVERWRITE.  We don't need to model DELETE because
 that is covered by adjusting, or removing, the READ, INSERT, and OVERWRITE segments accordingly.  The model expects to
 take in changes with original offsets and lengths and the model will calculate computed offsets and lengths.
 -------------------------------------------------------------------------------------------------------------------- */
static int update_model_helper_(omega_model_t *model_ptr, const_omega_change_ptr_t &change_ptr) {
    int64_t read_offset = 0;

    if (model_ptr->model_segments.empty()) {
        if (change_ptr->kind != change_kind_t::CHANGE_DELETE) {
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
                                                                    << ", got: " << (*iter)->computed_offset););
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
            switch (change_ptr->kind) {
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

static int update_model_(omega_model_t *model_ptr, const_omega_change_ptr_t &change_ptr) {
    if (change_ptr->kind == change_kind_t::CHANGE_OVERWRITE) {
        // Overwrite will model just like a DELETE, followed by an INSERT
        const_omega_change_ptr_t const_change_ptr = del_(0, change_ptr->offset, change_ptr->length);
        auto rc = update_model_helper_(model_ptr, const_change_ptr);
        if (0 != rc) { return rc; }
    }
    return update_model_helper_(model_ptr, change_ptr);
}

static int64_t update_(omega_session_t *session_ptr, const_omega_change_ptr_t change_ptr) {
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    if (change_ptr->offset <= computed_file_size) {
        if (omega_change_get_serial(change_ptr.get()) < 0) {
            // This is a previously undone change that is being redone, so flip the serial number back to positive
            const_cast<omega_change_t *>(change_ptr.get())->serial *= -1;
        } else if (!session_ptr->models_.back()->changes_undone.empty()) {
            // This is not a redo change, so any changes undone are now invalid and must be cleared
            free_session_changes_undone_(session_ptr);
        }
        session_ptr->models_.back()->changes.push_back(change_ptr);
        if (0 != update_model_(session_ptr->models_.back().get(), change_ptr)) { return -1; }
        update_viewports_(session_ptr, change_ptr.get());
        omega_session_notify(session_ptr, SESSION_EVT_EDIT, change_ptr.get());
        return omega_change_get_serial(change_ptr.get());
    }
    return -1;
}

omega_session_t *omega_edit_create_session(const char *file_path, omega_session_event_cbk_t cbk, void *user_data_ptr) {
    FILE *file_ptr = nullptr;
    if (file_path && file_path[0] != '\0') {
        file_ptr = fopen(file_path, "rb");
        if (!file_ptr) { return nullptr; }
    }
    off_t file_size = 0;
    if (file_ptr) {
        if (0 != FSEEK(file_ptr, 0L, SEEK_END)) { return nullptr; }
        file_size = FTELL(file_ptr);
    }
    const auto session_ptr = new omega_session_t;
    session_ptr->event_handler = cbk;
    session_ptr->user_data_ptr = user_data_ptr;
    session_ptr->num_changes_adjustment_ = 0;
    session_ptr->models_.push_back(std::make_unique<omega_model_t>());
    session_ptr->models_.back()->file_ptr = file_ptr;
    session_ptr->models_.back()->file_path =
            (file_path && file_path[0] != '\0') ? std::string(file_path) : std::string();
    initialize_model_segments_(session_ptr->models_.back()->model_segments, file_size);
    omega_session_notify(session_ptr, SESSION_EVT_CREATE, nullptr);
    return session_ptr;
}

void omega_edit_destroy_session(omega_session_t *session_ptr) {
    assert(session_ptr);
    for (auto &&model_ptr : session_ptr->models_) {
        if (model_ptr->file_ptr) { fclose(model_ptr->file_ptr); }
    }
    while (!session_ptr->viewports_.empty()) { omega_edit_destroy_viewport(session_ptr->viewports_.back().get()); }
    free_session_changes_(session_ptr);
    free_session_changes_undone_(session_ptr);
    while (omega_session_get_num_checkpoints(session_ptr)) {
        if (0 != omega_util_remove_file(session_ptr->models_.back()->file_path.c_str())) { LOG_ERROR(strerror(errno)); }
        session_ptr->models_.pop_back();
    }
    delete session_ptr;
}

omega_viewport_t *omega_edit_create_viewport(omega_session_t *session_ptr, int64_t offset, int64_t capacity,
                                             omega_viewport_event_cbk_t cbk, void *user_data_ptr, int is_floating) {
    if (capacity > 0 && capacity <= OMEGA_VIEWPORT_CAPACITY_LIMIT) {
        const auto viewport_ptr = std::make_shared<omega_viewport_t>();
        viewport_ptr->session_ptr = session_ptr;
        viewport_ptr->data_segment.offset = offset;
        viewport_ptr->data_segment.offset_adjustment = 0;
        viewport_ptr->data_segment.is_floating = (bool) is_floating;
        viewport_ptr->data_segment.capacity = -1 * capacity;// Negative capacity indicates dirty read
        viewport_ptr->data_segment.length = 0;
        viewport_ptr->data_segment.data.bytes_ptr = (7 < capacity) ? new omega_byte_t[capacity + 1] : nullptr;
        viewport_ptr->event_handler = cbk;
        viewport_ptr->user_data_ptr = user_data_ptr;
        omega_data_segment_get_data(&viewport_ptr->data_segment)[0] = '\0';
        session_ptr->viewports_.push_back(viewport_ptr);
        omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_CREATE, nullptr);
        return session_ptr->viewports_.back().get();
    }
    return nullptr;
}

void omega_edit_destroy_viewport(omega_viewport_t *viewport_ptr) {
    for (auto iter = viewport_ptr->session_ptr->viewports_.rbegin();
         iter != viewport_ptr->session_ptr->viewports_.rend(); ++iter) {
        if (viewport_ptr == iter->get()) {
            if (7 < omega_viewport_get_capacity(iter->get())) { delete[](*iter)->data_segment.data.bytes_ptr; }
            viewport_ptr->session_ptr->viewports_.erase(std::next(iter).base());
            break;
        }
    }
}

int64_t omega_edit_delete(omega_session_t *session_ptr, int64_t offset, int64_t length) {
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    return (0 < length && offset < computed_file_size)
                   ? update_(session_ptr, del_(1 + static_cast<int64_t>(omega_session_get_num_changes(session_ptr)),
                                               offset, std::min(length, computed_file_size - offset)))
                   : 0;
}

int64_t omega_edit_insert_bytes(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes,
                                int64_t length) {
    return (0 <= length && offset <= omega_session_get_computed_file_size(session_ptr))
                   ? update_(session_ptr, ins_(1 + static_cast<int64_t>(omega_session_get_num_changes(session_ptr)),
                                               offset, bytes, length))
                   : 0;
}

int64_t omega_edit_insert(omega_session_t *session_ptr, int64_t offset, const char *cstr, int64_t length) {
    return omega_edit_insert_bytes(session_ptr, offset, (const omega_byte_t *) cstr, length);
}

int64_t omega_edit_overwrite_bytes(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes,
                                   int64_t length) {
    return (0 <= length && offset <= omega_session_get_computed_file_size(session_ptr))
                   ? update_(session_ptr, ovr_(1 + static_cast<int64_t>(omega_session_get_num_changes(session_ptr)),
                                               offset, bytes, length))
                   : 0;
}

int64_t omega_edit_overwrite(omega_session_t *session_ptr, int64_t offset, const char *cstr, int64_t length) {
    return omega_edit_overwrite_bytes(session_ptr, offset, (const omega_byte_t *) cstr, length);
}

int omega_edit_apply_transform(omega_session_t *session_ptr, omega_util_byte_transform_t transform, void *user_data_ptr,
                               int64_t offset, int64_t length, char const *checkpoint_directory) {
    if (0 == omega_edit_create_checkpoint(session_ptr, checkpoint_directory)) {
        auto in_file = session_ptr->models_.back()->file_path;
        auto out_file = in_file + "_";
        if (0 == omega_util_apply_byte_transform_to_file(in_file.c_str(), out_file.c_str(), transform, user_data_ptr,
                                                         offset, length)) {
            errno = 0;
            if (0 == fclose(session_ptr->models_.back()->file_ptr) && 0 == omega_util_remove_file(in_file.c_str()) &&
                0 == rename(out_file.c_str(), in_file.c_str()) &&
                (session_ptr->models_.back()->file_ptr = fopen(in_file.c_str(), "rb"))) {
                for (const auto &viewport_ptr : session_ptr->viewports_) {
                    viewport_ptr->data_segment.capacity =
                            -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
                    omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_TRANSFORM, nullptr);
                }
                omega_session_notify(session_ptr, SESSION_EVT_TRANSFORM, nullptr);
                return 0;
            }

            // In a bad state (I/O failure), so abort
            ABORT(LOG_ERROR(strerror(errno)););
        }
        // The transform failed, but we can recover from this
        if (omega_util_file_exists(out_file.c_str())) { omega_util_remove_file(out_file.c_str()); }
    }
    return -1;
}

int omega_edit_save(const omega_session_t *session_ptr, const char *file_path, int overwrite, char *saved_file_path) {
    char temp_filename[FILENAME_MAX];
    omega_util_dirname(file_path, temp_filename);
    if (!omega_util_directory_exists(temp_filename) && 0 != omega_util_create_directory(temp_filename)) {
        LOG_ERROR("failed to create directory: " << omega_util_normalize_path(temp_filename, nullptr));
        return -1;
    }
    const auto temp_filename_str = std::string(temp_filename);
    auto count = (temp_filename_str.empty()) ? snprintf(temp_filename, FILENAME_MAX, ".OmegaEdit_XXXXXX")
                                             : snprintf(temp_filename, FILENAME_MAX, "%s%c.OmegaEdit_XXXXXX",
                                                        temp_filename_str.c_str(), omega_util_directory_separator());
    if (count < 0 || FILENAME_MAX <= count) {
        LOG_ERROR("snprintf failed");
        return -2;
    }
    errno = 0;// reset errno
    auto temp_fd = omega_util_mkstemp(temp_filename);
    if (temp_fd < 0) {
        LOG_ERROR("mkstemp failed: " << strerror(errno) << ", temp filename: " << temp_filename);
        return -3;
    }
    auto temp_fptr = fdopen(temp_fd, "wb");
    if (!temp_fptr) {
        LOG_ERROR("fdopen failed: " << strerror(errno));
        close(temp_fd);
        omega_util_remove_file(temp_filename);
        return -4;
    }
    int64_t write_offset = 0;
    for (const auto &segment : session_ptr->models_.back()->model_segments) {
        if (write_offset != segment->computed_offset) {
            ABORT(LOG_ERROR("break in model continuity, expected: " << write_offset
                                                                    << ", got: " << segment->computed_offset););
        }
        switch (omega_model_segment_get_kind(segment.get())) {
            case model_segment_kind_t::SEGMENT_READ: {
                if (!session_ptr->models_.back()->file_ptr) {
                    ABORT(LOG_ERROR("attempt to read segment from null file pointer"););
                }
                if (omega_util_write_segment_to_file(session_ptr->models_.back()->file_ptr, segment->change_offset,
                                                     segment->computed_length, temp_fptr) != segment->computed_length) {
                    fclose(temp_fptr);
                    omega_util_remove_file(temp_filename);
                    LOG_ERROR("omega_util_write_segment_to_file failed");
                    return -5;
                }
                break;
            }
            case model_segment_kind_t::SEGMENT_INSERT: {
                if (static_cast<int64_t>(
                            fwrite(omega_change_get_bytes(segment->change_ptr.get()) + segment->change_offset, 1,
                                   segment->computed_length, temp_fptr)) != segment->computed_length) {
                    fclose(temp_fptr);
                    omega_util_remove_file(temp_filename);
                    LOG_ERROR("fwrite failed");
                    return -6;
                }
                break;
            }
            default:
                ABORT(LOG_ERROR("Unhandled segment kind"););
        }
        write_offset += segment->computed_length;
    }
    fclose(temp_fptr);
    if (omega_util_file_exists(file_path)) {
        if (overwrite) {
            if (0 != omega_util_remove_file(file_path)) {
                LOG_ERROR("removing file failed: " << strerror(errno));
                return -7;
            }
        } else {
            if (!(file_path = omega_util_available_filename(file_path, nullptr))) {
                LOG_ERROR("cannot find available filename");
                return -8;
            }
        }
    }
    if (rename(temp_filename, file_path)) {
        LOG_ERROR("rename failed: " << strerror(errno));
        return -9;
    }
    if (saved_file_path) { strcpy(saved_file_path, file_path); }
    omega_session_notify(session_ptr, SESSION_EVT_SAVE, nullptr);
    return 0;
}

int omega_edit_clear_changes(omega_session_t *session_ptr) {
    int64_t length = 0;
    if (session_ptr->models_.front()->file_ptr) {
        if (0 != FSEEK(session_ptr->models_.front()->file_ptr, 0L, SEEK_END)) { return -1; }
        length = FTELL(session_ptr->models_.front()->file_ptr);
    }
    initialize_model_segments_(session_ptr->models_.front()->model_segments, length);
    free_session_changes_(session_ptr);
    for (const auto &viewport_ptr : session_ptr->viewports_) {
        viewport_ptr->data_segment.capacity = -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
        omega_viewport_notify(viewport_ptr.get(), VIEWPORT_EVT_CLEAR, nullptr);
    }
    omega_session_notify(session_ptr, SESSION_EVT_CLEAR, nullptr);
    return 0;
}

int64_t omega_edit_undo_last_change(omega_session_t *session_ptr) {
    if (!session_ptr->models_.back()->changes.empty()) {
        const auto change_ptr = session_ptr->models_.back()->changes.back();
        session_ptr->models_.back()->changes.pop_back();
        int64_t length = 0;
        if (session_ptr->models_.back()->file_ptr) {
            if (0 != FSEEK(session_ptr->models_.back()->file_ptr, 0L, SEEK_END)) { return -1; }
            length = FTELL(session_ptr->models_.back()->file_ptr);
        }
        initialize_model_segments_(session_ptr->models_.back()->model_segments, length);
        for (auto iter = session_ptr->models_.back()->changes.begin();
             iter != session_ptr->models_.back()->changes.end(); ++iter) {
            if (0 > update_model_(session_ptr->models_.back().get(), *iter)) { return -1; }
        }

        // Negate the undone change's serial number to indicate that the change has been undone
        const auto undone_change_ptr = const_cast<omega_change_t *>(change_ptr.get());
        undone_change_ptr->serial *= -1;

        session_ptr->models_.back()->changes_undone.push_back(change_ptr);
        update_viewports_(session_ptr, undone_change_ptr);
        omega_session_notify(session_ptr, SESSION_EVT_UNDO, undone_change_ptr);
        return undone_change_ptr->serial;
    }
    return 0;
}

int64_t omega_edit_redo_last_undo(omega_session_t *session_ptr) {
    int64_t rc = 0;
    if (!session_ptr->models_.back()->changes_undone.empty()) {
        rc = update_(session_ptr, session_ptr->models_.back()->changes_undone.back());
        session_ptr->models_.back()->changes_undone.pop_back();
    }
    return rc;
}

int omega_edit_create_checkpoint(omega_session_t *session_ptr, char const *checkpoint_directory) {
    char checkpoint_filename[FILENAME_MAX];
    if (FILENAME_MAX <= snprintf(checkpoint_filename, FILENAME_MAX, "%s%c.OmegaEdit-chk.%zu.XXXXXX",
                                 omega_util_normalize_path(checkpoint_directory, nullptr),
                                 omega_util_directory_separator(), session_ptr->models_.size())) {
        LOG_ERROR("failed to create checkpoint filename template");
        return -1;
    }
    int checkpoint_fd = omega_util_mkstemp(checkpoint_filename);
    close(checkpoint_fd);
    if (0 != omega_edit_save(session_ptr, checkpoint_filename, 1, nullptr)) {
        LOG_ERROR("failed to save checkpoint file");
        return -1;
    }
    auto file_size = omega_session_get_computed_file_size(session_ptr);
    session_ptr->num_changes_adjustment_ = omega_session_get_num_changes(session_ptr);
    session_ptr->models_.push_back(std::make_unique<omega_model_t>());
    session_ptr->models_.back()->file_ptr = fopen(checkpoint_filename, "rb");
    session_ptr->models_.back()->file_path = checkpoint_filename;
    initialize_model_segments_(session_ptr->models_.back()->model_segments, file_size);
    omega_session_notify(session_ptr, SESSION_EVT_CREATE_CHECKPOINT, nullptr);
    return 0;
}

int omega_edit_destroy_last_checkpoint(omega_session_t *session_ptr) {
    if (omega_session_get_num_checkpoints(session_ptr)) {
        const auto last_checkpoint_ptr = session_ptr->models_.back().get();
        fclose(last_checkpoint_ptr->file_ptr);
        if (0 != omega_util_remove_file(last_checkpoint_ptr->file_path.c_str())) { LOG_ERROR(strerror(errno)); }
        free_model_changes_(last_checkpoint_ptr);
        free_model_changes_undone_(last_checkpoint_ptr);
        session_ptr->num_changes_adjustment_ -= (int64_t) session_ptr->models_.back()->changes.size();
        session_ptr->models_.pop_back();
        omega_session_notify(session_ptr, SESSION_EVT_DESTROY_CHECKPOINT, nullptr);
        return 0;
    }
    return -1;
}
