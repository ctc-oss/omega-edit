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

#include "../omega_edit/omega_edit.h"
#include <iomanip>
#include <iostream>

using namespace std;

typedef struct file_info_struct {
    char const *in_filename = nullptr;
} file_info_t;

void session_change_cbk(const session_t *session_ptr, const change_t *change_ptr) {
    auto file_info_ptr = (file_info_t *) get_session_user_data(session_ptr);
    clog << dec << R"({ "filename" : ")" << file_info_ptr->in_filename << R"(", "num_changes" : )"
         << get_session_num_changes(session_ptr) << R"(, "computed_file_size": )" << get_computed_file_size(session_ptr)
         << R"(, "change_serial": )" << get_change_serial(change_ptr) << R"(, "kind": )"
         << get_change_kind_as_char(change_ptr) << R"(, "offset": )" << get_change_offset(change_ptr)
         << R"(, "length": )" << get_change_length(change_ptr) << R"(, "byte": )" << get_change_byte(change_ptr) << "}"
         << endl;
}

int main(int argc, char ** argv) {
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
    auto test_infile_ptr = fopen(file_info.in_filename, "r");

    session_ptr = create_session(test_infile_ptr, session_change_cbk, &file_info);
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
        uint byte;
        fscanf(stdin, "%c,%lld,%lld,%02X\n", &change_type, &offset, &length, &byte);
        switch (change_type) {
            case 'D':
                del(author_ptr, offset, length);
                ++deletes;
                break;
            case 'I':
                ins(author_ptr, offset, length, byte);
                ++inserts;
                break;
            case 'O':
                ovr(author_ptr, offset, byte);
                ++overwrites;
                break;
            default:
                abort();
        }
    }

    // Save the session
    auto test_outfile_ptr = fopen(out_filename, "w");
    save_to_file(session_ptr, test_outfile_ptr);
    fclose(test_outfile_ptr);

    // Report
    clog << "Replayed " << deletes << " delete(s), " << inserts << " insert(s), " << overwrites
         << " overwrite(s), new file size: " << get_computed_file_size(session_ptr) << endl;

    // Cleanup
    destroy_session(session_ptr);
    fclose(test_infile_ptr);
    return 0;
}
