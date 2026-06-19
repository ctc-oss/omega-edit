/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed on an "AS IS" BASIS, WITHOUT    *
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the License for the specific language         *
 * governing permissions and limitations under the License.                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

#include "omega_edit.h"
#include "omega_edit/stl_string_adaptor.hpp"

#include <test_util.hpp>

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <string>
#include <vector>

TEST_CASE("Packaged Transform Plugins", "[TransformPlugin]") {
    REQUIRE(std::filesystem::is_directory(PLUGIN_DIR));

    const auto registry_ptr = omega_transform_plugin_registry_create();
    REQUIRE(registry_ptr);
    REQUIRE(0 < omega_transform_plugin_registry_register_directory(registry_ptr, PLUGIN_DIR.string().c_str()));
    REQUIRE(10 <= omega_transform_plugin_registry_get_count(registry_ptr));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.and"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.base64_decode"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.base64_encode"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.fnv1a64"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.or"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.zlib_compress"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.zlib_decompress"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.xor"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.repeat"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.checksum8"));
    const auto base64_encode_info =
            omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.base64_encode");
    REQUIRE("" == std::string(base64_encode_info->args_schema));
    const auto xor_info = omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.xor");
    REQUIRE("XOR" == std::string(xor_info->name));
    REQUIRE(std::string(xor_info->help).find("Options JSON accepts") != std::string::npos);
    REQUIRE("{\"mask\":[\"0x42\",\"0x24\"]}" == std::string(xor_info->example));
    REQUIRE("{\"byte\":\"0xFF\"}" == std::string(xor_info->default_args));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"mask\":[\"0x01\",\"0x02\"]}",
                                                                  xor_info->args_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"\\u0062yte\":\"0x01\"}", xor_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"bytes\":[\"0x01\",\"0x02\"]}",
                                                                   xor_info->args_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(
                         "{\"name\":\"caf\\u00E9\",\"emoji\":\"\\uD83D\\uDE00\"}",
                         "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\",\"pattern\":\"^caf\\u00E9$"
                         "\"},\"emoji\":{\"type\":\"string\"}},\"additionalProperties\":false}"));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(
                          "{\"emoji\":\"\\uD83D\"}", "{\"type\":\"object\",\"properties\":{\"emoji\":{\"type\":"
                                                     "\"string\"}},\"additionalProperties\":false}"));
    const auto zlib_compress_info =
            omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.zlib_compress");
    REQUIRE("Zlib Compress" == std::string(zlib_compress_info->name));
    REQUIRE(std::string(zlib_compress_info->help).find("level") != std::string::npos);
    REQUIRE("{\"level\":9}" == std::string(zlib_compress_info->example));
    REQUIRE("{\"level\":-1}" == std::string(zlib_compress_info->default_args));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"level\":9}", zlib_compress_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"level\":10}", zlib_compress_info->args_schema));

    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "ABCD"));

    omega_transform_plugin_response_t response{};
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.repeat", session_ptr,
                                                                  1, 2, nullptr, &response));
    REQUIRE("ABCBCD" == omega_session_get_segment_string(session_ptr, 0,
                                                         omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.checksum8", session_ptr,
                                                                  0, 0, nullptr, &response));
    REQUIRE(4 == response.result_length);
    REQUIRE("0x8F" == std::string(reinterpret_cast<const char *>(response.result_bytes),
                                  static_cast<size_t>(response.result_length)));
    REQUIRE("checksum8" == std::string(response.result_label));
    REQUIRE("ABCBCD" == omega_session_get_segment_string(session_ptr, 0,
                                                         omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.xor", session_ptr,
                                                                  0, 1, nullptr, &response));
    REQUIRE(std::string({static_cast<char>(0xBE), 'B', 'C', 'B', 'C', 'D'}) ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.xor", session_ptr,
                                                                  1, 1, "{\"byte\":\"0x42\"}", &response));
    REQUIRE(std::string({static_cast<char>(0xBE), static_cast<char>('B' ^ 0x42), 'C', 'B', 'C', 'D'}) ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.xor", session_ptr,
                                                                   1, 1, "{\"byte\":256}", &response));

    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(
                          registry_ptr, "omega.example.xor", session_ptr, 2, 2, "{\"bytes\":[\"0x01\",\"0x02\"]}",
                          &response));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.xor", session_ptr, 2, 2, "{\"mask\":[\"0x01\",\"0x02\"]}",
                         &response));
    REQUIRE(std::string({static_cast<char>(0xBE), static_cast<char>('B' ^ 0x42),
                         static_cast<char>('C' ^ 0x01), static_cast<char>('B' ^ 0x02), 'C', 'D'}) ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.and", session_ptr, 2, 2, "{\"mask\":[\"0x0F\",\"0xF0\"]}",
                         &response));
    REQUIRE(std::string({static_cast<char>(0xBE), static_cast<char>('B' ^ 0x42),
                         static_cast<char>(('C' ^ 0x01) & 0x0F),
                         static_cast<char>(('B' ^ 0x02) & 0xF0), 'C', 'D'}) ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.or", session_ptr, 4, 2, "{\"mask\":[\"0x01\",\"0x02\"]}",
                         &response));
    REQUIRE(std::string({static_cast<char>(0xBE), static_cast<char>('B' ^ 0x42),
                         static_cast<char>(('C' ^ 0x01) & 0x0F),
                         static_cast<char>(('B' ^ 0x02) & 0xF0), static_cast<char>('C' | 0x01),
                         static_cast<char>('D' | 0x02)}) ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    const auto codec_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(codec_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(codec_session_ptr, 0, "hello"));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.base64_encode",
                                                                  codec_session_ptr, 0, 5, nullptr, &response));
    REQUIRE("aGVsbG8=" == omega_session_get_segment_string(codec_session_ptr, 0,
                                                          omega_session_get_computed_file_size(codec_session_ptr)));
    REQUIRE(8 == response.replacement_length);
    omega_transform_plugin_response_clear(&response);

    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.base64_encode",
                                                                   codec_session_ptr, 0, 5, "{\"level\":9}",
                                                                   &response));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.base64_decode",
                                                                  codec_session_ptr, 0, 0, nullptr, &response));
    REQUIRE("hello" == omega_session_get_segment_string(codec_session_ptr, 0,
                                                        omega_session_get_computed_file_size(codec_session_ptr)));
    REQUIRE(5 == response.replacement_length);
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.fnv1a64",
                                                                  codec_session_ptr, 0, 5, nullptr, &response));
    REQUIRE(18 == response.result_length);
    REQUIRE("0xA430D84680AABD0B" == std::string(reinterpret_cast<const char *>(response.result_bytes),
                                               static_cast<size_t>(response.result_length)));
    REQUIRE("fnv1a64" == std::string(response.result_label));
    omega_transform_plugin_response_clear(&response);

    const auto large_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(large_session_ptr);
    const std::vector<omega_byte_t> large_bytes(5 * 1024 * 1024, static_cast<omega_byte_t>(1));
    REQUIRE(0 < omega_edit_insert_bytes(large_session_ptr, 0, large_bytes.data(),
                                        static_cast<int64_t>(large_bytes.size())));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.checksum8",
                                                                  large_session_ptr, 0, 0, nullptr, &response));
    REQUIRE(4 == response.result_length);
    REQUIRE("0x00" == std::string(reinterpret_cast<const char *>(response.result_bytes),
                                  static_cast<size_t>(response.result_length)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.fnv1a64",
                                                                  large_session_ptr, 0, 0, nullptr, &response));
    REQUIRE(18 == response.result_length);
    REQUIRE("fnv1a64" == std::string(response.result_label));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(large_session_ptr);

    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.zlib_compress",
                                                                   codec_session_ptr, 0, 5, "{\"level\":10}",
                                                                   &response));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.zlib_compress",
                                                                  codec_session_ptr, 0, 5, "{\"level\":9}",
                                                                  &response));
    REQUIRE(0 < response.replacement_length);
    {
        const auto compressed = omega_session_get_segment_string(codec_session_ptr, 0,
                                                                omega_session_get_computed_file_size(codec_session_ptr));
        REQUIRE(response.replacement_length == static_cast<int64_t>(compressed.size()));
        REQUIRE(8 == (static_cast<unsigned char>(compressed[0]) & 0x0F));
    }
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.zlib_decompress",
                                                                  codec_session_ptr, 0, 0, nullptr, &response));
    REQUIRE("hello" == omega_session_get_segment_string(codec_session_ptr, 0,
                                                        omega_session_get_computed_file_size(codec_session_ptr)));
    REQUIRE(5 == response.replacement_length);
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 < omega_edit_insert_string(codec_session_ptr, omega_session_get_computed_file_size(codec_session_ptr),
                                         "!"));
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.base64_decode",
                                                                   codec_session_ptr, 0, 0, nullptr, &response));
    omega_edit_destroy_session(codec_session_ptr);

    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.missing", session_ptr,
                                                                   0, 0, nullptr, nullptr));

    omega_edit_destroy_session(session_ptr);
    omega_transform_plugin_registry_destroy(registry_ptr);
}
