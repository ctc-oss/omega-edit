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
 * @file differential_fuzz_tests.cpp
 * @brief Section 10.3 differential fuzz driver built on the shared core test harness.
 */

#include "omega_edit.h"
#include "omega_edit/stl_string_adaptor.hpp"

#include "test_harness.hpp"

#include <catch2/catch_test_macros.hpp>

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <limits>
#include <random>
#include <sstream>
#include <string>
#include <vector>

using omega_test::check_serials_contiguous;
using omega_test::compare_content;
using omega_test::model_valid;
using omega_test::ScratchDir;
using omega_test::TestSession;
using omega_test::verify_undo_redo_round_trip;

namespace {
    enum class fuzz_profile_t { typing, bulk, adversarial };

    enum class fuzz_op_kind_t {
        insert,
        delete_bytes,
        overwrite,
        replace,
        undo_burst,
        redo_burst,
        begin_transaction,
        end_transaction,
        transform,
        create_checkpoint,
        destroy_checkpoint,
        save_probe,
        viewport_probe
    };

    struct fuzz_op_t {
        fuzz_op_kind_t kind{};
        int64_t offset{};
        int64_t length{};
        int64_t count{};
        omega_edit_transform_t transform{OMEGA_EDIT_TRANSFORM_ASCII_TO_UPPER, 0};
        std::vector<omega_byte_t> bytes;
    };

    struct fuzz_script_t {
        uint64_t seed{};
        fuzz_profile_t profile{fuzz_profile_t::typing};
        std::vector<omega_byte_t> base;
        std::vector<fuzz_op_t> ops;
    };

    struct fuzz_run_result_t {
        bool ok{true};
        size_t step{};
        std::string message;
    };

    const char *profile_name(fuzz_profile_t profile) {
        switch (profile) {
            case fuzz_profile_t::typing:
                return "typing";
            case fuzz_profile_t::bulk:
                return "bulk";
            case fuzz_profile_t::adversarial:
                return "adversarial";
        }
        return "unknown";
    }

    fuzz_profile_t profile_from_name(const std::string &name) {
        if (name == "bulk") { return fuzz_profile_t::bulk; }
        if (name == "adversarial") { return fuzz_profile_t::adversarial; }
        return fuzz_profile_t::typing;
    }

    const char *op_name(fuzz_op_kind_t kind) {
        switch (kind) {
            case fuzz_op_kind_t::insert:
                return "insert";
            case fuzz_op_kind_t::delete_bytes:
                return "delete";
            case fuzz_op_kind_t::overwrite:
                return "overwrite";
            case fuzz_op_kind_t::replace:
                return "replace";
            case fuzz_op_kind_t::undo_burst:
                return "undo";
            case fuzz_op_kind_t::redo_burst:
                return "redo";
            case fuzz_op_kind_t::begin_transaction:
                return "begin_transaction";
            case fuzz_op_kind_t::end_transaction:
                return "end_transaction";
            case fuzz_op_kind_t::transform:
                return "transform";
            case fuzz_op_kind_t::create_checkpoint:
                return "create_checkpoint";
            case fuzz_op_kind_t::destroy_checkpoint:
                return "destroy_checkpoint";
            case fuzz_op_kind_t::save_probe:
                return "save_probe";
            case fuzz_op_kind_t::viewport_probe:
                return "viewport_probe";
        }
        return "unknown";
    }

    uint64_t parse_u64(const char *value, uint64_t fallback) {
        if (!value || !*value) { return fallback; }
        errno = 0;
        char *end = nullptr;
        const auto parsed = std::strtoull(value, &end, 0);
        return errno == 0 && end && *end == '\0' ? static_cast<uint64_t>(parsed) : fallback;
    }

    int64_t parse_i64(const char *value, int64_t fallback, int64_t min_value, int64_t max_value) {
        if (!value || !*value) { return fallback; }
        errno = 0;
        char *end = nullptr;
        const auto parsed = std::strtoll(value, &end, 0);
        if (errno != 0 || !end || *end != '\0') { return fallback; }
        return std::max(min_value, std::min<int64_t>(parsed, max_value));
    }

    int64_t random_i64(std::mt19937_64 &rng, int64_t min_value, int64_t max_value) {
        if (max_value <= min_value) { return min_value; }
        std::uniform_int_distribution<int64_t> dist(min_value, max_value);
        return dist(rng);
    }

    bool chance(std::mt19937_64 &rng, int percent) { return random_i64(rng, 1, 100) <= percent; }

    int64_t clamp_offset(int64_t value, int64_t max_value) {
        if (max_value <= 0) { return 0; }
        return std::max<int64_t>(0, std::min(value, max_value));
    }

    int64_t choose_offset(std::mt19937_64 &rng, int64_t size, bool allow_eof, fuzz_profile_t profile, int64_t cursor,
                          int64_t hot_spot) {
        const auto max_offset = allow_eof ? size : size - 1;
        if (max_offset <= 0) { return 0; }

        const auto mode = random_i64(rng, 0, 99);
        if (profile == fuzz_profile_t::typing && mode < 55) { return clamp_offset(cursor, max_offset); }
        if (mode < 75) { return clamp_offset(hot_spot + random_i64(rng, -16, 16), max_offset); }
        return random_i64(rng, 0, max_offset);
    }

    int64_t choose_span_length(std::mt19937_64 &rng, fuzz_profile_t profile) {
        if (profile == fuzz_profile_t::adversarial && chance(rng, 8)) { return 128 * 1024; }
        if (profile == fuzz_profile_t::bulk) { return random_i64(rng, 1, 4096); }
        return random_i64(rng, 1, 128);
    }

