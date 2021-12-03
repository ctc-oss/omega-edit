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

#ifndef OMEGA_EDIT_EDIT_H
#define OMEGA_EDIT_EDIT_H

#include "byte.h"
#include "fwd_defs.h"
#include <cstddef>
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

/** Callback to implement when pattern matches are found in a session.
 * Return 0 to continue matching and non-zero to stop.*/
typedef int (*omega_edit_match_found_cbk_t)(int64_t match_offset, int64_t match_length, void *user_data);

/** On session change callback.  This under-defined function will be called when an associated session changes. */
typedef void (*omega_session_on_change_cbk_t)(const omega_session_t *, const omega_change_t *);

/** On viewport change callback.  This under-defined function will be called when an associated viewport changes. */
typedef void (*omega_viewport_on_change_cbk_t)(const omega_viewport_t *, const omega_change_t *);

/**
 * Create a file editing session from a file path
 * @param file_path file path, will be opened for read, to create an editing session with, or nullptr if starting from scratch
 * @param session_on_change_cbk user-defined callback function called whenever a content affecting change is made to this session
 * @param user_data_ptr pointer to user-defined data to associate with this session
  @return pointer to the created session, nullptr on failure
 */
omega_session_t *omega_edit_create_session(const char *file_path = nullptr, omega_session_on_change_cbk_t cbk = nullptr,
                                           void *user_data_ptr = nullptr);

/**
 * Destroy the given session and all associated objects (authors, changes, and viewports)
 * @param session_ptr session to destroy
 */
void omega_edit_destroy_session(omega_session_t *session_ptr);

/**
 * Create a new viewport for the given author, returns a pointer to the new viewport
 * @param session_ptr author wanting the new viewport
 * @param offset offset for the new viewport
 * @param capacity desired capacity of the new viewport
 * @param cbk user-defined callback function called whenever the viewport gets updated
 * @param user_data_ptr pointer to user-defined data to associate with this new viewport
 * @return pointer to the new viewport, nullptr on failure
 */
omega_viewport_t *omega_edit_create_viewport(omega_session_t *session_ptr, int64_t offset, int64_t capacity,
                                             omega_viewport_on_change_cbk_t cbk, void *user_data_ptr = nullptr);

/**
 * Destroy a given viewport
 * @param viewport_ptr viewport to destroy
 * @return 0 of the viewport was successfully destroyed, and non-zero otherwise
 */
int omega_edit_destroy_viewport(omega_viewport_t *viewport_ptr);

/**
 * Given a session, undo the last change
 * @param session_ptr session to undo the last change for
 * @return positive serial number of the undone change if successful, -1 otherwise
 */
int64_t omega_edit_undo_last_change(omega_session_t *session_ptr);

/**
 * Redoes the last undo (if available)
 * @param session_ptr session to redo the last undo for
 * @return positive serial number of the redone change if successful, -1 otherwise
 */
int64_t omega_edit_redo_last_undo(omega_session_t *session_ptr);

/**
 * Save the given session (the edited file) to the given file path
 * @param session_ptr session to save
 * @param file_path file path to save to
 * @return 0 on success, non-zero otherwise
 */
int omega_edit_save(const omega_session_t *session_ptr, const char *file_path);

/**
 * Given a session, find needles and call the match found callback as needles are found
 * @param session_ptr session to find the needles in
 * @param needle pointer to the needle to find
 * @param needle_length length of the needle
 * @param cbk the callback to call as needles are found in the session
 * @param user_data user data to send back into the callback
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes
 * @return 0 if all needles have been found, or the non-zero return from the user callback
 */
int omega_edit_search(const omega_session_t *session_ptr, const omega_byte_t *needle, int64_t needle_length,
                      omega_edit_match_found_cbk_t cbk, void *user_data = nullptr, int64_t session_offset = 0,
                      int64_t session_length = 0);

/**
 * Delete a number of bytes at the given offset
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param length number of bytes to delete
 * @return positive change serial number on success, negative value otherwise
 */
int64_t omega_edit_delete(omega_session_t *session_ptr, int64_t offset, int64_t length);

/**
 * Insert a number of bytes at the given offset
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param bytes bytes to insert at the given offset
 * @param length number of bytes to insert (if 0, strlen will be used to calculate the length of null-terminated bytes)
 * @return positive change serial number on success, negative value otherwise
 */
int64_t omega_edit_insert(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes, int64_t length = 0);

/**
 * Overwrite bytes at the given offset with the given new bytes
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param bytes new bytes to overwrite the old bytes with
 * @param length number of bytes to overwrite (if 0, strlen will be used to calculate the length of null-terminated bytes)
 * @return positive change serial number on success, negative value otherwise
 */
int64_t omega_edit_overwrite(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes,
                             int64_t length = 0);

/**
 * Checks the internal session model for errors
 * @param session_ptr session whose model to check for errors
 * @return 0 if the model is error free and non-zero otherwise
 */
int omega_edit_check_model(const omega_session_t *session_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_EDIT_H
