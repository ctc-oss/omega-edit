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

#ifndef OMEGA_EDIT_SESSION_DEF_HPP
#define OMEGA_EDIT_SESSION_DEF_HPP

#include "../../include/omega_edit/edit.h"
#include "../../include/omega_edit/fwd_defs.h"
#include "internal_fwd_defs.hpp"
#include "model_def.hpp"
#include <vector>

using omega_model_ptr_t = std::unique_ptr<omega_model_t>;
using omega_viewport_ptr_t = std::shared_ptr<omega_viewport_t>;
using omega_viewports_t = std::vector<omega_viewport_ptr_t>;
using omega_models_t = std::vector<omega_model_ptr_t>;

struct omega_session_struct {
    omega_session_event_cbk_t event_handler{};///< User callback when the session changes
    void *user_data_ptr{};                    ///< Pointer to associated user-provided data
    omega_viewports_t viewports_{};           ///< Collection of viewports in this session
    omega_models_t models_{};                 ///< Edit models (internal)
    int64_t num_changes_adjustment_{};        ///< Numer of changes in checkpoints
    int8_t session_flags_{};                  ///< Internal state flags
};

#endif//OMEGA_EDIT_SESSION_DEF_HPP
