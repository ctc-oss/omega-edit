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

#include <chrono>
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


TEST_CASE("Encoding", "[EncodingTest]") {
    auto in_string = string("Hello World!");
    auto in = reinterpret_cast<const omega_byte_t *>(in_string.data());
    char encoded_buffer[1024];
    omega_byte_t decoded_buffer[1024];
    omega_encode_bin2hex(in, encoded_buffer, in_string.size());
    REQUIRE_THAT(encoded_buffer, Equals("48656c6c6f20576f726c6421"));
    omega_encode_hex2bin(encoded_buffer, decoded_buffer, strlen(encoded_buffer));
    REQUIRE_THAT(reinterpret_cast<const char *>(decoded_buffer), Equals(in_string));
    omega_encode_hex2bin("48656C6C6F20576F726C6421", decoded_buffer, strlen(encoded_buffer));
    REQUIRE_THAT(reinterpret_cast<const char *>(decoded_buffer), Equals(in_string));
}