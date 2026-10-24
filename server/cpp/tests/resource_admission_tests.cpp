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

#include "resource_admission.h"
#include "session_manager.h"

#include <iostream>

using omega_edit::grpc_server::EventQueue;
using omega_edit::grpc_server::EventQueueBudget;
using omega_edit::grpc_server::ResourceAdmissionGate;
using omega_edit::grpc_server::ResourceLimits;
using omega_edit::grpc_server::ViewportEventData;

namespace {
    int failures = 0;
    void check(bool condition, const char *message) {
        if (!condition) {
            std::cerr << message << '\n';
            ++failures;
        }
    }
}// namespace

int main() {
    ResourceLimits defaults;
    check(defaults.max_sessions == 0, "native omission must not cap sessions");
    check(defaults.max_read_segment_bytes == 0, "native omission must not cap massive-file reads by policy");
    check(defaults.max_changelog_spool_bytes == 0, "native omission must not cap streamed exports");

    ResourceAdmissionGate gate(1);
    {
        auto first = gate.try_acquire();
        check(static_cast<bool>(first), "first admission should succeed");
        auto second = gate.try_acquire();
        check(!second, "limit+1 admission should fail");
        check(gate.rejected() == 1, "rejection should be observable");
    }
    check(static_cast<bool>(gate.try_acquire()), "released admission should be reusable");

    auto budget = std::make_shared<EventQueueBudget>(2048);
    EventQueue<ViewportEventData> queue(0, 1024, budget, "test");
    ViewportEventData event;
    event.data.resize(400);
    queue.push(event);
    check(budget->used_bytes.load() <= 1024, "event budget should account queued bytes");
    queue.push(event);
    check(queue.dropped_count() >= 1, "per-queue byte cap should drop old state");
    ViewportEventData popped;
    check(queue.pop(popped, std::chrono::milliseconds(1)), "latest viewport state should remain available");
    check(budget->used_bytes.load() == 0, "pop should release aggregate byte budget");

    return failures == 0 ? 0 : 1;
}
