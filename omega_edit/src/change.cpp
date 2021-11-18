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

#include "../include/change.h"
#include "impl_/change_def.h"
#include "impl_/macros.h"

int64_t get_change_offset(const change_t *change_ptr) { return change_ptr->offset; }

int64_t get_change_length(const change_t *change_ptr) { return change_ptr->length; }

int64_t get_change_serial(const change_t *change_ptr) { return change_ptr->serial; }

inline const byte_t *change_bytes_(const change_t *change_ptr) {
    return (change_ptr->kind != change_kind_t::CHANGE_DELETE)
                   ? ((change_ptr->length < 8) ? change_ptr->data.sm_bytes : change_ptr->data.bytes.get())
                   : nullptr;
}

int64_t get_change_bytes(const change_t *change_ptr, const byte_t **bytes) {
    *bytes = change_bytes_(change_ptr);
    return change_ptr->length;
}

char get_change_kind_as_char(const change_t *change_ptr) {
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

const author_t *get_change_author(const change_t *change_ptr) { return change_ptr->author_ptr; }
