/**********************************************************************************************************************
 * Copyright (c) 2021-2022 Concurrent Technologies Corporation.                                                       *
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

#ifndef OMEGA_EDIT_INTERNAL_FWD_DEFS_HPP
#define OMEGA_EDIT_INTERNAL_FWD_DEFS_HPP

#include "../../include/omega_edit/fwd_defs.h"
#include <memory>

using omega_model_t = struct omega_model_struct;
using omega_data_segment_t = struct omega_data_segment_struct;
using omega_model_segment_t = struct omega_model_segment_struct;

using const_omega_change_ptr_t = std::shared_ptr<const omega_change_t>;

#endif//OMEGA_EDIT_INTERNAL_FWD_DEFS_HPP
