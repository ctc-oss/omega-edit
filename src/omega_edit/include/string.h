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

#ifndef OMEGA_EDIT_STRING_H
#define OMEGA_EDIT_STRING_H

#ifdef __cplusplus

#include "change.h"
#include "edit.h"
#include "viewport.h"
#include <string>

inline std::string omega_change_get_string(const omega_change_t *change_ptr) {
    return {reinterpret_cast<const char *>(omega_change_get_bytes(change_ptr)),
            static_cast<size_t>(omega_change_get_length(change_ptr))};
}

inline std::string omega_viewport_get_string(const omega_viewport_t *viewport_ptr) {
    return {reinterpret_cast<const char *>(omega_viewport_get_data(viewport_ptr)),
            static_cast<size_t>(omega_viewport_get_length(viewport_ptr))};
}

inline int64_t omega_edit_insert_string(omega_session_t *session_ptr, int64_t offset, const std::string &str) {
    return omega_edit_insert(session_ptr, offset, str.c_str(), static_cast<int64_t>(str.length()));
}

inline int64_t omega_edit_overwrite_string(omega_session_t *session_ptr, int64_t offset, const std::string &str) {
    return omega_edit_overwrite(session_ptr, offset, str.c_str(), static_cast<int64_t>(str.length()));
}

#endif//__cplusplus

#endif//OMEGA_EDIT_STRING_H
