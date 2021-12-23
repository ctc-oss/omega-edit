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

#include "../include/edit.h"
#include "../include/change.h"
#include "../include/session.h"
#include "../include/viewport.h"
#include "impl_/change_def.hpp"
#include "impl_/internal_fun.hpp"
#include "impl_/macros.hpp"
#include "impl_/model_def.hpp"
#include "impl_/model_segment_def.hpp"
#include "impl_/session_def.hpp"
#include "impl_/viewport_def.hpp"
#include <cassert>
#include <memory>

static int64_t write_segment_to_file_(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr) {
    if (0 != fseeko(from_file_ptr, offset, SEEK_SET)) { return -1; }
    const int64_t buff_size = 1024 * 8;
    auto remaining = byte_count;
    omega_byte_t buff[buff_size];
    while (remaining) {
        const auto count = (buff_size > remaining) ? remaining : buff_size;
        if (count != static_cast<int64_t>(fread(buff, 1, count, from_file_ptr)) ||
            count != static_cast<int64_t>(fwrite(buff, 1, count, to_file_ptr))) {
            break;
        }
        remaining -= count;
    }
    return byte_count - remaining;
}

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

static const_omega_change_ptr_t del_(int64_t serial, int64_t offset, int64_t length) {
    auto change_ptr = std::make_shared<omega_change_t>();
    change_ptr->serial = serial;
    change_ptr->kind = change_kind_t::CHANGE_DELETE;
    change_ptr->offset = offset;
    change_ptr->length = length;
    change_ptr->data.bytes_ptr = nullptr;
    return change_ptr;
}

