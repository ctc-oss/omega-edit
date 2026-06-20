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
    REQUIRE(16 <= omega_transform_plugin_registry_get_count(registry_ptr));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.and"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.base64_decode"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.base64_encode"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.blake2b512"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.blake2s256"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.character_transcode"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.common_checksums"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.decimal_codecs"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.endian_swap"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.format_inspectors"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.fnv1a64"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.md5"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.or"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.record_text_helpers"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.sha1"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.sha224"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.sha256"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.sha3_256"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.sha3_512"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.sha384"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.sha512"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.text_codecs"));
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
    const auto sha256_info = omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.sha256");
    REQUIRE("SHA-256" == std::string(sha256_info->name));
    REQUIRE(std::string(sha256_info->description).find("SHA-256") != std::string::npos);
    REQUIRE(std::string(OMEGA_TRANSFORM_PLUGIN_NO_ARGS_SCHEMA) == std::string(sha256_info->args_schema));

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

    const auto require_digest_result = [&](const char *plugin_id, const char *label, const char *expected) {
        REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, plugin_id, codec_session_ptr, 0,
                                                                      5, nullptr, &response));
        REQUIRE(static_cast<int64_t>(std::string(expected).size()) == response.result_length);
        REQUIRE(expected == std::string(reinterpret_cast<const char *>(response.result_bytes),
                                        static_cast<size_t>(response.result_length)));
        REQUIRE(label == std::string(response.result_label));
        omega_transform_plugin_response_clear(&response);
    };

    require_digest_result("omega.example.md5", "md5", "5d41402abc4b2a76b9719d911017c592");
    require_digest_result("omega.example.sha1", "sha1", "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
    require_digest_result("omega.example.sha224", "sha224",
                          "ea09ae9cc6768c50fcee903ed054556e5bfc8347907f12598aa24193");
    require_digest_result("omega.example.sha256", "sha256",
                          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    require_digest_result("omega.example.sha384", "sha384",
                          "59e1748777448c69de6b800d7a33bbfb9ff1b463e44354c3553bcdb9c666fa90125a3c79f"
                          "90397bdf5f6a13de828684f");
    require_digest_result("omega.example.sha512", "sha512",
                          "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c"
                          "3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043");
    require_digest_result("omega.example.sha3_256", "sha3-256",
                          "3338be694f50c5f338814986cdf0686453a888b84f424d792af4b9202398f392");
    require_digest_result("omega.example.sha3_512", "sha3-512",
                          "75d527c368f2efe848ecf6b073a36767800805e9eef2b1857d5f984f036eb6df891d75f72d9b"
                          "154518c1cd58835286d1da9a38deba3de98b5a53e5ed78a84976");
    require_digest_result("omega.example.blake2b512", "blake2b-512",
                          "e4cfa39a3d37be31c59609e807970799caa68a19bfaa15135f165085e01d41a65ba1e1b146ae"
                          "b6bd0092b49eac214c103ccfa3a365954bbbe52f74a2b3620c94");
    require_digest_result("omega.example.blake2s256", "blake2s-256",
                          "19213bacc58dee6dbde3ceb9a47cbb330b3d86f8cca8997eb00be456f140ca25");

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

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.sha256",
                                                                  large_session_ptr, 0, 0, nullptr, &response));
    REQUIRE(64 == response.result_length);
    REQUIRE("c283e17a1b90a352c91de2c445b711c5c4126279eff884b8ffc44893576b19ef" ==
            std::string(reinterpret_cast<const char *>(response.result_bytes),
                        static_cast<size_t>(response.result_length)));
    REQUIRE("sha256" == std::string(response.result_label));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(large_session_ptr);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.common_checksums", codec_session_ptr, 0, 5,
                         "{\"algorithm\":\"crc32\"}", &response));
    REQUIRE("0x3610A686" == std::string(reinterpret_cast<const char *>(response.result_bytes),
                                        static_cast<size_t>(response.result_length)));
    REQUIRE("crc32" == std::string(response.result_label));
    omega_transform_plugin_response_clear(&response);

    const auto checksum_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(checksum_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(checksum_session_ptr, 0, "123456789"));
    const auto require_checksum_result = [&](const char *algorithm, const char *expected) {
        const std::string options = std::string("{\"algorithm\":\"") + algorithm + "\"}";
        REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.common_checksums",
                                                                      checksum_session_ptr, 0, 9, options.c_str(),
                                                                      &response));
        REQUIRE(expected == std::string(reinterpret_cast<const char *>(response.result_bytes),
                                        static_cast<size_t>(response.result_length)));
        REQUIRE(algorithm == std::string(response.result_label));
        omega_transform_plugin_response_clear(&response);
    };
    require_checksum_result("crc32", "0xCBF43926");
    require_checksum_result("crc32c", "0xE3069283");
    require_checksum_result("crc32-mpeg2", "0x0376E6E7");
    require_checksum_result("crc32-bzip2", "0xFC891918");
    require_checksum_result("crc16-ibm", "0xBB3D");
    require_checksum_result("crc16-ccitt-false", "0x29B1");
    require_checksum_result("crc16-xmodem", "0x31C3");
    require_checksum_result("crc16-modbus", "0x4B37");
    require_checksum_result("crc16-kermit", "0x2189");
    require_checksum_result("crc8", "0xF4");
    require_checksum_result("adler32", "0x091E01DE");
    require_checksum_result("fletcher16", "0x1EDE");
    require_checksum_result("fletcher32", "0x09DF09D5");
    require_checksum_result("internet-checksum", "0xF62A");
    require_checksum_result("lrc", "0x23");
    require_checksum_result("bcc", "0x31");
    require_checksum_result("sum8", "0xDD");
    require_checksum_result("sum16", "0x01DD");
    require_checksum_result("sum32", "0x000001DD");
    require_checksum_result("fnv1a32", "0xBB86B11C");
    require_checksum_result("fnv1a64", "0x06D5573923C6CDFC");
    require_checksum_result("murmur3-32", "0xB4FEF382");
    require_checksum_result("xxhash32", "0x937BAD67");
    require_checksum_result("xxhash64", "0x8CB841DB40E6AE83");
    omega_edit_destroy_session(checksum_session_ptr);

    const auto text_codec_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(text_codec_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(text_codec_session_ptr, 0, "hello"));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.text_codecs", text_codec_session_ptr, 0, 5,
                         "{\"codec\":\"hex\",\"direction\":\"encode\"}", &response));
    REQUIRE("68656c6c6f" == omega_session_get_segment_string(text_codec_session_ptr, 0,
                                                            omega_session_get_computed_file_size(text_codec_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.text_codecs", text_codec_session_ptr, 0, 0,
                         "{\"codec\":\"hex\",\"direction\":\"decode\"}", &response));
    REQUIRE("hello" == omega_session_get_segment_string(text_codec_session_ptr, 0,
                                                        omega_session_get_computed_file_size(text_codec_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.text_codecs", text_codec_session_ptr, 0, 5,
                         "{\"codec\":\"base64url\",\"direction\":\"encode\"}", &response));
    REQUIRE("aGVsbG8" == omega_session_get_segment_string(text_codec_session_ptr, 0,
                                                          omega_session_get_computed_file_size(text_codec_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.text_codecs", text_codec_session_ptr, 0, 0,
                         "{\"codec\":\"base64url\",\"direction\":\"decode\"}", &response));
    REQUIRE("hello" == omega_session_get_segment_string(text_codec_session_ptr, 0,
                                                        omega_session_get_computed_file_size(text_codec_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(text_codec_session_ptr);

    const auto charset_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(charset_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(charset_session_ptr, 0, "ABC"));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.character_transcode", charset_session_ptr, 0, 3,
                         "{\"from\":\"utf-8\",\"to\":\"ebcdic-037\"}", &response));
    REQUIRE(std::string({static_cast<char>(0xC1), static_cast<char>(0xC2), static_cast<char>(0xC3)}) ==
            omega_session_get_segment_string(charset_session_ptr, 0, omega_session_get_computed_file_size(charset_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.character_transcode", charset_session_ptr, 0, 3,
                         "{\"from\":\"ebcdic-037\",\"to\":\"utf-8\"}", &response));
    REQUIRE("ABC" == omega_session_get_segment_string(charset_session_ptr, 0,
                                                      omega_session_get_computed_file_size(charset_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(charset_session_ptr);

    const auto invalid_utf8_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(invalid_utf8_session_ptr);
    const omega_byte_t overlong_utf8_bytes[] = {0xC0, 0xAF};
    REQUIRE(0 < omega_edit_insert_bytes(invalid_utf8_session_ptr, 0, overlong_utf8_bytes, 2));
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(
                          registry_ptr, "omega.example.character_transcode", invalid_utf8_session_ptr, 0, 2,
                          "{\"from\":\"utf-8\",\"to\":\"utf-16le\"}", &response));
    omega_edit_destroy_session(invalid_utf8_session_ptr);

    const auto helper_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(helper_session_ptr);
    const omega_byte_t endian_bytes[] = {1, 2, 3, 4};
    REQUIRE(0 < omega_edit_insert_bytes(helper_session_ptr, 0, endian_bytes, 4));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.endian_swap",
                                                                  helper_session_ptr, 0, 4, "{\"width\":2}",
                                                                  &response));
    REQUIRE(std::string({2, 1, 4, 3}) ==
            omega_session_get_segment_string(helper_session_ptr, 0, omega_session_get_computed_file_size(helper_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(helper_session_ptr);

    const auto decimal_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(decimal_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(decimal_session_ptr, 0, "123"));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.decimal_codecs", decimal_session_ptr, 0, 3,
                         "{\"codec\":\"packed-decimal\",\"direction\":\"encode\"}", &response));
    REQUIRE(std::string({static_cast<char>(0x12), static_cast<char>(0x3C)}) ==
            omega_session_get_segment_string(decimal_session_ptr, 0, omega_session_get_computed_file_size(decimal_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(decimal_session_ptr);

    const auto format_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(format_session_ptr);
    const omega_byte_t varint_bytes[] = {0x96, 0x01};
    REQUIRE(0 < omega_edit_insert_bytes(format_session_ptr, 0, varint_bytes, 2));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.format_inspectors", format_session_ptr, 0, 2,
                         "{\"format\":\"protobuf-varint\"}", &response));
    REQUIRE(std::string(reinterpret_cast<const char *>(response.result_bytes),
                        static_cast<size_t>(response.result_length)).find("value=150") != std::string::npos);
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(format_session_ptr);

    const auto record_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(record_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(record_session_ptr, 0, "<&"));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.record_text_helpers", record_session_ptr, 0, 2,
                         "{\"action\":\"xml-escape\"}", &response));
    REQUIRE("&lt;&amp;" == omega_session_get_segment_string(record_session_ptr, 0,
                                                           omega_session_get_computed_file_size(record_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(record_session_ptr);

    const auto invalid_csv_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(invalid_csv_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(invalid_csv_session_ptr, 0, "\"abc\"\""));
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(
                          registry_ptr, "omega.example.record_text_helpers", invalid_csv_session_ptr, 0, 6,
                          "{\"action\":\"csv-unquote\"}", &response));
    omega_edit_destroy_session(invalid_csv_session_ptr);

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
