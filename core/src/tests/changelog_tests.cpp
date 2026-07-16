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
#include "test_harness.hpp"

#include <catch2/catch_test_macros.hpp>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <random>
#include <string>
#include <vector>

namespace {

    struct captured_entry_t {
        omega_changelog_plan_kind_t kind{};
        int64_t offset{};
        int64_t length{};
        std::vector<omega_byte_t> payload{};
        std::string transform_id{};
        std::string options_json{};
        int64_t replacement_length{};
        int64_t computed_file_size_before{};
        int64_t computed_file_size_after{};
    };

    struct captured_summary_t {
        int64_t first{};
        int64_t last{};
        int64_t source_count{};
        std::string before{};
        std::string after{};
    };

    std::string read_content_source_(const omega_changelog_content_source_t &source) {
        std::string result(static_cast<size_t>(source.length), '\0');
        int64_t offset = 0;
        while (offset < source.length) {
            const auto read =
                    source.read(source.context, offset, reinterpret_cast<omega_byte_t *>(result.data()) + offset,
                                std::min<int64_t>(5, source.length - offset));
            if (read <= 0) { return {}; }
            offset += read;
        }
        return result;
    }

    int capture_summary_(const omega_changelog_export_summary_t *summary, void *user_data) {
        auto &captured = *static_cast<captured_summary_t *>(user_data);
        captured.first = summary->resolved_first_change_serial;
        captured.last = summary->resolved_last_change_serial;
        captured.source_count = summary->source_change_count;
        captured.before = read_content_source_(summary->before);
        captured.after = read_content_source_(summary->after);
        return 0;
    }

    int capture_entry_(const omega_changelog_plan_entry_t *entry, void *user_data) {
        auto &entries = *static_cast<std::vector<captured_entry_t> *>(user_data);
        captured_entry_t captured;
        captured.kind = entry->kind;
        captured.offset = entry->offset;
        captured.length = entry->length;
        captured.replacement_length = entry->replacement_length;
        captured.computed_file_size_before = entry->computed_file_size_before;
        captured.computed_file_size_after = entry->computed_file_size_after;
        if (entry->transform_id) { captured.transform_id = entry->transform_id; }
        if (entry->options_json) { captured.options_json = entry->options_json; }
        captured.payload.resize(static_cast<size_t>(entry->payload_length));
        int64_t offset = 0;
        while (offset < entry->payload_length) {
            const auto read = entry->read_payload(entry->payload_context, offset, captured.payload.data() + offset,
                                                  std::min<int64_t>(3, entry->payload_length - offset));
            if (read <= 0) { return -91; }
            offset += read;
        }
        if (entry->payload_length > 0 &&
            entry->read_payload(entry->payload_context, entry->payload_length, captured.payload.data(), 1) != 0) {
            return -92;
        }
        entries.push_back(std::move(captured));
        return 0;
    }

    std::vector<captured_entry_t> export_mode_(const omega_session_t *session, bool optimize, int64_t first = 0,
                                               int64_t last = 0, int64_t max_span_bytes = 0, int prefer_overwrite = 1) {
        omega_changelog_export_options_t options{};
        options.first_change_serial = first;
        options.last_change_serial = last;
        options.max_span_bytes = max_span_bytes;
        options.prefer_overwrite_form = prefer_overwrite;
        std::vector<captured_entry_t> entries;
        REQUIRE(0 ==
                omega_edit_export_changelog(session, &options, optimize ? 1 : 0, nullptr, capture_entry_, &entries));
        return entries;
    }

    std::vector<captured_entry_t> export_range_(const omega_session_t *session, int64_t first = 0, int64_t last = 0,
                                                int64_t max_span_bytes = 0, int prefer_overwrite = 1) {
        return export_mode_(session, true, first, last, max_span_bytes, prefer_overwrite);
    }

