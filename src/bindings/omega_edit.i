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

/* clang-format off */

%module(directors="1") omega_edit

%{
/* Includes the header in the wrapper code */
#include "../omega_edit/omega_edit.h"
#include "../omega_edit/include/check.h"
#include "../omega_edit/include/stl_string_adaptor.hpp"
%}

%include <stdint.i>
%include <std_string.i>

/* Parse the header file to generate wrappers */
%include "../omega_edit/include/change.h"
%include "../omega_edit/include/check.h"
%include "../omega_edit/include/edit.h"
%include "../omega_edit/include/license.h"
%include "../omega_edit/include/match.h"
%include "../omega_edit/include/session.h"
%include "../omega_edit/include/stl_string_adaptor.hpp"
%include "../omega_edit/include/viewport.h"
%include "../omega_edit/include/visit.h"

%feature("director") SessionOnChangeDirector;
%inline %{
/*
 * Session On Change Director
 */
struct SessionOnChangeDirector {
  virtual void handle_session_change(const omega_session_t *, const omega_change_t *) = 0;
  virtual ~SessionOnChangeDirector() {}
};
%}
%{
// could be changed to a thread-local variable in order to make thread-safe
static SessionOnChangeDirector *session_on_change_director_ptr = nullptr;
static void handle_session_change_helper(const omega_session_t * session_ptr, const omega_change_t * change_ptr) {
    if (session_on_change_director_ptr) {
        session_on_change_director_ptr->handle_session_change(session_ptr, change_ptr);
    }
}
%}
%inline %{
omega_session_t *omega_edit_create_session_wrapper(const char *file_path = nullptr,
    SessionOnChangeDirector *director_ptr = nullptr, void *user_data_ptr = nullptr) {
    session_on_change_director_ptr = director_ptr;
    return omega_edit_create_session(file_path, handle_session_change_helper, user_data_ptr);
}
%}

%feature("director") OmegaViewportOnChangeDirector;
%inline %{
/*
 * Viewport On Change Director
 */
struct OmegaViewportOnChangeDirector {
  virtual void handle_viewport_change(const omega_viewport_t *, const omega_change_t *) = 0;
  virtual ~OmegaViewportOnChangeDirector() {}
};
%}
%{
// could be changed to a thread-local variable in order to make thread-safe
static OmegaViewportOnChangeDirector *viewport_on_change_director_ptr = nullptr;
static void handle_viewport_change_helper(const omega_viewport_t * viewport_ptr, const omega_change_t * change_ptr) {
    viewport_on_change_director_ptr->handle_viewport_change(viewport_ptr, change_ptr);
}
%}
%inline %{
omega_viewport_t *omega_edit_create_viewport_wrapper(omega_session_t *session_ptr, int64_t offset, int64_t capacity,
    OmegaViewportOnChangeDirector *director_ptr, void *user_data_ptr = nullptr) {
    viewport_on_change_director_ptr = director_ptr;
    return omega_edit_create_viewport(session_ptr, offset, capacity, handle_viewport_change_helper, user_data_ptr);
}
%}

%feature("director") OmegaMatchFoundDirector;
%inline %{
/*
 * Match Found Director
 */
struct OmegaMatchFoundDirector {
  virtual int handle_match_found(int64_t match_offset, int64_t match_length, void *user_data) = 0;
  virtual ~OmegaMatchFoundDirector() {}
};
%}
%{
static OmegaMatchFoundDirector *match_found_director_ptr = nullptr;
static int handle_match_found_helper(int64_t match_offset, int64_t match_length, void *user_data) {
    return match_found_director_ptr->handle_match_found(match_offset, match_length, user_data);
}
%}
%inline %{
static int omega_edit_search_bytes_wrapper(const omega_session_t *session_ptr, const omega_byte_t *pattern,
    OmegaMatchFoundDirector *director_ptr, void *user_data = nullptr,int64_t pattern_length = 0,
    int64_t session_offset = 0, int64_t session_length = 0, int case_insensitive = 0) {
    match_found_director_ptr = director_ptr;
    return omega_match_bytes(session_ptr, pattern, handle_match_found_helper, user_data, pattern_length,
        session_offset, session_length, case_insensitive);
}
%}
