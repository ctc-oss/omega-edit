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

#ifndef OMEGA_EDIT_INTERNAL_FUN_H
#define OMEGA_EDIT_INTERNAL_FUN_H

#include "../../include/fwd_defs.h"
#include "data_segment_def.h"
#include "model_def.h"
#include <ostream>

// Data segment functions
omega_byte_t *get_data_segment_data_(data_segment_t *data_segment_ptr);
int populate_data_segment_(const omega_session_t *session_ptr, data_segment_t *data_segment_ptr);

// Model segment functions
void print_model_segments_(const omega_model_t *model_ptr, std::ostream &out_stream);
void initialize_model_segments_(model_segments_t &model_segments, int64_t offset, int64_t length);

// Viewport functions
int populate_viewport_(omega_viewport_t *viewport_ptr);
void viewport_callback_(omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr);
int update_viewports_(omega_session_t *session_ptr, const omega_change_t *change_ptr);

#endif//OMEGA_EDIT_INTERNAL_FUN_H
