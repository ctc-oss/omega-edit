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
 * This application is an example of how a saved session can be replayed.
 */

#include "../omega_edit/include/check.h"
#include "../omega_edit/include/encodings.h"
#include "../omega_edit/include/scoped_ptr.hpp"
#include "../omega_edit/omega_edit.h"
#include <cinttypes>
#include <cstring>
#include <iomanip>
#include <iostream>

using namespace std;

typedef struct file_info_struct {
    char const *in_filename = nullptr;
} file_info_t;

void session_change_cbk(const omega_session_t *session_ptr, const omega_change_t *change_ptr) {
    auto file_info_ptr = (file_info_t *) omega_session_get_user_data(session_ptr);
    const auto bytes = omega_change_get_bytes(change_ptr);
    const auto bytes_length = omega_change_get_length(change_ptr);
    // NOTE: This is for demonstration purposes only.  This is not production safe JSON.
    clog << dec << R"({ "filename" : ")" << file_info_ptr->in_filename << R"(", "num_changes" : )"
         << omega_session_get_num_changes(session_ptr) << R"(, "computed_file_size": )"
         << omega_session_get_computed_file_size(session_ptr) << R"(, "change_serial": )"
         << omega_change_get_serial(change_ptr) << R"(, "kind": ")" << omega_change_get_kind_as_char(change_ptr)
         << R"(", "offset": )" << omega_change_get_offset(change_ptr) << R"(, "length": )" << bytes_length;
    if (bytes) { clog << R"(, "bytes": ")" << string((const char *) bytes, bytes_length) << R"(")"; }
    clog << "}" << endl;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        cerr << "Reads changes from stdin, applies them to the infile and saves the results to the outfile.\n\n"
                "USAGE: "
             << argv[0] << " infile outfile" << endl;
        return -1;
    }
    file_info_t file_info;

    file_info.in_filename = argv[1];
    auto out_filename = argv[2];
    auto session_ptr = omega_scoped_ptr<omega_session_t>(
            omega_edit_create_session(file_info.in_filename, nullptr, nullptr), omega_edit_destroy_session);

    // Report stats
    int deletes = 0;
    int inserts = 0;
    int overwrites = 0;

    // Replay the changes from stdin
    while (!feof(stdin)) {
        char change_type;
        int64_t offset, length;
        omega_byte_t bytes[1024];
        omega_byte_t hex_bytes[2048];
        // NOTE: This is for demonstration purposes only.  This is not production safe parsing.
        const auto rc =
                fscanf(stdin, "%c,%" PRId64 ",%" PRId64 ",%s\n", &change_type, &offset, &length, hex_bytes);//NOLINT
        if (rc != 4) {
            cerr << "error reading change" << endl;
            abort();
        }
        if (hex_bytes[0] != 'x' &&
            length != omega_hex2bin((const char *) hex_bytes, bytes, strlen((const char *) hex_bytes))) {
            clog << "ERROR decoding: '" << hex_bytes << "'\n";
            return -1;
        }
        switch (change_type) {
            case 'D':
                omega_edit_delete(session_ptr.get(), offset, length);
                ++deletes;
                break;
            case 'I':
                omega_edit_insert_bytes(session_ptr.get(), offset, bytes, length);
                ++inserts;
                break;
            case 'O':
                omega_edit_overwrite_bytes(session_ptr.get(), offset, bytes, 0);
                ++overwrites;
                break;
            default:
                abort();
        }
        if (0 != omega_check_model(session_ptr.get())) {
            cerr << "session model has errors" << endl;
            abort();
        }
    }

    // Save the session
    omega_edit_save(session_ptr.get(), out_filename);

    // Report
    clog << "Replayed " << deletes << " delete(s), " << inserts << " insert(s), " << overwrites
         << " overwrite(s), new file size: " << omega_session_get_computed_file_size(session_ptr.get()) << endl;

    return 0;
}
