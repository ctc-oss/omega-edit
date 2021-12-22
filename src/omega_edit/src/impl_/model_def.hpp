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

#ifndef OMEGA_EDIT_MODEL_DEF_HPP
#define OMEGA_EDIT_MODEL_DEF_HPP

#include "internal_fwd_defs.hpp"
#include "model_segment_def.hpp"
#include <memory>
#include <vector>

typedef std::unique_ptr<omega_model_segment_t> omega_model_segment_ptr_t;
typedef std::vector<omega_model_segment_ptr_t> omega_model_segments_t;
typedef std::vector<const_omega_change_ptr_t> omega_changes_t;

struct omega_model_struct {
    omega_changes_t changes{};              ///< Collection of changes for this session, ordered by time
    omega_changes_t changes_undone{};       ///< Undone changes that are eligible for being redone
    omega_model_segments_t model_segments{};///< Model segment vector
};

#endif//OMEGA_EDIT_MODEL_DEF_HPP
