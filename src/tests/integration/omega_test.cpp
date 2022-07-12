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

#define CATCH_CONFIG_MAIN

#include "test_util.h"
#include <catch2/catch.hpp>
#include <omega_edit.h>
#include <omega_edit/check.h>
#include <omega_edit/config.h>
#include <omega_edit/encode.h>
#include <omega_edit/stl_string_adaptor.hpp>
#include <omega_edit/utility.h>

#include <cstdio>
#include <cstring>
#include <iostream>

using namespace std;

using Catch::Matchers::Contains;
using Catch::Matchers::EndsWith;
using Catch::Matchers::Equals;

TEST_CASE("Size Tests", "[SizeTests]") {
    REQUIRE(1 == sizeof(omega_byte_t));//must always be 1-byte
    REQUIRE(4 == sizeof(int));
    REQUIRE(8 == sizeof(int64_t));//explicit 8-bytes
    REQUIRE(8 == sizeof(long long));
    REQUIRE(8 == sizeof(size_t));
    REQUIRE(8 == sizeof(void *));
}

TEST_CASE("Version check", "[VersionCheck]") {
    const auto major = omega_version_major();
    const auto minor = omega_version_minor();
    const auto patch = omega_version_patch();
    const auto version = (major << 24) + (minor << 16) + patch;
    REQUIRE(0 < omega_version());
    REQUIRE(version == omega_version());
}

TEST_CASE("License check", "[LicenseCheck]") {
    const auto license = omega_license_get();
    REQUIRE(license);
    REQUIRE(strlen(license) == 576);
    REQUIRE(strstr(license, "Concurrent Technologies Corporation"));
}

TEST_CASE("Bit Manipulation", "[BitManip]") {
    std::clog << "********* largest negative: " << (1 << 31) << std::endl;
    std::clog << "********* largest positive: " << ~(1 << 31) << std::endl;
}

TEST_CASE("Buffer Shift", "[BufferShift]") {
    auto const fill = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    auto *buffer = (omega_byte_t *) strdup(fill);
    auto buff_len = (int64_t) strlen((const char *) buffer);

    // Shift the buffer 3 bits to the right
    REQUIRE(0 == omega_util_right_shift_buffer(buffer, buff_len, 3));
    // Shift the buffer 5 bits to the right
    REQUIRE(0 == omega_util_right_shift_buffer(buffer, buff_len, 5));
    // We shifted a total of 8 bits (one byte) to the right, so compare the buffer against the fill plus one byte
    REQUIRE(strcmp((const char *) fill + 1, (const char *) buffer) == 0);

    // Reset the buffer
    memcpy(buffer, fill, buff_len);
    REQUIRE(strcmp((const char *) fill, (const char *) buffer) == 0);

    // Shift the buffer 6 bits to the left
    REQUIRE(0 == omega_util_left_shift_buffer(buffer, buff_len, 6));
    // Shift the buffer 2 bits to the left
    REQUIRE(0 == omega_util_left_shift_buffer(buffer, buff_len, 2));
    // We shifted a total of 8 bits (one byte) to the left, so compare the buffer against the fill plus one byte
    REQUIRE(strcmp((const char *) fill + 1, (const char *) buffer) == 0);

    // Negative tests.  Shifting 8 or more bits in either direction should be an error.
    REQUIRE(-1 == omega_util_left_shift_buffer(buffer, buff_len, 8));
    REQUIRE(-1 == omega_util_right_shift_buffer(buffer, buff_len, 8));

    free(buffer);
}

TEST_CASE("File Compare", "[UtilTests]") {
    SECTION("Identity") {
        // Same file ought to yield identical contents
        REQUIRE(0 == compare_files("data/test1.dat", "data/test1.dat"));
    }
    SECTION("Difference") {
        // Different files with different contents
        REQUIRE(0 != compare_files("data/test1.dat", "data/test2.dat"));
    }
}

TEST_CASE("End Of Line", "[EOLTests]") {
    omega_byte_t buffer[1024];
    FILE *in_fp = fopen("data/test1.dat", "rb");
    REQUIRE(in_fp);
    auto file_size = omega_util_file_size("data/test1.dat");
    REQUIRE(63 == file_size);
    REQUIRE(file_size < sizeof(buffer));
    REQUIRE(file_size == fread(buffer, sizeof(omega_byte_t), file_size, in_fp));
    REQUIRE(0 == fclose(in_fp));
    FILE *out_fp = fopen("data/test1.actual.eol.1.dat", "wb");
    REQUIRE(out_fp);
    REQUIRE(file_size == fwrite(buffer, sizeof(omega_byte_t), file_size, out_fp));
    REQUIRE(file_size == FTELL(out_fp));
    REQUIRE(0 == fclose(out_fp));
    REQUIRE(0 == compare_files("data/test1.dat", "data/test1.actual.eol.1.dat"));
}

