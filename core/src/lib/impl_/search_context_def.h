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

#ifndef OMEGA_EDIT_SEARCH_CONTEXT_DEF_H
#define OMEGA_EDIT_SEARCH_CONTEXT_DEF_H

#include "../../include/omega_edit/fwd_defs.h"
#include "data_def.hpp"

struct omega_search_context_struct {
    const omega_find_skip_table_t *skip_table_ptr{};
    omega_session_t *session_ptr{};
    int64_t pattern_length{};
    int64_t session_offset{};
    int64_t session_length{};
    int64_t match_offset{};
    omega_util_byte_transform_t byte_transform{};
    omega_data_t pattern{};
};

#endif//OMEGA_EDIT_SEARCH_CONTEXT_DEF_H
