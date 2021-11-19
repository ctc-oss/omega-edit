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

#include "../src/omega_edit/omega_edit.h"
#include <iostream>
#include <iomanip>
#include <string>

using namespace std;

enum display_mode_t { BIT_MODE, BYTE_MODE, CHAR_MODE };
struct view_mode_t {
    enum display_mode_t display_mode = BYTE_MODE;
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
    }
}

void vpt_change_cbk(const viewport_t *viewport_ptr, const change_t *) {
    if (get_viewport_user_data(viewport_ptr)) {
        auto const *view_mode_ptr = (const view_mode_t *) get_viewport_user_data(viewport_ptr);
        switch (view_mode_ptr->display_mode) {
            case BIT_MODE:
                write_pretty_bits(get_viewport_data(viewport_ptr), get_viewport_length(viewport_ptr));
                break;
            case CHAR_MODE:
                clog << string((const char *) get_viewport_data(viewport_ptr), get_viewport_length(viewport_ptr));
                break;
            default:// flow through
            case BYTE_MODE:
                write_pretty_bytes(get_viewport_data(viewport_ptr), get_viewport_length(viewport_ptr));
                break;
        }
    }
}

inline display_mode_t char_to_display_mode(char c) {
    switch(c) {
        case 'b':
            return display_mode_t::BIT_MODE;
        case 'c':
            return display_mode_t::CHAR_MODE;
        default:
            return display_mode_t::BYTE_MODE;
    }
}

int main(int argc, char **argv) {
    if (argc != 5) {
        fprintf(stderr,
                "This program displays a slice from the infile using an Omega Edit viewport.  The display modes are\n"
                "'c' for character mode, 'b' for bit mode, and 'B' for byte mode\n\n"
                "USAGE: %s display_mode infile offset length\n",
                argv[0]);
        return -1;
    }
    auto in_filename = argv[2];
    auto in_fptr = fopen(in_filename, "r");
    if (!in_fptr) {
        fprintf(stderr, "failed to open %s for reading\n", in_filename);
        return -1;
    }
    auto offset = stoll(argv[3]);
    auto length = stoll(argv[4]);
    view_mode_t view_mode;
    view_mode.display_mode = char_to_display_mode(argv[1][0]);
    auto session_ptr = create_session_fptr(in_fptr, nullptr, nullptr);
    if (session_ptr) {
        auto author_ptr = create_author(session_ptr, "peek");
        create_viewport(author_ptr, offset, length, vpt_change_cbk, &view_mode);
        destroy_session(session_ptr);
    } else {
        fprintf(stderr, "failed to create session, probably because the offset and/or length are out of range for the\n"
                        "given input file\n");
    }
    fclose(in_fptr);
    return 0;
}
