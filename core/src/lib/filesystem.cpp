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
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <string>

namespace fs = std::filesystem;

int omega_util_mkstemp(char *tmpl, int mode) {
    assert(tmpl);

    static const char letters[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const size_t len = strlen(tmpl);
    if (len < 6 || strcmp(&tmpl[len - 6], "XXXXXX") != 0) {
        errno = EINVAL;
        return -1;
    }

    char *template_end = &tmpl[len - 6];
    assert(0 == strcmp(template_end, "XXXXXX"));

    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<size_t> dist(0, sizeof(letters) - 2);

    for (int count = 0; count < TMP_MAX; ++count) {
        for (size_t i = 0; i < 6; ++i) {
            assert(template_end[i] == 'X');
            template_end[i] = letters[dist(gen)];
        }

        mode = (mode) ? omega_util_compute_mode(mode) : omega_util_compute_mode(0600);
        int fd = OPEN(tmpl, O_RDWR | O_CREAT | O_EXCL, mode);
        if (fd != -1) {
            return fd;
        } else if (errno != EEXIST) {
            return -1;// If the error is not "File exists", give up.
        }
    }

    errno = EEXIST;
    return -2;// Exhausted all attempts
}

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

int omega_util_compare_files(const char *path1, const char *path2) {
    // Open the first file
    std::ifstream file1(path1, std::ios::binary);
    if (!file1) {
        LOG_ERROR("Error opening file: '" << path1 << "'");
        return -1;// Error opening the first file
    }

    // Open the second file
    std::ifstream file2(path2, std::ios::binary);
    if (!file2) {
        LOG_ERROR("Error opening file: '" << path2 << "'");
        return -2;// Error opening the second file
    }

    // Compare the files
    std::istreambuf_iterator<char> end, iter1(file1), iter2(file2);
    while (iter1 != end && iter2 != end) {
        if (*iter1 != *iter2) {
            return 1;// Files are not equal
        }
        ++iter1;
        ++iter2;
    }

    // Check if both files reached EOF
    return (iter1 == end && iter2 == end) ? 0 : 1;
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
        else if (file1_time < file2_time)
            return -1;
    } catch (const fs::filesystem_error &ex) {
        LOG_ERROR("Error comparing modification times: " << ex.what());
        return -2;
    }
    return 0;
}

const char *omega_util_get_current_dir(char *buffer) {
    static char buff[FILENAME_MAX]{};//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const path_str = fs::current_path().string();
    assert(0 < path_str.length());
    assert(FILENAME_MAX > path_str.length());
    auto const len = path_str.copy(buffer, path_str.length());
    assert(len == path_str.length());
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_dirname(char const *path, char *buffer) {
    assert(path);
    static char buff[FILENAME_MAX]{};//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const dirname_str = fs::path(path).parent_path().string();
    assert(0 <= dirname_str.length());
    assert(FILENAME_MAX > dirname_str.length());
    auto const len = dirname_str.copy(buffer, dirname_str.length());
    assert(len == dirname_str.length());
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_basename(char const *path, char *buffer, int drop_suffix) {
    assert(path);
    assert(0 < strlen(path));
    assert(FILENAME_MAX > strlen(path));
    static char buff[FILENAME_MAX]{};//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const basename_str = (drop_suffix == 0) ? fs::path(path).filename().string() : fs::path(path).stem().string();
    auto const len = basename_str.copy(buffer, basename_str.length());
    assert(len == basename_str.length());
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_file_extension(char const *path, char *buffer) {
    assert(path);
    static char buff[FILENAME_MAX]{};//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const path_str = fs::path(path).extension().string();
    assert(0 <= path_str.length());
    assert(FILENAME_MAX > path_str.length());
    auto const len = path_str.copy(buffer, path_str.length());
    assert(len == path_str.length());
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_normalize_path(char const *path, char *buffer) {
    assert(path);
    static char buff[FILENAME_MAX]{};//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    auto const absolute_path_str = fs::absolute(fs::canonical(path)).string();
    assert(0 < absolute_path_str.length());
    assert(FILENAME_MAX > absolute_path_str.length());
    auto const len = absolute_path_str.copy(buffer, absolute_path_str.length());
    assert(len == absolute_path_str.length());
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_available_filename(char const *path, char *buffer) {
    assert(path);
    static char buff[FILENAME_MAX]{};//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    if (!omega_util_file_exists(path)) {
        // Use std::string instead of direct memcpy to properly handle multi-byte characters
        std::string path_str(path);
        path_str.copy(buffer, path_str.length());
        buffer[path_str.length()] = '\0';
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
        auto const filename_str = fs::path(dirname)
                .append(basename + "-" + std::to_string(i) + extension)
                .string();
        auto const len = filename_str.copy(buffer, filename_str.length());
        assert(len == filename_str.length());
        buffer[len] = '\0';
    } while (omega_util_file_exists(buffer));
    return buffer;
}

int omega_util_file_copy(const char *src_path, const char *dst_path, int mode) {
    assert(src_path && strlen(src_path) > 0);
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

        // Remove the destination file if it already exists
        if (fs::exists(dst_fs_path)) { fs::remove(dst_fs_path); }

        // Copy the file to the destination path, overwriting if it already exists
        if (!fs::copy_file(src_fs_path, dst_fs_path, fs::copy_options::overwrite_existing)) {
            LOG_ERROR("Error copying file '" << src_fs_path << "' to '" << dst_fs_path << "'");
            return -3;
        }

        // Set the modification time of the copied file to the current time
        auto now_file_time = fs::file_time_type::clock::now();
        fs::last_write_time(dst_fs_path, now_file_time);

        // Set the mode of the destination file (if the mode is 0, use the mode of the source file)
        fs::permissions(dst_fs_path, (mode) ? static_cast<fs::perms>(mode) : fs::status(src_fs_path).permissions());
    } catch (const fs::filesystem_error &ex) {
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

    if (!omega_util_file_exists(file_name)) {
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
            // Update the modification time of the file to the current time
            fs::last_write_time(file_name, fs::file_time_type::clock::now());
        } catch (const fs::filesystem_error &ex) {
            // Update failed, so try touching the file by appending to it
            std::ofstream ofs(file_name, std::ios::app);
            if (!ofs.good()) {
                // Append failed, so log the error and return an error code
                LOG_ERROR("Error touching existing file '" << file_name << "': " << ex.what());
                return -3;
            }
            ofs.close();
        }
    }
    return 0;
}

char omega_util_directory_separator() { return fs::path::preferred_separator; }
