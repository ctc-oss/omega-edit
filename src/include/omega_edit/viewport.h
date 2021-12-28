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

#ifndef OMEGA_EDIT_VIEWPORT_H
#define OMEGA_EDIT_VIEWPORT_H

#include "byte.h"
#include "fwd_defs.h"

#ifdef __cplusplus
#include <cstdint>
extern "C" {
#else
#include <stdint.h>
#endif

/**
 * Given a viewport, return the session pointer
 * @param viewport_ptr viewport to get the session pointer from
 * @return viewport session pointer
 */
const omega_session_t *omega_viewport_get_session(const omega_viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport capacity
 * @param viewport_ptr viewport to get the capacity from
 * @return viewport capacity
 */
int64_t omega_viewport_get_capacity(const omega_viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport data length
 * @param viewport_ptr viewport to get the viewport data length from
 * @return viewport data length
 */
int64_t omega_viewport_get_length(const omega_viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport data
 * @param viewport_ptr viewport to get the viewport data from
 * @return viewport data
 */
const omega_byte_t *omega_viewport_get_data(const omega_viewport_t *viewport_ptr);

/**
 * Given a viewport, determine if it contains changes since the last omega_viewport_get_data call
 * @param viewport_ptr viewport to determine if changes are present
 * @return 0 if there are no changes present, and non-zero otherwise
 */
int omega_viewport_has_changes(const omega_viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport offset
 * @param viewport_ptr viewport to get the viewport offset from
 * @return viewport offset
 */
int64_t omega_viewport_get_offset(const omega_viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport user data
 * @param viewport_ptr viewport to get the user data from
 * @return viewport user data
 */
void *omega_viewport_get_user_data(const omega_viewport_t *viewport_ptr);

/**
 * Change viewport settings
 * @param viewport_ptr viewport to change settings on
 * @param offset offset for the viewport
 * @param capacity capacity of the viewport
 * @return 0 on success, non-zero otherwise
 */
int omega_viewport_update(omega_viewport_t *viewport_ptr, int64_t offset, int64_t capacity);

/**
 * Execute the viewport on-change callback with the given change if a viewport on-change callback is defined and if the
 * session where this viewport lives does not currently have viewport on-change callbacks paused
 * @param viewport_ptr viewport for which to execute its on-change callback
 * @param change_ptr change responsible for the viewport change (if any)
 */
void omega_viewport_execute_on_change(omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_VIEWPORT_H