TEST_CASE("File Exists", "[UtilTests]") {
    REQUIRE(omega_util_file_exists("data/test1.dat"));
    REQUIRE(!omega_util_file_exists("data/IDonTExist.DaT"));
}

TEST_CASE("File Touch", "[UtilTests]") {
    const char dir_sep = omega_util_directory_separator();
    const auto exists = std::string("data") + dir_sep + "test1.dat";
    ;
    const auto dont_exist = std::string("data") + dir_sep + "IDonTExist.DaT";
    ;
    REQUIRE(omega_util_file_exists(exists.c_str()));
    REQUIRE(!omega_util_file_exists(dont_exist.c_str()));
    auto expected = std::string("data") + dir_sep + "test1-1.dat";
    REQUIRE_THAT(omega_util_available_filename(exists.c_str(), nullptr), Equals(expected));
    expected = dont_exist;
    REQUIRE_THAT(omega_util_available_filename(dont_exist.c_str(), nullptr), Equals(expected));
    omega_util_touch(dont_exist.c_str(), 0);
    REQUIRE(!omega_util_file_exists(dont_exist.c_str()));
    omega_util_touch(dont_exist.c_str(), 1);
    REQUIRE(omega_util_file_exists(dont_exist.c_str()));
    expected = std::string("data") + dir_sep + "IDonTExist-1.DaT";
    REQUIRE_THAT(omega_util_available_filename(dont_exist.c_str(), nullptr), Equals(expected));
    REQUIRE(0 == omega_util_remove_file(dont_exist.c_str()));
    REQUIRE(!omega_util_file_exists(dont_exist.c_str()));
    expected = dont_exist;
    REQUIRE_THAT(omega_util_available_filename(dont_exist.c_str(), nullptr), Equals(expected));
}

TEST_CASE("Current Directory", "[UtilTests]") { REQUIRE_THAT(omega_util_get_current_dir(nullptr), EndsWith("bin")); }

TEST_CASE("Directory Name", "[UtilTests]") {
    // Unix-style paths
    auto test_1 = "/this/is/a/directory/filename.extension";
    char buffer[FILENAME_MAX];
    auto result = omega_util_dirname(test_1, nullptr);
    REQUIRE(result);
    REQUIRE_THAT(result, Equals("/this/is/a/directory"));
    // DOS/Windows-style paths
    auto test_2 = R"(C:\this\is\a\directory\filename.extension)";
    result = omega_util_dirname(test_2, buffer);
    REQUIRE(result);
#ifdef OMEGA_BUILD_WINDOWS
    REQUIRE_THAT(buffer, Equals(R"(C:\this\is\a\directory)"));
#else
    REQUIRE_THAT(buffer, Equals(""));
#endif
    // Missing directory test
    auto test_3 = "filename.extension";
    result = omega_util_dirname(test_3, buffer);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals(""));
    // relative path
    auto test_4 = "relative/filename.extension";
    result = omega_util_dirname(test_4, buffer);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals("relative"));
}

TEST_CASE("Base File Name", "[UtilTests]") {
    // Unix-style paths
    auto test_1 = "/this/is/a/directory/filename.extension";
    char buffer[FILENAME_MAX];
    auto result = omega_util_basename(test_1, nullptr, 0);
    REQUIRE(result);
    REQUIRE_THAT(result, Equals("filename.extension"));
    // DOS/Windows-style paths
    auto test_2 = R"(C:\this\is\a\directory\filename.extension)";
    result = omega_util_basename(test_2, buffer, 0);
    REQUIRE(result);
#ifdef OMEGA_BUILD_WINDOWS
    REQUIRE_THAT(buffer, Equals("filename.extension"));
#else
    REQUIRE_THAT(buffer, Equals("C:\\this\\is\\a\\directory\\filename.extension"));
#endif
    auto test_3 = "filename.extension";
    result = omega_util_basename(test_3, buffer, 0);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals("filename.extension"));
    result = omega_util_basename(test_3, buffer, 1);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals("filename"));
    auto test_4 = "/this/is/a/directory/";
    result = omega_util_basename(test_4, buffer, 0);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals(""));
}

