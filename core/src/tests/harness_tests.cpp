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

/**
 * Self-tests for the shared brutal-testing harness (test_harness.hpp). These prove each oracle
 * catches what it must, using only known-good core behavior — if the harness itself is lax, every
 * suite built on it inherits the weakness.
 */

#include "omega_edit.h"
#include "omega_edit/stl_string_adaptor.hpp"

#include "test_harness.hpp"

#include <catch2/catch_test_macros.hpp>

#include <string>

using namespace omega_test;

namespace {
    std::string session_content(const omega_session_t *session_ptr) { return content_string(session_ptr); }
}// namespace

TEST_CASE("Harness: content oracles agree and pinpoint divergence", "[Harness][ContentOracle]") {
    TestSession session_a;
    TestSession session_b;
    REQUIRE(session_a);
    REQUIRE(session_b);

    SECTION("empty sessions are equal and hash alike") {
        const auto compare = compare_content(session_a.get(), session_b.get());
        REQUIRE(compare.equal);
        REQUIRE(compare.first_diff_offset == -1);
        REQUIRE(content_hash(session_a.get()) == content_hash(session_b.get()));
    }

    SECTION("identical edit scripts produce equal content") {
        for (auto *session : {session_a.get(), session_b.get()}) {
            REQUIRE(0 < omega_edit_insert_string(session, 0, "the quick brown fox"));
            REQUIRE(0 < omega_edit_overwrite_string(session, 4, "QUICK"));
            REQUIRE(0 < omega_edit_delete(session, 0, 4));
        }
        const auto compare = compare_content(session_a.get(), session_b.get());
        REQUIRE(compare.equal);
        REQUIRE(content_hash(session_a.get()) == content_hash(session_b.get()));
        REQUIRE(session_content(session_a.get()) == "QUICK brown fox");
    }

    SECTION("a single divergent byte is caught at the exact offset") {
        REQUIRE(0 < omega_edit_insert_string(session_a.get(), 0, "0123456789"));
        REQUIRE(0 < omega_edit_insert_string(session_b.get(), 0, "0123456789"));
        REQUIRE(0 < omega_edit_overwrite_string(session_b.get(), 7, "X"));

        const auto compare = compare_content(session_a.get(), session_b.get());
        REQUIRE_FALSE(compare.equal);
        REQUIRE(compare.first_diff_offset == 7);
        REQUIRE(content_hash(session_a.get()) != content_hash(session_b.get()));
    }

    SECTION("size mismatch is unequal without a byte diff") {
        REQUIRE(0 < omega_edit_insert_string(session_a.get(), 0, "abc"));
        REQUIRE(0 < omega_edit_insert_string(session_b.get(), 0, "abcd"));
        const auto compare = compare_content(session_a.get(), session_b.get());
        REQUIRE_FALSE(compare.equal);
        REQUIRE(compare.size_a == 3);
        REQUIRE(compare.size_b == 4);
        REQUIRE(compare.first_diff_offset == -1);
    }
}

TEST_CASE("Harness: content oracles stream beyond a single chunk", "[Harness][ContentOracle]") {
    // Content larger than HARNESS_CHUNK_SIZE forces the streamed (multi-segment) code paths.
    const std::string block(HARNESS_CHUNK_SIZE / 4, 'A');
    TestSession session_a;
    TestSession session_b;
    for (int i = 0; i < 6; ++i) {
        REQUIRE(0 < omega_edit_insert_string(session_a.get(), 0, block));
        REQUIRE(0 < omega_edit_insert_string(session_b.get(), 0, block));
    }
    REQUIRE(omega_session_get_computed_file_size(session_a.get()) > HARNESS_CHUNK_SIZE);
    REQUIRE(compare_content(session_a.get(), session_b.get()).equal);

    // Flip one byte deep in the second chunk and require exact localization.
    const int64_t poke_offset = HARNESS_CHUNK_SIZE + 42;
    REQUIRE(0 < omega_edit_overwrite_string(session_b.get(), poke_offset, "z"));
    const auto compare = compare_content(session_a.get(), session_b.get());
    REQUIRE_FALSE(compare.equal);
    REQUIRE(compare.first_diff_offset == poke_offset);
}

