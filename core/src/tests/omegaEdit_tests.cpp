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

#include "omega_edit.h"
#include "omega_edit/character_counts.h"
#include "omega_edit/check.h"
#include "omega_edit/config.h"
#include "omega_edit/encode.h"
#include "omega_edit/stl_string_adaptor.hpp"
#include "omega_edit/utility.h"

#include <test_util.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_contains.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sys/stat.h>
#include <thread>

using namespace std;
namespace fs = std::filesystem;

using Catch::Matchers::Contains;
using Catch::Matchers::EndsWith;
using Catch::Matchers::Equals;


TEST_CASE("Size Tests", "[SizeTests]") {
    REQUIRE(1 == sizeof(omega_byte_t)); //must always be 1-byte
    REQUIRE(4 == sizeof(int));
    REQUIRE(8 == sizeof(int64_t)); //explicit 8-bytes
    REQUIRE(8 == sizeof(long long));
    REQUIRE(8 == sizeof(size_t));
    REQUIRE(8 == sizeof(void *));
}

TEST_CASE("Exported Constants", "[Constants]") {
    REQUIRE(omega_session_byte_frequency_profile_dos_eol_index() == OMEGA_EDIT_PROFILE_DOS_EOL);
    REQUIRE(omega_session_byte_frequency_profile_size() == OMEGA_EDIT_BYTE_FREQUENCY_PROFILE_SIZE);
    REQUIRE(sizeof(omega_byte_frequency_profile_t)/sizeof(int64_t) == omega_session_byte_frequency_profile_size());
}

TEST_CASE("Bit Manipulation", "[BitManip]") {
    REQUIRE(1 << 31 == -2147483648);
    REQUIRE(~(1 << 31) == 2147483647);
}

