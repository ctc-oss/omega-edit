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

#ifndef OMEGA_EDIT_SESSION_DEF_H
#define OMEGA_EDIT_SESSION_DEF_H

#include "../../include/fwd_defs.h"
#include "../../include/session.h"
#include "model_def.h"
#include <vector>

typedef std::vector<const_author_ptr_t> authors_t;
typedef std::vector<viewport_ptr_t> viewports_t;
typedef std::vector<const_change_ptr_t> changes_t;

struct session_t {
    FILE *file_ptr{};                       ///< File being edited (open for read)
    int64_t serial{};                       ///< Incremented for every change
    int64_t viewport_max_capacity{};        ///< Maximum capacity of a viewport for this session
    session_on_change_cbk_t on_change_cbk{};///< User defined callback called when the session gets a change
    void *user_data_ptr{};                  ///< Pointer to user-provided data associated with this session
    int64_t offset{};                       ///< Edit offset into the file being edited
    int64_t length{};                       ///< Edit length into the file being edited
    authors_t authors{};                    ///< Collection of authors in this session
    viewports_t viewports{};                ///< Collection of viewports in this session
    changes_t changes{};                    ///< Collection of changes for this session, ordered by time
    changes_t changes_undone{};             ///< Undone changes that are eligible for being redone
    model_t model_{};                       ///< Edit model (internal)
};

#endif//OMEGA_EDIT_SESSION_DEF_H
