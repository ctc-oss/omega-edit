/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License");                                                    *
 * you may not use this file except in compliance with the License.                                                   *
 * You may obtain a copy of the License at                                                                            *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software                                                *
 * distributed under the License is distributed on an "AS IS" BASIS,                                                  *
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                                           *
 * See the License for the specific language governing permissions and                                                *
 * limitations under the License.                                                                                     *
 **********************************************************************************************************************/

#include "../include/session.h"
#include "../include/viewport.h"
#include "impl_/change_def.h"
#include "impl_/internal_fun.h"
#include "impl_/session_def.h"
#include <algorithm>
#include <memory>

int64_t omega_session_get_viewport_max_capacity(const omega_session_t *session_ptr) {
    return session_ptr->viewport_max_capacity;
}

void *omega_session_get_user_data(const omega_session_t *session_ptr) { return session_ptr->user_data_ptr; }

size_t omega_session_get_num_viewports(const omega_session_t *session_ptr) { return session_ptr->viewports_.size(); }

int64_t omega_session_get_offset(const omega_session_t *session_ptr) { return session_ptr->offset; }

int64_t omega_session_get_length(const omega_session_t *session_ptr) { return session_ptr->length; }

omega_session_t *omega_session_create(const char *file_path, omega_session_on_change_cbk_t cbk, void *user_data_ptr,
                                      int64_t viewport_max_capacity, int64_t offset, int64_t length) {
    if (0 <= viewport_max_capacity) {
        FILE *file_ptr = nullptr;
        if (file_path) {
            file_ptr = fopen(file_path, "r");
            if (!file_ptr) { return nullptr; }
        }
        off_t file_size = 0;
        if (file_ptr) {
            if (0 != fseeko(file_ptr, 0L, SEEK_END)) { return nullptr; }
            file_size = ftello(file_ptr);
        }
        if (0 <= file_size && offset + length <= file_size) {
            const auto session_ptr = new omega_session_t;

            session_ptr->serial = 0;
            session_ptr->file_ptr = file_ptr;
            session_ptr->file_path = (file_path) ? std::string(file_path) : std::string();
            session_ptr->viewport_max_capacity =
                    (viewport_max_capacity) ? viewport_max_capacity : DEFAULT_VIEWPORT_MAX_CAPACITY;
            session_ptr->on_change_cbk = cbk;
            session_ptr->user_data_ptr = user_data_ptr;
            session_ptr->offset = offset;
            session_ptr->length = (length) ? std::min(length, (file_size - offset)) : (file_size - offset);
            session_ptr->model_ptr_ = std::make_shared<omega_model_t>();
            initialize_model_segments_(session_ptr->model_ptr_->model_segments, session_ptr->offset,
                                       session_ptr->length);
            return session_ptr;
        }
    }
    return nullptr;
}

const char *omega_session_get_file_path(const omega_session_t *session_ptr) {
    return (session_ptr->file_path.empty()) ? nullptr : session_ptr->file_path.c_str();
}

void omega_session_destroy(omega_session_t *session_ptr) {
    if (session_ptr->file_ptr) { fclose(session_ptr->file_ptr); }
    while (!session_ptr->viewports_.empty()) { omega_viewport_destroy(session_ptr->viewports_.back().get()); }
    for (auto &change_ptr : session_ptr->model_ptr_->changes) {
        if (change_ptr->kind != change_kind_t::CHANGE_DELETE && 7 < change_ptr->length) {
            const_cast<omega_change_t *>(change_ptr.get())->data.bytes.reset();
        }
    }
    delete session_ptr;
}
