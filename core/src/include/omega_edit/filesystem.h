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
 * @file filesystem.h
 * @brief Filesystem functions.
 */

#ifndef OMEGA_EDIT_FILESYSTEM_H
#define OMEGA_EDIT_FILESYSTEM_H

#ifdef __cplusplus

#include <cstdint>

extern "C" {
#else

#include <stdint.h>

#endif

/**
 * Generate a temporary file name based on tmpl.  The name constructed does not exist at the time of the call.
 * The tmpl parameter is overwritten with the result.
 * @param tmpl must match the rules for mk[s]temp (i.e. end in "XXXXXX")
 * @param mode mode to set the file to, if zero then the mode is set to 0600 modulo umask
 * @return read-write file descriptor opened with mode 0600 modulo umask or -1 with errno set on error
 */
int omega_util_mkstemp(char *tmpl, int mode);

/**
 * Gets the current working directory
 * @param buffer pointer to memory to hold the current working directory (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return current working directory or NULL on error
 */
const char *omega_util_get_current_dir(char *buffer);

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
 * Remove the given path, whether it is a file or directory
 * @param path directory or file to remove
 * @return number of files removed
 */
uint64_t omega_util_remove_all(char const *path);

/**
 * Given a file path, return the file size
 * @param path path to get the file size of
 * @return file size
 */
int64_t omega_util_file_size(char const *path);

/**
 * Given two file paths, determine if they are equivalent
 * @param path1 first path
 * @param path2 second path
 * @return non-zero if the paths are equivalent and zero otherwise
 */
int omega_util_paths_equivalent(char const *path1, char const *path2);

/**
 * Compare the contents of two files
 * @param path1 first path
 * @param path2 second path
 * @return 0 if the contents are equal, 1 if the contents are not equal, or -1 if an error occurred opening the file at path1 or -2 if an error occurred opening the file at path2
 */
int omega_util_compare_files(const char *path1, const char *path2);

/**
 * Compare the modification times of two files
 * @param path1 first path
 * @param path2 second path
 * @return 0 if the modification times are equal, -1 if the modification time of path1 is less than path2, 1 if the modification time of path1 is greater than path2, or -2 if an error occurred
 */
int omega_util_compare_modification_times(const char *path1, const char *path2);

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
 * Creates a available filename from the given path
 * @param path desired path
 * @param buffer pointer to a buffer that can hold up to FILENAME_MAX bytes, or NULL to use an internal static buffer
 * @return a path that is currently available (insecure as the file may exist later at the time of attempted creation)
 */
char *omega_util_available_filename(char const *path, char *buffer);

/**
 * Given a path, which must exist, returns an absolute path that has no symbolic link, dot, or dot-dot elements
 * @param path path to get the absolute path of
 * @param buffer pointer to memory to hold the file extension (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return absolute path that has no symbolic link, dot, or dot-dot path elements
 */
char *omega_util_normalize_path(char const *path, char *buffer);

/**
 * Given a file name, return the associated directory
 * @param path file path
 * @param buffer pointer to memory to hold the directory name (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return associated directory
 */
char *omega_util_dirname(char const *path, char *buffer);

/**
 * Copy the file at the given source path to the given destination path
 * @param src_path source path
 * @param dst_path destination path
 * @param mode mode to set the destination file to, if zero then the mode of the source file is used
 * @return zero on success, non-zero on failure
 */
int omega_util_file_copy(const char *src_path, const char *dst_path, int mode);

/**
 * Try to get the temporary directory for the host system
 * @return temporary directory for the host system allocated by malloc (must be free'd by the caller), or NULL on error
 */
char *omega_util_get_temp_directory();

/**
 * Touch the given file, optionally creating it if it does not exist
 * @param file_name flle name to touch
 * @param create if non-zero, create the file name if it does not exist
 * @return zero on success, non-zero on failure
 */
int omega_util_touch(const char *file_name, int create);

/**
 * Returns the directory separator character used on the host system
 * @return directory separator character used on the host system
 */
char omega_util_directory_separator();

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_FILESYSTEM_H
