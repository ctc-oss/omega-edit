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

#include "find.h"
#include "omega_edit/utility.h"
#include <cassert>
#include <climits>
#include <cstring>
#include <vector>

struct omega_find_skip_table_t : public std::vector<std::ptrdiff_t> {
    int is_reverse_search;

    omega_find_skip_table_t(std::ptrdiff_t vec_size, std::ptrdiff_t fill, int isReverse)
            : std::vector<std::ptrdiff_t>(vec_size, fill), is_reverse_search(isReverse) {}
};

int omega_find_is_reversed(const omega_find_skip_table_t *skip_table_ptr) {
    assert(skip_table_ptr);
    return skip_table_ptr->is_reverse_search;
}

/*
 * Function to create the skip table for Boyer-Moore searching algorithm. Depending on the direction of the search,
 * it creates a forward skip table or a reverse skip table.
 */
const omega_find_skip_table_t *omega_find_create_skip_table(const unsigned char *needle, size_t needle_length,
                                                            int is_reverse_search) {
    assert(needle);
    assert(needle_length > 0);

    // Ensure that is_reverse_search is 0 or 1.
    is_reverse_search = is_reverse_search != 0 ? 1 : 0;

    // Create a new skip table with size based on the needle length.
    auto *skip_table_ptr = new omega_find_skip_table_t(needle_length == 1 ? 0 : UCHAR_MAX + 1,
                                                       static_cast<std::ptrdiff_t>(needle_length), is_reverse_search);
    assert(skip_table_ptr);

    if (needle_length > 1) {
        const auto needle_length_minus_1 = static_cast<std::ptrdiff_t>(needle_length - 1);

        if (is_reverse_search) {
            // For a reverse search, for each character in the needle (except the first one),
            // set the skip table entry for that character to the distance from the character to the beginning of the needle.
            for (auto i = 0; i < needle_length_minus_1; ++i) {
                (*skip_table_ptr)[needle[needle_length_minus_1 - i]] = needle_length_minus_1 - i;
            }
        } else {
            // For a forward search, for each character in the needle (except the last one),
            // set the skip table entry for that character to the distance from the character to the end of the needle.
            for (auto i = 0; i < needle_length_minus_1; ++i) {
                (*skip_table_ptr)[needle[i]] = needle_length_minus_1 - i;
            }
        }
    }

    return skip_table_ptr;
}


/*
 * Boyer-Moore-Horspool with additional tuning (https://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.14.7176)
 * It can handle both forward and reverse searches.
 */
const unsigned char *omega_find(const unsigned char *haystack, size_t haystack_length,
                                const omega_find_skip_table_t *skip_table_ptr, const unsigned char *needle,
                                size_t needle_length) {
    assert(haystack);
    assert(skip_table_ptr);
    assert(needle);
    assert(needle_length > 0);

    // If the pattern is longer than the text, it can't be found
    if (needle_length > haystack_length) { return nullptr; }

    // If the needle is a single character, use memchr/memrchr instead of the skip table.
    if (needle_length == 1) {
        return skip_table_ptr->is_reverse_search
               ? (const unsigned char *) omega_util_memrchr(haystack, *needle, haystack_length)
               : (const unsigned char *) std::memchr(haystack, *needle, haystack_length);
    }

    assert(skip_table_ptr);

    const auto needle_length_minus_1 = needle_length - 1;
    const auto last_needle_char = skip_table_ptr->is_reverse_search ? needle[0] : needle[needle_length_minus_1];
    std::ptrdiff_t haystack_position =
            skip_table_ptr->is_reverse_search ? static_cast<std::ptrdiff_t>(haystack_length - needle_length) : 0;

    while (skip_table_ptr->is_reverse_search ? haystack_position >= 0
                                             : haystack_position <= haystack_length - needle_length) {
        const auto skip = haystack[haystack_position + (skip_table_ptr->is_reverse_search ? 0 : needle_length_minus_1)];

        if (const auto probe = haystack + haystack_position;
                last_needle_char == skip && std::memcmp(needle, probe, needle_length) == 0) {
            return probe;
        }

        haystack_position += skip_table_ptr->is_reverse_search ? -(*skip_table_ptr)[skip] : (*skip_table_ptr)[skip];
    }

    return nullptr;
}


void omega_find_destroy_skip_table(const omega_find_skip_table_t *skip_table_ptr) {
    assert(skip_table_ptr);
    delete skip_table_ptr;
}
