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
#include "omega_edit/stl_string_adaptor.hpp"

#include "test_harness.hpp"

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#ifdef OMEGA_BUILD_WINDOWS
#include <io.h>
#else
#include <unistd.h>
#endif

using Catch::Matchers::Equals;
using omega_test::check_serials_contiguous;
using omega_test::content_string;
using omega_test::model_valid;
using omega_test::ScratchDir;
using omega_test::TestSession;
using omega_test::verify_undo_redo_round_trip;

namespace {
    void viewport_count_cbk(const omega_viewport_t *viewport_ptr, omega_viewport_event_t, const void *) {
        auto *count = static_cast<int *>(omega_viewport_get_user_data_ptr(viewport_ptr));
        if (count) { ++(*count); }
    }

    void require_bom_buffer(omega_bom_t bom, const std::vector<omega_byte_t> &expected) {
        const auto *buffer = omega_util_BOM_to_buffer(bom);
        REQUIRE(buffer);
        REQUIRE(buffer->length == expected.size());
        REQUIRE(0 == std::memcmp(buffer->data, expected.data(), expected.size()));
    }

    int close_fd(int fd) {
#ifdef OMEGA_BUILD_WINDOWS
        return _close(fd);
#else
        return close(fd);
#endif
    }
}// namespace

TEST_CASE("Brutal script edits keep viewports, transactions, save bytes, and history honest",
          "[BrutalCoverage][Harness][EditScript][Viewport]") {
    const ScratchDir scratch;
    static const omega_byte_t seed[] = "0123456789abcdef";
    auto session = TestSession::from_bytes(seed, static_cast<int64_t>(sizeof(seed) - 1), scratch.c_str());
    REQUIRE(session);
    session.make_brutal(4, 1);

    int fixed_events = 0;
    int floating_events = 0;
    auto *fixed =
            omega_edit_create_viewport(session.get(), 4, 6, 0, viewport_count_cbk, &fixed_events, VIEWPORT_EVENTS_ALL);
    auto *floating = omega_edit_create_viewport(session.get(), 4, 6, 1, viewport_count_cbk, &floating_events,
                                                VIEWPORT_EVENTS_ALL);
    REQUIRE(fixed);
    REQUIRE(floating);
    REQUIRE(fixed_events == 1);
    REQUIRE(floating_events == 1);
    REQUIRE_THAT(omega_viewport_get_string(fixed), Equals("456789"));
    REQUIRE_THAT(omega_viewport_get_string(floating), Equals("456789"));
    REQUIRE(0 == omega_viewport_has_changes(fixed));
    REQUIRE(0 == omega_viewport_has_changes(floating));

    static const omega_byte_t insert_bytes[] = "XYZ!";
    static const omega_byte_t overwrite_bytes[] = "mn";
    static const omega_byte_t replace_bytes[] = "QQQQ";
    const omega_edit_script_op_t ops[] = {
            {2, 3, OMEGA_EDIT_SCRIPT_DELETE, nullptr, 0},
            {2, 0, OMEGA_EDIT_SCRIPT_INSERT, insert_bytes, 4},
            {8, 2, OMEGA_EDIT_SCRIPT_OVERWRITE, overwrite_bytes, 2},
            {11, 3, OMEGA_EDIT_SCRIPT_REPLACE, replace_bytes, 4},
    };

    REQUIRE(0 == omega_edit_apply_script(session.get(), ops, sizeof(ops) / sizeof(ops[0])));
    REQUIRE_THAT(content_string(session.get()), Equals("01XYZ!56mn9QQQQdef"));
    REQUIRE(omega_session_get_num_changes(session.get()) == 5);
    REQUIRE(omega_session_get_num_change_transactions(session.get()) == 1);
    REQUIRE(model_valid(session.get()));

    const auto serials = check_serials_contiguous(session.get());
    REQUIRE(serials.contiguous);
    REQUIRE(serials.num_changes == 5);
    REQUIRE(fixed_events >= 2);
    REQUIRE(floating_events >= 2);
    REQUIRE(1 == omega_viewport_has_changes(fixed));
    REQUIRE(1 == omega_viewport_has_changes(floating));
    REQUIRE(omega_viewport_get_offset(fixed) == 4);
    REQUIRE(omega_viewport_get_offset(floating) == 1);
    REQUIRE_THAT(omega_viewport_get_string(fixed), Equals("Z!56mn"));
    REQUIRE_THAT(omega_viewport_get_string(floating), Equals("1XYZ!5"));
    REQUIRE(0 == omega_viewport_has_changes(fixed));
    REQUIRE(0 == omega_viewport_has_changes(floating));

    omega_byte_t *bytes = nullptr;
    int64_t length = -1;
    REQUIRE(0 == omega_edit_save_segment_to_bytes(session.get(), &bytes, &length, 2, 5));
    REQUIRE(length == 5);
    REQUIRE(std::string(reinterpret_cast<const char *>(bytes), static_cast<size_t>(length)) == "XYZ!5");
    free(bytes);

    const auto round_trip = verify_undo_redo_round_trip(session.get());
    REQUIRE(round_trip.ok);
    REQUIRE(round_trip.model_valid_throughout);
    REQUIRE(round_trip.mismatch_step == -1);
    REQUIRE_THAT(content_string(session.get()), Equals("01XYZ!56mn9QQQQdef"));

    REQUIRE(0 == omega_edit_restore_to_change_count(session.get(), 2));
    REQUIRE_THAT(content_string(session.get()), Equals("01XYZ!56789abcdef"));
    REQUIRE(omega_session_get_num_changes(session.get()) == 2);
    REQUIRE(omega_edit_redo_last_undo(session.get()) == 0);
    REQUIRE(model_valid(session.get()));

    omega_edit_destroy_viewport(floating);
    omega_edit_destroy_viewport(fixed);
}