TEST_CASE("Model Tests", "[ModelTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    const auto in_filename_str = std::string(MAKE_PATH("model-test.dat"));
    auto in_filename = in_filename_str.c_str();
    const auto session_ptr =
            omega_edit_create_session(in_filename, session_change_cbk, &file_info, ALL_EVENTS, nullptr);
    REQUIRE(session_ptr);
    auto file_size = omega_session_get_computed_file_size(session_ptr);
    REQUIRE(file_size > 0);
    REQUIRE(0 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("0"), 1));
    file_size += 1;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(1 == omega_session_get_num_change_transactions(session_ptr));
    char saved_filename[FILENAME_MAX];
    omega_util_remove_file(MAKE_PATH("test_dir/model-test.actual.1.dat"));
    omega_util_remove_directory(MAKE_PATH("test_dir"));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("test_dir/model-test.actual.1.dat"),
        omega_io_flags_t::IO_FLG_NONE, saved_filename));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("model-test.expected.1.dat"),
        MAKE_PATH("test_dir/model-test.actual.1.dat")));
    omega_util_remove_file(MAKE_PATH("model-test.actual.1.dat"));
    REQUIRE(0 == omega_util_remove_file(MAKE_PATH("test_dir/model-test.actual.1.dat")));
    REQUIRE(0 == omega_util_remove_directory(MAKE_PATH("test_dir")));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("model-test.actual.1.dat"), omega_io_flags_t::IO_FLG_NONE,
        saved_filename));
    REQUIRE(0 != omega_util_compare_files(MAKE_PATH("model-test.dat"), MAKE_PATH("model-test.actual.1.dat")));
    REQUIRE(0 ==
        omega_util_compare_files(MAKE_PATH("model-test.expected.1.dat"), MAKE_PATH("model-test.actual.1.dat")));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("model-test.actual.1.dat"), saved_filename));
    omega_util_remove_file(MAKE_PATH("model-test.actual.1-1.dat"));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("model-test.actual.1.dat"), omega_io_flags_t::IO_FLG_NONE,
        saved_filename));
    REQUIRE(0 ==
        omega_util_compare_files(MAKE_PATH("model-test.actual.1.dat"), MAKE_PATH("model-test.actual.1-1.dat")));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("model-test.actual.1-1.dat"), saved_filename));
    omega_util_remove_file(MAKE_PATH("model-test.actual.1-2.dat"));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("model-test.actual.1.dat"), omega_io_flags_t::IO_FLG_NONE,
        saved_filename));
    REQUIRE(0 ==
        omega_util_compare_files(MAKE_PATH("model-test.actual.1.dat"), MAKE_PATH("model-test.actual.1-2.dat")));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("model-test.actual.1-2.dat"), saved_filename));
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 10, reinterpret_cast<const omega_byte_t *>("0"), 1));
    file_size += 1;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    omega_util_remove_file(MAKE_PATH("model-test.actual.2.dat"));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("model-test.actual.2.dat"), omega_io_flags_t::IO_FLG_NONE,
        saved_filename));
    REQUIRE(0 ==
        omega_util_compare_files(MAKE_PATH("model-test.expected.2.dat"), MAKE_PATH("model-test.actual.2.dat")));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("model-test.actual.2.dat"), saved_filename));
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 5, reinterpret_cast<const omega_byte_t *>("xxx"), 0));
    file_size += 3;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("model-test.actual.3.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        saved_filename));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("model-test.actual.3.dat"), saved_filename));
    REQUIRE(0 ==
        omega_util_compare_files(MAKE_PATH("model-test.expected.3.dat"), MAKE_PATH("model-test.actual.3.dat")));
    auto num_changes = file_info.num_changes;
    REQUIRE(num_changes * -1 == omega_edit_undo_last_change(session_ptr));
    REQUIRE(1 == omega_session_get_num_undone_changes(session_ptr));
    auto last_undone_change = omega_session_get_last_undo(session_ptr);
    REQUIRE(last_undone_change);
    REQUIRE('I' == omega_change_get_kind_as_char(last_undone_change));
    REQUIRE(5 == omega_change_get_offset(last_undone_change));
    REQUIRE(3 == omega_change_get_length(last_undone_change));
    REQUIRE(file_info.num_changes == num_changes - 1);
    file_size -= 3;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("model-test.actual.4.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        saved_filename));
    REQUIRE(0 ==
        omega_util_compare_files(MAKE_PATH("model-test.expected.4.dat"), MAKE_PATH("model-test.actual.4.dat")));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("model-test.actual.4.dat"), saved_filename));
    REQUIRE(1 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(0 < omega_edit_overwrite_string(session_ptr, 0, "-"));
    REQUIRE(0 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(0 < omega_edit_overwrite_bytes(session_ptr, file_size - 1, reinterpret_cast<const omega_byte_t *>("+"), 1));
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 5, reinterpret_cast<const omega_byte_t *>("XxXxXxX"), 7));
    auto last_change = omega_session_get_last_change(session_ptr);
    REQUIRE('I' == omega_change_get_kind_as_char(last_change));
    REQUIRE(5 == omega_change_get_offset(last_change));
    REQUIRE(7 == omega_change_get_length(last_change));
    REQUIRE(0 < omega_edit_delete(session_ptr, 7, 4));
    REQUIRE((last_change = omega_session_get_last_change(session_ptr)));
    REQUIRE('D' == omega_change_get_kind_as_char(last_change));
    REQUIRE(0 < omega_edit_overwrite_bytes(session_ptr, 6, reinterpret_cast<const omega_byte_t *>("O"), 0));
    REQUIRE((last_change = omega_session_get_last_change(session_ptr)));
    REQUIRE('O' == omega_change_get_kind_as_char(last_change));
    REQUIRE(1 == omega_change_get_length(last_change));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("model-test.actual.5.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        nullptr));
    REQUIRE(0 ==
        omega_util_compare_files(MAKE_PATH("model-test.expected.5.dat"), MAKE_PATH("model-test.actual.5.dat")));
    REQUIRE(0 < omega_edit_delete(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));
    while (file_info.num_changes) { omega_edit_undo_last_change(session_ptr); }
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("model-test.actual.6.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        nullptr));
    REQUIRE(file_info.num_changes == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("model-test.dat"), MAKE_PATH("model-test.actual.6.dat")));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Detect BOM", "[DetectBOM]") {
    REQUIRE(BOM_UNKNOWN == omega_util_cstring_to_BOM(""));
    REQUIRE(BOM_UNKNOWN == omega_util_cstring_to_BOM("unknown"));
    auto session_ptr = omega_edit_create_session(MAKE_PATH("utf-8_1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    auto bom = omega_session_detect_BOM(session_ptr, 0);
    REQUIRE(bom == BOM_NONE);
    REQUIRE(0 == omega_util_BOM_size(bom));
    REQUIRE(0 == strcmp("none", omega_util_BOM_to_cstring(bom)));
    REQUIRE(BOM_NONE == omega_util_cstring_to_BOM("none"));
    omega_edit_destroy_session(session_ptr);
    session_ptr = omega_edit_create_session(MAKE_PATH("utf-8bom_1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    bom = omega_session_detect_BOM(session_ptr, 0);
    REQUIRE(bom == BOM_UTF8);
    REQUIRE(3 == omega_util_BOM_size(bom));
    REQUIRE(0 == strcmp("UTF-8", omega_util_BOM_to_cstring(bom)));
    REQUIRE(BOM_UTF8 == omega_util_cstring_to_BOM("UTF-8"));
    omega_edit_destroy_session(session_ptr);
    session_ptr = omega_edit_create_session(MAKE_PATH("utf-16le_1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    bom = omega_session_detect_BOM(session_ptr, 0);
    REQUIRE(bom == BOM_UTF16LE);
    REQUIRE(2 == omega_util_BOM_size(bom));
    REQUIRE(0 == strcmp("UTF-16LE", omega_util_BOM_to_cstring(bom)));
    REQUIRE(BOM_UTF16LE == omega_util_cstring_to_BOM("UTF-16LE"));
    omega_edit_destroy_session(session_ptr);
    session_ptr = omega_edit_create_session(MAKE_PATH("utf-16be_1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    bom = omega_session_detect_BOM(session_ptr, 0);
    REQUIRE(bom == BOM_UTF16BE);
    REQUIRE(2 == omega_util_BOM_size(bom));
    REQUIRE(0 == strcmp("UTF-16BE", omega_util_BOM_to_cstring(bom)));
    REQUIRE(BOM_UTF16BE == omega_util_cstring_to_BOM("UTF-16BE"));
    omega_edit_destroy_session(session_ptr);
    session_ptr = omega_edit_create_session(MAKE_PATH("utf-32le_1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    bom = omega_session_detect_BOM(session_ptr, 0);
    REQUIRE(bom == BOM_UTF32LE);
    REQUIRE(4 == omega_util_BOM_size(bom));
    REQUIRE(0 == strcmp("UTF-32LE", omega_util_BOM_to_cstring(bom)));
    REQUIRE(BOM_UTF32LE == omega_util_cstring_to_BOM("UTF-32LE"));
    omega_edit_destroy_session(session_ptr);
    session_ptr = omega_edit_create_session(MAKE_PATH("utf-32be_1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    bom = omega_session_detect_BOM(session_ptr, 0);
    REQUIRE(bom == BOM_UTF32BE);
    REQUIRE(4 == omega_util_BOM_size(bom));
    REQUIRE(0 == strcmp("UTF-32BE", omega_util_BOM_to_cstring(bom)));
    REQUIRE(BOM_UTF32BE == omega_util_cstring_to_BOM("UTF-32BE"));
    omega_edit_destroy_session(session_ptr);
    session_ptr = omega_edit_create_session(MAKE_PATH("ascii_1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    bom = omega_session_detect_BOM(session_ptr, 0);
    REQUIRE(bom == BOM_NONE);
    REQUIRE(0 == strcmp("none", omega_util_BOM_to_cstring(bom)));
    REQUIRE(BOM_NONE == omega_util_cstring_to_BOM("none"));
    omega_edit_destroy_session(session_ptr);
    session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    bom = omega_session_detect_BOM(session_ptr, 0);
    REQUIRE(bom == BOM_NONE);
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Character Counts", "[CharCounts]") {
    const auto char_counts_ptr = omega_character_counts_create();
    REQUIRE(char_counts_ptr);
    REQUIRE(BOM_UNKNOWN == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_single_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_invalid_bytes(char_counts_ptr));

    auto session_ptr = omega_edit_create_session(MAKE_PATH("utf-8_1.dat"), nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_character_counts(session_ptr, char_counts_ptr, 0, 0,
        omega_session_detect_BOM(session_ptr, 0)));
    REQUIRE(BOM_NONE == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_bom_bytes(char_counts_ptr));
    REQUIRE(5 == omega_character_counts_single_byte_chars(char_counts_ptr));
    REQUIRE(1 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(1 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_invalid_bytes(char_counts_ptr));
    omega_edit_destroy_session(session_ptr);

    session_ptr = omega_edit_create_session(MAKE_PATH("utf-8bom_1.dat"), nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_character_counts(session_ptr, char_counts_ptr, 0, 0,
        omega_session_detect_BOM(session_ptr, 0)));
    REQUIRE(BOM_UTF8 == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(3 == omega_character_counts_bom_bytes(char_counts_ptr));
    REQUIRE(5 == omega_character_counts_single_byte_chars(char_counts_ptr));
    REQUIRE(1 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(1 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_invalid_bytes(char_counts_ptr));

    // Force invalid bytes by not including the full sequence of a triple-byte character (e.g., ™).
    // Removing the last 2 bytes removes the trailing newline and the last byte of the 3-byte ™ character.
    REQUIRE(0 == omega_session_character_counts(session_ptr, char_counts_ptr, 0,
        omega_session_get_computed_file_size(session_ptr) - 2,
        omega_session_detect_BOM(session_ptr, 0)));
    REQUIRE(BOM_UTF8 == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(3 == omega_character_counts_bom_bytes(char_counts_ptr));
    REQUIRE(4 == omega_character_counts_single_byte_chars(char_counts_ptr)); // minus the newline
    REQUIRE(1 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(2 == omega_character_counts_invalid_bytes(char_counts_ptr)); // first 2 bytes of the 3-byte ™ character
    omega_edit_destroy_session(session_ptr);

    session_ptr = omega_edit_create_session(MAKE_PATH("utf-16le_1.dat"), nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_character_counts(session_ptr, char_counts_ptr, 0, 0,
        omega_session_detect_BOM(session_ptr, 0)));
    REQUIRE(BOM_UTF16LE == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(2 == omega_character_counts_bom_bytes(char_counts_ptr));
    REQUIRE(5 == omega_character_counts_single_byte_chars(char_counts_ptr));
    REQUIRE(2 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_invalid_bytes(char_counts_ptr));
    omega_edit_destroy_session(session_ptr);

    session_ptr = omega_edit_create_session(MAKE_PATH("utf-16be_1.dat"), nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_character_counts(session_ptr, char_counts_ptr, 0, 0,
        omega_session_detect_BOM(session_ptr, 0)));
    REQUIRE(BOM_UTF16BE == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(2 == omega_character_counts_bom_bytes(char_counts_ptr));
    REQUIRE(5 == omega_character_counts_single_byte_chars(char_counts_ptr));
    REQUIRE(2 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_invalid_bytes(char_counts_ptr));
    omega_edit_destroy_session(session_ptr);

    session_ptr = omega_edit_create_session(MAKE_PATH("utf-32le_1.dat"), nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_character_counts(session_ptr, char_counts_ptr, 0, 0,
        omega_session_detect_BOM(session_ptr, 0)));
    REQUIRE(BOM_UTF32LE == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(4 == omega_character_counts_bom_bytes(char_counts_ptr));
    REQUIRE(5 == omega_character_counts_single_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(2 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_invalid_bytes(char_counts_ptr));
    omega_edit_destroy_session(session_ptr);

    session_ptr = omega_edit_create_session(MAKE_PATH("utf-32be_1.dat"), nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_character_counts(session_ptr, char_counts_ptr, 0, 0,
        omega_session_detect_BOM(session_ptr, 0)));
    REQUIRE(BOM_UTF32BE == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(4 == omega_character_counts_bom_bytes(char_counts_ptr));
    REQUIRE(5 == omega_character_counts_single_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(2 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_invalid_bytes(char_counts_ptr));
    omega_edit_destroy_session(session_ptr);

    session_ptr = omega_edit_create_session(MAKE_PATH("ascii_1.dat"), nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_character_counts(session_ptr, char_counts_ptr, 0, 0,
        omega_session_detect_BOM(session_ptr, 0)));
    REQUIRE(BOM_NONE == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_bom_bytes(char_counts_ptr));
    REQUIRE(14 == omega_character_counts_single_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_invalid_bytes(char_counts_ptr));
    omega_edit_destroy_session(session_ptr);

    session_ptr = omega_edit_create_session(MAKE_PATH("ascii-dos_1.dat"), nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_character_counts(session_ptr, char_counts_ptr, 0, 0,
        omega_session_detect_BOM(session_ptr, 0)));
    REQUIRE(BOM_NONE == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_bom_bytes(char_counts_ptr));
    REQUIRE(15 == omega_character_counts_single_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_invalid_bytes(char_counts_ptr));
    omega_edit_destroy_session(session_ptr);

    session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_character_counts(session_ptr, char_counts_ptr, 0, 0,
        omega_session_detect_BOM(session_ptr, 0)));
    REQUIRE(BOM_NONE == omega_character_counts_get_BOM(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_bom_bytes(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_single_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_double_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_triple_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_quad_byte_chars(char_counts_ptr));
    REQUIRE(0 == omega_character_counts_invalid_bytes(char_counts_ptr));
    omega_edit_destroy_session(session_ptr);
    omega_character_counts_destroy(char_counts_ptr);
}

TEST_CASE("Hanoi insert", "[ModelTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    omega_byte_frequency_profile_t byte_frequency_profile;
    const auto session_ptr = omega_edit_create_session(nullptr, session_change_cbk, &file_info, ALL_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(omega_session_get_checkpoint_directory(session_ptr));
    REQUIRE(0 < strlen(omega_session_get_checkpoint_directory(session_ptr)));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));
    // Hanoi test
    int64_t change_serial;
    REQUIRE(0 <
        (change_serial = omega_edit_insert_bytes(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("00"), 0)));
    auto change_ptr = omega_session_get_change(session_ptr, change_serial);
    REQUIRE(change_ptr);
    REQUIRE('I' == omega_change_get_kind_as_char(change_ptr));
    REQUIRE(0 == omega_change_get_offset(change_ptr));
    REQUIRE(2 == omega_change_get_length(change_ptr));
    REQUIRE("00" == omega_change_get_string(change_ptr));
    REQUIRE(0 == omega_session_byte_frequency_profile(session_ptr, &byte_frequency_profile, 0, 0));
    REQUIRE(2 == byte_frequency_profile['0']);
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(1 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(2 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 1, reinterpret_cast<const omega_byte_t *>("11"), 0));
    REQUIRE(2 == omega_session_get_num_changes(session_ptr));
    REQUIRE(2 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(4 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 2, reinterpret_cast<const omega_byte_t *>("22"), 2));
    REQUIRE(3 == omega_session_get_num_changes(session_ptr));
    REQUIRE(3 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(6 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 3, "33"));
    REQUIRE(4 == omega_session_get_num_changes(session_ptr));
    REQUIRE(4 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(8 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 4, "44"));
    REQUIRE(5 == omega_session_get_num_changes(session_ptr));
    REQUIRE(5 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(10 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 5, "55"));
    REQUIRE(6 == omega_session_get_num_changes(session_ptr));
    REQUIRE(6 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(12 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 6, "66"));
    REQUIRE(7 == omega_session_get_num_changes(session_ptr));
    REQUIRE(7 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(14 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 7, "77"));
    REQUIRE(8 == omega_session_get_num_changes(session_ptr));
    REQUIRE(8 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(16 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 8, "88"));
    REQUIRE(9 == omega_session_get_num_changes(session_ptr));
    REQUIRE(9 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(18 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 9, "99"));
    REQUIRE(10 == omega_session_get_num_changes(session_ptr));
    REQUIRE(10 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(20 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 10, "*****+*****"));
    REQUIRE(0 == omega_session_byte_frequency_profile(session_ptr, &byte_frequency_profile, 0, 0));
    REQUIRE(10 == byte_frequency_profile['*']);
    REQUIRE(!omega_change_is_undone(omega_session_get_last_change(session_ptr)));
    REQUIRE(11 == omega_session_get_num_changes(session_ptr));
    REQUIRE(11 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(31 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(-11 == omega_edit_undo_last_change(session_ptr));
    REQUIRE(10 == omega_change_get_serial(omega_session_get_last_change(session_ptr)));
    REQUIRE(1 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(-11 == omega_change_get_serial(omega_session_get_last_undo(session_ptr)));
    REQUIRE(omega_change_is_undone(omega_session_get_last_undo(session_ptr)));
    int64_t rc;
    REQUIRE(0 < (rc = omega_edit_redo_last_undo(session_ptr)));
    REQUIRE(!omega_change_is_undone(omega_session_get_change(session_ptr, rc)));
    REQUIRE(0 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(0 == omega_check_model(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("model-test.actual.7.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        nullptr));
    REQUIRE(file_info.num_changes == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 ==
        omega_util_compare_files(MAKE_PATH("model-test.expected.7.dat"), MAKE_PATH("model-test.actual.7.dat")));
    omega_edit_clear_changes(session_ptr);
    REQUIRE(0 == omega_session_get_num_changes(session_ptr));
    omega_edit_insert_string(session_ptr, 0, "\rUnix EOL\n Mac EOL\n DOS EOL\r\n \r");
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_session_byte_frequency_profile(session_ptr, &byte_frequency_profile, 0, 0));
    REQUIRE(3 == byte_frequency_profile['\n']);
    REQUIRE(3 == byte_frequency_profile['\r']);
    REQUIRE(1 == byte_frequency_profile[OMEGA_EDIT_PROFILE_DOS_EOL]);
    omega_edit_destroy_session(session_ptr);
}

int change_visitor_cbk(const omega_change_t *change_ptr, void *user_data) {
    auto *string_ptr = reinterpret_cast<string *>(user_data);
    *string_ptr += omega_change_get_kind_as_char(change_ptr);
    return 0;
}

TEST_CASE("Check initialization", "[InitTests]") {
    omega_session_t *session_ptr;
    file_info_t file_info;
    const auto in_filename_str = std::string(MAKE_PATH("test1.dat"));
    const auto in_filename = in_filename_str.c_str();

    SECTION("Open data file") {
        SECTION("Create Session") {
            session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info, ALL_EVENTS, nullptr);
            REQUIRE(session_ptr);
            REQUIRE(63 == omega_session_get_computed_file_size(session_ptr));
            REQUIRE(nullptr == omega_session_get_last_change(session_ptr));
            REQUIRE(nullptr == omega_session_get_change(session_ptr, 0));
            int64_t rc;
            REQUIRE(0 <
                (rc = omega_edit_insert_bytes(session_ptr, 10, reinterpret_cast<const omega_byte_t *>("++++"), 4)));
            REQUIRE(nullptr != omega_session_get_last_change(session_ptr));
            REQUIRE(!omega_change_is_undone(omega_session_get_last_change(session_ptr)));
            auto change_ptr = omega_session_get_change(session_ptr, rc);
            REQUIRE(change_ptr);
            REQUIRE('I' == omega_change_get_kind_as_char(change_ptr));
            REQUIRE(10 == omega_change_get_offset(change_ptr));
            REQUIRE(4 == omega_change_get_length(change_ptr));
            REQUIRE(nullptr == omega_session_get_change(session_ptr, rc + 1));
            REQUIRE(67 == omega_session_get_computed_file_size(session_ptr));
            REQUIRE(0 < omega_edit_overwrite_bytes(session_ptr, 12, reinterpret_cast<const omega_byte_t *>("."), 1));
            REQUIRE(67 == omega_session_get_computed_file_size(session_ptr));
            REQUIRE(0 == omega_session_changes_paused(session_ptr));
            REQUIRE(0 == omega_session_viewport_event_callbacks_paused(session_ptr));
            omega_session_pause_changes(session_ptr);
            auto num_changes = omega_session_get_num_changes(session_ptr);
            REQUIRE(0 != omega_session_changes_paused(session_ptr));
            REQUIRE(0 == omega_session_viewport_event_callbacks_paused(session_ptr));
            REQUIRE(0 == omega_edit_insert_string(session_ptr, 0, "+++"));
            REQUIRE(0 == omega_edit_overwrite_string(session_ptr, 0, "+++"));
            REQUIRE(0 == omega_edit_delete(session_ptr, 0, 3));
            REQUIRE(0 == omega_edit_undo_last_change(session_ptr));
            REQUIRE(num_changes == omega_session_get_num_changes(session_ptr));
            REQUIRE(67 == omega_session_get_computed_file_size(session_ptr));
            omega_session_resume_changes(session_ptr);
            REQUIRE(0 == omega_session_changes_paused(session_ptr));
            REQUIRE(0 == omega_session_viewport_event_callbacks_paused(session_ptr));
            REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "+++"));
            REQUIRE(1 + num_changes == omega_session_get_num_changes(session_ptr));
            REQUIRE(70 == omega_session_get_computed_file_size(session_ptr));
            REQUIRE(0 < omega_edit_overwrite_bytes(session_ptr, 1, reinterpret_cast<const omega_byte_t *>("."), 0));
            REQUIRE(70 == omega_session_get_computed_file_size(session_ptr));
            REQUIRE(0 < omega_edit_overwrite_string(session_ptr, 15, "*"));
            REQUIRE(70 == omega_session_get_computed_file_size(session_ptr));
            REQUIRE(0 < omega_edit_insert_string(session_ptr, 15, "+"));
            REQUIRE(71 == omega_session_get_computed_file_size(session_ptr));
            REQUIRE(0 < omega_edit_delete(session_ptr, 9, 5));
            REQUIRE(7 == omega_session_get_num_changes(session_ptr));
            auto visit_change_context = omega_visit_change_create_context(session_ptr, 0);
            REQUIRE(visit_change_context);
            string forward_change_sequence;
            for (omega_visit_change_begin(visit_change_context); !omega_visit_change_at_end(visit_change_context);
                 omega_visit_change_next(visit_change_context)) {
                change_ptr = omega_visit_change_context_get_change(visit_change_context);
                forward_change_sequence += omega_change_get_kind_as_char(change_ptr);
            }
            omega_visit_change_destroy_context(visit_change_context);
            REQUIRE(forward_change_sequence == "IOIOOID");
            visit_change_context = omega_visit_change_create_context(session_ptr, 1);
            REQUIRE(visit_change_context);
            auto reverse_change_sequence = forward_change_sequence;
            std::reverse(reverse_change_sequence.begin(), reverse_change_sequence.end());
            string change_sequence;
            for (omega_visit_change_begin(visit_change_context); !omega_visit_change_at_end(visit_change_context);
                 omega_visit_change_next(visit_change_context)) {
                change_ptr = omega_visit_change_context_get_change(visit_change_context);
                change_sequence += omega_change_get_kind_as_char(change_ptr);
            }
            omega_visit_change_destroy_context(visit_change_context);
            REQUIRE(change_sequence == reverse_change_sequence);
            change_sequence = "";
            omega_visit_changes(session_ptr, change_visitor_cbk, &change_sequence);
            REQUIRE(change_sequence == forward_change_sequence);
            change_sequence = "";
            omega_visit_changes_reverse(session_ptr, change_visitor_cbk, &change_sequence);
            REQUIRE(change_sequence == reverse_change_sequence);
            REQUIRE(66 == omega_session_get_computed_file_size(session_ptr));
            auto num_changes_before_undo = omega_session_get_num_changes(session_ptr);
            REQUIRE(num_changes_before_undo * -1 == omega_edit_undo_last_change(session_ptr));
            REQUIRE(1 == omega_session_get_num_undone_changes(session_ptr));
            REQUIRE(omega_session_get_num_changes(session_ptr) == num_changes_before_undo - 1);
            REQUIRE(71 == omega_session_get_computed_file_size(session_ptr));
            REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("test1.dat.out"), omega_io_flags_t::IO_FLG_OVERWRITE,
                nullptr));
            REQUIRE(6 == omega_session_get_num_changes(session_ptr));
            REQUIRE(-6 == omega_edit_undo_last_change(session_ptr));
            REQUIRE(5 == omega_session_get_num_changes(session_ptr));
            REQUIRE(2 == omega_session_get_num_undone_changes(session_ptr));
            REQUIRE(0 == omega_edit_clear_changes(session_ptr));
            REQUIRE(0 == omega_session_get_num_changes(session_ptr));
            REQUIRE(0 == omega_session_get_num_undone_changes(session_ptr));
            REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("test1.reset.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
                nullptr));
            REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.dat"), MAKE_PATH("test1.reset.dat")));
            omega_edit_destroy_session(session_ptr);
        }
    }
}

enum class display_mode_t {
    BIT_MODE, BYTE_MODE, CHAR_MODE
};

struct view_mode_t {
    display_mode_t display_mode = display_mode_t::CHAR_MODE;
};

static inline void vpt_change_cbk(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                                  const void *viewport_event_ptr) {
    if (viewport_event_ptr) {
        clog << "Change serial: "
                << omega_change_get_serial(reinterpret_cast<const omega_change_t *>(viewport_event_ptr)) << endl;
    }
    clog << dec << "capacity: " << omega_viewport_get_capacity(viewport_ptr)
            << " length: " << omega_viewport_get_length(viewport_ptr)
            << " offset: " << omega_viewport_get_offset(viewport_ptr) << endl;
    if (omega_viewport_get_user_data_ptr(viewport_ptr)) {
        auto const *view_mode_ptr = (const view_mode_t *) omega_viewport_get_user_data_ptr(viewport_ptr);
        switch (view_mode_ptr->display_mode) {
            case display_mode_t::BIT_MODE:
                clog << " BIT MODE [";
                write_pretty_bits(omega_viewport_get_data(viewport_ptr), omega_viewport_get_length(viewport_ptr));
                clog << "]\n";
                break;
            case display_mode_t::CHAR_MODE:
                clog << "CHAR MODE [";
                clog << omega_viewport_get_string(viewport_ptr);
                clog << "]\n";
                break;
            default: // flow through
            case display_mode_t::BYTE_MODE:
                clog << "BYTE MODE [";
                write_pretty_bytes(omega_viewport_get_data(viewport_ptr), omega_viewport_get_length(viewport_ptr));
                clog << "]\n";
                break;
        }
        clog << endl;
    }
}

TEST_CASE("Compare", "[CompareTests]") {
    REQUIRE(0 == omega_util_strncmp("needle", "needle", 6));
    REQUIRE(0 != omega_util_strncmp("needle", "needlE", 6));
    REQUIRE(0 == omega_util_strncmp("needle", "needlE", 5));
    REQUIRE(0 != omega_util_strncmp("foo", "bar", 3));

    REQUIRE(0 == omega_util_strnicmp("needle", "needle", 6));
    REQUIRE(0 == omega_util_strnicmp("needle", "needlE", 6));
    REQUIRE(0 == omega_util_strnicmp("needle", "needlE", 5));
    REQUIRE(0 == omega_util_strnicmp("Needle", "nEedlE", 5));
    REQUIRE(0 != omega_util_strnicmp("foo", "bar", 3));
}

TEST_CASE("Search-Forward", "[SearchTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    const auto in_filename_str = std::string(MAKE_PATH("search-test.dat"));
    const auto in_filename = in_filename_str.c_str();
    auto session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(session_change_cbk == omega_session_get_event_cbk(session_ptr));
    REQUIRE(NO_EVENTS == omega_session_get_event_interest(session_ptr));
    REQUIRE(ALL_EVENTS == omega_session_set_event_interest(session_ptr, ALL_EVENTS));
    REQUIRE(ALL_EVENTS == omega_session_get_event_interest(session_ptr));
    REQUIRE(0 < omega_session_get_computed_file_size(session_ptr));
    view_mode_t view_mode;
    view_mode.display_mode = display_mode_t::CHAR_MODE;
    const auto vpt = omega_edit_create_viewport(session_ptr, 0, 1024, 0, vpt_change_cbk, &view_mode, NO_EVENTS);
    REQUIRE(NO_EVENTS == omega_viewport_get_event_interest(vpt));
    REQUIRE(0 == omega_viewport_get_following_byte_count(vpt));
    REQUIRE(0 != omega_viewport_has_changes(vpt));
    REQUIRE(0 == omega_session_notify_changed_viewports(session_ptr)); // no event interest, so no notifications
    REQUIRE(ALL_EVENTS == omega_viewport_set_event_interest(vpt, ALL_EVENTS));
    REQUIRE(ALL_EVENTS == omega_viewport_get_event_interest(vpt));
    REQUIRE(vpt_change_cbk == omega_viewport_get_event_cbk(vpt));
    REQUIRE(1 == omega_session_notify_changed_viewports(session_ptr));
    REQUIRE(0 == omega_session_notify_changed_viewports(session_ptr));
    REQUIRE(0 == omega_viewport_has_changes(vpt));
    REQUIRE(0 == omega_session_get_num_search_contexts(session_ptr));
    int needles_found = 0;
    const auto needle = "NeEdLe";
    const auto needle_length = strlen(needle);
    auto match_context = omega_search_create_context_string(session_ptr, needle);
    REQUIRE(match_context);
    REQUIRE(1 == omega_session_get_num_search_contexts(session_ptr));
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(0 == needles_found);
    omega_search_destroy_context(match_context);
    REQUIRE(0 == omega_session_get_num_search_contexts(session_ptr));
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, needle, 0, 0, true);
    REQUIRE(match_context);
    REQUIRE(0 == omega_search_context_is_reverse_search(match_context));
    REQUIRE(needle_length == omega_search_context_get_pattern_length(match_context));
    REQUIRE(0 == omega_search_context_get_session_offset(match_context));
    REQUIRE(omega_session_get_computed_file_size(session_ptr) ==
        omega_search_context_get_session_length(match_context));
    REQUIRE(1 == omega_session_get_num_search_contexts(session_ptr));
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(5 == needles_found);
    omega_search_destroy_context(match_context);
    REQUIRE(0 == omega_session_get_num_search_contexts(session_ptr));
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 5, reinterpret_cast<const omega_byte_t *>(needle), needle_length));
    REQUIRE(0 < omega_edit_delete(session_ptr, 16, needle_length));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 16, needle));
    REQUIRE(-3 == omega_edit_undo_last_change(session_ptr));
    REQUIRE(-3 == omega_change_get_serial(omega_session_get_last_undo(session_ptr)));
    REQUIRE('I' == omega_change_get_kind_as_char(omega_session_get_change(
        session_ptr, omega_change_get_serial(omega_session_get_last_undo(session_ptr)))));
    REQUIRE(nullptr != omega_change_get_bytes(omega_session_get_change(
        session_ptr, omega_change_get_serial(omega_session_get_last_undo(session_ptr)))));
    REQUIRE(!omega_change_get_string(
            omega_session_get_change(session_ptr,
                omega_change_get_serial(omega_session_get_last_undo(session_ptr))))
        .empty());
    REQUIRE(omega_session_get_num_undone_changes(session_ptr) == 1);
    REQUIRE(-2 == omega_edit_undo_last_change(session_ptr));
    REQUIRE(omega_change_is_undone(omega_session_get_last_undo(session_ptr)));
    REQUIRE(-2 == omega_change_get_serial(omega_session_get_last_undo(session_ptr)));
    REQUIRE('D' == omega_change_get_kind_as_char(omega_session_get_change(
        session_ptr, omega_change_get_serial(omega_session_get_last_undo(session_ptr)))));
    REQUIRE(nullptr == omega_change_get_bytes(omega_session_get_change(
        session_ptr, omega_change_get_serial(omega_session_get_last_undo(session_ptr)))));
    REQUIRE(omega_change_get_string(
            omega_session_get_change(session_ptr,
                omega_change_get_serial(omega_session_get_last_undo(session_ptr))))
        .empty());
    REQUIRE(omega_session_get_num_undone_changes(session_ptr) == 2);
    REQUIRE(0 < omega_edit_overwrite_string(session_ptr, 16, needle));
    REQUIRE(omega_session_get_num_undone_changes(session_ptr) == 0);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, needle);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(2 == needles_found);
    omega_search_destroy_context(match_context);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, needle, 0, 0, true);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(6 == needles_found);
    omega_search_destroy_context(match_context);

    // test single-byte needles since these use a different search algorithm
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "e", 0, 0, false);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(19 == needles_found);
    omega_search_destroy_context(match_context);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "E", 0, 0, false);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(3 == needles_found);
    omega_search_destroy_context(match_context);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "E", 0, 0, true);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(22 == needles_found);
    omega_search_destroy_context(match_context);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "F", 0, 0, false);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(0 == needles_found);
    omega_search_destroy_context(match_context);

    match_context = omega_search_create_context_string(session_ptr, "needle", 0, 0, true);
    REQUIRE(match_context);
    needles_found = 0;
    const auto replace = std::string("Noodles");
    const auto segment_peek = omega_segment_create(10);
    REQUIRE(10 == omega_segment_get_capacity(segment_peek));
    REQUIRE(0 == omega_segment_get_length(segment_peek));
    REQUIRE(0 > omega_segment_get_offset(segment_peek));
    REQUIRE(0 == omega_segment_get_offset_adjustment(segment_peek));
    auto pattern_length = omega_search_context_get_pattern_length(match_context);
    if (omega_search_next_match(match_context, 1)) {
        const auto advance_context = static_cast<int64_t>(replace.length());
        do {
            const auto pattern_offset = omega_search_context_get_match_offset(match_context);
            omega_session_get_segment(session_ptr, segment_peek, pattern_offset);
            clog << " needle before: " << omega_segment_get_data(segment_peek) << std::endl;
            REQUIRE(pattern_offset == omega_segment_get_offset(segment_peek));
            REQUIRE(0 == omega_util_strnicmp("needle", (const char *) omega_segment_get_data(segment_peek), 6));
            REQUIRE(omega_session_get_segment_string(session_ptr, pattern_offset,
                    omega_segment_get_capacity(segment_peek)) ==
                (const char *) omega_segment_get_data(segment_peek));
            omega_session_pause_viewport_event_callbacks(session_ptr);
            omega_edit_delete(session_ptr, pattern_offset, pattern_length);
            omega_session_resume_viewport_event_callbacks(session_ptr);
            omega_edit_insert_string(session_ptr, pattern_offset, replace);
            omega_session_get_segment(session_ptr, segment_peek, pattern_offset);
            clog << " needle after: " << omega_segment_get_data(segment_peek) << std::endl;
            REQUIRE(0 == omega_util_strnicmp((const char *) replace.c_str(),
                (const char *) omega_segment_get_data(segment_peek),
                static_cast<uint64_t>(replace.length())));
            REQUIRE(omega_session_get_segment_string(session_ptr, pattern_offset,
                    omega_segment_get_capacity(segment_peek)) ==
                (const char *) omega_segment_get_data(segment_peek));
            ++needles_found;
        } while (omega_search_next_match(match_context, advance_context));
    }
    omega_segment_destroy(segment_peek);
    REQUIRE(6 == needles_found);
    omega_search_destroy_context(match_context);
    // Single byte search
    match_context = omega_search_create_context_string(session_ptr, "o", 0, 0, true);
    REQUIRE(match_context);
    needles_found = 0;
    pattern_length = omega_search_context_get_pattern_length(match_context);
    REQUIRE(pattern_length == 1);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(12 == needles_found);
    omega_search_destroy_context(match_context);
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("search-test.actual.1.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        nullptr));
    omega_edit_destroy_session(session_ptr);
    REQUIRE(0 ==
        omega_util_compare_files(MAKE_PATH("search-test.expected.1.dat"), MAKE_PATH("search-test.actual.1.dat")));
    session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    std::string as = "bbbbabbbbaabbbba";
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, as));
    REQUIRE(as.length() == omega_session_get_computed_file_size(session_ptr));
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 0, 0, false);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(4 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 0,
                                                       omega_session_get_computed_file_size(session_ptr) - 2, false);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(3 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 1, 0, false);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(4 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 5, 0, false);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(3 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 0, 5, false);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(1 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 4, 3, false);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(1 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 1, 3, false);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(0 == needles_found);
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Search-Reverse", "[SearchTests]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    omega_edit_insert_string(session_ptr, 0,
                             "The pursuit of happiness is a fundamental human goal. The pursuit of knowledge is "
                             "equally important. It is through the pursuit of our passions that we truly live.");
    auto search_context_ptr = omega_search_create_context_string(session_ptr, "Pursuit", 0, 0, true, true);
    REQUIRE(search_context_ptr);
    auto matches = std::vector<int64_t>();
    while (omega_search_next_match(search_context_ptr, 1)) {
        matches.push_back(omega_search_context_get_match_offset(search_context_ptr));
    }
    REQUIRE(3 == matches.size());
    REQUIRE(119 == matches[0]);
    REQUIRE(58 == matches[1]);
    REQUIRE(4 == matches[2]);
    matches.clear();
    omega_search_destroy_context(search_context_ptr);
    search_context_ptr = omega_search_create_context_string(session_ptr, "P", 0, 0, true, true);
    REQUIRE(search_context_ptr);
    while (omega_search_next_match(search_context_ptr, 1)) {
        matches.push_back(omega_search_context_get_match_offset(search_context_ptr));
    }
    REQUIRE(7 == matches.size());
    REQUIRE(134 == matches[0]);
    REQUIRE(119 == matches[1]);
    REQUIRE(92 == matches[2]);
    REQUIRE(58 == matches[3]);
    REQUIRE(18 == matches[4]);
    REQUIRE(17 == matches[5]);
    REQUIRE(4 == matches[6]);
    matches.clear();
    omega_search_destroy_context(search_context_ptr);
    search_context_ptr = omega_search_create_context_string(session_ptr, "The", 0, 0, false, true);
    REQUIRE(search_context_ptr);
    while (omega_search_next_match(search_context_ptr, 1)) {
        matches.push_back(omega_search_context_get_match_offset(search_context_ptr));
    }
    REQUIRE(2 == matches.size());
    REQUIRE(54 == matches[0]);
    REQUIRE(0 == matches[1]);
    matches.clear();
    omega_search_destroy_context(search_context_ptr);
    omega_edit_undo_last_change(session_ptr);
    omega_edit_insert_string(session_ptr, 0, "Needle");
    search_context_ptr = omega_search_create_context_string(session_ptr, "Needle", 0, 0, false, true);
    REQUIRE(search_context_ptr);
    while (omega_search_next_match(search_context_ptr, 1)) {
        matches.push_back(omega_search_context_get_match_offset(search_context_ptr));
    }
    REQUIRE(1 == matches.size());
    REQUIRE(0 == matches[0]);
    matches.clear();
    omega_search_destroy_context(search_context_ptr);
}

TEST_CASE("File Viewing", "[InitTests]") {
    auto const fill = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    auto const fill_length = static_cast<int64_t>(strlen(fill));
    auto const file_name_str = std::string(MAKE_PATH("test.dat.view"));
    auto const file_name = file_name_str.c_str();
    auto const test_infile_ptr = fill_file(file_name, 1024, fill, fill_length);
    FCLOSE(test_infile_ptr);
    omega_session_t *session_ptr;
    omega_viewport_t *viewport_ptr;
    view_mode_t view_mode;

    session_ptr = omega_edit_create_session(file_name, nullptr, nullptr, NO_EVENTS, nullptr);
    auto viewport_count = omega_session_get_num_viewports(session_ptr);
    REQUIRE(viewport_count == 0);
    view_mode.display_mode = display_mode_t::BIT_MODE;
    viewport_ptr = omega_edit_create_viewport(session_ptr, 0, 10, 0, vpt_change_cbk, &view_mode, ALL_EVENTS);
    REQUIRE(viewport_count + 1 == omega_session_get_num_viewports(session_ptr));
    REQUIRE(1014 == omega_viewport_get_following_byte_count(viewport_ptr));
    view_mode.display_mode = display_mode_t::CHAR_MODE;
    omega_viewport_notify(viewport_ptr, VIEWPORT_EVT_UNDEFINED, nullptr);
    for (int64_t offset(0); offset < omega_session_get_computed_file_size(session_ptr); ++offset) {
        REQUIRE(0 == omega_viewport_modify(viewport_ptr, offset, 10 + (offset % 40), 0));
    }

    // Change the display mode from character mode to bit mode
    view_mode.display_mode = display_mode_t::BIT_MODE;
    REQUIRE(0 == omega_viewport_modify(viewport_ptr, 0, 20, 0));
    view_mode.display_mode = display_mode_t::BYTE_MODE;
    omega_viewport_notify(viewport_ptr, VIEWPORT_EVT_UNDEFINED, nullptr);
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 3, "++++"));
    viewport_count = omega_session_get_num_viewports(session_ptr);
    view_mode.display_mode = display_mode_t::CHAR_MODE;
    omega_session_pause_viewport_event_callbacks(session_ptr);
    omega_viewport_notify(viewport_ptr, VIEWPORT_EVT_UNDEFINED, nullptr);
    omega_session_resume_viewport_event_callbacks(session_ptr);
    omega_viewport_notify(viewport_ptr, VIEWPORT_EVT_UNDEFINED, nullptr);
    omega_edit_destroy_viewport(viewport_ptr);
    REQUIRE(viewport_count - 1 == omega_session_get_num_viewports(session_ptr));
    omega_edit_destroy_session(session_ptr);
    omega_util_remove_file(file_name);
}

TEST_CASE("Viewports", "[ViewportTests]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    omega_edit_insert_string(session_ptr, 0, "123456789");
    const auto viewport_fixed_ptr =
            omega_edit_create_viewport(session_ptr, 4, 4, 0, vpt_change_cbk, nullptr, ALL_EVENTS);
    REQUIRE(viewport_fixed_ptr);
    REQUIRE(1 == omega_viewport_get_following_byte_count(viewport_fixed_ptr));
    const auto viewport_floating_ptr =
            omega_edit_create_viewport(session_ptr, 4, 4, 1, vpt_change_cbk, nullptr, ALL_EVENTS);
    REQUIRE(viewport_floating_ptr);
    REQUIRE(1 == omega_viewport_get_following_byte_count(viewport_floating_ptr));
    REQUIRE(2 == omega_session_get_num_viewports(session_ptr));
    REQUIRE(omega_viewport_get_string(viewport_fixed_ptr) == "5678");
    REQUIRE(omega_viewport_get_string(viewport_floating_ptr) == "5678");
    omega_edit_delete(session_ptr, 0, 2);
    REQUIRE(0 == omega_viewport_get_following_byte_count(viewport_fixed_ptr));
    REQUIRE(1 == omega_viewport_get_following_byte_count(viewport_floating_ptr));
    REQUIRE(omega_viewport_get_string(viewport_fixed_ptr) == "789");
    REQUIRE(omega_viewport_get_string(viewport_floating_ptr) == "5678");
    omega_edit_insert_string(session_ptr, 0, "12");
    REQUIRE(1 == omega_viewport_get_following_byte_count(viewport_fixed_ptr));
    REQUIRE(1 == omega_viewport_get_following_byte_count(viewport_floating_ptr));
    REQUIRE(omega_viewport_get_string(viewport_fixed_ptr) == "5678");
    REQUIRE(omega_viewport_get_string(viewport_floating_ptr) == "5678");
    omega_edit_insert_string(session_ptr, omega_session_get_computed_file_size(session_ptr),
                             "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    REQUIRE(27 == omega_viewport_get_following_byte_count(viewport_fixed_ptr));
    REQUIRE(27 == omega_viewport_get_following_byte_count(viewport_floating_ptr));
    omega_edit_delete(session_ptr, 0, omega_session_get_computed_file_size(session_ptr));
    const auto viewport_fixed_ptr2 = omega_edit_create_viewport(session_ptr, 100, 10, 0, nullptr, nullptr, NO_EVENTS);
    REQUIRE(0 != omega_viewport_has_changes(viewport_fixed_ptr2));
    REQUIRE(nullptr != omega_viewport_get_data(viewport_fixed_ptr2));
    REQUIRE(0 == omega_viewport_has_changes(viewport_fixed_ptr2));
    REQUIRE(100 == omega_viewport_get_offset(viewport_fixed_ptr2));
    REQUIRE(-100 == omega_viewport_get_following_byte_count(viewport_fixed_ptr2));
    REQUIRE(0 == omega_viewport_get_length(viewport_fixed_ptr2));
    REQUIRE(10 == omega_viewport_get_capacity(viewport_fixed_ptr2));
    REQUIRE(-4 == omega_viewport_get_following_byte_count(viewport_fixed_ptr));
    REQUIRE(0 == omega_viewport_get_following_byte_count(viewport_floating_ptr));
    REQUIRE(0 == omega_viewport_get_offset(viewport_floating_ptr));
    REQUIRE(0 == omega_viewport_get_length(viewport_floating_ptr));
    REQUIRE(0 == omega_viewport_get_length(viewport_fixed_ptr));
    omega_edit_insert_string(session_ptr, omega_session_get_computed_file_size(session_ptr),
                             "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    REQUIRE(26 == omega_viewport_get_offset(viewport_floating_ptr));
    REQUIRE(0 == omega_viewport_get_length(viewport_floating_ptr));
    REQUIRE(18 == omega_viewport_get_following_byte_count(viewport_fixed_ptr));
    REQUIRE(0 == omega_viewport_get_following_byte_count(viewport_floating_ptr));
    REQUIRE(-74 == omega_viewport_get_following_byte_count(viewport_fixed_ptr2));
    omega_edit_destroy_viewport(viewport_fixed_ptr2);
    omega_edit_destroy_viewport(viewport_fixed_ptr);
    REQUIRE(1 == omega_session_get_num_viewports(session_ptr));
    omega_edit_destroy_viewport(viewport_floating_ptr);
    REQUIRE(0 == omega_session_get_num_viewports(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

