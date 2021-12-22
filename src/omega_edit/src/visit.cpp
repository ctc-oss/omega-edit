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

#include "../include/visit.h"
#include "impl_/model_def.hpp"
#include "impl_/session_def.hpp"
#include <cassert>

int omega_visit_changes(const omega_session_t *session_ptr, omega_session_change_visitor_cbk_t cbk, void *user_data) {
    assert(session_ptr);
    int rc = 0;
    for (const auto &iter : session_ptr->model_ptr_->changes) {
        if ((rc = cbk(iter.get(), user_data)) != 0) { break; }
    }
    return rc;
}

int omega_visit_changes_reverse(const omega_session_t *session_ptr, omega_session_change_visitor_cbk_t cbk,
                                void *user_data) {
    assert(session_ptr);
    int rc = 0;
    for (auto iter = session_ptr->model_ptr_->changes.rbegin(); iter != session_ptr->model_ptr_->changes.rend();
         ++iter) {
        if ((rc = cbk(iter->get(), user_data)) != 0) { break; }
    }
    return rc;
}

struct omega_visit_change_context_struct {
    const omega_session_t *session_ptr{};
    const omega_change_t *change_ptr{};
    bool reverse{};
    union {
        omega_changes_t::const_iterator *iter_ptr;
        omega_changes_t::const_reverse_iterator *riter_ptr;
    } change_iter{};
    ~omega_visit_change_context_struct() {}// NOLINT This destructor is required, but don't use =default
};

omega_visit_change_context_t *omega_visit_change_create_context(const omega_session_t *session_ptr, int reverse) {
    assert(session_ptr);
    auto *change_context_ptr = new omega_visit_change_context_t;
    assert(change_context_ptr);
    change_context_ptr->session_ptr = session_ptr;
    change_context_ptr->change_ptr = nullptr;
    change_context_ptr->reverse = (0 != reverse);
    change_context_ptr->change_iter.iter_ptr = nullptr;
    return change_context_ptr;
}

int omega_visit_change_next(omega_visit_change_context_t *change_context_ptr) {
    assert(change_context_ptr);
    assert(change_context_ptr->session_ptr);
    assert(change_context_ptr->session_ptr->model_ptr_);
    if (change_context_ptr->session_ptr->model_ptr_->changes.empty()) { return 0; }
    if (change_context_ptr->reverse) {
        if (!change_context_ptr->change_iter.riter_ptr) {
            change_context_ptr->change_iter.riter_ptr = new omega_changes_t::const_reverse_iterator;
            assert(change_context_ptr->change_iter.riter_ptr);
            *change_context_ptr->change_iter.riter_ptr = change_context_ptr->session_ptr->model_ptr_->changes.rbegin();
        } else {
            ++*change_context_ptr->change_iter.riter_ptr;
        }
        return (*change_context_ptr->change_iter.riter_ptr ==
                change_context_ptr->session_ptr->model_ptr_->changes.rend())
                       ? 0
                       : 1;
    }
    if (!change_context_ptr->change_iter.iter_ptr) {
        change_context_ptr->change_iter.iter_ptr = new omega_changes_t::const_iterator;
        assert(change_context_ptr->change_iter.iter_ptr);
        *change_context_ptr->change_iter.iter_ptr = change_context_ptr->session_ptr->model_ptr_->changes.cbegin();
    } else {
        ++*change_context_ptr->change_iter.iter_ptr;
    }
    return (*change_context_ptr->change_iter.iter_ptr == change_context_ptr->session_ptr->model_ptr_->changes.cend())
                   ? 0
                   : 1;
}

const omega_change_t *omega_visit_change_context_get_change(const omega_visit_change_context_t *change_context_ptr) {
    assert(change_context_ptr);
    assert(change_context_ptr->session_ptr);
    assert(change_context_ptr->session_ptr->model_ptr_);
    if (change_context_ptr->reverse) {
        return (!change_context_ptr->change_iter.riter_ptr ||
                *change_context_ptr->change_iter.riter_ptr ==
                        change_context_ptr->session_ptr->model_ptr_->changes.rend())
                       ? nullptr
                       : (*change_context_ptr->change_iter.riter_ptr)->get();
    }
    return (!change_context_ptr->change_iter.iter_ptr ||
            *change_context_ptr->change_iter.iter_ptr == change_context_ptr->session_ptr->model_ptr_->changes.cend())
                   ? nullptr
                   : (*change_context_ptr->change_iter.iter_ptr)->get();
}

void omega_visit_change_destroy_context(omega_visit_change_context_t *change_context_ptr) {
    assert(change_context_ptr);
    delete change_context_ptr->change_iter.iter_ptr;// NOTE: deleting a nullptr is safe as it has no effect
    delete change_context_ptr;
}
