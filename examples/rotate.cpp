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

/**
 * This application can be used to test out some of the core features of Omega Edit.  If the number of rotations is a
 * multiple of the file size, then the output file ought to be identical to the input file and can be verified using
 * cmp or diff.
 */
#include "../omega_edit/omega_edit.h"
#include <string>

using namespace std;

struct last_byte_info_t {
    bool has_last_byte{};
    uint8_t last_byte{};
};

void vpt_change_last_byte_cbk(const viewport_t *viewport_ptr, const change_t *) {
    auto last_byte_info = static_cast<last_byte_info_t *>(get_viewport_user_data(viewport_ptr));
    auto length = get_viewport_length(viewport_ptr);
    if (length) {
        last_byte_info->has_last_byte = true;
        last_byte_info->last_byte = get_viewport_data(viewport_ptr)[length - 1];
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
                "USAGE: %s infile outfile num_rotations\n", argv[0]);
        return -1;
    }
    last_byte_info_t last_byte_info{};
    auto in_filename = argv[1];
    auto out_filename = argv[2];
    auto rotations = stol(argv[3]);
    auto in_fptr = fopen(in_filename, "r");
    if (!in_fptr) {
        fprintf(stderr, "failed to open %s for reading\n", in_filename);
        return -1;
    }
    auto out_fptr = fopen(out_filename, s"w");
    if (!out_fptr) {
        fprintf(stderr, "failed to open %s for writing\n", out_filename);
        return -1;
    }
    auto session_ptr = create_session(in_fptr);
    auto author_ptr = create_author(session_ptr, "rotate");
    // Create a small viewport at the end of the file to track the last byte.
    create_viewport(author_ptr, get_computed_file_size(session_ptr) - 4, 8, vpt_change_last_byte_cbk,
                    &last_byte_info);
    if (last_byte_info.has_last_byte) {
        for (auto i = 0; i < rotations; ++i) {
            auto last_byte = last_byte_info.last_byte;
            // Ths could be more efficient to insert the last_byte rather than insert a bogus byte, then overwrite it,
            // but the purpose of this routine is to exercise all the edit operations.
            ins(author_ptr, 0, 1, '+');
            ovr(author_ptr, 0, last_byte);
            del(author_ptr, get_computed_file_size(session_ptr) - 1, 1);
        }
    }
    fprintf(stdout, "Saving %zu changes to %s\n", get_session_num_changes(session_ptr), out_filename);
    save_to_file(session_ptr, out_fptr);
    destroy_session(session_ptr);
    fclose(out_fptr);
    fclose(in_fptr);
    return 0;
}