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

#include "../include/session.h"
#include "impl_/change_def.hpp"
#include "impl_/model_def.hpp"
#include "impl_/session_def.hpp"
#include <cassert>

enum session_flags { pause_viewport_callbacks = 0x01 };

void *omega_session_get_user_data(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return session_ptr->user_data_ptr;
}

size_t omega_session_get_num_viewports(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return session_ptr->viewports_.size();
}

int64_t omega_session_get_computed_file_size(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->model_ptr_);
    const auto computed_file_size = (session_ptr->model_ptr_->model_segments.empty())
                                            ? 0
                                            : session_ptr->model_ptr_->model_segments.back()->computed_offset +
                                                      session_ptr->model_ptr_->model_segments.back()->computed_length;
    assert(0 <= computed_file_size);
    return computed_file_size;
}

size_t omega_session_get_num_changes(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->model_ptr_);
    return session_ptr->model_ptr_->changes.size();
}

size_t omega_session_get_num_undone_changes(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->model_ptr_);
    return session_ptr->model_ptr_->changes_undone.size();
}

const omega_change_t *omega_session_get_last_change(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->model_ptr_);
    return (session_ptr->model_ptr_->changes.empty()) ? nullptr : session_ptr->model_ptr_->changes.back().get();
}

const omega_change_t *omega_session_get_last_undo(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->model_ptr_);
    return (session_ptr->model_ptr_->changes_undone.empty()) ? nullptr
                                                             : session_ptr->model_ptr_->changes_undone.back().get();
}

const char *omega_session_get_file_path(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return (session_ptr->file_path.empty()) ? nullptr : session_ptr->file_path.c_str();
}

const omega_change_t *omega_session_get_change(const omega_session_t *session_ptr, int64_t change_serial) {
    assert(session_ptr);
    assert(session_ptr->model_ptr_);
    if (0 < change_serial) {// Positive serials are active changes
        if (change_serial <= static_cast<int64_t>(omega_session_get_num_changes(session_ptr))) {
            return session_ptr->model_ptr_->changes[change_serial - 1].get();
        }
    } else if (change_serial < 0) {// Negative serials are undone changes
        for (auto iter = session_ptr->model_ptr_->changes_undone.rbegin();
             iter != session_ptr->model_ptr_->changes_undone.rend(); ++iter) {
            if ((*iter)->serial == change_serial) { return iter->get(); }
        }
    }
    return nullptr;
}

int omega_session_viewport_on_change_callbacks_paused(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return (session_ptr->flags_ & pause_viewport_callbacks) ? 1 : 0;
}

void omega_session_pause_viewport_on_change_callbacks(omega_session_t *session_ptr) {
    assert(session_ptr);
    session_ptr->flags_ |= pause_viewport_callbacks;
}

void omega_session_resume_viewport_on_change_callbacks(omega_session_t *session_ptr) {
    assert(session_ptr);
    session_ptr->flags_ &= ~(pause_viewport_callbacks);
}
