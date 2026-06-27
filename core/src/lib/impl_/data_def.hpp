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

#ifndef OMEGA_EDIT_DATA_DEF_HPP
#define OMEGA_EDIT_DATA_DEF_HPP

#include "../../include/omega_edit/byte.h"
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <new>
#include <utility>

#define DATA_T_SIZE (8)

class omega_data_t {
public:
    omega_data_t() noexcept = default;

    ~omega_data_t() { reset(); }

    omega_data_t(const omega_data_t &) = delete;
    auto operator=(const omega_data_t &) -> omega_data_t & = delete;

    omega_data_t(omega_data_t &&other) noexcept { move_from(std::move(other)); }

    auto operator=(omega_data_t &&other) noexcept -> omega_data_t & {
        if (this != &other) {
            reset();
            move_from(std::move(other));
        }
        return *this;
    }

    auto data() noexcept -> omega_byte_t * {
        if (borrowed_ || uses_heap_(capacity_)) { return storage_.bytes_ptr; }
        return capacity_ >= 0 ? storage_.sm_bytes : nullptr;
    }

    auto data() const noexcept -> const omega_byte_t * {
        if (borrowed_ || uses_heap_(capacity_)) { return storage_.bytes_ptr; }
        return capacity_ >= 0 ? storage_.sm_bytes : nullptr;
    }

    auto capacity() const noexcept -> int64_t { return capacity_; }

    void create(int64_t capacity) {
        validate_capacity_(capacity);
        reset();
        capacity_ = capacity;
        borrowed_ = false;

        if (uses_heap_(capacity_)) {
            storage_.bytes_ptr = new omega_byte_t[static_cast<size_t>(capacity_) + 1U];
        } else {
            std::memset(storage_.sm_bytes, 0, sizeof(storage_.sm_bytes));
        }
        data()[capacity_] = '\0';
    }

    void borrow(omega_byte_t *bytes_ptr, int64_t capacity) {
        validate_capacity_(capacity);
        if (capacity > 0 && bytes_ptr == nullptr) { throw std::bad_array_new_length(); }
        reset();
        storage_.bytes_ptr = bytes_ptr;
        capacity_ = capacity;
        borrowed_ = true;
    }

    void reset() noexcept {
        if (!borrowed_ && uses_heap_(capacity_) && storage_.bytes_ptr != nullptr) { delete[] storage_.bytes_ptr; }
        storage_.bytes_ptr = nullptr;
        capacity_ = -1;
        borrowed_ = false;
    }

private:
    union storage_t {
        omega_byte_t *bytes_ptr;
        omega_byte_t sm_bytes[DATA_T_SIZE];

        storage_t() noexcept : bytes_ptr(nullptr) {}
    };

    static auto uses_heap_(int64_t capacity) noexcept -> bool {
        return static_cast<int64_t>(DATA_T_SIZE) - 1 < capacity;
    }

    static void validate_capacity_(int64_t capacity) {
        if (capacity < 0 || capacity == (std::numeric_limits<int64_t>::max)() ||
            static_cast<uint64_t>(capacity) > static_cast<uint64_t>((std::numeric_limits<size_t>::max)() - 1U)) {
            throw std::bad_array_new_length();
        }
    }

    void move_from(omega_data_t &&other) noexcept {
        capacity_ = other.capacity_;
        borrowed_ = other.borrowed_;
        if (other.borrowed_ || uses_heap_(other.capacity_)) {
            storage_.bytes_ptr = other.storage_.bytes_ptr;
        } else if (other.capacity_ >= 0) {
            std::memcpy(storage_.sm_bytes, other.storage_.sm_bytes, static_cast<size_t>(other.capacity_) + 1U);
        } else {
            storage_.bytes_ptr = nullptr;
        }
        other.storage_.bytes_ptr = nullptr;
        other.capacity_ = -1;
        other.borrowed_ = false;
    }

    storage_t storage_{};
    int64_t capacity_{-1};
    bool borrowed_{false};
};

namespace omega_edit::internal {

    inline omega_byte_t *omega_data_get_data_(omega_data_t *data_ptr, int64_t capacity) {
        (void) capacity;
        return data_ptr ? data_ptr->data() : nullptr;
    }

    inline const omega_byte_t *omega_data_get_data_const_(const omega_data_t *data_ptr, int64_t capacity) {
        (void) capacity;
        return data_ptr ? data_ptr->data() : nullptr;
    }

    inline void omega_data_create_(omega_data_t *data_ptr, int64_t capacity) { data_ptr->create(capacity); }

    inline void omega_data_borrow_(omega_data_t *data_ptr, omega_byte_t *bytes_ptr, int64_t capacity) {
        data_ptr->borrow(bytes_ptr, capacity);
    }

    inline void omega_data_destroy_(omega_data_t *data_ptr, int64_t capacity) {
        (void) capacity;
        if (data_ptr) { data_ptr->reset(); }
    }

}// namespace omega_edit::internal

#endif//OMEGA_EDIT_DATA_DEF_HPP
