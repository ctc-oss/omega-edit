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

#ifndef OMEGA_OMEGA_EDIT_H
#define OMEGA_OMEGA_EDIT_H

#include <cstdint>
#include <cstdio>

// Default maximum viewport capacity
#define DEFAULT_VIEWPORT_MAX_CAPACITY (1024 * 1024)

/**
 * At the heart of Omega Edit, is the file editing session (session_t) which manages everything concerning the editing
 * of a given file.  Once a session is created, it needs to have one or more authors (author_t).  Each author can create
 * a series of changes (change_t) and can have a series of viewports (viewport_t).  Any changes that affect viewports in
 * the associated session will be kept up-to-date and when a viewport is changed, a user-defined callback function will
 * be called with the updated viewport and the change that triggered the update.
 */
struct session_t;
struct author_t;
struct change_t;
struct viewport_t;

/** On session change callback.  This under-defined function will be called when an associated session changes. */
typedef void (*session_on_change_cbk)(const session_t *, const change_t *);

/** On viewport change callback.  This under-defined function will be called when an associated viewport changes. */
typedef void (*viewport_on_change_cbk)(const viewport_t *, const change_t *);

/**
 * Given a change, return the original change offset
 * @param change_ptr change to get the original change offset from
 * @return original change offset
 */
int64_t get_change_original_offset(const change_t *change_ptr);

/**
* Given a change, return the original number of bytes inserted or deleted (zero for overwrite)
* @param change_ptr change to get the original number of bytes from
* @return original number of bytes inserted or deleted (zero for overwrite)
*/
int64_t get_change_original_length(const change_t *change_ptr);

/**
 * Given a change, return the change serial number. A negative serial number is an undone change.
 * @param change_ptr change to get the serial number from
 * @return change serial number
 */
int64_t get_change_serial(const change_t *change_ptr);

/**
 * Given a change, return the change author
 * @param change_ptr change to get the author from
 * @return change author
 */
const author_t *get_change_author(const change_t *change_ptr);

/**
 * Given a change, return the new byte value for insert or overwrite (zero for delete)
 * @param change_ptr change to get the new byte value from
 * @return new byte value
 */
uint8_t get_change_byte(const change_t *change_ptr);

/**
 * Given a viewport, return the author
 * @param viewport_ptr viewport to get the author from
 * @return viewport author
 */
