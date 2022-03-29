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
#include "../include/omega_edit/edit.h"
#include "../include/omega_edit/session.h"
#include "../include/omega_edit/utility.h"
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

int64_t omega_viewport_get_capacity_unlocked(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_get_capacity_(viewport_ptr);
}

int64_t omega_viewport_get_capacity(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    std::shared_lock sl(const_cast<omega_viewport_t *>(viewport_ptr)->viewport_mutex_);
    return omega_viewport_get_capacity_unlocked(viewport_ptr);
}

int64_t omega_viewport_get_length_unlocked(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_get_length_(viewport_ptr);
}

int64_t omega_viewport_get_length(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    std::shared_lock sl(const_cast<omega_viewport_t *>(viewport_ptr)->viewport_mutex_);
    return omega_viewport_get_length_unlocked(viewport_ptr);
}

int64_t omega_viewport_get_offset_unlocked(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_get_offset_(viewport_ptr);
}

int64_t omega_viewport_get_offset(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    std::shared_lock sl(const_cast<omega_viewport_t *>(viewport_ptr)->viewport_mutex_);
    return omega_viewport_get_offset_unlocked(viewport_ptr);
}

void *omega_viewport_get_user_data_ptr_unlocked(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_ptr->user_data_ptr;
}

void *omega_viewport_get_user_data_ptr(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    std::shared_lock sl(const_cast<omega_viewport_t *>(viewport_ptr)->viewport_mutex_);
    return omega_viewport_get_user_data_ptr_unlocked(viewport_ptr);
}

int omega_viewport_is_floating_unlocked(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_is_floating_(viewport_ptr);
}

int omega_viewport_is_floating(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    std::shared_lock sl(const_cast<omega_viewport_t *>(viewport_ptr)->viewport_mutex_);
    return omega_viewport_is_floating_unlocked(viewport_ptr);
}

int omega_viewport_update(omega_viewport_t *viewport_ptr, int64_t offset, int64_t capacity, int is_floating) {
    assert(viewport_ptr);
    if (capacity > 0 && capacity <= OMEGA_VIEWPORT_CAPACITY_LIMIT) {
        // only change settings if they are different
        if (auto const old_capacity = omega_viewport_get_capacity(viewport_ptr);
            viewport_ptr->data_segment.offset != offset || old_capacity != capacity ||
            viewport_ptr->is_floating != (bool) is_floating) {
            std::unique_lock ul(viewport_ptr->viewport_mutex_);
            if (7 < old_capacity) { delete[] viewport_ptr->data_segment.data.bytes_ptr; }
            viewport_ptr->data_segment.offset = offset;
            viewport_ptr->is_floating = (bool) is_floating;
            viewport_ptr->data_segment.offset_adjustment = 0;
            viewport_ptr->data_segment.capacity = -1 * capacity;// Negative capacity indicates dirty read
            viewport_ptr->data_segment.data.bytes_ptr = (7 < capacity) ? new omega_byte_t[capacity + 1] : nullptr;
            viewport_notify_(viewport_ptr, VIEWPORT_EVT_UPDATED, nullptr);
        }
        return 0;
    }
    return -1;
}

const omega_byte_t *omega_viewport_get_data_unlocked(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    assert(viewport_ptr->session_ptr);
    auto mut_viewport_ptr = const_cast<omega_viewport_t *>(viewport_ptr);
    if (viewport_has_changes_(viewport_ptr)) {
        // Clean the dirty read with a fresh data segment population
        mut_viewport_ptr->data_segment.capacity = std::abs(viewport_ptr->data_segment.capacity);
        if (populate_data_segment_(viewport_ptr->session_ptr, &mut_viewport_ptr->data_segment) != 0) { return nullptr; }
        assert(viewport_get_length_(viewport_ptr) == viewport_ptr->data_segment.length);
    }
    return omega_data_segment_get_data(&mut_viewport_ptr->data_segment);
}

const omega_byte_t *omega_viewport_get_data(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    assert(viewport_ptr->session_ptr);
    std::shared_lock sl(const_cast<omega_viewport_t *>(viewport_ptr)->viewport_mutex_);
    std::shared_lock sls(const_cast<omega_viewport_t *>(viewport_ptr)->session_ptr->session_mutex_);
    return omega_viewport_get_data_unlocked(viewport_ptr);
}

int omega_viewport_has_changes_unlocked(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    return viewport_has_changes_(viewport_ptr);
}

int omega_viewport_has_changes(const omega_viewport_t *viewport_ptr) {
    assert(viewport_ptr);
    std::shared_lock sl(const_cast<omega_viewport_t *>(viewport_ptr)->viewport_mutex_);
    return omega_viewport_has_changes_unlocked(viewport_ptr);
}

void omega_viewport_notify_unlocked(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                           const omega_change_t *change_ptr) {
    assert(viewport_ptr);
    assert(viewport_ptr->session_ptr);
    viewport_notify_(viewport_ptr, viewport_event, change_ptr);
}

void omega_viewport_notify(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                           const omega_change_t *change_ptr) {
    assert(viewport_ptr);
    assert(viewport_ptr->session_ptr);
    std::shared_lock sl(const_cast<omega_viewport_t *>(viewport_ptr)->viewport_mutex_);
    std::shared_lock sls(const_cast<omega_viewport_t *>(viewport_ptr)->session_ptr->session_mutex_);
    omega_viewport_notify_unlocked(viewport_ptr, viewport_event, change_ptr);
}
