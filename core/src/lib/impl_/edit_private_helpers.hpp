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

#ifndef OMEGA_EDIT_PRIVATE_HELPERS_HPP
#define OMEGA_EDIT_PRIVATE_HELPERS_HPP

#include "../../include/omega_edit/edit.h"
#include "../../include/omega_edit/search.h"
#include "../../include/omega_edit/session.h"
#include "../../include/omega_edit/utility.h"
#include "change_def.hpp"
#include "data_def.hpp"
#include "model_def.hpp"
#include "safe_math.hpp"
#include "session_def.hpp"
#include <cstdio>
#include <cstring>
#include <limits>
#include <memory>
#include <new>
#include <string>

namespace omega_edit::internal {

    inline int64_t next_change_serial_(const omega_session_t *session_ptr) {
        const auto change_count = omega_session_get_num_changes(session_ptr);
        return change_count < (std::numeric_limits<int64_t>::max)() ? change_count + 1 : 0;
    }

    inline auto del_(int64_t serial, int64_t offset, int64_t length, bool transaction_bit) -> const_omega_change_ptr_t {
        // serial == 0 is used internally while decomposing OVERWRITE into DELETE+INSERT model updates.
        // Public delete entry points validate serial/range before creating DELETE changes.
        try {
            const auto change_ptr = std::make_shared<omega_change_t>();
            change_ptr->serial = serial;
            change_ptr->kind =
                    (transaction_bit ? OMEGA_CHANGE_TRANSACTION_BIT : 0x00) | (uint8_t) change_kind_t::CHANGE_DELETE;
            change_ptr->offset = offset;
            change_ptr->length = length;
            return change_ptr;
        } catch (const std::bad_alloc &) { return nullptr; }
    }

    inline auto populate_change_bytes_(omega_change_t *change_ptr, const omega_byte_t *bytes) -> bool {
        try {
            omega_data_create_(&change_ptr->data, change_ptr->length);
            auto *const change_data = omega_data_get_data_(&change_ptr->data, change_ptr->length);
            if (!change_data) { return false; }
            std::memcpy(change_data, bytes, change_ptr->length);
            change_data[change_ptr->length] = '\0';
            return true;
        } catch (const std::bad_alloc &) { return false; }
    }

