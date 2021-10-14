/*
 * Copyright 2021 Concurrent Technologies Corporation, Nteligen LLC
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

// Forward declarations
struct session_t;
struct change_t;
struct author_t;
struct viewport_t;

// On viewport change callback
typedef void (*on_change_cbk)(const viewport_t *, const change_t *);

int64_t get_computed_offset(const change_t *change_ptr);

int64_t get_num_bytes(const change_t *change_ptr);

int64_t get_serial(const change_t *change_ptr);

const author_t *get_author(const change_t *change_ptr);

uint8_t get_byte(const change_t *change_ptr);

const author_t *get_viewport_author(const viewport_t *viewport_ptr);

int64_t get_viewport_capacity(const viewport_t *viewport_ptr);

int64_t get_viewport_length(const viewport_t *viewport_ptr);

int64_t get_viewport_computed_offset(const viewport_t *viewport_ptr);

const uint8_t *get_viewport_data(const viewport_t *viewport_ptr);

void *get_viewport_user_data(const viewport_t *viewport_ptr);

// Returns the author's name from the given author structure
const char *get_author_name(const author_t *author_ptr);

session_t *get_author_session(const author_t *author_ptr);

// Create a session (return 0 on error, pointer otherwise)
session_t *create_session(FILE *file_ptr);

// Add an author to the given session, returns a pointer to the author structure
const author_t *add_author(session_t *session_ptr, const char *author_name);

// Add a viewport to the given session
viewport_t *
add_viewport(const author_t *author_ptr, int64_t offset, int32_t capacity, on_change_cbk cbk, void *user_data_ptr);

// Destroy the given session
void destroy_session(session_t *session_ptr);

// handle changes (return 0 on success, non-zero otherwise)
int ovr(const author_t *author_ptr, int64_t offset, uint8_t byte);

int del(const author_t *author_ptr, int64_t offset, int64_t num_bytes);

int ins(const author_t *author_ptr, int64_t offset, int64_t num_bytes, uint8_t fill);

size_t num_changes(const session_t *session_ptr);

size_t num_changes_by_author(const author_t *author_ptr);

int64_t get_computed_file_size(const session_t *session_ptr);

int64_t offset_to_computed_offset(const session_t *session_ptr, int64_t offset);

int64_t computed_offset_to_offset(const session_t *session_ptr, int64_t offset);

// Set viewport at the given offset (return 0 on success, non-zero otherwise)
int set_viewport(viewport_t *viewport_ptr, int64_t offset, int32_t capacity);

// Undo the last change for this author from the given session (return 0 on success, non-zero otherwise)
int undo(const author_t *author_ptr);

// Save the given session to the given file (return 0 on success, non-zero otherwise)
int save(const author_t *author_ptr, FILE *file_ptr);

int read_segment(FILE *from_file_ptr, int64_t offset, int64_t file_size, uint8_t *buffer, int64_t capacity,
                 int64_t *length);

int write_segment(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr);

#endif //OMEGA_OMEGA_EDIT_H
