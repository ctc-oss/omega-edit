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

#include <cstring>
#include <filesystem>
#include <string>
#include <vector>

namespace {
    struct cancellation_state_t {
        int calls{};
        int cancel_after{};
    };

    struct byte_reader_state_t {
        const omega_byte_t *bytes{};
        int64_t length{};
        int calls{};
    };

    int cancel_after_callback(void *user_data_ptr) {
        auto *state = static_cast<cancellation_state_t *>(user_data_ptr);
        if (!state) { return 0; }
        ++state->calls;
        return state->calls > state->cancel_after ? 1 : 0;
    }

    int64_t byte_reader_callback(int64_t relative_offset, omega_byte_t *buffer, int64_t length, void *user_data_ptr) {
        auto *state = static_cast<byte_reader_state_t *>(user_data_ptr);
        if (!state || !buffer || relative_offset < 0 || length <= 0 || relative_offset >= state->length) { return -1; }
        ++state->calls;
        const auto remaining = state->length - relative_offset;
        const auto bytes_to_copy = remaining < length ? remaining : length;
        std::memcpy(buffer, state->bytes + relative_offset, static_cast<size_t>(bytes_to_copy));
        return bytes_to_copy;
    }

    std::string bytes_to_hex(const omega_byte_t *bytes, int64_t length) {
        static const char hex[] = "0123456789abcdef";
        std::string result;
        if (!bytes || length <= 0) { return result; }
        result.reserve(static_cast<size_t>(length) * 2);
        for (int64_t index = 0; index < length; ++index) {
            const auto byte = static_cast<unsigned char>(bytes[index]);
            result.push_back(hex[(byte >> 4U) & 0x0FU]);
            result.push_back(hex[byte & 0x0FU]);
        }
        return result;
    }
}// namespace

