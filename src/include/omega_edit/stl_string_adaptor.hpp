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

#ifndef OMEGA_EDIT_STL_STRING_ADAPTOR_HPP
#define OMEGA_EDIT_STL_STRING_ADAPTOR_HPP

#ifdef __cplusplus

#include "change.h"
#include "edit.h"
#include "match.h"
#include "viewport.h"
#include <string>

/**
 * Given a change, return the change data as a string
 * @param change_ptr change to get the data from
 * @return change data as a string
 */
inline std::string omega_change_get_string(const omega_change_t *change_ptr) {
    const auto change_bytes = omega_change_get_bytes(change_ptr);
    if (change_bytes) {
        return {reinterpret_cast<const char *>(change_bytes), static_cast<size_t>(omega_change_get_length(change_ptr))};
    }
    return {};
}

/**
 * Given a viewport, return the viewport data as a string
 * @param viewport_ptr viewport to get the viewport data from
 * @return viewport data as a string
 */
inline std::string omega_viewport_get_string(const omega_viewport_t *viewport_ptr) {
    return {reinterpret_cast<const char *>(omega_viewport_get_data(viewport_ptr)),
            static_cast<size_t>(omega_viewport_get_length(viewport_ptr))};
}

/**
 * Insert a string at the given offset
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param str string to insert at the given offset
 * @return positive change serial number on success, zero otherwise
 */
inline int64_t omega_edit_insert_string(omega_session_t *session_ptr, int64_t offset, const std::string &str) {
    return omega_edit_insert(session_ptr, offset, str.c_str(), static_cast<int64_t>(str.length()));
}

/**
 * Overwrite bytes at the given offset with the given new string
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param str new string to overwrite the old bytes with
 * @return positive change serial number on success, zero otherwise
 */
inline int64_t omega_edit_overwrite_string(omega_session_t *session_ptr, int64_t offset, const std::string &str) {
    return omega_edit_overwrite(session_ptr, offset, str.c_str(), static_cast<int64_t>(str.length()));
}

/**
 * Create a match context
 * @param session_ptr session to find patterns in
 * @param pattern pattern string to find
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes, if set to zero, it
 * will track the computed session length
 * @param case_insensitive zero for case sensitive match and non-zero otherwise
 * @return match context
 */
inline omega_match_context_t *omega_match_create_context_string(const omega_session_t *session_ptr,
                                                                const std::string &pattern, int64_t session_offset = 0,
                                                                int64_t session_length = 0, int case_insensitive = 0) {
    return omega_match_create_context(session_ptr, pattern.c_str(), static_cast<int64_t>(pattern.length()),
                                      session_offset, session_length, case_insensitive);
}

#endif//__cplusplus

#endif//OMEGA_EDIT_STL_STRING_ADAPTOR_HPP
