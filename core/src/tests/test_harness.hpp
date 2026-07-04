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
 * @file test_harness.hpp
 * @brief Shared "brutal testing" oracles and invariant checkers for OmegaEdit core tests.
 *
 * This is the reusable harness described in CHANGELOG-OPTIMIZER-Fable5.md section 10.1. It is
 * deliberately independent of any single feature: every core test that mutates a session should be
 * able to compose these checks cheaply. Design rules:
 *
 *  - Oracles return structured results (first divergence offset, mismatch step, ...) instead of
 *    bare bools wherever a failure needs a useful diagnostic.
 *  - Nothing here asserts directly; tests wrap results in REQUIRE/CHECK so failures point at the
 *    calling test line. Use INFO(...) with the returned diagnostics.
 *  - All content oracles stream through bounded segments, so they work on sessions of any size
 *    (no OMEGA_MEMORY_BUFFER_LIMIT dependence).
 */

#ifndef OMEGA_EDIT_TEST_HARNESS_HPP
#define OMEGA_EDIT_TEST_HARNESS_HPP

#include "omega_edit.h"
#include "omega_edit/change.h"
#include "omega_edit/check.h"
#include "omega_edit/config.h"
#include "omega_edit/filesystem.h"
#include "omega_edit/segment.h"
#include "omega_edit/session.h"
#include "omega_edit/viewport.h"

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <memory>
#include <random>
#include <string>
#include <vector>

namespace omega_test {

    /**********************************************************************************************************************
     * Content oracles
     **********************************************************************************************************************/

    constexpr int64_t HARNESS_CHUNK_SIZE = 64 * 1024;

    /** Stream the session content through a visitor: visit(const omega_byte_t*, int64_t) -> bool (false aborts). */
    template<typename Visitor>
    inline bool visit_session_content(const omega_session_t *session_ptr, Visitor &&visit) {
        if (!session_ptr) { return false; }
        const auto size = omega_session_get_computed_file_size(session_ptr);
        if (size < 0) { return false; }
        auto *segment = omega_segment_create(std::min<int64_t>(std::max<int64_t>(size, 1), HARNESS_CHUNK_SIZE));
        if (!segment) { return false; }
        bool ok = true;
        int64_t offset = 0;
        while (offset < size) {
            if (0 != omega_session_get_segment(session_ptr, segment, offset)) {
                ok = false;
                break;
            }
            const auto length = omega_segment_get_length(segment);
            if (length <= 0) {
                ok = false;// would spin forever; a read hole is an oracle failure, not "done"
                break;
            }
            if (!visit(omega_segment_get_data(segment), length)) {
                ok = false;
                break;
            }
            offset += length;
        }
        omega_segment_destroy(segment);
        return ok;
    }

    /** FNV-1a 64-bit content hash, streamed. Distinct sizes always hash distinct (size is mixed in). */
    inline uint64_t content_hash(const omega_session_t *session_ptr) {
        uint64_t hash = 14695981039346656037ULL;
        auto mix = [&hash](const omega_byte_t *data, int64_t length) {
            for (int64_t i = 0; i < length; ++i) {
                hash ^= data[i];
                hash *= 1099511628211ULL;
            }
            return true;
        };
        if (!visit_session_content(session_ptr, mix)) { return 0; }// 0 = "unhashable", never a valid content hash here
        const auto size = static_cast<uint64_t>(omega_session_get_computed_file_size(session_ptr));
        for (int shift = 0; shift < 64; shift += 8) {
            hash ^= (size >> shift) & 0xFFU;
            hash *= 1099511628211ULL;
        }
        return hash;
    }

    /** Full content as a string (small sessions only; intended for readable Catch2 diffs). */
    inline std::string content_string(const omega_session_t *session_ptr) {
        std::string result;
        const auto size = omega_session_get_computed_file_size(session_ptr);
        if (size > 0) { result.reserve(static_cast<size_t>(size)); }
        visit_session_content(session_ptr, [&result](const omega_byte_t *data, int64_t length) {
            result.append(reinterpret_cast<const char *>(data), static_cast<size_t>(length));
            return true;
        });
        return result;
    }

