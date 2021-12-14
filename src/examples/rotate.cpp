/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License");                                                    *
 * you may not use this file except in compliance with the License.                                                   *
 * You may obtain a copy of the License at                                                                            *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software                                                *
 * distributed under the License is distributed on an "AS IS" BASIS,                                                  *
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                                           *
 * See the License for the specific language governing permissions and                                                *
 * limitations under the License.                                                                                     *
 **********************************************************************************************************************/

/**
 * This application can be used to test out some of the core features of Omega Edit.  If the number of rotations is a
 * multiple of the file size, then the output file ought to be identical to the input file and can be verified using
 * cmp or diff.
 */
#include "../omega_edit/omega_edit.h"
#include "../omega_edit/include/utility.h"
#include <cinttypes>
#include <iostream>
#include <string>

using namespace std;

struct last_byte_info_t {
    bool has_last_byte{};
    omega_byte_t last_byte{};
};

void vpt_change_last_byte_cbk(const omega_viewport_t *viewport_ptr, const omega_change_t *) {
    auto last_byte_info = static_cast<last_byte_info_t *>(omega_viewport_get_user_data(viewport_ptr));
    auto length = omega_viewport_get_length(viewport_ptr);
    if (length) {
        last_byte_info->has_last_byte = true;
        last_byte_info->last_byte = omega_viewport_get_data(viewport_ptr)[length - 1];
    } else {
        last_byte_info->has_last_byte = false;
    }
}

int main(int argc, char **argv) {
    if (argc != 4) {
        fprintf(stderr,
                "This program edits the input file by rotating the byte at the end of the file to become the byte at\n"
                "the front of the file.  It will do these rotations using deletes, inserts, and overwrites.  It is\n"
                "not designed to be very efficient, but rather to exercise some of the core features of Omega Edit.\n\n"
                "USAGE: %s infile outfile num_rotations\n",
                argv[0]);
        return -1;
    }
    last_byte_info_t last_byte_info{};
    auto in_filename = argv[1];
    if (!omega_util_file_exists(in_filename)) {
        fprintf(stderr, "ERROR: Input file '%s' does not exist (cwd: %s)\n", in_filename, omega_util_get_current_dir());
        return -1;
    }
    auto out_filename = argv[2];
    auto rotations = stol(argv[3]);
    auto session_ptr = omega_edit_create_session(in_filename);
    // Create a small viewport at the end of the file to track the last byte.
    auto viewport_ptr = omega_edit_create_viewport(session_ptr, omega_session_get_computed_file_size(session_ptr) - 1,
                                                   4, vpt_change_last_byte_cbk, &last_byte_info);
    if (last_byte_info.has_last_byte) {
        for (auto i = 0; i < rotations; ++i) {
            int64_t serial;
            auto last_byte = last_byte_info.last_byte;
            // Ths could be more efficient to insert the last_byte rather than insert a bogus byte, then overwrite it,
            // but the purpose of this routine is to exercise all the edit operations.
            if ((serial = omega_edit_insert_bytes(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("+"), 1)) <
                0) {
                clog << "Error inserting serial: " << serial << endl;
                return -1;
            }
            if ((serial = omega_edit_overwrite_bytes(session_ptr, 0, &last_byte, 1)) < 0) {
                clog << "Error overwriting serial: " << serial << endl;
                return -1;
            }
            if ((serial = omega_edit_delete(session_ptr, omega_session_get_computed_file_size(session_ptr) - 1, 1)) <
                0) {
                clog << "Error deleting serial: " << serial << endl;
                return -1;
            }
            omega_viewport_update(viewport_ptr, omega_session_get_computed_file_size(session_ptr) - 1, 4);
        }
    }
    fprintf(stdout, "Saving %zu changes to %s of size %" PRId64 "\n", omega_session_get_num_changes(session_ptr),
            out_filename, omega_session_get_computed_file_size(session_ptr));
    omega_edit_save(session_ptr, out_filename);
    omega_edit_destroy_session(session_ptr);
    return 0;
}