    int64_t choose_byte_count(std::mt19937_64 &rng, fuzz_profile_t profile, bool small_insert) {
        if (small_insert) { return random_i64(rng, 1, 16); }
        if (profile == fuzz_profile_t::bulk) { return random_i64(rng, 1, 512); }
        return random_i64(rng, 1, 96);
    }

    std::vector<omega_byte_t> random_bytes(std::mt19937_64 &rng, int64_t length, fuzz_profile_t profile) {
        std::vector<omega_byte_t> bytes(static_cast<size_t>(std::max<int64_t>(0, length)));
        for (auto &byte : bytes) {
            if (profile == fuzz_profile_t::typing && chance(rng, 85)) {
                static constexpr char alphabet[] =
                        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \n\t.,;:_-";
                byte = static_cast<omega_byte_t>(
                        alphabet[random_i64(rng, 0, static_cast<int64_t>(sizeof(alphabet) - 2))]);
            } else {
                byte = static_cast<omega_byte_t>(random_i64(rng, 0, 255));
            }
        }
        return bytes;
    }

    fuzz_op_kind_t choose_weighted_op(std::mt19937_64 &rng, fuzz_profile_t profile) {
        struct weighted_op_t {
            fuzz_op_kind_t kind;
            int weight;
        };

        const std::array<weighted_op_t, 10> typing{{
                {fuzz_op_kind_t::insert, 50},
                {fuzz_op_kind_t::delete_bytes, 12},
                {fuzz_op_kind_t::overwrite, 8},
                {fuzz_op_kind_t::replace, 10},
                {fuzz_op_kind_t::undo_burst, 8},
                {fuzz_op_kind_t::begin_transaction, 3},
                {fuzz_op_kind_t::transform, 1},
                {fuzz_op_kind_t::create_checkpoint, 1},
                {fuzz_op_kind_t::save_probe, 4},
                {fuzz_op_kind_t::viewport_probe, 3},
        }};
        const std::array<weighted_op_t, 10> bulk{{
                {fuzz_op_kind_t::insert, 10},
                {fuzz_op_kind_t::delete_bytes, 18},
                {fuzz_op_kind_t::overwrite, 25},
                {fuzz_op_kind_t::replace, 14},
                {fuzz_op_kind_t::undo_burst, 2},
                {fuzz_op_kind_t::begin_transaction, 5},
                {fuzz_op_kind_t::transform, 3},
                {fuzz_op_kind_t::create_checkpoint, 0},
                {fuzz_op_kind_t::save_probe, 12},
                {fuzz_op_kind_t::viewport_probe, 11},
        }};
        const std::array<weighted_op_t, 10> adversarial{{
                {fuzz_op_kind_t::insert, 16},
                {fuzz_op_kind_t::delete_bytes, 18},
                {fuzz_op_kind_t::overwrite, 18},
                {fuzz_op_kind_t::replace, 18},
                {fuzz_op_kind_t::undo_burst, 16},
                {fuzz_op_kind_t::begin_transaction, 8},
                {fuzz_op_kind_t::transform, 5},
                {fuzz_op_kind_t::create_checkpoint, 5},
                {fuzz_op_kind_t::save_probe, 8},
                {fuzz_op_kind_t::viewport_probe, 8},
        }};

        const auto &weights =
                profile == fuzz_profile_t::typing ? typing : (profile == fuzz_profile_t::bulk ? bulk : adversarial);
        int total = 0;
        for (const auto &entry : weights) { total += entry.weight; }
        auto pick = static_cast<int>(random_i64(rng, 1, total));
        for (const auto &entry : weights) {
            pick -= entry.weight;
            if (pick <= 0) { return entry.kind; }
        }
        return fuzz_op_kind_t::insert;
    }

    omega_edit_transform_t choose_transform(std::mt19937_64 &rng) {
        switch (random_i64(rng, 0, 4)) {
            case 0:
                return {OMEGA_EDIT_TRANSFORM_ASCII_TO_UPPER, 0};
            case 1:
                return {OMEGA_EDIT_TRANSFORM_ASCII_TO_LOWER, 0};
            case 2:
                return {OMEGA_EDIT_TRANSFORM_BITWISE_AND, static_cast<omega_byte_t>(random_i64(rng, 0, 255))};
            case 3:
                return {OMEGA_EDIT_TRANSFORM_BITWISE_OR, static_cast<omega_byte_t>(random_i64(rng, 0, 255))};
            default:
                return {OMEGA_EDIT_TRANSFORM_BITWISE_XOR, static_cast<omega_byte_t>(random_i64(rng, 0, 255))};
        }
    }

