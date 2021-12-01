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

#ifndef OMEGA_EDIT_MODEL_SEGMENT_DEF_H
#define OMEGA_EDIT_MODEL_SEGMENT_DEF_H

#include "internal_fwd_defs.h"

enum class model_segment_kind_t { SEGMENT_READ, SEGMENT_INSERT };

struct model_segment_t {
    int64_t computed_offset{};///< Computed offset can differ from the change because segments can moved and be split
    int64_t computed_length{};///< Computed length can differ from the change because changes can be split
    int64_t change_offset{};  ///< Change offset is the offset in the change due to a split
    const_omega_change_ptr_t change_ptr{};///< Parent change
};

#endif//OMEGA_EDIT_MODEL_SEGMENT_DEF_H
