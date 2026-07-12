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

#ifndef OMEGA_EDIT_CHANGE_DEF_HPP
#define OMEGA_EDIT_CHANGE_DEF_HPP

#include "../../include/omega_edit/change.h"
#include "../../include/omega_edit/filesystem.h"
#include "data_def.hpp"
#include "internal_fwd_defs.hpp"
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

struct omega_byte_payload_struct;

namespace omega_edit::internal {

    enum class change_kind_t { CHANGE_DELETE = 0, CHANGE_INSERT = 1, CHANGE_OVERWRITE = 2, CHANGE_TRANSFORM = 3 };

    struct compressed_payload_block_t {
        int64_t file_offset{};
        int64_t compressed_length{};
        int64_t uncompressed_length{};
    };

    int omega_payload_compress_file_(omega_byte_payload_struct *payload);
    int omega_payload_read_file_(const omega_byte_payload_struct *payload, int64_t offset, omega_byte_t *buffer,
                                 int64_t byte_count);

}// namespace omega_edit::internal

#define OMEGA_CHANGE_KIND_MASK 0x03
#define OMEGA_CHANGE_TRANSACTION_BIT 0x04

struct omega_byte_payload_struct {
    ~omega_byte_payload_struct() { reset(); }

    void reset() {
        if (storage == OMEGA_CHANGE_DATA_STORAGE_FILE_BACKED && !file_path.empty()) {
            omega_util_remove_file(file_path.c_str());
        }
        omega_edit::internal::omega_data_destroy_(&bytes, length);
        omega_edit::internal::omega_data_destroy_(&cache, length);
        length = 0;
        storage = OMEGA_CHANGE_DATA_STORAGE_NONE;
        file_path.clear();
        compressed_blocks.clear();
    }

    omega_byte_payload_struct() = default;
    omega_byte_payload_struct(const omega_byte_payload_struct &) = delete;
    auto operator=(const omega_byte_payload_struct &) -> omega_byte_payload_struct & = delete;

    omega_byte_payload_struct(omega_byte_payload_struct &&other) noexcept { move_from_(std::move(other)); }

    auto operator=(omega_byte_payload_struct &&other) noexcept -> omega_byte_payload_struct & {
        if (this != &other) {
            reset();
            move_from_(std::move(other));
        }
        return *this;
    }

    omega_data_t bytes{};
    mutable omega_data_t cache{};
    int64_t length{};
    omega_change_data_storage_t storage{OMEGA_CHANGE_DATA_STORAGE_NONE};
    std::string file_path{};
    std::vector<omega_edit::internal::compressed_payload_block_t> compressed_blocks{};

private:
    void move_from_(omega_byte_payload_struct &&other) noexcept {
        bytes = std::move(other.bytes);
        cache = std::move(other.cache);
        length = other.length;
        storage = other.storage;
        file_path.swap(other.file_path);
        compressed_blocks = std::move(other.compressed_blocks);
        other.length = 0;
        other.storage = OMEGA_CHANGE_DATA_STORAGE_NONE;
        other.file_path.clear();
    }
};

struct omega_transform_change_data_struct {
    std::string transform_id{};
    std::string options_json{};
    std::string checkpoint_file_path{};
    std::vector<const_omega_change_ptr_t> preserved_changes_undone{};
    int64_t replacement_length{};
    int64_t computed_file_size_before{};
    int64_t computed_file_size_after{};
};

struct omega_change_struct {
    int64_t serial{};                        ///< Serial number of the change (increasing)
    int64_t offset{};                        ///< Offset at the time of the change
    int64_t length{};                        ///< Number of bytes at the time of the change
    omega_byte_payload_struct data{};        ///< First-class primitive data payload
    omega_byte_payload_struct inverse_data{};///< Bytes removed by the primitive when distinct from data
    uint8_t kind{};                          ///< Change kind
    std::unique_ptr<omega_transform_change_data_struct> transform_data{};
};

namespace omega_edit::internal {

