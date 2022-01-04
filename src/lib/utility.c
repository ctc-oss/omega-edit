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
#include <assert.h>
#include <stdio.h>

#ifdef WINDOWS
#include <direct.h>
#define GetCurrentDir_ _getcwd
#else
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#define GetCurrentDir_ getcwd
#endif

const char *omega_util_get_current_dir(char *buffer) {
    static char buff[FILENAME_MAX];//create string buffer to hold path
    if (!buffer) { buffer = buff; }
    buffer[0] = '\0';
    return (GetCurrentDir_(buffer, FILENAME_MAX)) ? buffer : NULL;
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
    static char buff[FILENAME_MAX];//create string buffer to hold path
    assert(file_name);
    if (!buffer) { buffer = buff; }
    const char *last_slash = strrchr(file_name, '/');
    if (!last_slash) { last_slash = strrchr(file_name, '\\'); }
    if (last_slash) {
        const size_t num_bytes = last_slash - file_name;
        memcpy(buffer, file_name, num_bytes);
        buffer[num_bytes] = '\0';
        return buffer;
    }
    buffer[0] = '\0';
    return NULL;
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