    struct content_compare_result_t {
        bool equal{};
        int64_t size_a{-1};
        int64_t size_b{-1};
        int64_t first_diff_offset{-1};///< -1 when equal or when sizes differ before any byte diff
    };

    /** Byte-exact comparison of two sessions, streamed; reports the first divergent offset. */
    inline content_compare_result_t compare_content(const omega_session_t *session_a,
                                                    const omega_session_t *session_b) {
        content_compare_result_t result;
        result.size_a = omega_session_get_computed_file_size(session_a);
        result.size_b = omega_session_get_computed_file_size(session_b);
        if (result.size_a < 0 || result.size_b < 0 || result.size_a != result.size_b) { return result; }

        auto *segment_a = omega_segment_create(HARNESS_CHUNK_SIZE);
        auto *segment_b = omega_segment_create(HARNESS_CHUNK_SIZE);
        if (!segment_a || !segment_b) {
            omega_segment_destroy(segment_a);
            omega_segment_destroy(segment_b);
            return result;
        }
        result.equal = true;
        int64_t offset = 0;
        while (offset < result.size_a) {
            if (0 != omega_session_get_segment(session_a, segment_a, offset) ||
                0 != omega_session_get_segment(session_b, segment_b, offset)) {
                result.equal = false;
                result.first_diff_offset = offset;
                break;
            }
            const auto length = std::min(omega_segment_get_length(segment_a), omega_segment_get_length(segment_b));
            if (length <= 0) {
                result.equal = false;
                result.first_diff_offset = offset;
                break;
            }
            const auto *data_a = omega_segment_get_data(segment_a);
            const auto *data_b = omega_segment_get_data(segment_b);
            if (0 != std::memcmp(data_a, data_b, static_cast<size_t>(length))) {
                for (int64_t i = 0; i < length; ++i) {
                    if (data_a[i] != data_b[i]) {
                        result.first_diff_offset = offset + i;
                        break;
                    }
                }
                result.equal = false;
                break;
            }
            offset += length;
        }
        omega_segment_destroy(segment_a);
        omega_segment_destroy(segment_b);
        return result;
    }

    /**********************************************************************************************************************
     * Model integrity
     **********************************************************************************************************************/

    /** Wraps omega_check_model: segment contiguity, change-reference integrity, size consistency. */
    inline bool model_valid(const omega_session_t *session_ptr) { return 0 == omega_check_model(session_ptr); }

    /**********************************************************************************************************************
     * Serial contiguity
     **********************************************************************************************************************/

    struct serial_check_result_t {
        bool contiguous{};
        int64_t num_changes{};
        int64_t first_bad_serial{};///< 0 when contiguous
    };

    /**
     * Every serial 1..num_changes must resolve via omega_session_get_change and round-trip its
     * serial value; num_changes + 1 must not resolve.
     */
    inline serial_check_result_t check_serials_contiguous(const omega_session_t *session_ptr) {
        serial_check_result_t result;
        result.num_changes = omega_session_get_num_changes(session_ptr);
        for (int64_t serial = 1; serial <= result.num_changes; ++serial) {
            const auto *change = omega_session_get_change(session_ptr, serial);
            if (!change || omega_change_get_serial(change) != serial) {
                result.first_bad_serial = serial;
                return result;
            }
        }
        if (nullptr != omega_session_get_change(session_ptr, result.num_changes + 1)) {
            result.first_bad_serial = result.num_changes + 1;
            return result;
        }
        result.contiguous = true;
        return result;
    }

    /**********************************************************************************************************************
     * Undo/redo trajectory oracle
     **********************************************************************************************************************/

    struct undo_redo_result_t {
        bool ok{};
        int64_t undo_steps{};
        int64_t redo_steps{};
        int64_t mismatch_step{-1};       ///< redo step index whose content hash diverged (-1 = none)
        bool model_valid_throughout{};   ///< omega_check_model held at every step
        std::vector<uint64_t> trajectory;///< content hash per state: [0] = tip, back() = deepest undo
    };