TEST_CASE("Transform schema validator rejects malformed, ambiguous, and constraint-breaking inputs",
          "[BrutalCoverage][TransformSchema]") {
    const char *schema = R"json({
        "type":"object",
        "required":["enabled","level","name","items","choice","literal"],
        "additionalProperties":false,
        "not":{"required":["forbidden"]},
        "properties":{
            "enabled":{"type":"boolean","enum":[true]},
            "level":{"type":"integer","minimum":-2,"maximum":5},
            "name":{"type":"string","pattern":"^[A-Z][A-Za-z0-9_]{2,8}$"},
            "items":{"type":"array","minItems":2,"items":{"type":"string","pattern":"^[a-f0-9]{2}$"}},
            "choice":{"oneOf":[{"type":"integer","enum":[7]},{"type":"string","enum":["seven"]}]},
            "literal":{"enum":[{"k":["v",null,false,"snowman \u2603"]}]}
        }
    })json";

    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(R"json({
        "enabled":true,
        "level":-1e0,
        "name":"Abc_123",
        "items":["0a","ff"],
        "choice":"seven",
        "literal":{"k":["v",null,false,"snowman \u2603"]}
    })json",
                                                                  schema));
    REQUIRE(0 == omega_transform_plugin_options_match_args_schema(R"json({
        "enabled":true,
        "level":5,
        "name":"Valid99",
        "items":["aa","bb","cc"],
        "choice":7,
        "literal":{"k":["v",null,false,"snowman \u2603"]}
    })json",
                                                                  schema));

    const char *bad_options[] = {
            R"json({"enabled":true,"level":0,"name":"Abc_123","items":["0a"],"choice":7,"literal":{"k":["v",null,false,"snowman \u2603"]}})json",
            R"json({"enabled":false,"level":0,"name":"Abc_123","items":["0a","ff"],"choice":7,"literal":{"k":["v",null,false,"snowman \u2603"]}})json",
            R"json({"enabled":true,"level":6,"name":"Abc_123","items":["0a","ff"],"choice":7,"literal":{"k":["v",null,false,"snowman \u2603"]}})json",
            R"json({"enabled":true,"level":1.5,"name":"Abc_123","items":["0a","ff"],"choice":7,"literal":{"k":["v",null,false,"snowman \u2603"]}})json",
            R"json({"enabled":true,"level":0,"name":"bad space","items":["0a","ff"],"choice":7,"literal":{"k":["v",null,false,"snowman \u2603"]}})json",
            R"json({"enabled":true,"level":0,"name":"Abc_123","items":["0a","GG"],"choice":7,"literal":{"k":["v",null,false,"snowman \u2603"]}})json",
            R"json({"enabled":true,"level":0,"name":"Abc_123","items":["0a","ff"],"choice":"other","literal":{"k":["v",null,false,"snowman \u2603"]}})json",
            R"json({"enabled":true,"level":0,"name":"Abc_123","items":["0a","ff"],"choice":7,"literal":{"k":["v",null,false,"snowman"]}})json",
            R"json({"enabled":true,"level":0,"name":"Abc_123","items":["0a","ff"],"choice":7,"literal":{"k":["v",null,false,"snowman \u2603"]},"extra":1})json",
            R"json({"enabled":true,"level":0,"name":"Abc_123","items":["0a","ff"],"choice":7,"literal":{"k":["v",null,false,"snowman \u2603"]},"forbidden":true})json",
            R"json({"enabled":true,"level":1e,"name":"Abc_123"})json",
            R"json({"enabled":true,"name":"\uD800"})json",
    };
    for (const auto *options : bad_options) {
        INFO(options);
        REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(options, schema));
    }

    const char *ambiguous_one_of_schema = R"json({
        "type":"object",
        "properties":{"value":{"oneOf":[{},{}]}},
        "required":["value"],
        "additionalProperties":false
    })json";
    REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(R"json({"value":1})json", ambiguous_one_of_schema));

    const char *bad_schemas[] = {
            "",
            R"json([])json",
            R"json({"type":"array"})json",
            R"json({"type":"object","properties":{"x":{"type":"number"}}})json",
            R"json({"type":"object","properties":{"x":{"oneOf":{}}}})json",
            R"json({"type":"object","properties":[]})json",
            R"json({"type":"object","additionalProperties":"no"})json",
            R"json({"type":"object","required":[1]})json",
            R"json({"type":"object","properties":{"x":{"enum":{}}}})json",
            R"json({"type":"object","properties":{"x":{"pattern":1}}})json",
    };
    for (const auto *bad_schema : bad_schemas) {
        INFO(bad_schema);
        REQUIRE(-1 == omega_transform_plugin_options_match_args_schema(R"json({"x":"abc"})json", bad_schema));
    }
}

