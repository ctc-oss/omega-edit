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
 * node ./omega_slice.js ../../LICENSE.txt LICENSE.34-15.txt 34 15
 * cat LICENSE.2-3.txt
 * Apache License
 */
omega_edit = require('../../build/Release/omega_edit')
input_filename = process.argv[2]
output_filename = process.argv[3]
offset = parseInt(process.argv[4])
length = parseInt(process.argv[5])
session = omega_edit.omega_edit_create_session(input_filename, null, null)
console.assert(session != null, {errorMsg: "session creation failed"})
if (offset) {
    rc = omega_edit.omega_edit_delete(session, 0, offset)
    console.assert(rc > 0, {rc: rc, errorMsg: "delete failed"})
}
rc = omega_edit.omega_edit_delete(session, length, omega_edit.omega_session_get_computed_file_size(session))
console.assert(rc > 0, {rc: rc, errorMsg: "delete failed"})
rc = omega_edit.omega_edit_save(session, output_filename)
console.assert(rc === 0, {rc: rc, errorMsg: "save failed"})
omega_edit.omega_edit_destroy_session(session)
console.log("finished!")
