/**********************************************************************************************************************
 * Copyright (c) 2021-2022-2022 Concurrent Technologies Corporation.                                                       *
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

const expect = require('chai').expect;
const omega_edit = require("../../module/omega_edit");

describe('Ωedit Javascript Unit Tests', function () {

    it('has a non-zero version number', function () {
        let version = omega_edit.omega_version();
        //console.log(version);
        expect(version).to.be.above(0);
    });

    it('has a copyright', function () {
        let copyright = omega_edit.omega_license_get();
        //console.log(copyright);
        //console.log(copyright.length);
        expect(copyright).to.be.a('string').and.to.have.lengthOf.above(500)
            .and.to.have.string("Concurrent Technologies Corporation");
    });

    it('creates and destroys a session', function () {
        let session = omega_edit.omega_edit_create_session("", null, null);
        expect(session).to.be.ok;
        expect(omega_edit.omega_session_get_num_changes(session)).to.equal(0);
        expect(omega_edit.omega_session_get_computed_file_size(session)).to.equal(0);
        omega_edit.omega_edit_destroy_session(session);
    });

});
