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

#ifndef OMEGA_EDIT_VIEWPORT_DEF_HPP
#define OMEGA_EDIT_VIEWPORT_DEF_HPP

#include "../../include/fwd_defs.h"
#include "data_segment_def.hpp"
#include "internal_fwd_defs.hpp"

struct omega_viewport_struct {
    omega_session_t *session_ptr{};                ///< Session that owns this viewport instance
    omega_data_segment_t data_segment{};           ///< Viewport data
    omega_viewport_on_change_cbk_t on_change_cbk{};///< User callback when the viewport changes
    void *user_data_ptr{};                         ///< Pointer to associated user-provided data
};

#endif//OMEGA_EDIT_VIEWPORT_DEF_HPP
