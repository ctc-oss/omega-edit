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

#include "../include/omega_edit/stl_string_adaptor.hpp"
#include <cassert>

std::string omega_change_get_string(const omega_change_t *change_ptr)

        noexcept {
    if (const auto change_bytes = omega_change_get_bytes(change_ptr)) {
        return {reinterpret_cast<const char *>(change_bytes), static_cast

                <size_t>(omega_change_get_length(change_ptr))

        };
    }
    return {};
}

std::string omega_viewport_get_string(const omega_viewport_t *viewport_ptr)

        noexcept {
    return {reinterpret_cast

            <const char *>(omega_viewport_get_data(viewport_ptr)),

            static_cast

            <size_t>(omega_viewport_get_length(viewport_ptr))

    };
}

int64_t omega_edit_insert_string(omega_session_t *session_ptr, int64_t offset, const std::string_view &str)

        noexcept {
    return omega_edit_insert(session_ptr, offset,
                             str.

                             data(),

                             static_cast<int64_t>(str.

                                                  length()

                                                          ));
}

int64_t omega_edit_overwrite_string(omega_session_t *session_ptr, int64_t offset, const std::string_view &str)

        noexcept {
    return omega_edit_overwrite(session_ptr, offset,
                                str.

                                data(),

                                static_cast<int64_t>(str.

                                                     length()

                                                             ));
}

std::string omega_session_get_segment_string(const omega_session_t *session_ptr, int64_t offset, int64_t length)

        noexcept {
    const auto segment_ptr = omega_segment_create(length);
    const auto rc = omega_session_get_segment(session_ptr, segment_ptr, offset);
    assert(0 == rc);
    std::string result(reinterpret_cast<const char *>(omega_segment_get_data(segment_ptr)),
                       static_cast<size_t>(omega_segment_get_length(segment_ptr)));
    omega_segment_destroy(segment_ptr);
    return result;
}

omega_search_context_t *omega_search_create_context_string(omega_session_t *session_ptr,
                                                           const std::string_view &pattern, int64_t session_offset,
                                                           int64_t session_length, int case_insensitive)

        noexcept {
    return omega_search_create_context(session_ptr,
                                       pattern.

                                       data(),

                                       static_cast<int64_t>(pattern.

                                                            length()

                                                                    ),
                                       session_offset, session_length, case_insensitive);
}