    bool replay_(omega_session_t *session, const std::vector<captured_entry_t> &entries) {
        for (const auto &entry : entries) {
            const auto *payload = entry.payload.empty() ? nullptr : entry.payload.data();
            int64_t result = -1;
            switch (entry.kind) {
                case OMEGA_CHANGELOG_PLAN_DELETE:
                    result = omega_edit_delete(session, entry.offset, entry.length);
                    break;
                case OMEGA_CHANGELOG_PLAN_INSERT:
                    result = omega_edit_insert_bytes(session, entry.offset, payload,
                                                     static_cast<int64_t>(entry.payload.size()));
                    break;
                case OMEGA_CHANGELOG_PLAN_OVERWRITE:
                    result = omega_edit_overwrite_bytes(session, entry.offset, payload,
                                                        static_cast<int64_t>(entry.payload.size()));
                    break;
                case OMEGA_CHANGELOG_PLAN_REPLACE:
                    result = omega_edit_replace_bytes(session, entry.offset, entry.length, payload,
                                                      static_cast<int64_t>(entry.payload.size()));
                    break;
                case OMEGA_CHANGELOG_PLAN_TRANSFORM:
                    return false;
            }
            if (result <= 0) { return false; }
        }
        return true;
    }

    omega_test::TestSession from_text_(const std::string &text) {
        return omega_test::TestSession::from_bytes(reinterpret_cast<const omega_byte_t *>(text.data()),
                                                   static_cast<int64_t>(text.size()));
    }

}// namespace

TEST_CASE("coordinate-aware export handles insert order and identity", "[changelog][planner]") {
    auto session = from_text_("0123456789");
    REQUIRE(session);
    REQUIRE(1 == omega_edit_insert(session.get(), 5, "AB", 2));
    REQUIRE(2 == omega_edit_insert(session.get(), 5, "CD", 2));

    const auto entries = export_range_(session.get());
    REQUIRE(entries.size() == 1);
    CHECK(entries[0].kind == OMEGA_CHANGELOG_PLAN_INSERT);
    CHECK(entries[0].offset == 5);
    CHECK(std::string(entries[0].payload.begin(), entries[0].payload.end()) == "CDAB");

    auto replay = from_text_("0123456789");
    REQUIRE(replay_(replay.get(), entries));
    CHECK(omega_test::compare_content(session.get(), replay.get()).equal);
    CHECK(omega_session_get_num_changes(session.get()) == 2);
    const auto fixpoint = export_range_(replay.get());
    REQUIRE(fixpoint.size() == entries.size());
    CHECK(fixpoint[0].kind == entries[0].kind);
    CHECK(fixpoint[0].offset == entries[0].offset);
    CHECK(fixpoint[0].length == entries[0].length);
    CHECK(fixpoint[0].payload == entries[0].payload);

    auto identity = from_text_("base");
    REQUIRE(1 == omega_edit_insert(identity.get(), 0, "abc", 3));
    REQUIRE(2 == omega_edit_delete(identity.get(), 0, 3));
    CHECK(export_range_(identity.get()).empty());
}

