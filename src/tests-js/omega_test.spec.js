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
