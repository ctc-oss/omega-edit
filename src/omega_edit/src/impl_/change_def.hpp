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

#ifndef OMEGA_EDIT_CHANGE_DEF_HPP
#define OMEGA_EDIT_CHANGE_DEF_HPP

#include "../../include/fwd_defs.h"
#include "data_def.hpp"
#include <cstdint>

enum class change_kind_t { CHANGE_DELETE, CHANGE_INSERT, CHANGE_OVERWRITE };

struct omega_change_struct {
    int64_t serial{};    ///< Serial number of the change (increasing)
    change_kind_t kind{};///< Change kind
    int64_t offset{};    ///< Offset at the time of the change
    int64_t length{};    ///< Number of bytes at the time of the change
    omega_data_t data{}; ///< Bytes to insert or overwrite
};

#endif//OMEGA_EDIT_CHANGE_DEF_HPP
