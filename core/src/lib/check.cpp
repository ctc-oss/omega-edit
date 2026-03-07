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
#include "../include/omega_edit/session.h"
#include "impl_/change_def.hpp"
#include "impl_/internal_fun.hpp"
#include "impl_/macros.h"
#include "impl_/session_def.hpp"
#include <cassert>

int omega_check_model(const omega_session_t *session_ptr) {
    if (!session_ptr) { return -1; }
    if (session_ptr->models_.empty()) { return -1; }// session must have at least one model

    for (size_t model_index = 0; model_index < session_ptr->models_.size(); ++model_index) {
        const auto &model_ptr = session_ptr->models_[model_index];
        if (!model_ptr) { return -1; }

        int64_t expected_offset = 0;
        for (const auto &segment: model_ptr->model_segments) {
            // Each segment must reference a valid change
            if (!segment || !segment->change_ptr) { return -1; }

            // Segment offsets must be non-negative
            if (segment->computed_offset < 0 || segment->computed_length < 0 || segment->change_offset < 0) {
                print_model_segments_(model_ptr.get(), CLOG);
                return -1;
            }

            // Segments must have positive length (zero-length segments are not valid in the model)
            if (segment->computed_length == 0) {
                print_model_segments_(model_ptr.get(), CLOG);
                return -1;
            }

            // Segments must be contiguous (no gaps or overlaps)
            if (expected_offset != segment->computed_offset) {
                print_model_segments_(model_ptr.get(), CLOG);
                return -1;
            }

            // Segment must not extend beyond its parent change data
            if (segment->change_offset + segment->computed_length > segment->change_ptr->length) {
                print_model_segments_(model_ptr.get(), CLOG);
                return -1;
            }

            // change_offset must not exceed the change length
            if (segment->change_offset >= segment->change_ptr->length) {
                print_model_segments_(model_ptr.get(), CLOG);
                return -1;
            }

            expected_offset += segment->computed_length;
        }

        // Checkpoint models (index > 0) must have a backing file
        if (model_index > 0 && !model_ptr->file_ptr) { return -1; }
    }

    // Cross-check: the back model's total segment length must match the session's computed file size
    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    const auto &back_model = session_ptr->models_.back();
    const int64_t model_total_length = back_model->model_segments.empty()
                                               ? 0
                                               : back_model->model_segments.back()->computed_offset +
                                                         back_model->model_segments.back()->computed_length;
    if (model_total_length != computed_file_size) { return -1; }

    return 0;
}