TEST_CASE("File Extension", "[UtilTests]") {
    // Unix-style paths
    auto test_1 = "/this/is/a/directory/filename.extension";
    char buffer[FILENAME_MAX];
    auto result = omega_util_file_extension(test_1, nullptr);
    REQUIRE(result);
    REQUIRE_THAT(result, Equals(".extension"));
    // DOS/Windows-style paths
    auto test_2 = R"(C:\this\is\a\directory\filename.extension)";
    result = omega_util_file_extension(test_2, buffer);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals(".extension"));
    auto test_3 = "filename_no_extension";
    result = omega_util_file_extension(test_3, buffer);
    REQUIRE_THAT(result, Equals(""));
    auto test_4 = "filename_empty_extension.";
    result = omega_util_file_extension(test_4, buffer);
    REQUIRE(result);
    REQUIRE_THAT(result, Equals("."));
    auto test_5 = "/..";
    result = omega_util_file_extension(test_5, buffer);
    REQUIRE(result);
    REQUIRE_THAT(result, Equals(""));
    auto test_6 = "/this.is.a.directory/filename_no_extension";
    result = omega_util_file_extension(test_6, buffer);
    REQUIRE_THAT(result, Equals(""));
}

static inline omega_byte_t to_lower(omega_byte_t byte, void *) { return tolower(byte); }
static inline omega_byte_t to_upper(omega_byte_t byte, void *) { return toupper(byte); }

TEST_CASE("Transformer", "[TransformerTest]") {
    omega_byte_t bytes[32];
    strcpy(reinterpret_cast<char *>(bytes), "Hello World!");
    const auto bytes_length = static_cast<int64_t>(strlen(reinterpret_cast<const char *>(bytes)));
    omega_util_apply_byte_transform(bytes, bytes_length, to_upper, nullptr);
    REQUIRE(string(reinterpret_cast<const char *>(bytes)) == "HELLO WORLD!");
    omega_util_apply_byte_transform(bytes, bytes_length, to_lower, nullptr);
    REQUIRE(string(reinterpret_cast<const char *>(bytes)) == "hello world!");
    omega_util_apply_byte_transform(bytes, 1, to_upper, nullptr);
    REQUIRE(string(reinterpret_cast<const char *>(bytes)) == "Hello world!");
}

TEST_CASE("File Transformer", "[TransformerTest]") {
    REQUIRE(0 == omega_util_apply_byte_transform_to_file("data/test1.dat", "data/test1.actual.transformed.1.dat",
                                                         to_upper, nullptr, 0, 0));
    REQUIRE(0 == compare_files("data/test1.expected.transformed.1.dat", "data/test1.actual.transformed.1.dat"));
    REQUIRE(0 == omega_util_apply_byte_transform_to_file("data/test1.dat", "data/test1.actual.transformed.2.dat",
                                                         to_lower, nullptr, 37, 10));
    REQUIRE(0 == compare_files("data/test1.expected.transformed.2.dat", "data/test1.actual.transformed.2.dat"));
    REQUIRE(0 != omega_util_apply_byte_transform_to_file("data/test1.dat", "data/test1.actual.transformed.3.dat",
                                                         to_lower, nullptr, 37, 100));
    REQUIRE(0 == omega_util_file_exists("data/test1.actual.transformed.3.dat"));
}

TEST_CASE("Encoding", "[EncodingTest]") {
    auto in_string = string("Hello World!");
    auto in = reinterpret_cast<const omega_byte_t *>(in_string.c_str());
    char encoded_buffer[1024];
    omega_byte_t decoded_buffer[1024];
    omega_encode_bin2hex(in, encoded_buffer, in_string.size());
    REQUIRE(0 == strcmp(encoded_buffer, "48656c6c6f20576f726c6421"));
    omega_encode_hex2bin(encoded_buffer, decoded_buffer, strlen(encoded_buffer));
    REQUIRE(0 == strcmp(reinterpret_cast<const char *>(decoded_buffer), in_string.c_str()));
    omega_encode_hex2bin("48656C6C6F20576F726C6421", decoded_buffer, strlen(encoded_buffer));
    REQUIRE(0 == strcmp(reinterpret_cast<const char *>(decoded_buffer), in_string.c_str()));
}

using file_info_t = struct file_info_struct { size_t num_changes{}; };

