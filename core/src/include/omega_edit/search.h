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

/**
 * @file search.h
 * @brief Functions that enable searching within an editing session.
 */

#ifndef OMEGA_EDIT_SEARCH_H
#define OMEGA_EDIT_SEARCH_H

#include "byte.h"
#include "fwd_defs.h"

#ifdef __cplusplus

#include <cstdint>

extern "C" {
#else

#include <stdint.h>

#endif

/**
 * Create a search context
 * @param session_ptr session to find patterns in
 * @param pattern pointer to the pattern to find (as a sequence of bytes)
 * @param pattern_length length of the pattern (if 0, strlen will be used to calculate the length of null-terminated
 * bytes)
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes, if set to zero, it
 * will track the computed session length
 * @param case_insensitive zero for case sensitive match and non-zero otherwise
 * @param is_reverse_search zero for forward search and non-zero for reverse search
 * @return search context
 * @warning If searching for pattern data that could have embedded nulls, do not rely on setting the length to 0 and
 * have this function compute the length using strlen, because it will be wrong. Passing pattern length 0 is a
 * convenience for testing and should not be used in production code. In production code, explicitly pass in the pattern
 * length.
 * @warning Ensure that the pattern_length does not exceed the session_length - session_offset.  This is considered an
 * error and a null pointer will be returned.
 */
omega_search_context_t *omega_search_create_context_bytes(omega_session_t *session_ptr, const omega_byte_t *pattern,
                                                          int64_t pattern_length, int64_t session_offset,
                                                          int64_t session_length, int case_insensitive,
                                                          int is_reverse_search);

/**
 * Create a search context
 * @param session_ptr session to find the pattern in
 * @param pattern pointer to the pattern to find (as a C string)
 * @param pattern_length length of the pattern (if 0, strlen will be used to calculate the length of null-terminated
 * bytes)
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes, if set to zero, it
 * will search to the end of the session
 * @param case_insensitive zero for case-sensitive matching and non-zero for case-insensitive matching
 * @param is_reverse_search zero for forward search and non-zero for reverse search
 * @return search context
 * @warning If searching for pattern data that could have embedded nulls, do not rely on setting the length to 0 and
 * have this function compute the length using strlen, because it will be wrong. Passing length 0 is a convenience for
 * testing and should not be used in production code. In production code, explicitly pass in the length.
 * @warning Ensure that the pattern_length does not exceed the session_length - session_offset.  This is considered an
 * error and a null pointer will be returned.
 */
omega_search_context_t *omega_search_create_context(omega_session_t *session_ptr, const char *pattern,
                                                    int64_t pattern_length, int64_t session_offset,
                                                    int64_t session_length, int case_insensitive,
                                                    int is_reverse_search);

/**
 * Given a search context, determine if the search is being done forwards or backwards
 * @param search_context_ptr search context to determine if the search is forwards or backwards
 * @return zero for forwards search and non-zero for backwards search
 */
int omega_search_context_is_reverse_search(const omega_search_context_t *search_context_ptr);

/**
 * Given a search context, return the session length
 * @param search_context_ptr search context to get the session length from
 * @return session length
 */
int64_t omega_search_context_get_session_length(const omega_search_context_t *search_context_ptr);

/**
 * Given a search context, return the session offset
 * @param search_context_ptr search context to get the session offset from
 * @return session offset
 */
int64_t omega_search_context_get_session_offset(const omega_search_context_t *search_context_ptr);

/**
 * Given a search context, get the most recent search offset
 * @param search_context_ptr search context to get the most recent search offset from
 * @return most recent search offset, if the search offset is equal to the session length, then no match was found
 */
int64_t omega_search_context_get_match_offset(const omega_search_context_t *search_context_ptr);

/**
 * Given a search context, get the pattern length
 * @param search_context_ptr search context to get the pattern length from
 * @return pattern length offset
 */
int64_t omega_search_context_get_pattern_length(const omega_search_context_t *search_context_ptr);

/**
 * Given a search context, find the next match
 * @param search_context_ptr search context to find the next match in
 * @param advance_context advance the internal search context offset by this many bytes
 * @return non-zero if a match is found, zero otherwise
 */
int omega_search_next_match(omega_search_context_t *search_context_ptr, int64_t advance_context);

/**
 * Destroy the given search context
 * @param search_context_ptr search context to destroy
 */
void omega_search_destroy_context(omega_search_context_t *search_context_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_SEARCH_H
