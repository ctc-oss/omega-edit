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

#if defined(__APPLE__)
#include <sys/clonefile.h>
#include <sys/stat.h>
#elif defined(__linux__)
#include <fcntl.h>
#include <linux/fs.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <unistd.h>
#ifndef FICLONE
#define FICLONE _IOW(0x94, 9, int)
#endif
#elif !defined(OMEGA_BUILD_WINDOWS)
#include <sys/stat.h>
#endif

namespace fs = std::filesystem;

namespace {
    constexpr int OMEGA_AVAILABLE_FILENAME_SUFFIX_ATTEMPTS = 1000000;

    auto try_clone_file_(const fs::path &src_path, const fs::path &dst_path, int mode) -> bool {
#if defined(__APPLE__)
        if (0 == clonefile(src_path.c_str(), dst_path.c_str(), 0)) { return true; }
        try {
            if (fs::exists(dst_path)) { fs::remove(dst_path); }
        } catch (const fs::filesystem_error &) {}
        return false;
#elif defined(__linux__)
        const auto src_path_str = src_path.string();
        const auto dst_path_str = dst_path.string();
        const auto src_fd = OPEN(src_path_str.c_str(), O_RDONLY, 0);
        if (src_fd < 0) { return false; }

        const auto dst_mode = mode ? (mode & 07777) : 0600;
        const auto dst_fd = OPEN(dst_path_str.c_str(), O_WRONLY | O_CREAT | O_TRUNC, dst_mode);
        if (dst_fd < 0) {
            close(src_fd);
            return false;
        }

        const auto cloned = (0 == ioctl(dst_fd, FICLONE, src_fd));
        close(dst_fd);
        close(src_fd);
        if (!cloned) {
            try {
                if (fs::exists(dst_path)) { fs::remove(dst_path); }
            } catch (const fs::filesystem_error &) {}
        }
        return cloned;
#else
        (void) src_path;
        (void) dst_path;
        (void) mode;
        return false;
#endif
    }
}// namespace

int omega_util_mkstemp(char *tmpl, int mode) {
    if (!tmpl) {
        errno = EINVAL;
        return -1;
    }

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
        for (size_t i = 0; i < 6; ++i) { template_end[i] = letters[dist(gen)]; }

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
    if (!path || !*path) { return 0; }
    try {
        return (fs::is_regular_file(path)) ? 1 : 0;
    } catch (const fs::filesystem_error &) { return 0; }
}

int omega_util_directory_exists(const char *path) {
    if (!path || !*path) { return 0; }
    try {
        return (fs::is_directory(path)) ? 1 : 0;
    } catch (const fs::filesystem_error &) { return 0; }
}

int omega_util_create_directory(char const *path) {
    if (!path || !*path) { return -1; }
    try {
        return (fs::create_directories(path)) ? 0 : 1;
    } catch (const fs::filesystem_error &) { return -1; }
}

int omega_util_remove_file(char const *path) {
    if (!path || !*path) { return -1; }
    try {
        return (fs::is_regular_file(path) && fs::remove(path)) ? 0 : -1;
    } catch (const fs::filesystem_error &) { return -1; }
}

int omega_util_remove_directory(char const *path) {
    if (!path || !*path) { return -1; }
    try {
        return (fs::is_directory(path) && fs::remove(path)) ? 0 : -1;
    } catch (const fs::filesystem_error &) { return -1; }
}

uint64_t omega_util_remove_all(char const *path) {
    if (!path || !*path) { return 0; }
    try {
        return fs::remove_all(path);
    } catch (const fs::filesystem_error &) { return 0; }
}

int64_t omega_util_file_size(char const *path) {
    if (!path || !*path) { return -1; }
    try {
        return fs::is_regular_file(path) ? static_cast<int64_t>(fs::file_size(path)) : -1;
    } catch (const fs::filesystem_error &) { return -1; }
}