TEST_CASE("Harness: model validity and serial contiguity", "[Harness][ModelOracle][SerialOracle]") {
    TestSession session;
    REQUIRE(session);
    REQUIRE(model_valid(session.get()));

    REQUIRE(0 < omega_edit_insert_string(session.get(), 0, "serial test payload"));
    REQUIRE(0 < omega_edit_overwrite_string(session.get(), 0, "SERIAL"));
    REQUIRE(0 < omega_edit_delete(session.get(), 6, 5));
    REQUIRE(model_valid(session.get()));

    auto serials = check_serials_contiguous(session.get());
    REQUIRE(serials.contiguous);
    REQUIRE(serials.num_changes == 3);

    SECTION("contiguity holds through undo and redo") {
        REQUIRE(0 > omega_edit_undo_last_change(session.get()));
        serials = check_serials_contiguous(session.get());
        REQUIRE(serials.contiguous);
        REQUIRE(serials.num_changes == 2);

        REQUIRE(0 < omega_edit_redo_last_undo(session.get()));
        serials = check_serials_contiguous(session.get());
        REQUIRE(serials.contiguous);
        REQUIRE(serials.num_changes == 3);
        REQUIRE(model_valid(session.get()));
    }
}

TEST_CASE("Harness: undo/redo trajectory oracle round-trips", "[Harness][UndoOracle]") {
    SECTION("empty session is a trivial trajectory") {
        TestSession session;
        const auto result = verify_undo_redo_round_trip(session.get());
        REQUIRE(result.ok);
        REQUIRE(result.undo_steps == 0);
        REQUIRE(result.trajectory.size() == 1);
        REQUIRE(result.model_valid_throughout);
    }

    SECTION("scripted edits, including a transaction, round-trip bit-exact") {
        TestSession session;
        REQUIRE(0 < omega_edit_insert_string(session.get(), 0, "hello world"));
        REQUIRE(0 < omega_edit_overwrite_string(session.get(), 0, "HELLO"));
        // replace runs delete+insert inside one transaction: one undo step, one redo step
        REQUIRE(0 < omega_edit_replace(session.get(), 6, 5, "OMEGA", 5));
        REQUIRE(0 < omega_edit_delete(session.get(), 5, 1));

        const auto tip_content = session_content(session.get());
        const auto tip_changes = omega_session_get_num_changes(session.get());

        const auto result = verify_undo_redo_round_trip(session.get());
        REQUIRE(result.ok);
        REQUIRE(result.mismatch_step == -1);
        REQUIRE(result.model_valid_throughout);
        REQUIRE(result.undo_steps == 4);// insert, overwrite, replace-transaction, delete
        REQUIRE(result.trajectory.size() == 5);

        // The oracle must leave the session exactly at the tip.
        REQUIRE(session_content(session.get()) == tip_content);
        REQUIRE(omega_session_get_num_changes(session.get()) == tip_changes);
    }

    SECTION("round-trip holds under every snapshot-interval brutality knob") {
        for (const int64_t interval : {int64_t{0}, int64_t{1}, int64_t{7}}) {
            TestSession session;
            omega_session_set_undo_snapshot_interval(session.get(), interval);
            for (int i = 0; i < 25; ++i) {
                REQUIRE(0 < omega_edit_insert_string(session.get(), i, std::string(1, 'a' + (i % 26))));
            }
            REQUIRE(0 < omega_edit_delete(session.get(), 5, 10));
            const auto result = verify_undo_redo_round_trip(session.get());
            INFO("snapshot interval " << interval);
            REQUIRE(result.ok);
            REQUIRE(result.model_valid_throughout);
        }
    }

    SECTION("round-trip crosses a builtin transform checkpoint boundary") {
        TestSession session;
        REQUIRE(0 < omega_edit_insert_string(session.get(), 0, "mixed Case content"));
        REQUIRE(0 < omega_edit_overwrite_string(session.get(), 6, "CASE"));
        const omega_edit_transform_t to_upper{OMEGA_EDIT_TRANSFORM_ASCII_TO_UPPER, 0};
        REQUIRE(0 == omega_edit_apply_builtin_transform(session.get(), to_upper, 0, 5));
        REQUIRE(0 < omega_edit_overwrite_string(session.get(), 6, "case"));
        REQUIRE(session_content(session.get()) == "MIXED case content");

        const auto result = verify_undo_redo_round_trip(session.get());
        REQUIRE(result.ok);
        REQUIRE(result.mismatch_step == -1);
        REQUIRE(result.model_valid_throughout);
        REQUIRE(result.undo_steps == 4);// post-transform overwrite, transform checkpoint, overwrite, insert
        REQUIRE(session_content(session.get()) == "MIXED case content");
    }
}