    /**
 * @brief Get the kind of change
 * @param change_ptr change to get the kind from
 * @return change kind
 */
    inline change_kind_t omega_change_get_kind_(const omega_change_t *change_ptr) {
        return static_cast<change_kind_t>(change_ptr->kind & OMEGA_CHANGE_KIND_MASK);
    }

    inline bool omega_change_get_transaction_bit_(const omega_change_t *change_ptr) {
        return change_ptr->kind & OMEGA_CHANGE_TRANSACTION_BIT;
    }

    inline void omega_change_toggle_transaction_bit_(omega_change_t *change_ptr) {
        change_ptr->kind ^= OMEGA_CHANGE_TRANSACTION_BIT;// Toggle the transaction bit
    }

    inline const omega_byte_payload_struct *omega_change_get_payload_(const omega_change_t *change_ptr,
                                                                      omega_change_payload_role_t payload_role) {
        if (!change_ptr) { return nullptr; }
        return payload_role == OMEGA_CHANGE_PAYLOAD_INVERSE_DATA ? &change_ptr->inverse_data : &change_ptr->data;
    }

    inline int64_t omega_change_get_payload_length_(const omega_change_t *change_ptr,
                                                    omega_change_payload_role_t payload_role) {
        const auto *payload = omega_change_get_payload_(change_ptr, payload_role);
        return payload && payload->storage != OMEGA_CHANGE_DATA_STORAGE_NONE ? payload->length : 0;
    }

    inline const omega_byte_t *omega_change_get_inline_payload_bytes_(const omega_change_t *change_ptr,
                                                                      omega_change_payload_role_t payload_role) {
        const auto *payload = omega_change_get_payload_(change_ptr, payload_role);
        if (!payload || payload->storage != OMEGA_CHANGE_DATA_STORAGE_INLINE || payload->length <= 0) {
            return nullptr;
        }
        return omega_data_get_data_const_(&payload->bytes, payload->length);
    }

    inline int omega_change_copy_payload_bytes_(const omega_change_t *change_ptr,
                                                omega_change_payload_role_t payload_role, int64_t offset,
                                                omega_byte_t *buffer, int64_t byte_count) {
        if (!buffer || offset < 0 || byte_count < 0) { return -1; }
        if (byte_count == 0) { return 0; }
        const auto *payload = omega_change_get_payload_(change_ptr, payload_role);
        if (!payload || payload->length < 0 || offset > payload->length || byte_count > payload->length - offset) {
            return -1;
        }
        switch (payload->storage) {
            case OMEGA_CHANGE_DATA_STORAGE_INLINE: {
                const auto *bytes = omega_data_get_data_const_(&payload->bytes, payload->length);
                if (!bytes) { return -1; }
                std::memcpy(buffer, bytes + offset, static_cast<size_t>(byte_count));
                return 0;
            }
            case OMEGA_CHANGE_DATA_STORAGE_FILE_BACKED:
                return omega_payload_read_file_(payload, offset, buffer, byte_count);
            default:
                return -1;
        }
    }

    inline int64_t omega_change_write_payload_bytes_(const omega_change_t *change_ptr,
                                                     omega_change_payload_role_t payload_role, int64_t offset,
                                                     int64_t byte_count, FILE *to_file_ptr, omega_byte_t *io_buf,
                                                     int64_t io_buf_capacity) {
        if (!to_file_ptr || !io_buf || io_buf_capacity <= 0 || offset < 0 || byte_count < 0) { return -1; }
        int64_t written = 0;
        while (written < byte_count) {
            const auto chunk = std::min(byte_count - written, io_buf_capacity);
            if (omega_change_copy_payload_bytes_(change_ptr, payload_role, offset + written, io_buf, chunk) != 0 ||
                static_cast<int64_t>(fwrite(io_buf, sizeof(omega_byte_t), chunk, to_file_ptr)) != chunk) {
                return -1;
            }
            written += chunk;
        }
        return written;
    }

}// namespace omega_edit::internal

#endif//OMEGA_EDIT_CHANGE_DEF_HPP
