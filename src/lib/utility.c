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
#include <stdio.h>

#ifdef WINDOWS
#include <direct.h>
#define GetCurrentDir_ _getcwd
#else
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/fcntl.h>
#include <unistd.h>
#include <utime.h>
#define GetCurrentDir_ getcwd
#endif

const char *omega_util_get_current_dir(char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    buffer[0] = '\0';
    return (GetCurrentDir_(buffer, FILENAME_MAX)) ? buffer : NULL;
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
#if defined _WIN32 || defined __CYGWIN__
    return '\\';
#else
    return '/';
#endif
}

char *omega_util_dirname(char const *file_name, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold directory name
    assert(file_name);
    if (!buffer) { buffer = buff; }
    const char *last_slash = strrchr(file_name, '/');
    if (!last_slash) { last_slash = strrchr(file_name, '\\'); }
    if (last_slash) {
        const size_t num_bytes = last_slash - file_name;
        memcpy(buffer, file_name, num_bytes);
        buffer[num_bytes] = '\0';
    } else {
        buffer[0] = '.';
        buffer[1] = '\0';
    }
    return buffer;
}

char *omega_util_basename(char const *file_name, char const *suffix, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold basename
    size_t basename_len = 0;
    assert(file_name);
    if (!buffer) { buffer = buff; }
    const char *last_slash = strrchr(file_name, '/');
    if (!last_slash) { last_slash = strrchr(file_name, '\\'); }
    if (last_slash) {
        const char *basename = last_slash + 1;
        basename_len = strlen(basename);
        if (basename_len < 1) { return NULL; }
        memcpy(buffer, basename, basename_len + 1);
    } else {
        basename_len = strlen(file_name);
        memcpy(buffer, file_name, basename_len + 1);
    }
    if (suffix) {
        const size_t suffix_len = strlen(suffix);
        if (suffix_len < basename_len && 0 == strncmp(buffer + basename_len - suffix_len, suffix, suffix_len)) {
            buffer[basename_len - suffix_len] = '\0';
        }
    }
    return buffer;
}

char *omega_util_file_extension(char const *file_name, char *buffer, int include_dot) {
    static char buff[FILENAME_MAX];//create string buffer to hold extension
    char file_name_buff[FILENAME_MAX];
    file_name = omega_util_basename(file_name, NULL, file_name_buff);
    assert(file_name);
    if (!buffer) { buffer = buff; }
    const char *last_dot = strrchr(file_name, '.');
    if (last_dot) {
        const char *extension = (include_dot) ? last_dot : last_dot + 1;
        const size_t extension_len = strlen(extension);
        memcpy(buffer, extension, extension_len + 1);
        return buffer;
    }
    buffer[0] = '\0';
    return NULL;
}

char *omega_util_available_filename(char const *file_name, char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    assert(file_name);
    if (!buffer) { buffer = buff; }
    if (!omega_util_file_exists(file_name)) {
        memcpy(buffer, file_name, strlen(file_name) + 1);
        return buffer;
    }
    int i = 0;
    const char *dirname = omega_util_dirname(file_name, NULL);
    const char *extension = omega_util_file_extension(file_name, NULL, 1);
    const char *basename = omega_util_basename(file_name, extension, NULL);
    do {
        if (i == 99) {
            // stop after 99 copies
            return NULL;
        }
        snprintf(buffer, FILENAME_MAX, "%s%c%s-copy-%d%s", dirname, omega_util_directory_separator(), basename, ++i,
                 extension);
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
