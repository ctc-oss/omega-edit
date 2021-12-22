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
 * This application demonstrates many of the features of Omega Edit and represents an edit session where changes are
 * saved to a file where they can be replayed.
 */

#include "../omega_edit/include/check.h"
#include "../omega_edit/include/encodings.h"
#include "../omega_edit/include/scoped_ptr.hpp"
#include "../omega_edit/include/stl_string_adaptor.hpp"
#include "../omega_edit/omega_edit.h"
#include <cassert>
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

int save_changes_cbk(const omega_change_t *change_ptr, void *userdata) {
    auto file_info_ptr = (file_info_t *) userdata;
    auto change_kind = omega_change_get_kind_as_char(change_ptr);
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
    assert(file_info_ptr->deletes + file_info_ptr->inserts + file_info_ptr->overwrites ==
           omega_change_get_serial(change_ptr));
    // NOTE: This is for demonstration purposes only.  This is not a production-quality format.
    const auto bytes = omega_change_get_bytes(change_ptr);
    const auto bytes_length = omega_change_get_length(change_ptr);
    const auto required_buffer_size = bytes_length * 2 + 1;
    if (bytes) {
        if (required_buffer_size > file_info_ptr->bin_to_hex_buffer_size) {
            do {
                file_info_ptr->bin_to_hex_buffer_size <<= 1;
            } while (required_buffer_size > file_info_ptr->bin_to_hex_buffer_size);
            file_info_ptr->bin_to_hex_buffer =
                    (char *) realloc(file_info_ptr->bin_to_hex_buffer, file_info_ptr->bin_to_hex_buffer_size);
        }
        omega_bin2hex(bytes, file_info_ptr->bin_to_hex_buffer, bytes_length);
    } else {
        file_info_ptr->bin_to_hex_buffer[0] = 'x';
        file_info_ptr->bin_to_hex_buffer[1] = '\0';
    }
    fprintf(file_info_ptr->save_fptr, "%c,%" PRId64 ",%" PRId64 ",%s\n", change_kind,
            omega_change_get_offset(change_ptr), bytes_length, file_info_ptr->bin_to_hex_buffer);
    return 0;
}

void session_change_cbk(const omega_session_t *session_ptr, const omega_change_t *) {
    auto file_info_ptr = (file_info_t *) omega_session_get_user_data(session_ptr);
    file_info_ptr->deletes = file_info_ptr->inserts = file_info_ptr->overwrites = 0;
    file_info_ptr->save_fptr = fopen(file_info_ptr->save_filename, "w");
    omega_visit_changes(session_ptr, save_changes_cbk, file_info_ptr);
    fclose(file_info_ptr->save_fptr);
}

enum display_mode_t { BIT_MODE, BYTE_MODE, CHAR_MODE };
struct view_mode_t {
    enum display_mode_t display_mode = CHAR_MODE;
};

inline void write_pretty_bits_byte(omega_byte_t byte) {
    for (auto i = 7; 0 <= i; --i) { clog << ((byte & (1 << i)) ? '1' : '0'); }
}

void write_pretty_bits(const omega_byte_t *ptr, int64_t size) {
    if (size > 0) {
        auto i = 0;
        write_pretty_bits_byte(ptr[i++]);
        while (i < size) {
            clog << " ";
            write_pretty_bits_byte(ptr[i++]);
        }
    }
}

void write_pretty_bytes(const omega_byte_t *data, int64_t size) {
    if (size > 0) {
        auto i = 0;
        clog << setfill('0');
        clog << hex << setw(2) << static_cast<int>(data[i++]);
        while (i < size) { clog << " " << hex << setw(2) << (int) data[i++]; }
        clog << dec;
    }
}

void vpt_change_cbk(const omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr = nullptr) {
    if (change_ptr) {
        clog << "Change serial: " << omega_change_get_serial(change_ptr)
             << ", kind: " << omega_change_get_kind_as_char(change_ptr)
             << ", offset: " << omega_change_get_offset(change_ptr)
             << ", length: " << omega_change_get_length(change_ptr) << endl;
    }
    clog << " capacity: " << omega_viewport_get_capacity(viewport_ptr)
         << " length: " << omega_viewport_get_length(viewport_ptr)
         << " offset: " << omega_viewport_get_offset(viewport_ptr) << endl;
    if (omega_viewport_get_user_data(viewport_ptr)) {
        auto const *view_mode_ptr = (const view_mode_t *) omega_viewport_get_user_data(viewport_ptr);
        switch (view_mode_ptr->display_mode) {
            case BIT_MODE:
                clog << " BIT MODE [";
                write_pretty_bits(omega_viewport_get_data(viewport_ptr), omega_viewport_get_length(viewport_ptr));
                clog << "]";
                break;
            case CHAR_MODE:
                clog << "CHAR MODE [";
                clog << string((const char *) omega_viewport_get_data(viewport_ptr),
                               omega_viewport_get_length(viewport_ptr));
                clog << "]";
                break;
            default:// flow through
            case BYTE_MODE:
                clog << "BYTE MODE [";
                write_pretty_bytes(omega_viewport_get_data(viewport_ptr), omega_viewport_get_length(viewport_ptr));
                clog << "]";
                break;
        }
        clog << endl;
    }
}

