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

#include "search.h"
#include <cassert>
#include <climits>
#include <cstring>
#include <vector>

struct omega_search_skip_table_t : public std::vector<size_t> {
    omega_search_skip_table_t(size_t vec_size, size_t fill) : std::vector<size_t>(vec_size, fill) {}
};

const omega_search_skip_table_t *omega_search_create_skip_table(const unsigned char *needle, size_t needle_length) {
    assert(needle);
    assert(needle_length > 0);
    auto skip_table_ptr = new omega_search_skip_table_t(UCHAR_MAX + 1, needle_length);
    assert(skip_table_ptr);
    if (needle_length >= 1) {
        const auto needle_length_minus_1 = needle_length - 1;
        for (size_t i = 0; i < needle_length_minus_1; ++i) { (*skip_table_ptr)[needle[i]] = needle_length_minus_1 - i; }
    }
    return skip_table_ptr;
}

/*
 * Boyer-Moore-Horspool with additional tuning (https://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.14.7176)
 */
const unsigned char *omega_search(const unsigned char *haystack, size_t haystack_length,
                                  const omega_search_skip_table_t *skip_table_ptr, const unsigned char *needle,
                                  size_t needle_length) {
    assert(haystack);
    assert(skip_table_ptr);
    assert(needle);
    assert(needle_length > 0);
    if (needle_length > haystack_length) { return nullptr; }
    if (needle_length == 1) {
        auto *result = (const unsigned char *) std::memchr(haystack, *needle, haystack_length);
        return (result) ? result : nullptr;
    }
    const auto needle_length_minus_1 = needle_length - 1;
    const unsigned char last_needle_char = needle[needle_length_minus_1];
    size_t haystack_position = 0;
    while (haystack_position <= haystack_length - needle_length) {
        const auto skip = haystack[haystack_position + needle_length_minus_1];
        if (last_needle_char == skip && std::memcmp(needle, haystack + haystack_position, needle_length_minus_1) == 0) {
            return haystack + haystack_position;
        }
        haystack_position += (*skip_table_ptr)[skip];
    }
    return nullptr;
}

void omega_search_destroy_skip_table(const omega_search_skip_table_t *skip_table_ptr) {
    assert(skip_table_ptr);
    delete skip_table_ptr;
}
