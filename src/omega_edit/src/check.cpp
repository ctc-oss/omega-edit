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

#include "../include/check.h"
#include "impl_/change_def.hpp"
#include "impl_/internal_fun.hpp"
#include "impl_/macros.hpp"
#include "impl_/model_def.hpp"
#include "impl_/session_def.hpp"
#include <cassert>

int omega_check_model(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->model_ptr_);
    int64_t expected_offset = 0;
    for (const auto &segment : session_ptr->model_ptr_->model_segments) {
        assert(segment->change_ptr);
        if (expected_offset != segment->computed_offset ||
            (segment->change_offset + segment->computed_length) > segment->change_ptr->length) {
            print_model_segments_(session_ptr->model_ptr_.get(), CLOG);
            return -1;
        }
        expected_offset += segment->computed_length;
    }
    return 0;
}
