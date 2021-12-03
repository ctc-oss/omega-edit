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

#define CATCH_CONFIG_MAIN

#include "../omega_edit/include/utility.h"
#include "../omega_edit/omega_edit.h"
#include "catch.hpp"
#include "test_util.h"

#include <cstdio>
#include <cstring>
#include <iostream>

using namespace std;

TEST_CASE("License check", "[LicenseCheck]") {
    const auto license = omega_license_get();
    REQUIRE(license);
    REQUIRE(strlen(license) == 576);
    REQUIRE(strstr(license, "Concurrent Technologies Corporation"));
}

TEST_CASE("Buffer Shift", "[BufferShift]") {
    auto const fill = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    auto *buffer = (omega_byte_t *) strdup(fill);
    auto buff_len = (int64_t) strlen((const char *) buffer);

    // Shift the buffer 3 bits to the right
    auto rc = omega_util_right_shift_buffer(buffer, buff_len, 3);
    REQUIRE(rc == 0);
    // Shift the buffer 5 bits to the right
    rc = omega_util_right_shift_buffer(buffer, buff_len, 5);
    REQUIRE(rc == 0);
    // We shifted a total of 8 bits (one byte) to the right, so compare the buffer against the fill plus one byte
    REQUIRE(strcmp((const char *) fill + 1, (const char *) buffer) == 0);

    // Reset the buffer
    memcpy(buffer, fill, buff_len);
    REQUIRE(strcmp((const char *) fill, (const char *) buffer) == 0);

    // Shift the buffer 6 bits to the left
    rc = omega_util_left_shift_buffer(buffer, buff_len, 6);
    REQUIRE(rc == 0);
    // Shift the buffer 2 bits to the left
    rc = omega_util_left_shift_buffer(buffer, buff_len, 2);
    REQUIRE(rc == 0);
    // We shifted a total of 8 bits (one byte) to the left, so compare the buffer against the fill plus one byte
    REQUIRE(strcmp((const char *) fill + 1, (const char *) buffer) == 0);

    free(buffer);
}

TEST_CASE("File Compare", "[UtilTests]") {
    SECTION("Identity") {
        // Same file ought to yield identical contents
        REQUIRE(compare_files("data/test1.dat", "data/test1.dat") == 0);
    }
    SECTION("Difference") {
        // Different files with different contents
        REQUIRE(compare_files("data/test1.dat", "data/test2.dat") == 1);
    }
}

typedef struct file_info_struct {
    size_t num_changes{};
} file_info_t;

void session_change_cbk(const omega_session_t *session_ptr, const omega_change_t *change_ptr) {
    auto file_info_ptr = (file_info_t *) omega_session_get_user_data(session_ptr);
    const auto bytes = omega_change_get_bytes(change_ptr);
    const auto bytes_length = omega_change_get_length(change_ptr);
    if (0 < omega_change_get_serial(change_ptr)) {
        ++file_info_ptr->num_changes;
    } else {
        --file_info_ptr->num_changes; /* this is in UNDO */
    }
    auto file_path = omega_session_get_file_path(session_ptr);
    file_path = (file_path) ? file_path : "NO FILENAME";
    clog << dec << R"({ "filename" : ")" << file_path << R"(", "num_changes" : )"
         << omega_session_get_num_changes(session_ptr) << R"(, "computed_file_size": )"
         << omega_session_get_computed_file_size(session_ptr) << R"(, "change_serial": )"
         << omega_change_get_serial(change_ptr) << R"(, "change_kind": ")" << omega_change_get_kind_as_char(change_ptr)
         << R"(", "offset": )" << omega_change_get_offset(change_ptr) << R"(, "length": )"
         << omega_change_get_length(change_ptr);
    if (bytes) { clog << R"(, "bytes": ")" << string((const char *) bytes, bytes_length) << R"(")"; }
    clog << "}" << endl;
}

