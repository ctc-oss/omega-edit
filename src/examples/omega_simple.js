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
 * Uses Omega Edit to extract and save a segment from a file.  Example from src/examples::
 * node ./omega_simple.js
 * R: []
 * I: [Hello Weird!!!!]
 * O: [Hello World!!!!]
 * D: [Hello World!]
 * finished!
 * Verify the results:
 * cat hello-js.txt
 * Hello World!
 */
function on_viewport_change(viewport, change) {
    change_kind = (change) ? omega_edit.omega_change_get_kind_as_char(change) : 'R'
    console.log(change_kind + ": [" + omega_edit.omega_viewport_get_string(viewport) + "]")
}

omega_edit = require('../../module/omega_edit_' + + process.platform)
session = omega_edit.omega_edit_create_session("", null, null)
console.assert(session != null, {errorMsg: "session creation failed"})
viewport = omega_edit.omega_edit_create_viewport(session, 0, 100, null, null)
if (omega_edit.omega_viewport_has_changes(viewport)) {
    on_viewport_change(viewport)
}
rc = omega_edit.omega_edit_insert(session, 0, "Hello Weird!!!!", 15);
console.assert(rc > 0, {rc: rc, errorMsg: "insert failed"})
if (omega_edit.omega_viewport_has_changes(viewport)) {
    on_viewport_change(viewport, omega_edit.omega_session_get_change(session, rc))
}
rc = omega_edit.omega_edit_overwrite(session, 7, "orl", 3)
console.assert(rc > 0, {rc: rc, errorMsg: "overwrite failed"})
if (omega_edit.omega_viewport_has_changes(viewport)) {
    on_viewport_change(viewport, omega_edit.omega_session_get_change(session, rc))
}
rc = omega_edit.omega_edit_delete(session, 11, 3)
console.assert(rc > 0, {rc: rc, errorMsg: "delete failed"})
if (omega_edit.omega_viewport_has_changes(viewport)) {
    on_viewport_change(viewport, omega_edit.omega_session_get_change(session, rc))
}
rc = omega_edit.omega_edit_save(session, "hello-js.txt")
console.assert(rc === 0, {rc: rc, errorMsg: "save failed"})
omega_edit.omega_edit_destroy_session(session);
console.log("finished!")
