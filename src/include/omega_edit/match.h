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

#ifndef OMEGA_EDIT_MATCH_H
#define OMEGA_EDIT_MATCH_H

#include "byte.h"
#include "fwd_defs.h"

#ifdef __cplusplus
#include <cstdint>
extern "C" {
#else
#include <stdint.h>
#endif

/**
 * Opaque match context
 */
typedef struct omega_match_context_t omega_match_context_t;

/**
 * Create a match context
 * @param session_ptr session to find patterns in
 * @param pattern pointer to the pattern to find (as a sequence of bytes)
 * @param pattern_length length of the pattern (if 0, strlen will be used to calculate the length of null-terminated
 * bytes)
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes, if set to zero, it
 * will track the computed session length
 * @param case_insensitive zero for case sensitive match and non-zero otherwise
 * @return match context
 */
omega_match_context_t *omega_match_create_context_bytes(const omega_session_t *session_ptr, const omega_byte_t *pattern,
                                                        int64_t pattern_length, int64_t session_offset,
                                                        int64_t session_length, int case_insensitive);

/**
 * Create a match context
 * @param session_ptr session to find patterns in
 * @param pattern pointer to the pattern to find (as a C string)
 * @param pattern_length length of the pattern (if 0, strlen will be used to calculate the length of null-terminated
 * bytes)
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes, if set to zero, it
 * will track the computed session length
 * @param case_insensitive zero for case sensitive match and non-zero otherwise
 * @return match context
 */
inline omega_match_context_t *omega_match_create_context(const omega_session_t *session_ptr, const char *pattern,
                                                         int64_t pattern_length, int64_t session_offset,
                                                         int64_t session_length, int case_insensitive) {
    return omega_match_create_context_bytes(session_ptr, (const omega_byte_t *) pattern, pattern_length, session_offset,
                                            session_length, case_insensitive);
}

/**
 * Given a match context, get the most recent match offset
 * @param match_context_ptr match context to get the most recent match offset from
 * @return the most recent match offset, if the match offset is equal to the session length, then no match was found
 */
int64_t omega_match_context_get_offset(const omega_match_context_t *match_context_ptr);

/**
 * Given a match context, get the pattern length
 * @param match_context_ptr match context to get the pattern length from
 * @return the pattern length offset
 */
int64_t omega_match_context_get_length(const omega_match_context_t *match_context_ptr);

/**
 * Given a match context, find the next match
 * @param match_context_ptr match context to find the next match in
 * @param advance_context advance the internal matching context by this many bytes
 * @return non-zero if a match is found, zero otherwise
 */
int omega_match_find(omega_match_context_t *match_context_ptr, int64_t advance_context);

/**
 * Destroy the given search context
 * @param match_context_ptr match context to destroy
 */
void omega_match_destroy_context(omega_match_context_t *match_context_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_MATCH_H
