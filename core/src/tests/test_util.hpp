/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
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

/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
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

#ifndef OMEGA_EDIT_TEST_UTIL_HPP
#define OMEGA_EDIT_TEST_UTIL_HPP

#include "omega_edit/byte.h"
#include "omega_edit/config.h"
#include <cstdio>
#include <cstring>
#include <iomanip>
#include <iostream>

static inline FILE *fill_file(const char *f1, int64_t file_size, const char *fill, int64_t fill_length) {
    const auto f1_ptr = FOPEN(f1, "w+");
    while (file_size) {
        const auto count = (fill_length > file_size) ? file_size : fill_length;
        if (count != fwrite(fill, 1, count, f1_ptr)) { abort(); }
        file_size -= count;
    }
    fflush(f1_ptr);
    fseek(f1_ptr, 0, SEEK_SET);
    return f1_ptr;
}

static inline void write_pretty_bits_byte(omega_byte_t byte) {
    for (auto i = 7; 0 <= i; --i) { std::clog << ((byte & (1 << i)) ? '1' : '0'); }
}

static inline void write_pretty_bits(const omega_byte_t *ptr, int64_t size) {
    if (size > 0) {
        auto i = 0;
        write_pretty_bits_byte(ptr[i++]);
        while (i < size) {
            std::clog << " ";
            write_pretty_bits_byte(ptr[i++]);
        }
    }
}

static inline void write_pretty_bytes(const omega_byte_t *data, int64_t size) {
    if (size > 0) {
        auto i = 0;
        std::clog << std::setfill('0');
        std::clog << std::hex << std::setw(2) << static_cast<int>(data[i++]);
        while (i < size) { std::clog << " " << std::hex << std::setw(2) << static_cast<int>(data[i++]); }
    }
}

#endif//OMEGA_EDIT_TEST_UTIL_HPP
