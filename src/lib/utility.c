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

#include "../include/omega_edit/utility.h"
#include "impl_/macros.h"
#include <assert.h>
#include <cwalk.h>
#include <stdio.h>

#ifdef OMEGA_BUILD_WINDOWS
#include <direct.h>
#include <fcntl.h>
#include <io.h>
#include <sys/utime.h>
#define utime _utime
#define getcwd _getcwd
#define open _open
#define close _close
#define O_RDWR _O_RDWR
#define O_CREAT _O_CREAT
#else
#include <errno.h>
#include <string.h>
#include <sys/fcntl.h>
#include <unistd.h>
#include <utime.h>
#endif

const char *omega_util_get_current_dir(char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    buffer[0] = '\0';
    return (getcwd(buffer, FILENAME_MAX)) ? buffer : NULL;
}

int omega_util_touch(const char *file_name, int create) {
    int fd = open(file_name, (create) ? O_RDWR | O_CREAT : O_RDWR, 0644);
    if (fd < 0) {
        if (!create && errno == ENOENT) {
            return 0;
        } else {
            DBG(perror("omega_util_touch"););
            return -1;
        }
    }
    close(fd);
    if (utime(file_name, NULL)) {
        DBG(perror("omega_util_touch"););
        return -1;
    }
    return 0;
}

int omega_util_file_exists(const char *file_name) {
    assert(file_name);
    FILE *file_ptr = fopen(file_name, "r");
    if (file_ptr) {
        fclose(file_ptr);
        return 1;
    }
    return 0;
}

char omega_util_directory_separator() {
#ifdef OMEGA_BUILD_WINDOWS
    return '\\';
#else
    return '/';
#endif
}

char *omega_util_dirname(char const *path, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold directory name
    assert(path);
    if (!buffer) { buffer = buff; }
    size_t dirname_len;
    cwk_path_get_dirname(path, &dirname_len);
    memcpy(buffer, path, dirname_len);
    buffer[dirname_len] = '\0';
    return buffer;
}

char *omega_util_basename(char const *path, char const *suffix, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold basename
    assert(path);
    if (!buffer) { buffer = buff; }
    const char *basename;
    size_t basename_len;
    cwk_path_get_basename(path, &basename, &basename_len);
    if (!basename) { return NULL; }
    memcpy(buffer, basename, basename_len);
    buffer[basename_len] = '\0';
    if (suffix) {
        const size_t suffix_len = strlen(suffix);
        if (suffix_len < basename_len && 0 == strncmp(buffer + basename_len - suffix_len, suffix, suffix_len)) {
            buffer[basename_len - suffix_len] = '\0';
        }
    }
    return buffer;
}

char *omega_util_file_extension(char const *path, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold extension
    char file_name_buff[FILENAME_MAX];
    path = omega_util_basename(path, NULL, file_name_buff);
    assert(path);
    if (!buffer) { buffer = buff; }
    const char *extension;
    size_t extension_len;
    if (cwk_path_get_extension(path, &extension, &extension_len)) {
        memcpy(buffer, extension, extension_len);
        buffer[extension_len] = '\0';
        return buffer;
    }
    buffer[0] = '\0';
    return NULL;
}

char *omega_util_normalize_path(char const *path, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    assert(path);
    if (!buffer) { buffer = buff; }
    cwk_path_normalize(path, buffer, FILENAME_MAX);
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
    const char *basename = omega_util_basename(path, extension, NULL);
    do {
        if (i == 99) {
            // stop after 99 filenames exist
            return NULL;
        }
        snprintf(buffer, FILENAME_MAX, "%s%s-%d%s", dirname, basename, ++i, extension);
    } while (omega_util_file_exists(buffer));
    return buffer;
}

void omega_util_byte_transformer(omega_byte_t *buffer, int64_t len, omega_util_byte_transform_t transform) {
    assert(buffer);
    int64_t i;
    for (i = 0; i < len; ++i) { buffer[i] = transform(buffer[i]); }
}

int omega_util_left_shift_buffer(omega_byte_t *buffer, int64_t len, omega_byte_t shift_left) {
    assert(buffer);
    if (shift_left > 0 && shift_left < 8) {
        omega_byte_t shift_right = 8 - shift_left;
        omega_byte_t mask = ((1 << shift_left) - 1) << shift_right;
        omega_byte_t bits1 = 0;
        int64_t i;
        for (i = len - 1; i >= 0; --i) {
            const unsigned char bits2 = buffer[i] & mask;
            buffer[i] <<= shift_left;
            buffer[i] |= bits1 >> shift_right;
            bits1 = bits2;
        }
        return 0;
    }
    return -1;
}

int omega_util_right_shift_buffer(omega_byte_t *buffer, int64_t len, omega_byte_t shift_right) {
    assert(buffer);
    if (shift_right > 0 && shift_right < 8) {
        omega_byte_t shift_left = 8 - shift_right;
        omega_byte_t mask = (1 << shift_right) - 1;
        omega_byte_t bits1 = 0;
        int64_t i;
        for (i = len - 1; i >= 0; --i) {
            const unsigned char bits2 = buffer[i] & mask;
            buffer[i] >>= shift_right;
            buffer[i] |= bits1 << shift_left;
            bits1 = bits2;
        }
        return 0;
    }
    return -1;
}
