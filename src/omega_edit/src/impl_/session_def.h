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

#ifndef OMEGA_EDIT_SESSION_DEF_H
#define OMEGA_EDIT_SESSION_DEF_H

#include "../../include/session.h"
#include "internal_fwd_defs.h"
#include <string>
#include <vector>

typedef std::vector<omega_viewport_ptr_t> viewports_t;

struct omega_session_t {
    FILE *file_ptr{};                             ///< File being edited (open for read)
    std::string file_path;                        ///< File path being edited
    int64_t viewport_max_capacity{};              ///< Maximum capacity of a viewport for this session
    omega_session_on_change_cbk_t on_change_cbk{};///< User defined callback called when the session gets a change
    void *user_data_ptr{};                        ///< Pointer to user-provided data associated with this session
    int64_t offset{};                             ///< Edit offset into the file being edited
    int64_t length{};                             ///< Edit length into the file being edited
    viewports_t viewports_{};                     ///< Collection of viewports in this session
    omega_model_ptr_t model_ptr_{};               ///< Edit model (internal)
};

#endif//OMEGA_EDIT_SESSION_DEF_H
