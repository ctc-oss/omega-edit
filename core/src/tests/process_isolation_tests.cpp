/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed on an "AS IS" BASIS, WITHOUT    *
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the License for the specific language         *
 * governing permissions and limitations under the License.                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

#include "test_harness.hpp"

#include <catch2/catch_test_macros.hpp>
#include <omega_edit/transform.h>

#include <string>

#ifndef OMEGA_EDIT_PLUGIN_HOST_EXECUTABLE
#error "OMEGA_EDIT_PLUGIN_HOST_EXECUTABLE must be defined by the test build"
#endif

#ifndef OMEGA_EDIT_PROCESS_ISOLATION_PLUGIN
#error "OMEGA_EDIT_PROCESS_ISOLATION_PLUGIN must be defined by the test build"
#endif

using omega_test::content_string;
using omega_test::TestSession;

namespace {
    struct Registry {
        omega_transform_plugin_registry_t *ptr{omega_transform_plugin_registry_create()};
        ~Registry() { omega_transform_plugin_registry_destroy(ptr); }
    };

    struct ProgressState {
        int calls{};
        int worker_calls{};
        int64_t processed{};
        int64_t total{};
        std::string phase;
        std::string message;
    };

    struct CancellationState {
        int calls{};
        int cancel_after{};
    };

    int capture_progress(const omega_transform_plugin_progress_t *progress_ptr, void *user_data_ptr) {
        auto *state = static_cast<ProgressState *>(user_data_ptr);
        if (!state || !progress_ptr) { return -1; }
        ++state->calls;
        state->processed = progress_ptr->processed_bytes;
        state->total = progress_ptr->total_bytes;
        state->phase = progress_ptr->phase ? progress_ptr->phase : "";
        state->message = progress_ptr->message ? progress_ptr->message : "";
        if (state->phase == "worker") { ++state->worker_calls; }
        return 0;
    }

    int cancel_after_callback(void *user_data_ptr) {
        auto *state = static_cast<CancellationState *>(user_data_ptr);
        if (!state) { return 0; }
        ++state->calls;
        return state->calls > state->cancel_after ? 1 : 0;
    }
}// namespace

TEST_CASE("Transform plugins run out of process and crashes do not kill the caller", "[Transform][Isolation]") {
    Registry default_policy_registry;
    REQUIRE(default_policy_registry.ptr != nullptr);
    REQUIRE(0 == omega_transform_plugin_registry_set_host_path(default_policy_registry.ptr,
                                                               OMEGA_EDIT_PLUGIN_HOST_EXECUTABLE));
    REQUIRE(-1 == omega_transform_plugin_registry_register_plugin(default_policy_registry.ptr,
                                                                  OMEGA_EDIT_PROCESS_ISOLATION_PLUGIN));

    Registry registry;
    REQUIRE(registry.ptr != nullptr);
    REQUIRE(0 == omega_transform_plugin_registry_set_host_path(registry.ptr, OMEGA_EDIT_PLUGIN_HOST_EXECUTABLE));
    REQUIRE(0 == omega_transform_plugin_registry_set_allow_test(registry.ptr, 1));
    REQUIRE(0 == omega_transform_plugin_registry_register_plugin(registry.ptr, OMEGA_EDIT_PROCESS_ISOLATION_PLUGIN));
    REQUIRE(omega_transform_plugin_registry_find_info(registry.ptr, "omega.test.process_isolation") != nullptr);

    const auto *safe_input = reinterpret_cast<const omega_byte_t *>("abc");
    TestSession safe = TestSession::from_bytes(safe_input, 3);
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry.ptr, "omega.test.process_isolation",
                                                                  safe.get(), 0, 0, nullptr, nullptr));
    REQUIRE(content_string(safe.get()) == "isolated");

    const auto *crashing_input = reinterpret_cast<const omega_byte_t *>("crash");
    TestSession crashing = TestSession::from_bytes(crashing_input, 5);
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session(registry.ptr, "omega.test.process_isolation",
                                                                   crashing.get(), 0, 0, nullptr, nullptr));
    REQUIRE(content_string(crashing.get()) == "crash");
    REQUIRE(omega_session_get_num_changes(crashing.get()) == 0);

    TestSession safe_after_crash = TestSession::from_bytes(safe_input, 3);
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session(registry.ptr, "omega.test.process_isolation",
                                                                  safe_after_crash.get(), 0, 0, nullptr, nullptr));
    REQUIRE(content_string(safe_after_crash.get()) == "isolated");

    ProgressState progress;
    const auto *progress_input = reinterpret_cast<const omega_byte_t *>("progress");
    TestSession progress_session = TestSession::from_bytes(progress_input, 8);
    REQUIRE(0 == omega_transform_plugin_registry_apply_to_session_with_progress(
                         registry.ptr, "omega.test.process_isolation", progress_session.get(), 0, 0, nullptr,
                         capture_progress, &progress, nullptr));
    REQUIRE(progress.calls >= 1);
    REQUIRE(progress.worker_calls == 1);
    REQUIRE(progress.processed == 4);
    REQUIRE(progress.total == 8);
    REQUIRE(progress.phase == "worker");
    REQUIRE(progress.message == "halfway");

    CancellationState cancellation{0, 5};
    const auto *cancel_input = reinterpret_cast<const omega_byte_t *>("cancel");
    TestSession cancelled = TestSession::from_bytes(cancel_input, 6);
    REQUIRE(-1 == omega_transform_plugin_registry_apply_to_session_with_progress_cancel_and_serial(
                          registry.ptr, "omega.test.process_isolation", cancelled.get(), 0, 0, nullptr, nullptr,
                          nullptr, cancel_after_callback, &cancellation, nullptr, nullptr));
    REQUIRE(cancellation.calls > cancellation.cancel_after);
    REQUIRE(content_string(cancelled.get()) == "cancel");
    REQUIRE(omega_session_get_num_changes(cancelled.get()) == 0);
}
