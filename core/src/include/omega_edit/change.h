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

/**
 * @file change.h
 * @brief Functions that operate on editing changes (omega_change_t).
 */

#ifndef OMEGA_EDIT_CHANGE_H
#define OMEGA_EDIT_CHANGE_H

#include "byte.h"
#include "fwd_defs.h"

#ifdef __cplusplus

#include <cstdint>

extern "C" {
#else

#include <stdint.h>

#endif

/**
 * Storage backing for a change primitive's data payload.
 */
typedef enum {
    OMEGA_CHANGE_DATA_STORAGE_NONE = 0,      ///< No data payload is available for this change.
    OMEGA_CHANGE_DATA_STORAGE_INLINE = 1,    ///< Data is stored inline with the change.
    OMEGA_CHANGE_DATA_STORAGE_FILE_BACKED = 2///< Data is stored in a session-owned backing file.
} omega_change_data_storage_t;

/**
 * Payload selector for internal and diagnostic byte access.
 */
typedef enum {
    OMEGA_CHANGE_PAYLOAD_DATA = 0,       ///< The primitive data payload.
    OMEGA_CHANGE_PAYLOAD_INVERSE_DATA = 1///< Bytes removed by the primitive, when distinct from data.
} omega_change_payload_role_t;

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
 * Given a change, return a character representing the kind of change ('D', 'I', 'O', and 'T')
 * @param change_ptr change to get the kind from
 * @return 'D' if the change is a delete, 'I' if the change is an insert, 'O' if the change is an overwrite, and 'T'
 * if the change is a transform
 */
char omega_change_get_kind_as_char(const omega_change_t *change_ptr);

/**
 * Given a change, return the transaction bit (0 or 1)
 * @param change_ptr change to get the transaction bit from
 * @return transaction bit (0 or 1)
 */
int omega_change_get_transaction_bit(const omega_change_t *change_ptr);

/**
 * Given a change, return a pointer to the primitive byte payload.
 *
 * This is the first-class primitive view of the change data field:
 * - INSERT/OVERWRITE payloads are the inserted or overwritten bytes.
 * - DELETE payloads are exactly the original bytes removed by the edit.
 * - TRANSFORM payloads are a JSON descriptor containing the transform id and arguments.
 *
 * Use omega_change_get_data_length and omega_change_get_data_storage to interpret the returned pointer.
 *
 * @param change_ptr change to get the primitive byte payload from
 * @return pointer to primitive data, or NULL when no payload is available or materialization fails
 */
const omega_byte_t *omega_change_get_bytes(const omega_change_t *change_ptr);

/**
 * Alias for omega_change_get_bytes.
 * @param change_ptr change to get the primitive data payload from
 * @return pointer to primitive data, or NULL when no payload is available or materialization fails
 */
const omega_byte_t *omega_change_get_data(const omega_change_t *change_ptr);

/**
 * Given a change, return the primitive data payload length.
 * @param change_ptr change to inspect
 * @return primitive data byte count, or 0 when no payload is available
 */
int64_t omega_change_get_data_length(const omega_change_t *change_ptr);

/**
 * Given a change, return how the primitive data payload is stored.
 * @param change_ptr change to inspect
 * @return primitive data storage kind
 */
omega_change_data_storage_t omega_change_get_data_storage(const omega_change_t *change_ptr);

/**
 * Given a change, return a non-zero value if this is a transform change.
 * @param change_ptr change to inspect
 * @return non-zero if the change is a transform, zero otherwise
 */
int omega_change_is_transform(const omega_change_t *change_ptr);

/**
 * Given a transform change, return the transform identifier.
 * @param change_ptr transform change to inspect
 * @return transform identifier, or NULL if this is not a transform change
 */
const char *omega_change_get_transform_id(const omega_change_t *change_ptr);

/**
 * Given a transform change, return the transform options JSON.
 * @param change_ptr transform change to inspect
 * @return options JSON, or NULL when not available
 */
const char *omega_change_get_transform_options_json(const omega_change_t *change_ptr);

/**
 * Given a transform change, return the replacement byte length produced by the transform.
 * @param change_ptr transform change to inspect
 * @return replacement byte length, or -1 if this is not a transform change
 */
int64_t omega_change_get_transform_replacement_length(const omega_change_t *change_ptr);

/**
 * Given a transform change, return the computed file size before the transform.
 * @param change_ptr transform change to inspect
 * @return computed file size before the transform, or -1 if this is not a transform change
 */
int64_t omega_change_get_transform_computed_file_size_before(const omega_change_t *change_ptr);

/**
 * Given a transform change, return the computed file size after the transform.
 * @param change_ptr transform change to inspect
 * @return computed file size after the transform, or -1 if this is not a transform change
 */
int64_t omega_change_get_transform_computed_file_size_after(const omega_change_t *change_ptr);

/**
 * Given a change, determine if this change is undone
 * @param change_ptr change to determine if it has been undone or not
 * @return non-zero if the change is undone, and zero otherwise
 */
int omega_change_is_undone(const omega_change_t *change_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_CHANGE_H
