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
#include "impl_/session_def.hpp"
#include <cassert>

const char *omega_session_get_file_path_unlocked(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return get_file_path_(session_ptr);
}

const char *omega_session_get_file_path(const omega_session_t *session_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_get_file_path_unlocked(session_ptr);
}

void *omega_session_get_user_data_ptr_unlocked(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return session_ptr->user_data_ptr_;
}

void *omega_session_get_user_data_ptr(const omega_session_t *session_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_get_user_data_ptr_unlocked(session_ptr);
}

int64_t omega_session_get_num_viewports_unlocked(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return (int64_t) session_ptr->viewports_.size();
}

int64_t omega_session_get_num_viewports(const omega_session_t *session_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_get_num_viewports_unlocked(session_ptr);
}

int64_t omega_session_get_computed_file_size_unlocked(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    return get_computed_file_size_(session_ptr);
}

int64_t omega_session_get_computed_file_size(const omega_session_t *session_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_get_computed_file_size_unlocked(session_ptr);
}

int64_t omega_session_get_num_changes_unlocked(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    return get_num_changes_(session_ptr);
}

int64_t omega_session_get_num_changes(const omega_session_t *session_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_get_num_changes_unlocked(session_ptr);
}

int64_t omega_session_get_num_undone_changes_unlocked(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    return (int64_t) session_ptr->models_.back()->changes_undone_.size();
}

int64_t omega_session_get_num_undone_changes(const omega_session_t *session_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_get_num_undone_changes_unlocked(session_ptr);
}

const omega_change_t *omega_session_get_last_change_unlocked(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    return (session_ptr->models_.back()->changes_.empty()) ? nullptr
                                                           : session_ptr->models_.back()->changes_.back().get();
}

const omega_change_t *omega_session_get_last_change(const omega_session_t *session_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_get_last_change_unlocked(session_ptr);
}

const omega_change_t *omega_session_get_last_undo_unlocked(const omega_session_t *session_ptr) {
    assert(session_ptr);
    assert(session_ptr->models_.back());
    return (session_ptr->models_.back()->changes_undone_.empty())
                   ? nullptr
                   : session_ptr->models_.back()->changes_undone_.back().get();
}

const omega_change_t *omega_session_get_last_undo(const omega_session_t *session_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_get_last_undo_unlocked(session_ptr);
}

omega_session_event_cbk_t omega_session_get_event_cbk(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return session_ptr->event_handler_;
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

const omega_change_t *omega_session_get_change_unlocked(const omega_session_t *session_ptr, int64_t change_serial) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    assert(session_ptr->models_.back());
    if (0 < change_serial) {// Positive serials are active changes
        if (change_serial <= omega_session_get_num_changes(session_ptr)) {
            return session_ptr->models_.back()->changes_[change_serial - 1].get();
        }
    } else if (change_serial < 0) {// Negative serials are undone changes
        for (auto iter = session_ptr->models_.back()->changes_undone_.crbegin();
             iter != session_ptr->models_.back()->changes_undone_.crend(); ++iter) {
            if (omega_change_get_serial(iter->get()) == change_serial) { return iter->get(); }
        }
    }
    return nullptr;
}

const omega_change_t *omega_session_get_change(const omega_session_t *session_ptr, int64_t change_serial) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_get_change_unlocked(session_ptr, change_serial);
}

int omega_session_viewport_on_change_callbacks_paused_unlocked(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return on_change_callbacks_paused_(session_ptr);
}

int omega_session_viewport_on_change_callbacks_paused(const omega_session_t *session_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_viewport_on_change_callbacks_paused_unlocked(session_ptr);
}

void omega_session_pause_viewport_event_callbacks_unlocked(omega_session_t *session_ptr) {
    assert(session_ptr);
    pause_viewport_event_callbacks_(session_ptr);
}

void omega_session_pause_viewport_event_callbacks(omega_session_t *session_ptr) {
    assert(session_ptr);
    std::unique_lock ul(session_ptr->session_mutex_);
    omega_session_pause_viewport_event_callbacks_unlocked(session_ptr);
}

void omega_session_resume_viewport_event_callbacks_unlocked(omega_session_t *session_ptr) {
    assert(session_ptr);
    resume_viewport_event_callbacks_(session_ptr);
}

void omega_session_resume_viewport_event_callbacks(omega_session_t *session_ptr) {
    assert(session_ptr);
    std::unique_lock ul(session_ptr->session_mutex_);
    omega_session_resume_viewport_event_callbacks_unlocked(session_ptr);
}

int64_t omega_session_get_num_checkpoints_unlocked(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return get_num_checkpoints_(session_ptr);
}

int64_t omega_session_get_num_checkpoints(const omega_session_t *session_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    return omega_session_get_num_checkpoints_unlocked(session_ptr);
}

void omega_session_notify_unlocked(const omega_session_t *session_ptr, omega_session_event_t session_event,
                                   const omega_change_t *change_ptr) {
    assert(session_ptr);
    session_notify_(session_ptr, session_event, change_ptr);
}

void omega_session_notify(const omega_session_t *session_ptr, omega_session_event_t session_event,
                          const omega_change_t *change_ptr) {
    assert(session_ptr);
    std::shared_lock sl(const_cast<omega_session_t *>(session_ptr)->session_mutex_);
    omega_session_notify_unlocked(session_ptr, session_event, change_ptr);
}