TEST_CASE("coordinate-aware export coalesces deletes and replacements", "[changelog][planner]") {
    auto deletes = from_text_("0123456789abcdef");
    REQUIRE(1 == omega_edit_delete(deletes.get(), 5, 3));
    REQUIRE(2 == omega_edit_delete(deletes.get(), 5, 2));
    const auto delete_plan = export_range_(deletes.get());
    REQUIRE(delete_plan.size() == 1);
    CHECK(delete_plan[0].kind == OMEGA_CHANGELOG_PLAN_DELETE);
    CHECK(delete_plan[0].offset == 5);
    CHECK(delete_plan[0].length == 5);
    CHECK(std::string(delete_plan[0].payload.begin(), delete_plan[0].payload.end()) == "56789");

    const auto raw_delete_plan = export_mode_(deletes.get(), false);
    REQUIRE(raw_delete_plan.size() == 2);
    CHECK(raw_delete_plan[0].kind == OMEGA_CHANGELOG_PLAN_DELETE);
    CHECK(std::string(raw_delete_plan[0].payload.begin(), raw_delete_plan[0].payload.end()) == "567");
    CHECK(raw_delete_plan[1].kind == OMEGA_CHANGELOG_PLAN_DELETE);
    CHECK(std::string(raw_delete_plan[1].payload.begin(), raw_delete_plan[1].payload.end()) == "89");

    auto overwrite = from_text_("0123456789");
    REQUIRE(1 == omega_edit_overwrite(overwrite.get(), 4, "xxxx", 4));
    REQUIRE(2 == omega_edit_overwrite(overwrite.get(), 4, "yyyy", 4));
    const auto overwrite_plan = export_range_(overwrite.get());
    REQUIRE(overwrite_plan.size() == 1);
    CHECK(overwrite_plan[0].kind == OMEGA_CHANGELOG_PLAN_OVERWRITE);
    CHECK(overwrite_plan[0].offset == 4);
    CHECK(std::string(overwrite_plan[0].payload.begin(), overwrite_plan[0].payload.end()) == "yyyy");

    auto trimmed = from_text_("abcdefghij");
    REQUIRE(1 == omega_edit_overwrite(trimmed.get(), 2, "cXef", 4));
    REQUIRE(2 == omega_edit_overwrite(trimmed.get(), 8, "Y", 1));
    const auto trimmed_plan = export_range_(trimmed.get());
    REQUIRE(trimmed_plan.size() == 2);
    CHECK(trimmed_plan[0].offset == 3);
    CHECK(trimmed_plan[0].length == 1);
    CHECK(std::string(trimmed_plan[0].payload.begin(), trimmed_plan[0].payload.end()) == "X");
    CHECK(trimmed_plan[1].offset == 8);
    auto trimmed_replay = from_text_("abcdefghij");
    REQUIRE(replay_(trimmed_replay.get(), trimmed_plan));
    CHECK(omega_test::compare_content(trimmed.get(), trimmed_replay.get()).equal);

    auto extending = from_text_("abc");
    REQUIRE(1 == omega_edit_overwrite(extending.get(), 3, "XYZ", 3));
    const auto extending_plan = export_range_(extending.get());
    REQUIRE(extending_plan.size() == 1);
    CHECK(extending_plan[0].kind == OMEGA_CHANGELOG_PLAN_INSERT);
    CHECK(extending_plan[0].offset == 3);
    auto extending_replay = from_text_("abc");
    REQUIRE(replay_(extending_replay.get(), extending_plan));
    CHECK(omega_test::compare_content(extending.get(), extending_replay.get()).equal);
}

TEST_CASE("ranged export reconstructs across plain checkpoints", "[changelog][range]") {
    auto session = from_text_("abc");
    REQUIRE(1 == omega_edit_insert(session.get(), 3, "X", 1));
    REQUIRE(2 == omega_edit_insert(session.get(), 4, "Y", 1));
    REQUIRE(0 == omega_edit_create_checkpoint(session.get()));
    REQUIRE(3 == omega_edit_insert(session.get(), 5, "Z", 1));

    const auto entries = export_range_(session.get(), 2, 3);
    REQUIRE(entries.size() == 2);
    auto replay = from_text_("abc");
    REQUIRE(1 == omega_edit_insert(replay.get(), 3, "X", 1));
    REQUIRE(replay_(replay.get(), entries));
    CHECK(omega_test::compare_content(session.get(), replay.get()).equal);

    const auto one = export_range_(session.get(), 3, 3);
    REQUIRE(one.size() == 1);
    CHECK(one[0].offset == 5);
    CHECK(std::string(one[0].payload.begin(), one[0].payload.end()) == "Z");

    omega_changelog_export_options_t options{};
    options.first_change_serial = 2;
    options.last_change_serial = 3;
    captured_summary_t summary;
    std::vector<captured_entry_t> summarized_entries;
    struct callback_context_t {
        captured_summary_t *summary;
        std::vector<captured_entry_t> *entries;
    } callback_context{&summary, &summarized_entries};
    const auto summary_callback = [](const omega_changelog_export_summary_t *value, void *context) {
        return capture_summary_(value, static_cast<callback_context_t *>(context)->summary);
    };
    const auto entry_callback = [](const omega_changelog_plan_entry_t *value, void *context) {
        return capture_entry_(value, static_cast<callback_context_t *>(context)->entries);
    };
    REQUIRE(omega_edit_export_changelog(session.get(), &options, 1, summary_callback, entry_callback,
                                        &callback_context) == 0);
    CHECK(summary.first == 2);
    CHECK(summary.last == 3);
    CHECK(summary.source_count == 2);
    CHECK(summary.before == "abcX");
    CHECK(summary.after == "abcXYZ");
}

