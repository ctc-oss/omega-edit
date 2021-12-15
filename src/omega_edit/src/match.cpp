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
#include "../include/utility.h"
#include "impl_/data_segment_def.hpp"
#include "impl_/internal_fun.hpp"
#include "impl_/macros.hpp"
#include "impl_/search.h"
#include <cctype>
#include <cstring>
#include <functional>
#include <memory>

static inline omega_byte_t to_lower_(omega_byte_t byte) { return std::tolower(byte); }

// Manage a raw const pointer with custom deleter
template<typename T>
using deleted_unique_const_ptr = std::unique_ptr<const T, std::function<void(const T *)>>;

/*
 * The idea here is to search using tiled windows.  The window should be at least twice the size of the pattern, and
 * then it skips to 1 + window_capacity - needle_length, as far as we can skip, with just enough backward coverage to
 * catch patterns that were on the window boundary.
 */
int omega_match_bytes(const omega_session_t *session_ptr, const omega_byte_t *pattern, omega_match_found_cbk_t cbk,
                      void *user_data, int64_t pattern_length, int64_t session_offset, int64_t session_length,
                      int case_insensitive) {
    int rc = -1;
    pattern_length =
            (pattern_length) ? pattern_length : static_cast<int64_t>(strlen(reinterpret_cast<const char *>(pattern)));
    if (pattern_length < OMEGA_SEARCH_PATTERN_LENGTH_LIMIT) {
        rc = 0;
        session_length =
                (session_length) ? session_length : omega_session_get_computed_file_size(session_ptr) - session_offset;
        if (pattern_length <= session_length) {
            omega_data_t pattern_data;
            pattern_data.bytes_ptr =
                    (7 < pattern_length) ? std::make_unique<omega_byte_t[]>(pattern_length + 1) : nullptr;
            const auto pattern_data_ptr = omega_data_get_data(&pattern_data, pattern_length);
            memcpy(pattern_data_ptr, pattern, pattern_length);
            if (case_insensitive) { omega_util_byte_transformer(pattern_data_ptr, pattern_length, to_lower_); }
            pattern_data_ptr[pattern_length] = '\0';
            omega_data_segment_t data_segment;
            data_segment.offset = session_offset;
            data_segment.capacity = OMEGA_SEARCH_PATTERN_LENGTH_LIMIT << 1;
            data_segment.data.bytes_ptr =
                    (7 < data_segment.capacity) ? std::make_unique<omega_byte_t[]>(data_segment.capacity + 1) : nullptr;
            const auto skip_size = 1 + data_segment.capacity - pattern_length;
            int64_t skip = 0;
            CLOG << LOCATION << " pattern: " << pattern_data_ptr << std::endl;
            const auto skip_table_ptr = deleted_unique_const_ptr<omega_search_skip_table_t>(
                    omega_search_create_skip_table(pattern_data_ptr, pattern_length), omega_search_destroy_skip_table);
            do {
                data_segment.offset += skip;
                populate_data_segment_(session_ptr, &data_segment);
                const auto segment_data_ptr = omega_data_segment_get_data(&data_segment);
                if (case_insensitive) { omega_util_byte_transformer(segment_data_ptr, data_segment.length, to_lower_); }
                const omega_byte_t *found;
                int64_t delta = 0;
                while ((found = omega_search(segment_data_ptr + delta, data_segment.length - delta,
                                             skip_table_ptr.get(), pattern_data_ptr, pattern_length))) {
                    delta = found - segment_data_ptr;
                    if ((rc = cbk(data_segment.offset + delta, pattern_length, user_data)) != 0) {
                        if (7 < pattern_length) { pattern_data.bytes_ptr.reset(); }
                        if (7 < data_segment.capacity) { data_segment.data.bytes_ptr.reset(); }
                        return rc;
                    }
                    ++delta;
                }
                skip = skip_size;
            } while (data_segment.length == data_segment.capacity);
            if (7 < pattern_length) { pattern_data.bytes_ptr.reset(); }
            if (7 < data_segment.capacity) { data_segment.data.bytes_ptr.reset(); }
        }
    }
    return rc;
}