static inline void session_change_cbk(const omega_session_t *session_ptr, omega_session_event_t session_event,
                                      const void *session_event_ptr) {
    // Not all session changes are the result of a standard change like delete / insert / overwrite
    switch (session_event) {
        case SESSION_EVT_EDIT:
        case SESSION_EVT_UNDO: {
            auto file_info_ptr = reinterpret_cast<file_info_t *>(omega_session_get_user_data_ptr(session_ptr));
            const auto change_ptr = reinterpret_cast<const omega_change_t *>(session_event_ptr);
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
                 << omega_change_get_serial(change_ptr) << R"(, "change_kind": ")"
                 << omega_change_get_kind_as_char(change_ptr) << R"(", "offset": )"
                 << omega_change_get_offset(change_ptr) << R"(, "length": )" << omega_change_get_length(change_ptr);
            if (bytes) { clog << R"(, "bytes": ")" << string((const char *) bytes, bytes_length) << R"(")"; }
            clog << "}" << endl;
        }
        default:
            break;
    }
}

TEST_CASE("Empty File Tests", "[EmptyFileTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    const auto in_filename = "data/empty_file.dat";
    auto file_size = omega_util_file_size(in_filename);
    REQUIRE(0 == file_size);
    const auto session_ptr =
            omega_edit_create_session(in_filename, session_change_cbk, &file_info, SESSION_EVT_EDIT | SESSION_EVT_UNDO);
    REQUIRE(session_ptr);
    REQUIRE(strcmp(omega_session_get_file_path(session_ptr), in_filename) == 0);
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(0 == omega_edit_undo_last_change(session_ptr));
    auto change_serial =
            omega_edit_insert_bytes(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("1234567890"), 0);
    REQUIRE(0 < change_serial);
    file_size += 10;
    REQUIRE(file_size == omega_session_get_computed_file_size(session_ptr));
    REQUIRE((change_serial * -1) == omega_edit_undo_last_change(session_ptr));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));
    change_serial = omega_edit_overwrite_string(session_ptr, 0, "abcdefghhijklmnopqrstuvwxyz");
    REQUIRE(0 < change_serial);
    REQUIRE(27 == omega_session_get_computed_file_size(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

typedef struct mask_info_struct {
    omega_byte_t mask;
    omega_mask_kind_t mask_kind;
} mask_info_t;

static inline omega_byte_t byte_mask_transform(omega_byte_t byte, void *user_data_ptr) {
    const auto mask_info_ptr = reinterpret_cast<mask_info_t *>(user_data_ptr);
    return omega_util_mask_byte(byte, mask_info_ptr->mask, mask_info_ptr->mask_kind);
}

TEST_CASE("Checkpoint Tests", "[CheckpointTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    auto in_filename = "data/test1.dat";
    const auto session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info, ALL_EVENTS);
    REQUIRE(session_ptr);
    auto file_size = omega_session_get_computed_file_size(session_ptr);
    REQUIRE(file_size > 0);
    REQUIRE(0 !=
            omega_edit_insert_string(session_ptr, 0, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(-1 == omega_edit_destroy_last_checkpoint(session_ptr));
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, to_lower, nullptr, 0, 0, "./data"));
    REQUIRE(1 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(2 == omega_edit_overwrite_string(session_ptr, 37, "BCDEFGHIJKLMNOPQRSTUVWXY"));
    REQUIRE(2 == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, "data/test1.actual.checkpoint.1.dat", 1, nullptr));
    REQUIRE(0 == compare_files("data/test1.expected.checkpoint.1.dat", "data/test1.actual.checkpoint.1.dat"));
    mask_info_t mask_info;
    mask_info.mask_kind = MASK_XOR;
    mask_info.mask = 0xFF;
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, byte_mask_transform, &mask_info, 10, 26, "./data"));
    REQUIRE(2 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, "data/test1.actual.checkpoint.2.dat", 1, nullptr));
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, byte_mask_transform, &mask_info, 10, 26, "./data"));
    REQUIRE(3 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, "data/test1.actual.checkpoint.3.dat", 1, nullptr));
    REQUIRE(0 == compare_files("data/test1.expected.checkpoint.1.dat", "data/test1.actual.checkpoint.3.dat"));
    mask_info.mask_kind = MASK_AND;
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, byte_mask_transform, &mask_info, 10, 0, "./data"));
    REQUIRE(4 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, "data/test1.actual.checkpoint.4.dat", 1, nullptr));
    REQUIRE(0 == compare_files("data/test1.expected.checkpoint.1.dat", "data/test1.actual.checkpoint.4.dat"));
    mask_info.mask_kind = MASK_OR;
    mask_info.mask = 0x00;
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, byte_mask_transform, &mask_info, 10, 0, "./data"));
    REQUIRE(5 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, "data/test1.actual.checkpoint.5.dat", 1, nullptr));
    REQUIRE(0 == compare_files("data/test1.expected.checkpoint.1.dat", "data/test1.actual.checkpoint.5.dat"));
    mask_info.mask_kind = MASK_AND;
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, byte_mask_transform, &mask_info, 10, 0, "./data"));
    REQUIRE(6 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(3 == omega_edit_overwrite_string(session_ptr, 0,
                                             "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"));
    REQUIRE(3 == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, "data/test1.actual.checkpoint.6.dat", 1, nullptr));
    REQUIRE(0 == compare_files("data/test1.expected.checkpoint.6.dat", "data/test1.actual.checkpoint.6.dat"));
    auto change_ptr = omega_session_get_last_change(session_ptr);
    REQUIRE(change_ptr);
    REQUIRE(3 == omega_change_get_serial(change_ptr));
    REQUIRE(4 == omega_edit_insert_string(session_ptr, 0, "12345"));
    REQUIRE(5 == omega_edit_delete(session_ptr, 0, 5));
    REQUIRE(5 == omega_session_get_num_changes(session_ptr));
    change_ptr = omega_session_get_last_change(session_ptr);
    REQUIRE(5 == omega_change_get_serial(change_ptr));
    REQUIRE(0 == omega_edit_destroy_last_checkpoint(session_ptr));
    REQUIRE(5 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(2 == omega_session_get_num_changes(session_ptr));
    REQUIRE(nullptr == omega_session_get_last_change(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, "data/test1.actual.checkpoint.7.dat", 1, nullptr));
    REQUIRE(0 == compare_files("data/test1.expected.checkpoint.1.dat", "data/test1.actual.checkpoint.7.dat"));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Model Tests", "[ModelTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    auto in_filename = "data/model-test.dat";
    const auto session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info, ALL_EVENTS);
    REQUIRE(session_ptr);
    auto file_size = omega_session_get_computed_file_size(session_ptr);
    REQUIRE(file_size > 0);
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("0"), 1));
    file_size += 1;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    char saved_filename[FILENAME_MAX];
    omega_util_remove_file("data/test_dir/model-test.actual.1.dat");
    omega_util_remove_directory("data/test_dir");
    REQUIRE(0 == omega_edit_save(session_ptr, "data/test_dir/model-test.actual.1.dat", 0, saved_filename));
    REQUIRE(0 == compare_files("data/model-test.expected.1.dat", "data/test_dir/model-test.actual.1.dat"));
    omega_util_remove_file("data/model-test.actual.1.dat");
    REQUIRE(0 == omega_util_remove_file("data/test_dir/model-test.actual.1.dat"));
    REQUIRE(0 == omega_util_remove_directory("data/test_dir"));
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.1.dat", 0, saved_filename));
    REQUIRE(0 != compare_files("data/model-test.dat", "data/model-test.actual.1.dat"));
    REQUIRE(0 == compare_files("data/model-test.expected.1.dat", "data/model-test.actual.1.dat"));
    REQUIRE(omega_util_paths_equivalent("data/model-test.actual.1.dat", saved_filename));
    omega_util_remove_file("data/model-test.actual.1-1.dat");
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.1.dat", 0, saved_filename));
    REQUIRE(0 == compare_files("data/model-test.actual.1.dat", "data/model-test.actual.1-1.dat"));
    REQUIRE(omega_util_paths_equivalent("data/model-test.actual.1-1.dat", saved_filename));
    omega_util_remove_file("data/model-test.actual.1-2.dat");
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.1.dat", 0, saved_filename));
    REQUIRE(0 == compare_files("data/model-test.actual.1.dat", "data/model-test.actual.1-2.dat"));
    REQUIRE(omega_util_paths_equivalent("data/model-test.actual.1-2.dat", saved_filename));
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 10, reinterpret_cast<const omega_byte_t *>("0"), 1));
    file_size += 1;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    omega_util_remove_file("data/model-test.actual.2.dat");
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.2.dat", 0, saved_filename));
    REQUIRE(0 == compare_files("data/model-test.expected.2.dat", "data/model-test.actual.2.dat"));
    REQUIRE(omega_util_paths_equivalent("data/model-test.actual.2.dat", saved_filename));
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 5, reinterpret_cast<const omega_byte_t *>("xxx"), 0));
    file_size += 3;
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.3.dat", 1, saved_filename));
    REQUIRE(omega_util_paths_equivalent("data/model-test.actual.3.dat", saved_filename));
    REQUIRE(0 == compare_files("data/model-test.expected.3.dat", "data/model-test.actual.3.dat"));
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
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.4.dat", 1, saved_filename));
    REQUIRE(0 == compare_files("data/model-test.expected.4.dat", "data/model-test.actual.4.dat"));
    REQUIRE(omega_util_paths_equivalent("data/model-test.actual.4.dat", saved_filename));
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
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.5.dat", 1, nullptr));
    REQUIRE(0 == compare_files("data/model-test.expected.5.dat", "data/model-test.actual.5.dat"));
    REQUIRE(0 < omega_edit_delete(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));
    while (file_info.num_changes) { omega_edit_undo_last_change(session_ptr); }
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.6.dat", 1, nullptr));
    REQUIRE(file_info.num_changes == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == compare_files("data/model-test.dat", "data/model-test.actual.6.dat"));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Hanoi insert", "[ModelTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    const auto session_ptr = omega_edit_create_session(nullptr, session_change_cbk, &file_info, ALL_EVENTS);
    REQUIRE(session_ptr);
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
    REQUIRE(0 == omega_edit_save(session_ptr, "data/model-test.actual.7.dat", 1, nullptr));
    REQUIRE(file_info.num_changes == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == compare_files("data/model-test.expected.7.dat", "data/model-test.actual.7.dat"));
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
    auto in_filename = "data/test1.dat";

    SECTION("Open data file") {
        SECTION("Create Session") {
            session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info, ALL_EVENTS);
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
            REQUIRE(0 == omega_edit_save(session_ptr, "data/test1.dat.out", 1, nullptr));
            REQUIRE(6 == omega_session_get_num_changes(session_ptr));
            REQUIRE(0 == omega_edit_clear_changes(session_ptr));
            REQUIRE(0 == omega_session_get_num_changes(session_ptr));
            REQUIRE(0 == omega_edit_save(session_ptr, "data/test1.reset.dat", 1, nullptr));
            REQUIRE(0 == compare_files("data/test1.dat", "data/test1.reset.dat"));
            omega_edit_destroy_session(session_ptr);
        }
    }
}

