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

#include "../include/omega_edit/session.h"
#include "impl_/change_def.hpp"
#include "impl_/internal_fun.hpp"
#include "impl_/model_def.hpp"
#include "impl_/segment_def.hpp"
#include "impl_/session_def.hpp"
#include <cassert>

enum class session_flags { pause_viewport_callbacks = 1, session_changes_paused = 1 << 1 };

void *omega_session_get_user_data_ptr(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return session_ptr->user_data_ptr;
}

int omega_session_get_segment(const omega_session_t *session_ptr, omega_segment_t *data_segment_ptr, int64_t offset) {
    assert(session_ptr);
    assert(data_segment_ptr);
    data_segment_ptr->offset = offset;
    return populate_data_segment_(session_ptr, data_segment_ptr);
}

int64_t omega_session_get_num_viewports(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return (int64_t) session_ptr->viewports_.size();
}

int64_t omega_session_get_num_search_contexts(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return (int64_t) session_ptr->search_contexts_.size();
}

int64_t omega_session_get_computed_file_size(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    const auto computed_file_size =
            session_ptr->models_.back()->model_segments.empty()
                    ? 0
                    : session_ptr->models_.back()->model_segments.back()->computed_offset +
                              session_ptr->models_.back()->model_segments.back()->computed_length;
    assert(0 <= computed_file_size);
    return computed_file_size;
}

int64_t omega_session_get_num_changes(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    return (int64_t) session_ptr->models_.back()->changes.size() + session_ptr->num_changes_adjustment_;
}

int64_t omega_session_get_num_undone_changes(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    return (int64_t) session_ptr->models_.back()->changes_undone.size();
}

const omega_change_t *omega_session_get_last_change(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    return session_ptr->models_.back()->changes.empty() ? nullptr : session_ptr->models_.back()->changes.back().get();
}

const omega_change_t *omega_session_get_last_undo(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    return session_ptr->models_.back()->changes_undone.empty()
                   ? nullptr
                   : session_ptr->models_.back()->changes_undone.back().get();
}

const char *omega_session_get_file_path(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return session_ptr->models_.back()->file_path.empty() ? nullptr : session_ptr->models_.back()->file_path.c_str();
}

omega_session_event_cbk_t omega_session_get_event_cbk(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return session_ptr->event_handler;
}

int32_t omega_session_get_event_interest(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return session_ptr->event_interest_;
}

int32_t omega_session_set_event_interest(omega_session_t *session_ptr, int32_t event_interest) {
    assert(session_ptr);
    session_ptr->event_interest_ = event_interest;
    return omega_session_get_event_interest(session_ptr);
}

const omega_change_t *omega_session_get_change(const omega_session_t *session_ptr, int64_t change_serial) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    if (0 < change_serial) {// Positive serials are active changes
        if (change_serial <= omega_session_get_num_changes(session_ptr)) {
            return session_ptr->models_.back()->changes[change_serial - 1].get();
        }
    } else if (change_serial < 0) {// Negative serials are undone changes
        for (auto iter = session_ptr->models_.back()->changes_undone.crbegin();
             iter != session_ptr->models_.back()->changes_undone.crend(); ++iter) {
            if (omega_change_get_serial(iter->get()) == change_serial) { return iter->get(); }
        }
    }
    return nullptr;
}

int omega_session_viewport_event_callbacks_paused(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return (session_ptr->session_flags_ & (int8_t) session_flags::pause_viewport_callbacks) ? 1 : 0;
}

void omega_session_pause_viewport_event_callbacks(omega_session_t *session_ptr) {
    assert(session_ptr);
    session_ptr->session_flags_ |= (int8_t) session_flags::pause_viewport_callbacks;
}

void omega_session_resume_viewport_event_callbacks(omega_session_t *session_ptr) {
    assert(session_ptr);
    session_ptr->session_flags_ &= ~(int8_t) session_flags::pause_viewport_callbacks;
}

int omega_session_changes_paused(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return session_ptr->session_flags_ & (int8_t) session_flags::session_changes_paused ? 1 : 0;
}

void omega_session_pause_changes(omega_session_t *session_ptr) {
    assert(session_ptr);
    if (!omega_session_changes_paused(session_ptr)) {
        session_ptr->session_flags_ |= (int8_t) session_flags::session_changes_paused;
        omega_session_notify(session_ptr, SESSION_EVT_CHANGES_PAUSED, nullptr);
    }
}

void omega_session_resume_changes(omega_session_t *session_ptr) {
    assert(session_ptr);
    if (omega_session_changes_paused(session_ptr)) {
        session_ptr->session_flags_ &= ~(int8_t) session_flags::session_changes_paused;
        omega_session_notify(session_ptr, SESSION_EVT_CHANGES_RESUMED, nullptr);
    }
}

int64_t omega_session_get_num_checkpoints(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return static_cast<int64_t>(session_ptr->models_.size()) - 1;
}

void omega_session_notify(const omega_session_t *session_ptr, omega_session_event_t session_event,
                          const omega_change_t *change_ptr) {
    assert(session_ptr);
    if (session_ptr->event_handler &&
        (session_event & session_ptr->event_interest_)) {
        (*session_ptr->event_handler)(session_ptr, session_event, reinterpret_cast<const void *>(change_ptr));
    }
}
