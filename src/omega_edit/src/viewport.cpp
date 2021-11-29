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

#include "../include/viewport.h"

#include "../include/session.h"
#include "impl_/data_segment_def.h"
#include "impl_/internal_fun.h"
#include "impl_/session_def.h"
#include "impl_/viewport_def.h"
#include <memory>

const omega_session_t *omega_viewport_get_session(const omega_viewport_t *viewport_ptr) {
    return viewport_ptr->session_ptr;
}

int64_t omega_viewport_get_capacity(const omega_viewport_t *viewport_ptr) {
    return viewport_ptr->data_segment.capacity;
}

int64_t omega_viewport_get_length(const omega_viewport_t *viewport_ptr) { return viewport_ptr->data_segment.length; }

int64_t omega_viewport_get_computed_offset(const omega_viewport_t *viewport_ptr) {
    return viewport_ptr->data_segment.offset;
}

void *omega_viewport_get_user_data(const omega_viewport_t *viewport_ptr) { return viewport_ptr->user_data_ptr; }

omega_byte_t omega_viewport_get_bit_offset(const omega_viewport_t *viewport_ptr) { return viewport_ptr->bit_offset; }

omega_viewport_t *omega_viewport_create(omega_session_t *session_ptr, int64_t offset, int64_t capacity,
                                        omega_viewport_on_change_cbk_t cbk, void *user_data_ptr,
                                        omega_byte_t bit_offset) {
    if (capacity > 0 and capacity <= omega_session_get_viewport_max_capacity(session_ptr)) {
        const auto viewport_ptr = std::make_shared<omega_viewport_t>();
        viewport_ptr->session_ptr = session_ptr;
        viewport_ptr->data_segment.offset = offset;
        viewport_ptr->data_segment.capacity = capacity;
        viewport_ptr->data_segment.length = 0;
        viewport_ptr->data_segment.data.bytes_ptr =
                (7 < viewport_ptr->data_segment.capacity) ? std::make_unique<omega_byte_t[]>(capacity) : nullptr;
        viewport_ptr->on_change_cbk = cbk;
        viewport_ptr->user_data_ptr = user_data_ptr;
        viewport_ptr->bit_offset = bit_offset;
        session_ptr->viewports_.push_back(viewport_ptr);

        // Populate the viewport and call the on change callback
        populate_viewport_(viewport_ptr.get());
        viewport_callback_(viewport_ptr.get(), nullptr);

        return viewport_ptr.get();
    }
    return nullptr;
}

int omega_viewport_destroy(omega_viewport_t *viewport_ptr) {
    for (auto iter = viewport_ptr->session_ptr->viewports_.rbegin();
         iter != viewport_ptr->session_ptr->viewports_.rend(); ++iter) {
        if (viewport_ptr == iter->get()) {
            if (7 < (*iter)->data_segment.capacity) { (*iter)->data_segment.data.bytes_ptr.reset(); }
            viewport_ptr->session_ptr->viewports_.erase(std::next(iter).base());
            return 0;
        }
    }
    return -1;
}

int omega_viewport_update(omega_viewport_t *viewport_ptr, int64_t offset, int64_t capacity, omega_byte_t bit_offset) {
    if (capacity > 0 && capacity <= omega_session_get_viewport_max_capacity(viewport_ptr->session_ptr)) {
        // only change settings if they are different
        if (viewport_ptr->data_segment.offset != offset || viewport_ptr->data_segment.capacity != capacity ||
            viewport_ptr->bit_offset != bit_offset) {
            if (7 < viewport_ptr->data_segment.capacity) { viewport_ptr->data_segment.data.bytes_ptr.reset(); }
            viewport_ptr->data_segment.offset = offset;
            viewport_ptr->data_segment.capacity = capacity;
            viewport_ptr->data_segment.data.bytes_ptr =
                    (7 < capacity) ? std::make_unique<omega_byte_t[]>(capacity) : nullptr;
            viewport_ptr->bit_offset = bit_offset;

            // Update viewport and call the on change callback
            populate_viewport_(viewport_ptr);
            viewport_callback_(viewport_ptr, nullptr);
        }
        return 0;
    }
    return -1;
}

const omega_byte_t *omega_viewport_get_data(const omega_viewport_t *viewport_ptr) {
    return get_data_segment_data_(const_cast<data_segment_t *>(&viewport_ptr->data_segment));
}
