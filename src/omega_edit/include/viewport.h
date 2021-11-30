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

#ifndef OMEGA_EDIT_VIEWPORT_H
#define OMEGA_EDIT_VIEWPORT_H

#include "byte.h"
#include "fwd_defs.h"
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

/** On viewport change callback.  This under-defined function will be called when an associated viewport changes. */
typedef void (*omega_viewport_on_change_cbk_t)(const omega_viewport_t *, const omega_change_t *);

/**
 * Create a new viewport for the given author, returns a pointer to the new viewport
 * @param session_ptr author wanting the new viewport
 * @param offset offset for the new viewport
 * @param capacity desired capacity of the new viewport
 * @param cbk user-defined callback function called whenever the viewport gets updated
 * @param user_data_ptr pointer to user-defined data to associate with this new viewport
 * @param bit_offset bit offset for this viewport (0 - 7)
 * @return pointer to the new viewport, nullptr on failure
 */
omega_viewport_t *omega_viewport_create(omega_session_t *session_ptr, int64_t offset, int64_t capacity,
                                        omega_viewport_on_change_cbk_t cbk, void *user_data_ptr,
                                        omega_byte_t bit_offset = 0);

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
 * Given a viewport, return the viewport computed offset
 * @param viewport_ptr viewport to get the viewport computed offset from
 * @return viewport computed offset
 */
int64_t omega_viewport_get_computed_offset(const omega_viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport user data
 * @param viewport_ptr viewport to get the user data from
 * @return viewport user data
 */
void *omega_viewport_get_user_data(const omega_viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport bit offset
 * @param viewport_ptr viewport to get the bit offset from
 * @return viewport bit offset
 */
omega_byte_t omega_viewport_get_bit_offset(const omega_viewport_t *viewport_ptr);

/**
 * Change viewport settings
 * @param viewport_ptr viewport to change settings on
 * @param offset offset for the viewport
 * @param capacity capacity of the viewport
 * @param bit_offset bit offset of the viewport
 * @return 0 on success, non-zero otherwise
 */
int omega_viewport_update(omega_viewport_t *viewport_ptr, int64_t offset, int64_t capacity,
                          omega_byte_t bit_offset = 0);

/**
 * Destroy a given viewport
 * @param viewport_ptr viewport to destroy
 * @return 0 of the viewport was successfully destroyed, and non-zero otherwise
 */
int omega_viewport_destroy(omega_viewport_t *viewport_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_VIEWPORT_H