TEST_CASE("Packaged Transform Plugins", "[TransformPlugin]") {
    REQUIRE(std::filesystem::is_directory(PLUGIN_DIR));

    const auto production_registry_ptr = omega_transform_plugin_registry_create();
    REQUIRE(production_registry_ptr);
    REQUIRE(0 <
            omega_transform_plugin_registry_register_directory(production_registry_ptr, PLUGIN_DIR.string().c_str()));
    REQUIRE(6 == omega_transform_plugin_registry_get_count(production_registry_ptr));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(production_registry_ptr, "omega.example.base64"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(production_registry_ptr, "omega.example.bitwise"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(production_registry_ptr, "omega.example.case_change"));
    REQUIRE(nullptr !=
            omega_transform_plugin_registry_find_info(production_registry_ptr, "omega.example.common_checksums"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(production_registry_ptr, "omega.example.endian_swap"));
    REQUIRE(nullptr !=
            omega_transform_plugin_registry_find_info(production_registry_ptr, "omega.example.openssl_digests"));
    REQUIRE(nullptr ==
            omega_transform_plugin_registry_find_info(production_registry_ptr, "omega.example.character_transcode"));
    REQUIRE(nullptr ==
            omega_transform_plugin_registry_find_info(production_registry_ptr, "omega.example.openssl_ciphers"));
    REQUIRE(nullptr == omega_transform_plugin_registry_find_info(production_registry_ptr, "omega.example.repeat"));
    omega_transform_plugin_registry_destroy(production_registry_ptr);

    const auto registry_ptr = omega_transform_plugin_registry_create();
    REQUIRE(registry_ptr);
    REQUIRE(0 == omega_transform_plugin_registry_set_allow_experimental(registry_ptr, 1));
    REQUIRE(0 < omega_transform_plugin_registry_register_directory(registry_ptr, PLUGIN_DIR.string().c_str()));
    REQUIRE(14 <= omega_transform_plugin_registry_get_count(registry_ptr));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.base64"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.bitwise"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.case_change"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.character_transcode"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.common_checksums"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.decimal_codecs"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.endian_swap"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.format_inspectors"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.openssl_ciphers"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.openssl_digests"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.record_text_helpers"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.text_codecs"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.zlib"));
    REQUIRE(nullptr != omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.repeat"));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{}", nullptr));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{}", ""));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{}", "{"));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{}", "[]"));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{}", "{\"properties\":{}}"));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{}", "{\"type\":1}"));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{}", "{\"type\":\"array\"}"));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{}", "{\"type\":\"OBJECT\"}"));
    const char *empty_object_schema = "{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}";
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(nullptr, empty_object_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("", empty_object_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{}", empty_object_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{", empty_object_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("[]", empty_object_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("\"text\"", empty_object_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"extra\":true}", empty_object_schema));
    const char *boolean_schema =
            "{\"type\":\"object\",\"properties\":{\"enabled\":{\"type\":\"boolean\"}},\"additionalProperties\":false}";
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"enabled\":true}", boolean_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"enabled\":false}", boolean_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"enabled\":\"true\"}", boolean_schema));
    const char *one_of_schema =
            "{\"type\":\"object\",\"properties\":{\"mode\":{\"oneOf\":[{\"type\":\"string\",\"enum\":[\"fast\"]},"
            "{\"type\":\"integer\",\"minimum\":2,\"maximum\":4}]}},\"additionalProperties\":false}";
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"mode\":\"fast\"}", one_of_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"mode\":3}", one_of_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"mode\":\"slow\"}", one_of_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"mode\":5}", one_of_schema));
    const char *not_schema =
            "{\"type\":\"object\",\"properties\":{\"mode\":{\"type\":\"string\",\"not\":{\"enum\":[\"forbidden\"]}}},"
            "\"additionalProperties\":false}";
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"mode\":\"allowed\"}", not_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"mode\":\"forbidden\"}", not_schema));
    const char *array_schema =
            "{\"type\":\"object\",\"properties\":{\"bytes\":{\"type\":\"array\",\"minItems\":2,"
            "\"items\":{\"type\":\"string\",\"pattern\":\"^[A-F0-9]+$\"}}},\"additionalProperties\":false}";
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"bytes\":[\"AA\",\"0F\"]}", array_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"bytes\":[\"AA\"]}", array_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"bytes\":[\"aa\",\"0F\"]}", array_schema));
    const char *strict_without_properties_schema = R"json({
        "type":"object",
        "additionalProperties":false
    })json";
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(R"json({"extra":1})json",
                                                                   strict_without_properties_schema));
    const char *escaped_string_schema = R"json({
        "type":"object",
        "properties":{"text":{"type":"string","enum":["\b\f\n\r\t"]}},
        "additionalProperties":false
    })json";
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(R"json({"text":"\b\f\n\r\t"})json",
                                                                  escaped_string_schema));
    const char *numeric_integer_schema = R"json({
        "type":"object",
        "properties":{"value":{"type":"integer","minimum":-100,"maximum":100}},
        "additionalProperties":false
    })json";
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(R"json({"value":1e+2})json", numeric_integer_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(R"json({"value":1e+})json", numeric_integer_schema));
    const char *deep_enum_schema = R"json({
        "type":"object",
        "properties":{"value":{"enum":[null,true,[1,true,null],{"nested":["\u20AC",2]}]}},
        "additionalProperties":false
    })json";
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(R"json({"value":null})json", deep_enum_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(R"json({"value":true})json", deep_enum_schema));
    REQUIRE(0 ==
            omega_transform_plugin_options_match_args_schema(R"json({"value":[1,true,null]})json", deep_enum_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(R"json({"value":{"nested":["\u20AC",2]}})json",
                                                                  deep_enum_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(R"json({"value":[1,true]})json", deep_enum_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(R"json({"value":{"other":["\u20AC",2]}})json",
                                                                   deep_enum_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(R"json({"value":[1,]})json", deep_enum_schema));
    REQUIRE(-1 ==
            omega_transform_plugin_options_match_args_schema(R"json({"value":"unterminated})json", deep_enum_schema));
    const char *escaped_dot_pattern_schema = R"json({
        "type":"object",
        "properties":{"name":{"type":"string","pattern":"^a\\.$"}},
        "additionalProperties":false
    })json";
    REQUIRE(0 ==
            omega_transform_plugin_options_match_args_schema(R"json({"name":"a."})json", escaped_dot_pattern_schema));
    const char *escaped_digit_pattern_schema = R"json({
        "type":"object",
        "properties":{"name":{"type":"string","pattern":"^(a)\\1$"}},
        "additionalProperties":false
    })json";
    REQUIRE(-1 ==
            omega_transform_plugin_options_match_args_schema(R"json({"name":"aa"})json", escaped_digit_pattern_schema));
    const char *bad_range_quantifier_schema = R"json({
        "type":"object",
        "properties":{"name":{"type":"string","pattern":"^a{z}$"}},
        "additionalProperties":false
    })json";
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(R"json({"name":"a{z}"})json",
                                                                   bad_range_quantifier_schema));
    const char *unsupported_number_schema =
            "{\"type\":\"object\",\"properties\":{\"value\":{\"type\":\"number\"}},\"additionalProperties\":false}";
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"value\":1.5}", unsupported_number_schema));
    std::string deeply_nested_options;
    deeply_nested_options.append(300, '[');
    deeply_nested_options.append(300, ']');
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(deeply_nested_options.c_str(), empty_object_schema));
    for (int64_t index = 0; index < omega_transform_plugin_registry_get_count(registry_ptr); ++index) {
        const auto *info = omega_transform_plugin_registry_get_info(registry_ptr, index);
        REQUIRE(info);
        REQUIRE(info->args_schema);
        const std::string schema(info->args_schema);
        REQUIRE(schema.find("\"type\"") != std::string::npos);
        REQUIRE(schema.find("\"object\"") != std::string::npos);
    }
    const auto base64_info = omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.base64");
    REQUIRE("Base64" == std::string(base64_info->name));
    REQUIRE("{\"direction\":\"encode\"}" == std::string(base64_info->default_args));
    REQUIRE(0 ==
            omega_transform_plugin_options_match_args_schema("{\"direction\":\"decode\"}", base64_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"level\":9}", base64_info->args_schema));
    const auto bitwise_info = omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.bitwise");
    REQUIRE("Bitwise" == std::string(bitwise_info->name));
    REQUIRE(std::string(bitwise_info->help).find("logical operator") != std::string::npos);
    REQUIRE("{\"operator\":\"xor\",\"mask\":[\"0x42\",\"0x24\"]}" == std::string(bitwise_info->example));
    REQUIRE("{\"operator\":\"xor\",\"byte\":\"0xFF\"}" == std::string(bitwise_info->default_args));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"operator\":\"xor\",\"mask\":[\"0x01\",\"0x02\"]}",
                                                                  bitwise_info->args_schema));
    REQUIRE(0 ==
            omega_transform_plugin_options_match_args_schema("{\"\\u0062yte\":\"0x01\"}", bitwise_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"operator\":\"nand\",\"byte\":\"0x01\"}",
                                                                   bitwise_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"bytes\":[\"0x01\",\"0x02\"]}",
                                                                   bitwise_info->args_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(
                         "{\"name\":\"caf\\u00E9\",\"emoji\":\"\\uD83D\\uDE00\"}",
                         "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\",\"pattern\":\"^caf\\u00E9$"
                         "\"},\"emoji\":{\"type\":\"string\"}},\"additionalProperties\":false}"));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(
                          "{\"emoji\":\"\\uD83D\"}", "{\"type\":\"object\",\"properties\":{\"emoji\":{\"type\":"
                                                     "\"string\"}},\"additionalProperties\":false}"));
    const auto common_checksums_info =
            omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.common_checksums");
    REQUIRE("Common Checksums" == std::string(common_checksums_info->name));
    REQUIRE(std::string(common_checksums_info->args_schema).find("\"enum\"") != std::string::npos);
    REQUIRE(std::string(common_checksums_info->args_schema).find("\"x-omega-enumGroups\"") != std::string::npos);
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"algorithm\":\"crc32c\"}",
                                                                  common_checksums_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"algorithm\":\"not-a-checksum\"}",
                                                                   common_checksums_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(nullptr, common_checksums_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("", common_checksums_info->args_schema));
    const auto case_change_info = omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.case_change");
    REQUIRE("Case Change" == std::string(case_change_info->name));
    REQUIRE("{\"case\":\"upper\"}" == std::string(case_change_info->default_args));
    REQUIRE(0 ==
            omega_transform_plugin_options_match_args_schema("{\"case\":\"lower\"}", case_change_info->args_schema));
    REQUIRE(-1 ==
            omega_transform_plugin_options_match_args_schema("{\"case\":\"title\"}", case_change_info->args_schema));
    const auto zlib_info = omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.zlib");
    REQUIRE("Zlib" == std::string(zlib_info->name));
    REQUIRE(std::string(zlib_info->help).find("Compression level") != std::string::npos);
    REQUIRE("{\"action\":\"compress\",\"level\":9}" == std::string(zlib_info->example));
    REQUIRE("{\"action\":\"compress\",\"level\":-1}" == std::string(zlib_info->default_args));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"action\":\"compress\",\"level\":9}",
                                                                  zlib_info->args_schema));
    REQUIRE(0 ==
            omega_transform_plugin_options_match_args_schema("{\"action\":\"decompress\"}", zlib_info->args_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{\"action\":\"decompress\",\"maxOutputBytes\":1024}",
                                                                  zlib_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"action\":\"compress\",\"level\":10}",
                                                                   zlib_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"action\":\"decompress\",\"maxOutputBytes\":0}",
                                                                   zlib_info->args_schema));
    const auto cipher_info = omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.openssl_ciphers");
    REQUIRE("OpenSSL Ciphers" == std::string(cipher_info->name));
    REQUIRE(std::string(cipher_info->description).find("Encrypt") != std::string::npos);
    REQUIRE(std::string(cipher_info->args_schema).find("\"aes-256-ctr\"") != std::string::npos);
    REQUIRE(std::string(cipher_info->args_schema).find("\"required\"") != std::string::npos);
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(
                         "{\"action\":\"encrypt\",\"algorithm\":\"aes-256-ctr\","
                         "\"keyHex\":\"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f\","
                         "\"ivHex\":\"000102030405060708090a0b0c0d0e0f\"}",
                         cipher_info->args_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(
                         "{\"action\":\"decrypt\",\"algorithm\":\"aes-128-cbc\","
                         "\"keyHex\":\"2b7e151628aed2a6abf7158809cf4f3c\","
                         "\"ivHex\":\"000102030405060708090a0b0c0d0e0f\",\"padding\":false}",
                         cipher_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(
                          "{\"algorithm\":\"aes-256-ctr\","
                          "\"keyHex\":\"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f\","
                          "\"ivHex\":\"000102030405060708090a0b0c0d0e0f\"}",
                          cipher_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(
                          "{\"action\":\"encrypt\",\"algorithm\":\"aes-512-ctr\","
                          "\"keyHex\":\"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f\","
                          "\"ivHex\":\"000102030405060708090a0b0c0d0e0f\"}",
                          cipher_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(
                          "{\"action\":\"encrypt\",\"algorithm\":\"aes-256-ctr\","
                          "\"keyHex\":\"not-hex\",\"ivHex\":\"000102030405060708090a0b0c0d0e0f\"}",
                          cipher_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(
                          "{\"action\":\"encrypt\",\"algorithm\":\"aes-256-ctr\","
                          "\"keyHex\":\"0\",\"ivHex\":\"000102030405060708090a0b0c0d0e0f\"}",
                          cipher_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(
                          "{\"action\":\"encrypt\",\"algorithm\":\"aes-128-ctr\","
                          "\"keyHex\":\"00\",\"ivHex\":\"000102030405060708090a0b0c0d0e0f\"}",
                          cipher_info->args_schema));
    REQUIRE(-1 ==
            omega_transform_plugin_options_match_args_schema("{\"action\":\"encrypt\",\"algorithm\":\"aes-256-ctr\","
                                                             "\"keyHex\":\"000102030405060708090a0b0c0d0e0f\","
                                                             "\"ivHex\":\"000102030405060708090a0b0c0d0e0f\"}",
                                                             cipher_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(
                          "{\"action\":\"encrypt\",\"algorithm\":\"aes-256-ctr\","
                          "\"keyHex\":\"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f\","
                          "\"ivHex\":\"0\"}",
                          cipher_info->args_schema));
    const auto digest_info = omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.openssl_digests");
    REQUIRE("OpenSSL Digests" == std::string(digest_info->name));
    REQUIRE(std::string(digest_info->description).find("SHA") != std::string::npos);
    REQUIRE("{\"algorithm\":\"sha256\"}" == std::string(digest_info->default_args));
    REQUIRE(std::string(digest_info->args_schema).find("\"x-omega-enumGroups\"") != std::string::npos);
    REQUIRE(0 ==
            omega_transform_plugin_options_match_args_schema("{\"algorithm\":\"sha256\"}", digest_info->args_schema));
    REQUIRE(-1 ==
            omega_transform_plugin_options_match_args_schema("{\"algorithm\":\"sha0\"}", digest_info->args_schema));
    const auto repeat_info = omega_transform_plugin_registry_find_info(registry_ptr, "omega.example.repeat");
    REQUIRE("Repeat Range" == std::string(repeat_info->name));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(nullptr, repeat_info->args_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("", repeat_info->args_schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema("{}", repeat_info->args_schema));
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema("{\"times\":2}", repeat_info->args_schema));

    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "ABCD"));

    omega_transform_plugin_response_t response{};
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.repeat", session_ptr, 1,
                                                                  2, nullptr, &response));
    REQUIRE("ABCBCD" ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.common_checksums",
                                                                  session_ptr, 0, 0, "{\"algorithm\":\"sum8\"}",
                                                                  &response));
    REQUIRE(4 == response.result_length);
    REQUIRE("0x8F" == std::string(reinterpret_cast<const char *>(response.result_bytes),
                                  static_cast<size_t>(response.result_length)));
    REQUIRE("sum8" == std::string(response.result_label));
    REQUIRE("ABCBCD" ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    const auto identity_bitwise_change_count = omega_session_get_num_changes(session_ptr);
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.bitwise", session_ptr, 0,
                                                                  6, "{\"operator\":\"xor\",\"byte\":\"0x00\"}",
                                                                  &response));
    REQUIRE(0 == response.replacement_length);
    REQUIRE((response.flags & OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE) != 0U);
    REQUIRE("ABCBCD" ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    REQUIRE(identity_bitwise_change_count == omega_session_get_num_changes(session_ptr));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.bitwise", session_ptr, 0,
                                                                  6, "{\"operator\":\"and\",\"byte\":\"0xFF\"}",
                                                                  &response));
    REQUIRE(0 == response.replacement_length);
    REQUIRE((response.flags & OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE) != 0U);
    REQUIRE("ABCBCD" ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    REQUIRE(identity_bitwise_change_count == omega_session_get_num_changes(session_ptr));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.bitwise", session_ptr, 0, 6,
                         "{\"operator\":\"or\",\"mask\":[\"0x00\",\"0x00\"]}", &response));
    REQUIRE(0 == response.replacement_length);
    REQUIRE((response.flags & OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE) != 0U);
    REQUIRE("ABCBCD" ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    REQUIRE(identity_bitwise_change_count == omega_session_get_num_changes(session_ptr));
    omega_transform_plugin_response_clear(&response);

    const auto case_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(case_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(case_session_ptr, 0, "abC!09z"));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.case_change",
                                                                  case_session_ptr, 0, 7, "{\"case\":\"upper\"}",
                                                                  &response));
    REQUIRE(7 == response.replacement_length);
    REQUIRE("ABC!09Z" == omega_session_get_segment_string(case_session_ptr, 0,
                                                          omega_session_get_computed_file_size(case_session_ptr)));
    const auto *case_transform_change = omega_session_get_last_change(case_session_ptr);
    REQUIRE(case_transform_change);
    REQUIRE('T' == omega_change_get_kind_as_char(case_transform_change));
    REQUIRE("omega.example.case_change" == std::string(omega_change_get_transform_id(case_transform_change)));
    REQUIRE("{\"case\":\"upper\"}" == std::string(omega_change_get_transform_options_json(case_transform_change)));
    REQUIRE(7 == omega_change_get_transform_replacement_length(case_transform_change));
    REQUIRE(7 == omega_change_get_transform_computed_file_size_before(case_transform_change));
    REQUIRE(7 == omega_change_get_transform_computed_file_size_after(case_transform_change));
    omega_transform_plugin_response_clear(&response);

    const auto uppercase_change_count = omega_session_get_num_changes(case_session_ptr);
    int64_t no_change_serial = -1;
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session_with_progress_and_serial(
                         registry_ptr, "omega.example.case_change", case_session_ptr, 0, 7, "{\"case\":\"upper\"}",
                         nullptr, nullptr, &response, &no_change_serial));
    REQUIRE(0 == no_change_serial);
    REQUIRE(0 == response.replacement_length);
    REQUIRE((response.flags & OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE) != 0U);
    REQUIRE(uppercase_change_count == omega_session_get_num_changes(case_session_ptr));
    omega_transform_plugin_response_clear(&response);

    const auto cancel_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(cancel_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(cancel_session_ptr, 0, "abcdef"));
    const auto cancel_change_count = omega_session_get_num_changes(cancel_session_ptr);
    omega_transform_plugin_request_t sdk_cancel_request{};
    cancellation_state_t sdk_cancel_state{0, 0};
    sdk_cancel_request.is_cancelled = cancel_after_callback;
    sdk_cancel_request.cancel_user_data_ptr = &sdk_cancel_state;
    REQUIRE(1 == omega_transform_plugin_sdk_is_cancelled(&sdk_cancel_request));
    cancellation_state_t cancel_state{0, 5};
    int64_t cancelled_serial = -1;
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session_with_progress_cancel_and_serial(
                          registry_ptr, "omega.example.case_change", cancel_session_ptr, 0, 6, "{\"case\":\"upper\"}",
                          nullptr, nullptr, cancel_after_callback, &cancel_state, &response, &cancelled_serial));
    REQUIRE(cancel_state.calls > cancel_state.cancel_after);
    REQUIRE(0 == cancelled_serial);
    REQUIRE(cancel_change_count == omega_session_get_num_changes(cancel_session_ptr));
    REQUIRE("abcdef" == omega_session_get_segment_string(cancel_session_ptr, 0,
                                                         omega_session_get_computed_file_size(cancel_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(cancel_session_ptr);

    int64_t lower_serial = 0;
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session_with_progress_and_serial(
                         registry_ptr, "omega.example.case_change", case_session_ptr, 0, 7, "{\"case\":\"lower\"}",
                         nullptr, nullptr, &response, &lower_serial));
    REQUIRE(0 < lower_serial);
    REQUIRE(7 == response.replacement_length);
    REQUIRE("abc!09z" == omega_session_get_segment_string(case_session_ptr, 0,
                                                          omega_session_get_computed_file_size(case_session_ptr)));
    REQUIRE(lower_serial == omega_change_get_serial(omega_session_get_last_change(case_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(case_session_ptr);

    const auto empty_transform_change_count = omega_session_get_num_changes(session_ptr);
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.repeat", session_ptr,
                                                                  omega_session_get_computed_file_size(session_ptr), 0,
                                                                  nullptr, &response));
    REQUIRE(0 == response.replacement_length);
    REQUIRE((response.flags & OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE) != 0U);
    REQUIRE(empty_transform_change_count == omega_session_get_num_changes(session_ptr));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.base64", session_ptr,
                                                                  omega_session_get_computed_file_size(session_ptr), 0,
                                                                  "{\"direction\":\"encode\"}", &response));
    REQUIRE(0 == response.replacement_length);
    REQUIRE((response.flags & OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE) != 0U);
    REQUIRE(empty_transform_change_count == omega_session_get_num_changes(session_ptr));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.bitwise", session_ptr,
                                                                  omega_session_get_computed_file_size(session_ptr), 0,
                                                                  "{\"operator\":\"xor\",\"byte\":\"0xFF\"}",
                                                                  &response));
    REQUIRE(0 == response.replacement_length);
    REQUIRE((response.flags & OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE) != 0U);
    REQUIRE(empty_transform_change_count == omega_session_get_num_changes(session_ptr));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.bitwise", session_ptr, 0,
                                                                  1, nullptr, &response));
    REQUIRE(std::string({static_cast<char>(0xBE), 'B', 'C', 'B', 'C', 'D'}) ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.bitwise", session_ptr, 1,
                                                                  1, "{\"operator\":\"xor\",\"byte\":\"0x42\"}",
                                                                  &response));
    REQUIRE(std::string({static_cast<char>(0xBE), static_cast<char>('B' ^ 0x42), 'C', 'B', 'C', 'D'}) ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.bitwise", session_ptr,
                                                                   1, 1, "{\"operator\":\"xor\",\"byte\":256}",
                                                                   &response));

    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(
                          registry_ptr, "omega.example.bitwise", session_ptr, 2, 2,
                          "{\"operator\":\"xor\",\"bytes\":[\"0x01\",\"0x02\"]}", &response));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.bitwise", session_ptr, 2, 2,
                         "{\"operator\":\"xor\",\"mask\":[\"0x01\",\"0x02\"]}", &response));
    REQUIRE(std::string({static_cast<char>(0xBE), static_cast<char>('B' ^ 0x42), static_cast<char>('C' ^ 0x01),
                         static_cast<char>('B' ^ 0x02), 'C', 'D'}) ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.bitwise", session_ptr, 2, 2,
                         "{\"operator\":\"and\",\"mask\":[\"0x0F\",\"0xF0\"]}", &response));
    REQUIRE(std::string({static_cast<char>(0xBE), static_cast<char>('B' ^ 0x42), static_cast<char>(('C' ^ 0x01) & 0x0F),
                         static_cast<char>(('B' ^ 0x02) & 0xF0), 'C', 'D'}) ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.bitwise", session_ptr, 4, 2,
                         "{\"operator\":\"or\",\"mask\":[\"0x01\",\"0x02\"]}", &response));
    REQUIRE(std::string({static_cast<char>(0xBE), static_cast<char>('B' ^ 0x42), static_cast<char>(('C' ^ 0x01) & 0x0F),
                         static_cast<char>(('B' ^ 0x02) & 0xF0), static_cast<char>('C' | 0x01),
                         static_cast<char>('D' | 0x02)}) ==
            omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)));
    omega_transform_plugin_response_clear(&response);

    const auto codec_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(codec_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(codec_session_ptr, 0, "hello"));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.base64",
                                                                  codec_session_ptr, 0, 5, nullptr, &response));
    REQUIRE("aGVsbG8=" == omega_session_get_segment_string(codec_session_ptr, 0,
                                                           omega_session_get_computed_file_size(codec_session_ptr)));
    REQUIRE(8 == response.replacement_length);
    omega_transform_plugin_response_clear(&response);

    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(
                          registry_ptr, "omega.example.base64", codec_session_ptr, 0, 5, "{\"level\":9}", &response));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.base64",
                                                                  codec_session_ptr, 0, 0, "{\"direction\":\"decode\"}",
                                                                  &response));
    REQUIRE("hello" == omega_session_get_segment_string(codec_session_ptr, 0,
                                                        omega_session_get_computed_file_size(codec_session_ptr)));
    REQUIRE(5 == response.replacement_length);
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.common_checksums",
                                                                  codec_session_ptr, 0, 5,
                                                                  "{\"algorithm\":\"fnv1a64\"}", &response));
    REQUIRE(18 == response.result_length);
    REQUIRE("0xA430D84680AABD0B" == std::string(reinterpret_cast<const char *>(response.result_bytes),
                                                static_cast<size_t>(response.result_length)));
    REQUIRE("fnv1a64" == std::string(response.result_label));
    omega_transform_plugin_response_clear(&response);

    const auto require_digest_result = [&](const char *algorithm, const char *label, const char *expected) {
        const std::string options = std::string("{\"algorithm\":\"") + algorithm + "\"}";
        REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.openssl_digests",
                                                                      codec_session_ptr, 0, 5, options.c_str(),
                                                                      &response));
        REQUIRE(static_cast<int64_t>(std::string(expected).size()) == response.result_length);
        REQUIRE(expected == std::string(reinterpret_cast<const char *>(response.result_bytes),
                                        static_cast<size_t>(response.result_length)));
        REQUIRE(label == std::string(response.result_label));
        omega_transform_plugin_response_clear(&response);
    };

    require_digest_result("md5", "md5", "5d41402abc4b2a76b9719d911017c592");
    require_digest_result("sha1", "sha1", "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
    require_digest_result("sha224", "sha224", "ea09ae9cc6768c50fcee903ed054556e5bfc8347907f12598aa24193");
    require_digest_result("sha256", "sha256", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    require_digest_result("sha384", "sha384",
                          "59e1748777448c69de6b800d7a33bbfb9ff1b463e44354c3553bcdb9c666fa90125a3c79f"
                          "90397bdf5f6a13de828684f");
    require_digest_result("sha512", "sha512",
                          "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c"
                          "3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043");
    require_digest_result("sha3-256", "sha3-256", "3338be694f50c5f338814986cdf0686453a888b84f424d792af4b9202398f392");
    require_digest_result("sha3-512", "sha3-512",
                          "75d527c368f2efe848ecf6b073a36767800805e9eef2b1857d5f984f036eb6df891d75f72d9b"
                          "154518c1cd58835286d1da9a38deba3de98b5a53e5ed78a84976");
    require_digest_result("blake2b-512", "blake2b-512",
                          "e4cfa39a3d37be31c59609e807970799caa68a19bfaa15135f165085e01d41a65ba1e1b146ae"
                          "b6bd0092b49eac214c103ccfa3a365954bbbe52f74a2b3620c94");
    require_digest_result("blake2s-256", "blake2s-256",
                          "19213bacc58dee6dbde3ceb9a47cbb330b3d86f8cca8997eb00be456f140ca25");

    const omega_byte_t digest_stream_bytes[] = {'a', 'b', 'c'};
    byte_reader_state_t digest_reader{digest_stream_bytes, static_cast<int64_t>(sizeof(digest_stream_bytes)), 0};
    REQUIRE(0 == omega_transform_plugin_registry_inspect_reader_with_cancel(
                         registry_ptr, "omega.example.openssl_digests", 0,
                         static_cast<int64_t>(sizeof(digest_stream_bytes)), "{\"algorithm\":\"sha256\"}", nullptr,
                         byte_reader_callback, &digest_reader, 2, nullptr, nullptr, nullptr, nullptr, &response));
    REQUIRE(2 <= digest_reader.calls);
    REQUIRE("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" ==
            std::string(reinterpret_cast<const char *>(response.result_bytes),
                        static_cast<size_t>(response.result_length)));
    REQUIRE("sha256" == std::string(response.result_label));
    omega_transform_plugin_response_clear(&response);

    byte_reader_state_t cancelled_digest_reader{digest_stream_bytes, static_cast<int64_t>(sizeof(digest_stream_bytes)),
                                                0};
    cancellation_state_t inspect_cancel_state{0, 0};
    REQUIRE(-1 == omega_transform_plugin_registry_inspect_reader_with_cancel(
                          registry_ptr, "omega.example.openssl_digests", 0,
                          static_cast<int64_t>(sizeof(digest_stream_bytes)), "{\"algorithm\":\"sha256\"}", nullptr,
                          byte_reader_callback, &cancelled_digest_reader, 2, nullptr, nullptr, cancel_after_callback,
                          &inspect_cancel_state, &response));
    REQUIRE(0 == cancelled_digest_reader.calls);
    REQUIRE(inspect_cancel_state.calls > inspect_cancel_state.cancel_after);

    const char *aes256_ctr_key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const char *aes_iv = "000102030405060708090a0b0c0d0e0f";
    const std::string aes256_ctr_encrypt_options =
            std::string("{\"action\":\"encrypt\",\"algorithm\":\"aes-256-ctr\",\"keyHex\":\"") + aes256_ctr_key +
            "\",\"ivHex\":\"" + aes_iv + "\"}";
    const std::string aes256_ctr_decrypt_options =
            std::string("{\"action\":\"decrypt\",\"algorithm\":\"aes-256-ctr\",\"keyHex\":\"") + aes256_ctr_key +
            "\",\"ivHex\":\"" + aes_iv + "\"}";
    const std::string short_aes128_key_options =
            std::string("{\"action\":\"encrypt\",\"algorithm\":\"aes-128-ctr\",\"keyHex\":\"00\",\"ivHex\":\"") +
            aes_iv + "\"}";
    const std::string aes128_cbc_no_padding_options =
            std::string("{\"action\":\"encrypt\",\"algorithm\":\"aes-128-cbc\","
                        "\"keyHex\":\"2b7e151628aed2a6abf7158809cf4f3c\",\"ivHex\":\"") +
            aes_iv + "\",\"padding\":false}";
    const std::string aes128_cbc_padded_encrypt_options =
            std::string("{\"action\":\"encrypt\",\"algorithm\":\"aes-128-cbc\","
                        "\"keyHex\":\"2b7e151628aed2a6abf7158809cf4f3c\",\"ivHex\":\"") +
            aes_iv + "\"}";
    const std::string aes128_cbc_padded_decrypt_options =
            std::string("{\"action\":\"decrypt\",\"algorithm\":\"aes-128-cbc\","
                        "\"keyHex\":\"2b7e151628aed2a6abf7158809cf4f3c\",\"ivHex\":\"") +
            aes_iv + "\"}";

    const auto cipher_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(cipher_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(cipher_session_ptr, 0, "hello"));
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.openssl_ciphers",
                                                                   cipher_session_ptr, 0, 5,
                                                                   short_aes128_key_options.c_str(), &response));
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.openssl_ciphers",
                                                                   cipher_session_ptr, 0, 5,
                                                                   aes128_cbc_no_padding_options.c_str(), &response));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.openssl_ciphers",
                                                                  cipher_session_ptr, 0, 5,
                                                                  aes256_ctr_encrypt_options.c_str(), &response));
    REQUIRE(5 == response.replacement_length);
    REQUIRE("320b683b67" == bytes_to_hex(response.replacement_bytes, response.replacement_length));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.openssl_ciphers",
                                                                  cipher_session_ptr, 0, 5,
                                                                  aes256_ctr_decrypt_options.c_str(), &response));
    REQUIRE(5 == response.replacement_length);
    REQUIRE("hello" == omega_session_get_segment_string(cipher_session_ptr, 0,
                                                        omega_session_get_computed_file_size(cipher_session_ptr)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.openssl_ciphers", cipher_session_ptr, 0, 5,
                         aes128_cbc_padded_encrypt_options.c_str(), &response));
    REQUIRE(16 == response.replacement_length);
    REQUIRE("d8666ea8aad65cc08354b4bc43d4ff56" ==
            bytes_to_hex(response.replacement_bytes, response.replacement_length));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.openssl_ciphers", cipher_session_ptr, 0, 16,
                         aes128_cbc_padded_decrypt_options.c_str(), &response));
    REQUIRE(5 == response.replacement_length);
    REQUIRE("hello" == omega_session_get_segment_string(cipher_session_ptr, 0,
                                                        omega_session_get_computed_file_size(cipher_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(cipher_session_ptr);

    const omega_byte_t cbc_plaintext[] = {0x6b, 0xc1, 0xbe, 0xe2, 0x2e, 0x40, 0x9f, 0x96,
                                          0xe9, 0x3d, 0x7e, 0x11, 0x73, 0x93, 0x17, 0x2a};
    const auto cbc_vector_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(cbc_vector_session_ptr);
    REQUIRE(0 < omega_edit_insert_bytes(cbc_vector_session_ptr, 0, cbc_plaintext,
                                        static_cast<int64_t>(sizeof(cbc_plaintext))));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.openssl_ciphers",
                                                                  cbc_vector_session_ptr, 0, 16,
                                                                  aes128_cbc_no_padding_options.c_str(), &response));
    REQUIRE(16 == response.replacement_length);
    REQUIRE("7649abac8119b246cee98e9b12e9197d" ==
            bytes_to_hex(response.replacement_bytes, response.replacement_length));
    omega_transform_plugin_response_clear(&response);

    const std::string aes128_cbc_no_padding_decrypt_options =
            std::string("{\"action\":\"decrypt\",\"algorithm\":\"aes-128-cbc\","
                        "\"keyHex\":\"2b7e151628aed2a6abf7158809cf4f3c\",\"ivHex\":\"") +
            aes_iv + "\",\"padding\":false}";
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.openssl_ciphers", cbc_vector_session_ptr, 0, 16,
                         aes128_cbc_no_padding_decrypt_options.c_str(), &response));
    REQUIRE(16 == response.replacement_length);
    REQUIRE("6bc1bee22e409f96e93d7e117393172a" ==
            bytes_to_hex(response.replacement_bytes, response.replacement_length));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(cbc_vector_session_ptr);

    const auto large_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(large_session_ptr);
    const std::vector<omega_byte_t> large_bytes(5 * 1024 * 1024, static_cast<omega_byte_t>(1));
    REQUIRE(0 < omega_edit_insert_bytes(large_session_ptr, 0, large_bytes.data(),
                                        static_cast<int64_t>(large_bytes.size())));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.common_checksums",
                                                                  large_session_ptr, 0, 0, "{\"algorithm\":\"sum8\"}",
                                                                  &response));
    REQUIRE(4 == response.result_length);
    REQUIRE("0x00" == std::string(reinterpret_cast<const char *>(response.result_bytes),
                                  static_cast<size_t>(response.result_length)));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.common_checksums",
                                                                  large_session_ptr, 0, 0,
                                                                  "{\"algorithm\":\"fnv1a64\"}", &response));
    REQUIRE(18 == response.result_length);
    REQUIRE("fnv1a64" == std::string(response.result_label));
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.openssl_digests",
                                                                  large_session_ptr, 0, 0, "{\"algorithm\":\"sha256\"}",
                                                                  &response));
    REQUIRE(64 == response.result_length);
    REQUIRE("c283e17a1b90a352c91de2c445b711c5c4126279eff884b8ffc44893576b19ef" ==
            std::string(reinterpret_cast<const char *>(response.result_bytes),
                        static_cast<size_t>(response.result_length)));
    REQUIRE("sha256" == std::string(response.result_label));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(large_session_ptr);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.common_checksums",
                                                                  codec_session_ptr, 0, 5, "{\"algorithm\":\"crc32\"}",
                                                                  &response));
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
    REQUIRE("68656c6c6f" ==
            omega_session_get_segment_string(text_codec_session_ptr, 0,
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
    REQUIRE("aGVsbG8" ==
            omega_session_get_segment_string(text_codec_session_ptr, 0,
                                             omega_session_get_computed_file_size(text_codec_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.text_codecs", text_codec_session_ptr, 0, 0,
                         "{\"codec\":\"base64url\",\"direction\":\"decode\"}", &response));
    REQUIRE("hello" == omega_session_get_segment_string(text_codec_session_ptr, 0,
                                                        omega_session_get_computed_file_size(text_codec_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(text_codec_session_ptr);

    const auto oversized_base58_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(oversized_base58_session_ptr);
    std::vector<omega_byte_t> oversized_base58_input((64 * 1024) + 1, 'x');
    REQUIRE(0 < omega_edit_insert_bytes(oversized_base58_session_ptr, 0, oversized_base58_input.data(),
                                        static_cast<int64_t>(oversized_base58_input.size())));
    const auto oversized_base58_change_count = omega_session_get_num_changes(oversized_base58_session_ptr);
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(
                          registry_ptr, "omega.example.text_codecs", oversized_base58_session_ptr, 0, 0,
                          "{\"codec\":\"base58\",\"direction\":\"encode\"}", &response));
    REQUIRE(oversized_base58_change_count == omega_session_get_num_changes(oversized_base58_session_ptr));
    REQUIRE(static_cast<int64_t>(oversized_base58_input.size()) ==
            omega_session_get_computed_file_size(oversized_base58_session_ptr));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(oversized_base58_session_ptr);

    const auto cancellable_text_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(cancellable_text_session_ptr);
    std::vector<omega_byte_t> cancellable_text_input(8192, 0xFF);
    REQUIRE(0 < omega_edit_insert_bytes(cancellable_text_session_ptr, 0, cancellable_text_input.data(),
                                        static_cast<int64_t>(cancellable_text_input.size())));
    const auto cancellable_text_change_count = omega_session_get_num_changes(cancellable_text_session_ptr);
    cancellation_state_t base58_cancel_state{0, 1};
    int64_t base58_cancelled_serial = -1;
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session_with_progress_cancel_and_serial(
                          registry_ptr, "omega.example.text_codecs", cancellable_text_session_ptr, 0, 0,
                          "{\"codec\":\"base58\",\"direction\":\"encode\"}", nullptr, nullptr, cancel_after_callback,
                          &base58_cancel_state, &response, &base58_cancelled_serial));
    REQUIRE(base58_cancel_state.calls > base58_cancel_state.cancel_after);
    REQUIRE(0 == base58_cancelled_serial);
    REQUIRE(cancellable_text_change_count == omega_session_get_num_changes(cancellable_text_session_ptr));
    REQUIRE(static_cast<int64_t>(cancellable_text_input.size()) ==
            omega_session_get_computed_file_size(cancellable_text_session_ptr));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(cancellable_text_session_ptr);

    const auto charset_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(charset_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(charset_session_ptr, 0, "ABC"));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.character_transcode", charset_session_ptr, 0, 3,
                         "{\"from\":\"utf-8\",\"to\":\"ebcdic-037\"}", &response));
    REQUIRE(std::string({static_cast<char>(0xC1), static_cast<char>(0xC2), static_cast<char>(0xC3)}) ==
            omega_session_get_segment_string(charset_session_ptr, 0,
                                             omega_session_get_computed_file_size(charset_session_ptr)));
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
            omega_session_get_segment_string(helper_session_ptr, 0,
                                             omega_session_get_computed_file_size(helper_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(helper_session_ptr);

    const auto odd_helper_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(odd_helper_session_ptr);
    const omega_byte_t odd_endian_bytes[] = {1, 2, 3, 4, 5};
    REQUIRE(0 < omega_edit_insert_bytes(odd_helper_session_ptr, 0, odd_endian_bytes, 5));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.endian_swap",
                                                                  odd_helper_session_ptr, 0, 5, "{\"width\":2}",
                                                                  &response));
    REQUIRE(std::string({2, 1, 4, 3, 5}) ==
            omega_session_get_segment_string(odd_helper_session_ptr, 0,
                                             omega_session_get_computed_file_size(odd_helper_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(odd_helper_session_ptr);

    const auto decimal_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(decimal_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(decimal_session_ptr, 0, "123"));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(
                         registry_ptr, "omega.example.decimal_codecs", decimal_session_ptr, 0, 3,
                         "{\"codec\":\"packed-decimal\",\"direction\":\"encode\"}", &response));
    REQUIRE(std::string({static_cast<char>(0x12), static_cast<char>(0x3C)}) ==
            omega_session_get_segment_string(decimal_session_ptr, 0,
                                             omega_session_get_computed_file_size(decimal_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(decimal_session_ptr);

    const auto cancellable_decimal_session_ptr =
            omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(cancellable_decimal_session_ptr);
    const std::string cancellable_decimal_input(8192, '7');
    REQUIRE(0 < omega_edit_insert_string(cancellable_decimal_session_ptr, 0, cancellable_decimal_input.c_str()));
    const auto cancellable_decimal_change_count = omega_session_get_num_changes(cancellable_decimal_session_ptr);
    cancellation_state_t decimal_cancel_state{0, 1};
    int64_t decimal_cancelled_serial = -1;
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session_with_progress_cancel_and_serial(
                          registry_ptr, "omega.example.decimal_codecs", cancellable_decimal_session_ptr, 0, 0,
                          "{\"codec\":\"packed-decimal\",\"direction\":\"encode\"}", nullptr, nullptr,
                          cancel_after_callback, &decimal_cancel_state, &response, &decimal_cancelled_serial));
    REQUIRE(decimal_cancel_state.calls > decimal_cancel_state.cancel_after);
    REQUIRE(0 == decimal_cancelled_serial);
    REQUIRE(cancellable_decimal_change_count == omega_session_get_num_changes(cancellable_decimal_session_ptr));
    REQUIRE(cancellable_decimal_input ==
            omega_session_get_segment_string(cancellable_decimal_session_ptr, 0,
                                             omega_session_get_computed_file_size(cancellable_decimal_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(cancellable_decimal_session_ptr);

    const auto format_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(format_session_ptr);
    const omega_byte_t varint_bytes[] = {0x96, 0x01};
    REQUIRE(0 < omega_edit_insert_bytes(format_session_ptr, 0, varint_bytes, 2));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.format_inspectors",
                                                                  format_session_ptr, 0, 2,
                                                                  "{\"format\":\"protobuf-varint\"}", &response));
    REQUIRE(std::string(reinterpret_cast<const char *>(response.result_bytes),
                        static_cast<size_t>(response.result_length))
                    .find("value=150") != std::string::npos);
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(format_session_ptr);

    const auto asn1_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(asn1_session_ptr);
    const omega_byte_t asn1_overflow_length[] = {0x04, 0x88, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff};
    REQUIRE(0 < omega_edit_insert_bytes(asn1_session_ptr, 0, asn1_overflow_length,
                                        static_cast<int64_t>(sizeof(asn1_overflow_length))));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.format_inspectors",
                                                                  asn1_session_ptr, 0, 0, "{\"format\":\"asn1-ber\"}",
                                                                  &response));
    REQUIRE(std::string(reinterpret_cast<const char *>(response.result_bytes),
                        static_cast<size_t>(response.result_length))
                    .find("error=value-truncated") != std::string::npos);
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(asn1_session_ptr);

    const auto record_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(record_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(record_session_ptr, 0, "<&"));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.record_text_helpers",
                                                                  record_session_ptr, 0, 2,
                                                                  "{\"action\":\"xml-escape\"}", &response));
    REQUIRE("&lt;&amp;" == omega_session_get_segment_string(record_session_ptr, 0,
                                                            omega_session_get_computed_file_size(record_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(record_session_ptr);

    const auto invalid_csv_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(invalid_csv_session_ptr);
    REQUIRE(0 < omega_edit_insert_string(invalid_csv_session_ptr, 0, "\"abc\"\""));
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.record_text_helpers",
                                                                   invalid_csv_session_ptr, 0, 6,
                                                                   "{\"action\":\"csv-unquote\"}", &response));
    omega_edit_destroy_session(invalid_csv_session_ptr);

    REQUIRE(-1 ==
            omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.zlib", codec_session_ptr, 0,
                                                             5, "{\"action\":\"compress\",\"level\":10}", &response));

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.zlib", codec_session_ptr,
                                                                  0, 5, "{\"action\":\"compress\",\"level\":9}",
                                                                  &response));
    REQUIRE(0 < response.replacement_length);
    {
        const auto compressed = omega_session_get_segment_string(
                codec_session_ptr, 0, omega_session_get_computed_file_size(codec_session_ptr));
        REQUIRE(response.replacement_length == static_cast<int64_t>(compressed.size()));
        REQUIRE(8 == (static_cast<unsigned char>(compressed[0]) & 0x0F));
    }
    omega_transform_plugin_response_clear(&response);

    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.zlib", codec_session_ptr,
                                                                  0, 0, "{\"action\":\"decompress\"}", &response));
    REQUIRE("hello" == omega_session_get_segment_string(codec_session_ptr, 0,
                                                        omega_session_get_computed_file_size(codec_session_ptr)));
    REQUIRE(5 == response.replacement_length);
    omega_transform_plugin_response_clear(&response);

    const auto zlib_bomb_session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(zlib_bomb_session_ptr);
    const std::string repeated_zlib_input(4096, 'A');
    REQUIRE(0 < omega_edit_insert_bytes(zlib_bomb_session_ptr, 0,
                                        reinterpret_cast<const omega_byte_t *>(repeated_zlib_input.data()),
                                        static_cast<int64_t>(repeated_zlib_input.size())));
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.zlib",
                                                                  zlib_bomb_session_ptr, 0, 0,
                                                                  "{\"action\":\"compress\",\"level\":9}", &response));
    const auto compressed_zlib_bomb = omega_session_get_segment_string(
            zlib_bomb_session_ptr, 0, omega_session_get_computed_file_size(zlib_bomb_session_ptr));
    REQUIRE(compressed_zlib_bomb.size() < repeated_zlib_input.size());
    omega_transform_plugin_response_clear(&response);

    const auto zlib_cap_change_count = omega_session_get_num_changes(zlib_bomb_session_ptr);
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(
                          registry_ptr, "omega.example.zlib", zlib_bomb_session_ptr, 0, 0,
                          "{\"action\":\"decompress\",\"maxOutputBytes\":1024}", &response));
    REQUIRE(zlib_cap_change_count == omega_session_get_num_changes(zlib_bomb_session_ptr));
    REQUIRE(compressed_zlib_bomb ==
            omega_session_get_segment_string(zlib_bomb_session_ptr, 0,
                                             omega_session_get_computed_file_size(zlib_bomb_session_ptr)));
    omega_transform_plugin_response_clear(&response);

    const std::string zlib_cap_options =
            "{\"action\":\"decompress\",\"maxOutputBytes\":" + std::to_string(repeated_zlib_input.size()) + "}";
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.zlib",
                                                                  zlib_bomb_session_ptr, 0, 0, zlib_cap_options.c_str(),
                                                                  &response));
    REQUIRE(repeated_zlib_input ==
            omega_session_get_segment_string(zlib_bomb_session_ptr, 0,
                                             omega_session_get_computed_file_size(zlib_bomb_session_ptr)));
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(zlib_bomb_session_ptr);

    REQUIRE(0 <
            omega_edit_insert_string(codec_session_ptr, omega_session_get_computed_file_size(codec_session_ptr), "!"));
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.base64",
                                                                   codec_session_ptr, 0, 0,
                                                                   "{\"direction\":\"decode\"}", &response));
    omega_edit_destroy_session(codec_session_ptr);

    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.missing", session_ptr,
                                                                   0, 0, nullptr, nullptr));

    omega_edit_destroy_session(session_ptr);
    omega_transform_plugin_registry_destroy(registry_ptr);
}

