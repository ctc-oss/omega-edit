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

#include "../include/omega_edit/search.h"
#include "../include/omega_edit/segment.h"
#include "../include/omega_edit/session.h"
#include "../include/omega_edit/utility.h"
#include "impl_/find.h"
#include "impl_/internal_fun.hpp"
#include "impl_/search_context_def.h"
#include "impl_/segment_def.hpp"
#include "impl_/session_def.hpp"
#include <algorithm>
#include <cassert>
#include <cctype>
#include <cstring>
#include <memory>

static inline omega_byte_t to_lower_(omega_byte_t byte, void *) {
    return static_cast<omega_byte_t>(std::tolower(byte));
}

omega_search_context_t *omega_search_create_context_bytes(omega_session_t *session_ptr, const omega_byte_t *pattern,
                                                          int64_t pattern_length, int64_t session_offset,
                                                          int64_t session_length, int case_insensitive) {
    assert(session_ptr);
    assert(pattern);
    assert(0 <= session_offset);
    pattern_length =
            pattern_length ? pattern_length : static_cast<int64_t>(strlen(reinterpret_cast<const char *>(pattern)));
    assert(0 < pattern_length);
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    const auto session_length_computed = session_length ? session_length : computed_file_size - session_offset;
    assert(0 <= session_length_computed);
    assert(session_offset + session_length_computed <= computed_file_size);
    if (pattern_length < OMEGA_SEARCH_PATTERN_LENGTH_LIMIT && pattern_length <= session_length_computed) {
        const auto match_context_ptr = std::make_shared<omega_search_context_t>();
        assert(match_context_ptr);
        match_context_ptr->session_ptr = session_ptr;
        match_context_ptr->pattern_length = pattern_length;
        match_context_ptr->session_offset = session_offset;
        match_context_ptr->session_length = session_length_computed;
        match_context_ptr->match_offset = session_offset + session_length_computed;
        match_context_ptr->byte_transform = case_insensitive ? &to_lower_ : nullptr;
        omega_data_create(&match_context_ptr->pattern, pattern_length);
        const auto pattern_data_ptr = omega_data_get_data(&match_context_ptr->pattern, pattern_length);
        memcpy(pattern_data_ptr, pattern, pattern_length);
        if (match_context_ptr->byte_transform) {
            omega_util_apply_byte_transform(pattern_data_ptr, pattern_length, match_context_ptr->byte_transform,
                                            nullptr);
        }
        pattern_data_ptr[pattern_length] = '\0';
        match_context_ptr->skip_table_ptr = omega_find_create_skip_table(pattern_data_ptr, pattern_length);
        session_ptr->search_contexts_.push_back(match_context_ptr);
        return match_context_ptr.get();
    }
    return nullptr;
}

omega_search_context_t *omega_search_create_context(omega_session_t *session_ptr, const char *pattern,
                                                    int64_t pattern_length, int64_t session_offset,
                                                    int64_t session_length, int case_insensitive) {
    return omega_search_create_context_bytes(session_ptr, (const omega_byte_t *) pattern, pattern_length,
                                             session_offset, session_length, case_insensitive);
}

int64_t omega_search_context_get_offset(const omega_search_context_t *search_context_ptr) {
    assert(search_context_ptr);
    return search_context_ptr->match_offset;
}

int64_t omega_search_context_get_length(const omega_search_context_t *search_context_ptr) {
    assert(search_context_ptr);
    return search_context_ptr->pattern_length;
}

/*
 * The idea here is to search using tiled windows.  The window should be at least twice the size of the pattern, and
 * then it skips to 1 + window_capacity - needle_length, as far as we can skip, with just enough backward coverage to
 * catch patterns that were on the window boundary.
 */
int omega_search_next_match(omega_search_context_t *search_context_ptr, int64_t advance_context) {
    static const auto MAX_SEGMENT_LENGTH = int64_t(OMEGA_SEARCH_PATTERN_LENGTH_LIMIT) << 1;
    assert(search_context_ptr);
    assert(search_context_ptr->skip_table_ptr);
    assert(search_context_ptr->session_ptr);
    assert(0 <= advance_context);
    omega_segment_t data_segment;
    const auto is_begin = search_context_ptr->match_offset ==
                          (search_context_ptr->session_offset + search_context_ptr->session_length);
    auto session_length = is_begin ? search_context_ptr->session_length
                                   : search_context_ptr->session_length -
                                             (search_context_ptr->match_offset - search_context_ptr->session_offset);
    data_segment.offset =
            is_begin ? search_context_ptr->session_offset : search_context_ptr->match_offset + advance_context;
    data_segment.capacity = std::min(session_length, MAX_SEGMENT_LENGTH);
    omega_data_create(&data_segment.data, data_segment.capacity);
    const auto pattern = omega_data_get_data(&search_context_ptr->pattern, search_context_ptr->pattern_length);
    // How far forward we can slide the search window after the previous window has been searched
    const auto stride_size = 1 + data_segment.capacity - search_context_ptr->pattern_length;
    do {
        populate_data_segment_(search_context_ptr->session_ptr, &data_segment);
        const auto segment_data_ptr = omega_segment_get_data(&data_segment);
        if (search_context_ptr->byte_transform) {
            omega_util_apply_byte_transform(segment_data_ptr, data_segment.length, search_context_ptr->byte_transform,
                                            nullptr);
        }
        if (const auto found = omega_find(segment_data_ptr, data_segment.length, search_context_ptr->skip_table_ptr,
                                          pattern, search_context_ptr->pattern_length)) {
            omega_data_destroy(&data_segment.data, data_segment.capacity);
            search_context_ptr->match_offset = data_segment.offset + (found - segment_data_ptr);
            return 1;
        }
        data_segment.offset += stride_size;
        session_length -= stride_size;
        data_segment.capacity = std::min(session_length, MAX_SEGMENT_LENGTH);
    } while (MAX_SEGMENT_LENGTH == data_segment.length);
    omega_data_destroy(&data_segment.data, data_segment.capacity);
    search_context_ptr->match_offset = session_length;
    return 0;
}

void omega_search_destroy_context(omega_search_context_t *const search_context_ptr) {
    if (search_context_ptr) {
        assert(search_context_ptr->skip_table_ptr);
        for (auto iter = search_context_ptr->session_ptr->search_contexts_.rbegin();
             iter != search_context_ptr->session_ptr->search_contexts_.rend(); ++iter) {
            if (search_context_ptr == iter->get()) {
                omega_data_destroy(&search_context_ptr->pattern, search_context_ptr->pattern_length);
                omega_find_destroy_skip_table(search_context_ptr->skip_table_ptr);
                search_context_ptr->skip_table_ptr = nullptr;
                search_context_ptr->session_ptr->search_contexts_.erase(std::next(iter).base());
                break;
            }
        }
    }
}
