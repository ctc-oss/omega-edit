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
 * @file segment.h
 * @brief Functions that create and operate on segments (omega_segment_t).
 */

#ifndef OMEGA_EDIT_SEGMENT_H
#define OMEGA_EDIT_SEGMENT_H

#include "byte.h"
#include "export.h"
#include "fwd_defs.h"

#ifdef __cplusplus
#include <cstddef>
#include <cstdint>
extern "C" {
#else
#include <stddef.h>
#include <stdint.h>
#endif

/**
 * Create a segment with the given capacity
 * @param capacity desired capacity of the segment, must be greater then zero
 * @return segment of the desired capacity
 */
OMEGA_EDIT_EXPORT omega_segment_t *omega_segment_create(int64_t capacity);

/**
 * Gets the capacity of the segment
 * @param segment_ptr segment to get the capacity from
 * @return given segment's capacity
 */
OMEGA_EDIT_EXPORT int64_t omega_segment_get_capacity(const omega_segment_t *segment_ptr);

/**
 * Gets the length of a populated segment
 * @param segment_ptr populated segment to get the length from
 * @return given segment's length
 */
OMEGA_EDIT_EXPORT int64_t omega_segment_get_length(const omega_segment_t *segment_ptr);

/**
 * Gets the offset of a populated segment
 * @param segment_ptr populated segment to get the offset from
 * @return given segment's offset, or a negative number if the segment is not populated
 */
OMEGA_EDIT_EXPORT int64_t omega_segment_get_offset(const omega_segment_t *segment_ptr);

/**
 * Gets the offset adjustment of a populated segment
 * @param segment_ptr populated segment to get the offset adjustment from
 * @return given segment's offset adjustment
 */
OMEGA_EDIT_EXPORT int64_t omega_segment_get_offset_adjustment(const omega_segment_t *segment_ptr);

/**
 * Gets the data in a populated segment (data in the segment is a copy, not a reference)
 * @param segment_ptr populated segment to get the offset from
 * @return given segment's data, or null if the segment is not populated
 */
OMEGA_EDIT_EXPORT omega_byte_t *omega_segment_get_data(omega_segment_t *segment_ptr);

/**
 * Destroy the given segment
 * @param segment_ptr segment to destroy
 */
OMEGA_EDIT_EXPORT void omega_segment_destroy(omega_segment_t *segment_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_SEGMENT_H
