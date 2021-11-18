/*
* Copyright 2021 Concurrent Technologies Corporation
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

#include "internal_fun.h"
#include "../../include/change.h"
#include "../../include/session.h"
#include "../../include/util.h"
#include "../../include/viewport.h"
#include "author_def.h"
#include "change_def.h"
#include "macros.h"
#include "model_segment_def.h"
#include "session_def.h"
#include "viewport_def.h"

static void print_change_(const_change_ptr_t &change_ptr, std::ostream &out_stream) {
    out_stream << R"({"serial": )" << change_ptr->serial << R"(, "kind": ")"
               << get_change_kind_as_char(change_ptr.get()) << R"(", "offset": )" << change_ptr->offset
               << R"(, "length": )" << change_ptr->length;
    const byte_t *bytes_ptr;
    const auto bytes_length = get_change_bytes(change_ptr.get(), &bytes_ptr);
    if (bytes_length) {
        out_stream << R"(, "bytes": ")" << std::string((char const *) bytes_ptr, bytes_length) << R"(")";
    }
    out_stream << "}";
}

static char segment_kind_as_char_(model_segment_kind_t segment_kind) {
    switch (segment_kind) {
        case model_segment_kind_t::SEGMENT_READ:
            return 'R';
        case model_segment_kind_t::SEGMENT_INSERT:
            return 'I';
    }
    return '?';
}

static void print_model_segment_(const model_segment_ptr_t &segment_ptr, std::ostream &out_stream) {
    out_stream << R"({"kind": ")" << segment_kind_as_char_(segment_ptr->segment_kind) << R"(", "computed_offset": )"
               << segment_ptr->computed_offset << R"(, "computed_length": )" << segment_ptr->computed_length
               << R"(, "change_offset": )" << segment_ptr->change_offset << R"(, "change": )";
    print_change_(segment_ptr->change_ptr, out_stream);
    out_stream << "}" << std::endl;
}

void print_model_segments_(const session_t *session_ptr, std::ostream &out_stream) {
    for (const auto &segment : session_ptr->model_.model_segments) { print_model_segment_(segment, out_stream); }
}

int populate_data_segment_(const session_t *session_ptr, data_segment_t *data_segment_ptr) {
    const auto model_ptr = &session_ptr->model_;
    data_segment_ptr->length = 0;
    if (model_ptr->model_segments.empty()) { return 0; }
    auto data_segment_offset = data_segment_ptr->offset;
    int64_t read_offset = 0;

    for (auto iter = model_ptr->model_segments.cbegin(); iter != model_ptr->model_segments.cend(); ++iter) {
        if (read_offset != (*iter)->computed_offset) {
            print_model_segments_(session_ptr, CLOG);
            ABORT(CLOG << LOCATION << " break in model continuity, expected: " << read_offset
                       << ", got: " << (*iter)->computed_offset << std::endl;);
        }
        if (read_offset <= data_segment_offset && data_segment_offset <= read_offset + (*iter)->computed_length) {
            // We're at the first model segment that intersects with the data segment, but the model segment and the
            // data segment offsets  are likely not aligned, so we need to compute how much of the segment to move past
            // (the delta).
            auto delta = data_segment_offset - (*iter)->computed_offset;
            do {
                // This is how much data remains to be filled
                const auto remaining_capacity = data_segment_ptr->capacity - data_segment_ptr->length;
                auto amount = (*iter)->computed_length - delta;
                amount = (amount > remaining_capacity) ? remaining_capacity : amount;
                switch ((*iter)->segment_kind) {
                    case model_segment_kind_t::SEGMENT_READ: {
                        // For read segments, we're reading a segment, or portion thereof, from the input file and
                        // writing it into the data segment
                        if (read_segment_from_file(session_ptr->file_ptr, (*iter)->change_offset + delta,
                                                   const_cast<byte_t *>(get_data_segment_data_(data_segment_ptr)) +
                                                           data_segment_ptr->length,
                                                   amount) != amount) {
                            return -1;
                        }
                        break;
                    }
                    case model_segment_kind_t::SEGMENT_INSERT: {
                        // For insert segments, we're writing the change byte buffer, or portion thereof, into the data
                        // segment
                        const byte_t *change_bytes;
                        get_change_bytes((*iter)->change_ptr.get(), &change_bytes);
                        memcpy(const_cast<byte_t *>(get_data_segment_data_(data_segment_ptr)) +
                                       data_segment_ptr->length,
                               change_bytes + (*iter)->change_offset + delta, amount);
                        break;
                    }
                    default:
                        ABORT(CLOG << LOCATION << " Unhandled model segment kind" << std::endl;);
                }
                // Add the amount written to the viewport length
                data_segment_ptr->length += amount;
                // After the first segment is written, the dela should be zero from that point on
                delta = 0;
                // Keep writing segments until we run out of viewport capacity or run out of segments
            } while (data_segment_ptr->length < data_segment_ptr->capacity &&
                     ++iter != model_ptr->model_segments.end());
            return 0;
        }
        read_offset += (*iter)->computed_length;
    }
    return -1;
}

int populate_viewport_(viewport_t *viewport_ptr) {
    return populate_data_segment_(viewport_ptr->author_ptr->session_ptr, &viewport_ptr->data_segment);
}

void viewport_callback_(viewport_t *viewport_ptr, const change_t *change_ptr) {
    if (viewport_ptr->on_change_cbk) {
        if (viewport_ptr->bit_offset > 0) {
            left_shift_buffer(const_cast<byte_t *>(get_viewport_data(viewport_ptr)), viewport_ptr->data_segment.length,
                              viewport_ptr->bit_offset);
        }
        (*viewport_ptr->on_change_cbk)(viewport_ptr, change_ptr);
    }
}

byte_t *get_data_segment_data_(data_segment_t *data_segment_ptr) {
    return (data_segment_ptr->capacity < 8) ? data_segment_ptr->data.sm_bytes : data_segment_ptr->data.bytes.get();
}

static bool change_affects_viewport_(const viewport_t *viewport_ptr, const change_t *change_ptr) {
    switch (change_ptr->kind) {
        case change_kind_t::CHANGE_DELETE:// deliberate fall-through
        case change_kind_t::CHANGE_INSERT:
            // INSERT and DELETE changes that happen before the viewport end offset affect the viewport
            return (change_ptr->offset <= (viewport_ptr->data_segment.offset + viewport_ptr->data_segment.capacity));
        case change_kind_t::CHANGE_OVERWRITE:
            return ((change_ptr->offset + change_ptr->length) >= viewport_ptr->data_segment.offset) &&
                   (change_ptr->offset <= (viewport_ptr->data_segment.offset + viewport_ptr->data_segment.capacity));
        default:
            ABORT(CLOG << LOCATION << " Unhandled change kind" << std::endl;);
    }
}

int update_viewports_(session_t *session_ptr, const change_t *change_ptr) {
    for (const auto &viewport : session_ptr->viewports) {
        if (change_affects_viewport_(viewport.get(), change_ptr)) {
            if (populate_viewport_(viewport.get()) != 0) { return -1; }
            viewport_callback_(viewport.get(), change_ptr);
        }
    }
    return 0;
}

change_ptr_t del_(const author_t *author_ptr, int64_t offset, int64_t length) {
    auto change_ptr = std::shared_ptr<change_t>(new change_t);
    change_ptr->author_ptr = author_ptr;
    change_ptr->serial = 0;// When modeling an OVERWRITE, we want an "off the books" serial number
    change_ptr->kind = change_kind_t::CHANGE_DELETE;
    change_ptr->offset = offset;
    change_ptr->length = length;
    change_ptr->data.bytes = nullptr;
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
static int update_model_helper_(session_t *session_ptr, const_change_ptr_t &change_ptr) {
    int64_t read_offset = 0;

    if (session_ptr->model_.model_segments.empty() && change_ptr->kind != change_kind_t::CHANGE_DELETE) {
        // The model is empty, and we have a change with content
        const auto insert_segment_ptr = std::shared_ptr<model_segment_t>(new model_segment_t);
        insert_segment_ptr->segment_kind = model_segment_kind_t::SEGMENT_INSERT;
        insert_segment_ptr->computed_offset = change_ptr->offset;
        insert_segment_ptr->computed_length = change_ptr->length;
        insert_segment_ptr->change_offset = 0;
        insert_segment_ptr->change_ptr = change_ptr;
        session_ptr->model_.model_segments.push_back(insert_segment_ptr);
        return 0;
    }
    for (auto iter = session_ptr->model_.model_segments.begin(); iter != session_ptr->model_.model_segments.end();
         ++iter) {
        if (read_offset != (*iter)->computed_offset) {
            print_model_segments_(session_ptr, CLOG);
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
                    iter = session_ptr->model_.model_segments.insert(iter + 1, split_segment_ptr);
                }
            }
            switch (change_ptr->kind) {
                case change_kind_t::CHANGE_DELETE: {
                    auto delete_length = change_ptr->length;
                    while (delete_length && iter != session_ptr->model_.model_segments.end()) {
                        if ((*iter)->computed_length <= delete_length) {
                            // DELETE change spans the entire segment
                            delete_length -= (*iter)->computed_length;
                            iter = session_ptr->model_.model_segments.erase(iter);
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
                    for (; iter != session_ptr->model_.model_segments.end(); ++iter) {
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
                    iter = session_ptr->model_.model_segments.insert(iter, insert_segment_ptr);
                    for (++iter; iter != session_ptr->model_.model_segments.end(); ++iter) {
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

int update_model_(session_t *session_ptr, const_change_ptr_t &change_ptr) {
    int rc;
    if (change_ptr->kind == change_kind_t::CHANGE_OVERWRITE) {
        // Overwrite will model just like a DELETE, followed by an INSERT

        // Prevent deleting past the end of file
        const auto computed_file_size = get_computed_file_size(session_ptr);
        const auto delete_length = (computed_file_size < change_ptr->offset + change_ptr->length)
                                           ? computed_file_size - change_ptr->offset
                                           : change_ptr->length;
        if (0 < delete_length) {
            const_change_ptr_t const_change_ptr = del_(change_ptr->author_ptr, change_ptr->offset, delete_length);
            if ((rc = update_model_helper_(session_ptr, const_change_ptr)) != 0) { return rc; }
        }
    }
    if ((rc = update_model_helper_(session_ptr, change_ptr)) == 0) {
        rc = update_viewports_(session_ptr, change_ptr.get());
    }
    return rc;
}


int update_(const_change_ptr_t &change_ptr) {
    const auto session_ptr = change_ptr->author_ptr->session_ptr;
    const auto computed_file_size = get_computed_file_size(session_ptr);
    if (change_ptr->offset <= computed_file_size) {
        if (change_ptr->serial < 0) {
            // This is a previously undone change that is being redone, so flip the serial number back to positive
            const auto undone_change_ptr = const_cast<change_t *>(change_ptr.get());
            undone_change_ptr->serial *= -1;
        } else if (!session_ptr->changes_undone.empty()) {
            // This is not a redo change, so any changes undone are now invalid and must be cleared
            session_ptr->changes_undone.clear();
        }
        session_ptr->changes.push_back(change_ptr);
        if (update_model_(session_ptr, change_ptr) != 0) { return -1; }
        if (session_ptr->on_change_cbk) { session_ptr->on_change_cbk(session_ptr, change_ptr.get()); }
        return 0;
    }
    return -1;
}
