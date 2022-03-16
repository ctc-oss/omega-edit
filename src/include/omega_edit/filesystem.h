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

#ifndef OMEGA_EDIT_FILESYSTEM_H
#define OMEGA_EDIT_FILESYSTEM_H

#include "export.h"

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
OMEGA_EDIT_EXPORT const char *omega_util_get_current_dir(char *buffer);

/**
 * Touch the given file, optionally creating it f it does not exist
 * @param file_name flle name to touch
 * @param create if non-zero, create the file name if it does not exist
 * @return zero on success, non-zero on failure
 */
OMEGA_EDIT_EXPORT int omega_util_touch(const char *file_name, int create);

/**
 * Check if the given file name exists
 * @param file_name file name to check existence of
 * @return non-zero if the file exists, and zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_util_file_exists(const char *file_name);

/**
 * Check if the given directory exists
 * @param path directory to check for the existence of
 * @return non-zero if the directory exists and zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_util_directory_exists(const char *path);

/**
 * Create the given directory
 * @param path directory to create
 * @return zero if the path was created successfully and non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_util_create_directory(char const *path);

/**
 * Remove the given file
 * @param path path to the fle to remove
 * @return zero if the file was removed successfully and non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_util_remove_file(char const *path);

/**
 * Remove the given directory
 * @param path directory to remove
 * @return zero if the path was removed successfully and non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_util_remove_directory(char const *path);

/**
 * Given a file path, return the file size
 * @param path path to get the file size of
 * @return file size
 */
OMEGA_EDIT_EXPORT int64_t omega_util_file_size(char const *path);

/**
 * Given two file paths, determine if they are equivalent
 * @param path1 first path
 * @param path2 second path
 * @return non-zero if the paths are equivalent and zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_util_paths_equivalent(char const *path1, char const *path2);

/**
 * Given a file name, return the associated basename (filename without the directory) and if a matching suffix is given, the returned basename will have the suffix removed
 * @param path file path
 * @param buffer pointer to memory to hold the base name (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @param drop_suffix if non-zero, remove the suffix (file extension) from the path basename
 * @return associated basename, possibly without the suffix
 */
OMEGA_EDIT_EXPORT char *omega_util_basename(char const *path, char *buffer, int drop_suffix);

/**
 * Given a file name, return the associated file extension, with or without the dot prefix
 * @param path file path
 * @param buffer pointer to memory to hold the file extension (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return associated file extension or NULL if no extension exists
 */
OMEGA_EDIT_EXPORT char *omega_util_file_extension(char const *path, char *buffer);

/**
 * Creates a available filename from the given path
 * @param path desired path
 * @param buffer pointer to a buffer that can hold up to FILENAME_MAX bytes, or NULL to use an internal static buffer
 * @return a path that is currently available (insecure as the file may exist later at the time of attempted creation)
 */
OMEGA_EDIT_EXPORT char *omega_util_available_filename(char const *path, char *buffer);

/**
 * Given a path, which must exist, returns an absolute path that has no symbolic link, dot, or dot-dot elements
 * @param path path to get the absolute path of
 * @param buffer pointer to memory to hold the file extension (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return absolute path that has no symbolic link, dot, or dot-dot elements
 */
OMEGA_EDIT_EXPORT char *omega_util_normalize_path(char const *path, char *buffer);

/**
 * Given a file name, return the associated directory
 * @param path file path
 * @param buffer pointer to memory to hold the directory name (allocated to at least FILENAME_MAX) or could be NULL, in which case an internal static buffer will be used
 * @return associated directory
 */
OMEGA_EDIT_EXPORT char *omega_util_dirname(char const *path, char *buffer);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_FILESYSTEM_H
