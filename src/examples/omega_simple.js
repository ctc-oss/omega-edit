/*
* Copyright 2021 Concurrent Technologies Corporation
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

/*
 * Uses Omega Edit to extract and save a segment from a file.  Example from src/examples::
 * node ./omega_simple.js
 * finished!
 * Verify the results:
 * cat hello-js.txt
 * Hello World!
 */
omega_edit = require('../../build/Release/omega_edit')
session = omega_edit.omega_edit_create_session("", null, null)
console.assert(session != null, {errorMsg: "session creation failed"})
rc = omega_edit.omega_edit_insert(session, 0, "Hello Weird!!!!", 15);
console.assert(rc > 0, {rc: rc, errorMsg: "insert failed"})
rc = omega_edit.omega_edit_overwrite(session, 7, "orl", 3);
console.assert(rc > 0, {rc: rc, errorMsg: "overwrite failed"})
rc = omega_edit.omega_edit_delete(session, 11, 3);
console.assert(rc > 0, {rc: rc, errorMsg: "delete failed"})
rc = omega_edit.omega_edit_save(session, "hello-js.txt")
console.assert(rc === 0, {rc: rc, errorMsg: "save failed"})
omega_edit.omega_edit_destroy_session(session)
console.log("finished!")
