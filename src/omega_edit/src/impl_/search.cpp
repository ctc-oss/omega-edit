/**********************************************************************************************************************
* Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
*                                                                                                                    *
* Licensed under the Apache License, Version 2.0 (the "License");                                                    *
* you may not use this file except in compliance with the License.                                                   *
* You may obtain a copy of the License at                                                                            *
*                                                                                                                    *
*     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
*                                                                                                                    *
* Unless required by applicable law or agreed to in writing, software                                                *
* distributed under the License is distributed on an "AS IS" BASIS,                                                  *
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                                           *
* See the License for the specific language governing permissions and                                                *
* limitations under the License.                                                                                     *
**********************************************************************************************************************/

#include "search.h"
#include <climits>
#include <cstring>

skip_table_t create_skip_table(const unsigned char *needle, size_t needle_length) {
    skip_table_t skip_table(UCHAR_MAX + 1, needle_length);
    if (needle_length >= 1) {
        const auto needle_length_minus_1 = needle_length - 1;
        for (size_t i = 0; i < needle_length_minus_1; ++i) { skip_table[needle[i]] = needle_length_minus_1 - i; }
    }
    return skip_table;
}

/*
 * Boyer-Moore-Horspool with additional tuning (https://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.14.7176)
 */
const unsigned char *string_search(const unsigned char *haystack, size_t haystack_length,
                                   const skip_table_t &skip_table, const unsigned char *needle, size_t needle_length) {
    if (needle_length > haystack_length) { return nullptr; }
    if (needle_length == 1) {
        auto *result = (const unsigned char *) std::memchr(haystack, *needle, haystack_length);
        return result ? result : nullptr;
    }
    const auto needle_length_minus_1 = needle_length - 1;
    const unsigned char last_needle_char = needle[needle_length_minus_1];
    size_t haystack_position = 0;
    while (haystack_position <= haystack_length - needle_length) {
        const auto skip = haystack[haystack_position + needle_length_minus_1];
        if (last_needle_char == skip && std::memcmp(needle, haystack + haystack_position, needle_length_minus_1) == 0) {
            return haystack + haystack_position;
        }
        haystack_position += skip_table[skip];
    }
    return nullptr;
}