TEST_CASE("Empty File Test", "[EmptyFileTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    const auto in_filename = "data/empty_file.txt";
    auto in_file = fopen(in_filename, "r");
    auto file_size = ftello(in_file);
    fclose(in_file);
    REQUIRE(0 == file_size);
    const auto session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info);
    REQUIRE(session_ptr);
    REQUIRE(strcmp(omega_session_get_file_path(session_ptr), in_filename) == 0);
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(0 < omega_edit_insert(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("0")));
    file_size += 1;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Model Test", "[ModelTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    auto in_filename = "data/model-test.txt";
    const auto session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info);
    REQUIRE(session_ptr);
    auto file_size = omega_session_get_computed_file_size(session_ptr);
    REQUIRE(file_size > 0);
    REQUIRE(0 < omega_edit_insert(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("0"), 1));
    file_size += 1;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.1.txt"));
    REQUIRE(compare_files("data/model-test.txt", "data/model-test.actual.1.txt") != 0);
    REQUIRE(compare_files("data/model-test.expected.1.txt", "data/model-test.actual.1.txt") == 0);
    REQUIRE(0 < omega_edit_insert(session_ptr, 10, reinterpret_cast<const omega_byte_t *>("0"), 1));
    file_size += 1;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.2.txt"));
    REQUIRE(compare_files("data/model-test.expected.2.txt", "data/model-test.actual.2.txt") == 0);
    REQUIRE(0 < omega_edit_insert(session_ptr, 5, reinterpret_cast<const omega_byte_t *>("xxx")));
    file_size += 3;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.3.txt"));
    REQUIRE(compare_files("data/model-test.expected.3.txt", "data/model-test.actual.3.txt") == 0);
    auto num_changes = file_info.num_changes;
    REQUIRE(0 < omega_edit_undo_last_change(session_ptr));
    REQUIRE(omega_session_get_num_undone_changes(session_ptr) == 1);
    auto last_undone_change = omega_session_get_last_undo(session_ptr);
    REQUIRE(last_undone_change);
    REQUIRE(omega_change_get_kind_as_char(last_undone_change) == 'I');
    REQUIRE(omega_change_get_offset(last_undone_change) == 5);
    REQUIRE(omega_change_get_length(last_undone_change) == 3);
    REQUIRE(file_info.num_changes == num_changes - 1);
    file_size -= 3;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.4.txt"));
    REQUIRE(compare_files("data/model-test.expected.4.txt", "data/model-test.actual.4.txt") == 0);
    REQUIRE(omega_session_get_num_undone_changes(session_ptr) == 1);
    REQUIRE(0 < omega_edit_overwrite(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("-")));
    REQUIRE(omega_session_get_num_undone_changes(session_ptr) == 0);
    REQUIRE(0 < omega_edit_overwrite(session_ptr, file_size - 1, reinterpret_cast<const omega_byte_t *>("+"), 1));
    REQUIRE(0 < omega_edit_insert(session_ptr, 5, reinterpret_cast<const omega_byte_t *>("XxXxXxX"), 7));
    auto last_change = omega_session_get_last_change(session_ptr);
    REQUIRE(omega_change_get_kind_as_char(last_change) == 'I');
    REQUIRE(omega_change_get_offset(last_change) == 5);
    REQUIRE(omega_change_get_length(last_change) == 7);
    REQUIRE(0 < omega_edit_delete(session_ptr, 7, 4));
    REQUIRE((last_change = omega_session_get_last_change(session_ptr)));
    REQUIRE(omega_change_get_kind_as_char(last_change) == 'D');
    REQUIRE(0 < omega_edit_overwrite(session_ptr, 6, reinterpret_cast<const omega_byte_t *>("O"), 0));
    REQUIRE((last_change = omega_session_get_last_change(session_ptr)));
    REQUIRE(omega_change_get_kind_as_char(last_change) == 'O');
    REQUIRE(omega_change_get_length(last_change) == 1);
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.5.txt"));
    REQUIRE(compare_files("data/model-test.expected.5.txt", "data/model-test.actual.5.txt") == 0);
    REQUIRE(0 < omega_edit_delete(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == 0);
    while (file_info.num_changes) { omega_edit_undo_last_change(session_ptr); }
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.6.txt"));
    REQUIRE(file_info.num_changes == omega_session_get_num_changes(session_ptr));
    REQUIRE(compare_files("data/model-test.txt", "data/model-test.actual.6.txt") == 0);
    omega_edit_destroy_session(session_ptr);
}