TEST_CASE("Utility helpers chew through masks, BOMs, strings, and invalid encodings", "[BrutalCoverage][Utility]") {
    REQUIRE(0x88 == omega_util_mask_byte(0xAA, 0xCC, MASK_AND));
    REQUIRE(0xEE == omega_util_mask_byte(0xAA, 0xCC, MASK_OR));
    REQUIRE(0x66 == omega_util_mask_byte(0xAA, 0xCC, MASK_XOR));

    REQUIRE(omega_util_strncmp("abc", "abd", 3) < 0);
    REQUIRE(omega_util_strncmp("abd", "abc", 3) > 0);
    REQUIRE(0 == omega_util_strncmp("abcdef", "abcXYZ", 3));
    REQUIRE(omega_util_strnicmp("AbC", "aBd", 3) < 0);
    REQUIRE(omega_util_strnicmp("aBd", "AbC", 3) > 0);
    REQUIRE(0 == omega_util_strnicmp("MiXeD", "mixed", 5));

    const char memory[] = "abacad";
    REQUIRE(static_cast<const void *>(memory + 4) == omega_util_memrchr(memory, 'a', sizeof(memory) - 1));
    REQUIRE(nullptr == omega_util_memrchr(memory, 'z', sizeof(memory) - 1));
    REQUIRE(nullptr == omega_util_memrchr(memory, 'a', 0));

    auto *dup = omega_util_strndup("abcdef", 3);
    REQUIRE(dup);
    REQUIRE_THAT(dup, Equals("abc"));
    free(dup);

    REQUIRE(0 == std::strcmp("unknown", omega_util_BOM_to_cstring(BOM_UNKNOWN)));
    REQUIRE(BOM_UNKNOWN == omega_util_cstring_to_BOM(nullptr));
    REQUIRE(BOM_UTF16LE == omega_util_cstring_to_BOM("utf-16le"));
    REQUIRE(BOM_UTF32BE == omega_util_cstring_to_BOM("UTF-32BE"));
    REQUIRE(BOM_UNKNOWN == omega_util_cstring_to_BOM("UTF-7"));

    const unsigned char utf8_bom[] = {0xEF, 0xBB, 0xBF, 'x'};
    const unsigned char utf16le_bom[] = {0xFF, 0xFE, 'x', 0x00};
    const unsigned char utf16be_bom[] = {0xFE, 0xFF, 0x00, 'x'};
    const unsigned char utf32le_bom[] = {0xFF, 0xFE, 0x00, 0x00, 'x'};
    const unsigned char utf32be_bom[] = {0x00, 0x00, 0xFE, 0xFF, 'x'};
    REQUIRE(BOM_UTF8 == omega_util_detect_BOM_from_memory(utf8_bom, sizeof(utf8_bom)));
    REQUIRE(BOM_UTF16LE == omega_util_detect_BOM_from_memory(utf16le_bom, sizeof(utf16le_bom)));
    REQUIRE(BOM_UTF16BE == omega_util_detect_BOM_from_memory(utf16be_bom, sizeof(utf16be_bom)));
    REQUIRE(BOM_UTF32LE == omega_util_detect_BOM_from_memory(utf32le_bom, sizeof(utf32le_bom)));
    REQUIRE(BOM_UTF32BE == omega_util_detect_BOM_from_memory(utf32be_bom, sizeof(utf32be_bom)));
    REQUIRE(BOM_NONE == omega_util_detect_BOM_from_memory(utf8_bom, 2));

    require_bom_buffer(BOM_UTF8, {0xEF, 0xBB, 0xBF});
    require_bom_buffer(BOM_UTF16LE, {0xFF, 0xFE});
    require_bom_buffer(BOM_UTF16BE, {0xFE, 0xFF});
    require_bom_buffer(BOM_UTF32LE, {0xFF, 0xFE, 0x00, 0x00});
    require_bom_buffer(BOM_UTF32BE, {0x00, 0x00, 0xFE, 0xFF});
    REQUIRE(nullptr == omega_util_BOM_to_buffer(BOM_NONE));
    REQUIRE(nullptr == omega_util_BOM_to_buffer(BOM_UNKNOWN));

    const ScratchDir scratch;
    const auto bom_path = std::filesystem::path(scratch.str()) / "utf32be-bom.dat";
    {
        std::ofstream output(bom_path, std::ios::binary);
        output.write(reinterpret_cast<const char *>(utf32be_bom), sizeof(utf32be_bom));
        REQUIRE(output.good());
    }
    REQUIRE(BOM_UTF32BE == omega_util_detect_BOM_from_file(bom_path.string().c_str()));
    REQUIRE(BOM_NONE ==
            omega_util_detect_BOM_from_file((std::filesystem::path(scratch.str()) / "missing.dat").string().c_str()));

    auto *counts = omega_character_counts_create();
    REQUIRE(counts);

    omega_character_counts_set_BOM(counts, BOM_UTF8);
    const unsigned char valid_utf8[] = {0xEF, 0xBB, 0xBF, 'A', 0xC3, 0xA9, 0xE2, 0x82, 0xAC, 0xF0, 0x9F, 0x8C, 0x8D};
    omega_util_count_characters(valid_utf8, sizeof(valid_utf8), counts);
    REQUIRE(BOM_UTF8 == omega_character_counts_get_BOM(counts));
    REQUIRE(3 == omega_character_counts_bom_bytes(counts));
    REQUIRE(1 == omega_character_counts_single_byte_chars(counts));
    REQUIRE(1 == omega_character_counts_double_byte_chars(counts));
    REQUIRE(1 == omega_character_counts_triple_byte_chars(counts));
    REQUIRE(1 == omega_character_counts_quad_byte_chars(counts));
    REQUIRE(0 == omega_character_counts_invalid_bytes(counts));

    omega_character_counts_reset(counts);
    omega_character_counts_set_BOM(counts, BOM_UTF8);
    const unsigned char invalid_utf8[] = {0xEF, 0xBB, 0xBF, 'A', 0xC3, 0xE2, 0x82, 0xFF};
    omega_util_count_characters(invalid_utf8, sizeof(invalid_utf8), counts);
    REQUIRE(1 == omega_character_counts_single_byte_chars(counts));
    REQUIRE(omega_character_counts_invalid_bytes(counts) > 0);

    omega_character_counts_reset(counts);
    omega_character_counts_set_BOM(counts, BOM_UTF16LE);
    const unsigned char rough_utf16le[] = {0xFF, 0xFE, 0x41, 0x00, 0x00, 0x01, 0x3D, 0xD8, 0x00, 0xDE, 0x00, 0xD8};
    omega_util_count_characters(rough_utf16le, sizeof(rough_utf16le), counts);
    REQUIRE(2 == omega_character_counts_bom_bytes(counts));
    REQUIRE(1 == omega_character_counts_single_byte_chars(counts));
    REQUIRE(2 == omega_character_counts_double_byte_chars(counts));
    REQUIRE(omega_character_counts_invalid_bytes(counts) > 0);

    omega_character_counts_destroy(counts);
}

