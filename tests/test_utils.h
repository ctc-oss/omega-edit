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
#ifndef OMEGA_EDIT_TEST_UTILS_H
#define OMEGA_EDIT_TEST_UTILS_H

#include <cstdio>
#include <cstring>

// define DEBUG for debugging
#define DEBUG

#ifdef DEBUG

#include <iostream>

#define DBG(x) do{x}while(0)
#else
#define DBG(x)
#endif

// Returns 0 if the content of the 2 file pointers are the same (from where the pointers are currently) and 1 if contents are not the same
inline int compare_file_pointers(FILE *f1, FILE *f2) {
    const size_t buff_size = 1024 * 8;
    uint8_t buf1[buff_size];
    uint8_t buf2[buff_size];

    do {
        size_t r1 = fread(buf1, 1, buff_size, f1);
        size_t r2 = fread(buf2, 1, buff_size, f2);

        if (r1 != r2 || memcmp(buf1, buf2, r1) != 0) {
            return 1;  // Files are not equal
        }
    } while (!feof(f1) && !feof(f2));

    return (feof(f1) && feof(f2)) ? 0 : 1;
}

inline int compare_files(const char *f1, const char *f2) {
    FILE *f1_ptr = fopen(f1, "r");
    FILE *f2_ptr = fopen(f2, "r");
    auto result = compare_file_pointers(f1_ptr, f2_ptr);
    fclose(f1_ptr);
    fclose(f2_ptr);
    return result;
}

inline FILE *fill_file(const char *f1, int64_t file_size, const char *fill, uint64_t fill_length) {
    FILE *f1_ptr = fopen(f1, "w+");
    while (file_size) {
        auto count = (fill_length > file_size) ? file_size : fill_length;
        fwrite(fill, 1, count, f1_ptr);
        file_size -= count;
    }
    fflush(f1_ptr);
    fseek(f1_ptr, 0, SEEK_SET);
    return f1_ptr;
}

inline void write_pretty_bits_byte(uint8_t byte, FILE * out_fp) {
    for (auto i = 7; 0 <= i; --i) {
        fprintf(out_fp, "%c", (byte & (1 << i)) ? '1' : '0');
    }
}

inline void write_pretty_bits(const uint8_t *ptr, int64_t size, FILE *out_fp) {
    if (size > 0) {
        auto i = 0;
        write_pretty_bits_byte(ptr[i++], out_fp);
        while (i < size) {
            fprintf(out_fp, " ");
            write_pretty_bits_byte(ptr[i++], out_fp);
        }
    }
}

inline void write_pretty_bytes(const uint8_t *ptr, int64_t size, FILE *out_fp) {
    if (size > 0) {
        auto i = 0;
        fprintf(out_fp, "%02hhX", ptr[i++]);
        while (i < size) {
            fprintf(out_fp, " %02hhX", ptr[i++]);
        }
    }
}

#endif //OMEGA_EDIT_TEST_UTILS_H
