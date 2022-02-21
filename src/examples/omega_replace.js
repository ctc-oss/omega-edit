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

/*
 * This application can be used to test out how to do search and replace with Omega Edit.
 */

omega_edit = require('../../module/omega_edit')
in_filename = process.argv[2]
out_filename = process.argv[3]
pattern = process.argv[4]
replacement = process.argv[5]
session = omega_edit.omega_edit_create_session(in_filename, null, null)
console.assert(session != null, {errorMsg: "session creation failed"})
search_context = omega_edit.omega_search_create_context_string(session, pattern)
console.assert(search_context != null, {errorMsg: "match context creation failed"})
replacements = 0
if (omega_edit.omega_search_next_match(search_context, 1)) {
    do {
        pattern_offset = omega_edit.omega_search_context_get_offset(search_context)
        if (pattern.length == replacement.length) {
            omega_edit.omega_edit_overwrite_string(session, pattern_offset, replacement)
        } else {
            omega_edit.omega_session_pause_viewport_callbacks(session)
            omega_edit.omega_edit_delete(session, pattern_offset, pattern.length)
            omega_edit.omega_session_resume_viewport_callbacks(session)
            omega_edit.omega_edit_insert_string(session, pattern_offset, replacement)
        }
        ++replacements
    } while (omega_edit.omega_search_next_match(search_context, replacement.length));
}
omega_edit.omega_search_destroy_context(search_context)
rc = omega_edit.omega_edit_save(session, out_filename, 1, null)
console.assert(rc === 0, {rc: rc, errorMsg: "save failed"})
console.log("Replaced " + replacements + " instances using " + omega_edit.omega_session_get_num_changes(session) + " changes.")
omega_edit.omega_edit_destroy_session(session);
