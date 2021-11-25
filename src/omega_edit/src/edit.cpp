/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License");                                                    *
 * you may not use this file except in compliance with the License.                                                   *
 * You may obtain a copy of the License at                                                                            *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software                                                *
 * distributed under the License is distributed on an "AS IS" BASIS,                                                  *
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                                           *
 * See the License for the specific language governing permissions and                                                *
 * limitations under the License.                                                                                     *
 **********************************************************************************************************************/

#include "../include/edit.h"
#include "../include/change.h"
#include "../include/session.h"
#include "../include/util.h"
#include "impl_/change_def.h"
#include "impl_/internal_fun.h"
#include "impl_/macros.h"
#include "impl_/model_segment_def.h"
#include "impl_/session_def.h"
#include <cstring>

static const_omega_change_ptr_t del_(int64_t serial, int64_t offset, int64_t length) {
    auto change_ptr = std::shared_ptr<omega_change_t>(new omega_change_t);
    change_ptr->serial = serial;
    change_ptr->kind = change_kind_t::CHANGE_DELETE;
    change_ptr->offset = offset;
    change_ptr->length = length;
    change_ptr->data.bytes = nullptr;
    return change_ptr;
}

static const_omega_change_ptr_t ins_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length) {
    auto change_ptr = std::shared_ptr<omega_change_t>(new omega_change_t);
    change_ptr->serial = serial;
    change_ptr->kind = change_kind_t::CHANGE_INSERT;
    change_ptr->offset = offset;
    change_ptr->length = (length) ? length : static_cast<int64_t>(strlen((const char *) bytes));
    if (change_ptr->length < 8) {
        // small bytes optimization
        memcpy(change_ptr->data.sm_bytes, bytes, change_ptr->length);
        change_ptr->data.sm_bytes[change_ptr->length] = '\0';
    } else {
        change_ptr->data.bytes = std::make_unique<omega_byte_t[]>(change_ptr->length + 1);
        memcpy(change_ptr->data.bytes.get(), bytes, change_ptr->length);
        change_ptr->data.bytes.get()[change_ptr->length] = '\0';
    }
    return change_ptr;
}

static const_omega_change_ptr_t ovr_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length) {
    auto change_ptr = std::shared_ptr<omega_change_t>(new omega_change_t);
    change_ptr->serial = serial;
    change_ptr->kind = change_kind_t::CHANGE_OVERWRITE;
    change_ptr->offset = offset;
    change_ptr->length = (length) ? length : static_cast<int64_t>(strlen((const char *) bytes));
    if (change_ptr->length < 8) {
        // small bytes optimization
        memcpy(change_ptr->data.sm_bytes, bytes, change_ptr->length);
        change_ptr->data.sm_bytes[change_ptr->length] = '\0';
    } else {
        change_ptr->data.bytes = std::make_unique<omega_byte_t[]>(change_ptr->length + 1);
        memcpy(change_ptr->data.bytes.get(), bytes, change_ptr->length);
        change_ptr->data.bytes.get()[change_ptr->length] = '\0';
    }
    return change_ptr;
}