TEST_CASE("transform boundaries are emitted exactly once", "[changelog][range][transform]") {
    auto session = from_text_("abc");
    REQUIRE(1 == omega_edit_insert(session.get(), 3, "X", 1));
    const omega_byte_t transformed[] = {'Q', 'R'};
    REQUIRE(2 == omega_edit_replace_bytes_as_transform(session.get(), 1, 2, transformed, 2, "omega.test", "{\"x\":1}"));
    REQUIRE(3 == omega_edit_insert(session.get(), 4, "Z", 1));

    for (const auto optimize : {false, true}) {
        const auto crossing = export_mode_(session.get(), optimize, 2, 3);
        REQUIRE(crossing.size() == 2);
        CHECK(crossing[0].kind == OMEGA_CHANGELOG_PLAN_TRANSFORM);
        CHECK(crossing[0].offset == 1);
        CHECK(crossing[0].length == 2);
        CHECK(crossing[0].transform_id == "omega.test");
        CHECK(crossing[0].options_json == "{\"x\":1}");
        CHECK(crossing[0].replacement_length == 2);
        CHECK(crossing[0].computed_file_size_before == 4);
        CHECK(crossing[0].computed_file_size_after == 4);
        CHECK(crossing[1].kind == OMEGA_CHANGELOG_PLAN_INSERT);
    }

    const auto after = export_range_(session.get(), 3, 3);
    REQUIRE(after.size() == 1);
    CHECK(after[0].kind == OMEGA_CHANGELOG_PLAN_INSERT);
}

TEST_CASE("whole-range transform exports its effective replay range",
          "[BrutalCoverage][changelog][transform][replay]") {
    auto session = from_text_("abc");
    const omega_edit_transform_t upper_transform{OMEGA_EDIT_TRANSFORM_ASCII_TO_UPPER, 0};
    REQUIRE(0 == omega_edit_apply_builtin_transform(session.get(), upper_transform, 0, 0));

    for (const auto optimize : {false, true}) {
        const auto entries = export_mode_(session.get(), optimize);
        REQUIRE(entries.size() == 1);
        CHECK(entries[0].kind == OMEGA_CHANGELOG_PLAN_TRANSFORM);
        CHECK(entries[0].offset == 0);
        CHECK(entries[0].length == 3);
        CHECK(entries[0].replacement_length == 3);
        CHECK(entries[0].computed_file_size_before == 3);
        CHECK(entries[0].computed_file_size_after == 3);
    }
}

TEST_CASE("limits fail before callbacks and tiny spans stay correct", "[changelog][limits]") {
    auto session = from_text_("0123456789");
    REQUIRE(1 == omega_edit_overwrite(session.get(), 2, "AA", 2));
    REQUIRE(2 == omega_edit_overwrite(session.get(), 2, "BB", 2));
    REQUIRE(3 == omega_edit_overwrite(session.get(), 8, "C", 1));

    omega_changelog_export_options_t options{};
    options.max_entries = 0;
    std::vector<captured_entry_t> baseline;
    REQUIRE(0 == omega_edit_export_changelog_optimized(session.get(), &options, capture_entry_, &baseline));
    REQUIRE(baseline.size() == 2);

    options.max_entries = static_cast<int64_t>(baseline.size()) - 1;
    std::vector<captured_entry_t> rejected;
    CHECK(-2 == omega_edit_export_changelog_optimized(session.get(), &options, capture_entry_, &rejected));
    CHECK(rejected.empty());

    const auto split = export_range_(session.get(), 0, 0, 1);
    auto replay = from_text_("0123456789");
    REQUIRE(replay_(replay.get(), split));
    CHECK(omega_test::compare_content(session.get(), replay.get()).equal);
}