TEST_CASE("Harness: undo past a transform preserves later redo state", "[Harness][UndoOracle][Transform]") {
    TestSession session;
    REQUIRE(0 < omega_edit_insert_string(session.get(), 0, "abc"));
    const omega_edit_transform_t to_upper{OMEGA_EDIT_TRANSFORM_ASCII_TO_UPPER, 0};
    REQUIRE(0 == omega_edit_apply_builtin_transform(session.get(), to_upper, 0, 0));
    REQUIRE(0 < omega_edit_overwrite_string(session.get(), 0, "X"));
    REQUIRE(session_content(session.get()) == "XBC");

    REQUIRE(0 > omega_edit_undo_last_change(session.get()));// undo overwrite
    REQUIRE(0 > omega_edit_undo_last_change(session.get()));// undo transform
    REQUIRE(session_content(session.get()) == "abc");

    REQUIRE(0 < omega_edit_redo_last_undo(session.get()));// redo transform
    REQUIRE(session_content(session.get()) == "ABC");
    REQUIRE(0 < omega_edit_redo_last_undo(session.get()));// redo overwrite
    REQUIRE(session_content(session.get()) == "XBC");
    REQUIRE(omega_session_get_num_changes(session.get()) == 3);
    REQUIRE(model_valid(session.get()));
}

TEST_CASE("Harness: event recorder captures exact sequences", "[Harness][EventOracle]") {
    TestSession session;
    REQUIRE(session);
    REQUIRE(session.events().count(SESSION_EVT_CREATE) == 1);
    session.events().clear();

    SECTION("plain edits emit one EDIT each, with serials") {
        REQUIRE(0 < omega_edit_insert_string(session.get(), 0, "one"));
        REQUIRE(0 < omega_edit_insert_string(session.get(), 3, "two"));
        REQUIRE(0 < omega_edit_insert_string(session.get(), 6, "three"));
        REQUIRE(session.events().count(SESSION_EVT_EDIT) == 3);
        REQUIRE(session.events().events()[0].serial == 1);
        REQUIRE(session.events().events()[2].serial == 3);
    }

    SECTION("undo and redo emit UNDO and EDIT") {
        REQUIRE(0 < omega_edit_insert_string(session.get(), 0, "payload"));
        session.events().clear();
        REQUIRE(0 > omega_edit_undo_last_change(session.get()));
        REQUIRE(session.events().count(SESSION_EVT_UNDO) == 1);
        REQUIRE(session.events().events().front().serial == -1);
        REQUIRE(0 < omega_edit_redo_last_undo(session.get()));
        REQUIRE(session.events().count(SESSION_EVT_EDIT) == 1);
    }

    SECTION("transactions bracket batched edits") {
        static const omega_byte_t text[] = "batched";
        const omega_edit_script_op_t ops[] = {
                {0, 0, OMEGA_EDIT_SCRIPT_INSERT, text, 7},
                {0, 3, OMEGA_EDIT_SCRIPT_DELETE, nullptr, 0},
        };
        REQUIRE(0 == omega_edit_apply_script(session.get(), ops, 2));
        REQUIRE(session.events().count(SESSION_EVT_TRANSACTION_STARTED) == 1);
        REQUIRE(session.events().count(SESSION_EVT_TRANSACTION_ENDED) == 1);
        REQUIRE(session.events().count(SESSION_EVT_EDIT) >= 1);
    }

    SECTION("builtin transforms emit checkpoint and transform events, never EDIT") {
        REQUIRE(0 < omega_edit_insert_string(session.get(), 0, "abcdef"));
        session.events().clear();
        const omega_edit_transform_t to_upper{OMEGA_EDIT_TRANSFORM_ASCII_TO_UPPER, 0};
        REQUIRE(0 == omega_edit_apply_builtin_transform(session.get(), to_upper, 0, 0));
        REQUIRE(session.events().count(SESSION_EVT_CREATE_CHECKPOINT) == 1);
        REQUIRE(session.events().count(SESSION_EVT_TRANSFORM) == 1);
        REQUIRE(session.events().count(SESSION_EVT_EDIT) == 0);
    }
}

