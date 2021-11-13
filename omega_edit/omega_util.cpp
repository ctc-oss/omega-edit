/*
 * Copyright 2021 Concurrent Technologies Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include "omega_util.h"

int left_shift_buffer(uint8_t *buffer, int64_t len, uint8_t shift_left) {
    if (shift_left > 0 && shift_left < 8) {
        uint8_t shift_right = 8 - shift_left;
        uint8_t mask = ((1 << shift_left) - 1) << shift_right;
        uint8_t bits1 = 0;
        for (auto i = len - 1; i >= 0; --i) {
            const auto bits2 = buffer[i] & mask;
            buffer[i] <<= shift_left;
            buffer[i] |= bits1 >> shift_right;
            bits1 = bits2;
        }
        return 0;
    }
    return -1;
}

int right_shift_buffer(uint8_t *buffer, int64_t len, uint8_t shift_right) {
    if (shift_right > 0 && shift_right < 8) {
        uint8_t shift_left = 8 - shift_right;
        uint8_t mask = (1 << shift_right) - 1;
        uint8_t bits1 = 0;
        for (auto i = len - 1; i >= 0; --i) {
            const auto bits2 = buffer[i] & mask;
            buffer[i] >>= shift_right;
            buffer[i] |= bits1 << shift_left;
            bits1 = bits2;
        }
        return 0;
    }
    return -1;
}

int64_t read_segment_from_file(FILE *from_file_ptr, int64_t offset, uint8_t *buffer, int64_t capacity) {
    int64_t rc = -1;
    if (0 == fseeko(from_file_ptr, 0, SEEK_END)) {
        const auto len = ftello(from_file_ptr) - offset;
        // make sure the offset does not exceed the file size
        if (len > 0) {
            // the length is going to be equal to what's left of the file, or the buffer capacity, whichever is less
            const auto count = (len < capacity) ? len : capacity;
            if (0 == fseeko(from_file_ptr, offset, SEEK_SET)) {
                if (count == fread(buffer, 1, count, from_file_ptr)) { rc = count; }
            }
        }
    }
    return rc;
}

int64_t write_segment_to_file(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr) {
    if (0 != fseeko(from_file_ptr, offset, SEEK_SET)) { return -1; }
    const int64_t buff_size = 1024 * 8;
    auto remaining = byte_count;
    uint8_t buff[buff_size];
    while (remaining) {
        const auto count = (buff_size > remaining) ? remaining : buff_size;
        if (count != fread(buff, 1, count, from_file_ptr) || count != fwrite(buff, 1, count, to_file_ptr)) {
            break;
        }
        remaining -= count;
    }
    return byte_count - remaining;
}

size_t bin2hex(const uint8_t *src, char *dst, size_t src_length) {
    static char HEXCONVTAB[] = "0123456789abcdef";
    size_t j = 0;

    for (size_t i = 0; i < src_length; ++i) {
        dst[j++] = HEXCONVTAB[src[i] >> 4];
        dst[j++] = HEXCONVTAB[src[i] & 15];
    }
    dst[j] = '\0';
    return j;
}

size_t hex2bin(const char *src, uint8_t *dst, size_t src_length) {
    const auto dst_length = src_length >> 1;
    size_t i = 0, j = 0;

    while (i < dst_length) {
        uint8_t c = src[j++], d;

        if (c >= '0' && c <= '9') { d = (c - '0') << 4; }
        else if (c >= 'a' && c <= 'f') { d = (c - 'a' + 10) << 4; }
        else if (c >= 'A' && c <= 'F') { d = (c - 'A' + 10) << 4; }
        else { return 0; }
        c = src[j++];

        if (c >= '0' && c <= '9') { d |= c - '0'; }
        else if (c >= 'a' && c <= 'f') { d |= c - 'a' + 10; }
        else if (c >= 'A' && c <= 'F') { d |= c - 'A' + 10; }
        else { return 0; }
        dst[i++] = d;
    }
    dst[i] = '\0';
    return i;
}
