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

#include "../include/omega_edit/segment.h"
#include "impl_/segment_def.hpp"
#include <cassert>

omega_segment_t *omega_segment_create(int64_t capacity) {
    assert(0 <= capacity);
    auto *segment_ptr = new omega_segment_t();
    segment_ptr->data.bytes_ptr = (7 < capacity) ? new omega_byte_t[capacity + 1] : nullptr;
    segment_ptr->capacity = capacity;
    segment_ptr->length = 0;
    segment_ptr->offset = -1;
    segment_ptr->offset_adjustment = 0;
    omega_segment_get_data(segment_ptr)[capacity] = '\0';// null terminate, this does not exceed the upper limit
    return segment_ptr;
}

int64_t omega_segment_get_capacity(const omega_segment_t *segment_ptr) {
    assert(segment_ptr);
    return segment_ptr->capacity;
}

int64_t omega_segment_get_length(const omega_segment_t *segment_ptr) {
    assert(segment_ptr);
    return segment_ptr->length;
}

int64_t omega_segment_get_offset(const omega_segment_t *segment_ptr) {
    assert(segment_ptr);
    return segment_ptr->offset;
}

int64_t omega_segment_get_offset_adjustment(const omega_segment_t *segment_ptr) {
    assert(segment_ptr);
    return segment_ptr->offset_adjustment;
}

omega_byte_t *omega_segment_get_data(omega_segment_t *segment_ptr) {
    assert(segment_ptr);
    return (0 <= segment_ptr->length) ? omega_data_get_data(&segment_ptr->data, std::abs(segment_ptr->capacity))
                                      : nullptr;
}

void omega_segment_destroy(omega_segment_t *segment_ptr) {
    if (segment_ptr) {
        if (7 < omega_segment_get_capacity(segment_ptr)) { delete[] segment_ptr->data.bytes_ptr; }
        delete segment_ptr;
    }
}
