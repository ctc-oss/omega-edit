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
using omega_models_t = std::vector<omega_model_ptr_t>;
using omega_search_context_ptr_t = std::shared_ptr<omega_search_context_t>;
using omega_search_contexts_t = std::vector<omega_search_context_ptr_t>;
using omega_viewport_ptr_t = std::shared_ptr<omega_viewport_t>;
using omega_viewports_t = std::vector<omega_viewport_ptr_t>;


#define SESSION_FLAGS_PAUSE_VIEWPORT_CALLBACKS ((uint8_t) (1))
#define SESSION_FLAGS_SESSION_CHANGES_PAUSED ((uint8_t) (1 << 1))
#define SESSION_FLAGS_SESSION_TRANSACTION_OPENED ((uint8_t) (1 << 2))
#define SESSION_FLAGS_SESSION_TRANSACTION_IN_PROGRESS ((uint8_t) (1 << 3))

struct omega_session_struct {
    omega_session_event_cbk_t event_handler{}; ///< User callback when the session changes
    void *user_data_ptr{};                     ///< Pointer to associated user-provided data
    int32_t event_interest_;                   ///< Events of interest
    omega_viewports_t viewports_{};            ///< Collection of viewports in this session
    omega_search_contexts_t search_contexts_{};///< Collection of active search contexts
    omega_models_t models_{};                  ///< Edit models (internal)
    int64_t num_changes_adjustment_{};         ///< Number of changes in checkpoints
    int8_t session_flags_{};                   ///< Internal state flags
};

bool omega_session_get_transaction_bit_(const omega_session_t *session_ptr);

#endif//OMEGA_EDIT_SESSION_DEF_HPP
