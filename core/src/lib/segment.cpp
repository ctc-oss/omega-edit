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
#include <new>

using omega_edit::internal::omega_data_create_;
using omega_edit::internal::omega_data_destroy_;
using omega_edit::internal::omega_data_get_data_;

omega_segment_t *omega_segment_create(int64_t capacity) {
    if (capacity < 0) { return nullptr; }
    omega_segment_t *segment_ptr = nullptr;
    try {
        segment_ptr = new omega_segment_t();
        omega_data_create_(&segment_ptr->data, capacity);
        segment_ptr->capacity = capacity;
        segment_ptr->length = 0;
        segment_ptr->offset = -1;
        segment_ptr->offset_adjustment = 0;
        return segment_ptr;
    } catch (const std::bad_alloc &) {
        delete segment_ptr;
        return nullptr;
    }
}

int64_t omega_segment_get_capacity(const omega_segment_t *segment_ptr) {
    if (!segment_ptr) { return 0; }
    return segment_ptr->capacity;
}

int64_t omega_segment_get_length(const omega_segment_t *segment_ptr) {
    if (!segment_ptr) { return 0; }
    return segment_ptr->length;
}

int64_t omega_segment_get_offset(const omega_segment_t *segment_ptr) {
    if (!segment_ptr) { return -1; }
    return segment_ptr->offset;
}

int64_t omega_segment_get_offset_adjustment(const omega_segment_t *segment_ptr) {
    if (!segment_ptr) { return 0; }
    return segment_ptr->offset_adjustment;
}

omega_byte_t *omega_segment_get_data(omega_segment_t *segment_ptr) {
    if (!segment_ptr) { return nullptr; }
    return 0 <= segment_ptr->length ? omega_data_get_data_(&segment_ptr->data, std::abs(segment_ptr->capacity))
                                    : nullptr;
}

void omega_segment_destroy(omega_segment_t *segment_ptr) {
    if (segment_ptr) {
        omega_data_destroy_(&segment_ptr->data, omega_segment_get_capacity(segment_ptr));
        delete segment_ptr;
    }
}