    /**
     * Capture the full undo trajectory (undo to exhaustion, hashing content at each state), then
     * redo back to the tip verifying every intermediate state hash in reverse order. Leaves the
     * session at the tip on success. This is the "one permitted visible change" oracle: any code
     * that rewrites history must keep every state on this trajectory truthful.
     *
     * Note: undo stops at plain (non-transform) checkpoint boundaries by core design; the
     * trajectory covers what the user can actually reach.
     */
    inline undo_redo_result_t verify_undo_redo_round_trip(omega_session_t *session_ptr) {
        undo_redo_result_t result;
        result.model_valid_throughout = model_valid(session_ptr);
        result.trajectory.push_back(content_hash(session_ptr));

        while (omega_edit_undo_last_change(session_ptr) < 0) {
            result.trajectory.push_back(content_hash(session_ptr));
            result.model_valid_throughout = result.model_valid_throughout && model_valid(session_ptr);
            ++result.undo_steps;
        }

        for (auto step = static_cast<int64_t>(result.trajectory.size()) - 2; step >= 0; --step) {
            if (omega_edit_redo_last_undo(session_ptr) <= 0) {
                result.mismatch_step = step;
                return result;
            }
            ++result.redo_steps;
            result.model_valid_throughout = result.model_valid_throughout && model_valid(session_ptr);
            if (content_hash(session_ptr) != result.trajectory[static_cast<size_t>(step)]) {
                result.mismatch_step = step;
                return result;
            }
        }
        result.ok = result.undo_steps == result.redo_steps;
        return result;
    }

    /**********************************************************************************************************************
     * Event recording
     **********************************************************************************************************************/

    struct recorded_session_event_t {
        omega_session_event_t event{};
        int64_t serial{};///< change serial for EDIT/UNDO/TRANSFORM payloads; 0 otherwise
    };

    /**
     * Records the exact session event sequence. Pass callback() and this instance as user data at
     * session creation (core callbacks are fixed at create time — see TestSession).
     */
    class SessionEventRecorder {
    public:
        static void callback(const omega_session_t *session_ptr, omega_session_event_t event, const void *event_ptr) {
            auto *recorder = static_cast<SessionEventRecorder *>(omega_session_get_user_data_ptr(session_ptr));
            if (!recorder) { return; }
            recorded_session_event_t record{event, 0};
            switch (event) {
                case SESSION_EVT_EDIT:// deliberate fall-through
                case SESSION_EVT_UNDO:
                case SESSION_EVT_TRANSFORM:
                    if (event_ptr) {
                        record.serial = omega_change_get_serial(static_cast<const omega_change_t *>(event_ptr));
                    }
                    break;
                default:
                    break;
            }
            recorder->events_.push_back(record);
        }

        const std::vector<recorded_session_event_t> &events() const { return events_; }

        int64_t count(omega_session_event_t event) const {
            int64_t total = 0;
            for (const auto &record : events_) {
                if (record.event == event) { ++total; }
            }
            return total;
        }

        void clear() { events_.clear(); }

    private:
        std::vector<recorded_session_event_t> events_;
    };

    /**********************************************************************************************************************
     * Filesystem hygiene audit
     **********************************************************************************************************************/

    /**
     * Snapshot a directory's file names at construction; report additions/removals on demand.
     * Point it at omega_session_get_checkpoint_directory() to police payload/checkpoint litter.
     */
    class DirAudit {
    public:
        explicit DirAudit(std::string directory) : directory_(std::move(directory)), baseline_(list(directory_)) {}

        std::vector<std::string> added() const { return difference(list(directory_), baseline_); }
        std::vector<std::string> removed() const { return difference(baseline_, list(directory_)); }
        bool unchanged() const { return added().empty() && removed().empty(); }
        const std::string &directory() const { return directory_; }
        void rebase() { baseline_ = list(directory_); }

        static std::vector<std::string> list(const std::string &directory) {
            std::vector<std::string> names;
            std::error_code ec;
            for (std::filesystem::directory_iterator iter(directory, ec), end; !ec && iter != end; iter.increment(ec)) {
                names.push_back(iter->path().filename().string());
            }
            std::sort(names.begin(), names.end());
            return names;
        }

