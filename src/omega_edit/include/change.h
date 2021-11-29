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

#ifndef OMEGA_EDIT_CHANGE_H
#define OMEGA_EDIT_CHANGE_H

#include "byte.h"
#include "fwd_defs.h"
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Given a change, return the original change offset
 * @param change_ptr change to get the original change offset from
 * @return original change offset
 */
int64_t omega_change_get_offset(const omega_change_t *change_ptr);

/**
* Given a change, return the original number of bytes deleted, inserted, or overwritten
* @param change_ptr change to get the original number of bytes from
* @return original number of bytes deleted, inserted, or overwritten
*/
int64_t omega_change_get_length(const omega_change_t *change_ptr);

/**
 * Given a change, return the change serial number. A negative serial number is an undone change.
 * @param change_ptr change to get the serial number from
 * @return change serial number
 */
int64_t omega_change_get_serial(const omega_change_t *change_ptr);

/**
 * Given a change, return a character representing the kind of change ('D', 'I', and 'O')
 * @param change_ptr change to get the kind from
 * @return 'D' if the change is a delete, 'I' if the change is an insert and 'O' if the change is an overwrite
 */
char omega_change_get_kind_as_char(const omega_change_t *change_ptr);

/**
 * Given a change, return a pointer to the byte data and its length
 * @param change_ptr change to get the new bytes data from
 * @param bytes_ptr address of a bytes pointer, that will be modified as a side effect, to point to the byte data
 * @return length of the byte data (0 for delete)
 */
int64_t omega_change_get_bytes(const omega_change_t *change_ptr, const omega_byte_t **bytes_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_CHANGE_H
