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
 * This application is an example of how a saved session can be replayed.
 */

#include "../omega_edit/omega_edit.h"
#include "../omega_edit/omega_util.h"
#include <cinttypes>
#include <iomanip>
#include <iostream>

using namespace std;

typedef struct file_info_struct {
    char const *in_filename = nullptr;
} file_info_t;

void session_change_cbk(const session_t *session_ptr, const change_t *change_ptr) {
    auto file_info_ptr = (file_info_t *) get_session_user_data(session_ptr);
    const byte_t *bytes;
    const auto length = get_change_bytes(change_ptr, &bytes);
    // NOTE: This is for demonstration purposes only.  This is not production safe JSON.
    clog << dec << R"({ "filename" : ")" << file_info_ptr->in_filename << R"(", "num_changes" : )"
         << get_session_num_changes(session_ptr) << R"(, "computed_file_size": )" << get_computed_file_size(session_ptr)
         << R"(, "change_serial": )" << get_change_serial(change_ptr) << R"(, "kind": ")"
         << get_change_kind_as_char(change_ptr) << R"(", "offset": )" << get_change_offset(change_ptr)
         << R"(, "length": )" << get_change_length(change_ptr);
    if (bytes) {
        clog << R"(, "bytes": ")" << string((const char *) bytes, length) << R"(")";
    }
    clog << "}" << endl;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr,
                "Reads changes from stdin, applies them to the infile and saves the results to the outfile.\n\n"
                "USAGE: %s infile outfile\n",
                argv[0]);
        return -1;
    }
    session_t *session_ptr;
    const author_t *author_ptr;
    file_info_t file_info;

    file_info.in_filename = argv[1];
    auto out_filename = argv[2];
    auto in_fptr = fopen(file_info.in_filename, "r");
    if (!in_fptr) {
        fprintf(stderr, "failed to open %s for reading\n", file_info.in_filename);
        return -1;
    }
    auto out_fptr = fopen(out_filename, "w");
    if (!out_fptr) {
        fprintf(stderr, "failed to open %s for writing\n", out_filename);
        return -1;
    }

    session_ptr = create_session(in_fptr, session_change_cbk, &file_info);
    const char *author_name = "Test Author";
    author_ptr = create_author(session_ptr, author_name);

    // Report stats
    int deletes = 0;
    int inserts = 0;
    int overwrites = 0;

    // Replay the changes from stdin
    while (!feof(stdin)) {
        char change_type;
        int64_t offset, length;
        byte_t bytes[1024];
        byte_t hex_bytes[2048];
        // NOTE: This is for demonstration purposes only.  This is not production safe parsing.
        fscanf(stdin, "%c,%" PRId64 ",%" PRId64 ",%s\n", &change_type, &offset, &length, hex_bytes);
        if (hex_bytes[0] != 'x' &&
            length != hex2bin((const char *) hex_bytes, bytes, strlen((const char *) hex_bytes))) {
            clog << "ERROR decoding: '" << hex_bytes << "'\n";
            return -1;
        }
        switch (change_type) {
            case 'D':
                del(author_ptr, offset, length);
                ++deletes;
                break;
            case 'I':
                ins(author_ptr, offset, bytes, length);
                ++inserts;
                break;
            case 'O':
                ovr(author_ptr, offset, bytes, 0);
                ++overwrites;
                break;
            default:
                abort();
        }
    }

    // Save the session
    save_to_file(session_ptr, out_fptr);
    fclose(out_fptr);

    // Report
    clog << "Replayed " << deletes << " delete(s), " << inserts << " insert(s), " << overwrites
         << " overwrite(s), new file size: " << get_computed_file_size(session_ptr) << endl;

    // Cleanup
    destroy_session(session_ptr);
    fclose(in_fptr);
    return 0;
}