int main(int /*argc*/, char ** /*argv*/) {
    file_info_t file_info;
    view_mode_t view_mode;

    view_mode.display_mode = CHAR_MODE;
    file_info.in_filename = "data/test1.dat";
    file_info.save_filename = "data/test1.dat.sav";
    file_info.bin_to_hex_buffer_size = 1024;
    file_info.bin_to_hex_buffer = (char *) malloc(file_info.bin_to_hex_buffer_size);

    auto session_ptr = omega_scoped_ptr<omega_session_t>(
            omega_edit_create_session(file_info.in_filename, session_change_cbk, &file_info),
            omega_edit_destroy_session);
    clog << "File Size: " << omega_session_get_computed_file_size(session_ptr.get()) << endl;
    auto viewport1_ptr = omega_edit_create_viewport(session_ptr.get(), 0, 100, vpt_change_cbk, &view_mode);
    omega_edit_delete(session_ptr.get(), 0, omega_session_get_computed_file_size(session_ptr.get()));
    assert(1 == omega_change_get_serial(omega_session_get_last_change(session_ptr.get())));
    if (0 != omega_check_model(session_ptr.get())) { clog << __LINE__ << " session model has errors\n"; }
    omega_edit_undo_last_change(session_ptr.get());
    omega_edit_insert_string(session_ptr.get(), 0, "++++");
    omega_edit_overwrite_string(session_ptr.get(), 5, "-");
    omega_edit_insert_string(session_ptr.get(), 0, "++++");
    if (0 != omega_check_model(session_ptr.get())) { clog << __LINE__ << " session model has errors\n"; }
    auto viewport2_ptr = omega_edit_create_viewport(session_ptr.get(), 50, 10, vpt_change_cbk, &view_mode);
    view_mode.display_mode = display_mode_t::BYTE_MODE;
    omega_edit_insert(session_ptr.get(), 71, "++++", 4);
    omega_edit_overwrite(session_ptr.get(), 10, ".", 0);
    view_mode.display_mode = display_mode_t::BIT_MODE;
    omega_edit_overwrite(session_ptr.get(), 0, "...", 3);
    omega_edit_undo_last_change(session_ptr.get());
    omega_edit_redo_last_undo(session_ptr.get());
    omega_edit_overwrite(session_ptr.get(), 74, ".", 0);
    omega_edit_insert(session_ptr.get(), 70, "***", 0);
    omega_edit_delete(session_ptr.get(), 70, 2);
    view_mode.display_mode = display_mode_t::CHAR_MODE;
    omega_edit_insert_string(session_ptr.get(), 10, "++++");
    omega_edit_overwrite_bytes(session_ptr.get(), 12, (const omega_byte_t *) ".", 0);
    omega_edit_insert_bytes(session_ptr.get(), 0, (const omega_byte_t *) "+++", 0);
    omega_edit_overwrite_bytes(session_ptr.get(), 1, (const omega_byte_t *) ".", 0);
    omega_edit_overwrite_bytes(session_ptr.get(), 77, (const omega_byte_t *) ".", 0);
    omega_edit_delete(session_ptr.get(), 50, 3);
    omega_edit_insert_bytes(session_ptr.get(), 50, (const omega_byte_t *) "***", 3);
    omega_edit_delete(session_ptr.get(), 1, 50);
    omega_edit_undo_last_change(session_ptr.get());
    omega_edit_destroy_viewport(viewport2_ptr);
    omega_edit_delete(session_ptr.get(), 0, omega_session_get_computed_file_size(session_ptr.get()));
    omega_edit_undo_last_change(session_ptr.get());

    clog << "\n\nCycle through the display modes:\n";
    view_mode.display_mode = display_mode_t::CHAR_MODE;
    vpt_change_cbk(viewport1_ptr);
    view_mode.display_mode = display_mode_t::BYTE_MODE;
    vpt_change_cbk(viewport1_ptr);
    view_mode.display_mode = display_mode_t::BIT_MODE;
    vpt_change_cbk(viewport1_ptr);

    omega_edit_save(session_ptr.get(), "data/test1.dat.out");
    clog << "Saved " << file_info.deletes << " delete(s), " << file_info.inserts << " insert(s), "
         << file_info.overwrites << " overwrite(s) to " << file_info.save_filename << ", new file size: " << dec
         << omega_session_get_computed_file_size(session_ptr.get()) << endl;
    free(file_info.bin_to_hex_buffer);
    return 0;
}
