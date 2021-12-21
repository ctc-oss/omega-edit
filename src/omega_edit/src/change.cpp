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

#include "../include/change.h"
#include "impl_/change_def.hpp"
#include "impl_/macros.hpp"
#include <cassert>

int64_t omega_change_get_offset(const omega_change_t *change_ptr) {
    assert(change_ptr);
    return change_ptr->offset;
}

int64_t omega_change_get_length(const omega_change_t *change_ptr) {
    assert(change_ptr);
    return change_ptr->length;
}

int64_t omega_change_get_serial(const omega_change_t *change_ptr) {
    assert(change_ptr);
    return change_ptr->serial;
}

static inline const omega_byte_t *change_bytes_(const omega_change_t *change_ptr) {
    assert(change_ptr);
    return (change_ptr->kind != change_kind_t::CHANGE_DELETE)
                   ? ((7 < change_ptr->length) ? change_ptr->data.bytes_ptr : change_ptr->data.sm_bytes)
                   : nullptr;
}

const omega_byte_t *omega_change_get_bytes(const omega_change_t *change_ptr) {
    assert(change_ptr);
    return change_bytes_(change_ptr);
}

char omega_change_get_kind_as_char(const omega_change_t *change_ptr) {
    assert(change_ptr);
    switch (change_ptr->kind) {
        case change_kind_t::CHANGE_DELETE:
            return 'D';
        case change_kind_t::CHANGE_INSERT:
            return 'I';
        case change_kind_t::CHANGE_OVERWRITE:
            return 'O';
        default:
            ABORT(CLOG << LOCATION << " Unhandled change kind" << std::endl;);
    }
}

int omega_change_is_undone(const omega_change_t *change_ptr) {
    assert(change_ptr);
    return (0 < change_ptr->serial) ? 0 : 1;
}