    int64_t apply_one(omega_session_t *session_ptr, const fuzz_op_t &op) {
        switch (op.kind) {
            case fuzz_op_kind_t::insert:
                return omega_edit_insert_bytes(session_ptr, op.offset, op.bytes.empty() ? nullptr : op.bytes.data(),
                                               static_cast<int64_t>(op.bytes.size()));
            case fuzz_op_kind_t::delete_bytes:
                return omega_edit_delete(session_ptr, op.offset, op.length);
            case fuzz_op_kind_t::overwrite:
                return omega_edit_overwrite_bytes(session_ptr, op.offset, op.bytes.empty() ? nullptr : op.bytes.data(),
                                                  static_cast<int64_t>(op.bytes.size()));
            case fuzz_op_kind_t::replace:
                return omega_edit_replace_bytes(session_ptr, op.offset, op.length,
                                                op.bytes.empty() ? nullptr : op.bytes.data(),
                                                static_cast<int64_t>(op.bytes.size()));
            case fuzz_op_kind_t::undo_burst: {
                int64_t applied = 0;
                for (int64_t i = 0; i < op.count; ++i) {
                    const auto rc = omega_edit_undo_last_change(session_ptr);
                    if (rc < 0) {
                        ++applied;
                    } else {
                        break;
                    }
                }
                return applied;
            }
            case fuzz_op_kind_t::redo_burst: {
                int64_t applied = 0;
                for (int64_t i = 0; i < op.count; ++i) {
                    const auto rc = omega_edit_redo_last_undo(session_ptr);
                    if (rc > 0) {
                        ++applied;
                    } else {
                        break;
                    }
                }
                return applied;
            }
            case fuzz_op_kind_t::begin_transaction:
                return omega_session_begin_transaction(session_ptr);
            case fuzz_op_kind_t::end_transaction:
                return omega_session_end_transaction(session_ptr);
            case fuzz_op_kind_t::transform:
                return omega_edit_apply_builtin_transform(session_ptr, op.transform, op.offset, op.length);
            case fuzz_op_kind_t::create_checkpoint:
                return omega_edit_create_checkpoint(session_ptr);
            case fuzz_op_kind_t::destroy_checkpoint:
                return omega_edit_destroy_last_checkpoint(session_ptr);
            case fuzz_op_kind_t::save_probe: {
                omega_byte_t *bytes = nullptr;
                int64_t length = -1;
                const auto rc = omega_edit_save_segment_to_bytes(session_ptr, &bytes, &length, op.offset, op.length);
                free(bytes);
                return rc == 0 ? length : rc;
            }
            case fuzz_op_kind_t::viewport_probe: {
                const auto capacity = std::max<int64_t>(1, std::min<int64_t>(op.length, OMEGA_VIEWPORT_CAPACITY_LIMIT));
                auto *viewport =
                        omega_edit_create_viewport(session_ptr, op.offset, capacity, 1, nullptr, nullptr, NO_EVENTS);
                if (!viewport) { return -1; }
                const auto length = omega_viewport_get_length(viewport);
                const auto *data = omega_viewport_get_data(viewport);
                const auto rc = (length == 0 || data != nullptr) ? length : -1;
                omega_edit_destroy_viewport(viewport);
                return rc;
            }
        }
        return -1;
    }

    void update_generation_cursor(const omega_session_t *session_ptr, const fuzz_op_t &op, int64_t &cursor,
                                  int64_t &hot_spot) {
        const auto size = std::max<int64_t>(0, omega_session_get_computed_file_size(session_ptr));
        switch (op.kind) {
            case fuzz_op_kind_t::insert:
            case fuzz_op_kind_t::overwrite:
            case fuzz_op_kind_t::replace:
                hot_spot = clamp_offset(op.offset, size);
                cursor = clamp_offset(op.offset + static_cast<int64_t>(op.bytes.size()), size);
                break;
            case fuzz_op_kind_t::delete_bytes:
            case fuzz_op_kind_t::transform:
                hot_spot = clamp_offset(op.offset, size);
                cursor = hot_spot;
                break;
            default:
                cursor = clamp_offset(cursor, size);
                hot_spot = clamp_offset(hot_spot, size);
                break;
        }
    }

    fuzz_op_t make_edit_op(std::mt19937_64 &rng, omega_session_t *session_ptr, fuzz_profile_t profile,
                           fuzz_op_kind_t kind, int64_t cursor, int64_t hot_spot, bool small_insert = false) {
        const auto size = std::max<int64_t>(0, omega_session_get_computed_file_size(session_ptr));
        fuzz_op_t op;
        op.kind = kind;
        switch (kind) {
            case fuzz_op_kind_t::insert:
                op.offset = choose_offset(rng, size, true, profile, cursor, hot_spot);
                op.bytes = random_bytes(rng, choose_byte_count(rng, profile, small_insert), profile);
                break;
            case fuzz_op_kind_t::delete_bytes:
                op.offset = choose_offset(rng, size, false, profile, cursor, hot_spot);
                op.length = choose_span_length(rng, profile);
                break;
            case fuzz_op_kind_t::overwrite:
                op.offset = choose_offset(rng, size, true, profile, cursor, hot_spot);
                op.bytes = random_bytes(rng, choose_byte_count(rng, profile, false), profile);
                break;
            case fuzz_op_kind_t::replace:
                op.offset = choose_offset(rng, size, size == 0, profile, cursor, hot_spot);
                op.length = size > 0 ? std::min(choose_span_length(rng, profile), size - op.offset) : 0;
                op.bytes = random_bytes(rng, choose_byte_count(rng, profile, small_insert), profile);
                break;
            default:
                break;
        }
        return op;
    }

    void record_and_apply(fuzz_script_t &script, TestSession &planning_session, const fuzz_op_t &op, int64_t &cursor,
                          int64_t &hot_spot) {
        script.ops.push_back(op);
        apply_one(planning_session.get(), op);
        update_generation_cursor(planning_session.get(), op, cursor, hot_spot);
    }

