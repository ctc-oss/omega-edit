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

#include "../include/omega_edit/filesystem.h"
#include "../include/omega_edit/utility.h"
#include "impl_/macros.h"
#include <cassert>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

namespace fs = std::filesystem;

int omega_util_file_exists(const char *path) {
    assert(path);
    return (fs::is_regular_file(path)) ? 1 : 0;
}

int omega_util_directory_exists(const char *path) {
    assert(path);
    return (fs::is_directory(path)) ? 1 : 0;
}

int omega_util_create_directory(char const *path) {
    assert(path);
    return (fs::create_directories(path)) ? 0 : 1;
}

int omega_util_remove_file(char const *path) {
    assert(path);
    return (fs::is_regular_file(path) && fs::remove(path)) ? 0 : -1;
}

int omega_util_remove_directory(char const *path) {
    assert(path);
    return (fs::is_directory(path) && fs::remove(path)) ? 0 : -1;
}

uint64_t omega_util_remove_all(char const *path) {
    assert(path);
    return fs::remove_all(path);
}

int64_t omega_util_file_size(char const *path) {
    assert(omega_util_file_exists(path));
    return static_cast<int64_t>(fs::file_size(path));
}

int omega_util_paths_equivalent(char const *path1, char const *path2) {
    assert(path1);
    assert(path2);
    return fs::equivalent(path1, path2) ? 1 : 0;
}

int omega_util_compare_modification_times(const char *path1, const char *path2) {
    assert(path1);
    assert(path2);
    const fs::path file1_path(path1);
    const fs::path file2_path(path2);

    try {
        const auto file1_time = fs::last_write_time(file1_path);
        const auto file2_time = fs::last_write_time(file2_path);

        if (file1_time > file2_time) return 1;
        else if (file1_time < file2_time) return -1;
    } catch (const fs::filesystem_error &ex) {
        LOG_ERROR("Error comparing modification times: " << ex.what());
        return -2;
    }
    return 0;
}

const char *omega_util_get_current_dir(char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const path = fs::current_path();
    auto const len = path.string().copy(buffer, FILENAME_MAX);
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_dirname(char const *path, char *buffer) {
    assert(path);
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const len = fs::path(path).parent_path().string().copy(buffer, FILENAME_MAX);
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_basename(char const *path, char *buffer, int drop_suffix) {
    assert(path);
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const len = drop_suffix ? fs::path(path).stem().string().copy(buffer, FILENAME_MAX)
                                 : fs::path(path).filename().string().copy(buffer, FILENAME_MAX);
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_file_extension(char const *path, char *buffer) {
    assert(path);
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const len = fs::path(path).extension().string().copy(buffer, FILENAME_MAX);
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_normalize_path(char const *path, char *buffer) {
    assert(path);
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const len = fs::absolute(fs::canonical(path)).string().copy(buffer, FILENAME_MAX);
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_available_filename(char const *path, char *buffer) {
    assert(path);
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    if (!omega_util_file_exists(path)) {
        memcpy(buffer, path, strlen(path) + 1);
        return buffer;
    }
    int i = 0;
    const std::string dirname(omega_util_dirname(path, nullptr));
    const std::string extension(omega_util_file_extension(path, nullptr));
    const std::string basename(omega_util_basename(path, nullptr, 1));
    do {
        if (++i >= 1000) {
            // stop after 999 filenames exist
            return nullptr;
        }
        auto const len = fs::path(dirname)
                .append(basename + "-" + std::to_string(i) + extension)
                .string()
                .copy(buffer, FILENAME_MAX);
        buffer[len] = '\0';
    } while (omega_util_file_exists(buffer));
    return buffer;
}

int omega_util_file_copy(const char *src_path, const char *dst_path, int mode) {
    assert(omega_util_file_exists(src_path));
    assert(dst_path && strlen(dst_path) > 0);

    // Convert paths to fs::path objects
    fs::path src_fs_path(src_path);
    fs::path dst_fs_path(dst_path);

    try {
        // Check if the source file exists
        if (!fs::exists(src_fs_path)) {
            LOG_ERROR("Source file '" << src_fs_path << "' does not exist");
            return -1;
        }

        // Check if the source path points to a regular file
        if (!fs::is_regular_file(src_fs_path)) {
            LOG_ERROR("Source path '" << src_fs_path << "' does not point to a regular file");
            return -2;
        }

        // Copy the file to the destination path, overwriting if it already exists
        if (!fs::copy_file(src_fs_path, dst_fs_path, fs::copy_options::overwrite_existing)) {
            LOG_ERROR("Error copying file '" << src_fs_path << "' to '" << dst_fs_path << "'");
            return -3;
        }

        // If the mode is 0, use the mode of the source file
        mode = (mode) ? mode : static_cast<int>(fs::status(src_fs_path).permissions());

        // Set the mode of the destination file
        fs::permissions(dst_fs_path, static_cast<fs::perms>(mode));
    } catch (const std::exception &ex) {
        LOG_ERROR("Error copying file '" << src_fs_path << "' to '" << dst_fs_path << "': " << ex.what());
        return -4;
    }
    return 0;
}

char *omega_util_get_temp_directory() {
    const auto temp_dir_path = fs::temp_directory_path();
    return omega_util_strndup(temp_dir_path.string().c_str(), temp_dir_path.string().length());
}

int omega_util_touch(const char *file_name, int create) {
    assert(file_name);

    // Create the file if it doesn't exist and the "create" flag is set
    if (!fs::exists(file_name)) {
        if (create) {
            std::ofstream ofs(file_name);
            if (!ofs.good()) {
                LOG_ERROR("Error creating file '" << file_name << "'");
                return -1;
            }
            ofs.close();
            return 0;
        }
        LOG_ERROR("File '" << file_name << "' does not exist");
        return -2;
    } else {
        try {
            // update the file's last modification time to the current time
            fs::last_write_time(file_name, fs::file_time_type::clock::now());
        } catch (const std::exception &ex) {
            LOG_ERROR("Error touching file '" << file_name << "': " << ex.what());
            return -3;
        }
    }
    return 0;
}

char omega_util_directory_separator() { return fs::path::preferred_separator; }
