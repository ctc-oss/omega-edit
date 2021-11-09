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
#include <iomanip>

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

enum display_mode_t { BIT_MODE, BYTE_MODE, CHAR_MODE };
struct view_mode_t {
    enum display_mode_t display_mode = CHAR_MODE;
};

inline void write_pretty_bits_byte(uint8_t byte) {
    for (auto i = 7; 0 <= i; --i) { clog << ((byte & (1 << i)) ? '1' : '0'); }
}

void write_pretty_bits(const uint8_t *ptr, int64_t size) {
    if (size > 0) {
        auto i = 0;
        write_pretty_bits_byte(ptr[i++]);
        while (i < size) {
            clog << " ";
            write_pretty_bits_byte(ptr[i++]);
        }
    }
}

void write_pretty_bytes(const uint8_t *data, int64_t size) {
    if (size > 0) {
        auto i = 0;
        clog << setfill('0');
        clog << hex << setw(2) << static_cast<int>(data[i++]);
        while (i < size) { clog << " " << hex << setw(2) << (int) data[i++]; }
    }
}

void vpt_change_cbk(const viewport_t *viewport_ptr, const change_t *change_ptr) {
    if (change_ptr) { clog << "Change Author: " << get_author_name(get_change_author(change_ptr)) << endl; }
    clog << "'" << get_author_name(get_viewport_author(viewport_ptr))
         << "' viewport, capacity: " << get_viewport_capacity(viewport_ptr)
         << " length: " << get_viewport_length(viewport_ptr)
         << " offset: " << get_viewport_computed_offset(viewport_ptr)
         << " bit offset:" << get_viewport_bit_offset(viewport_ptr) << endl;
    if (get_viewport_user_data(viewport_ptr)) {
        auto const *view_mode_ptr = (const view_mode_t *) get_viewport_user_data(viewport_ptr);
        switch (view_mode_ptr->display_mode) {
            case BIT_MODE:
                clog << " BIT MODE [";
                write_pretty_bits(get_viewport_data(viewport_ptr), get_viewport_length(viewport_ptr));
                clog << "]\n";
                break;
            case CHAR_MODE:
                clog << "CHAR MODE [";
                clog << string((const char *) get_viewport_data(viewport_ptr), get_viewport_length(viewport_ptr));
                clog << "]\n";
                break;
            default:// flow through
            case BYTE_MODE:
                clog << "BYTE MODE [";
                write_pretty_bytes(get_viewport_data(viewport_ptr), get_viewport_length(viewport_ptr));
                clog << "]\n";
                break;
        }
        clog << endl;
    }
}

int main(int /*argc*/, char ** /*argv*/) {
    FILE *test_infile_ptr;
    session_t *session_ptr;
    file_info_t file_info;
    const author_t *author_ptr;
    view_mode_t view_mode;

    view_mode.display_mode = CHAR_MODE;
    file_info.filename = "data/test1.dat";
    test_infile_ptr = fopen(file_info.filename, "r");
    FILE *test_outfile_ptr = fopen("data/test1.dat.out", "w");

    session_ptr = create_session(test_infile_ptr, session_change_cbk, &file_info, DEFAULT_VIEWPORT_MAX_CAPACITY, 0, 0);
    const char *author_name = "Test Author";
    author_ptr = create_author(session_ptr, author_name);
    auto viewport_ptr = create_viewport(author_ptr, 0, 10, vpt_change_cbk, &view_mode);
    clog << "Author: " << get_author_name(author_ptr) << endl;
    clog << "File Size: " << get_computed_file_size(session_ptr) << endl;
    del(author_ptr, 0, get_computed_file_size(session_ptr));
    undo_last_change(author_ptr);
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
    del(author_ptr, 0, get_computed_file_size(session_ptr));

    save_to_file(session_ptr, test_outfile_ptr);

    destroy_session(session_ptr);
    fclose(test_outfile_ptr);
    fclose(test_infile_ptr);
    return 0;
}