static model_segment_ptr_t clone_model_segment_(const model_segment_ptr_t &segment_ptr) {
    auto result = std::shared_ptr<model_segment_t>(new model_segment_t);
    result->segment_kind = segment_ptr->segment_kind;
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
        const auto insert_segment_ptr = std::shared_ptr<model_segment_t>(new model_segment_t);
        insert_segment_ptr->segment_kind = model_segment_kind_t::SEGMENT_INSERT;
        insert_segment_ptr->computed_offset = change_ptr->offset;
        insert_segment_ptr->computed_length = change_ptr->length;
        insert_segment_ptr->change_offset = 0;
        insert_segment_ptr->change_ptr = change_ptr;
        model_ptr->model_segments.push_back(insert_segment_ptr);
        return 0;
    }
    for (auto iter = model_ptr->model_segments.begin(); iter != model_ptr->model_segments.end(); ++iter) {
        if (read_offset != (*iter)->computed_offset) {
            print_model_segments_(model_ptr, CLOG);
            ABORT(CLOG << LOCATION << " break in model continuity, expected: " << read_offset
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
                    const auto split_segment_ptr = clone_model_segment_(*iter);
                    split_segment_ptr->computed_offset += delta;
                    split_segment_ptr->computed_length -= delta;
                    split_segment_ptr->change_offset += delta;
                    (*iter)->computed_length = delta;
                    // iter will now point to the new split segment inserted into the model and who's offset falls on
                    // the update site
                    iter = model_ptr->model_segments.insert(iter + 1, split_segment_ptr);
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
                    const auto insert_segment_ptr = std::shared_ptr<model_segment_t>(new model_segment_t);
                    insert_segment_ptr->segment_kind = model_segment_kind_t::SEGMENT_INSERT;
                    insert_segment_ptr->computed_offset = change_ptr->offset;
                    insert_segment_ptr->computed_length = change_ptr->length;
                    insert_segment_ptr->change_offset = 0;
                    insert_segment_ptr->change_ptr = change_ptr;
                    iter = model_ptr->model_segments.insert(iter, insert_segment_ptr);
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
    const auto computed_file_size = omega_edit_get_computed_file_size(session_ptr);
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
        if (session_ptr->on_change_cbk) { session_ptr->on_change_cbk(session_ptr, change_ptr.get()); }
        return change_ptr->serial;
    }
    return -1;
}

int64_t omega_edit_delete(omega_session_t *session_ptr, int64_t offset, int64_t length) {
    return (offset < omega_edit_get_computed_file_size(session_ptr))
                   ? update_(session_ptr, del_(++session_ptr->serial, offset, length))
                   : -1;
}

int64_t omega_edit_insert(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes, int64_t length) {
    return (offset <= omega_edit_get_computed_file_size(session_ptr))
                   ? update_(session_ptr, ins_(++session_ptr->serial, offset, bytes, length))
                   : -1;
}

int64_t omega_edit_overwrite(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes, int64_t length) {
    return (offset < omega_edit_get_computed_file_size(session_ptr))
                   ? update_(session_ptr, ovr_(++session_ptr->serial, offset, bytes, length))
                   : -1;
}

int64_t omega_edit_get_computed_file_size(const omega_session_t *session_ptr) {
    return (session_ptr->model_ptr_->model_segments.empty())
                   ? 0
                   : session_ptr->model_ptr_->model_segments.back()->computed_offset +
                             session_ptr->model_ptr_->model_segments.back()->computed_length;
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
            switch (segment->segment_kind) {
                case model_segment_kind_t::SEGMENT_READ: {
                    if (omega_util_write_segment_to_file(session_ptr->file_ptr, segment->change_offset,
                                                         segment->computed_length,
                                                         file_ptr) != segment->computed_length) {
                        return -1;
                    }
                    break;
                }
                case model_segment_kind_t::SEGMENT_INSERT: {
                    const omega_byte_t *change_bytes;
                    omega_change_get_bytes(segment->change_ptr.get(), &change_bytes);
                    if (fwrite(change_bytes + segment->change_offset, 1, segment->computed_length, file_ptr) !=
                        segment->computed_length) {
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

int omega_edit_visit_changes(const omega_session_t *session_ptr, omega_edit_change_visitor_cbk_t cbk, void *user_data) {
    int rc = 0;
    for (const auto &iter : session_ptr->model_ptr_->changes) {
        if ((rc = cbk(iter.get(), user_data)) != 0) { break; }
    }
    return rc;
}

/*
 * The idea here is to search using tiled windows.  The window should be at least twice the size of the needle, and then
 * it skips to 1 + window_capacity - needle_length, as far as we can skip, with just enough backward coverage to catch
 * needles that were on the window boundary.
 */
int omega_edit_search(const omega_session_t *session_ptr, const omega_byte_t *needle, int64_t needle_length,
                      omega_edit_match_found_cbk_t cbk, void *user_data, int64_t session_offset,
                      int64_t session_length) {
    int rc = -1;
    if (needle_length < NEEDLE_LENGTH_LIMIT) {
        rc = 0;
        session_length = (session_length) ? session_length : session_ptr->length;
        if (needle_length <= session_length) {
            data_segment_t data_segment;
            data_segment.offset = session_offset;
            data_segment.capacity = NEEDLE_LENGTH_LIMIT << 1;
            data_segment.data.bytes =
                    (data_segment.capacity < 8) ? nullptr : std::make_unique<omega_byte_t[]>(data_segment.capacity);
            const auto skip_size = 1 + data_segment.capacity - needle_length;
            int64_t skip = 0;
            do {
                data_segment.offset += skip;
                populate_data_segment_(session_ptr, &data_segment);
                auto haystack = get_data_segment_data_(&data_segment);
                auto haystack_length = data_segment.length;
                void *found;
                int64_t delta = 0;
                while ((found = memmem(haystack + delta, haystack_length - delta, needle, needle_length))) {
                    delta = static_cast<omega_byte_t *>(found) - static_cast<omega_byte_t *>(haystack);
                    if ((rc = cbk(data_segment.offset + delta, needle_length, user_data)) != 0) { return rc; }
                    ++delta;
                }
                skip = skip_size;
            } while (data_segment.length == data_segment.capacity);
        }
    }
    return rc;
}

size_t omega_edit_get_num_changes(const omega_session_t *session_ptr) {
    return session_ptr->model_ptr_->changes.size();
}

size_t omega_edit_get_num_undone_changes(const omega_session_t *session_ptr) {
    return session_ptr->model_ptr_->changes_undone.size();
}

const omega_change_t *omega_edit_get_last_change(const omega_session_t *session_ptr) {
    return (session_ptr->model_ptr_->changes.empty()) ? nullptr : session_ptr->model_ptr_->changes.back().get();
}

const omega_change_t *omega_edit_get_last_undo(const omega_session_t *session_ptr) {
    return (session_ptr->model_ptr_->changes_undone.empty()) ? nullptr
                                                             : session_ptr->model_ptr_->changes_undone.back().get();
}

int64_t omega_edit_undo_last_change(omega_session_t *session_ptr) {
    if (!session_ptr->model_ptr_->changes.empty()) {
        const auto change_ptr = session_ptr->model_ptr_->changes.back();

        session_ptr->model_ptr_->changes.pop_back();
        initialize_model_segments_(session_ptr->model_ptr_->model_segments, session_ptr->offset, session_ptr->length);
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
        return undone_change_ptr->serial * -1;
    }
    return -1;
}

int64_t omega_edit_redo_last_undo(omega_session_t *session_ptr) {
    int64_t rc = -1;
    if (!session_ptr->model_ptr_->changes_undone.empty()) {
        rc = update_(session_ptr, session_ptr->model_ptr_->changes_undone.back());
        session_ptr->model_ptr_->changes_undone.pop_back();
    }
    return rc;
}

int omega_edit_check_model(const omega_session_t *session_ptr) {
    int64_t expected_offset = 0;
    for (const auto &segment : session_ptr->model_ptr_->model_segments) {
        if (expected_offset != segment->computed_offset ||
            (segment->change_offset + segment->computed_length) > segment->change_ptr->length) {
            print_model_segments_(session_ptr->model_ptr_.get(), CLOG);
            return -1;
        }
        expected_offset += segment->computed_length;
    }
    return 0;
}
