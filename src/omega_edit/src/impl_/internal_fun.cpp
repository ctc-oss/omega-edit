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

#include "internal_fun.h"
#include "../../include/change.h"
#include "../../include/session.h"
#include "../../include/util.h"
#include "../../include/viewport.h"
#include "change_def.h"
#include "macros.h"
#include "model_segment_def.h"
#include "session_def.h"
#include "viewport_def.h"
#include <cassert>

/**********************************************************************************************************************
 * Internal functions
 **********************************************************************************************************************/

static inline char segment_kind_as_char_(model_segment_kind_t segment_kind) {
    switch (segment_kind) {
        case model_segment_kind_t::SEGMENT_READ:
            return 'R';
        case model_segment_kind_t::SEGMENT_INSERT:
            return 'I';
    }
    return '?';
}

static inline bool change_affects_viewport_(const omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr) {
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

static void print_change_(const omega_change_t *change_ptr, std::ostream &out_stream) {
    out_stream << R"({"serial": )" << change_ptr->serial << R"(, "kind": ")"
               << omega_change_get_kind_as_char(change_ptr) << R"(", "offset": )" << change_ptr->offset
               << R"(, "length": )" << change_ptr->length;
    const auto bytes = omega_change_get_bytes(change_ptr);
    if (bytes) { out_stream << R"(, "bytes": ")" << std::string((char const *) bytes, change_ptr->length) << R"(")"; }
    out_stream << "}";
}

static void print_model_segment_(const model_segment_ptr_t &segment_ptr, std::ostream &out_stream) {
    out_stream << R"({"kind": ")" << segment_kind_as_char_(segment_ptr->segment_kind) << R"(", "computed_offset": )"
               << segment_ptr->computed_offset << R"(, "computed_length": )" << segment_ptr->computed_length
               << R"(, "change_offset": )" << segment_ptr->change_offset << R"(, "change": )";
    print_change_(segment_ptr->change_ptr.get(), out_stream);
    out_stream << "}" << std::endl;
}

/**********************************************************************************************************************
 * Data segment functions
 **********************************************************************************************************************/

omega_byte_t *get_data_segment_data_(data_segment_t *data_segment_ptr) {
    return (data_segment_ptr->capacity < 8) ? data_segment_ptr->data.sm_bytes : data_segment_ptr->data.bytes_ptr.get();
}

int populate_data_segment_(const omega_session_t *session_ptr, data_segment_t *data_segment_ptr) {
    const auto model_ptr = session_ptr->model_ptr_;
    data_segment_ptr->length = 0;
    if (model_ptr->model_segments.empty()) { return 0; }
    auto data_segment_offset = data_segment_ptr->offset;
    int64_t read_offset = 0;

    for (auto iter = model_ptr->model_segments.cbegin(); iter != model_ptr->model_segments.cend(); ++iter) {
        if (read_offset != (*iter)->computed_offset) {
            print_model_segments_(session_ptr->model_ptr_.get(), CLOG);
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
                        if (omega_util_read_segment_from_file(
                                    session_ptr->file_ptr, (*iter)->change_offset + delta,
                                    const_cast<omega_byte_t *>(get_data_segment_data_(data_segment_ptr)) +
                                            data_segment_ptr->length,
                                    amount) != amount) {
                            return -1;
                        }
                        break;
                    }
                    case model_segment_kind_t::SEGMENT_INSERT: {
                        // For insert segments, we're writing the change byte buffer, or portion thereof, into the data
                        // segment
                        memcpy(const_cast<omega_byte_t *>(get_data_segment_data_(data_segment_ptr)) +
                                       data_segment_ptr->length,
                               omega_change_get_bytes((*iter)->change_ptr.get()) + (*iter)->change_offset + delta,
                               amount);
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

/**********************************************************************************************************************
 * Model segment functions
 **********************************************************************************************************************/

void print_model_segments_(const omega_model_t *model_ptr, std::ostream &out_stream) {
    for (const auto &segment : model_ptr->model_segments) { print_model_segment_(segment, out_stream); }
}

void initialize_model_segments_(model_segments_t &model_segments, int64_t offset, int64_t length) {
    model_segments.clear();
    if (0 < length) {
        // Model begins with a single READ segment spanning the original file
        auto change_ptr = std::shared_ptr<omega_change_t>(new omega_change_t);
        change_ptr->serial = 0;
        change_ptr->kind = change_kind_t::CHANGE_INSERT;
        change_ptr->offset = offset;
        change_ptr->length = length;
        auto read_segment_ptr = std::shared_ptr<model_segment_t>(new model_segment_t);
        read_segment_ptr->segment_kind = model_segment_kind_t::SEGMENT_READ;
        read_segment_ptr->change_ptr = change_ptr;
        read_segment_ptr->computed_offset = 0;
        read_segment_ptr->change_offset = read_segment_ptr->change_ptr->offset;
        read_segment_ptr->computed_length = read_segment_ptr->change_ptr->length;
        model_segments.push_back(read_segment_ptr);
    }
}

/**********************************************************************************************************************
 * Viewport functions
 **********************************************************************************************************************/

int populate_viewport_(omega_viewport_t *viewport_ptr) {
    return populate_data_segment_(viewport_ptr->session_ptr, &viewport_ptr->data_segment);
}

void viewport_callback_(omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr) {
    if (viewport_ptr->on_change_cbk) {
        if (viewport_ptr->bit_offset > 0) {
            omega_util_left_shift_buffer(const_cast<omega_byte_t *>(omega_viewport_get_data(viewport_ptr)),
                                         viewport_ptr->data_segment.length, viewport_ptr->bit_offset);
        }
        (*viewport_ptr->on_change_cbk)(viewport_ptr, change_ptr);
    }
}

int update_viewports_(omega_session_t *session_ptr, const omega_change_t *change_ptr) {
    for (const auto &viewport : session_ptr->viewports_) {
        if (change_affects_viewport_(viewport.get(), change_ptr)) {
            if (populate_viewport_(viewport.get()) != 0) { return -1; }
            viewport_callback_(viewport.get(), change_ptr);
        }
    }
    return 0;
}
