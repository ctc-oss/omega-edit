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

#ifndef OMEGA_EDIT_MODEL_SEGMENT_DEF_HPP
#define OMEGA_EDIT_MODEL_SEGMENT_DEF_HPP

#include "../../include/change.h"
#include "internal_fwd_defs.hpp"

enum class model_segment_kind_t { SEGMENT_READ, SEGMENT_INSERT };

struct omega_model_segment_struct {
    int64_t computed_offset{};            ///< Computed offset can differ from the change as segments move and split
    int64_t computed_length{};            ///< Computed length can differ from the change as segments split
    int64_t change_offset{};              ///< Change offset is the offset in the change due to a split
    const_omega_change_ptr_t change_ptr{};///< Reference to parent change
};

inline model_segment_kind_t omega_model_segment_get_kind(const omega_model_segment_t *model_segment_ptr) {
    return (0 == omega_change_get_serial(model_segment_ptr->change_ptr.get())) ? model_segment_kind_t::SEGMENT_READ
                                                                               : model_segment_kind_t::SEGMENT_INSERT;
}

inline char omega_model_segment_kind_as_char(const model_segment_kind_t segment_kind) {
    switch (segment_kind) {
        case model_segment_kind_t::SEGMENT_READ:
            return 'R';
        case model_segment_kind_t::SEGMENT_INSERT:
            return 'I';
    }
    return '?';
}

#endif//OMEGA_EDIT_MODEL_SEGMENT_DEF_HPP
