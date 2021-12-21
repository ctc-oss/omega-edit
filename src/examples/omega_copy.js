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
 * Uses Omega Edit to copy a file.  Example from src/examples:
 * node ./omega_copy.js ../tests/data/test1.dat test1.dat.copy
 * Verify the file contents are identical:
 * cmp ../tests/data/test1.dat test1.dat.copy
 */
omega_edit = require('../../build/Release/omega_edit')
input_filename = process.argv[2]
output_filename = process.argv[3]
session = omega_edit.omega_edit_create_session(input_filename, null, null)
console.assert(session != null, {errorMsg: "session creation failed"})
console.log(omega_edit.omega_session_get_computed_file_size(session))
rc = omega_edit.omega_edit_save(session, output_filename)
console.assert(rc === 0, {rc: rc, errorMsg: "save failed"})
omega_edit.omega_edit_destroy_session(session)
console.log("finished!")