TEST_CASE("Large Transform Replacement Uses File-Backed Checkpoint", "[TransformPlugin][LargeFile]") {
    REQUIRE(std::filesystem::is_directory(PLUGIN_DIR));

    const auto registry_ptr = omega_transform_plugin_registry_create();
    REQUIRE(registry_ptr);
    REQUIRE(0 == omega_transform_plugin_registry_set_allow_experimental(registry_ptr, 1));
    REQUIRE(0 < omega_transform_plugin_registry_register_directory(registry_ptr, PLUGIN_DIR.string().c_str()));

    const auto input_length = static_cast<int64_t>((OMEGA_MEMORY_BUFFER_LIMIT / 2) + 1);
    std::vector<omega_byte_t> input(static_cast<size_t>(input_length));
    for (int64_t i = 0; i < input_length; ++i) { input[static_cast<size_t>(i)] = static_cast<omega_byte_t>(i % 251); }

    const auto session_ptr =
            omega_edit_create_session_from_bytes(input.data(), input_length, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);

    omega_transform_plugin_response_t response{};
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry_ptr, "omega.example.repeat", session_ptr, 0,
                                                                  input_length, nullptr, &response));
    REQUIRE(input_length * 2 == response.replacement_length);
    REQUIRE(input_length * 2 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(1 == omega_session_get_num_checkpoints(session_ptr));

    auto *segment = omega_segment_create(16);
    REQUIRE(segment);

    REQUIRE(0 == omega_session_get_segment(session_ptr, segment, 0));
    REQUIRE(16 == omega_segment_get_length(segment));
    REQUIRE(0 == std::memcmp(omega_segment_get_data(segment), input.data(), 16));

    REQUIRE(0 == omega_session_get_segment(session_ptr, segment, input_length - 8));
    REQUIRE(16 == omega_segment_get_length(segment));
    REQUIRE(0 == std::memcmp(omega_segment_get_data(segment), input.data() + input.size() - 8, 8));
    REQUIRE(0 == std::memcmp(omega_segment_get_data(segment) + 8, input.data(), 8));

    REQUIRE(0 == omega_session_get_segment(session_ptr, segment, input_length));
    REQUIRE(16 == omega_segment_get_length(segment));
    REQUIRE(0 == std::memcmp(omega_segment_get_data(segment), input.data(), 16));

    omega_segment_destroy(segment);
    omega_transform_plugin_response_clear(&response);
    omega_edit_destroy_session(session_ptr);
    omega_transform_plugin_registry_destroy(registry_ptr);
}
