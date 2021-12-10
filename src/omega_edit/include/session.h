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
#include "fwd_defs.h"

#ifdef __cplusplus
#include <cstddef>
#include <cstdint>
extern "C" {
#else
#include <stddef.h>
#include <stdint.h>
#endif

/** Callback to implement for visiting changes in a session.
 * Return 0 to continue visiting changes and non-zero to stop.*/
typedef int (*omega_session_change_visitor_cbk_t)(const omega_change_t *, void *);

/**
 * Given a session, return the file path being edited (if known)
 * @param session_ptr session to return the file path from
 * @return file path, or null if not known
 */
const char *omega_session_get_file_path(const omega_session_t *session_ptr);

/**
 * Given a session, return the associated user data
 * @param session_ptr session to get the associated user data from
 * @return associated user data for the given session
 */
void *omega_session_get_user_data(const omega_session_t *session_ptr);

/**
 * Given a session, return the number of active viewports
 * @param session_ptr session to get the number of active viewports for
 * @return number of active viewports
 */
size_t omega_session_get_num_viewports(const omega_session_t *session_ptr);

/**
 * Given a session, return the current number of active changes
 * @param session_ptr session to get number of active changes from
 * @return number of active changes
 */
size_t omega_session_get_num_changes(const omega_session_t *session_ptr);

/**
 * Given a session, return the current number of undone changes eligible for being redone
 * @param session_ptr session to get the number of undone changes for
 * @return number of undone changes eligible for being redone
 */
size_t omega_session_get_num_undone_changes(const omega_session_t *session_ptr);

/**
 * Given a session, return the computed file size in bytes
 * @param session_ptr session to get the computed file size from
 * @return computed file size in bytes, or -1 on failure
 */
int64_t omega_session_get_computed_file_size(const omega_session_t *session_ptr);

/**
 * Given a session, get the last change (if any)
 * @param session_ptr session to get the last change from
 * @return last change, or nullptr if there are no changes
 */
const omega_change_t *omega_session_get_last_change(const omega_session_t *session_ptr);

/**
 * Given a session, get the last undone change eligible for redo (if any)
 * @param session_ptr session to get the last undone change eligible for redo from
 * @return last undone change eligible for redo
 */
const omega_change_t *omega_session_get_last_undo(const omega_session_t *session_ptr);

/**
 * Visit changes in the given session in chronological order (oldest first), if the callback returns an integer other
 * than 0, visitation will stop and the return value of the callback will be this function's return value
 * @param session_ptr session to visit changes in
 * @param cbk user-provided function to call for each change
 * @param user_data user-provided data to provide back to the callback
 * @return 0 if all changes were visited or the non-zero return value of the callback if visitation was stopped early
 */
int omega_session_visit_changes(const omega_session_t *session_ptr, omega_session_change_visitor_cbk_t cbk,
                                void *user_data);

/**
 * Visit changes in the given session in reverse chronological order (newest first), if the callback returns an integer
 * other than 0, visitation will stop and the return value of the callback will be this function's return value
 * @param session_ptr session to visit changes in
 * @param cbk user-provided function to call for each change
 * @param user_data user-provided data to provide back to the callback
 * @return 0 if all changes were visited or the non-zero return value of the callback if visitation was stopped early
 */
int omega_session_visit_changes_reverse(const omega_session_t *session_ptr, omega_session_change_visitor_cbk_t cbk,
                                        void *user_data);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_SESSION_H
