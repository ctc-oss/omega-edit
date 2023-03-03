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

#include "omega_edit/session.h"
#include "impl_/change_def.hpp"
#include "impl_/internal_fun.hpp"
#include "impl_/model_def.hpp"
#include "impl_/segment_def.hpp"
#include "impl_/session_def.hpp"
#include "omega_edit/fwd_defs.h"
#include "omega_edit/segment.h"
#include "omega_edit/viewport.h"
#include <cassert>
#include <cstring>

#define PROFILE_SEGMENT_CAPACITY (1024 * 8)


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
    return (session_ptr->session_flags_ & SESSION_FLAGS_PAUSE_VIEWPORT_CALLBACKS) ? 1 : 0;
}

void omega_session_pause_viewport_event_callbacks(omega_session_t *session_ptr) {
    assert(session_ptr);
    session_ptr->session_flags_ |= SESSION_FLAGS_PAUSE_VIEWPORT_CALLBACKS;
}

void omega_session_resume_viewport_event_callbacks(omega_session_t *session_ptr) {
    assert(session_ptr);
    session_ptr->session_flags_ &= ~SESSION_FLAGS_PAUSE_VIEWPORT_CALLBACKS;
}

int omega_session_notify_changed_viewports(const omega_session_t *session_ptr) {
    assert(session_ptr);
    int result = 0;
    for (const auto &viewport : session_ptr->viewports_) {
        if (omega_viewport_has_changes(viewport.get())) {
            omega_viewport_notify(viewport.get(), VIEWPORT_EVT_CHANGES, nullptr);
            ++result;
        }
    }
    return result;
}

int omega_session_changes_paused(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return session_ptr->session_flags_ & SESSION_FLAGS_SESSION_CHANGES_PAUSED ? 1 : 0;
}

void omega_session_pause_changes(omega_session_t *session_ptr) {
    assert(session_ptr);
    if (!omega_session_changes_paused(session_ptr)) {
        session_ptr->session_flags_ |= SESSION_FLAGS_SESSION_CHANGES_PAUSED;
        omega_session_notify(session_ptr, SESSION_EVT_CHANGES_PAUSED, nullptr);
    }
}

void omega_session_resume_changes(omega_session_t *session_ptr) {
    assert(session_ptr);
    if (omega_session_changes_paused(session_ptr)) {
        session_ptr->session_flags_ &= ~SESSION_FLAGS_SESSION_CHANGES_PAUSED;
        omega_session_notify(session_ptr, SESSION_EVT_CHANGES_RESUMED, nullptr);
    }
}

int omega_session_begin_transaction(omega_session_t *session_ptr) {
    assert(session_ptr);
    // If a transaction is already open or in progress, then indicate failure
    if (omega_session_get_transaction_state(session_ptr)) { return -1; }
    session_ptr->session_flags_ |= SESSION_FLAGS_SESSION_TRANSACTION_OPENED;
    return 0;
}

int omega_session_end_transaction(omega_session_t *session_ptr) {
    assert(session_ptr);
    // If a transaction is not open or in progress, then indicate failure
    if (!omega_session_get_transaction_state(session_ptr)) { return -1; }
    session_ptr->session_flags_ &=
            ~(SESSION_FLAGS_SESSION_TRANSACTION_OPENED | SESSION_FLAGS_SESSION_TRANSACTION_IN_PROGRESS);
    return 0;
}

int omega_session_get_transaction_state(const omega_session_t *session_ptr) {
    assert(session_ptr);
    if (session_ptr->session_flags_ & SESSION_FLAGS_SESSION_TRANSACTION_OPENED) {
        if (session_ptr->session_flags_ & SESSION_FLAGS_SESSION_TRANSACTION_IN_PROGRESS) {
            return 2;// Transaction in progress
        }
        return 1;// Transaction opened
    } else {
        // If there is no transaction opened, then there should be no transaction in progress
        assert(0 == (session_ptr->session_flags_ & SESSION_FLAGS_SESSION_TRANSACTION_IN_PROGRESS));
        return 0;// No transaction
    }
}

int64_t omega_session_get_num_change_transactions(const omega_session_t *session_ptr) {
    assert(session_ptr);
    int64_t result = 0;
    // Count the number of transactions in each model
    for (const auto &model : session_ptr->models_) {
        int64_t transactions_in_model = 0;
        bool transaction_bit = false;
        // Count the number of transactions in this model
        for (const auto &change : model->changes) {
            // If the transaction bit is different from the current transaction bit, then we have a new transaction
            if (transactions_in_model) {
                if (transaction_bit != omega_change_get_transaction_bit_(change.get())) {
                    transaction_bit = !transaction_bit;
                    ++transactions_in_model;
                }
            } else {
                transaction_bit = omega_change_get_transaction_bit_(change.get());
                ++transactions_in_model;
            }
        }
        result += transactions_in_model;
    }
    return result;
}

int64_t omega_session_get_num_undone_change_transactions(const omega_session_t *session_ptr) {
    assert(session_ptr);
    int64_t result = 0;
    // Count the number of transactions in each model
    for (const auto &model : session_ptr->models_) {
        int64_t transactions_in_model = 0;
        bool transaction_bit = false;
        // Count the number of transactions in this model
        for (const auto &change : model->changes_undone) {
            // If the transaction bit is different from the current transaction bit, then we have a new transaction
            if (transactions_in_model) {
                if (transaction_bit != omega_change_get_transaction_bit_(change.get())) {
                    transaction_bit = !transaction_bit;
                    ++transactions_in_model;
                }
            } else {
                transaction_bit = omega_change_get_transaction_bit_(change.get());
                ++transactions_in_model;
            }
        }
        result += transactions_in_model;
    }
    return result;
}

int64_t omega_session_get_num_checkpoints(const omega_session_t *session_ptr) {
    assert(session_ptr);
    return static_cast<int64_t>(session_ptr->models_.size()) - 1;
}

void omega_session_notify(const omega_session_t *session_ptr, omega_session_event_t session_event,
                          const void *event_ptr) {
    assert(session_ptr);
    if (session_ptr->event_handler && (session_event & session_ptr->event_interest_)) {
        (*session_ptr->event_handler)(session_ptr, session_event, event_ptr);
    }
}

int omega_session_profile(const omega_session_t *session_ptr, omega_byte_frequency_profile_t *profile_ptr,
                          int64_t offset, int64_t length) {
    assert(session_ptr);
    assert(profile_ptr);
    assert(0 <= offset);
    length = length ? length : omega_session_get_computed_file_size(session_ptr) - offset;
    assert(0 <= length);
    assert(offset + length <= omega_session_get_computed_file_size(session_ptr));
    memset(profile_ptr, 0, sizeof(omega_byte_frequency_profile_t));
    auto segment_ptr = omega_segment_create(std::min(length, (int64_t) PROFILE_SEGMENT_CAPACITY));
    while (length) {
        if (const auto rc = omega_session_get_segment(session_ptr, segment_ptr, offset) != 0) { return rc; }
        const auto profile_length = std::min(length, omega_segment_get_length(segment_ptr));
        const auto segment_data = omega_segment_get_data(segment_ptr);
        for (auto i = 0; i < profile_length; ++i) { ++(*profile_ptr)[segment_data[i]]; }
        offset += profile_length;
        length -= profile_length;
    }
    return 0;
}

bool omega_session_get_transaction_bit_(const omega_session_t *session_ptr) {
    return (session_ptr->models_.back()->changes.empty()) ||
           omega_change_get_transaction_bit_(session_ptr->models_.back()->changes.back().get());
}
