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

#ifndef OMEGA_EDIT_UTILITY_H
#define OMEGA_EDIT_UTILITY_H

#include "byte.h"
#include "export.h"
#include "filesystem.h"

#ifdef __cplusplus
#include <cstdint>
#include <cstdio>
extern "C" {
#else
#include <stdint.h>
#include <stdio.h>
#endif

/**
 * Returns the directory separator character used on the host system
 * @return directory separator character used on the host system
 */
OMEGA_EDIT_EXPORT char omega_util_directory_separator();

/**
 * Generate a temporary file name based on tmpl.  The name constructed does not exist at the time of the call.
 * The tmpl parameter is overwritten with the result.
 * @param tmpl must match the rules for mk[s]temp (i.e. end in "XXXXXX")
 * @return read-write file descriptor opened with mode 0600 modulo umask or -1 with errno set on error
 */
OMEGA_EDIT_EXPORT int omega_util_mkstemp(char *tmpl);

/**
 * Write a segment from one file into another file
 * @param from_file_ptr from file pointer, opened for read
 * @param offset where in the from file to begin reading from
 * @param byte_count number of bytes to read from the from file starting at the given offset
 * @param to_file_ptr to file pointer, opened for writing and positioned to where to write the segment to
 * @return number of bytes that where successfully written
 */
OMEGA_EDIT_EXPORT int64_t omega_util_write_segment_to_file(FILE *from_file_ptr, int64_t offset, int64_t byte_count,
                                                           FILE *to_file_ptr);

/**
 * Shift the bits of the given buffer by a given number of bits to the left
 * @param buffer pointer to the start of the buffer
 * @param len length of the buffer
 * @param shift_left number of bits (greater than 0 and less than 8) to shift to the left
 * @return zero on success, non-zero on failure
 */
OMEGA_EDIT_EXPORT int omega_util_left_shift_buffer(omega_byte_t *buffer, int64_t len, omega_byte_t shift_left);

/**
 * Shift the bits of the given buffer by a given number of bits to the right
 * @param buffer pointer to the start of the buffer
 * @param len length of the buffer
 * @param shift_right number of bits (greater than 0 and less than 8) to shift to the right
 * @return zero on success, non-zero on failure
 */
OMEGA_EDIT_EXPORT int omega_util_right_shift_buffer(omega_byte_t *buffer, int64_t len, omega_byte_t shift_right);

/**
 * Mask types
 */
typedef enum { MASK_AND, MASK_OR, MASK_XOR } omega_mask_kind_t;

/**
 * Byte transform function pointer
 */
typedef omega_byte_t (*omega_util_byte_transform_t)(omega_byte_t, void *user_data);

/**
 * Apply the given transform to bytes in the given buffer
 * @param buffer buffer of bytes to apply the transform to
 * @param len number of bytes in the buffer to apply the transform to
 * @param transform transform function to apply to the bytes in the buffer
 * @param user_data_ptr pointer to user-defined data to associate with the transformer
 */
OMEGA_EDIT_EXPORT void omega_util_apply_byte_transform(omega_byte_t *buffer, int64_t len,
                                                       omega_util_byte_transform_t transform, void *user_data_ptr);

/**
 * Apply the given transform to the input file and write the transformed data to the output file
 * @param in_path path of the file to apply the transform to
 * @param out_path path of the file to write the transformed data to
 * @param transform byte transform function to apply
 * @param user_data_ptr pointer to user-defined data to associate with the transformer
 * @param offset where to begin transforming bytes
 * @param length number of bytes to transform from the given offset
 * @return zero on success, non-zero on failure
 */
OMEGA_EDIT_EXPORT int omega_util_apply_byte_transform_to_file(char const *in_path, char const *out_path,
                                                              omega_util_byte_transform_t transform,
                                                              void *user_data_ptr, int64_t offset, int64_t length);

/**
 * Apply the given mask of the given mask kind to the given byte
 * @param byte byte to mask
 * @param mask mask to apply
 * @param mask_kind mask kind (e.g., MASK_AND, MASK_OR, MASK_XOR)
 * @return masked byte
 */
OMEGA_EDIT_EXPORT omega_byte_t omega_util_mask_byte(omega_byte_t byte, omega_byte_t mask, omega_mask_kind_t mask_kind);

/**
 * Compares sz bytes of two character strings
 * @param s1 first character string
 * @param s2 second character string
 * @param sz number of bytes to compare
 * @return zero if sz bytes of the two character strings match, non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_util_strncmp(const char *s1, const char *s2, uint64_t sz);

/**
 * Compares sz bytes of two character strings, without regard to case (case insensitive)
 * @param s1 first character string
 * @param s2 second character string
 * @param sz number of bytes to compare
 * @return zero if sz bytes of the two character strings match, non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_util_strnicmp(const char *s1, const char *s2, uint64_t sz);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_UTILITY_H
