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
 * This application demonstrates a production-oriented embedding path: build a simple in-memory edit
 * script, replay it into a session, and save the result to disk.
 */

#include <iostream>
#include <omega_edit.h>
#include <omega_edit/scoped_ptr.hpp>
#include <omega_edit/stl_string_adaptor.hpp>

using namespace std;

int main(int argc, char **argv) {
    if (argc != 2) {
        cerr << "USAGE: " << argv[0] << " output-file" << endl;
        return -1;
    }

    auto session_ptr = omega_scoped_ptr<omega_session_t>(
            omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr), omega_edit_destroy_session);
    if (!session_ptr) {
        cerr << "failed to create session" << endl;
        return -1;
    }

    static const omega_byte_t hello_world[] = "hello world";
    static const omega_byte_t omega_edit[] = "OmegaEdit";
    static const omega_byte_t hello_upper[] = "HELLO";
    static const omega_byte_t comma_space[] = ", ";

    const omega_edit_script_op_t ops[] = {
            {0, 0, OMEGA_EDIT_SCRIPT_INSERT, hello_world, 11},
            {6, 5, OMEGA_EDIT_SCRIPT_REPLACE, omega_edit, 9},
            {0, 5, OMEGA_EDIT_SCRIPT_OVERWRITE, hello_upper, 5},
            {5, 1, OMEGA_EDIT_SCRIPT_DELETE, nullptr, 0},
            {5, 0, OMEGA_EDIT_SCRIPT_INSERT, comma_space, 2},
    };

    if (0 != omega_edit_apply_script(session_ptr.get(), ops, sizeof(ops) / sizeof(ops[0]))) {
        cerr << "failed to apply script" << endl;
        return -1;
    }

    if (0 != omega_edit_save(session_ptr.get(), argv[1], omega_io_flags_t::IO_FLG_OVERWRITE, nullptr)) {
        cerr << "failed to save output file" << endl;
        return -1;
    }

    cout << omega_session_get_segment_string(
                    session_ptr.get(), 0, omega_session_get_computed_file_size(session_ptr.get()))
         << endl;
    return 0;
}