const author_t *get_viewport_author(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport capacity
 * @param viewport_ptr viewport to get the capacity from
 * @return viewport capacity
 */
int64_t get_viewport_capacity(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport data length
 * @param viewport_ptr viewport to get the viewport data length from
 * @return viewport data length
 */
int64_t get_viewport_length(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport data
 * @param viewport_ptr viewport to get the viewport data from
 * @return viewport data
 */
const uint8_t *get_viewport_data(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport computed offset
 * @param viewport_ptr viewport to get the viewport computed offset from
 * @return viewport computed offset
 */
int64_t get_viewport_computed_offset(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport user data
 * @param viewport_ptr viewport to get the user data from
 * @return viewport user data
 */
void *get_viewport_user_data(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport bit offset
 * @param viewport_ptr viewport to get the bit offset from
 * @return viewport bit offset
 */
uint8_t get_viewport_bit_offset(const viewport_t *viewport_ptr);

/**
 * Given an author, return the author name
 * @param author_ptr author to get the author name from
 * @return author name as a null-terminated c-string
 */
const char *get_author_name(const author_t *author_ptr);

/**
 * Given an author, return the associated session
 * @param author_ptr author to get the associated session from
 * @return associated session
 */
session_t *get_author_session(const author_t *author_ptr);

/**
 * Create a file editing session
 * @param file_ptr file, opened for read, to create an editing session with
 * @param viewport_max_capacity maximum allowed viewport capacity for this session
 * @param session_on_change_cbk user-defined callback function called whenever a content affecting change is made to this session
 * @param user_data_ptr pointer to user-defined data to associate with this session
 * @return pointer to the created session, nullptr on failure
 */
session_t *create_session(FILE *file_ptr, int64_t viewport_max_capacity = DEFAULT_VIEWPORT_MAX_CAPACITY,
                          session_on_change_cbk cbk = nullptr, void *user_data_ptr = nullptr);

/**
 * Given a session, return the maximum viewport capacity
 * @param session_ptr session to get the maximum viewport capacity from
 * @return maximum viewport capacity for the given session
 */
int64_t get_session_viewport_max_capacity(const session_t *session_ptr);

/**
 * Given a session, return the associated user data
 * @param session_ptr session to get the associated user data from
 * @return associated user data for the given session
 */
void *get_session_user_data(const session_t *session_ptr);

/**
 * Create a new author for the given session, returns a pointer to the new author
 * @param session_ptr session to create the author in
 * @param author_name author's name as a null-terminated c-string
 * @return pointer to the new author in the given session, nullptr on failure
 */
const author_t *create_author(session_t *session_ptr, const char *author_name);

/**
 * Create a new viewport for the given author, returns a pointer to the new viewport
 * @param author_ptr author wanting the new viewport
 * @param offset offset for the new viewport
 * @param capacity desired capacity of the new viewport
 * @param cbk user-defined callback function called whenever the viewport gets updated
 * @param user_data_ptr pointer to user-defined data to associate with this new viewport
 * @param bit_offset bit offset for this viewport (0 - 7)
 * @return pointer to the new viewport, nullptr on failure
 */
viewport_t *create_viewport(const author_t *author_ptr, int64_t offset, int64_t capacity, viewport_on_change_cbk cbk,
                            void *user_data_ptr, uint8_t bit_offset = 0);

/**
 * Destroy a given viewport
 * @param viewport_ptr viewport to destroy
 * @return 0 of the viewport was successfully destroyed, and non-zero otherwise
 */
int destroy_viewport(const viewport_t *viewport_ptr);

/**
 * Destroy the given session and all associated objects (authors, changes, and viewports)
 * @param session_ptr session to destroy
 */
void destroy_session(const session_t *session_ptr);

/**
 * Overwrite a byte at the given offset with the given new byte
 * @param author_ptr author making the change
 * @param offset location offset to make the change
 * @param new_byte new byte to overwrite the old
 * @return 0 on success, non-zero otherwise
 */
int ovr(const author_t *author_ptr, int64_t offset, uint8_t new_byte);

/**
 * Delete a number of bytes at the given offset
 * @param author_ptr author making the change
 * @param offset location offset to make the change
 * @param length number of bytes to delete
 * @return 0 on success, non-zero otherwise
 */
int del(const author_t *author_ptr, int64_t offset, int64_t length);

/**
 * Insert a number of bytes with value fill at the given offset
 * @param author_ptr author making the change
 * @param offset location offset to make the change
 * @param length number of bytes to insert
 * @param fill the value of the fill bytes
 * @return - on success, non-zero otherwise
 */
int ins(const author_t *author_ptr, int64_t offset, int64_t length, uint8_t fill);

/**
 * Given a session, return the current number of active changes
 * @param session_ptr session to get number of active changes from
 * @return number of active changes
 */
size_t get_session_num_changes(const session_t *session_ptr);

/**
 * Given a session, return the number of active viewports
 * @param session_ptr session to get the number of active viewports for
 * @return number of active viewports
 */
size_t get_session_num_viewports(const session_t *session_ptr);

/**
 * Given an author, return the number of active changes from this author
 * @param author_ptr author to get the number of active changes from
 * @return number of active change
 */
size_t get_author_num_changes(const author_t *author_ptr);

/**
 * Given a session, return the computed file size in bytes
 * @param session_ptr session to get the computed file size from
 * @return computed file size in bytes, or -1 on failure
 */
int64_t get_computed_file_size(const session_t *session_ptr);

/**
 * Change viewport settings
 * @param viewport_ptr viewport to change settings on
 * @param offset offset for the viewport
 * @param capacity capacity of the viewport
 * @param bit_offset bit offset of the viewport
 * @return 0 on success, non-zero otherwise
 */
int update_viewport(viewport_t *viewport_ptr, int64_t offset, int64_t capacity, uint8_t bit_offset);

/**
 * Given an author, undo the author's last change
 * @param author_ptr author to undo the last change for
 * @return 0 on success, non-zero otherwise
 */
int undo_last_change(const author_t *author_ptr);

/**
 * Save the given session to the given file
 * @param session_ptr session to save
 * @param file_ptr file (open for write) to save to
 * @return 0 on success, non-zero otherwise
 */
int save_to_file(const session_t *session_ptr, FILE *file_ptr);

#endif //OMEGA_OMEGA_EDIT_H
