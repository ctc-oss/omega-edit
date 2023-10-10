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
 * @file utility.h
 * @brief Various utility functions.
 */

#ifndef OMEGA_EDIT_UTILITY_H
#define OMEGA_EDIT_UTILITY_H

#include "byte.h"
#include "filesystem.h"
#include "fwd_defs.h"

#ifdef __cplusplus

#include <cstdint>
#include <cstdio>

extern "C" {
#else

#include <stdint.h>
#include <stdio.h>

#endif

/**
 * Returns the file mode modulo umask
 * @param mode file mode
 * @return file mode modulo umask
 */
int omega_util_compute_mode(int mode);

/**
 * Generate a temporary file name based on tmpl.  The name constructed does not exist at the time of the call.
 * The tmpl parameter is overwritten with the result.
 * @param tmpl must match the rules for mk[s]temp (i.e. end in "XXXXXX")
 * @param mode mode to set the file to, if zero then the mode is set to 0600 modulo umask
 * @return read-write file descriptor opened with mode 0600 modulo umask or -1 with errno set on error
 */
int omega_util_mkstemp(char *tmpl, int mode);

/**
 * Write a segment from one file into another file
 * @param from_file_ptr from file pointer, opened for read
 * @param offset where in the from file to begin reading from
 * @param byte_count number of bytes to read from the from file starting at the given offset
 * @param to_file_ptr to file pointer, opened for writing and positioned to where to write the segment to
 * @return number of bytes that where successfully written
 */
int64_t omega_util_write_segment_to_file(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr);

/**
 * Shift the bits of the given buffer by a given number of bits to the left
 * @param buffer pointer to the start of the buffer
 * @param len length of the buffer
 * @param shift_left number of bits (greater than 0 and less than 8) to shift to the left
 * @return zero on success, non-zero on failure
 */
int omega_util_left_shift_buffer(omega_byte_t *buffer, int64_t len, omega_byte_t shift_left);

/**
 * Shift the bits of the given buffer by a given number of bits to the right
 * @param buffer pointer to the start of the buffer
 * @param len length of the buffer
 * @param shift_right number of bits (greater than 0 and less than 8) to shift to the right
 * @return zero on success, non-zero on failure
 */
int omega_util_right_shift_buffer(omega_byte_t *buffer, int64_t len, omega_byte_t shift_right);

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
void omega_util_apply_byte_transform(omega_byte_t *buffer, int64_t len, omega_util_byte_transform_t transform,
                                     void *user_data_ptr);

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
int omega_util_apply_byte_transform_to_file(char const *in_path, char const *out_path,
                                            omega_util_byte_transform_t transform, void *user_data_ptr, int64_t offset,
                                            int64_t length);

/**
 * Apply the given mask of the given mask kind to the given byte
 * @param byte byte to mask
 * @param mask mask to apply
 * @param mask_kind mask kind (e.g., MASK_AND, MASK_OR, MASK_XOR)
 * @return masked byte
 */
omega_byte_t omega_util_mask_byte(omega_byte_t byte, omega_byte_t mask, omega_mask_kind_t mask_kind);

/**
 * Compares sz bytes of two character strings
 * @param s1 first character string
 * @param s2 second character string
 * @param sz number of bytes to compare
 * @return zero if sz bytes of the two character strings match, non-zero otherwise
 */
int omega_util_strncmp(const char *s1, const char *s2, uint64_t sz);

/**
 * Compares sz bytes of two character strings, without regard to case (case insensitive)
 * @param s1 first character string
 * @param s2 second character string
 * @param sz number of bytes to compare
 * @return zero if sz bytes of the two character strings match, non-zero otherwise
 */
int omega_util_strnicmp(const char *s1, const char *s2, uint64_t sz);

/**
 * Cross-platform strndup work-alike
 * @param s string to duplicate
 * @param n length of the string to duplicate
 * @return duplicated , null terminated string, allocated with malloc, or NULL on failure
 */
char *omega_util_strndup(const char *s, size_t n);

/**
 * Cross-platform memrchr work-alike
 * @param s memory to search
 * @param c byte to search for
 * @param n number of bytes to search
 */
const void *omega_util_memrchr(const void *s, int c, size_t n);

/**
 * Detect the byte order mark (BOM) of the given memory
 * @param data memory to detect the BOM of
 * @param length length of the memory to detect the BOM of
 * @return BOM_NONE if no BOM is detected, otherwise the detected BOM
 */
omega_bom_t omega_util_detect_BOM_from_memory(const unsigned char *data, size_t length);

/**
 * Detect the byte order mark (BOM) of the given file
 * @param filename path of the file to detect the BOM of
 * @return BOM_NONE if no BOM is detected, otherwise the detected BOM
 */
omega_bom_t omega_util_detect_BOM_from_file(const char *filename);

/**
 * Convert the given byte order mark (BOM) to a string
 * @param bom byte order mark (BOM) to convert
 * @return string representation of the given BOM ("none", "UTF-8", "UTF-16LE", "UTF-16BE", "UTF-32LE", "UTF-32BE")
 */
char const *omega_util_BOM_to_string(omega_bom_t bom);

omega_bom_t omega_util_string_to_BOM(char const *str);

/**
 * Count the number of single byte, and multi-byte characters in the given data
 * @param data data to count the characters in
 * @param length length of the data
 * @param counts_ptr pointer to the character counts to populate
 * @note make sure the BOM is set in the given character counts before calling this function
 */
void omega_util_count_characters(const unsigned char *data, size_t length, omega_character_counts_t *counts_ptr);

/**
 * Byte buffer
 */
typedef struct {
    /** The data in the buffer */
    const omega_byte_t *data;

    /** The length of the buffer */
    size_t length;
} omega_byte_buffer_t;

/**
 * Given a byte order mark (BOM), return the size of the byte order mark (BOM) in bytes
 * @param bom byte order mark (BOM) to get the size of
 * @return size of the byte order mark (BOM) in bytes
 */
size_t omega_util_BOM_size(omega_bom_t bom);

/**
 * Get the byte order mark buffer (BOM) associated with the given byte order mark (BOM)
 * @param bom byte order mark (BOM) to get
 * @return byte buffer containing the given BOM, or NULL if the given BOM is BOM_NONE
 */
const omega_byte_buffer_t *omega_util_BOM_to_buffer(omega_bom_t bom);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_UTILITY_H
