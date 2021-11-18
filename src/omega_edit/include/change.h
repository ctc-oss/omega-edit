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

#ifndef OMEGA_EDIT_CHANGE_H
#define OMEGA_EDIT_CHANGE_H

#include "byte.h"
#include "fwd_defs.h"
#include <cstdint>

/**
 * Given a change, return the original change offset
 * @param change_ptr change to get the original change offset from
 * @return original change offset
 */
int64_t get_change_offset(const change_t *change_ptr);

/**
* Given a change, return the original number of bytes inserted or deleted (zero for overwrite)
* @param change_ptr change to get the original number of bytes from
* @return original number of bytes inserted or deleted (zero for overwrite)
*/
int64_t get_change_length(const change_t *change_ptr);

/**
 * Given a change, return the change serial number. A negative serial number is an undone change.
 * @param change_ptr change to get the serial number from
 * @return change serial number
 */
int64_t get_change_serial(const change_t *change_ptr);

/**
 * Given a change, return a character representing the kind of change ('D', 'I', and 'O')
 * @param change_ptr change to get the kind from
 * @return 'D' if the change is a delete, 'I' if the change is an insert and 'O' if the change is an overwrite
 */
char get_change_kind_as_char(const change_t *change_ptr);

/**
 * Given a change, return the new byte value for insert or overwrite (zero for delete)
 * @param change_ptr change to get the new byte value from
 * @return new byte value
 */
int64_t get_change_bytes(const change_t *change_ptr, const byte_t **bytes);

/**
 * Given a change, return the change author
 * @param change_ptr change to get the author from
 * @return change author
 */
const author_t *get_change_author(const change_t *change_ptr);

#endif//OMEGA_EDIT_CHANGE_H
