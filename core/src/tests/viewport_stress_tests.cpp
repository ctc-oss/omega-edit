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

#include <test_util.hpp>

#include <catch2/catch_test_macros.hpp>

#include <cstring>
#include <string>
#include <vector>

// Viewport change counter for stress tests
static int stress_viewport_cbk_count = 0;

static void stress_viewport_event_cbk(const omega_viewport_t *, omega_viewport_event_t, const void *) {
    ++stress_viewport_cbk_count;
}

TEST_CASE("Multi-Viewport Sync Under Edits", "[ViewportStress][MultiViewport]") {
    // Create a session with known content
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // Insert initial content: 200 bytes of known data
    std::string initial_data;
    initial_data.reserve(200);
    for (int i = 0; i < 200; ++i) {
        initial_data.push_back(static_cast<char>('A' + (i % 26)));
    }
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, initial_data));
    REQUIRE(200 == omega_session_get_computed_file_size(session_ptr));

    // Create 25 fixed viewports, each covering a 20-byte window at staggered offsets
    constexpr int NUM_VIEWPORTS = 25;
    constexpr int64_t VP_CAPACITY = 20;
    std::vector<omega_viewport_t *> viewports;
    viewports.reserve(NUM_VIEWPORTS);

    for (int i = 0; i < NUM_VIEWPORTS; ++i) {
        int64_t offset = i * 8; // staggered by 8 bytes, overlapping
        if (offset + VP_CAPACITY > 200) { offset = 200 - VP_CAPACITY; }
        auto *vp = omega_edit_create_viewport(session_ptr, offset, VP_CAPACITY, 0,
                                              stress_viewport_event_cbk, nullptr, 0);
        REQUIRE(vp);
        viewports.push_back(vp);
    }

    REQUIRE(NUM_VIEWPORTS == omega_session_get_num_viewports(session_ptr));

    // Verify all viewports have data
    for (int i = 0; i < NUM_VIEWPORTS; ++i) {
        REQUIRE(omega_viewport_get_length(viewports[i]) > 0);
        REQUIRE(omega_viewport_get_data(viewports[i]) != nullptr);
    }

    // Perform a series of edits and verify all viewports remain consistent
    // Insert at the beginning (should shift all fixed viewports' view of data)
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "HEAD"));
    REQUIRE(204 == omega_session_get_computed_file_size(session_ptr));

    // Verify each viewport's data matches the corresponding segment from the session
    for (int i = 0; i < NUM_VIEWPORTS; ++i) {
        auto vp_offset = omega_viewport_get_offset(viewports[i]);
        auto vp_length = omega_viewport_get_length(viewports[i]);
        auto vp_data = std::string(reinterpret_cast<const char *>(omega_viewport_get_data(viewports[i])), vp_length);
        auto session_data = omega_session_get_segment_string(session_ptr, vp_offset, vp_length);
        REQUIRE(vp_data == session_data);
    }

    // Insert in the middle
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 100, "MIDDLE"));
    REQUIRE(210 == omega_session_get_computed_file_size(session_ptr));

    // Verify all viewports again
    for (int i = 0; i < NUM_VIEWPORTS; ++i) {
        auto vp_offset = omega_viewport_get_offset(viewports[i]);
        auto vp_length = omega_viewport_get_length(viewports[i]);
        auto vp_data = std::string(reinterpret_cast<const char *>(omega_viewport_get_data(viewports[i])), vp_length);
        auto session_data = omega_session_get_segment_string(session_ptr, vp_offset, vp_length);
        REQUIRE(vp_data == session_data);
    }

    // Delete from near the beginning
    REQUIRE(0 < omega_edit_delete(session_ptr, 2, 10));
    REQUIRE(200 == omega_session_get_computed_file_size(session_ptr));

    // Verify all viewports again
    for (int i = 0; i < NUM_VIEWPORTS; ++i) {
        auto vp_offset = omega_viewport_get_offset(viewports[i]);
        auto vp_length = omega_viewport_get_length(viewports[i]);
        auto vp_data = std::string(reinterpret_cast<const char *>(omega_viewport_get_data(viewports[i])), vp_length);
        auto session_data = omega_session_get_segment_string(session_ptr, vp_offset, vp_length);
        REQUIRE(vp_data == session_data);
    }

    // Overwrite in the middle
    REQUIRE(0 < omega_edit_overwrite_string(session_ptr, 50, "OVERWRITTEN_DATA"));

    // Verify all viewports one more time
    for (int i = 0; i < NUM_VIEWPORTS; ++i) {
        auto vp_offset = omega_viewport_get_offset(viewports[i]);
        auto vp_length = omega_viewport_get_length(viewports[i]);
        auto vp_data = std::string(reinterpret_cast<const char *>(omega_viewport_get_data(viewports[i])), vp_length);
        auto session_data = omega_session_get_segment_string(session_ptr, vp_offset, vp_length);
        REQUIRE(vp_data == session_data);
    }

    REQUIRE(0 == omega_check_model(session_ptr));

    // Destroy all viewports
    for (auto *vp : viewports) { omega_edit_destroy_viewport(vp); }

    REQUIRE(0 == omega_session_get_num_viewports(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Floating Viewports Track Insertions", "[ViewportStress][FloatingViewport]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // Insert initial content: "AAABBBCCCDDD" (12 bytes)
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "AAABBBCCCDDD"));
    REQUIRE(12 == omega_session_get_computed_file_size(session_ptr));

    // Create 4 floating viewports at different positions
    auto *vp_a = omega_edit_create_viewport(session_ptr, 0, 3, 1, nullptr, nullptr, 0);
    auto *vp_b = omega_edit_create_viewport(session_ptr, 3, 3, 1, nullptr, nullptr, 0);
    auto *vp_c = omega_edit_create_viewport(session_ptr, 6, 3, 1, nullptr, nullptr, 0);
    auto *vp_d = omega_edit_create_viewport(session_ptr, 9, 3, 1, nullptr, nullptr, 0);
    REQUIRE(vp_a);
    REQUIRE(vp_b);
    REQUIRE(vp_c);
    REQUIRE(vp_d);

    // Verify initial viewport data
    REQUIRE(omega_viewport_get_string(vp_a) == "AAA");
    REQUIRE(omega_viewport_get_string(vp_b) == "BBB");
    REQUIRE(omega_viewport_get_string(vp_c) == "CCC");
    REQUIRE(omega_viewport_get_string(vp_d) == "DDD");

    // Insert "XX" at offset 3 (between AAA and BBB) — floating viewports after offset 3 should shift
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 3, "XX"));
    REQUIRE(14 == omega_session_get_computed_file_size(session_ptr));

    // vp_a at 0: should still see "AAA"
    REQUIRE(omega_viewport_get_string(vp_a) == "AAA");
    // vp_b was at 3, now should be at 5 (shifted by 2)
    REQUIRE(omega_viewport_get_offset(vp_b) == 5);
    REQUIRE(omega_viewport_get_string(vp_b) == "BBB");
    // vp_c was at 6, now should be at 8
    REQUIRE(omega_viewport_get_offset(vp_c) == 8);
    REQUIRE(omega_viewport_get_string(vp_c) == "CCC");
    // vp_d was at 9, now should be at 11
    REQUIRE(omega_viewport_get_offset(vp_d) == 11);
    REQUIRE(omega_viewport_get_string(vp_d) == "DDD");

    // Delete "XX" back (delete 2 bytes at offset 3)
    REQUIRE(0 < omega_edit_delete(session_ptr, 3, 2));
    REQUIRE(12 == omega_session_get_computed_file_size(session_ptr));

    // All floating viewports should shift back
    REQUIRE(omega_viewport_get_offset(vp_b) == 3);
    REQUIRE(omega_viewport_get_string(vp_b) == "BBB");
    REQUIRE(omega_viewport_get_offset(vp_c) == 6);
    REQUIRE(omega_viewport_get_string(vp_c) == "CCC");
    REQUIRE(omega_viewport_get_offset(vp_d) == 9);
    REQUIRE(omega_viewport_get_string(vp_d) == "DDD");

    REQUIRE(0 == omega_check_model(session_ptr));

    omega_edit_destroy_viewport(vp_a);
    omega_edit_destroy_viewport(vp_b);
    omega_edit_destroy_viewport(vp_c);
    omega_edit_destroy_viewport(vp_d);
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Many Viewports With Interleaved Edits", "[ViewportStress][HeavyEdits]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    // Build up 500 bytes of content
    for (int i = 0; i < 50; ++i) {
        REQUIRE(0 < omega_edit_insert_string(session_ptr, i * 10, "0123456789"));
    }
    REQUIRE(500 == omega_session_get_computed_file_size(session_ptr));

    // Create 20 floating viewports spread across the content
    constexpr int NUM_VIEWPORTS = 20;
    constexpr int64_t VP_CAPACITY = 25;
    std::vector<omega_viewport_t *> viewports;
    for (int i = 0; i < NUM_VIEWPORTS; ++i) {
        auto *vp = omega_edit_create_viewport(session_ptr, i * 25, VP_CAPACITY, 1, nullptr, nullptr, 0);
        REQUIRE(vp);
        viewports.push_back(vp);
    }

    // Perform 50 interleaved insert/delete/overwrite operations
    for (int i = 0; i < 50; ++i) {
        auto file_size = omega_session_get_computed_file_size(session_ptr);
        if (i % 3 == 0 && file_size > 10) {
            // Delete 5 bytes from offset i*2 (clamped to file size)
            int64_t offset = (i * 2) % file_size;
            int64_t len = (offset + 5 > file_size) ? file_size - offset : 5;
            if (len > 0) {
                omega_edit_delete(session_ptr, offset, len);
            }
        } else if (i % 3 == 1) {
            // Insert at position i*3 (clamped)
            int64_t offset = (file_size > 0) ? ((i * 3) % file_size) : 0;
            omega_edit_insert_string(session_ptr, offset, "INS");
        } else {
            // Overwrite at position i (clamped)
            if (file_size > 0) {
                int64_t offset = i % file_size;
                omega_edit_overwrite_string(session_ptr, offset, "OVR");
            }
        }
    }

    // After all edits, verify every viewport's data matches the session data
    for (int i = 0; i < NUM_VIEWPORTS; ++i) {
        auto vp_offset = omega_viewport_get_offset(viewports[i]);
        auto vp_length = omega_viewport_get_length(viewports[i]);
        if (vp_length > 0) {
            auto vp_data =
                    std::string(reinterpret_cast<const char *>(omega_viewport_get_data(viewports[i])), vp_length);
            auto session_data = omega_session_get_segment_string(session_ptr, vp_offset, vp_length);
            REQUIRE(vp_data == session_data);
        }
    }

    REQUIRE(0 == omega_check_model(session_ptr));

    // Undo all changes and verify viewports still stay in sync
    while (omega_session_get_num_changes(session_ptr) > 0) {
        omega_edit_undo_last_change(session_ptr);
    }

    for (int i = 0; i < NUM_VIEWPORTS; ++i) {
        auto vp_offset = omega_viewport_get_offset(viewports[i]);
        auto vp_length = omega_viewport_get_length(viewports[i]);
        if (vp_length > 0) {
            auto vp_data =
                    std::string(reinterpret_cast<const char *>(omega_viewport_get_data(viewports[i])), vp_length);
            auto session_data = omega_session_get_segment_string(session_ptr, vp_offset, vp_length);
            REQUIRE(vp_data == session_data);
        }
    }

    REQUIRE(0 == omega_check_model(session_ptr));

    for (auto *vp : viewports) { omega_edit_destroy_viewport(vp); }
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Viewport Modify Changes Offset and Capacity", "[ViewportStress][ViewportModify]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"));
    REQUIRE(26 == omega_session_get_computed_file_size(session_ptr));

    auto *vp = omega_edit_create_viewport(session_ptr, 0, 10, 0, nullptr, nullptr, 0);
    REQUIRE(vp);
    REQUIRE(omega_viewport_get_string(vp) == "ABCDEFGHIJ");

    // Modify to view a different range
    REQUIRE(0 == omega_viewport_modify(vp, 10, 5, 0));
    REQUIRE(omega_viewport_get_offset(vp) == 10);
    REQUIRE(omega_viewport_get_capacity(vp) == 5);
    REQUIRE(omega_viewport_get_string(vp) == "KLMNO");

    // Modify to floating
    REQUIRE(0 == omega_viewport_modify(vp, 20, 6, 1));
    REQUIRE(omega_viewport_is_floating(vp));
    REQUIRE(omega_viewport_get_string(vp) == "UVWXYZ");

    // Insert before the viewport offset — floating viewport should adjust
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "12345"));
    REQUIRE(omega_viewport_get_offset(vp) == 25); // shifted by 5
    REQUIRE(omega_viewport_get_string(vp) == "UVWXYZ");

    omega_edit_destroy_viewport(vp);
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Viewport In Segment Query", "[ViewportStress][ViewportInSegment]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"));

    auto *vp = omega_edit_create_viewport(session_ptr, 5, 10, 0, nullptr, nullptr, 0);
    REQUIRE(vp);

    // Viewport at offset=5, capacity=10. The in_segment function uses inclusive boundaries:
    // (offset + length) >= viewport_offset && offset <= (viewport_offset + viewport_capacity)
    REQUIRE(omega_viewport_in_segment(vp, 0, 20));  // segment [0,20) clearly overlaps
    REQUIRE(omega_viewport_in_segment(vp, 5, 10));  // exact match
    REQUIRE(omega_viewport_in_segment(vp, 10, 10)); // segment [10,20) overlaps
    REQUIRE(omega_viewport_in_segment(vp, 0, 5));   // abutting at boundary (5 <= 5+10 and 0+5 >= 5) — library treats as in-segment
    REQUIRE(omega_viewport_in_segment(vp, 15, 10)); // abutting at boundary (15 <= 5+10 and 15+10 >= 5) — library treats as in-segment
    REQUIRE(!omega_viewport_in_segment(vp, 16, 10)); // segment [16,26) — truly no overlap (16 > 15)
    REQUIRE(!omega_viewport_in_segment(vp, 0, 4));   // segment [0,4) — truly no overlap (4 < 5)

    omega_edit_destroy_viewport(vp);
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Following Byte Count", "[ViewportStress][FollowingByteCount]") {
    const auto session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, 0, nullptr);
    REQUIRE(session_ptr);

    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, "ABCDEFGHIJKLMNOPQRST"));  // 20 bytes
    REQUIRE(20 == omega_session_get_computed_file_size(session_ptr));

    auto *vp = omega_edit_create_viewport(session_ptr, 0, 10, 0, nullptr, nullptr, 0);
    REQUIRE(vp);

    // Viewport covers [0, 10), so following bytes = 20 - 10 = 10
    REQUIRE(10 == omega_viewport_get_following_byte_count(vp));

    // Move viewport to the end
    REQUIRE(0 == omega_viewport_modify(vp, 15, 5, 0));
    REQUIRE(0 == omega_viewport_get_following_byte_count(vp));

    // Move to the middle
    REQUIRE(0 == omega_viewport_modify(vp, 10, 5, 0));
    REQUIRE(5 == omega_viewport_get_following_byte_count(vp));

    omega_edit_destroy_viewport(vp);
    omega_edit_destroy_session(session_ptr);
}
