/**********************************************************************************************************************
 * Copyright (c) 2021-2022 Concurrent Technologies Corporation.                                                       *
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

#ifdef __cplusplus
#include <cstdint>
extern "C" {
#else
#include <stdint.h>
#endif

/**
 * Gets the current working directory
 * @param buffer pointer to memory to hold the current working directory (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return current working directory or NULL on error
 */
const char *omega_util_get_current_dir(char *buffer);

/**
 * Touch the given file, optionally creating it f it does not exist
 * @param file_name flle name to touch
 * @param create if non-zero, create the file name if it does not exist
 * @return zero on success, non-zero on failure
 */
int omega_util_touch(const char *file_name, int create);

/**
 * Check if the given file name exists
 * @param file_name file name to check existence for
 * @return zero if the file does not exist, non-zero otherwise
 */
int omega_util_file_exists(const char *file_name);

/**
 * Returns the directory separator character used on the host system
 * @return directory separator character used on the host system
 */
char omega_util_directory_separator();

/**
 * Given a file name, return the associated directory
 * @param file_name file path
 * @param buffer pointer to memory to hold the current working directory (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return associated directory
 */
char *omega_util_dirname(char const *file_name, char *buffer);

/**
 * Given a file name, return the associated basename (filename without the directory) and if a matching suffix is given, the returned basename will have the suffix removed
 * @param file_name file path
 * @param suffix optional file suffix that if it matches the basename suffix, it is removed from the result
 * @param buffer pointer to memory to hold the current working directory (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return associated basename, possibly without the suffix
 */
char *omega_util_basename(char const *file_name, char const *suffix, char *buffer);

/**
 * Given a file name, return the associated file extension, with or without the dot prefix
 * @param file_name file path
 * @param buffer pointer to memory to hold the current working directory (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @param include_dot if zero, do not include the dot prefix, non-zero to include the dot prefix
 * @return associated file extension or NULL if no extension exists
 */
char *omega_util_file_extension(char const *file_name, char *buffer, int include_dot);

char *omega_util_available_filename(char const *file_name, char *buffer);

/**
 * Byte transform function pointer
 */
typedef omega_byte_t (*omega_util_byte_transform_t)(omega_byte_t);

/**
 * Apply the given transform to bytes in the given buffer
 * @param buffer buffer of bytes to apply the transform to
 * @param len number of bytes in the buffer to apply the transform to
 * @param transform transform function to apply to the bytes in the buffer
 */
void omega_util_byte_transformer(omega_byte_t *buffer, int64_t len, omega_util_byte_transform_t transform);

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

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_UTILITY_H
