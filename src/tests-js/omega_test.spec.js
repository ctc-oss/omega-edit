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

const assert = require('assert')

describe('Ωedit Javascript Unit Tests', function () {

    it('loads the module', function () {
        omega_edit = require("../../module")
        //console.log(omega_edit)
        assert.ok(omega_edit)
    });

    it('has a non-zero version number', function () {
        version = omega_edit.omega_version()
        //console.log(version)
        assert.ok(0 < version)
    });

    it('has a copyright', function () {
        copyright = omega_edit.omega_license_get()
        //console.log(copyright)
        //console.log(copyright.length)
        assert.ok(500 < copyright.length)
        assert.ok(copyright.includes("Concurrent Technologies Corporation"))
    });

    it('creates and destroys a session', function () {
        session = omega_edit.omega_edit_create_session("", null, null)
        assert.ok(session)
        assert.ok(0 == omega_edit.omega_session_get_num_changes(session))
        assert.ok(0 == omega_edit.omega_session_get_computed_file_size(session))
        omega_edit.omega_edit_destroy_session(session)
    });

});
