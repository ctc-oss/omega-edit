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

#include "../include/omega_edit/check.h"
#include "impl_/change_def.hpp"
#include "impl_/internal_fun.hpp"
#include "impl_/macros.h"
#include "impl_/model_def.hpp"
#include "impl_/session_def.hpp"
#include <cassert>

int omega_check_model(const omega_session_t *session_ptr) {
    assert(session_ptr);
    int64_t expected_offset = 0;
    if (!session_ptr->models_.empty()) {
        for (auto &&model_ptr : session_ptr->models_) {
            assert(model_ptr);
            for (const auto &segment : model_ptr->model_segments) {
                assert(segment->change_ptr);
                if (expected_offset != segment->computed_offset ||
                    (segment->change_offset + segment->computed_length) > segment->change_ptr->length) {
                    print_model_segments_(session_ptr->models_.back().get(), CLOG);
                    return -1;
                }
                expected_offset += segment->computed_length;
            }
        }
        if (1 != session_ptr->models_.front()->model_segments.front()->change_ptr->serial ||
            0 != (session_ptr->models_.front()->model_segments.front()->change_ptr->kind &
                  OMEGA_CHANGE_TRANSACTION_BIT)) {
            return -1;
        }
    }
    return 0;
}
