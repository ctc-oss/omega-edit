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

#include "../include/match.h"
#include "../include/session.h"
#include "impl_/data_segment_def.h"
#include "impl_/internal_fun.h"
#include "impl_/search.h"
#include <cstring>

struct omega_match_context_t {
    const skip_table_t *skip_table_ptr;
    const omega_session_t *session_ptr;
    const omega_byte_t *pattern;
    int64_t pattern_length;
    int64_t session_offset;
    int64_t session_length;
    int64_t match_offset;
};

omega_match_context_t *omega_match_create_context_bytes(const omega_session_t *session_ptr, const omega_byte_t *pattern,
                                                        int64_t pattern_length, int64_t session_offset,
                                                        int64_t session_length) {
    pattern_length =
            (pattern_length) ? pattern_length : static_cast<int64_t>(strlen(reinterpret_cast<const char *>(pattern)));
    session_length = (session_length) ? session_length : omega_session_get_computed_file_size(session_ptr);
    if (pattern_length < OMEGA_SEARCH_PATTERN_LENGTH_LIMIT && pattern_length <= session_length) {
        auto match_context_ptr = new omega_match_context_t;
        match_context_ptr->session_ptr = session_ptr;
        match_context_ptr->pattern = pattern;
        match_context_ptr->pattern_length = pattern_length;
        match_context_ptr->session_offset = session_offset;
        match_context_ptr->session_length = session_length;
        match_context_ptr->match_offset = session_length;
        match_context_ptr->skip_table_ptr = create_skip_table(pattern, pattern_length);
        return match_context_ptr;
    }
    return nullptr;
}

int64_t omega_match_context_get_offset(const omega_match_context_t *match_context_ptr) {
    return match_context_ptr->match_offset;
}

int64_t omega_match_context_get_length(const omega_match_context_t *match_context_ptr) {
    return match_context_ptr->pattern_length;
}

int omega_match_next(omega_match_context_t *match_context_ptr) {
    data_segment_t data_segment;
    data_segment.offset = (match_context_ptr->match_offset == match_context_ptr->session_length)
                                  ? match_context_ptr->session_offset
                                  : match_context_ptr->match_offset + 1;
    data_segment.capacity = OMEGA_SEARCH_PATTERN_LENGTH_LIMIT << 1;
    data_segment.data.bytes_ptr =
            (7 < data_segment.capacity) ? std::make_unique<omega_byte_t[]>(data_segment.capacity + 1) : nullptr;
    const auto skip_size = 1 + data_segment.capacity - match_context_ptr->pattern_length;
    int64_t skip = 0;
    do {
        data_segment.offset += skip;
        populate_data_segment_(match_context_ptr->session_ptr, &data_segment);
        const auto haystack = get_data_segment_data_(&data_segment);
        const auto found = string_search(haystack, data_segment.length, match_context_ptr->skip_table_ptr,
                                         match_context_ptr->pattern, match_context_ptr->pattern_length);
        if (found) {
            match_context_ptr->match_offset = data_segment.offset + (found - haystack);
            return 1;
        }
        skip = skip_size;
    } while (data_segment.length == data_segment.capacity);
    if (7 < data_segment.capacity) { data_segment.data.bytes_ptr.reset(); }
    match_context_ptr->match_offset = match_context_ptr->session_length;
    return 0;
}

void omega_match_destroy_context(omega_match_context_t *match_context_ptr) {
    destroy_skip_table(match_context_ptr->skip_table_ptr);
    delete match_context_ptr;
}
