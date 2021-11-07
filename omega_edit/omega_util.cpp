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
    int rc = -1;
    if (shift_left > 0 && shift_left < 8) {
        uint8_t shift_right = 8 - shift_left;
        uint8_t mask = ((1 << shift_left) - 1) << shift_right;
        uint8_t bits1 = 0;
        for (auto i = len - 1; i >= 0; --i) {
            auto bits2 = buffer[i] & mask;
            buffer[i] <<= shift_left;
            buffer[i] |= bits1 >> shift_right;
            bits1 = bits2;
        }
        rc = 0;
    }
    return rc;
}

int right_shift_buffer(uint8_t *buffer, int64_t len, uint8_t shift_right) {
    int rc = -1;
    if (shift_right > 0 && shift_right < 8) {
        uint8_t shift_left = 8 - shift_right;
        uint8_t mask = (1 << shift_right) - 1;
        uint8_t bits1 = 0;
        for (auto i = len - 1; i >= 0; --i) {
            auto bits2 = buffer[i] & mask;
            buffer[i] >>= shift_right;
            buffer[i] |= bits1 << shift_left;
            bits1 = bits2;
        }
        rc = 0;
    }
    return rc;
}

int read_segment_from_file(FILE *from_file_ptr, int64_t offset, uint8_t *buffer, int64_t capacity, int64_t *length) {
    int rc = -1;
    if (0 == fseeko(from_file_ptr, 0, SEEK_END)) {
        auto len = ftello(from_file_ptr) - offset;
        // make sure the offset does not exceed the file size
        if (len > 0) {
            // the length is going to be equal to what's left of the file, or the buffer capacity, whichever is less
            auto amount = (len < capacity) ? len : capacity;
            if (0 == fseeko(from_file_ptr, offset, SEEK_SET)) {
                if (0 == fread(buffer, 1, amount, from_file_ptr)) {
                    rc = 0;// successful read
                    if (length) { *length = amount; }
                }
            }
        }
    }
    return rc;
}

// Write a segment of one file into another
int write_segment_to_file(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr) {
    int rc = 0;
    fseeko(from_file_ptr, offset, SEEK_SET);
    const int64_t buff_size = 1024 * 8;
    uint8_t buff[buff_size];
    while (byte_count) {
        auto count = (buff_size > byte_count) ? byte_count : buff_size;
        fread(buff, 1, count, from_file_ptr);
        fwrite(buff, 1, count, to_file_ptr);
        byte_count -= count;
    }
    fflush(to_file_ptr);
    return rc;
}
