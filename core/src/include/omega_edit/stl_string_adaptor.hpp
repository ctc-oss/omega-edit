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
 * @file stl_string_adaptor.hpp
 * @brief C++ convenience functions for using STL strings.
 */

#ifndef OMEGA_EDIT_STL_STRING_ADAPTOR_HPP
#define OMEGA_EDIT_STL_STRING_ADAPTOR_HPP

#include "export.h"

#ifdef __cplusplus

#include "change.h"
#include "edit.h"
#include "search.h"
#include "segment.h"
#include "session.h"
#include "viewport.h"
#include <string>

/**
 * Given a change, return the change data as a string
 * @param change_ptr change to get the data from
 * @return change data as a string
 */
OMEGA_EDIT_EXPORT std::string omega_change_get_string(const omega_change_t *change_ptr) noexcept;

/**
 * Given a viewport, return the viewport data as a string
 * @param viewport_ptr viewport to get the viewport data from
 * @return viewport data as a string
 */
OMEGA_EDIT_EXPORT std::string omega_viewport_get_string(const omega_viewport_t *viewport_ptr) noexcept;

/**
 * Insert a string at the given offset
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param str string to insert at the given offset
 * @return positive change serial number on success, zero otherwise
 */
OMEGA_EDIT_EXPORT int64_t omega_edit_insert_string(omega_session_t *session_ptr, int64_t offset,
                                                   const std::string_view &str) noexcept;

/**
 * Overwrite bytes at the given offset with the given new string
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param str new string to overwrite the old bytes with
 * @return positive change serial number on success, zero otherwise
 */
OMEGA_EDIT_EXPORT int64_t omega_edit_overwrite_string(omega_session_t *session_ptr, int64_t offset,
                                                      const std::string_view &str) noexcept;

/**
 * Gets a segment of data from the given session
 * @param session_ptr session to get the segment of data from
 * @param offset start offset of the desired segment
 * @param length length of the desired segment from the given offset
 * @return string containing the desired segment of data
 */
OMEGA_EDIT_EXPORT std::string omega_session_get_segment_string(const omega_session_t *session_ptr, int64_t offset,
                                                               int64_t length) noexcept;
/**
 * Create a search context
 * @param session_ptr session to find patterns in
 * @param pattern pattern string to find
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes, if set to zero, it
 * will track the computed session length
 * @param case_insensitive false for case sensitive matching and true for case insensitive matching
 * @param reverse_search false for forward search and true for reverse search
 * @return search context
 * @warning Ensure that the pattern length does not exceed the session_length - session_offset.  This is considered an
 * error and a null pointer will be returned.
 */
OMEGA_EDIT_EXPORT omega_search_context_t *omega_search_create_context_string(omega_session_t *session_ptr,
                                                                             const std::string_view &pattern,
                                                                             int64_t session_offset = 0,
                                                                             int64_t session_length = 0,
                                                                             bool case_insensitive = false,
                                                                             bool reverse_search = false) noexcept;

#endif//__cplusplus

#endif//OMEGA_EDIT_STL_STRING_ADAPTOR_HPP