int omega_util_paths_equivalent(char const *path1, char const *path2) {
    if (!path1 || !*path1 || !path2 || !*path2) { return 0; }
    try {
        return fs::equivalent(path1, path2) ? 1 : 0;
    } catch (const fs::filesystem_error &) { return 0; }
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
    if (!path1 || !*path1 || !path2 || !*path2) { return -2; }
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

int omega_util_get_modification_time(const char *path, int64_t *modification_time_out) {
    if (!path || !*path || !modification_time_out) { return -1; }

    try {
        const auto file_time = fs::last_write_time(fs::path(path)).time_since_epoch();
        *modification_time_out = std::chrono::duration_cast<std::chrono::nanoseconds>(file_time).count();
    } catch (const fs::filesystem_error &ex) {
        LOG_ERROR("Error getting modification time for '" << path << "': " << ex.what());
        return -2;
    }
    return 0;
}

const char *omega_util_get_current_dir(char *buffer) {
    static thread_local char buff[FILENAME_MAX]{};
    if (!buffer) { buffer = buff; }
    auto const path_str = fs::current_path().string();
    if (path_str.empty() || path_str.length() >= FILENAME_MAX) { return nullptr; }
    auto const len = path_str.copy(buffer, path_str.length());
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_dirname(char const *path, char *buffer) {
    if (!path || !*path) { return nullptr; }
    static thread_local char buff[FILENAME_MAX]{};
    if (!buffer) { buffer = buff; }
    auto const dirname_str = fs::path(path).parent_path().string();
    if (dirname_str.length() >= FILENAME_MAX) { return nullptr; }
    auto const len = dirname_str.copy(buffer, dirname_str.length());
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_basename(char const *path, char *buffer, int drop_suffix) {
    if (!path || !*path) { return nullptr; }
    if (strlen(path) >= FILENAME_MAX) { return nullptr; }
    static thread_local char buff[FILENAME_MAX]{};
    if (!buffer) { buffer = buff; }
    auto const basename_str = (drop_suffix == 0) ? fs::path(path).filename().string() : fs::path(path).stem().string();
    if (basename_str.length() >= FILENAME_MAX) { return nullptr; }
    auto const len = basename_str.copy(buffer, basename_str.length());
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_file_extension(char const *path, char *buffer) {
    if (!path) { return nullptr; }
    static thread_local char buff[FILENAME_MAX]{};
    if (!buffer) { buffer = buff; }
    auto const path_str = fs::path(path).extension().string();
    if (path_str.length() >= FILENAME_MAX) { return nullptr; }
    auto const len = path_str.copy(buffer, path_str.length());
    buffer[len] = '\0';
    return buffer;
}

char *omega_util_normalize_path(char const *path, char *buffer) {
    if (!path) { return nullptr; }
    static thread_local char buff[FILENAME_MAX]{};
    if (!buffer) { buffer = buff; }
    try {
        auto const absolute_path_str = fs::absolute(fs::canonical(path)).string();
        if (absolute_path_str.empty() || absolute_path_str.length() >= FILENAME_MAX) { return nullptr; }
        auto const len = absolute_path_str.copy(buffer, absolute_path_str.length());
        buffer[len] = '\0';
        return buffer;
    } catch (const fs::filesystem_error &) { return nullptr; }
}

char *omega_util_available_filename(char const *path, char *buffer) {
    if (!path) { return nullptr; }
    static thread_local char buff[FILENAME_MAX]{};
    if (!buffer) { buffer = buff; }
    if (!omega_util_file_exists(path)) {
        // Use std::string instead of direct memcpy to properly handle multi-byte characters
        std::string path_str(path);
        size_t max_len = FILENAME_MAX - 1;// Reserve space for null-termination
        size_t utf8_len = 0;
        for (size_t i = 0; i < path_str.length() && utf8_len < max_len; ++i) {
            unsigned char c = static_cast<unsigned char>(path_str[i]);
            if (c < 0x80 || (c >= 0xC0 && c <= 0xF7)) {// Start of a UTF-8 character
                if (utf8_len + (c < 0x80 ? 1 : (c < 0xE0 ? 2 : (c < 0xF0 ? 3 : 4))) > max_len) {
                    break;// Stop if adding this character exceeds max_len
                }
            }
            ++utf8_len;
        }
        std::string truncated_path = path_str.substr(0, utf8_len);
        truncated_path.copy(buffer, truncated_path.length());
        buffer[truncated_path.length()] = '\0';// Ensure null-termination
        return buffer;
    }
    int i = 0;
    const char *dirname_cstr = omega_util_dirname(path, nullptr);
    const char *extension_cstr = omega_util_file_extension(path, nullptr);
    const char *basename_cstr = omega_util_basename(path, nullptr, 1);
    if (!dirname_cstr || !extension_cstr || !basename_cstr) { return nullptr; }
    const std::string dirname(dirname_cstr);
    const std::string extension(extension_cstr);
    const std::string basename(basename_cstr);
    do {
        if (++i >= OMEGA_AVAILABLE_FILENAME_SUFFIX_ATTEMPTS) { return nullptr; }
        auto const filename_str = fs::path(dirname).append(basename + "-" + std::to_string(i) + extension).string();
        auto const len = filename_str.copy(buffer, filename_str.length());
        assert(len == filename_str.length());
        buffer[len] = '\0';
    } while (omega_util_file_exists(buffer));
    return buffer;
}

int omega_util_file_copy(const char *src_path, const char *dst_path, int mode) {
    if (!src_path || !*src_path || !dst_path || !*dst_path) { return -1; }

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

        // Prefer copy-on-write clones/reflinks where the platform and filesystem support them.
        if (!try_clone_file_(src_fs_path, dst_fs_path, mode)) {
            if (!fs::copy_file(src_fs_path, dst_fs_path, fs::copy_options::overwrite_existing)) {
                LOG_ERROR("Error copying file '" << src_fs_path << "' to '" << dst_fs_path << "'");
                return -3;
            }
        }

        // Set the modification time of the copied file to the current time
        auto now_file_time = fs::file_time_type::clock::now();
        fs::last_write_time(dst_fs_path, now_file_time);

        // Set the mode of the destination file (if the mode is 0, use the mode of the source file)
        fs::permissions(dst_fs_path,
                        (mode) ? static_cast<fs::perms>(mode & 07777) : fs::status(src_fs_path).permissions(),
                        fs::perm_options::replace);
#ifndef OMEGA_BUILD_WINDOWS
        if (mode && chmod(dst_path, static_cast<mode_t>(mode & 07777)) != 0) { return -4; }
#endif
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
    if (!file_name) { return -1; }

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
            const auto previous_time = fs::last_write_time(file_name);
            auto next_time = fs::file_time_type::clock::now();
            if (next_time <= previous_time) { next_time = previous_time + std::chrono::seconds(1); }
            fs::last_write_time(file_name, next_time);
            if (fs::last_write_time(file_name) <= previous_time) {
                fs::last_write_time(file_name, previous_time + std::chrono::seconds(1));
            }
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