static const_omega_change_ptr_t ins_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length) {
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

static const_omega_change_ptr_t ovr_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length) {
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

static inline bool change_affects_viewport_(const omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr) {
    switch (change_ptr->kind) {
        case change_kind_t::CHANGE_DELETE:// deliberate fall-through
        case change_kind_t::CHANGE_INSERT:
            // INSERT and DELETE changes that happen before the viewport end offset affect the viewport
            return (change_ptr->offset <=
                    (viewport_ptr->data_segment.offset + omega_viewport_get_capacity(viewport_ptr)));
        case change_kind_t::CHANGE_OVERWRITE:
            return ((change_ptr->offset + change_ptr->length) >= viewport_ptr->data_segment.offset) &&
                   (change_ptr->offset <=
                    (viewport_ptr->data_segment.offset + omega_viewport_get_capacity(viewport_ptr)));
        default:
            ABORT(CLOG << LOCATION << " Unhandled change kind" << std::endl;);
    }
}

static int update_viewports_(omega_session_t *session_ptr, const omega_change_t *change_ptr) {
    for (const auto &viewport_ptr : session_ptr->viewports_) {
        if (change_affects_viewport_(viewport_ptr.get(), change_ptr)) {
            viewport_ptr->data_segment.capacity =
                    -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
            omega_viewport_execute_on_change(viewport_ptr.get(), change_ptr);
        }
    }
    return 0;
}

static omega_model_segment_ptr_t clone_model_segment_(const omega_model_segment_ptr_t &segment_ptr) {
    auto result = std::make_unique<omega_model_segment_t>();
    result->computed_offset = segment_ptr->computed_offset;
    result->computed_length = segment_ptr->computed_length;
    result->change_offset = segment_ptr->change_offset;
    result->change_ptr = segment_ptr->change_ptr;
    return result;
}

/* --------------------------------------------------------------------------------------------------------------------
 The objective here is to model the edits using segments.  Essentially creating a contiguous model of the file by
 keeping track of what to do.  The verbs here are READ, INSERT, and OVERWRITE.  We don't need to model DELETE because
 that is covered by adjusting, or removing, the READ, INSERT, and OVERWRITE segments accordingly.  The model expects to
 take in changes with original offsets and lengths and the model will calculate computed offsets and lengths.
 -------------------------------------------------------------------------------------------------------------------- */
static int update_model_helper_(omega_model_t *model_ptr, const_omega_change_ptr_t &change_ptr) {
    int64_t read_offset = 0;

    if (model_ptr->model_segments.empty() && change_ptr->kind != change_kind_t::CHANGE_DELETE) {
        // The model is empty, and we have a change with content
        auto insert_segment_ptr = std::make_unique<omega_model_segment_t>();
        insert_segment_ptr->computed_offset = change_ptr->offset;
        insert_segment_ptr->computed_length = change_ptr->length;
        insert_segment_ptr->change_offset = 0;
        insert_segment_ptr->change_ptr = change_ptr;
        model_ptr->model_segments.push_back(std::move(insert_segment_ptr));
        return 0;
    }
    for (auto iter = model_ptr->model_segments.begin(); iter != model_ptr->model_segments.end(); ++iter) {
        if (read_offset != (*iter)->computed_offset) {
            ABORT(print_model_segments_(model_ptr, CLOG);
                  CLOG << LOCATION << " break in model continuity, expected: " << read_offset
                       << ", got: " << (*iter)->computed_offset << std::endl;);
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
                    ABORT(CLOG << LOCATION << " Unhandled change kind" << std::endl;);
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
        if (change_ptr->serial < 0) {
            // This is a previously undone change that is being redone, so flip the serial number back to positive
            const auto undone_change_ptr = const_cast<omega_change_t *>(change_ptr.get());
            undone_change_ptr->serial *= -1;
        } else if (!session_ptr->model_ptr_->changes_undone.empty()) {
            // This is not a redo change, so any changes undone are now invalid and must be cleared
            session_ptr->model_ptr_->changes_undone.clear();
        }
        session_ptr->model_ptr_->changes.push_back(change_ptr);
        if (0 != update_model_(session_ptr->model_ptr_.get(), change_ptr)) { return -1; }
        update_viewports_(session_ptr, change_ptr.get());
        if (session_ptr->on_change_cbk) { session_ptr->on_change_cbk(session_ptr, change_ptr.get()); }
        return change_ptr->serial;
    }
    return -1;
}

omega_session_t *omega_edit_create_session(const char *file_path, omega_session_on_change_cbk_t cbk,
                                           void *user_data_ptr) {
    FILE *file_ptr = nullptr;
    if (file_path && file_path[0] != '\0') {
        file_ptr = fopen(file_path, "r");
        if (!file_ptr) { return nullptr; }
    }
    off_t file_size = 0;
    if (file_ptr) {
        if (0 != fseeko(file_ptr, 0L, SEEK_END)) { return nullptr; }
        file_size = ftello(file_ptr);
    }
    const auto session_ptr = new omega_session_t;
    session_ptr->file_ptr = file_ptr;
    session_ptr->file_path = (file_path && file_path[0] != '\0') ? std::string(file_path) : std::string();
    session_ptr->on_change_cbk = cbk;
    session_ptr->user_data_ptr = user_data_ptr;
    session_ptr->model_ptr_ = std::make_unique<omega_model_t>();
    initialize_model_segments_(session_ptr->model_ptr_->model_segments, file_size);
    return session_ptr;
}

void omega_edit_destroy_session(omega_session_t *session_ptr) {
    if (session_ptr->file_ptr) { fclose(session_ptr->file_ptr); }
    while (!session_ptr->viewports_.empty()) { omega_edit_destroy_viewport(session_ptr->viewports_.back().get()); }
    for (auto &change_ptr : session_ptr->model_ptr_->changes) {
        if (change_ptr->kind != change_kind_t::CHANGE_DELETE && 7 < change_ptr->length) {
            delete[] const_cast<omega_change_t *>(change_ptr.get())->data.bytes_ptr;
        }
    }
    delete session_ptr;
}

omega_viewport_t *omega_edit_create_viewport(omega_session_t *session_ptr, int64_t offset, int64_t capacity,
                                             omega_viewport_on_change_cbk_t cbk, void *user_data_ptr) {
    if (capacity > 0 and capacity <= OMEGA_VIEWPORT_CAPACITY_LIMIT) {
        const auto viewport_ptr = std::make_shared<omega_viewport_t>();
        viewport_ptr->session_ptr = session_ptr;
        viewport_ptr->data_segment.offset = offset;
        viewport_ptr->data_segment.capacity = -1 * capacity;// Negative capacity indicates dirty read
        viewport_ptr->data_segment.length = 0;
        viewport_ptr->data_segment.data.bytes_ptr = (7 < capacity) ? new omega_byte_t[capacity + 1] : nullptr;
        viewport_ptr->on_change_cbk = cbk;
        viewport_ptr->user_data_ptr = user_data_ptr;
        session_ptr->viewports_.push_back(viewport_ptr);
        omega_data_segment_get_data(&viewport_ptr->data_segment)[0] = '\0';
        omega_viewport_execute_on_change(viewport_ptr.get(), nullptr);
        return viewport_ptr.get();
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
    return (0 <= length && offset < omega_session_get_computed_file_size(session_ptr))
                   ? update_(session_ptr, ovr_(1 + static_cast<int64_t>(omega_session_get_num_changes(session_ptr)),
                                               offset, bytes, length))
                   : 0;
}

int64_t omega_edit_overwrite(omega_session_t *session_ptr, int64_t offset, const char *cstr, int64_t length) {
    return omega_edit_overwrite_bytes(session_ptr, offset, (const omega_byte_t *) cstr, length);
}

int omega_edit_save(const omega_session_t *session_ptr, const char *file_path) {
    auto file_ptr = fopen(file_path, "w");
    if (file_ptr) {
        int64_t write_offset = 0;
        for (const auto &segment : session_ptr->model_ptr_->model_segments) {
            if (write_offset != segment->computed_offset) {
                ABORT(CLOG << LOCATION << " break in model continuity, expected: " << write_offset
                           << ", got: " << segment->computed_offset << std::endl;);
            }
            switch (omega_model_segment_get_kind(segment.get())) {
                case model_segment_kind_t::SEGMENT_READ: {
                    if (!session_ptr->file_ptr) {
                        ABORT(CLOG << LOCATION << " attempt to read segment from null file pointer" << std::endl;);
                    }
                    if (write_segment_to_file_(session_ptr->file_ptr, segment->change_offset, segment->computed_length,
                                               file_ptr) != segment->computed_length) {
                        return -1;
                    }
                    break;
                }
                case model_segment_kind_t::SEGMENT_INSERT: {
                    if (static_cast<int64_t>(
                                fwrite(omega_change_get_bytes(segment->change_ptr.get()) + segment->change_offset, 1,
                                       segment->computed_length, file_ptr)) != segment->computed_length) {
                        return -1;
                    }
                    break;
                }
                default:
                    ABORT(CLOG << LOCATION << " Unhandled segment kind" << std::endl;);
            }
            write_offset += segment->computed_length;
        }
        fclose(file_ptr);
        return 0;
    }
    return -1;
}

int omega_edit_clear_changes(omega_session_t *session_ptr) {
    int64_t length = 0;
    if (session_ptr->file_ptr) {
        if (0 != fseeko(session_ptr->file_ptr, 0L, SEEK_END)) { return -1; }
        length = ftello(session_ptr->file_ptr);
    }
    initialize_model_segments_(session_ptr->model_ptr_->model_segments, length);
    session_ptr->model_ptr_->changes.clear();
    for (const auto &viewport_ptr : session_ptr->viewports_) {
        viewport_ptr->data_segment.capacity = -1 * std::abs(viewport_ptr->data_segment.capacity);// indicate dirty read
        omega_viewport_execute_on_change(viewport_ptr.get(), nullptr);
    }
    return 0;
}

int64_t omega_edit_undo_last_change(omega_session_t *session_ptr) {
    if (!session_ptr->model_ptr_->changes.empty()) {
        const auto change_ptr = session_ptr->model_ptr_->changes.back();
        session_ptr->model_ptr_->changes.pop_back();
        int64_t length = 0;
        if (session_ptr->file_ptr) {
            if (0 != fseeko(session_ptr->file_ptr, 0L, SEEK_END)) { return -1; }
            length = ftello(session_ptr->file_ptr);
        }
        initialize_model_segments_(session_ptr->model_ptr_->model_segments, length);
        for (auto iter = session_ptr->model_ptr_->changes.begin(); iter != session_ptr->model_ptr_->changes.end();
             ++iter) {
            if (0 > update_model_(session_ptr->model_ptr_.get(), *iter)) { return -1; }
        }

        // Negate the undone change's serial number to indicate that the change has been undone
        const auto undone_change_ptr = const_cast<omega_change_t *>(change_ptr.get());
        undone_change_ptr->serial *= -1;

        session_ptr->model_ptr_->changes_undone.push_back(change_ptr);
        update_viewports_(session_ptr, undone_change_ptr);
        if (session_ptr->on_change_cbk) { session_ptr->on_change_cbk(session_ptr, undone_change_ptr); }
        return undone_change_ptr->serial;
    }
    return 0;
}

int64_t omega_edit_redo_last_undo(omega_session_t *session_ptr) {
    int64_t rc = 0;
    if (!session_ptr->model_ptr_->changes_undone.empty()) {
        rc = update_(session_ptr, session_ptr->model_ptr_->changes_undone.back());
        session_ptr->model_ptr_->changes_undone.pop_back();
    }
    return rc;
}