    fuzz_script_t generate_script(uint64_t seed, fuzz_profile_t profile, int64_t op_count) {
        std::mt19937_64 rng(seed);
        fuzz_script_t script;
        script.seed = seed;
        script.profile = profile;

        const auto max_base_size =
                profile == fuzz_profile_t::bulk ? 1024 : (profile == fuzz_profile_t::typing ? 48 : 256);
        script.base = random_bytes(rng, random_i64(rng, 0, max_base_size), profile);

        const ScratchDir planning_scratch;
        auto planning_session =
                TestSession::from_bytes(script.base.empty() ? nullptr : script.base.data(),
                                        static_cast<int64_t>(script.base.size()), planning_scratch.c_str());
        planning_session.make_brutal(8, 1);

        int64_t cursor = omega_session_get_computed_file_size(planning_session.get());
        int64_t hot_spot = cursor / 2;
        for (int64_t i = 0; i < op_count; ++i) {
            auto kind = choose_weighted_op(rng, profile);
            const auto size = omega_session_get_computed_file_size(planning_session.get());
            if ((kind == fuzz_op_kind_t::delete_bytes || kind == fuzz_op_kind_t::transform ||
                 kind == fuzz_op_kind_t::replace) &&
                size <= 0) {
                kind = fuzz_op_kind_t::insert;
            }
            if (kind == fuzz_op_kind_t::undo_burst && chance(rng, 18)) { kind = fuzz_op_kind_t::redo_burst; }

            if (kind == fuzz_op_kind_t::begin_transaction) {
                fuzz_op_t begin;
                begin.kind = fuzz_op_kind_t::begin_transaction;
                record_and_apply(script, planning_session, begin, cursor, hot_spot);

                const auto transaction_ops = random_i64(rng, 1, profile == fuzz_profile_t::adversarial ? 7 : 4);
                for (int64_t j = 0; j < transaction_ops; ++j) {
                    const auto edit_pick = random_i64(rng, 0, 3);
                    auto edit_kind = edit_pick == 0 ? fuzz_op_kind_t::insert
                                                    : (edit_pick == 1 ? fuzz_op_kind_t::delete_bytes
                                                                      : (edit_pick == 2 ? fuzz_op_kind_t::overwrite
                                                                                        : fuzz_op_kind_t::replace));
                    if ((edit_kind == fuzz_op_kind_t::delete_bytes || edit_kind == fuzz_op_kind_t::replace) &&
                        omega_session_get_computed_file_size(planning_session.get()) <= 0) {
                        edit_kind = fuzz_op_kind_t::insert;
                    }
                    const auto edit_op = make_edit_op(rng, planning_session.get(), profile, edit_kind, cursor, hot_spot,
                                                      edit_kind == fuzz_op_kind_t::insert);
                    record_and_apply(script, planning_session, edit_op, cursor, hot_spot);
                }

                fuzz_op_t end;
                end.kind = fuzz_op_kind_t::end_transaction;
                record_and_apply(script, planning_session, end, cursor, hot_spot);
                continue;
            }

            fuzz_op_t op;
            op.kind = kind;
            switch (kind) {
                case fuzz_op_kind_t::insert:
                case fuzz_op_kind_t::delete_bytes:
                case fuzz_op_kind_t::overwrite:
                case fuzz_op_kind_t::replace:
                    op = make_edit_op(rng, planning_session.get(), profile, kind, cursor, hot_spot,
                                      kind == fuzz_op_kind_t::insert);
                    break;
                case fuzz_op_kind_t::undo_burst:
                case fuzz_op_kind_t::redo_burst:
                    op.count = random_i64(rng, 1, 50);
                    break;
                case fuzz_op_kind_t::transform:
                    op.transform = choose_transform(rng);
                    op.offset = choose_offset(rng, size, false, profile, cursor, hot_spot);
                    op.length = chance(rng, 20) ? 0 : choose_span_length(rng, profile);
                    break;
                case fuzz_op_kind_t::create_checkpoint:
                    if (profile == fuzz_profile_t::adversarial &&
                        omega_session_get_num_checkpoints(planning_session.get()) > 0 && chance(rng, 45)) {
                        op.kind = fuzz_op_kind_t::destroy_checkpoint;
                    }
                    break;
                case fuzz_op_kind_t::save_probe:
                    op.offset = choose_offset(rng, size, true, profile, cursor, hot_spot);
                    op.length = chance(rng, 35) ? 0 : choose_span_length(rng, profile);
                    break;
                case fuzz_op_kind_t::viewport_probe:
                    op.offset = choose_offset(rng, size, true, profile, cursor, hot_spot);
                    op.length = choose_span_length(rng, profile);
                    break;
                default:
                    break;
            }
            record_and_apply(script, planning_session, op, cursor, hot_spot);
        }
        return script;
    }

    char hex_digit(unsigned value) { return static_cast<char>(value < 10 ? '0' + value : 'a' + (value - 10)); }

    std::string hex_encode(const std::vector<omega_byte_t> &bytes) {
        std::string encoded;
        encoded.reserve(bytes.size() * 2);
        for (const auto byte : bytes) {
            encoded.push_back(hex_digit((byte >> 4U) & 0x0FU));
            encoded.push_back(hex_digit(byte & 0x0FU));
        }
        return encoded;
    }

    int hex_value(char ch) {
        if (ch >= '0' && ch <= '9') { return ch - '0'; }
        if (ch >= 'a' && ch <= 'f') { return ch - 'a' + 10; }
        if (ch >= 'A' && ch <= 'F') { return ch - 'A' + 10; }
        return -1;
    }

    bool hex_decode(const std::string &encoded, std::vector<omega_byte_t> &bytes) {
        if ((encoded.size() % 2) != 0) { return false; }
        bytes.clear();
        bytes.reserve(encoded.size() / 2);
        for (size_t i = 0; i < encoded.size(); i += 2) {
            const auto high = hex_value(encoded[i]);
            const auto low = hex_value(encoded[i + 1]);
            if (high < 0 || low < 0) { return false; }
            bytes.push_back(static_cast<omega_byte_t>((high << 4U) | low));
        }
        return true;
    }

