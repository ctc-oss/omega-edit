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

#include "omega_edit/filesystem.h"
#include "omega_edit/utility.h"
#include <test_util.hpp>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_contains.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

using namespace std;
namespace fs = std::filesystem;

using Catch::Matchers::Contains;
using Catch::Matchers::EndsWith;
using Catch::Matchers::Equals;

TEST_CASE("Buffer Shift", "[BufferShift]") {
    auto const fill = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    auto const buff_len = (int64_t) strlen(fill);
    auto *buffer = (omega_byte_t *) omega_util_strndup(fill, buff_len);

    // Negative tests.  Shifting 8 or more bits in either direction should be an error.
    REQUIRE(-1 == omega_util_left_shift_buffer(buffer, buff_len, 8, 0));
    REQUIRE(-1 == omega_util_right_shift_buffer(buffer, buff_len, 8, 0));
    REQUIRE(-1 == omega_util_left_shift_buffer(buffer, buff_len, 0, 1));
    REQUIRE(-1 == omega_util_right_shift_buffer(buffer, buff_len, 0, 1));
    REQUIRE(-2 == omega_util_left_shift_buffer(buffer, buff_len, 4, 2));
    REQUIRE(-2 == omega_util_right_shift_buffer(buffer, buff_len, 4, 2));

    // Shift the buffer 3 bits to the right
    REQUIRE(0 == omega_util_right_shift_buffer(buffer, buff_len, 3, 0));
    // Shift the buffer 5 bits to the right
    REQUIRE(0 == omega_util_right_shift_buffer(buffer, buff_len, 5, 0));
    // Should equal \x000123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxy
    // We shifted a total of 8 bits (one byte) to the right, so compare the first byte of the buffer with null and the buffer plus one against the fill minus the first character
    REQUIRE(buffer[0] == '\x00');
    REQUIRE_THAT(std::string((const char *) buffer + 1), Equals(std::string(fill, buff_len - 1)));

    // Reset the buffer
    strcpy((char *) buffer, fill);

    // Shift the buffer 3 bits to the right, filling the vacancies with 1s
    REQUIRE(0 == omega_util_right_shift_buffer(buffer, buff_len, 3, 1));
    // Shift the buffer 5 bits to the right, filling the vacancies with 1s
    REQUIRE(0 == omega_util_right_shift_buffer(buffer, buff_len, 5, 1));
    // Should equal \xFF0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxy
    // We shifted a total of 8 bits (one byte) to the right, so compare the buffer against the fill minus the last character, with the first byte filled with 1s
    REQUIRE_THAT(std::string((const char *) buffer), Equals(std::string("\xFF") + std::string(fill, buff_len - 1)));

    // Reset the buffer
    strcpy((char *) buffer, fill);

    // Shift the buffer 2 bits to the left
    REQUIRE(0 == omega_util_left_shift_buffer(buffer, buff_len, 2, 0));
    // Shift the buffer 6 bits to the left
    REQUIRE(0 == omega_util_left_shift_buffer(buffer, buff_len, 6, 0));
    // Should equal 123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz\x00
    // We shifted a total of 8 bits (one byte) to the left, so compare the buffer against the fill plus one null byte
    REQUIRE(buffer[buff_len] == '\x00');
    REQUIRE_THAT(std::string((const char *) buffer, buff_len - 1), Equals(std::string(fill + 1, buff_len - 1)));

    // Left shift tests with fill bit 1
    // Reset the buffer
    strcpy((char *) buffer, fill);

    // Shift the buffer 2 bits to the left, filling the vacancies with 1s
    REQUIRE(0 == omega_util_left_shift_buffer(buffer, buff_len, 2, 1));
    // Shift the buffer 6 bits to the left, filling the vacancies with 1s
    REQUIRE(0 == omega_util_left_shift_buffer(buffer, buff_len, 6, 1));
    // Should equal 123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz\xFF
    // We shifted a total of 8 bits (one byte) to the left, so compare the buffer against the fill minus the first character, with the last byte filled with 1s
    REQUIRE_THAT(std::string((const char *) buffer), Equals(std::string(fill + 1) + "\xFF"));

    strcpy((char *) buffer, "ABCD");
    REQUIRE(0 == omega_util_right_shift_buffer(buffer, 4, 2, 0));
    REQUIRE_THAT(std::string((const char *) buffer), Equals("\x10\x50\x90\xD1"));

    strcpy((char *) buffer, "WXYZ");
    REQUIRE(0 == omega_util_right_shift_buffer(buffer, 4, 4, 1));
    REQUIRE_THAT(std::string((const char *) buffer), Equals("\xF5\x75\x85\x95"));

    strcpy((char *) buffer, "1234");
    REQUIRE(0 == omega_util_left_shift_buffer(buffer, 4, 3, 0));
    REQUIRE_THAT(std::string((const char *) buffer), Equals("\x89\x91\x99\xA0"));

    strcpy((char *) buffer, "abcd");
    REQUIRE(0 == omega_util_left_shift_buffer(buffer, 4, 7, 1));
    REQUIRE_THAT(std::string((const char *) buffer), Equals("\xB1\x31\xB2\x7F"));

    free(buffer);
}

TEST_CASE("Transformer", "[TransformerTest]") {
    omega_byte_t bytes[32];
    strcpy(reinterpret_cast<char *>(bytes), "Hello World!");
    const auto bytes_length = static_cast<int64_t>(strlen(reinterpret_cast<const char *>(bytes)));
    omega_util_apply_byte_transform(bytes, bytes_length, to_upper, nullptr);
    REQUIRE_THAT(string(reinterpret_cast<const char *>(bytes)), Equals("HELLO WORLD!"));
    omega_util_apply_byte_transform(bytes, bytes_length, to_lower, nullptr);
    REQUIRE_THAT(string(reinterpret_cast<const char *>(bytes)), Equals("hello world!"));
    omega_util_apply_byte_transform(bytes, 1, to_upper, nullptr);
    REQUIRE_THAT(string(reinterpret_cast<const char *>(bytes)), Equals("Hello world!"));
}

TEST_CASE("File Transformer", "[TransformerTest]") {
    REQUIRE(0 == omega_util_apply_byte_transform_to_file(
        MAKE_PATH("test1.dat"), MAKE_PATH("test1.actual.transformed.1.dat"), to_upper, nullptr, 0, 0));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.expected.transformed.1.dat"),
        MAKE_PATH("test1.actual.transformed.1.dat")));
    REQUIRE(0 == omega_util_apply_byte_transform_to_file(MAKE_PATH("test1.dat"),
        MAKE_PATH("test1.actual.transformed.2.dat"), to_lower, nullptr,
        37, 10));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.expected.transformed.2.dat"),
        MAKE_PATH("test1.actual.transformed.2.dat")));
    REQUIRE(0 != omega_util_apply_byte_transform_to_file(MAKE_PATH("test1.dat"),
        MAKE_PATH("test1.actual.transformed.3.dat"), to_lower, nullptr,
        37, 100));
    REQUIRE(0 == omega_util_file_exists(MAKE_PATH("test1.actual.transformed.3.dat")));
}