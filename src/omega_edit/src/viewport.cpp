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

#include "../include/viewport.h"
#include "../include/edit.h"
#include "../include/session.h"
#include "../include/utility.h"
#include "impl_/internal_fun.hpp"
#include "impl_/session_def.hpp"
#include "impl_/viewport_def.hpp"
#include <cassert>
#include <cstdlib>
#include <memory>

const omega_session_t *omega_viewport_get_session(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_ptr->session_ptr;
}

int64_t omega_viewport_get_capacity(const omega_viewport_t *viewport_ptr) {
    // Negative capacities are only used internally for tracking dirty reads.  The capacity is always positive to the
    // public.
    assert(viewport_ptr);
    return std::abs(viewport_ptr->data_segment.capacity);
}

int64_t omega_viewport_get_length(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    if (!omega_viewport_has_changes(viewport_ptr)) { return viewport_ptr->data_segment.length; }
    auto const capacity = omega_viewport_get_capacity(viewport_ptr);
    auto const remaining_file_size =
            std::max(omega_session_get_computed_file_size(omega_viewport_get_session(viewport_ptr)) -
                             viewport_ptr->data_segment.offset,
                     static_cast<int64_t>(0));
    return (capacity < remaining_file_size) ? capacity : remaining_file_size;
}

int64_t omega_viewport_get_offset(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_ptr->data_segment.offset;
}

void *omega_viewport_get_user_data(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_ptr->user_data_ptr;
}

int omega_viewport_update(omega_viewport_t *viewport_ptr, int64_t offset, int64_t capacity) {
    assert(viewport_ptr);
    if (capacity > 0 && capacity <= OMEGA_VIEWPORT_CAPACITY_LIMIT) {
        // only change settings if they are different
        if (viewport_ptr->data_segment.offset != offset || omega_viewport_get_capacity(viewport_ptr) != capacity) {
            if (7 < omega_viewport_get_capacity(viewport_ptr)) { delete[] viewport_ptr->data_segment.data.bytes_ptr; }
            viewport_ptr->data_segment.offset = offset;
            viewport_ptr->data_segment.capacity = -1 * capacity;// Negative capacity indicates dirty read
            viewport_ptr->data_segment.data.bytes_ptr = (7 < capacity) ? new omega_byte_t[capacity + 1] : nullptr;
            omega_viewport_execute_on_change(viewport_ptr, nullptr);
        }
        return 0;
    }
    return -1;
}

const omega_byte_t *omega_viewport_get_data(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    auto mut_viewport_ptr = const_cast<omega_viewport_t *>(viewport_ptr);
    if (omega_viewport_has_changes(viewport_ptr)) {
        // Clean the dirty read with a fresh data segment population
        mut_viewport_ptr->data_segment.capacity = std::abs(viewport_ptr->data_segment.capacity);
        if (populate_data_segment_(viewport_ptr->session_ptr, &mut_viewport_ptr->data_segment) != 0) { return nullptr; }
        assert(omega_viewport_get_length(viewport_ptr) == viewport_ptr->data_segment.length);
    }
    return omega_data_segment_get_data(&mut_viewport_ptr->data_segment);
}

int omega_viewport_has_changes(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return (viewport_ptr->data_segment.capacity < 0) ? 1 : 0;
}

void omega_viewport_execute_on_change(omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr) {
    assert(viewport_ptr);
    assert(viewport_ptr->session_ptr);
    if (!omega_session_viewport_on_change_callbacks_paused(viewport_ptr->session_ptr) && viewport_ptr->on_change_cbk) {
        (*viewport_ptr->on_change_cbk)(viewport_ptr, change_ptr);
    }
}