    bool extract_string(const std::string &line, const std::string &key, std::string &value) {
        const auto needle = "\"" + key + "\":\"";
        const auto begin = line.find(needle);
        if (begin == std::string::npos) { return false; }
        const auto value_begin = begin + needle.size();
        const auto value_end = line.find('"', value_begin);
        if (value_end == std::string::npos) { return false; }
        value = line.substr(value_begin, value_end - value_begin);
        return true;
    }

    bool extract_int64(const std::string &line, const std::string &key, int64_t &value) {
        const auto needle = "\"" + key + "\":";
        const auto begin = line.find(needle);
        if (begin == std::string::npos) { return false; }
        const auto value_begin = begin + needle.size();
        const auto value_end = line.find_first_of(",}", value_begin);
        if (value_end == std::string::npos) { return false; }
        const auto text = line.substr(value_begin, value_end - value_begin);
        errno = 0;
        char *end = nullptr;
        const auto parsed = std::strtoll(text.c_str(), &end, 10);
        if (errno != 0 || !end || *end != '\0') { return false; }
        value = parsed;
        return true;
    }

    bool extract_uint64(const std::string &line, const std::string &key, uint64_t &value) {
        int64_t signed_value = 0;
        if (!extract_int64(line, key, signed_value) || signed_value < 0) { return false; }
        value = static_cast<uint64_t>(signed_value);
        return true;
    }

    bool parse_op(const std::string &line, fuzz_op_t &op, std::string &error) {
        std::string name;
        if (!extract_string(line, "op", name)) {
            error = "missing op field";
            return false;
        }

        if (name == "insert") {
            op.kind = fuzz_op_kind_t::insert;
            std::string bytes;
            if (!extract_int64(line, "offset", op.offset) || !extract_string(line, "bytes", bytes) ||
                !hex_decode(bytes, op.bytes)) {
                error = "invalid insert op";
                return false;
            }
            return true;
        }
        if (name == "delete") {
            op.kind = fuzz_op_kind_t::delete_bytes;
            if (!extract_int64(line, "offset", op.offset) || !extract_int64(line, "length", op.length)) {
                error = "invalid delete op";
                return false;
            }
            return true;
        }
        if (name == "overwrite") {
            op.kind = fuzz_op_kind_t::overwrite;
            std::string bytes;
            if (!extract_int64(line, "offset", op.offset) || !extract_string(line, "bytes", bytes) ||
                !hex_decode(bytes, op.bytes)) {
                error = "invalid overwrite op";
                return false;
            }
            return true;
        }
        if (name == "replace") {
            op.kind = fuzz_op_kind_t::replace;
            std::string bytes;
            if (!extract_int64(line, "offset", op.offset) || !extract_int64(line, "length", op.length) ||
                !extract_string(line, "bytes", bytes) || !hex_decode(bytes, op.bytes)) {
                error = "invalid replace op";
                return false;
            }
            return true;
        }
        if (name == "undo" || name == "redo") {
            op.kind = name == "undo" ? fuzz_op_kind_t::undo_burst : fuzz_op_kind_t::redo_burst;
            if (!extract_int64(line, "count", op.count)) {
                error = "invalid undo/redo op";
                return false;
            }
            return true;
        }
        if (name == "begin_transaction") {
            op.kind = fuzz_op_kind_t::begin_transaction;
            return true;
        }
        if (name == "end_transaction") {
            op.kind = fuzz_op_kind_t::end_transaction;
            return true;
        }
        if (name == "transform") {
            int64_t transform_kind = 0;
            int64_t operand = 0;
            op.kind = fuzz_op_kind_t::transform;
            if (!extract_int64(line, "kind", transform_kind) || !extract_int64(line, "operand", operand) ||
                !extract_int64(line, "offset", op.offset) || !extract_int64(line, "length", op.length)) {
                error = "invalid transform op";
                return false;
            }
            op.transform = {static_cast<omega_edit_transform_kind_t>(transform_kind),
                            static_cast<omega_byte_t>(operand)};
            return true;
        }
        if (name == "create_checkpoint") {
            op.kind = fuzz_op_kind_t::create_checkpoint;
            return true;
        }
        if (name == "destroy_checkpoint") {
            op.kind = fuzz_op_kind_t::destroy_checkpoint;
            return true;
        }
        if (name == "save_probe") {
            op.kind = fuzz_op_kind_t::save_probe;
            if (!extract_int64(line, "offset", op.offset) || !extract_int64(line, "length", op.length)) {
                error = "invalid save_probe op";
                return false;
            }
            return true;
        }
        if (name == "viewport_probe") {
            op.kind = fuzz_op_kind_t::viewport_probe;
            if (!extract_int64(line, "offset", op.offset) || !extract_int64(line, "length", op.length)) {
                error = "invalid viewport_probe op";
                return false;
            }
            return true;
        }

        error = "unknown op '" + name + "'";
        return false;
    }