struct omega_match_context_t {
    const omega_search_skip_table_t *skip_table_ptr{};
    const omega_session_t *session_ptr{};
    int64_t pattern_length{};
    int64_t session_offset{};
    int64_t session_length{};
    int64_t match_offset{};
    bool case_insensitive = false;
    omega_data_t pattern;
};

omega_match_context_t *omega_match_create_context_bytes(const omega_session_t *session_ptr, const omega_byte_t *pattern,
                                                        int64_t pattern_length, int64_t session_offset,
                                                        int64_t session_length, int case_insensitive) {
    pattern_length =
            (pattern_length) ? pattern_length : static_cast<int64_t>(strlen(reinterpret_cast<const char *>(pattern)));
    session_length = (session_length) ? session_length : omega_session_get_computed_file_size(session_ptr);
    if (pattern_length < OMEGA_SEARCH_PATTERN_LENGTH_LIMIT && pattern_length <= session_length) {
        const auto match_context_ptr = new omega_match_context_t;
        match_context_ptr->session_ptr = session_ptr;
        match_context_ptr->pattern_length = pattern_length;
        match_context_ptr->session_offset = session_offset;
        match_context_ptr->session_length = session_length;
        match_context_ptr->match_offset = session_length;
        match_context_ptr->case_insensitive = case_insensitive;
        match_context_ptr->pattern.bytes_ptr =
                (7 < pattern_length) ? std::make_unique<omega_byte_t[]>(pattern_length + 1) : nullptr;
        const auto pattern_data_ptr = omega_data_get_data(&match_context_ptr->pattern, pattern_length);
        memcpy(pattern_data_ptr, pattern, pattern_length);
        if (case_insensitive) { omega_util_byte_transformer(pattern_data_ptr, pattern_length, to_lower_); }
        pattern_data_ptr[pattern_length] = '\0';
        match_context_ptr->skip_table_ptr = omega_search_create_skip_table(pattern_data_ptr, pattern_length);
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
    omega_data_segment_t data_segment;
    data_segment.offset = (match_context_ptr->match_offset == match_context_ptr->session_length)
                                  ? match_context_ptr->session_offset
                                  : match_context_ptr->match_offset + 1;
    data_segment.capacity = OMEGA_SEARCH_PATTERN_LENGTH_LIMIT << 1;
    data_segment.data.bytes_ptr =
            (7 < data_segment.capacity) ? std::make_unique<omega_byte_t[]>(data_segment.capacity + 1) : nullptr;
    const auto pattern_length = match_context_ptr->pattern_length;
    const auto pattern = omega_data_get_data(&match_context_ptr->pattern, pattern_length);
    const auto skip_size = 1 + data_segment.capacity - pattern_length;
    int64_t skip = 0;
    do {
        data_segment.offset += skip;
        populate_data_segment_(match_context_ptr->session_ptr, &data_segment);
        const auto segment_data_ptr = omega_data_segment_get_data(&data_segment);
        if (match_context_ptr->case_insensitive) {
            omega_util_byte_transformer(segment_data_ptr, data_segment.length, to_lower_);
        }
        const auto found = omega_search(segment_data_ptr, data_segment.length, match_context_ptr->skip_table_ptr,
                                        pattern, pattern_length);
        if (found) {
            if (7 < data_segment.capacity) { data_segment.data.bytes_ptr.reset(); }
            match_context_ptr->match_offset = data_segment.offset + (found - segment_data_ptr);
            return 1;
        }
        skip = skip_size;
    } while (data_segment.length == data_segment.capacity);
    if (7 < data_segment.capacity) { data_segment.data.bytes_ptr.reset(); }
    match_context_ptr->match_offset = match_context_ptr->session_length;
    return 0;
}

void omega_match_destroy_context(omega_match_context_t *match_context_ptr) {
    omega_search_destroy_skip_table(match_context_ptr->skip_table_ptr);
    if (7 < match_context_ptr->pattern_length) { match_context_ptr->pattern.bytes_ptr.reset(); }
    delete match_context_ptr;
}
