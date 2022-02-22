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

#ifdef __cplusplus
#include <cstdint>
#include <cstdio>
extern "C" {
#else
#include <stdint.h>
#include <stdio.h>
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
 * @param file_name file name to check existence of
 * @return non-zero if the file exists, and zero otherwise
 */
int omega_util_file_exists(const char *file_name);

/**
 * Check if the given directory exists
 * @param path directory to check for the existence of
 * @return non-zero if the directory exists and zero otherwise
 */
int omega_util_directory_exists(const char *path);

/**
 * Create the given directory
 * @param path directory to create
 * @return zero if the path was created successfully and non-zero otherwise
 */
int omega_util_create_directory(char const *path);

/**
 * Remove the given file
 * @param path path to the fle to remove
 * @return zero if the file was removed successfully and non-zero otherwise
 */
int omega_util_remove_file(char const *path);

/**
 * Remove the given directory
 * @param path directory to remove
 * @return zero if the path was removed successfully and non-zero otherwise
 */
int omega_util_remove_directory(char const *path);

/**
 * Given a file path, return the file size
 * @param path path to get the file size of
 * @return file size
 */
int64_t omega_util_file_size(char const *path);

/**
 * Returns the directory separator character used on the host system
 * @return directory separator character used on the host system
 */
char omega_util_directory_separator();

/**
 * Given a file name, return the associated directory
 * @param path file path
 * @param buffer pointer to memory to hold the directory name (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return associated directory
 */
char *omega_util_dirname(char const *path, char *buffer);

/**
 * Given a file name, return the associated basename (filename without the directory) and if a matching suffix is given, the returned basename will have the suffix removed
 * @param path file path
 * @param buffer pointer to memory to hold the base name (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @param drop_suffix if non-zero, remove the suffix (file extension) from the path basename
 * @return associated basename, possibly without the suffix
 */
char *omega_util_basename(char const *path, char *buffer, int drop_suffix);

/**
 * Given a file name, return the associated file extension, with or without the dot prefix
 * @param path file path
 * @param buffer pointer to memory to hold the file extension (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return associated file extension or NULL if no extension exists
 */
char *omega_util_file_extension(char const *path, char *buffer);

/**
 * Given a path, which must exist, returns an absolute path that has no symbolic link, dot, or dot-dot elements
 * @param path path to get the absolute path of
 * @param buffer pointer to memory to hold the file extension (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return absolute path that has no symbolic link, dot, or dot-dot elements
 */
char *omega_util_normalize_path(char const *path, char *buffer);

/**
 * Generate a temporary file name based on tmpl.  The name constructed does not exist at the time of the call.
 * The tmpl parameter is overwritten with the result.
 * @param tmpl must match the rules for mk[s]temp (i.e. end in "XXXXXX")
 * @return read-write file descriptor opened with mode 0600 modulo umask or -1 with errno set on error
 */
int omega_util_mkstemp(char *tmpl);

/**
 * Creates a available filename from the given path
 * @param path desired path
 * @param buffer pointer to a buffer that can hold up to FILENAME_MAX bytes, or NULL to use an internal static buffer
 * @return a path that is currently available (insecure as the file may exist later at the time of attempted creation)
 */
char *omega_util_available_filename(char const *path, char *buffer);

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

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_UTILITY_H
