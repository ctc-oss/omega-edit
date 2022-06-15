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

#ifndef OMEGA_EDIT_EDIT_H
#define OMEGA_EDIT_EDIT_H

#include "byte.h"
#include "export.h"
#include "fwd_defs.h"
#include "utility.h"

#ifdef __cplusplus
#include <cstddef>
#include <cstdint>
extern "C" {
#else
#include <stddef.h>
#include <stdint.h>
#endif

/**
 * Create a file editing session from a file path
 * @param file_path file path, will be opened for read, to create an editing session with, or nullptr if starting from
 * scratch
 * @param cbk user-defined callback function called whenever a content affecting change is made to this session
 * @param user_data_ptr pointer to user-defined data to associate with this session
 * @param event_interest oring together the session events of interest, or zero if all session events are desired
 * @return pointer to the created session, nullptr on failure
 */
OMEGA_EDIT_EXPORT omega_session_t *omega_edit_create_session(const char *file_path, omega_session_event_cbk_t cbk,
                                                             void *user_data_ptr, int32_t event_interest);

/**
 * Destroy the given session and all associated objects (changes, and viewports)
 * @param session_ptr session to destroy
 */
OMEGA_EDIT_EXPORT void omega_edit_destroy_session(omega_session_t *session_ptr);

/**
 * Create a new viewport for the given author, returns a pointer to the new viewport
 * @param session_ptr author wanting the new viewport
 * @param offset offset for the new viewport
 * @param capacity desired capacity of the new viewport
 * @param is_floating 0 if the viewport is to remain fixed at the given offset, non-zero if the viewport is expected to
 * "float" as bytes are inserted or deleted before the start of this viewport
 * @param cbk user-defined callback function called whenever the viewport gets updated
 * @param user_data_ptr pointer to user-defined data to associate with this new viewport
 * @param event_interest oring together the viewport events of interest, or zero if all viewport events are desired
 * @return pointer to the new viewport, nullptr on failure
 */
OMEGA_EDIT_EXPORT omega_viewport_t *omega_edit_create_viewport(omega_session_t *session_ptr, int64_t offset,
                                                               int64_t capacity, int is_floating,
                                                               omega_viewport_event_cbk_t cbk, void *user_data_ptr,
                                                               int32_t event_interest);

/**
 * Destroy a given viewport
 * @param viewport_ptr viewport to destroy
 * @return 0 of the viewport was successfully destroyed, and non-zero otherwise
 */
OMEGA_EDIT_EXPORT void omega_edit_destroy_viewport(omega_viewport_t *viewport_ptr);

/**
 * Given a session, clear all active changes
 * @param session_ptr session to clear all changes for
 * @return zero on success and non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_edit_clear_changes(omega_session_t *session_ptr);

/**
 * Given a session, undo the last change
 * @param session_ptr session to undo the last change for
 * @return negative serial number of the undone change if successful, zero otherwise
 */
OMEGA_EDIT_EXPORT int64_t omega_edit_undo_last_change(omega_session_t *session_ptr);

/**
 * Redoes the last undo (if available)
 * @param session_ptr session to redo the last undo for
 * @return positive serial number of the redone change if successful, zero otherwise
 */
OMEGA_EDIT_EXPORT int64_t omega_edit_redo_last_undo(omega_session_t *session_ptr);

/**
 * Save the given session (the edited file) to the given file path.  If the save file already exists, it can be overwritten
 * if overwrite is non zero.  If the file exists and overwrite is zero, a new file name will be used as determined by
 * omega_util_available_filename.  If the file being edited is overwritten, the affected editing session will be reset.
 * @param session_ptr session to save
 * @param file_path file path to save to
 * @param overwrite set to non-zero if overwriting an existing file is okay, and zero otherwise
 * @param saved_file_path if overwrite is not set and the target file_path exists, a new file path will be created, and if
 * this parameter is non-null, the saved file path will be copied here (must be able to accommodate FILENAME_MAX bytes)
 * @return 0 on success, non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_edit_save(omega_session_t *session_ptr, const char *file_path, int overwrite,
                                      char *saved_file_path);

/**
 * Delete a number of bytes at the given offset
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param length number of bytes to delete
 * @return positive change serial number on success, zero otherwise
 */
OMEGA_EDIT_EXPORT int64_t omega_edit_delete(omega_session_t *session_ptr, int64_t offset, int64_t length);

/**
 * Insert a number of bytes at the given offset
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param bytes bytes to insert at the given offset
 * @param length number of bytes to insert (if 0, strlen will be used to calculate the length of null-terminated bytes)
 * @return positive change serial number on success, zero otherwise
 */
OMEGA_EDIT_EXPORT int64_t omega_edit_insert_bytes(omega_session_t *session_ptr, int64_t offset,
                                                  const omega_byte_t *bytes, int64_t length);

/**
 * Insert a C string at the given offset
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param cstr C string to insert at the given offset
 * @param length length of the C string to insert (if 0, strlen will be used to calculate the length of null-terminated
 * bytes)
 * @return positive change serial number on success, zero otherwise
 */
OMEGA_EDIT_EXPORT int64_t omega_edit_insert(omega_session_t *session_ptr, int64_t offset, const char *cstr,
                                            int64_t length);

/**
 * Overwrite bytes at the given offset with the given new bytes
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param bytes new bytes to overwrite the old bytes with
 * @param length number of new bytes (if 0, strlen will be used to calculate the length of null-terminated bytes)
 * @return positive change serial number on success, zero otherwise
 */
OMEGA_EDIT_EXPORT int64_t omega_edit_overwrite_bytes(omega_session_t *session_ptr, int64_t offset,
                                                     const omega_byte_t *bytes, int64_t length);

/**
 * Overwrite bytes at the given offset with the given new C string
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param cstr new C string to overwrite the old bytes with
 * @param length length of the new C string (if 0, strlen will be used to calculate the length of null-terminated bytes)
 * @return positive change serial number on success, zero otherwise
 */
OMEGA_EDIT_EXPORT int64_t omega_edit_overwrite(omega_session_t *session_ptr, int64_t offset, const char *cstr,
                                               int64_t length);

/**
 * Checkpoint and apply the given mask of the given mask type to the bytes starting at the given offset up to the given
 * length
 * @param session_ptr session to make the change in
 * @param transform byte transform to apply
 * @param user_data_ptr pointer to user data that will be sent through to the given transform
 * @param offset location offset to make the change
 * @param length the number of bytes from the given offset to apply the mask to
 * @param checkpoint_directory directory to store the checkpoint file
 * @return zero on success, non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_edit_apply_transform(omega_session_t *session_ptr, omega_util_byte_transform_t transform,
                                                 void *user_data_ptr, int64_t offset, int64_t length,
                                                 char const *checkpoint_directory);

/**
 * Creates a session checkpoint in the given directory.
 * @param session_ptr session to checkpoint
 * @param checkpoint_directory directory to create the checkpoint in
 * @return zero on success, non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_edit_create_checkpoint(omega_session_t *session_ptr, char const *checkpoint_directory);

/**
 * Destroys the last checkpoint created on the given session
 * @param session_ptr session to remove the checkpoint
 * @return zero on success, non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_edit_destroy_last_checkpoint(omega_session_t *session_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_EDIT_H
