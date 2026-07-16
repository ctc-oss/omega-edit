/**********************************************************************************************************************
 * Copyright (c) 2026 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License. You may obtain a copy of the License at                                                          *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed *
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                    *
 **********************************************************************************************************************/

#include "../include/omega_edit/config.h"
#include "impl_/change_def.hpp"
#include <algorithm>
#include <cstdio>
#include <limits>
#include <memory>
#include <vector>
#include <zstd.h>

namespace omega_edit::internal {
    namespace {
        constexpr int64_t PAYLOAD_BLOCK_SIZE = 1024 * 1024;

        bool seek_(FILE *file, int64_t offset) {
#if !defined(OMEGA_BUILD_WINDOWS) && !defined(HAVE_FSEEKO)
            return offset <= (std::numeric_limits<long>::max)() &&
                   FSEEK(file, static_cast<long>(offset), SEEK_SET) == 0;
#else
            return FSEEK(file, offset, SEEK_SET) == 0;
#endif
        }
    }// namespace

    int omega_payload_compress_file_(omega_byte_payload_struct *payload) {
        if (!payload || payload->storage != OMEGA_CHANGE_DATA_STORAGE_FILE_BACKED || payload->length <= 0 ||
            payload->file_path.empty()) {
            return -1;
        }
        std::string compressed_path;
        std::string raw_path;
        std::vector<omega_byte_t> source;
        std::vector<omega_byte_t> compressed;
        std::vector<compressed_payload_block_t> blocks;
        try {
            compressed_path = payload->file_path + ".zst.tmp";
            raw_path = payload->file_path + ".raw.tmp";
            source.resize(static_cast<size_t>(PAYLOAD_BLOCK_SIZE));
            compressed.resize(ZSTD_compressBound(source.size()));
            const auto block_count = payload->length / PAYLOAD_BLOCK_SIZE +
                                     (payload->length % PAYLOAD_BLOCK_SIZE == 0 ? int64_t{0} : int64_t{1});
            blocks.reserve(static_cast<size_t>(block_count));
        } catch (const std::bad_alloc &) { return -1; }
        auto *input = fopen(payload->file_path.c_str(), "rb");
        if (!input) { return -1; }
        auto *output = fopen(compressed_path.c_str(), "wb");
        if (!output) {
            fclose(input);
            return -1;
        }
        int64_t file_offset = 0;
        int64_t remaining = payload->length;
        bool success = true;
        while (remaining > 0 && success) {
            const auto source_length = (std::min)(remaining, PAYLOAD_BLOCK_SIZE);
            if (fread(source.data(), 1, static_cast<size_t>(source_length), input) !=
                static_cast<size_t>(source_length)) {
                success = false;
                break;
            }
            const auto compressed_length = ZSTD_compress(compressed.data(), compressed.size(), source.data(),
                                                         static_cast<size_t>(source_length), 1);
            if (ZSTD_isError(compressed_length) ||
                compressed_length > static_cast<size_t>((std::numeric_limits<int64_t>::max)() - file_offset) ||
                fwrite(compressed.data(), 1, compressed_length, output) != compressed_length) {
                success = false;
                break;
            }
            blocks.push_back({file_offset, static_cast<int64_t>(compressed_length), source_length});
            file_offset += static_cast<int64_t>(compressed_length);
            remaining -= source_length;
        }
        if (fflush(output) != 0) { success = false; }
        if (fclose(output) != 0) { success = false; }
        fclose(input);

        // Preserve raw storage unless compression saves enough to justify block metadata and decode cost.
        const auto metadata_bytes = static_cast<int64_t>(blocks.size() * sizeof(compressed_payload_block_t));
        const auto minimum_savings = (std::max)(int64_t{4096}, payload->length / 20);
        if (!success || file_offset > payload->length - (std::min)(payload->length, metadata_bytes) ||
            file_offset + metadata_bytes > payload->length - (std::min)(payload->length, minimum_savings)) {
            omega_util_remove_file(compressed_path.c_str());
            return success ? 0 : -1;
        }
        if (rename(payload->file_path.c_str(), raw_path.c_str()) != 0) {
            omega_util_remove_file(compressed_path.c_str());
            return -1;
        }
        if (rename(compressed_path.c_str(), payload->file_path.c_str()) != 0) {
            rename(raw_path.c_str(), payload->file_path.c_str());
            omega_util_remove_file(compressed_path.c_str());
            return -1;
        }
        omega_util_remove_file(raw_path.c_str());
        payload->compressed_blocks = std::move(blocks);
        return 0;
    }

    int omega_payload_read_file_(const omega_byte_payload_struct *payload, int64_t offset, omega_byte_t *buffer,
                                 int64_t byte_count) {
        if (!payload || !buffer || offset < 0 || byte_count < 0 || offset > payload->length ||
            byte_count > payload->length - offset) {
            return -1;
        }
        if (byte_count == 0) { return 0; }
        if (payload->compressed_blocks.empty()) {
            return omega_util_read_file_segment(payload->file_path.c_str(), offset, buffer, byte_count) == byte_count
                           ? 0
                           : -1;
        }
        std::vector<omega_byte_t> compressed;
        std::vector<omega_byte_t> decoded;
        try {
            const auto max_compressed =
                    std::max_element(payload->compressed_blocks.begin(), payload->compressed_blocks.end(),
                                     [](const auto &left, const auto &right) {
                                         return left.compressed_length < right.compressed_length;
                                     });
            const auto max_decoded =
                    std::max_element(payload->compressed_blocks.begin(), payload->compressed_blocks.end(),
                                     [](const auto &left, const auto &right) {
                                         return left.uncompressed_length < right.uncompressed_length;
                                     });
            compressed.resize(static_cast<size_t>(max_compressed->compressed_length));
            decoded.resize(static_cast<size_t>(max_decoded->uncompressed_length));
        } catch (const std::bad_alloc &) { return -1; }
        auto *file = fopen(payload->file_path.c_str(), "rb");
        if (!file) { return -1; }
        int64_t block_start = 0;
        int64_t copied = 0;
        bool success = true;
        for (const auto &block : payload->compressed_blocks) {
            const auto block_end = block_start + block.uncompressed_length;
            if (block_end <= offset) {
                block_start = block_end;
                continue;
            }
            if (block_start >= offset + byte_count) { break; }
            if (!seek_(file, block.file_offset) ||
                fread(compressed.data(), 1, static_cast<size_t>(block.compressed_length), file) !=
                        static_cast<size_t>(block.compressed_length) ||
                ZSTD_decompress(decoded.data(), static_cast<size_t>(block.uncompressed_length), compressed.data(),
                                static_cast<size_t>(block.compressed_length)) !=
                        static_cast<size_t>(block.uncompressed_length)) {
                success = false;
                break;
            }
            const auto copy_start = (std::max)(offset, block_start);
            const auto copy_end = (std::min)(offset + byte_count, block_end);
            const auto copy_length = copy_end - copy_start;
            std::memcpy(buffer + copied, decoded.data() + (copy_start - block_start), static_cast<size_t>(copy_length));
            copied += copy_length;
            block_start = block_end;
        }
        fclose(file);
        return success && copied == byte_count ? 0 : -1;
    }
}// namespace omega_edit::internal
