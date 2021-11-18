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
 * This application demonstrates many of the features of Omega Edit and represents an edit session where changes are
 * saved to a file where they can be replayed.
 */

#include "../src/omega_edit/include/encodings.h"
#include "../src/omega_edit/omega_edit.h"
#include <cinttypes>
#include <iomanip>
#include <iostream>

using namespace std;

typedef struct file_info_struct {
    char const *in_filename = nullptr;
    char const *save_filename = nullptr;
    FILE *save_fptr = nullptr;
    int deletes{};
    int inserts{};
    int overwrites{};
    char *bin_to_hex_buffer = nullptr;
    size_t bin_to_hex_buffer_size = 0;
} file_info_t;

int save_changes_cbk(const change_t *change_ptr, void *userdata) {
    auto file_info_ptr = (file_info_t *) userdata;
    auto change_kind = get_change_kind_as_char(change_ptr);
    switch (change_kind) {
        case 'D':
            ++file_info_ptr->deletes;
            break;
        case 'I':
            ++file_info_ptr->inserts;
            break;
        case 'O':
            ++file_info_ptr->overwrites;
            break;
        default:
            abort();
    }
    // NOTE: This is for demonstration purposes only.  This is not a production-quality format.
    const byte_t *bytes;
    const auto bytes_length = get_change_bytes(change_ptr, &bytes);
    const auto required_buffer_size = bytes_length * 2 + 1;
    if (bytes) {
        if (required_buffer_size > file_info_ptr->bin_to_hex_buffer_size) {
            do {
                file_info_ptr->bin_to_hex_buffer_size <<= 1;
            } while (required_buffer_size > file_info_ptr->bin_to_hex_buffer_size);
            file_info_ptr->bin_to_hex_buffer =
                    (char *) realloc(file_info_ptr->bin_to_hex_buffer, file_info_ptr->bin_to_hex_buffer_size);
        }
        bin2hex(bytes, file_info_ptr->bin_to_hex_buffer, bytes_length);
    } else {
        file_info_ptr->bin_to_hex_buffer[0] = 'x';
        file_info_ptr->bin_to_hex_buffer[1] = '\0';
    }
    fprintf(file_info_ptr->save_fptr, "%c,%" PRId64 ",%" PRId64 ",%s\n", change_kind, get_change_offset(change_ptr),
            get_change_length(change_ptr), file_info_ptr->bin_to_hex_buffer);
    return 0;
}

void session_change_cbk(const session_t *session_ptr, const change_t *) {
    auto file_info_ptr = (file_info_t *) get_session_user_data(session_ptr);
    file_info_ptr->deletes = file_info_ptr->inserts = file_info_ptr->overwrites = 0;
    file_info_ptr->save_fptr = fopen(file_info_ptr->save_filename, "w");
    visit_changes(session_ptr, save_changes_cbk, file_info_ptr);
    fclose(file_info_ptr->save_fptr);
}

enum display_mode_t { BIT_MODE, BYTE_MODE, CHAR_MODE };
struct view_mode_t {
    enum display_mode_t display_mode = CHAR_MODE;
};

inline void write_pretty_bits_byte(byte_t byte) {
    for (auto i = 7; 0 <= i; --i) { clog << ((byte & (1 << i)) ? '1' : '0'); }
}

void write_pretty_bits(const byte_t *ptr, int64_t size) {
    if (size > 0) {
        auto i = 0;
        write_pretty_bits_byte(ptr[i++]);
        while (i < size) {
            clog << " ";
            write_pretty_bits_byte(ptr[i++]);
        }
    }
}

void write_pretty_bytes(const byte_t *data, int64_t size) {
    if (size > 0) {
        auto i = 0;
        clog << setfill('0');
        clog << hex << setw(2) << static_cast<int>(data[i++]);
        while (i < size) { clog << " " << hex << setw(2) << (int) data[i++]; }
        clog << dec;
    }
}

