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

#ifndef OMEGA_EDIT_INTERNAL_FWD_DEFS_HPP
#define OMEGA_EDIT_INTERNAL_FWD_DEFS_HPP

#include "../../include/fwd_defs.h"
#include <memory>

typedef struct omega_model_struct omega_model_t;
typedef struct omega_data_segment_struct omega_data_segment_t;
typedef struct omega_model_segment_struct omega_model_segment_t;

typedef std::shared_ptr<const omega_change_t> const_omega_change_ptr_t;

#endif//OMEGA_EDIT_INTERNAL_FWD_DEFS_HPP
