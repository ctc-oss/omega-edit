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

#ifndef OMEGA_EDIT_INTERNAL_FUN_HPP
#define OMEGA_EDIT_INTERNAL_FUN_HPP

#include "../../include/byte.h"
#include "../../include/fwd_defs.h"
#include "internal_fwd_defs.hpp"
#include <iosfwd>

// Data segment functions
int populate_data_segment_(const omega_session_t *session_ptr, omega_data_segment_t *data_segment_ptr);

// Model segment functions
void print_model_segments_(const omega_model_t *model_ptr, std::ostream &out_stream);

#endif//OMEGA_EDIT_INTERNAL_FUN_HPP