    inline auto ins_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length,
                     bool transaction_bit) -> const_omega_change_ptr_t {
        if (!bytes) { return nullptr; }
        if (serial <= 0 || !valid_nonnegative_range_(offset, length)) { return nullptr; }
        try {
            auto change_ptr = std::make_shared<omega_change_t>();
            change_ptr->serial = serial;
            change_ptr->kind =
                    (transaction_bit ? OMEGA_CHANGE_TRANSACTION_BIT : 0x00) | (uint8_t) change_kind_t::CHANGE_INSERT;
            change_ptr->offset = offset;
            change_ptr->length = length;
            if (!populate_change_bytes_(change_ptr.get(), bytes)) { return nullptr; }
            return change_ptr;
        } catch (const std::bad_alloc &) { return nullptr; }
    }

    inline auto ovr_(int64_t serial, int64_t offset, const omega_byte_t *bytes, int64_t length,
                     bool transaction_bit) -> const_omega_change_ptr_t {
        if (!bytes) { return nullptr; }
        if (serial <= 0 || !valid_nonnegative_range_(offset, length)) { return nullptr; }
        try {
            auto change_ptr = std::make_shared<omega_change_t>();
            change_ptr->serial = serial;
            change_ptr->kind =
                    (transaction_bit ? OMEGA_CHANGE_TRANSACTION_BIT : 0x00) | (uint8_t) change_kind_t::CHANGE_OVERWRITE;
            change_ptr->offset = offset;
            change_ptr->length = length;
            if (!populate_change_bytes_(change_ptr.get(), bytes)) { return nullptr; }
            return change_ptr;
        } catch (const std::bad_alloc &) { return nullptr; }
    }

    inline auto transform_(int64_t serial, int64_t offset, int64_t length, const char *transform_id,
                           const char *options_json, int64_t replacement_length, int64_t file_size_before,
                           int64_t file_size_after, const char *checkpoint_file_path,
                           bool transaction_bit) -> const_omega_change_ptr_t {
        if (serial <= 0 || !valid_nonnegative_range_(offset, length) || replacement_length < 0 ||
            file_size_before < 0 || file_size_after < 0 || !checkpoint_file_path || !*checkpoint_file_path) {
            return nullptr;
        }
        try {
            auto change_ptr = std::make_shared<omega_change_t>();
            change_ptr->serial = serial;
            change_ptr->kind =
                    (transaction_bit ? OMEGA_CHANGE_TRANSACTION_BIT : 0x00) | (uint8_t) change_kind_t::CHANGE_TRANSFORM;
            change_ptr->offset = offset;
            change_ptr->length = length;
            change_ptr->transform_data = std::make_unique<omega_transform_change_data_struct>();
            change_ptr->transform_data->transform_id = (transform_id && *transform_id) ? transform_id : "transform";
            if (options_json) { change_ptr->transform_data->options_json = options_json; }
            change_ptr->transform_data->replacement_length = replacement_length;
            change_ptr->transform_data->computed_file_size_before = file_size_before;
            change_ptr->transform_data->computed_file_size_after = file_size_after;
            change_ptr->transform_data->checkpoint_file_path = checkpoint_file_path;
            return change_ptr;
        } catch (const std::bad_alloc &) { return nullptr; }
    }

    inline auto restore_viewport_callbacks_(omega_session_t *session_ptr, bool callbacks_were_paused,
                                            bool notify_changed_viewports) -> void {
        if (!session_ptr || callbacks_were_paused) { return; }
        omega_session_resume_viewport_event_callbacks(session_ptr);
        if (notify_changed_viewports) { omega_session_notify_changed_viewports(session_ptr); }
    }

    class scoped_transaction_t {
    public:
        explicit scoped_transaction_t(omega_session_t *session_ptr) : session_ptr_(session_ptr) {
            if (!session_ptr_) {
                begin_result_ = -1;
                return;
            }
            if (omega_session_get_transaction_state(session_ptr_) == 0) {
                begin_result_ = omega_session_begin_transaction(session_ptr_);
                owns_transaction_ = (begin_result_ == 0);
            }
        }

        ~scoped_transaction_t() {
            if (owns_transaction_) { omega_session_end_transaction(session_ptr_); }
        }

        bool ok() const { return begin_result_ == 0; }

    private:
        omega_session_t *session_ptr_{};
        int begin_result_{0};
        bool owns_transaction_{false};
    };

    class scoped_session_event_batch_t {
    public:
        scoped_session_event_batch_t(omega_session_t *session_ptr, omega_session_event_t session_event)
            : session_ptr_(session_ptr) {
            omega_session_begin_event_batch_(session_ptr_, session_event);
        }

        ~scoped_session_event_batch_t() { omega_session_end_event_batch_(session_ptr_); }

    private:
        omega_session_t *session_ptr_{};
    };

    class scoped_search_context_t {
    public:
        explicit scoped_search_context_t(omega_search_context_t *context_ptr) : context_ptr_(context_ptr) {}

        ~scoped_search_context_t() { reset(); }

        scoped_search_context_t(const scoped_search_context_t &) = delete;
        auto operator=(const scoped_search_context_t &) -> scoped_search_context_t & = delete;

        auto get() const -> omega_search_context_t * { return context_ptr_; }

        void reset(omega_search_context_t *context_ptr = nullptr) {
            if (context_ptr_ != nullptr) { omega_search_destroy_context(context_ptr_); }
            context_ptr_ = context_ptr;
        }

    private:
        omega_search_context_t *context_ptr_{};
    };

    struct session_stream_cursor_t {
        const omega_session_t *session_ptr{};
        omega_model_segments_t::const_iterator segment_iter{};
        omega_model_segments_t::const_iterator segment_end{};
        int64_t offset{};
    };

    inline auto is_builtin_transform_kind_(omega_edit_transform_kind_t kind) -> bool {
        switch (kind) {
            case OMEGA_EDIT_TRANSFORM_ASCII_TO_UPPER:
            case OMEGA_EDIT_TRANSFORM_ASCII_TO_LOWER:
            case OMEGA_EDIT_TRANSFORM_BITWISE_AND:
            case OMEGA_EDIT_TRANSFORM_BITWISE_OR:
            case OMEGA_EDIT_TRANSFORM_BITWISE_XOR:
                return true;
            default:
                return false;
        }
    }

    inline auto builtin_transform_id_(omega_edit_transform_kind_t kind) -> const char * {
        switch (kind) {
            case OMEGA_EDIT_TRANSFORM_ASCII_TO_UPPER:
                return "builtin:ascii-to-upper";
            case OMEGA_EDIT_TRANSFORM_ASCII_TO_LOWER:
                return "builtin:ascii-to-lower";
            case OMEGA_EDIT_TRANSFORM_BITWISE_AND:
                return "builtin:bitwise-and";
            case OMEGA_EDIT_TRANSFORM_BITWISE_OR:
                return "builtin:bitwise-or";
            case OMEGA_EDIT_TRANSFORM_BITWISE_XOR:
                return "builtin:bitwise-xor";
            default:
                return "builtin:unknown";
        }
    }

    inline auto builtin_transform_options_json_(const omega_edit_transform_t &transform) -> std::string {
        switch (transform.kind) {
            case OMEGA_EDIT_TRANSFORM_BITWISE_AND:
            case OMEGA_EDIT_TRANSFORM_BITWISE_OR:
            case OMEGA_EDIT_TRANSFORM_BITWISE_XOR: {
                char buffer[32];
                std::snprintf(buffer, sizeof(buffer), "{\"operand\":%u}", static_cast<unsigned>(transform.operand));
                return buffer;
            }
            default:
                return {};
        }
    }

    inline omega_byte_t apply_builtin_transform_(omega_byte_t byte, void *user_data_ptr) {
        const auto *const transform_ptr = reinterpret_cast<const omega_edit_transform_t *>(user_data_ptr);
        switch (transform_ptr->kind) {
            case OMEGA_EDIT_TRANSFORM_ASCII_TO_UPPER:
                return (byte >= 'a' && byte <= 'z') ? static_cast<omega_byte_t>(byte - ('a' - 'A')) : byte;
            case OMEGA_EDIT_TRANSFORM_ASCII_TO_LOWER:
                return (byte >= 'A' && byte <= 'Z') ? static_cast<omega_byte_t>(byte + ('a' - 'A')) : byte;
            case OMEGA_EDIT_TRANSFORM_BITWISE_AND:
                return omega_util_mask_byte(byte, transform_ptr->operand, MASK_AND);
            case OMEGA_EDIT_TRANSFORM_BITWISE_OR:
                return omega_util_mask_byte(byte, transform_ptr->operand, MASK_OR);
            case OMEGA_EDIT_TRANSFORM_BITWISE_XOR:
                return omega_util_mask_byte(byte, transform_ptr->operand, MASK_XOR);
            default:
                return byte;
        }
    }

}// namespace omega_edit::internal

#endif//OMEGA_EDIT_PRIVATE_HELPERS_HPP
