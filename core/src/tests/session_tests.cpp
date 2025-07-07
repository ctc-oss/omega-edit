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
#include "omega_edit/stl_string_adaptor.hpp"

#include <test_util.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_contains.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

using Catch::Matchers::Contains;
using Catch::Matchers::EndsWith;
using Catch::Matchers::Equals;

typedef struct mask_info_struct {
    omega_byte_t mask;
    omega_mask_kind_t mask_kind;
} mask_info_t;

static inline omega_byte_t byte_mask_transform(omega_byte_t byte, void *user_data_ptr) {
    const auto mask_info_ptr = reinterpret_cast<mask_info_t *>(user_data_ptr);
    return omega_util_mask_byte(byte, mask_info_ptr->mask, mask_info_ptr->mask_kind);
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

TEST_CASE("Session Checkpoint Tests", "[SessionCheckpointTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    const auto in_filename_str = std::string(MAKE_PATH("test1.dat"));
    const auto in_filename = in_filename_str.c_str();
    const auto session_ptr =
            omega_edit_create_session(in_filename, session_change_cbk, &file_info, ALL_EVENTS, nullptr);
    REQUIRE(session_ptr);
    auto file_size = omega_session_get_computed_file_size(session_ptr);
    REQUIRE(file_size > 0);
    REQUIRE(0 !=
            omega_edit_insert_string(session_ptr, 0, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(-1 == omega_edit_destroy_last_checkpoint(session_ptr));
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, to_lower, nullptr, 0, 0));
    REQUIRE(1 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(1 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(2 == omega_edit_overwrite_string(session_ptr, 37, "BCDEFGHIJKLMNOPQRSTUVWXY"));
    REQUIRE(2 == omega_session_get_num_changes(session_ptr));
    REQUIRE(2 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("test1.actual.checkpoint.1.dat"),
        omega_io_flags_t::IO_FLG_OVERWRITE, nullptr));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.expected.checkpoint.1.dat"),
        MAKE_PATH("test1.actual.checkpoint.1.dat")));
    mask_info_t mask_info;
    mask_info.mask_kind = MASK_XOR;
    mask_info.mask = 0xFF;
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, byte_mask_transform, &mask_info, 10, 26));
    REQUIRE(2 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("test1.actual.checkpoint.2.dat"),
        omega_io_flags_t::IO_FLG_OVERWRITE, nullptr));
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, byte_mask_transform, &mask_info, 10, 26));
    REQUIRE(3 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("test1.actual.checkpoint.3.dat"),
        omega_io_flags_t::IO_FLG_OVERWRITE, nullptr));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.expected.checkpoint.1.dat"),
        MAKE_PATH("test1.actual.checkpoint.3.dat")));
    mask_info.mask_kind = MASK_AND;
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, byte_mask_transform, &mask_info, 10, 0));
    REQUIRE(4 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("test1.actual.checkpoint.4.dat"),
        omega_io_flags_t::IO_FLG_OVERWRITE, nullptr));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.expected.checkpoint.1.dat"),
        MAKE_PATH("test1.actual.checkpoint.4.dat")));
    mask_info.mask_kind = MASK_OR;
    mask_info.mask = 0x00;
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, byte_mask_transform, &mask_info, 10, 0));
    REQUIRE(5 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("test1.actual.checkpoint.5.dat"),
        omega_io_flags_t::IO_FLG_OVERWRITE, nullptr));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.expected.checkpoint.1.dat"),
        MAKE_PATH("test1.actual.checkpoint.5.dat")));
    mask_info.mask_kind = MASK_AND;
    REQUIRE(0 == omega_edit_apply_transform(session_ptr, byte_mask_transform, &mask_info, 10, 0));
    REQUIRE(6 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(3 == omega_edit_overwrite_string(session_ptr, 0,
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"));
    REQUIRE(3 == omega_session_get_num_changes(session_ptr));
    REQUIRE(3 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("test1.actual.checkpoint.6.dat"),
        omega_io_flags_t::IO_FLG_OVERWRITE, nullptr));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.expected.checkpoint.6.dat"),
        MAKE_PATH("test1.actual.checkpoint.6.dat")));
    auto change_ptr = omega_session_get_last_change(session_ptr);
    REQUIRE(change_ptr);
    REQUIRE(3 == omega_change_get_serial(change_ptr));
    REQUIRE(4 == omega_edit_insert_string(session_ptr, 0, "12345"));
    REQUIRE(5 == omega_edit_delete(session_ptr, 0, 5));
    REQUIRE(5 == omega_session_get_num_changes(session_ptr));
    REQUIRE(5 == omega_session_get_num_change_transactions(session_ptr));
    change_ptr = omega_session_get_last_change(session_ptr);
    REQUIRE(5 == omega_change_get_serial(change_ptr));
    REQUIRE(0 == omega_edit_destroy_last_checkpoint(session_ptr));
    REQUIRE(5 == omega_session_get_num_checkpoints(session_ptr));
    REQUIRE(2 == omega_session_get_num_changes(session_ptr));
    REQUIRE(2 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(nullptr == omega_session_get_last_change(session_ptr));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("test1.actual.checkpoint.7.dat"),
        omega_io_flags_t::IO_FLG_OVERWRITE, nullptr));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.expected.checkpoint.1.dat"),
        MAKE_PATH("test1.actual.checkpoint.7.dat")));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Empty Session File Tests", "[EmptySessionFileTests]") {
    file_info_t file_info;
    file_info.num_changes = 0;
    const std::string in_filename_str(MAKE_PATH("empty_file.dat"));
    const auto in_filename = in_filename_str.c_str();
    auto file_size = omega_util_file_size(in_filename);
    REQUIRE(0 == file_size);
    REQUIRE(!getenv("OMEGA_EDIT_CHECKPOINT_DIRECTORY"));// make sure this environment variable is not set
    const auto session_ptr = omega_edit_create_session(in_filename, session_change_cbk, &file_info,
                                                       SESSION_EVT_EDIT | SESSION_EVT_UNDO, nullptr);
    REQUIRE(session_ptr);
    REQUIRE_THAT(omega_session_get_file_path(session_ptr), Equals(in_filename));

    REQUIRE(omega_util_paths_equivalent(omega_session_get_checkpoint_directory(session_ptr),
                omega_util_dirname(in_filename, nullptr))

            );
    REQUIRE(omega_session_get_computed_file_size(session_ptr) == file_size);
    REQUIRE(0 == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(0 == omega_edit_undo_last_change(session_ptr));
    auto change_serial =
            omega_edit_insert_bytes(session_ptr, 0, reinterpret_cast<const omega_byte_t *>("1234567890"), 0);
    REQUIRE(0 < change_serial);
    REQUIRE(1 == omega_session_get_num_change_transactions(session_ptr));
    file_size += 10;
    REQUIRE(file_size == omega_session_get_computed_file_size(session_ptr));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_session_get_num_undone_change_transactions(session_ptr));
    REQUIRE((change_serial * -1) == omega_edit_undo_last_change(session_ptr));
    REQUIRE(0 == omega_session_get_num_changes(session_ptr));
    REQUIRE(1 == omega_session_get_num_undone_change_transactions(session_ptr));
    REQUIRE(0 == omega_session_get_computed_file_size(session_ptr));
    change_serial = omega_edit_overwrite_string(session_ptr, 0, "abcdefghhijklmnopqrstuvwxyz");
    REQUIRE(0 < change_serial);
    REQUIRE(0 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(0 == omega_session_get_num_undone_change_transactions(session_ptr));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(1 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(27 == omega_session_get_computed_file_size(session_ptr));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Session Save", "[SessionSaveTests]") {
    char saved_filename[FILENAME_MAX];
    int session_events_count = 0;
    int viewport_events_count = 0;
    auto session_ptr = omega_edit_create_session(nullptr, session_save_test_session_cbk, &session_events_count,
                                                 ALL_EVENTS, nullptr);
    REQUIRE(1 == session_events_count);// SESSION_EVT_CREATE
    auto viewport_ptr = omega_edit_create_viewport(session_ptr, 0, 100, 0, session_save_test_viewport_cbk,
                                                   &viewport_events_count, ALL_EVENTS);

    REQUIRE(0 == omega_viewport_get_following_byte_count(viewport_ptr));
    REQUIRE(2 == session_events_count);// SESSION_EVT_CREATE_VIEWPORT
    REQUIRE(1 == viewport_events_count);// VIEWPORT_EVT_CREATE
    omega_edit_insert_string(session_ptr, 0, "0123456789");
    REQUIRE(3 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(2 == viewport_events_count);// VIEWPORT_EVT_EDIT
    omega_util_remove_file(MAKE_PATH("session_save.1.dat"));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("session_save.1.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        saved_filename));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("session_save.1.dat"), saved_filename));
    REQUIRE(0 == omega_edit_save_segment(session_ptr, MAKE_PATH("session_save_seg.1.dat"),
        omega_io_flags_t::IO_FLG_OVERWRITE, saved_filename, 1, 0));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("session_save_seg.expected.1.dat"),
        MAKE_PATH("session_save_seg.1.dat")));
    omega_util_remove_file(MAKE_PATH("session_save_seg.1.dat"));
    REQUIRE(0 == omega_edit_save_segment(session_ptr, MAKE_PATH("session_save_seg.2.dat"),
        omega_io_flags_t::IO_FLG_OVERWRITE, saved_filename, 0, 4));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("session_save_seg.expected.2.dat"),
        MAKE_PATH("session_save_seg.2.dat")));
    omega_util_remove_file(MAKE_PATH("session_save_seg.2.dat"));
    REQUIRE(0 == omega_edit_save_segment(session_ptr, MAKE_PATH("session_save_seg.3.dat"),
        omega_io_flags_t::IO_FLG_OVERWRITE, saved_filename, 2, 6));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("session_save_seg.expected.3.dat"),
        MAKE_PATH("session_save_seg.3.dat")));
    omega_util_remove_file(MAKE_PATH("session_save_seg.3.dat"));
    REQUIRE(7 == session_events_count);// SESSION_EVT_SAVE
    REQUIRE(2 == viewport_events_count);// no additional viewport events
    omega_edit_destroy_session(session_ptr);
    session_events_count = 0;
    viewport_events_count = 0;
    session_ptr = omega_edit_create_session(MAKE_PATH("session_save.1.dat"), session_save_test_session_cbk,
                                            &session_events_count, ALL_EVENTS, nullptr);
    REQUIRE(1 == session_events_count);
    viewport_ptr = omega_edit_create_viewport(session_ptr, 0, 100, 0, session_save_test_viewport_cbk,
                                              &viewport_events_count, ALL_EVENTS);
    REQUIRE(2 == session_events_count);
    REQUIRE(1 == viewport_events_count);
    REQUIRE(0 == omega_viewport_get_following_byte_count(viewport_ptr));
    omega_edit_insert_string(session_ptr, omega_session_get_computed_file_size(session_ptr),
                             "abcdefghijklmnopqrstuvwxyz");
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(3 == session_events_count);
    REQUIRE(2 == viewport_events_count);
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("session_save.1.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        saved_filename));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("session_save.1.dat"), saved_filename));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("session_save.expected.1.dat"), MAKE_PATH("session_save.1.dat")));
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(4 == session_events_count);// SESSION_EVT_SAVE
    REQUIRE(2 == viewport_events_count);// no additional viewport events
    omega_edit_insert_string(session_ptr, omega_session_get_computed_file_size(session_ptr),
                             "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    REQUIRE(2 == omega_session_get_num_changes(session_ptr));
    omega_util_remove_file(MAKE_PATH("session_save.1-1.dat"));
    REQUIRE(5 == session_events_count);// SESSION_EVT_SAVE
    REQUIRE(3 == viewport_events_count);// VIEWPORT_EVT_EDIT
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("session_save.1.dat"), omega_io_flags_t::IO_FLG_NONE,
        saved_filename));
    REQUIRE(6 == session_events_count);// SESSION_EVT_SAVE
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("session_save.1-1.dat"), saved_filename));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("session_save.expected.2.dat"), MAKE_PATH("session_save.1-1.dat")));
    omega_util_remove_file(MAKE_PATH("session_save.1-2.dat"));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("session_save.1.dat"), omega_io_flags_t::IO_FLG_NONE,
        saved_filename));
    REQUIRE(7 == session_events_count);// SESSION_EVT_SAVE
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("session_save.1-2.dat"), saved_filename));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("session_save.expected.2.dat"), MAKE_PATH("session_save.1-2.dat")));
    omega_util_remove_file(MAKE_PATH("session_save.1-3.dat"));
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("session_save.1.dat"), omega_io_flags_t::IO_FLG_NONE,
        saved_filename));
    REQUIRE(8 == session_events_count);// SESSION_EVT_SAVE
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("session_save.1-3.dat"), saved_filename));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("session_save.expected.2.dat"), MAKE_PATH("session_save.1-3.dat")));
    omega_util_remove_file(MAKE_PATH("session_save_seg.2.dat"));
    REQUIRE(0 == omega_edit_save_segment(session_ptr, MAKE_PATH("session_save_seg.2.dat"),
        omega_io_flags_t::IO_FLG_NONE, saved_filename, 0, 4));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("session_save_seg.expected.2.dat"),
        MAKE_PATH("session_save_seg.2.dat")));
    omega_util_remove_file(MAKE_PATH("session_save_seg.2.dat"));
    omega_util_remove_file(MAKE_PATH("session_save_seg.3.dat"));
    REQUIRE(0 == omega_edit_save_segment(session_ptr, MAKE_PATH("session_save_seg.3.dat"),
        omega_io_flags_t::IO_FLG_NONE, saved_filename, 2, 6));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("session_save_seg.expected.3.dat"),
        MAKE_PATH("session_save_seg.3.dat")));
    omega_util_remove_file(MAKE_PATH("session_save_seg.3.dat"));
    omega_edit_destroy_session(session_ptr);

    // Overwrite and force overwrite tests
    session_ptr = omega_edit_create_session(MAKE_PATH("session_save.1-3.dat"), session_save_test_session_cbk,
                                            &session_events_count, ALL_EVENTS, nullptr);
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("session_save.1-3.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        saved_filename));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("session_save.1-3.dat"), saved_filename));
    // overwrite twice to make sure this doesn't cause any problems
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("session_save.1-3.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        saved_filename));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("session_save.1-3.dat"), saved_filename));
    // simulate a file being modified by another program
    REQUIRE(0 == omega_util_touch(MAKE_PATH("session_save.1-3.dat"), 0));
    // overwrite should fail because the original file has been modified elsewhere
    const auto save_rc = omega_edit_save(session_ptr, MAKE_PATH("session_save.1-3.dat"),
                                         omega_io_flags_t::IO_FLG_OVERWRITE, saved_filename);
#ifdef OMEGA_BUILD_WINDOWS// Windows doesn't always support this
    REQUIRE((ORIGINAL_MODIFIED == save_rc || 0 == save_rc));
    REQUIRE((saved_filename[0] == '\0' || 0 == save_rc));
#else
    REQUIRE(ORIGINAL_MODIFIED == save_rc);
    REQUIRE(saved_filename[0] == '\0');
#endif
    // force overwrite should succeed
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("session_save.1-3.dat"),
        omega_io_flags_t::IO_FLG_FORCE_OVERWRITE, saved_filename));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("session_save.1-3.dat"), saved_filename));
    omega_edit_destroy_session(session_ptr);
    session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(0 == omega_edit_save(session_ptr, MAKE_PATH("session_save.empty.dat"), omega_io_flags_t::IO_FLG_OVERWRITE,
        saved_filename));
    REQUIRE(omega_util_paths_equivalent(MAKE_PATH("session_save.empty.dat"), saved_filename));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("empty_file.dat"), MAKE_PATH("session_save.empty.dat")));
    omega_edit_destroy_session(session_ptr);
}