    bool load_script(const std::filesystem::path &path, fuzz_script_t &script, std::string &error) {
        std::ifstream input(path);
        if (!input) {
            error = "failed to open replay file";
            return false;
        }

        std::string line;
        if (!std::getline(input, line)) {
            error = "replay file is empty";
            return false;
        }

        std::string name;
        std::string profile;
        std::string base_hex;
        if (!extract_string(line, "op", name) || name != "base" || !extract_uint64(line, "seed", script.seed) ||
            !extract_string(line, "profile", profile) || !extract_string(line, "bytes", base_hex) ||
            !hex_decode(base_hex, script.base)) {
            error = "invalid base record";
            return false;
        }
        script.profile = profile_from_name(profile);

        size_t line_number = 1;
        while (std::getline(input, line)) {
            ++line_number;
            if (line.empty()) { continue; }
            fuzz_op_t op;
            if (!parse_op(line, op, error)) {
                std::ostringstream message;
                message << "line " << line_number << ": " << error;
                error = message.str();
                return false;
            }
            script.ops.push_back(std::move(op));
        }
        return true;
    }

    std::filesystem::path fuzz_failure_directory() {
        auto path = std::filesystem::temp_directory_path() / "omega-edit-differential-fuzz-failures";
        std::error_code ec;
        std::filesystem::create_directories(path, ec);
        return path;
    }

    void write_script(const std::filesystem::path &path, const fuzz_script_t &script) {
        std::ofstream output(path);
        output << "{\"op\":\"base\",\"seed\":" << script.seed << ",\"profile\":\"" << profile_name(script.profile)
               << "\",\"bytes\":\"" << hex_encode(script.base) << "\"}\n";
        for (const auto &op : script.ops) {
            output << "{\"op\":\"" << op_name(op.kind) << "\"";
            switch (op.kind) {
                case fuzz_op_kind_t::insert:
                case fuzz_op_kind_t::overwrite:
                    output << ",\"offset\":" << op.offset << ",\"bytes\":\"" << hex_encode(op.bytes) << "\"";
                    break;
                case fuzz_op_kind_t::replace:
                    output << ",\"offset\":" << op.offset << ",\"length\":" << op.length << ",\"bytes\":\""
                           << hex_encode(op.bytes) << "\"";
                    break;
                case fuzz_op_kind_t::delete_bytes:
                    output << ",\"offset\":" << op.offset << ",\"length\":" << op.length;
                    break;
                case fuzz_op_kind_t::undo_burst:
                case fuzz_op_kind_t::redo_burst:
                    output << ",\"count\":" << op.count;
                    break;
                case fuzz_op_kind_t::transform:
                    output << ",\"kind\":" << static_cast<int>(op.transform.kind)
                           << ",\"operand\":" << static_cast<int>(op.transform.operand) << ",\"offset\":" << op.offset
                           << ",\"length\":" << op.length;
                    break;
                case fuzz_op_kind_t::save_probe:
                case fuzz_op_kind_t::viewport_probe:
                    output << ",\"offset\":" << op.offset << ",\"length\":" << op.length;
                    break;
                default:
                    break;
            }
            output << "}\n";
        }
    }

    std::filesystem::path dump_script(const fuzz_script_t &script, const std::string &suffix) {
        const auto directory = fuzz_failure_directory();
        std::ostringstream file_name;
        file_name << "seed-" << script.seed << "-" << profile_name(script.profile) << "-" << suffix << ".jsonl";
        const auto path = directory / file_name.str();
        write_script(path, script);
        return path;
    }

    bool transactions_balanced(const std::vector<fuzz_op_t> &ops) {
        int depth = 0;
        for (const auto &op : ops) {
            if (op.kind == fuzz_op_kind_t::begin_transaction) {
                if (depth != 0) { return false; }
                depth = 1;
            } else if (op.kind == fuzz_op_kind_t::end_transaction) {
                if (depth != 1) { return false; }
                depth = 0;
            }
        }
        return depth == 0;
    }

    bool safe_for_full_round_trip(const std::vector<fuzz_op_t> &ops) {
        bool transform_seen = false;
        for (const auto &op : ops) {
            if (op.kind == fuzz_op_kind_t::transform) {
                transform_seen = true;
                continue;
            }
            if (transform_seen && (op.kind == fuzz_op_kind_t::insert || op.kind == fuzz_op_kind_t::delete_bytes ||
                                   op.kind == fuzz_op_kind_t::overwrite || op.kind == fuzz_op_kind_t::replace)) {
                return false;
            }
        }
        return true;
    }

    fuzz_run_result_t fail_at(size_t step, const std::string &message) {
        fuzz_run_result_t result;
        result.ok = false;
        result.step = step;
        result.message = message;
        return result;
    }

    struct exported_op_t {
        omega_changelog_plan_kind_t kind{};
        int64_t offset{};
        int64_t length{};
        std::vector<omega_byte_t> payload{};
    };

    int capture_exported_op(const omega_changelog_plan_entry_t *entry, void *user_data) {
        auto &entries = *static_cast<std::vector<exported_op_t> *>(user_data);
        exported_op_t captured{entry->kind, entry->offset, entry->length, {}};
        captured.payload.resize(static_cast<size_t>(entry->payload_length));
        int64_t offset = 0;
        while (offset < entry->payload_length) {
            const auto read = entry->read_payload(entry->payload_context, offset, captured.payload.data() + offset,
                                                  entry->payload_length - offset);
            if (read <= 0) { return -1; }
            offset += read;
        }
        entries.push_back(std::move(captured));
        return 0;
    }