TEST_CASE("Filesystem helpers reject bad paths and exercise boundary operations", "[BrutalCoverage][Filesystem]") {
    const ScratchDir scratch;

    errno = 0;
    char bad_template[] = "omega-edit-not-a-template";
    REQUIRE(-1 == omega_util_mkstemp(bad_template, 0600));
    REQUIRE(errno == EINVAL);
    REQUIRE(-1 == omega_util_mkstemp(nullptr, 0600));

    char temp_template[FILENAME_MAX]{};
    REQUIRE(std::snprintf(temp_template, sizeof(temp_template), "%s%cbrutal-XXXXXX", scratch.c_str(),
                          omega_util_directory_separator()) > 0);
    const auto fd = omega_util_mkstemp(temp_template, 0640);
    REQUIRE(fd >= 0);
    REQUIRE(0 == close_fd(fd));
    REQUIRE(omega_util_file_exists(temp_template));
    REQUIRE(std::strstr(temp_template, "XXXXXX") == nullptr);

    {
        std::ofstream output(temp_template, std::ios::binary | std::ios::trunc);
        output << "abcdef";
        REQUIRE(output.good());
    }
    char buffer[4]{};
    REQUIRE(1 == omega_util_read_file_segment(temp_template, 5, buffer, 1));
    REQUIRE(buffer[0] == 'f');
    REQUIRE(0 == omega_util_read_file_segment(temp_template, omega_util_file_size(temp_template), buffer, 0));
    REQUIRE(-1 == omega_util_read_file_segment(temp_template, 6, buffer, 1));

    int64_t mtime = 0;
    REQUIRE(0 == omega_util_get_modification_time(temp_template, &mtime));
    REQUIRE(mtime != 0);
    REQUIRE(-1 == omega_util_get_modification_time(nullptr, &mtime));
    REQUIRE(-1 == omega_util_get_modification_time(temp_template, nullptr));
    REQUIRE(-2 == omega_util_get_modification_time((std::filesystem::path(scratch.str()) / "missing").string().c_str(),
                                                   &mtime));

    const auto nested = std::filesystem::path(scratch.str()) / "nested" / "leaf";
    REQUIRE(0 == omega_util_create_directory(nested.string().c_str()));
    REQUIRE(1 == omega_util_create_directory(nested.string().c_str()));
    REQUIRE(omega_util_directory_exists(nested.string().c_str()));
    REQUIRE(0 == omega_util_remove_directory(nested.string().c_str()));

    const auto non_empty = std::filesystem::path(scratch.str()) / "non-empty";
    REQUIRE(0 == omega_util_create_directory(non_empty.string().c_str()));
    {
        std::ofstream output(non_empty / "child.txt");
        output << "child";
        REQUIRE(output.good());
    }
    REQUIRE(-1 == omega_util_remove_directory(non_empty.string().c_str()));
    REQUIRE(omega_util_remove_all(non_empty.string().c_str()) > 0);

    REQUIRE(-2 == omega_util_file_copy(scratch.c_str(),
                                       (std::filesystem::path(scratch.str()) / "copy.dat").string().c_str(), 0));
    REQUIRE(-4 == omega_util_file_copy(
                          temp_template,
                          (std::filesystem::path(scratch.str()) / "missing-parent" / "copy.dat").string().c_str(), 0));

    const std::string long_name(FILENAME_MAX, 'x');
    REQUIRE(nullptr == omega_util_basename(long_name.c_str(), nullptr, 0));

    const auto long_dir = std::string(FILENAME_MAX, 'd') + "/file";
    REQUIRE(nullptr == omega_util_dirname(long_dir.c_str(), nullptr));

    const auto long_ext = "name." + std::string(FILENAME_MAX, 'e');
    REQUIRE(nullptr == omega_util_file_extension(long_ext.c_str(), nullptr));

    char available[FILENAME_MAX]{};
    const auto very_long_available =
            (std::filesystem::path(scratch.str()) / (std::string(FILENAME_MAX, 'a') + ".dat")).string();
    REQUIRE(omega_util_available_filename(very_long_available.c_str(), available));
    REQUIRE(std::strlen(available) < FILENAME_MAX);

    auto *temp_dir = omega_util_get_temp_directory();
    REQUIRE(temp_dir);
    REQUIRE(omega_util_directory_exists(temp_dir));
    free(temp_dir);
}
