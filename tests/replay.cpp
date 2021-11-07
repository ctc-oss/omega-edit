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
#include <iostream>

using namespace std;

typedef struct file_info_struct {
    char const *filename = nullptr;
} file_info_t;

void session_change_cbk(const session_t *session_ptr, const change_t *change_ptr) {
    auto file_info_ptr = (file_info_t *) get_session_user_data(session_ptr);
    clog << R"({ "filename" : ")" << file_info_ptr->filename << R"(", "num_changes" : )"
         << get_session_num_changes(session_ptr) << R"(, "computed_file_size": )" << get_computed_file_size(session_ptr)
         << R"(, "change_serial": )" << get_change_serial(change_ptr) << "}" << endl;
}

int main(int argc, char *argv[]) {
    FILE *test_infile_ptr;
    session_t *session_ptr;
    file_info_t file_info;
    const author_t *author_ptr;

    file_info.filename = "data/test1.dat";
    test_infile_ptr = fopen(file_info.filename, "r");
    FILE *test_outfile_ptr = fopen("data/test1.dat.out", "w");

    session_ptr = create_session(test_infile_ptr, DEFAULT_VIEWPORT_MAX_CAPACITY, session_change_cbk, &file_info);
    const char *author_name = "Test Author";
    author_ptr = create_author(session_ptr, author_name);
    clog << "Author: " << get_author_name(author_ptr) << endl;
    ins(author_ptr, 0, 4, '+');
    ins(author_ptr, 0, 4, '+');
    ins(author_ptr, 71, 4, '+');
    ovr(author_ptr, 10, '.');
    ovr(author_ptr, 0, '.');
    ovr(author_ptr, 74, '.');

    ins(author_ptr, 10, 4, '+');
    ovr(author_ptr, 12, '.');
    ins(author_ptr, 0, 3, '+');
    ovr(author_ptr, 1, '.');
    ovr(author_ptr, 77, '.');

    del(author_ptr, 1, 50);
    undo_last_change(author_ptr);

    save_to_file(session_ptr, test_outfile_ptr);

    destroy_session(session_ptr);
    fclose(test_outfile_ptr);
    fclose(test_infile_ptr);
    return 0;
}