TEST_CASE("Harness: checkpoint directory audit polices file hygiene", "[Harness][HygieneOracle]") {
    const ScratchDir scratch;
    DirAudit audit(scratch.str());
    REQUIRE(audit.unchanged());

    static const omega_byte_t seed[] = "0123456789ABCDEF0123456789ABCDEF";
    {
        auto session = TestSession::from_bytes(seed, sizeof(seed) - 1, scratch.c_str());
        REQUIRE(session);
        // Force the file-backed payload path on a small delete: limit 4, delete 16 bytes.
        session.make_brutal(4, 1);

        // The memory-backed session snapshot lives in the checkpoint directory.
        REQUIRE_FALSE(audit.added().empty());

        const auto before_delete = DirAudit::list(scratch.str());
        REQUIRE(0 < omega_edit_delete(session.get(), 0, 16));
        const auto after_delete = DirAudit::list(scratch.str());
        REQUIRE(after_delete.size() == before_delete.size() + 1);// captured payload file appeared

        // Undo keeps the payload file alive (it backs the redo state), redo keeps it referenced.
        REQUIRE(0 > omega_edit_undo_last_change(session.get()));
        REQUIRE(DirAudit::list(scratch.str()).size() == after_delete.size());
        REQUIRE(0 < omega_edit_redo_last_undo(session.get()));
        REQUIRE(session_content(session.get()) == "0123456789ABCDEF");
        REQUIRE(model_valid(session.get()));
    }
    // Destroying the session must return the directory to its exact baseline: no leaked
    // snapshot, checkpoint, or payload files.
    REQUIRE(audit.added().empty());
    REQUIRE(audit.removed().empty());
    REQUIRE(audit.unchanged());
}

TEST_CASE("Harness: brutal payload knob exercises file-backed undo data end to end",
          "[Harness][HygieneOracle][UndoOracle]") {
    const ScratchDir scratch;
    DirAudit audit(scratch.str());
    {
        TestSession session(nullptr, scratch.c_str());
        REQUIRE(session);
        session.make_brutal(8, 1);

        REQUIRE(0 < omega_edit_insert_string(session.get(), 0, "the five boxing wizards jump quickly"));
        REQUIRE(0 < omega_edit_overwrite_string(session.get(), 4, "FIVE BOXING WIZARDS"));// > 8 bytes captured
        REQUIRE(0 < omega_edit_delete(session.get(), 0, 24));                             // > 8 bytes captured

        const auto result = verify_undo_redo_round_trip(session.get());
        REQUIRE(result.ok);
        REQUIRE(result.model_valid_throughout);
        REQUIRE(session_content(session.get()) == "jump quickly");
    }
    REQUIRE(audit.unchanged());
}