int pattern_found_cbk(int64_t match_offset, int64_t /*match_length*/, void *needles_found_ptr) {
    (*(int *) (needles_found_ptr))++;
    clog << "Pattern found at offset " << match_offset << ", total found so far: " << (*(int *) (needles_found_ptr))
         << endl;
    return 0;
}

TEST_CASE("Hanoi insert", "[ModelTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    const auto session_ptr = omega_edit_create_session(nullptr, session_change_cbk, &file_info);
    REQUIRE(session_ptr);
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == 0);
    // Hanoi test
    REQUIRE(0 < omega_edit_insert(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("00")));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(1 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(2 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert(session_ptr, 1, reinterpret_cast<const omega_byte_t *>("11")));
    REQUIRE(2 == omega_session_get_num_changes(session_ptr));
    REQUIRE(2 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(4 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert(session_ptr, 2, reinterpret_cast<const omega_byte_t *>("22")));
    REQUIRE(3 == omega_session_get_num_changes(session_ptr));
    REQUIRE(3 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(6 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert(session_ptr, 3, reinterpret_cast<const omega_byte_t *>("33")));
    REQUIRE(4 == omega_session_get_num_changes(session_ptr));
    REQUIRE(4 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(8 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert(session_ptr, 4, reinterpret_cast<const omega_byte_t *>("44")));
    REQUIRE(5 == omega_session_get_num_changes(session_ptr));
    REQUIRE(5 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(10 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert(session_ptr, 5, reinterpret_cast<const omega_byte_t *>("55")));
    REQUIRE(6 == omega_session_get_num_changes(session_ptr));
    REQUIRE(6 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(12 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert(session_ptr, 6, reinterpret_cast<const omega_byte_t *>("66")));
    REQUIRE(7 == omega_session_get_num_changes(session_ptr));
    REQUIRE(7 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(14 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert(session_ptr, 7, reinterpret_cast<const omega_byte_t *>("77")));
    REQUIRE(8 == omega_session_get_num_changes(session_ptr));
    REQUIRE(8 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(16 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert(session_ptr, 8, reinterpret_cast<const omega_byte_t *>("88")));
    REQUIRE(9 == omega_session_get_num_changes(session_ptr));
    REQUIRE(9 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(18 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert(session_ptr, 9, reinterpret_cast<const omega_byte_t *>("99")));
    REQUIRE(10 == omega_session_get_num_changes(session_ptr));
    REQUIRE(10 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(20 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert(session_ptr, 10, reinterpret_cast<const omega_byte_t *>("*****+*****")));
    REQUIRE(11 == omega_session_get_num_changes(session_ptr));
    REQUIRE(11 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(31 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_undo_last_change(session_ptr));
    REQUIRE(10 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(1 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(-11 == omega_change_get_serial(omega_session_get_last_undo(session_ptr)));
    REQUIRE(0 < omega_edit_redo_last_undo(session_ptr));
    REQUIRE(0 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.7.txt"));
    REQUIRE(file_info.num_changes == omega_session_get_num_changes(session_ptr));
    REQUIRE(compare_files("data/model-test.expected.7.txt", "data/model-test.actual.7.txt") == 0);
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Check initialization", "[InitTests]") {
    omega_session_t *session_ptr;
    file_info_t file_info;
    auto in_filename = "data/test1.dat";

    SECTION("Open data file") {
        SECTION("Create Session") {
            session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info);
            REQUIRE(session_ptr);
            REQUIRE(omega_session_get_computed_file_size(session_ptr) == 63);
            REQUIRE(0 < omega_edit_insert(session_ptr, 10, reinterpret_cast<const omega_byte_t *>("++++"), 4));
            REQUIRE(omega_session_get_computed_file_size(session_ptr) == 67);
            REQUIRE(0 < omega_edit_overwrite(session_ptr, 12, reinterpret_cast<const omega_byte_t *>("."), 1));
            REQUIRE(omega_session_get_computed_file_size(session_ptr) == 67);
            REQUIRE(0 < omega_edit_insert(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("+++")));
            REQUIRE(omega_session_get_computed_file_size(session_ptr) == 70);
            REQUIRE(0 < omega_edit_overwrite(session_ptr, 1, reinterpret_cast<const omega_byte_t *>(".")));
            REQUIRE(omega_session_get_computed_file_size(session_ptr) == 70);
            REQUIRE(0 < omega_edit_overwrite(session_ptr, 15, reinterpret_cast<const omega_byte_t *>("*")));
            REQUIRE(omega_session_get_computed_file_size(session_ptr) == 70);
            REQUIRE(0 < omega_edit_insert(session_ptr, 15, reinterpret_cast<const omega_byte_t *>("+")));
            REQUIRE(omega_session_get_computed_file_size(session_ptr) == 71);
            REQUIRE(0 < omega_edit_delete(session_ptr, 9, 5));
            REQUIRE(omega_session_get_computed_file_size(session_ptr) == 66);
            auto num_changes_before_undo = omega_session_get_num_changes(session_ptr);
            REQUIRE(0 < omega_edit_undo_last_change(session_ptr));
            REQUIRE(omega_session_get_num_undone_changes(session_ptr) == 1);
            REQUIRE(omega_session_get_num_changes(session_ptr) == num_changes_before_undo - 1);
            REQUIRE(omega_session_get_computed_file_size(session_ptr) == 71);
            REQUIRE(0 == omega_edit_save(session_ptr, "data/test1.dat.out"));
            omega_edit_destroy_session(session_ptr);
        }
    }
}

enum display_mode_t { BIT_MODE, BYTE_MODE, CHAR_MODE };
struct view_mode_t {
    enum display_mode_t display_mode = CHAR_MODE;
};

void vpt_change_cbk(const omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr) {
    if (change_ptr) { clog << "Change serial: " << omega_change_get_serial(change_ptr) << endl; }
    clog << dec << "capacity: " << omega_viewport_get_capacity(viewport_ptr)
         << " length: " << omega_viewport_get_length(viewport_ptr)
         << " offset: " << omega_viewport_get_offset(viewport_ptr) << endl;
    if (omega_viewport_get_user_data(viewport_ptr)) {
        auto const *view_mode_ptr = (const view_mode_t *) omega_viewport_get_user_data(viewport_ptr);
        switch (view_mode_ptr->display_mode) {
            case BIT_MODE:
                clog << " BIT MODE [";
                write_pretty_bits(omega_viewport_get_data(viewport_ptr), omega_viewport_get_length(viewport_ptr));
                clog << "]\n";
                break;
            case CHAR_MODE:
                clog << "CHAR MODE [";
                clog << string((const char *) omega_viewport_get_data(viewport_ptr),
                               omega_viewport_get_length(viewport_ptr));
                clog << "]\n";
                break;
            default:// flow through
            case BYTE_MODE:
                clog << "BYTE MODE [";
                write_pretty_bytes(omega_viewport_get_data(viewport_ptr), omega_viewport_get_length(viewport_ptr));
                clog << "]\n";
                break;
        }
        clog << endl;
    }
}

TEST_CASE("Search", "[SearchTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    auto in_filename = "data/search-test.txt";
    const auto session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info);
    REQUIRE(session_ptr);
    REQUIRE(0 < omega_session_get_computed_file_size(session_ptr));
    view_mode_t view_mode;
    view_mode.display_mode = CHAR_MODE;
    omega_edit_create_viewport(session_ptr, 0, 1024, vpt_change_cbk, &view_mode);
    auto needle = "needle";
    auto needle_length = strlen(needle);
    int needles_found = 0;
    REQUIRE(0 ==
            omega_edit_search(session_ptr, (omega_byte_t *) needle, needle_length, pattern_found_cbk, &needles_found));
    REQUIRE(needles_found == 5);
    REQUIRE(0 < omega_edit_insert(session_ptr, 5, reinterpret_cast<const omega_byte_t *>(needle), needle_length));
    REQUIRE(0 < omega_edit_delete(session_ptr, 16, needle_length));
    REQUIRE(0 < omega_edit_insert(session_ptr, 16, reinterpret_cast<const omega_byte_t *>(needle)));
    REQUIRE(0 < omega_edit_undo_last_change(session_ptr));
    REQUIRE(omega_session_get_num_undone_changes(session_ptr) == 1);
    REQUIRE(0 < omega_edit_undo_last_change(session_ptr));
    REQUIRE(omega_session_get_num_undone_changes(session_ptr) == 2);
    REQUIRE(0 < omega_edit_overwrite(session_ptr, 16, reinterpret_cast<const omega_byte_t *>(needle)));
    REQUIRE(omega_session_get_num_undone_changes(session_ptr) == 0);
    REQUIRE(0 == omega_edit_save(session_ptr, "data/search-test.actual.1.txt"));
    needles_found = 0;
    REQUIRE(0 ==
            omega_edit_search(session_ptr, (omega_byte_t *) needle, strlen(needle), pattern_found_cbk, &needles_found));
    REQUIRE(needles_found == 6);
    omega_edit_destroy_session(session_ptr);
    REQUIRE(compare_files("data/search-test.expected.1.txt", "data/search-test.actual.1.txt") == 0);
}

TEST_CASE("File Viewing", "[InitTests]") {
    auto const fill = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    auto const fill_length = static_cast<int64_t>(strlen(fill));
    auto const file_name = "data/test.dat.view";
    auto test_infile_ptr = fill_file(file_name, 1024, fill, fill_length);
    fclose(test_infile_ptr);
    omega_session_t *session_ptr;
    omega_viewport_t *viewport_ptr;
    view_mode_t view_mode;

    session_ptr = omega_edit_create_session(file_name, nullptr, nullptr);
    auto viewport_count = omega_session_get_num_viewports(session_ptr);
    REQUIRE(viewport_count == 0);
    view_mode.display_mode = BIT_MODE;
    viewport_ptr = omega_edit_create_viewport(session_ptr, 0, 10, vpt_change_cbk, &view_mode);
    REQUIRE(viewport_count + 1 == omega_session_get_num_viewports(session_ptr));
    view_mode.display_mode = CHAR_MODE;
    vpt_change_cbk(viewport_ptr, nullptr);
    for (int64_t offset(0); offset < omega_session_get_computed_file_size(session_ptr); ++offset) {
        REQUIRE(0 == omega_viewport_update(viewport_ptr, offset, 10 + (offset % 40)));
    }

    // Change the display mode from character mode to bit mode
    view_mode.display_mode = BIT_MODE;
    REQUIRE(0 == omega_viewport_update(viewport_ptr, 0, 20));

    view_mode.display_mode = BYTE_MODE;
    vpt_change_cbk(viewport_ptr, nullptr);

    REQUIRE(0 < omega_edit_insert(session_ptr, 3, reinterpret_cast<const omega_byte_t *>("++++")));
    viewport_count = omega_session_get_num_viewports(session_ptr);
    REQUIRE(0 == omega_edit_destroy_viewport(viewport_ptr));
    REQUIRE(viewport_count - 1 == omega_session_get_num_viewports(session_ptr));
    omega_edit_destroy_session(session_ptr);
    remove(file_name);
}
