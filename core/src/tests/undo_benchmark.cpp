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

#include <catch2/catch_test_macros.hpp>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <numeric>
#include <string>
#include <string_view>
#include <vector>

namespace {
    using clock_t = std::chrono::steady_clock;

    std::string repeat_token(const std::string_view token, int count) {
        std::string result;
        result.reserve(static_cast<size_t>(count) * token.size());
        for (int i = 0; i < count; ++i) { result += token; }
        return result;
    }

    int64_t apply_uniform_replace_transaction(omega_session_t *session_ptr, int match_count,
                                              const std::string_view from_token,
                                              const std::string_view to_token) {
        if (!session_ptr) { return -1; }
        if (0 != omega_session_begin_transaction(session_ptr)) { return -1; }

        int64_t last_serial = 0;
        for (int i = match_count - 1; i >= 0; --i) {
            last_serial = omega_edit_replace(session_ptr, static_cast<int64_t>(i) * static_cast<int64_t>(from_token.size()),
                                             static_cast<int64_t>(from_token.size()), to_token.data(),
                                             static_cast<int64_t>(to_token.size()));
            if (last_serial <= 0) { return -1; }
        }

        if (0 != omega_session_end_transaction(session_ptr)) { return -1; }
        return last_serial;
    }

    double millis_between(const clock_t::time_point &begin, const clock_t::time_point &end) {
        return std::chrono::duration<double, std::milli>(end - begin).count();
    }
}// namespace

TEST_CASE("Benchmark stacked replace-style transaction undo latency", "[UndoBenchmark]") {
    constexpr int match_count = 1000;
    constexpr int transaction_rounds = 7;
    const std::string short_token = "PDF";
    const std::string long_token = "Everybody Wang Chung Tonight";

    auto *session_ptr = omega_edit_create_session(nullptr, nullptr, nullptr, NO_EVENTS, nullptr);
    REQUIRE(session_ptr);

    const auto original_content = repeat_token(short_token, match_count);
    REQUIRE(0 < omega_edit_insert_string(session_ptr, 0, original_content));

    std::string current_token = short_token;
    std::string next_token = long_token;
    for (int round = 0; round < transaction_rounds; ++round) {
        REQUIRE(0 < apply_uniform_replace_transaction(session_ptr, match_count, current_token, next_token));
        std::swap(current_token, next_token);
    }

    std::vector<double> undo_latencies_ms;
    undo_latencies_ms.reserve(transaction_rounds);
    for (int round = 0; round < transaction_rounds; ++round) {
        const auto begin = clock_t::now();
        const auto undo_serial = omega_edit_undo_last_change(session_ptr);
        const auto end = clock_t::now();

        REQUIRE(undo_serial < 0);
        undo_latencies_ms.push_back(millis_between(begin, end));
    }

    REQUIRE(omega_session_get_segment_string(session_ptr, 0, omega_session_get_computed_file_size(session_ptr)) ==
            original_content);

    const auto minmax = std::minmax_element(undo_latencies_ms.begin(), undo_latencies_ms.end());
    const auto total = std::accumulate(undo_latencies_ms.begin(), undo_latencies_ms.end(), 0.0);
    const auto average = total / static_cast<double>(undo_latencies_ms.size());

    std::cout << "\nUndo benchmark: " << transaction_rounds << " stacked replace-style transactions, "
              << match_count << " matches each\n";
    for (size_t i = 0; i < undo_latencies_ms.size(); ++i) {
        std::cout << "  undo " << (i + 1) << ": " << undo_latencies_ms[i] << " ms\n";
    }
    std::cout << "  avg: " << average << " ms\n";
    std::cout << "  min: " << *minmax.first << " ms\n";
    std::cout << "  max: " << *minmax.second << " ms\n";

    omega_edit_destroy_session(session_ptr);
}
