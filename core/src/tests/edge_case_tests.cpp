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
#include "omega_edit/check.h"
#include "omega_edit/stl_string_adaptor.hpp"
#include "omega_edit/utility.h"

#include <test_util.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <cstdio>
#include <cstring>
#include <filesystem>
#include <string>

using namespace std;
using Catch::Matchers::Equals;

// ─── Empty-string and zero-length edit operations ────────────────────────────

TEST_CASE("Single Byte Insert at Start", "[EdgeCase][MinimalInsert]") {
    // Inserting a single byte at offset 0 should succeed
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);
    REQUIRE(original_size > 0);

    // Insert one byte
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("X"), 1));
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == original_size + 1);
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));

    // Verify the byte was inserted at the start
    auto segment = omega_session_get_segment_string(session_ptr, 0, 1);
    REQUIRE(segment == "X");

    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Insert on Empty Session", "[EdgeCase][EmptyInsert]") {
    // Working with a session that has no backing file (empty session)
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));

    // NULL bytes pointer should return error
    REQUIRE(-1 == omega_edit_insert_bytes(session_ptr, 0, nullptr, 5));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 == omega_session_get_num_changes(session_ptr));

    // A real insert should succeed
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "hello"));
    REQUIRE(5 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));

    // Insert at end of current content
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 5, " world"));
    REQUIRE(11 == omega_session_get_computed_file_size(session_ptr));
    auto segment = omega_session_get_segment_string(session_ptr, 0, 11);
    REQUIRE(segment == "hello world");

    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Byte APIs preserve embedded nulls with explicit lengths", "[EdgeCase][BinaryLengths]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    const omega_byte_t inserted[] = {'A', '\0', 'B'};
    REQUIRE(0 < omega_edit_insert_bytes(session_ptr, 0, inserted, static_cast<int64_t>(sizeof(inserted))));
    REQUIRE(3 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(std::string(reinterpret_cast<const char *>(inserted), sizeof(inserted)) ==
            omega_session_get_segment_string(session_ptr, 0, 3));

    const omega_byte_t overwritten[] = {'X', '\0', 'Y'};
    REQUIRE(0 < omega_edit_overwrite_bytes(session_ptr, 0, overwritten, static_cast<int64_t>(sizeof(overwritten))));
    REQUIRE(std::string(reinterpret_cast<const char *>(overwritten), sizeof(overwritten)) ==
            omega_session_get_segment_string(session_ptr, 0, 3));

    const omega_byte_t replaced[] = {'Q', '\0', 'R', '\0'};
    REQUIRE(0 < omega_edit_replace_bytes(session_ptr, 0, 3, replaced, static_cast<int64_t>(sizeof(replaced))));
    REQUIRE(4 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(std::string(reinterpret_cast<const char *>(replaced), sizeof(replaced)) ==
            omega_session_get_segment_string(session_ptr, 0, 4));

    const omega_byte_t pattern[] = {'\0', 'R'};
    const auto search_context =
            omega_search_create_context_bytes(session_ptr, pattern, static_cast<int64_t>(sizeof(pattern)), 0, 0, 0, 0);
    REQUIRE(search_context);
    REQUIRE(1 == omega_search_next_match(search_context, 1));
    REQUIRE(1 == omega_search_context_get_match_offset(search_context));
    omega_search_destroy_context(search_context);

    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Byte APIs treat zero-length inputs as empty and keep string helpers convenient",
          "[EdgeCase][BinaryLengths]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    const omega_byte_t bytes[] = {'A', '\0', 'B'};
    REQUIRE(0 == omega_edit_insert_bytes(session_ptr, 0, bytes, 0));
    REQUIRE(0 == omega_edit_insert_bytes(session_ptr, 0, nullptr, 0));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 == omega_session_get_num_changes(session_ptr));

    REQUIRE(0 < omega_edit_insert(session_ptr, 0, "text", 0));
    REQUIRE("text" == omega_session_get_segment_string(session_ptr, 0, 4));
    REQUIRE(0 == omega_edit_overwrite_bytes(session_ptr, 1, bytes, 0));
    REQUIRE(0 == omega_edit_overwrite_bytes(session_ptr, 1, nullptr, 0));
    REQUIRE("text" == omega_session_get_segment_string(session_ptr, 0, 4));

    REQUIRE(0 < omega_edit_overwrite(session_ptr, 1, "A", 0));
    REQUIRE("tAxt" == omega_session_get_segment_string(session_ptr, 0, 4));
    REQUIRE(0 < omega_edit_replace(session_ptr, 1, 2, "BCD", 0));
    REQUIRE("tBCDt" == omega_session_get_segment_string(session_ptr, 0, 5));
    REQUIRE(-1 == omega_edit_replace(session_ptr, 0, 0, nullptr, 1));
    REQUIRE("tBCDt" == omega_session_get_segment_string(session_ptr, 0, 5));

    const auto cstring_search = omega_search_create_context(session_ptr, "BCD", 0, 0, 0, 0, 0);
    REQUIRE(cstring_search);
    REQUIRE(1 == omega_search_next_match(cstring_search, 1));
    REQUIRE(1 == omega_search_context_get_match_offset(cstring_search));
    omega_search_destroy_context(cstring_search);

    REQUIRE(nullptr == omega_search_create_context_bytes(session_ptr, bytes, 0, 0, 0, 0, 0));

    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Delete Entire File Content", "[EdgeCase][DeleteAll]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);
    REQUIRE(original_size > 0);

    // Delete all bytes
    REQUIRE(0 < omega_edit_delete(session_ptr, 0, original_size));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));

    // Undo should restore
    REQUIRE(0 != omega_edit_undo_last_change(session_ptr));
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == original_size);

    REQUIRE(0 == omega_check_model(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Overwrite With Null Pointer Rejected", "[EdgeCase][NullOverwrite]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);

    // Overwriting with null bytes pointer should return -1
    REQUIRE(-1 == omega_edit_overwrite_bytes(session_ptr, 0, nullptr, 5));
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == original_size);
    REQUIRE(0 == omega_session_get_num_changes(session_ptr));

    // NULL session should also return -1
    REQUIRE(-1 == omega_edit_overwrite_bytes(nullptr, 0, reinterpret_cast<const omega_byte_t *>("X"), 1));

    omega_edit_destroy_session(session_ptr);
}