void vpt_change_cbk(const viewport_t *viewport_ptr, const change_t *change_ptr = nullptr) {
    if (change_ptr) {
        clog << "Change Author: " << get_author_name(get_change_author(change_ptr))
             << ", serial: " << get_change_serial(change_ptr) << ", kind: " << get_change_kind_as_char(change_ptr)
             << endl;
    }
    clog << "'" << get_author_name(get_viewport_author(viewport_ptr))
         << "' viewport, capacity: " << get_viewport_capacity(viewport_ptr)
         << " length: " << get_viewport_length(viewport_ptr)
         << " offset: " << get_viewport_computed_offset(viewport_ptr)
         << " bit offset: " << static_cast<int>(get_viewport_bit_offset(viewport_ptr)) << endl;
    if (get_viewport_user_data(viewport_ptr)) {
        auto const *view_mode_ptr = (const view_mode_t *) get_viewport_user_data(viewport_ptr);
        switch (view_mode_ptr->display_mode) {
            case BIT_MODE:
                clog << " BIT MODE [";
                write_pretty_bits(get_viewport_data(viewport_ptr), get_viewport_length(viewport_ptr));
                clog << "]";
                break;
            case CHAR_MODE:
                clog << "CHAR MODE [";
                clog << string((const char *) get_viewport_data(viewport_ptr), get_viewport_length(viewport_ptr));
                clog << "]";
                break;
            default:// flow through
            case BYTE_MODE:
                clog << "BYTE MODE [";
                write_pretty_bytes(get_viewport_data(viewport_ptr), get_viewport_length(viewport_ptr));
                clog << "]";
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
    file_info.in_filename = "data/test1.dat";
    file_info.save_filename = "data/test1.dat.sav";
    file_info.bin_to_hex_buffer_size = 1024;
    file_info.bin_to_hex_buffer = (char *) malloc(file_info.bin_to_hex_buffer_size);

    test_infile_ptr = fopen(file_info.in_filename, "r");
    FILE *test_outfile_ptr = fopen("data/test1.dat.out", "w");

    session_ptr = create_session(test_infile_ptr, session_change_cbk, &file_info, DEFAULT_VIEWPORT_MAX_CAPACITY, 0, 0);
    const char *author_name = "Test Author";
    author_ptr = create_author(session_ptr, author_name);
    clog << "Author: " << get_author_name(author_ptr) << endl;
    clog << "File Size: " << get_computed_file_size(session_ptr) << endl;
    auto viewport1_ptr = create_viewport(author_ptr, 0, 100, vpt_change_cbk, &view_mode);
    del(author_ptr, 0, get_computed_file_size(session_ptr));
    if (0 != check_session_model(session_ptr)) { clog << __LINE__ << " session model has errors\n"; }
    undo_last_change(session_ptr);
    ins(author_ptr, 0, (const byte_t *) "++++");
    ovr(author_ptr, 5, (const byte_t *) "-");
    ins(author_ptr, 0, (const byte_t *) "++++");
    if (0 != check_session_model(session_ptr)) { clog << __LINE__ << " session model has errors\n"; }
    auto viewport2_ptr = create_viewport(author_ptr, 50, 10, vpt_change_cbk, &view_mode);
    view_mode.display_mode = display_mode_t::BYTE_MODE;
    ins(author_ptr, 71, (const byte_t *) "++++");
    ovr(author_ptr, 10, (const byte_t *) ".");
    view_mode.display_mode = display_mode_t::BIT_MODE;
    ovr(author_ptr, 0, (const byte_t *) "...");
    ovr(author_ptr, 74, (const byte_t *) ".");
    ins(author_ptr, 70, (const byte_t *) "***");
    del(author_ptr, 70, 2);
    view_mode.display_mode = display_mode_t::CHAR_MODE;

    ins(author_ptr, 10, (const byte_t *) "++++");
    ovr(author_ptr, 12, (const byte_t *) ".");

    ins(author_ptr, 0, (const byte_t *) "+++");
    ovr(author_ptr, 1, (const byte_t *) ".");
    ovr(author_ptr, 77, (const byte_t *) ".");
    del(author_ptr, 50, 3);
    ins(author_ptr, 50, (const byte_t *) "***", 3);
    del(author_ptr, 1, 50);
    undo_last_change(session_ptr);

    destroy_viewport(viewport2_ptr);
    del(author_ptr, 0, get_computed_file_size(session_ptr));
    undo_last_change(session_ptr);

    clog << "\n\nCycle through the display modes:\n";
    view_mode.display_mode = display_mode_t::CHAR_MODE;
    vpt_change_cbk(viewport1_ptr);
    view_mode.display_mode = display_mode_t::BYTE_MODE;
    vpt_change_cbk(viewport1_ptr);
    view_mode.display_mode = display_mode_t::BIT_MODE;
    vpt_change_cbk(viewport1_ptr);

    save_to_file(session_ptr, test_outfile_ptr);
    clog << "Saved " << file_info.deletes << " delete(s), " << file_info.inserts << " insert(s), "
         << file_info.overwrites << " overwrite(s) to " << file_info.save_filename << ", new file size: " << dec
         << get_computed_file_size(session_ptr) << endl;
    destroy_session(session_ptr);
    fclose(test_outfile_ptr);
    fclose(test_infile_ptr);
    free(file_info.bin_to_hex_buffer);
    return 0;
}
