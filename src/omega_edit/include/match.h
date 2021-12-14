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

/** Callback to implement when pattern matches are found in a session.
 * Return 0 to continue matching and non-zero to stop.*/
typedef int (*omega_match_found_cbk_t)(int64_t match_offset, int64_t match_length, void *user_data);

/**
 * Given a session, find patterns and call the match found callback as patterns are found
 * @param session_ptr session to find the patterns in
 * @param pattern pointer to the pattern to find (as a sequence of bytes)
 * @param cbk the callback to call as patterns are found in the session
 * @param user_data user data to send back into the callback
 * @param pattern_length length of the pattern (if 0, strlen will be used to calculate the length of null-terminated
 * bytes)
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes
 * @return 0 if all needles have been found, or the non-zero return from the user callback
 */
int omega_match_bytes(const omega_session_t *session_ptr, const omega_byte_t *pattern, omega_match_found_cbk_t cbk,
                      void *user_data = nullptr, int64_t pattern_length = 0, int64_t session_offset = 0,
                      int64_t session_length = 0);

/**
 * Given a session, find patterns and call the match found callback as patterns are found
 * @param session_ptr session to find the patterns in
 * @param pattern pointer to the pattern to find (as a C string)
 * @param cbk the callback to call as patterns are found in the session
 * @param user_data user data to send back into the callback
 * @param pattern_length length of the pattern (if 0, strlen will be used to calculate the length of null-terminated
 * bytes)
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes
 * @return 0 if all needles have been found, or the non-zero return from the user callback
 */
inline int omega_match(const omega_session_t *session_ptr, const char *pattern, omega_match_found_cbk_t cbk,
                       void *user_data = nullptr, int64_t pattern_length = 0, int64_t session_offset = 0,
                       int64_t session_length = 0) {
    return omega_match_bytes(session_ptr, (const omega_byte_t *) pattern, cbk, user_data, pattern_length,
                             session_offset, session_length);
}

/**
 * Opaque match context
 */
struct omega_match_context_t;

/**
 * Create a match context
 * @param session_ptr session to find patterns in
 * @param pattern pointer to the pattern to find (as a sequence of bytes)
 * @param pattern_length length of the pattern (if 0, strlen will be used to calculate the length of null-terminated
* bytes)
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes
 * @return match context
 */
omega_match_context_t *omega_match_create_context_bytes(const omega_session_t *session_ptr, const omega_byte_t *pattern,
                                                        int64_t pattern_length = 0, int64_t session_offset = 0,
                                                        int64_t session_length = 0);

/**
 * Create a match context
 * @param session_ptr session to find patterns in
 * @param pattern pointer to the pattern to find (as a C string)
 * @param pattern_length length of the pattern (if 0, strlen will be used to calculate the length of null-terminated
* bytes)
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes
 * @return match context
 */
inline omega_match_context_t *omega_match_create_context(const omega_session_t *session_ptr, const char *pattern,
                                                         int64_t pattern_length = 0, int64_t session_offset = 0,
                                                         int64_t session_length = 0) {
    return omega_match_create_context_bytes(session_ptr, (const omega_byte_t *) pattern, pattern_length, session_offset,
                                            session_length);
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
 * @return non-zero if a match is found, zero otherwise
 */
int omega_match_next(omega_match_context_t *match_context_ptr);

/**
 * Destroy the given search context
 * @param match_context_ptr match context to destroy
 */
void omega_match_destroy_context(omega_match_context_t *match_context_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_MATCH_H