    bool replay_exported_ops(omega_session_t *session, const std::vector<exported_op_t> &entries) {
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

    fuzz_run_result_t verify_optimized_export(const fuzz_script_t &script, const omega_session_t *source) {
        if (omega_session_get_num_changes(source) <= 0) { return {}; }
        omega_changelog_export_options_t options{};
        options.prefer_overwrite_form = 1;
        std::vector<exported_op_t> raw;
        std::vector<exported_op_t> optimized;
        const auto raw_result = omega_edit_export_changelog(source, &options, 0, nullptr, capture_exported_op, &raw);
        const auto optimized_result =
                omega_edit_export_changelog(source, &options, 1, nullptr, capture_exported_op, &optimized);
        if (raw_result != 0 || optimized_result != 0) {
            std::ostringstream message;
            message << "ranged change-log export failed: raw=" << raw_result << ", optimized=" << optimized_result;
            message << ", callbacks raw=" << raw.size() << ", optimized=" << optimized.size();
            for (int64_t last = 1; last <= omega_session_get_num_changes(source); ++last) {
                omega_changelog_export_options_t prefix_options{};
                prefix_options.last_change_serial = last;
                std::vector<exported_op_t> prefix;
                if (omega_edit_export_changelog(source, &prefix_options, 0, nullptr, capture_exported_op, &prefix) !=
                    0) {
                    message << ", first failing prefix=" << last;
                    break;
                }
            }
            return fail_at(script.ops.size(), message.str());
        }
        if (optimized.size() > raw.size()) {
            return fail_at(script.ops.size(), "optimized export contains more operations than raw export");
        }
        if (std::any_of(optimized.begin(), optimized.end(),
                        [](const exported_op_t &entry) { return entry.kind == OMEGA_CHANGELOG_PLAN_TRANSFORM; })) {
            // Built-in transforms are preserved by metadata, but this core-only harness does not own the plugin
            // registry needed to replay them. Dedicated planner tests pin the barrier and metadata contract.
            return {};
        }
        const ScratchDir replay_scratch;
        auto replay = TestSession::from_bytes(script.base.empty() ? nullptr : script.base.data(),
                                              static_cast<int64_t>(script.base.size()), replay_scratch.c_str());
        if (!replay || !replay_exported_ops(replay.get(), optimized)) {
            return fail_at(script.ops.size(), "optimized export replay failed");
        }
        const auto comparison = compare_content(source, replay.get());
        if (!comparison.equal) {
            std::ostringstream message;
            message << "optimized replay diverged at " << comparison.first_diff_offset;
            return fail_at(script.ops.size(), message.str());
        }
        if (!model_valid(replay.get())) { return fail_at(script.ops.size(), "optimized replay model is invalid"); }
        return {};
    }

    fuzz_run_result_t run_script(const fuzz_script_t &script) {
        const ScratchDir scratch_a;
        const ScratchDir scratch_b;
        auto session_a = TestSession::from_bytes(script.base.empty() ? nullptr : script.base.data(),
                                                 static_cast<int64_t>(script.base.size()), scratch_a.c_str());
        auto session_b = TestSession::from_bytes(script.base.empty() ? nullptr : script.base.data(),
                                                 static_cast<int64_t>(script.base.size()), scratch_b.c_str());
        if (!session_a || !session_b) { return fail_at(0, "failed to create fuzz sessions"); }

        static constexpr std::array<int64_t, 3> snapshot_a{{0, 1, 7}};
        static constexpr std::array<int64_t, 3> snapshot_b{{7, 0, 1}};
        static constexpr std::array<int64_t, 3> payload_a{{8, 32, 96}};
        static constexpr std::array<int64_t, 3> payload_b{{96, 8, 32}};
        const auto knob_index = static_cast<size_t>(script.seed % snapshot_a.size());
        omega_session_set_undo_snapshot_interval(session_a.get(), snapshot_a[knob_index]);
        omega_session_set_undo_snapshot_interval(session_b.get(), snapshot_b[knob_index]);
        omega_session_set_change_inline_payload_limit(session_a.get(), payload_a[knob_index]);
        omega_session_set_change_inline_payload_limit(session_b.get(), payload_b[knob_index]);

        for (size_t i = 0; i < script.ops.size(); ++i) {
            const auto &op = script.ops[i];
            const auto rc_a = apply_one(session_a.get(), op);
            const auto rc_b = apply_one(session_b.get(), op);
            if (rc_a != rc_b) {
                std::ostringstream message;
                message << "return mismatch after " << op_name(op.kind) << ": " << rc_a << " vs " << rc_b;
                return fail_at(i + 1, message.str());
            }

            const auto compare = compare_content(session_a.get(), session_b.get());
            if (!compare.equal) {
                std::ostringstream message;
                message << "content mismatch after " << op_name(op.kind) << ", sizes " << compare.size_a << " vs "
                        << compare.size_b << ", first diff " << compare.first_diff_offset;
                return fail_at(i + 1, message.str());
            }
            if (!model_valid(session_a.get()) || !model_valid(session_b.get())) {
                return fail_at(i + 1, std::string("model invalid after ") + op_name(op.kind));
            }

            const auto serials_a = check_serials_contiguous(session_a.get());
            const auto serials_b = check_serials_contiguous(session_b.get());
            if (!serials_a.contiguous || !serials_b.contiguous) {
                std::ostringstream message;
                message << "serial lookup gap after " << op_name(op.kind) << ": " << serials_a.first_bad_serial
                        << " vs " << serials_b.first_bad_serial;
                return fail_at(i + 1, message.str());
            }
        }

        if (omega_session_get_transaction_state(session_a.get()) != 0 ||
            omega_session_get_transaction_state(session_b.get()) != 0) {
            return fail_at(script.ops.size(), "script ended with an open transaction");
        }

        const auto optimized_export = verify_optimized_export(script, session_a.get());
        if (!optimized_export.ok) { return optimized_export; }

        if (safe_for_full_round_trip(script.ops)) {
            const auto round_trip_a = verify_undo_redo_round_trip(session_a.get());
            const auto round_trip_b = verify_undo_redo_round_trip(session_b.get());
            if (!round_trip_a.ok || !round_trip_a.model_valid_throughout || !round_trip_b.ok ||
                !round_trip_b.model_valid_throughout) {
                std::ostringstream message;
                message << "undo/redo round trip failed: mismatch steps " << round_trip_a.mismatch_step << " and "
                        << round_trip_b.mismatch_step;
                return fail_at(script.ops.size(), message.str());
            }
            const auto compare = compare_content(session_a.get(), session_b.get());
            if (!compare.equal) { return fail_at(script.ops.size(), "sessions diverged after undo/redo round trip"); }
        }

        return {};
    }

    std::vector<fuzz_op_t> without_range(const std::vector<fuzz_op_t> &ops, size_t begin, size_t count) {
        std::vector<fuzz_op_t> result;
        result.reserve(ops.size() - count);
        result.insert(result.end(), ops.begin(), ops.begin() + static_cast<std::ptrdiff_t>(begin));
        result.insert(result.end(), ops.begin() + static_cast<std::ptrdiff_t>(begin + count), ops.end());
        return result;
    }

    fuzz_script_t shrink_script(const fuzz_script_t &script) {
        fuzz_script_t candidate = script;
        if (candidate.ops.size() < 2) { return candidate; }

        for (auto chunk = candidate.ops.size() / 2; chunk > 0;) {
            bool removed = false;
            for (size_t begin = 0; begin + chunk <= candidate.ops.size(); ++begin) {
                auto trial = candidate;
                trial.ops = without_range(candidate.ops, begin, chunk);
                if (trial.ops.empty() || !transactions_balanced(trial.ops)) { continue; }
                if (!run_script(trial).ok) {
                    candidate = std::move(trial);
                    removed = true;
                    break;
                }
            }
            if (removed) {
                chunk = std::max<size_t>(1, candidate.ops.size() / 2);
            } else {
                chunk /= 2;
            }
        }
        return candidate;
    }

    std::vector<uint64_t> fixed_seeds() {
        return {
                0x5EED0001ULL,     0x5EED0002ULL,     0x5EED0003ULL,     0xC0FFEE1234ULL,
                0xBAD5EEDULL,      0x0D1FF5EEDULL,    0xA11CEB00CULL,    0xF00DCAFEULL,
                0x123456789ABCULL, 0x9876543210ULL,   0x102030405060ULL, 0xFFEEDDCCBBAAULL,
                0x314159265358ULL, 0x271828182845ULL, 0xABCDEF010203ULL, 0xDEADBEEF0042ULL,
        };
    }
}// namespace

TEST_CASE("Differential fuzz driver replays generated scripts", "[DifferentialFuzz][Harness]") {
    if (const auto *replay_path = std::getenv("OMEGA_EDIT_FUZZ_REPLAY"); replay_path && *replay_path) {
        fuzz_script_t replay;
        std::string error;
        REQUIRE(load_script(replay_path, replay, error));
        const auto result = run_script(replay);
        INFO("replay " << replay_path << " seed " << replay.seed << " step " << result.step << ": " << result.message);
        REQUIRE(result.ok);
        return;
    }

    const auto iterations = parse_i64(std::getenv("OMEGA_EDIT_FUZZ_ITERATIONS"), 12, 1, 1000000);
    const auto op_count = parse_i64(std::getenv("OMEGA_EDIT_FUZZ_OPS"), 96, 1, 1000000);
    const auto one_seed = std::getenv("OMEGA_EDIT_FUZZ_SEED");
    auto seeds = fixed_seeds();

    for (int64_t i = 0; i < iterations; ++i) {
        const auto seed = one_seed && *one_seed
                                  ? parse_u64(one_seed, seeds[0])
                                  : (i < static_cast<int64_t>(seeds.size())
                                             ? seeds[static_cast<size_t>(i)]
                                             : seeds.back() + static_cast<uint64_t>(i * 0x9E3779B97F4A7C15ULL));
        const auto profile = static_cast<fuzz_profile_t>(i % 3);
        const auto script = generate_script(seed, profile, op_count);
        if (i == 0) {
            const ScratchDir replay_scratch;
            const auto replay_path = std::filesystem::path(replay_scratch.str()) / "replay-smoke.jsonl";
            write_script(replay_path, script);
            fuzz_script_t loaded;
            std::string error;
            REQUIRE(load_script(replay_path, loaded, error));
            REQUIRE(loaded.seed == script.seed);
            REQUIRE(loaded.ops.size() == script.ops.size());
            const auto replay_result = run_script(loaded);
            const auto replay_failure_path =
                    replay_result.ok ? std::filesystem::path{} : dump_script(loaded, "replay-smoke-failure");
            INFO("serialized replay smoke " << replay_path << " seed " << loaded.seed << " step " << replay_result.step
                                            << ": " << replay_result.message << "; failure replay "
                                            << replay_failure_path);
            REQUIRE(replay_result.ok);
        }

        const auto result = run_script(script);
        if (!result.ok) {
            const auto original_path = dump_script(script, "original");
            const auto minimized = shrink_script(script);
            const auto minimized_path = dump_script(minimized, "minimized");
            INFO("seed " << script.seed << " profile " << profile_name(script.profile) << " step " << result.step
                         << ": " << result.message << "; original replay " << original_path << "; minimized replay "
                         << minimized_path);
        }
        REQUIRE(result.ok);
    }
}