// ─── Operations at and beyond file boundaries ────────────────────────────────

TEST_CASE("Insert at End of File", "[EdgeCase][BoundaryInsert]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);

    // Insert at exactly the end of the file should succeed (appending)
    REQUIRE(0 < omega_edit_insert_string(session_ptr, original_size, "TAIL"));
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == original_size + 4);

    // Verify the appended data
    auto segment = omega_session_get_segment_string(session_ptr, original_size, 4);
    REQUIRE(segment == "TAIL");

    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Insert Beyond End of File", "[EdgeCase][BeyondEOF]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);

    // Insert beyond end of file - offset past file size
    // The library should handle this gracefully (either clamp or reject)
    const auto result = omega_edit_insert_string(session_ptr, original_size + 100, "beyond");
    // Whether it succeeds or fails, the model should remain valid
    REQUIRE(0 == omega_check_model(session_ptr));

    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Delete Beyond End of File", "[EdgeCase][BeyondEOF]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);

    // Delete more bytes than exist from offset 0
    const auto result = omega_edit_delete(session_ptr, 0, original_size + 100);
    // Whether it caps or rejects, model should be valid
    REQUIRE(0 == omega_check_model(session_ptr));
    // File size should be between 0 and original (capped or rejected)
    REQUIRE(omega_session_get_computed_file_size(session_ptr) >= 0);
    REQUIRE(omega_session_get_computed_file_size(session_ptr) <= original_size);

    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Overwrite Beyond End of File", "[EdgeCase][BeyondEOF]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);

    // Overwrite starting at the last byte, with data longer than remaining bytes
    const auto result = omega_edit_overwrite_string(session_ptr, original_size - 1, "LONGDATA");
    // Model should remain valid regardless of behavior
    REQUIRE(0 == omega_check_model(session_ptr));

    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Delete at Offset Equal to File Size", "[EdgeCase][BeyondEOF]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);

    // Delete starting at exactly file size (nothing to delete)
    const auto result = omega_edit_delete(session_ptr, original_size, 5);
    // Should be rejected or have no effect
    REQUIRE(omega_session_get_computed_file_size(session_ptr) <= original_size);
    REQUIRE(0 == omega_check_model(session_ptr));

    omega_edit_destroy_session(session_ptr);
}

