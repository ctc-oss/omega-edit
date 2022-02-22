/**********************************************************************************************************************
 * Copyright (c) 2022 Concurrent Technologies Corporation.                                                            *
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

#include "impl_/macros.h"
#include "omega_edit/utility.h"
#include <assert.h>
#include <boost/filesystem.hpp>

namespace fs = boost::filesystem;

int omega_util_file_exists(const char *path) { return (fs::is_regular_file(path)) ? 1 : 0; }

int omega_util_directory_exists(const char *path) { return (fs::is_directory(path)) ? 1 : 0; }

int omega_util_create_directory(char const *path) { return (fs::create_directories(path)) ? 0 : 1; }

int omega_util_remove_file(char const *path) { return (fs::remove(path)) ? 0 : 1; }

int omega_util_remove_directory(char const *path) { return (fs::remove(path)) ? 0 : 1; }

int64_t omega_util_get_filesize(char const *path) { return static_cast<int64_t>(fs::file_size(path)); }

const char *omega_util_get_current_dir(char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const path = fs::current_path();
    auto const len = path.string().copy(buffer, FILENAME_MAX);
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_dirname(char const *path, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const len = fs::path(path).parent_path().string().copy(buffer, FILENAME_MAX);
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_basename(char const *path, char *buffer, int drop_suffix) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const len = (drop_suffix) ? fs::path(path).stem().string().copy(buffer, FILENAME_MAX)
                                   : fs::path(path).filename().string().copy(buffer, FILENAME_MAX);
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_file_extension(char const *path, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const len = fs::path(path).extension().string().copy(buffer, FILENAME_MAX);
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_normalize_path(char const *path, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const len = fs::absolute(fs::canonical(path)).string().copy(buffer, FILENAME_MAX);
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_available_filename(char const *path, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    assert(path);
    if (!buffer) { buffer = buff; }
    if (!omega_util_file_exists(path)) {
        memcpy(buffer, path, strlen(path) + 1);
        return buffer;
    }
    int i = 0;
    const char *dirname = omega_util_dirname(path, NULL);
    const char *extension = omega_util_file_extension(path, NULL);
    const std::string basename = omega_util_basename(path, NULL, 1);
    do {
        if (++i == 99) {
            // stop after 99 filenames exist
            return NULL;
        }
        auto const len = fs::path(dirname)
                                 .append(basename + "-" + std::to_string(i) + extension)
                                 .string()
                                 .copy(buffer, FILENAME_MAX);
        buffer[len] = '\0';
    } while (omega_util_file_exists(buffer));
    return buffer;
}