TEST_CASE("deterministic differential scripts replay byte-identically", "[changelog][fuzz]") {
    constexpr int SEEDS = 64;
    constexpr int OPERATIONS = 120;
    for (int seed = 0; seed < SEEDS; ++seed) {
        INFO("seed=" << seed);
        std::mt19937 random(static_cast<uint32_t>(0xC0FFEE + seed));
        std::string base(32, '\0');
        for (auto &byte : base) { byte = static_cast<char>(random() & 0xFFU); }
        auto source = from_text_(base);
        for (int operation = 0; operation < OPERATIONS; ++operation) {
            const auto size = omega_session_get_computed_file_size(source.get());
            const auto kind = random() % 3;
            if (kind == 0 || size == 0) {
                const auto length = static_cast<int64_t>(1 + random() % 4);
                std::vector<omega_byte_t> payload(static_cast<size_t>(length));
                for (auto &byte : payload) { byte = static_cast<omega_byte_t>(random() & 0xFFU); }
                REQUIRE(omega_edit_insert_bytes(source.get(), static_cast<int64_t>(random() % (size + 1)),
                                                payload.data(), length) > 0);
            } else if (kind == 1) {
                const auto offset = static_cast<int64_t>(random() % size);
                const auto length = std::min<int64_t>(1 + random() % 4, size - offset);
                REQUIRE(omega_edit_delete(source.get(), offset, length) > 0);
            } else {
                const auto offset = static_cast<int64_t>(random() % size);
                const auto length = std::min<int64_t>(1 + random() % 4, size - offset);
                std::vector<omega_byte_t> payload(static_cast<size_t>(length));
                for (auto &byte : payload) { byte = static_cast<omega_byte_t>(random() & 0xFFU); }
                REQUIRE(omega_edit_overwrite_bytes(source.get(), offset, payload.data(), length) > 0);
            }
            if (operation == 39 || operation == 79) { REQUIRE(omega_edit_create_checkpoint(source.get()) == 0); }
        }

        const auto raw = export_mode_(source.get(), false);
        const auto optimized = export_mode_(source.get(), true);
        const auto repeated = export_mode_(source.get(), true);
        CHECK(optimized.size() <= raw.size());
        REQUIRE(optimized.size() == repeated.size());
        for (size_t index = 0; index < optimized.size(); ++index) {
            CHECK(optimized[index].kind == repeated[index].kind);
            CHECK(optimized[index].offset == repeated[index].offset);
            CHECK(optimized[index].length == repeated[index].length);
            CHECK(optimized[index].payload == repeated[index].payload);
        }
        auto replay = from_text_(base);
        REQUIRE(replay_(replay.get(), optimized));
        const auto comparison = omega_test::compare_content(source.get(), replay.get());
        INFO("first difference=" << comparison.first_diff_offset);
        CHECK(comparison.equal);
        CHECK(omega_test::model_valid(source.get()));
        CHECK(omega_test::model_valid(replay.get()));

        auto raw_replay = from_text_(base);
        REQUIRE(replay_(raw_replay.get(), raw));
        const auto raw_comparison = omega_test::compare_content(source.get(), raw_replay.get());
        INFO("raw first difference=" << raw_comparison.first_diff_offset);
        CHECK(raw_comparison.equal);
        CHECK(omega_test::compare_content(raw_replay.get(), replay.get()).equal);
        CHECK(omega_test::model_valid(raw_replay.get()));
    }
}

TEST_CASE("100k typing edits plan within the production gate", "[changelog][.benchmark]") {
    constexpr int64_t OPERATION_COUNT = 100000;
    auto session = from_text_("");
    REQUIRE(session);
    for (int64_t operation = 0; operation < OPERATION_COUNT; ++operation) {
        const omega_byte_t byte = static_cast<omega_byte_t>('a' + operation % 26);
        REQUIRE(omega_edit_insert_bytes(session.get(), operation, &byte, 1) > 0);
    }

    omega_changelog_export_options_t options{};
    options.prefer_overwrite_form = 1;
    int64_t entry_count = 0;
    const auto count_entry = [](const omega_changelog_plan_entry_t *, void *context) {
        ++*static_cast<int64_t *>(context);
        return 0;
    };
    const auto started = std::chrono::steady_clock::now();
    REQUIRE(omega_edit_export_changelog(session.get(), &options, 1, nullptr, count_entry, &entry_count) == 0);
    const auto elapsed =
            std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started);

    std::cout << "{\"scenario\":\"100k-typing-optimized-plan\",\"operations\":" << OPERATION_COUNT
              << ",\"entries\":" << entry_count << ",\"durationMilliseconds\":" << elapsed.count() << "}\n";
    CHECK(elapsed < std::chrono::seconds(1));
}
