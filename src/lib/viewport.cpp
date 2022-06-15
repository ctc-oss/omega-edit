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

#include "../include/omega_edit/viewport.h"
#include "../include/omega_edit/segment.h"
#include "../include/omega_edit/session.h"
#include "impl_/internal_fun.hpp"
#include "impl_/session_def.hpp"
#include "impl_/viewport_def.hpp"
#include <cassert>
#include <cstdlib>

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
                             omega_viewport_get_offset(viewport_ptr),
                     static_cast<int64_t>(0));
    return capacity < remaining_file_size ? capacity : remaining_file_size;
}

int64_t omega_viewport_get_offset(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_ptr->data_segment.offset + viewport_ptr->data_segment.offset_adjustment;
}

void *omega_viewport_get_user_data_ptr(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_ptr->user_data_ptr;
}

omega_viewport_event_cbk_t omega_viewport_get_event_cbk(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_ptr->event_handler;
}

int32_t omega_viewport_get_event_interest(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_ptr->event_interest_;
}

int32_t omega_viewport_set_event_interest(omega_viewport_t *viewport_ptr, int32_t event_interest) {
    assert(viewport_ptr);
    viewport_ptr->event_interest_ = event_interest;
    return omega_viewport_get_event_interest(viewport_ptr);
}

int omega_viewport_is_floating(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_ptr->data_segment.is_floating ? 1 : 0;
}

int omega_viewport_update(omega_viewport_t *viewport_ptr, int64_t offset, int64_t capacity, int is_floating) {
    assert(viewport_ptr);
    if (capacity > 0 && capacity <= OMEGA_VIEWPORT_CAPACITY_LIMIT) {
        // only change settings if they are different
        if (viewport_ptr->data_segment.offset != offset || omega_viewport_get_capacity(viewport_ptr) != capacity ||
            viewport_ptr->data_segment.is_floating != (bool) is_floating) {
            omega_data_destroy(&viewport_ptr->data_segment.data, omega_viewport_get_capacity(viewport_ptr));
            viewport_ptr->data_segment.offset = offset;
            viewport_ptr->data_segment.is_floating = is_floating;
            viewport_ptr->data_segment.offset_adjustment = 0;
            viewport_ptr->data_segment.capacity = -1 * capacity;// Negative capacity indicates dirty read
            omega_data_create(&viewport_ptr->data_segment.data, capacity);
            omega_viewport_notify(viewport_ptr, VIEWPORT_EVT_UPDATED, nullptr);
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
    return omega_segment_get_data(&mut_viewport_ptr->data_segment);
}

int omega_viewport_has_changes(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_ptr->data_segment.capacity < 0 ? 1 : 0;
}

int omega_viewport_in_segment(const omega_viewport_t *viewport_ptr, int64_t offset, int64_t length) {
    return (offset + length) >= omega_viewport_get_offset(viewport_ptr) &&
                           offset <= omega_viewport_get_offset(viewport_ptr) + omega_viewport_get_capacity(viewport_ptr)
                   ? 1
                   : 0;
}

void omega_viewport_notify(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                           const omega_change_t *change_ptr) {
    assert(viewport_ptr);
    assert(viewport_ptr->session_ptr);
    if (viewport_ptr->event_handler &&
        (viewport_event & viewport_ptr->event_interest_) &&
        !omega_session_viewport_event_callbacks_paused(viewport_ptr->session_ptr)) {
        (*viewport_ptr->event_handler)(viewport_ptr, viewport_event, change_ptr);
    }
}
