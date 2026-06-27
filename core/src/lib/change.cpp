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

#include "../include/omega_edit/change.h"
#include "impl_/change_def.hpp"
#include "impl_/macros.h"
#include <cassert>

using omega_edit::internal::change_kind_t;
using omega_edit::internal::omega_change_get_kind_;
using omega_edit::internal::omega_change_get_transaction_bit_;
using omega_edit::internal::omega_data_get_data_const_;

static_assert(sizeof(omega_change_t) == sizeof(omega_change_struct), "omega_change_t size mismatch");

int64_t omega_change_get_offset(const omega_change_t *change_ptr) {
    if (!change_ptr) { return -1; }
    return change_ptr->offset;
}

int64_t omega_change_get_length(const omega_change_t *change_ptr) {
    if (!change_ptr) { return 0; }
    return change_ptr->length;
}

int64_t omega_change_get_serial(const omega_change_t *change_ptr) {
    if (!change_ptr) { return 0; }
    return change_ptr->serial;
}

static inline const omega_byte_t *change_bytes_(const omega_change_t *change_ptr) {
    if (!change_ptr) { return nullptr; }
    const auto kind = omega_change_get_kind_(change_ptr);
    return (kind == change_kind_t::CHANGE_INSERT || kind == change_kind_t::CHANGE_OVERWRITE)
                   ? omega_data_get_data_const_(&change_ptr->data, change_ptr->length)
                   : nullptr;
}

const omega_byte_t *omega_change_get_bytes(const omega_change_t *change_ptr) {
    if (!change_ptr) { return nullptr; }
    return change_bytes_(change_ptr);
}

char omega_change_get_kind_as_char(const omega_change_t *change_ptr) {
    if (!change_ptr) { return '\0'; }
    switch (omega_change_get_kind_(change_ptr)) {
        case change_kind_t::CHANGE_DELETE:
            return 'D';
        case change_kind_t::CHANGE_INSERT:
            return 'I';
        case change_kind_t::CHANGE_OVERWRITE:
            return 'O';
        case change_kind_t::CHANGE_TRANSFORM:
            return 'T';
        default:
            ABORT(LOG_ERROR("Unhandled change kind"););
    }
}

int omega_change_get_transaction_bit(const omega_change_t *change_ptr) {
    if (!change_ptr) { return 0; }
    return omega_change_get_transaction_bit_(change_ptr) ? 1 : 0;
}

int omega_change_is_undone(const omega_change_t *change_ptr) {
    if (!change_ptr) { return 0; }
    return (0 < omega_change_get_serial(change_ptr)) ? 0 : 1;
}

int omega_change_is_transform(const omega_change_t *change_ptr) {
    if (!change_ptr) { return 0; }
    return omega_change_get_kind_(change_ptr) == change_kind_t::CHANGE_TRANSFORM ? 1 : 0;
}

const char *omega_change_get_transform_id(const omega_change_t *change_ptr) {
    if (!omega_change_is_transform(change_ptr) || !change_ptr->transform_data) { return nullptr; }
    return change_ptr->transform_data->transform_id.c_str();
}

const char *omega_change_get_transform_options_json(const omega_change_t *change_ptr) {
    if (!omega_change_is_transform(change_ptr) || !change_ptr->transform_data ||
        change_ptr->transform_data->options_json.empty()) {
        return nullptr;
    }
    return change_ptr->transform_data->options_json.c_str();
}

int64_t omega_change_get_transform_replacement_length(const omega_change_t *change_ptr) {
    if (!omega_change_is_transform(change_ptr) || !change_ptr->transform_data) { return -1; }
    return change_ptr->transform_data->replacement_length;
}

int64_t omega_change_get_transform_computed_file_size_before(const omega_change_t *change_ptr) {
    if (!omega_change_is_transform(change_ptr) || !change_ptr->transform_data) { return -1; }
    return change_ptr->transform_data->computed_file_size_before;
}

int64_t omega_change_get_transform_computed_file_size_after(const omega_change_t *change_ptr) {
    if (!omega_change_is_transform(change_ptr) || !change_ptr->transform_data) { return -1; }
    return change_ptr->transform_data->computed_file_size_after;
}