    private:
        static std::vector<std::string> difference(const std::vector<std::string> &lhs,
                                                   const std::vector<std::string> &rhs) {
            std::vector<std::string> result;
            std::set_difference(lhs.begin(), lhs.end(), rhs.begin(), rhs.end(), std::back_inserter(result));
            return result;
        }

        std::string directory_;
        std::vector<std::string> baseline_;
    };

    /** RAII scratch directory (unique per instance) removed recursively on destruction. */
    class ScratchDir {
    public:
        ScratchDir() {
            static std::mt19937_64 rng{std::random_device{}()};
            const auto base = std::filesystem::temp_directory_path() / "omega-edit-test-harness";
            std::error_code ec;
            std::filesystem::create_directories(base, ec);
            do { path_ = base / ("scratch-" + std::to_string(rng())); } while (std::filesystem::exists(path_, ec));
            std::filesystem::create_directories(path_, ec);
        }

        ~ScratchDir() {
            std::error_code ec;
            std::filesystem::remove_all(path_, ec);
        }

        ScratchDir(const ScratchDir &) = delete;
        auto operator=(const ScratchDir &) -> ScratchDir & = delete;

        const std::string &str() const {
            if (cached_.empty()) { cached_ = path_.string(); }
            return cached_;
        }
        const char *c_str() const { return str().c_str(); }

    private:
        std::filesystem::path path_;
        mutable std::string cached_;
    };

    /**********************************************************************************************************************
     * Session wrapper with recorder and brutality knobs
     **********************************************************************************************************************/

    /**
     * RAII session with a SessionEventRecorder wired at creation (the core only accepts callbacks
     * at create time) and an isolated checkpoint directory when one is supplied. The recorder is
     * heap-owned so its address — registered with the core as user data — stays stable across
     * moves of the wrapper.
     */
    class TestSession {
    public:
        explicit TestSession(const char *file_path = nullptr, const char *checkpoint_directory = nullptr,
                             int32_t event_interest = SESSION_EVENTS_ALL)
            : recorder_(std::make_unique<SessionEventRecorder>()),
              session_(omega_edit_create_session(file_path, SessionEventRecorder::callback, recorder_.get(),
                                                 event_interest, checkpoint_directory)) {}

        static TestSession from_bytes(const omega_byte_t *data, int64_t length,
                                      const char *checkpoint_directory = nullptr,
                                      int32_t event_interest = SESSION_EVENTS_ALL) {
            TestSession wrapper(tag_t{});
            wrapper.session_ =
                    omega_edit_create_session_from_bytes(data, length, SessionEventRecorder::callback,
                                                         wrapper.recorder_.get(), event_interest, checkpoint_directory);
            return wrapper;
        }

        ~TestSession() {
            if (session_) { omega_edit_destroy_session(session_); }
        }

        TestSession(const TestSession &) = delete;
        auto operator=(const TestSession &) -> TestSession & = delete;

        TestSession(TestSession &&other) noexcept : recorder_(std::move(other.recorder_)), session_(other.session_) {
            other.session_ = nullptr;
        }

        omega_session_t *get() const { return session_; }
        explicit operator bool() const { return session_ != nullptr; }
        SessionEventRecorder &events() { return *recorder_; }

        /**
         * The brutality knobs from CHANGELOG-OPTIMIZER-Fable5.md section 10.1: a tiny inline
         * payload limit forces the file-backed payload-ownership paths on nearly every edit, and
         * an aggressive snapshot interval shakes snapshot interactions.
         */
        void make_brutal(int64_t inline_payload_limit = 8, int64_t undo_snapshot_interval = 1) {
            omega_session_set_change_inline_payload_limit(session_, inline_payload_limit);
            omega_session_set_undo_snapshot_interval(session_, undo_snapshot_interval);
        }

    private:
        struct tag_t {};
        explicit TestSession(tag_t) : recorder_(std::make_unique<SessionEventRecorder>()) {}

        std::unique_ptr<SessionEventRecorder> recorder_;
        omega_session_t *session_{};
    };

}// namespace omega_test

#endif//OMEGA_EDIT_TEST_HARNESS_HPP
