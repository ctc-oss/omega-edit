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

#include "../../include/omega_edit/byte.h"
#include "../../include/omega_edit/fwd_defs.h"
#include "internal_fwd_defs.hpp"
#include <iosfwd>

int64_t get_computed_file_size_(const omega_session_t *session_ptr);

const char *get_file_path_(const omega_session_t *session_ptr);

void pause_viewport_event_callbacks_(omega_session_t *session_ptr);

void resume_viewport_event_callbacks_(omega_session_t *session_ptr);

int on_change_callbacks_paused_(const omega_session_t *session_ptr);

void session_notify_(const omega_session_t *session_ptr, omega_session_event_t session_event,
                     const omega_change_t *change_ptr);

int64_t get_num_changes_(const omega_session_t *session_ptr);

int64_t get_num_checkpoints_(const omega_session_t *session_ptr);

void destroy_viewport_(omega_viewport_t *viewport_ptr);

void viewport_notify_(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                      const omega_change_t *change_ptr);

int64_t viewport_get_capacity_(const omega_viewport_t *viewport_ptr);

int64_t viewport_get_length_(const omega_viewport_t *viewport_ptr);

int64_t viewport_get_offset_(const omega_viewport_t *viewport_ptr);

int viewport_is_floating_(const omega_viewport_t *viewport_ptr);

int viewport_has_changes_(const omega_viewport_t *viewport_ptr);

void viewport_notify_(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                      const omega_change_t *change_ptr);

// Data segment functions
int populate_data_segment_(const omega_session_t *session_ptr, omega_data_segment_t *data_segment_ptr) noexcept;

// Model segment functions
void print_model_segments_(const omega_model_t *model_ptr, std::ostream &out_stream) noexcept;

#endif//OMEGA_EDIT_INTERNAL_FUN_HPP
