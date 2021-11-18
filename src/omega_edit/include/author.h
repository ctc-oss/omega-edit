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

#ifndef OMEGA_EDIT_AUTHOR_H
#define OMEGA_EDIT_AUTHOR_H

#include "byte.h"
#include "fwd_defs.h"
#include <cstdint>
#include <cstdio>

/**
 * Create a new author for the given session, returns a pointer to the new author
 * @param session_ptr session to create the author in
 * @param author_name author's name as a null-terminated c-string
 * @return pointer to the new author in the given session, nullptr on failure
 */
const author_t *create_author(session_t *session_ptr, const char *author_name);

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
 * Given an author, return the number of active changes from this author
 * @param author_ptr author to get the number of active changes from
 * @return number of active change
 */
size_t get_author_num_changes(const author_t *author_ptr);

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
 * @param bytes the value of the fill bytes
 * @param length number of bytes to insert (if 0, strlen will be used to calculate the length of bytes)
 * @return - on success, non-zero otherwise
 */
int ins(const author_t *author_ptr, int64_t offset, const byte_t *bytes, int64_t length = 0);

/**
 * Overwrite a byte at the given offset with the given new byte
 * @param author_ptr author making the change
 * @param offset location offset to make the change
 * @param bytes new byte to overwrite the old
 * @param length number of bytes to overwrite (if 0, strlen will be used to calculate the length of bytes)
 * @return 0 on success, non-zero otherwise
 */
int ovr(const author_t *author_ptr, int64_t offset, const byte_t *bytes, int64_t length = 0);

#endif//OMEGA_EDIT_AUTHOR_H
