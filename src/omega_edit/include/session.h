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

#ifndef OMEGA_EDIT_SESSION_H
#define OMEGA_EDIT_SESSION_H

#include "byte.h"
#include "config.h"
#include "fwd_defs.h"
#include <cstdint>
#include <cstdio>

#ifdef __cplusplus
extern "C" {
#endif

/** On session change callback.  This under-defined function will be called when an associated session changes. */
typedef void (*omega_session_on_change_cbk_t)(const omega_session_t *, const omega_change_t *);

/**
 * Create a file editing session from a file path
 * @param file_path file path, will be opened for read, to create an editing session with, or nullptr if starting from scratch
 * @param session_on_change_cbk user-defined callback function called whenever a content affecting change is made to this session
 * @param user_data_ptr pointer to user-defined data to associate with this session
 * @param viewport_max_capacity maximum allowed viewport capacity for this session
 * @param offset offset to start editing from, 0 (default) is the beginning of the file
 * @param length amount of the file from the offset to edit, 0 (default) is the length of the file
* @return pointer to the created session, nullptr on failure
 */
omega_session_t *omega_session_create(const char *file_path, omega_session_on_change_cbk_t cbk = nullptr,
                                      void *user_data_ptr = nullptr,
                                      int64_t viewport_max_capacity = DEFAULT_VIEWPORT_MAX_CAPACITY, int64_t offset = 0,
                                      int64_t length = 0);

/**
 * Given a session, return the file path being edited (if known)
 * @param session_ptr session to return the file path from
 * @return file path, or null if not known
 */
const char *omega_session_get_file_path(const omega_session_t *session_ptr);

/**
 * Given a session, return the maximum viewport capacity
 * @param session_ptr session to get the maximum viewport capacity from
 * @return maximum viewport capacity for the given session
 */
int64_t omega_session_get_viewport_max_capacity(const omega_session_t *session_ptr);

/**
 * Given a session, return the associated user data
 * @param session_ptr session to get the associated user data from
 * @return associated user data for the given session
 */
void *omega_session_get_user_data(const omega_session_t *session_ptr);

/**
 * Given a session, return the offset
 * @param session_ptr session to get offset from
 * @return offset
 */
int64_t omega_session_get_offset(const omega_session_t *session_ptr);

/**
 * Given a session, return the length
 * @param session_ptr session to get length from
 * @return length
 */
int64_t omega_session_get_length(const omega_session_t *session_ptr);

/**
 * Given a session, return the number of active viewports
 * @param session_ptr session to get the number of active viewports for
 * @return number of active viewports
 */
size_t omega_session_get_num_viewports(const omega_session_t *session_ptr);

/**
 * Destroy the given session and all associated objects (authors, changes, and viewports)
 * @param session_ptr session to destroy
 */
void omega_session_destroy(const omega_session_t *session_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_SESSION_H
