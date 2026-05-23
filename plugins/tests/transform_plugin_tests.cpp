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

TEST_CASE("Packaged Transform Plugins", "[TransformPlugin]") {
    REQUIRE(std::filesystem::is_directory(PLUGIN_DIR));

    const auto registry_ptr = omega_transform_plugin_registry_create();
    REQUIRE(registry_ptr);
    REQUIRE(0 < omega_transform_plugin_registry_register_directory(registry_ptr, PLUGIN_DIR.string().c_str()));
    REQUIRE(8 <= omega_transform_plugin_registry_get_count(registry_ptr));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.base64_decode"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.base64_encode"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.fnv1a64"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.zlib_compress"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.zlib_decompress"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.xor"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.repeat"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.checksum8"));

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

    const auto codec_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(codec_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(codec_session_ptr, 0, "hello"));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.base64_encode",
                                                                  codec_session_ptr, 0, 5, nullptr, &response));
    REQUIRE("aGVsbG8=" == omega_session_get_segment_string(codec_session_ptr, 0,
                                                          omega_session_get_computed_file_size(codec_session_ptr)));
    REQUIRE(8 == response.replacement_length);
    omega_transform_plugin_response_clear(&response);

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

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.zlib_compress",
                                                                  codec_session_ptr, 0, 5, nullptr, &response));
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
