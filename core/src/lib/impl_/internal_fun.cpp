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

#include "internal_fun.hpp"
#include "../../include/omega_edit/change.h"
#include "../../include/omega_edit/segment.h"
#include "change_def.hpp"
#include "macros.h"
#include "model_def.hpp"
#include "model_segment_def.hpp"
#include "session_def.hpp"
#include "viewport_def.hpp"
#include <cassert>

/**********************************************************************************************************************
 * Data segment functions
 **********************************************************************************************************************/

static inline int64_t read_segment_from_file_(FILE *from_file_ptr, int64_t offset, omega_byte_t *buffer,
                                              int64_t capacity) noexcept {
    assert(from_file_ptr);
    assert(buffer);
    int64_t rc = -1;
    if (0 == FSEEK(from_file_ptr, 0, SEEK_END)) {
        const auto len = FTELL(from_file_ptr) - offset;
        // make sure the offset does not exceed the file size
        if (len > 0) {
            // the length is going to be equal to what's left of the file, or the buffer capacity, whichever is less
            const auto count = (len < capacity) ? len : capacity;
            if (0 == FSEEK(from_file_ptr, offset, SEEK_SET) &&
                count == static_cast<int64_t>(fread(buffer, sizeof(omega_byte_t), count, from_file_ptr))) {
                rc = count;
            }
        }
    }
    return rc;
}

int populate_data_segment_(const omega_session_t *session_ptr, omega_segment_t *data_segment_ptr) noexcept {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    assert(data_segment_ptr);
    const auto &model_ptr = session_ptr->models_.back();
    data_segment_ptr->length = 0;
    if (model_ptr->model_segments.empty()) { return 0; }
    assert(0 <= data_segment_ptr->capacity);
    const auto data_segment_capacity = data_segment_ptr->capacity;
    const auto data_segment_offset = data_segment_ptr->offset + data_segment_ptr->offset_adjustment;
    int64_t read_offset = 0;

    for (auto iter = model_ptr->model_segments.cbegin(); iter != model_ptr->model_segments.cend(); ++iter) {
        if (read_offset != (*iter)->computed_offset) {
            ABORT(print_model_segments_(session_ptr->models_.back().get(), CLOG);
                          LOG_ERROR("break in model continuity, expected: " << read_offset
                                                                            << ", got: " << (*iter)->computed_offset););
        }
        if (read_offset <= data_segment_offset && data_segment_offset <= read_offset + (*iter)->computed_length) {
            // We're at the first model segment that intersects with the data segment, but the model segment and the
            // data segment offsets are likely not aligned, so we need to compute how much of the segment to move past
            // (the delta).
            auto delta = data_segment_offset - (*iter)->computed_offset;
            const auto data_segment_buffer = omega_segment_get_data(data_segment_ptr);
            do {
                // This is how much data remains to be filled
                const auto remaining_capacity = data_segment_capacity - data_segment_ptr->length;
                auto amount = (*iter)->computed_length - delta;
                amount = (amount > remaining_capacity) ? remaining_capacity : amount;
                switch (omega_model_segment_get_kind(iter->get())) {
                    case model_segment_kind_t::SEGMENT_READ:
                        // For read segments, we're reading a segment, or portion thereof, from the input file and
                        // writing it into the data segment
                        if (read_segment_from_file_(session_ptr->models_.back()->file_ptr,
                                                    (*iter)->change_offset + delta,
                                                    data_segment_buffer + data_segment_ptr->length, amount) != amount) {
                            return -1;
                        }
                        break;
                    case model_segment_kind_t::SEGMENT_INSERT:
                        // For insert segments, we're writing the change byte buffer, or portion thereof, into the data
                        // segment
                        memcpy(data_segment_buffer + data_segment_ptr->length,
                               omega_change_get_bytes((*iter)->change_ptr.get()) + (*iter)->change_offset + delta,
                               amount);
                        break;
                    default:
                        ABORT(LOG_ERROR("Unhandled model segment kind"););
                }
                // Add the amount written to the data segment length
                data_segment_ptr->length += amount;
                // After the first segment is written, the dela should be zero from that point on
                delta = 0;
                // Keep writing segments until we run out of viewport capacity or run out of segments
            } while (data_segment_ptr->length < data_segment_capacity && ++iter != model_ptr->model_segments.end());
            assert(data_segment_ptr->length <= data_segment_capacity);
            // data segment buffer allocation is its capacity plus one, so we can null-terminate it
            data_segment_buffer[data_segment_ptr->length] = '\0';
            return 0;
        }
        read_offset += (*iter)->computed_length;
    }
    return -1;
}

/**********************************************************************************************************************
 * Model segment functions
 **********************************************************************************************************************/

static inline void print_change_(const omega_change_t *change_ptr, std::ostream &out_stream) noexcept {
    assert(change_ptr);
    out_stream << R"({"serial": )" << omega_change_get_serial(change_ptr) << R"(, "kind": ")"
               << omega_change_get_kind_as_char(change_ptr) << R"(", "offset": )" << omega_change_get_offset(change_ptr)
               << R"(, "length": )" << omega_change_get_length(change_ptr);
    if (const auto bytes = omega_change_get_bytes(change_ptr); bytes) {
        out_stream << R"(, "bytes": ")" << std::string((char const *) bytes, omega_change_get_length(change_ptr))
                   << R"(")";
    }
    out_stream << "}";
}

static inline void print_model_segment_(const omega_model_segment_ptr_t &segment_ptr,
                                        std::ostream &out_stream) noexcept {
    out_stream << R"({"kind": ")" << omega_model_segment_kind_as_char(omega_model_segment_get_kind(segment_ptr.get()))
               << R"(", "computed_offset": )" << segment_ptr->computed_offset << R"(, "computed_length": )"
               << segment_ptr->computed_length << R"(, "change_offset": )" << segment_ptr->change_offset
               << R"(, "change": )";
    print_change_(segment_ptr->change_ptr.get(), out_stream);
    out_stream << "}" << std::endl;
}

void print_model_segments_(const omega_model_t *model_ptr, std::ostream &out_stream) noexcept {
    assert(model_ptr);
    for (const auto &segment: model_ptr->model_segments) { print_model_segment_(segment, out_stream); }
}