TEST_CASE("Transactions", "[TransactionTests]") {
    int session_events_count = 0;
    int viewport_events_count = 0;
    auto session_ptr = omega_edit_create_session(nullptr, session_save_test_session_cbk, &session_events_count,
                                                 ALL_EVENTS, nullptr);
    REQUIRE(1 == session_events_count);// SESSION_EVT_CREATE
    auto viewport_ptr = omega_edit_create_viewport(session_ptr, 0, 100, 0, session_save_test_viewport_cbk,
                                                   &viewport_events_count, ALL_EVENTS);
    REQUIRE(2 == session_events_count);// SESSION_EVT_CREATE_VIEWPORT
    REQUIRE(1 == viewport_events_count);// VIEWPORT_EVT_CREATE
    REQUIRE(0 == omega_session_get_transaction_state(session_ptr));
    REQUIRE(0 == omega_viewport_get_following_byte_count(viewport_ptr));
    auto change_id = omega_edit_insert_string(session_ptr, 0, "0123456789");
    auto change_ptr = omega_session_get_change(session_ptr, change_id);
    auto transaction_bit = omega_change_get_transaction_bit(change_ptr);
    REQUIRE(0 == transaction_bit);
    REQUIRE(0 == omega_session_get_transaction_state(session_ptr));
    REQUIRE(3 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(2 == viewport_events_count);// VIEWPORT_EVT_EDIT
    REQUIRE(1 == omega_session_get_num_changes(session_ptr));
    REQUIRE(1 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(0 == omega_session_begin_transaction(session_ptr));
    REQUIRE(1 == omega_session_get_transaction_state(session_ptr));
    change_id = omega_edit_insert_string(session_ptr, 0, "abcdefghijklmnopqrstuvwxyz");
    REQUIRE(2 == omega_session_get_transaction_state(session_ptr));
    REQUIRE(4 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(3 == viewport_events_count);// VIEWPORT_EVT_EDIT
    change_ptr = omega_session_get_change(session_ptr, change_id);
    REQUIRE(transaction_bit != omega_change_get_transaction_bit(change_ptr));
    transaction_bit = omega_change_get_transaction_bit(change_ptr);
    omega_edit_insert_string(session_ptr, 0, "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    REQUIRE(2 == omega_session_get_transaction_state(session_ptr));
    REQUIRE(5 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(4 == viewport_events_count);// VIEWPORT_EVT_EDIT
    REQUIRE(transaction_bit == omega_change_get_transaction_bit(change_ptr));
    REQUIRE(0 == omega_session_end_transaction(session_ptr));
    REQUIRE(3 == omega_session_get_num_changes(session_ptr));
    REQUIRE(2 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(5 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(4 == viewport_events_count);// VIEWPORT_EVT_EDIT
    omega_edit_insert_string(session_ptr, 0, "0123456789");
    REQUIRE(6 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(5 == viewport_events_count);// VIEWPORT_EVT_EDIT
    omega_session_begin_transaction(session_ptr);
    omega_edit_insert_string(session_ptr, 0, "abcdefghijklmnopqrstuvwxyz");
    REQUIRE(7 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(6 == viewport_events_count);// VIEWPORT_EVT_EDIT
    omega_edit_overwrite_string(session_ptr, 0, "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    REQUIRE(8 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(7 == viewport_events_count);// VIEWPORT_EVT_EDIT
    omega_edit_delete(session_ptr, 0, 10);
    REQUIRE(9 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(8 == viewport_events_count);// VIEWPORT_EVT_EDIT
    REQUIRE(0 == omega_session_end_transaction(session_ptr));
    REQUIRE(9 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(8 == viewport_events_count);// VIEWPORT_EVT_EDIT
    REQUIRE(7 == omega_session_get_num_changes(session_ptr));
    REQUIRE(4 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(0 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(-5 == omega_edit_undo_last_change(session_ptr));
    REQUIRE(4 == omega_session_get_num_changes(session_ptr));
    REQUIRE(3 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(3 == omega_session_get_num_change_transactions(session_ptr));
    REQUIRE(1 == omega_session_get_num_undone_change_transactions(session_ptr));
    REQUIRE(12 == session_events_count);// SESSION_EVT_EDIT
    REQUIRE(7 == omega_edit_redo_last_undo(session_ptr));
    REQUIRE(7 == omega_session_get_num_changes(session_ptr));
    REQUIRE(0 == omega_session_get_num_undone_changes(session_ptr));
    REQUIRE(4 == omega_session_get_num_change_transactions(session_ptr));

    // Negative testing
    REQUIRE(0 == omega_session_get_transaction_state(session_ptr));
    REQUIRE(0 != omega_session_end_transaction(session_ptr));
    REQUIRE(0 == omega_session_begin_transaction(session_ptr));
    REQUIRE(1 == omega_session_get_transaction_state(session_ptr));
    REQUIRE(0 != omega_session_begin_transaction(session_ptr));
    REQUIRE(0 == omega_session_end_transaction(session_ptr));
    REQUIRE(0 == omega_session_get_transaction_state(session_ptr));
}