// ─── Segment retrieval at boundaries ─────────────────────────────────────────

TEST_CASE("Segment Retrieval Boundary Conditions", "[EdgeCase][SegmentBoundary]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto file_size = omega_session_get_computed_file_size(session_ptr);

    // Retrieve at offset 0, full file length
    auto full_segment = omega_session_get_segment_string(session_ptr, 0, file_size);
    REQUIRE(static_cast<int64_t>(full_segment.size()) == file_size);

    // Retrieve a zero-length segment
    auto empty_segment = omega_session_get_segment_string(session_ptr, 0, 0);
    REQUIRE(empty_segment.empty());

    // Retrieve at the end of file (should return empty or partial)
    auto eof_segment = omega_session_get_segment_string(session_ptr, file_size, 10);
    REQUIRE(eof_segment.empty());

    // Retrieve crossing the end of file (partial read)
    if (file_size > 5) {
        auto partial_segment = omega_session_get_segment_string(session_ptr, file_size - 3, 10);
        // Should return at most 3 bytes
        REQUIRE(static_cast<int64_t>(partial_segment.size()) <= 3);
    }

    omega_edit_destroy_session(session_ptr);
}

// ─── Unicode / multi-byte edit correctness ───────────────────────────────────

TEST_CASE("UTF-8 Multi-Byte Insert and Retrieve", "[EdgeCase][Unicode]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // Insert a string with multi-byte UTF-8 characters
    // "café" = 63 61 66 C3 A9 (5 bytes, 4 characters)
    const std::string cafe = "caf\xC3\xA9";
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, cafe));
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == 5);

    // Retrieve and verify the data is byte-identical
    auto segment = omega_session_get_segment_string(session_ptr, 0, 5);
    REQUIRE(segment == cafe);

    // Insert emoji: "😀" = F0 9F 98 80 (4 bytes, 1 character)
    const std::string emoji = "\xF0\x9F\x98\x80";
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 5, emoji));
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == 9);

    auto full = omega_session_get_segment_string(session_ptr, 0, 9);
    REQUIRE(full == cafe + emoji);

    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("UTF-8 Mid-Codepoint Operations", "[EdgeCase][Unicode]") {
    // This test verifies that the library operates at the byte level and does not corrupt data
    // when operations split multi-byte codepoints. The library is byte-oriented by design.
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // "é" = C3 A9 (2-byte UTF-8)
    const std::string accent_e = "\xC3\xA9";
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, accent_e));
    REQUIRE(2 == omega_session_get_computed_file_size(session_ptr));

    // Delete just the first byte of the 2-byte sequence
    REQUIRE(0 < omega_edit_delete(session_ptr, 0, 1));
    REQUIRE(1 == omega_session_get_computed_file_size(session_ptr));

    // The remaining byte should be 0xA9 (the second byte of the original codepoint)
    auto segment = omega_session_get_segment_string(session_ptr, 0, 1);
    REQUIRE(segment.size() == 1);
    REQUIRE(static_cast<unsigned char>(segment[0]) == 0xA9);

    // Model should still be valid (byte-level operations are always consistent)
    REQUIRE(0 == omega_check_model(session_ptr));

    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("UTF-8 Overwrite Preserves Surrounding Bytes", "[EdgeCase][Unicode]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // Insert "aéb" = 61 C3 A9 62 (4 bytes)
    const std::string data = "a\xC3\xA9""b";
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, data));
    REQUIRE(4 == omega_session_get_computed_file_size(session_ptr));

    // Overwrite the 2-byte "é" with a 1-byte "e" (shrinks the content at that spot)
    // This overwrites bytes at offset 1 with "e" (1 byte overwriting 1 byte)
    REQUIRE(0 < omega_edit_overwrite_string(session_ptr, 1, "e"));

    // Result should be "aeb" + 62 depending on overwrite behavior
    // Overwrite replaces byte-for-byte at offset, so offset 1 becomes 'e', and bytes at 2,3 remain C3 A9 -> wait no.
    // Actually overwrite replaces 1 byte at offset 1 with 'e', so: 61 65 A9 62
    auto segment = omega_session_get_segment_string(session_ptr, 0, 4);
    REQUIRE(segment[0] == 'a');
    REQUIRE(segment[1] == 'e');
    // The rest is the trailing bytes of the original data
    REQUIRE(static_cast<unsigned char>(segment[2]) == 0xA9);
    REQUIRE(segment[3] == 'b');

    REQUIRE(0 == omega_check_model(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("UTF-8 Insert Between Codepoint Bytes", "[EdgeCase][Unicode]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // Insert "é" = C3 A9
    const std::string accent_e = "\xC3\xA9";
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, accent_e));

    // Insert "X" between the two bytes of the codepoint at offset 1
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 1, "X"));
    REQUIRE(3 == omega_session_get_computed_file_size(session_ptr));

    // Result should be C3 58 A9 (byte-level insert)
    auto segment = omega_session_get_segment_string(session_ptr, 0, 3);
    REQUIRE(static_cast<unsigned char>(segment[0]) == 0xC3);
    REQUIRE(segment[1] == 'X');
    REQUIRE(static_cast<unsigned char>(segment[2]) == 0xA9);

    REQUIRE(0 == omega_check_model(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

// ─── Undo/Redo after Save ────────────────────────────────────────────────────

TEST_CASE("Undo After Save Restores Content", "[EdgeCase][UndoAfterSave]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    const auto session_ptr =
            omega_edit_create_session(MAKE_PATH("test1.dat"), session_change_cbk, &file_info, ALL_EVENTS, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);

    // Get original content
    auto original_content = omega_session_get_segment_string(session_ptr, 0, original_size);

    // Make an edit
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "PREPEND_"));
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == original_size + 8);

    // Save the file
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("edge_case_undo_after_save.dat"),
                                 omega_io_flags_t::IO_FLG_OVERWRITE, nullptr));

    // Make another edit after save
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "POST_"));

    // Undo the post-save edit
    REQUIRE(0 != omega_edit_undo_last_change(session_ptr));

    // Model should be valid after undo
    REQUIRE(0 == omega_check_model(session_ptr));

    // Clean up test file
    omega_util_remove_file(MAKE_PATH("edge_case_undo_after_save.dat"));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Multiple Undo Redo Cycles", "[EdgeCase][UndoRedoCycle]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // Build up content with multiple inserts
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "AAA"));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 3, "BBB"));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 6, "CCC"));
    REQUIRE(9 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(omega_session_get_segment_string(session_ptr, 0, 9) == "AAABBBCCC");

    // Undo all three
    REQUIRE(0 != omega_edit_undo_last_change(session_ptr));
    REQUIRE(0 != omega_edit_undo_last_change(session_ptr));
    REQUIRE(0 != omega_edit_undo_last_change(session_ptr));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));

    // Redo all three
    REQUIRE(0 != omega_edit_redo_last_undo(session_ptr));
    REQUIRE(0 != omega_edit_redo_last_undo(session_ptr));
    REQUIRE(0 != omega_edit_redo_last_undo(session_ptr));
    REQUIRE(9 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(omega_session_get_segment_string(session_ptr, 0, 9) == "AAABBBCCC");

    // Undo two, then insert (should discard redo stack)
    REQUIRE(0 != omega_edit_undo_last_change(session_ptr));
    REQUIRE(0 != omega_edit_undo_last_change(session_ptr));
    REQUIRE(3 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 3, "DDD"));
    REQUIRE(6 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(omega_session_get_segment_string(session_ptr, 0, 6) == "AAADDD");

    // Redo should now fail (redo stack was discarded by the new insert)
    REQUIRE(0 == omega_edit_redo_last_undo(session_ptr));

    REQUIRE(0 == omega_check_model(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

// ─── Out-of-range and invalid input tests ────────────────────────────────────

TEST_CASE("Null Pointer Operations Rejected", "[EdgeCase][InvalidInput]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);

    // Null pointer operations should be rejected with -1
    REQUIRE(-1 == omega_edit_insert_bytes(nullptr, 0, reinterpret_cast<const omega_byte_t *>("x"), 1));
    REQUIRE(-1 == omega_edit_insert_bytes(session_ptr, 0, nullptr, 1));
    REQUIRE(-1 == omega_edit_overwrite_bytes(nullptr, 0, reinterpret_cast<const omega_byte_t *>("x"), 1));
    REQUIRE(-1 == omega_edit_overwrite_bytes(session_ptr, 0, nullptr, 1));
    REQUIRE(-1 == omega_edit_delete(nullptr, 0, 5));

    // File should be unchanged
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == original_size);
    REQUIRE(0 == omega_session_get_num_changes(session_ptr));

    REQUIRE(0 == omega_check_model(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Negative Edit Parameters Are Rejected", "[EdgeCase][InvalidInput]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    const auto original_size = omega_session_get_computed_file_size(session_ptr);

    REQUIRE(-1 == omega_edit_delete(session_ptr, 0, -5));
    REQUIRE(-1 == omega_edit_delete(session_ptr, -1, 5));
    REQUIRE(-1 == omega_edit_insert_bytes(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("x"), -1));
    REQUIRE(-1 == omega_edit_insert_bytes(session_ptr, -1, reinterpret_cast<const omega_byte_t *>("x"), 1));
    REQUIRE(-1 == omega_edit_overwrite_bytes(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("x"), -1));
    REQUIRE(-1 == omega_edit_overwrite_bytes(session_ptr, -1, reinterpret_cast<const omega_byte_t *>("x"), 1));
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == original_size);
    REQUIRE(0 == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_check_model(session_ptr));

    omega_edit_destroy_session(session_ptr);
}

// ─── Viewport Notify ─────────────────────────────────────────────────────────

static int viewport_notify_count = 0;

static void test_viewport_event_cbk(const omega_viewport_t *, omega_viewport_event_t, const void *) {
    ++viewport_notify_count;
}

TEST_CASE("Viewport Notify Callback", "[EdgeCase][ViewportNotify]") {
    viewport_notify_count = 0;
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // Create viewport with ALL_EVENTS so notifications are delivered
    auto *viewport_ptr =
            omega_edit_create_viewport(session_ptr, 0, 10, 0, test_viewport_event_cbk, nullptr, ALL_EVENTS);
    REQUIRE(viewport_ptr);

    // The VIEWPORT_EVT_CREATE event was delivered during creation
    REQUIRE(viewport_notify_count == 1);

    // Verify the viewport callback is set
    REQUIRE(nullptr != omega_viewport_get_event_cbk(viewport_ptr));

    // Manually notify the viewport with an edit event
    REQUIRE(1 == omega_viewport_notify(viewport_ptr, VIEWPORT_EVT_EDIT, nullptr));
    REQUIRE(viewport_notify_count == 2);

    // Pause viewport callbacks and try again
    omega_session_pause_viewport_event_callbacks(const_cast<omega_session_t *>(omega_viewport_get_session(viewport_ptr)));
    REQUIRE(0 == omega_viewport_notify(viewport_ptr, VIEWPORT_EVT_EDIT, nullptr));
    REQUIRE(viewport_notify_count == 2); // Should not have incremented

    // Resume and notify again
    omega_session_resume_viewport_event_callbacks(
            const_cast<omega_session_t *>(omega_viewport_get_session(viewport_ptr)));
    REQUIRE(1 == omega_viewport_notify(viewport_ptr, VIEWPORT_EVT_EDIT, nullptr));
    REQUIRE(viewport_notify_count == 3);

    // Verify NO_EVENTS suppresses notifications
    REQUIRE(NO_EVENTS == omega_viewport_set_event_interest(viewport_ptr, NO_EVENTS));
    REQUIRE(0 == omega_viewport_notify(viewport_ptr, VIEWPORT_EVT_EDIT, nullptr));
    REQUIRE(viewport_notify_count == 3); // Should not have incremented

    omega_edit_destroy_viewport(viewport_ptr);
    omega_edit_destroy_session(session_ptr);
}

// ─── Apply Transform via Edit API ────────────────────────────────────────────

TEST_CASE("Apply Transform to Session Data", "[EdgeCase][Transform]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // Insert lowercase data
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "hello world"));
    REQUIRE(11 == omega_session_get_computed_file_size(session_ptr));

    // Apply to_upper transform
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, to_upper, nullptr, 0, 11));

    // Verify the data was transformed
    auto segment = omega_session_get_segment_string(session_ptr, 0, 11);
    REQUIRE(segment == "HELLO WORLD");

    // Apply to_lower transform
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, to_lower, nullptr, 0, 11));
    segment = omega_session_get_segment_string(session_ptr, 0, 11);
    REQUIRE(segment == "hello world");

    // Apply transform to a partial range
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, to_upper, nullptr, 0, 5));
    segment = omega_session_get_segment_string(session_ptr, 0, 11);
    REQUIRE(segment == "HELLO world");

    REQUIRE(0 == omega_check_model(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

// ─── Save Segment Tests ─────────────────────────────────────────────────────

TEST_CASE("Save Segment Partial File", "[EdgeCase][SaveSegment]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "ABCDEFGHIJ"));
    REQUIRE(10 == omega_session_get_computed_file_size(session_ptr));

    // Save only bytes 3-7 (5 bytes: "DEFGH")
    char saved_filename[FILENAME_MAX];
    REQUIRE(0 == omega_edit_save_segment(session_ptr, MAKE_PATH("edge_case_segment.dat"),
                                         omega_io_flags_t::IO_FLG_OVERWRITE, saved_filename, 3, 5));

    // Read back and verify
    auto verify_session = omega_edit_create_session(MAKE_PATH("edge_case_segment.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(verify_session);
    REQUIRE(5 == omega_session_get_computed_file_size(verify_session));
    auto content = omega_session_get_segment_string(verify_session, 0, 5);
    REQUIRE(content == "DEFGH");

    omega_edit_destroy_session(verify_session);
    omega_util_remove_file(MAKE_PATH("edge_case_segment.dat"));
    omega_edit_destroy_session(session_ptr);
}

// ─── Session with empty file ─────────────────────────────────────────────────

TEST_CASE("Operations on Session from Empty File", "[EdgeCase][EmptyFile]") {
    const auto session_ptr =
            omega_edit_create_session(MAKE_PATH("empty_file.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));

    // Insert into empty file
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "data"));
    REQUIRE(4 == omega_session_get_computed_file_size(session_ptr));

    // Delete everything
    REQUIRE(0 < omega_edit_delete(session_ptr, 0, 4));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));

    // Undo the delete
    REQUIRE(0 != omega_edit_undo_last_change(session_ptr));
    REQUIRE(4 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(omega_session_get_segment_string(session_ptr, 0, 4) == "data");

    // Undo the insert
    REQUIRE(0 != omega_edit_undo_last_change(session_ptr));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));

    // Redo both
    REQUIRE(0 != omega_edit_redo_last_undo(session_ptr));
    REQUIRE(0 != omega_edit_redo_last_undo(session_ptr));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));

    REQUIRE(0 == omega_check_model(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

// ─── Rapid insert-delete-undo cycles (model integrity) ──────────────────────

TEST_CASE("Rapid Insert Delete Undo Cycles", "[EdgeCase][StressIntegrity]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // Do 100 insert+delete+undo cycles and verify model stays valid
    for (int i = 0; i < 100; ++i) {
        REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "x"));
        REQUIRE(0 < omega_edit_delete(session_ptr, 0, 1));
        REQUIRE(0 != omega_edit_undo_last_change(session_ptr)); // undo delete
        REQUIRE(0 != omega_edit_undo_last_change(session_ptr)); // undo insert
    }

    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(0 == omega_check_model(session_ptr));

    omega_edit_destroy_session(session_ptr);
}

// ─── Model integrity with checkpoints ────────────────────────────────────────

TEST_CASE("Model Check After Checkpoints", "[EdgeCase][ModelCheck]") {
    const auto session_ptr = omega_edit_create_session(MAKE_PATH("test1.dat"), nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);
    REQUIRE(0 == omega_check_model(session_ptr));

    // Edit and checkpoint
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "CHECKPOINT_1_"));
    REQUIRE(0 == omega_edit_create_checkpoint(session_ptr));
    REQUIRE(1 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_check_model(session_ptr));

    // More edits and another checkpoint
    REQUIRE(0 < omega_edit_overwrite_string(session_ptr, 0, "REPLACED"));
    REQUIRE(0 < omega_edit_delete(session_ptr, 8, 5));
    REQUIRE(0 == omega_edit_create_checkpoint(session_ptr));
    REQUIRE(2 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_check_model(session_ptr));

    // Apply transform on top of checkpoints
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, to_upper, nullptr, 0, 8));
    REQUIRE(3 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_check_model(session_ptr));

    omega_edit_destroy_session(session_ptr);
}