enum class display_mode_t { BIT_MODE, BYTE_MODE, CHAR_MODE };
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
            default:// flow through
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

TEST_CASE("Search", "[SearchTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    auto in_filename = "data/search-test.dat";
    auto session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info, ALL_EVENTS);
    REQUIRE(session_ptr);
    REQUIRE(0 < omega_session_get_computed_file_size(session_ptr));
    view_mode_t view_mode;
    view_mode.display_mode = display_mode_t::CHAR_MODE;
    omega_edit_create_viewport(session_ptr, 0, 1024, 0, vpt_change_cbk, &view_mode, ALL_EVENTS);
    REQUIRE(0 == omega_session_get_num_search_contexts(session_ptr));
    int needles_found = 0;
    auto needle = "NeEdLe";
    auto needle_length = strlen(needle);
    auto match_context = omega_search_create_context_string(session_ptr, needle);
    REQUIRE(match_context);
    REQUIRE(1 == omega_session_get_num_search_contexts(session_ptr));
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(0 == needles_found);
    omega_search_destroy_context(match_context);
    REQUIRE(0 == omega_session_get_num_search_contexts(session_ptr));
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, needle, 0, 0, 1);
    REQUIRE(match_context);
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
    match_context = omega_search_create_context_string(session_ptr, needle, 0, 0, 1);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(6 == needles_found);
    omega_search_destroy_context(match_context);
    match_context = omega_search_create_context_string(session_ptr, "needle", 0, 0, 1);
    REQUIRE(match_context);
    needles_found = 0;
    const std::string replace = "Noodles";
    auto segment_peek = omega_segment_create(10);
    REQUIRE(10 == omega_segment_get_capacity(segment_peek));
    REQUIRE(0 == omega_segment_get_length(segment_peek));
    REQUIRE(0 > omega_segment_get_offset(segment_peek));
    REQUIRE(0 == omega_segment_get_offset_adjustment(segment_peek));
    auto pattern_length = omega_search_context_get_length(match_context);
    if (omega_search_next_match(match_context, 1)) {
        const auto advance_context = static_cast<int64_t>(replace.length());
        do {
            const auto pattern_offset = omega_search_context_get_offset(match_context);
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
    match_context = omega_search_create_context_string(session_ptr, "o", 0, 0, 1);
    REQUIRE(match_context);
    needles_found = 0;
    pattern_length = omega_search_context_get_length(match_context);
    REQUIRE(pattern_length == 1);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(12 == needles_found);
    omega_search_destroy_context(match_context);
    REQUIRE(0 == omega_edit_save(session_ptr, "data/search-test.actual.1.dat", 1, nullptr));
    omega_edit_destroy_session(session_ptr);
    REQUIRE(0 == compare_files("data/search-test.expected.1.dat", "data/search-test.actual.1.dat"));
    session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS);
    REQUIRE(session_ptr);
    std::string as = "bbbbabbbbaabbbba";
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, as));
    REQUIRE(as.length() == omega_session_get_computed_file_size(session_ptr));
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 0, 0, 0);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(4 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 0,
                                                       omega_session_get_computed_file_size(session_ptr) - 2, 0);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(3 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 1, 0, 0);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(4 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 5, 0, 0);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(3 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 0, 5, 0);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(1 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 4, 3, 0);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(1 == needles_found);
    needles_found = 0;
    match_context = omega_search_create_context_string(session_ptr, "a", 1, 3, 0);
    REQUIRE(match_context);
    while (omega_search_next_match(match_context, 1)) { ++needles_found; }
    REQUIRE(0 == needles_found);
    omega_edit_destroy_session(session_ptr);
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

    session_ptr = omega_edit_create_session(file_name, nullptr, nullptr, NO_EVENTS);
    auto viewport_count = omega_session_get_num_viewports(session_ptr);
    REQUIRE(viewport_count == 0);
    view_mode.display_mode = display_mode_t::BIT_MODE;
    viewport_ptr = omega_edit_create_viewport(session_ptr, 0, 10, 0, vpt_change_cbk, &view_mode, ALL_EVENTS);
    REQUIRE(viewport_count + 1 == omega_session_get_num_viewports(session_ptr));
    view_mode.display_mode = display_mode_t::CHAR_MODE;
    omega_viewport_notify(viewport_ptr, VIEWPORT_EVT_UNDEFINED, nullptr);
    for (int64_t offset(0); offset < omega_session_get_computed_file_size(session_ptr); ++offset) {
        REQUIRE(0 == omega_viewport_update(viewport_ptr, offset, 10 + (offset % 40), 0));
    }

    // Change the display mode from character mode to bit mode
    view_mode.display_mode = display_mode_t::BIT_MODE;
    REQUIRE(0 == omega_viewport_update(viewport_ptr, 0, 20, 0));
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
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS);
    REQUIRE(session_ptr);
    omega_edit_insert_string(session_ptr, 0, "123456789");
    const auto viewport_fixed_ptr =
            omega_edit_create_viewport(session_ptr, 4, 4, 0, vpt_change_cbk, nullptr, ALL_EVENTS);
    REQUIRE(viewport_fixed_ptr);
    const auto viewport_floating_ptr =
            omega_edit_create_viewport(session_ptr, 4, 4, 1, vpt_change_cbk, nullptr, ALL_EVENTS);
    REQUIRE(viewport_floating_ptr);
    REQUIRE(2 == omega_session_get_num_viewports(session_ptr));
    REQUIRE(omega_viewport_get_string(viewport_fixed_ptr) == "5678");
    REQUIRE(omega_viewport_get_string(viewport_floating_ptr) == "5678");
    omega_edit_delete(session_ptr, 0, 2);
    REQUIRE(omega_viewport_get_string(viewport_fixed_ptr) == "789");
    REQUIRE(omega_viewport_get_string(viewport_floating_ptr) == "5678");
    omega_edit_insert_string(session_ptr, 0, "12");
    REQUIRE(omega_viewport_get_string(viewport_fixed_ptr) == "5678");
    REQUIRE(omega_viewport_get_string(viewport_floating_ptr) == "5678");
    omega_edit_destroy_viewport(viewport_fixed_ptr);
    REQUIRE(1 == omega_session_get_num_viewports(session_ptr));
    omega_edit_destroy_viewport(viewport_floating_ptr);
    REQUIRE(0 == omega_session_get_num_viewports(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

void session_save_test_session_cbk(const omega_session_t *session_ptr, omega_session_event_t session_event,
                                   const void *) {
    auto count_ptr = reinterpret_cast<int *>(omega_session_get_user_data_ptr(session_ptr));
    std::clog << "Session Event: " << session_event << std::endl;
    ++*count_ptr;
}

void session_save_test_viewport_cbk(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                                    const void *) {
    auto count_ptr = reinterpret_cast<int *>(omega_viewport_get_user_data_ptr(viewport_ptr));
    std::clog << "Viewport Event: " << viewport_event << std::endl;
    ++*count_ptr;
}

TEST_CASE("Session Save", "[SessionSaveTests]") {
    char saved_filename[FILENAME_MAX];
    int session_events_count = 0;
    int viewport_events_count = 0;
    auto session_ptr =
            omega_edit_create_session(nullptr, session_save_test_session_cbk, &session_events_count, ALL_EVENTS);
    REQUIRE(1 == session_events_count);// SESSION_EVT_CREATE
    auto viewport_ptr = omega_edit_create_viewport(session_ptr, 0, 100, 0, session_save_test_viewport_cbk,
                                                   &viewport_events_count, ALL_EVENTS);

    REQUIRE(2 == session_events_count); // SESSION_EVT_CREATE_VIEWPORT
    REQUIRE(1 == viewport_events_count);// VIEWPORT_EVT_CREATE
    omega_edit_insert_string(session_ptr, 0, "0123456789");
    REQUIRE(3 == session_events_count); // SESSION_EVT_EDIT
    REQUIRE(2 == viewport_events_count);// VIEWPORT_EVT_EDIT
    omega_util_remove_file("data/session_save.1.dat");
    omega_edit_save(session_ptr, "data/session_save.1.dat", 1, saved_filename);
    REQUIRE(omega_util_paths_equivalent("data/session_save.1.dat", saved_filename));
    REQUIRE(4 == session_events_count); // SESSION_EVT_SAVE
    REQUIRE(2 == viewport_events_count);// no additional viewport events
    omega_edit_destroy_session(session_ptr);
    session_events_count = 0;
    viewport_events_count = 0;
    session_ptr = omega_edit_create_session("data/session_save.1.dat", session_save_test_session_cbk,
                                            &session_events_count, ALL_EVENTS);
    REQUIRE(1 == session_events_count);
    viewport_ptr = omega_edit_create_viewport(session_ptr, 0, 100, 0, session_save_test_viewport_cbk,
                                              &viewport_events_count, ALL_EVENTS);
    REQUIRE(2 == session_events_count);
    REQUIRE(1 == viewport_events_count);
    omega_edit_insert_string(session_ptr, omega_session_get_computed_file_size(session_ptr),
                             "abcdefghijklmnopqrstuvwxyz");
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(3 == session_events_count);
    REQUIRE(2 == viewport_events_count);
    omega_edit_save(session_ptr, "data/session_save.1.dat", 1, saved_filename);
    REQUIRE(omega_util_paths_equivalent("data/session_save.1.dat", saved_filename));
    REQUIRE(0 == compare_files("data/session_save.expected.1.dat", "data/session_save.1.dat"));
    REQUIRE(0 == omega_session_get_num_changes(session_ptr));
    REQUIRE(5 == session_events_count); // SESSION_EVT_CLEAR and SESSION_EVT_SAVE
    REQUIRE(2 == viewport_events_count);// no additional viewport events
    omega_edit_insert_string(session_ptr, omega_session_get_computed_file_size(session_ptr),
                             "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    omega_util_remove_file("data/session_save.1-1.dat");
    REQUIRE(6 == session_events_count); // SESSION_EVT_SAVE
    REQUIRE(3 == viewport_events_count);// VIEWPORT_EVT_EDIT
    omega_edit_save(session_ptr, "data/session_save.1.dat", 0, saved_filename);
    REQUIRE(7 == session_events_count);// SESSION_EVT_SAVE
    REQUIRE(omega_util_paths_equivalent("data/session_save.1-1.dat", saved_filename));
    REQUIRE(0 == compare_files("data/session_save.expected.2.dat", "data/session_save.1-1.dat"));
    omega_util_remove_file("data/session_save.1-2.dat");
    omega_edit_save(session_ptr, "data/session_save.1.dat", 0, saved_filename);
    REQUIRE(8 == session_events_count);// SESSION_EVT_SAVE
    REQUIRE(omega_util_paths_equivalent("data/session_save.1-2.dat", saved_filename));
    REQUIRE(0 == compare_files("data/session_save.expected.2.dat", "data/session_save.1-2.dat"));
    omega_util_remove_file("data/session_save.1-3.dat");
    omega_edit_save(session_ptr, "data/session_save.1.dat", 0, saved_filename);
    REQUIRE(9 == session_events_count);// SESSION_EVT_SAVE
    REQUIRE(omega_util_paths_equivalent("data/session_save.1-3.dat", saved_filename));
    REQUIRE(0 == compare_files("data/session_save.expected.2.dat", "data/session_save.1-3.dat"));
    omega_edit_destroy_session(session_ptr);
}
