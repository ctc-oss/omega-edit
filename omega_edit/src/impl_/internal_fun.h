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

#ifndef OMEGA_EDIT_INTERNAL_FUN_H
#define OMEGA_EDIT_INTERNAL_FUN_H

#include "../../include/fwd_defs.h"
#include "data_segment_def.h"
#include "model_def.h"
#include <ostream>

void print_model_segments_(const session_t *session_ptr, std::ostream &out_stream);
int populate_data_segment_(const session_t *session_ptr, data_segment_t *data_segment_ptr);
int populate_viewport_(viewport_t *viewport_ptr);
void viewport_callback_(viewport_t *viewport_ptr, const change_t *change_ptr);
byte_t *get_data_segment_data_(data_segment_t *data_segment_ptr);
int update_viewports_(session_t *session_ptr, const change_t *change_ptr);
change_ptr_t del_(const author_t *author_ptr, int64_t offset, int64_t length);
int update_model_(session_t *session_ptr, const_change_ptr_t &change_ptr);
int update_(const_change_ptr_t &change_ptr);

#endif//OMEGA_EDIT_INTERNAL_FUN_H
