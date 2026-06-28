/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed on an "AS IS" BASIS, WITHOUT    *
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the License for the specific language         *
 * governing permissions and limitations under the License.                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

#include "plugin_options.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <string>

namespace {

    constexpr const char *CHECKSUM_ARGS_SCHEMA = R"json({
  "type": "object",
  "properties": {
    "algorithm": {
      "type": "string",
      "title": "Algorithm",
      "description": "Checksum, CRC, or non-cryptographic hash to calculate.",
      "default": "crc32",
      "enum": [
        "crc32",
        "crc32c",
        "crc32-mpeg2",
        "crc32-bzip2",
        "crc16-ibm",
        "crc16-arc",
        "crc16-ccitt-false",
        "crc16-xmodem",
        "crc16-modbus",
        "crc16-kermit",
        "crc8",
        "adler32",
        "fletcher16",
        "fletcher32",
        "internet-checksum",
        "lrc",
        "bcc",
        "sum8",
        "sum16",
        "sum32",
        "fnv1a32",
        "fnv1a64",
        "murmur3-32",
        "xxhash32",
        "xxhash64"
      ],
      "x-omega-enumGroups": [
        {
          "label": "CRC",
          "values": [
            "crc32",
            "crc32c",
            "crc32-mpeg2",
            "crc32-bzip2",
            "crc16-ibm",
            "crc16-arc",
            "crc16-ccitt-false",
            "crc16-xmodem",
            "crc16-modbus",
            "crc16-kermit",
            "crc8"
          ]
        },
        {
          "label": "Adler/Fletcher",
          "values": ["adler32", "fletcher16", "fletcher32"]
        },
        {
          "label": "Sums",
          "values": ["internet-checksum", "lrc", "bcc", "sum8", "sum16", "sum32"]
        },
        {
          "label": "Hashes",
          "values": ["fnv1a32", "fnv1a64", "murmur3-32", "xxhash32", "xxhash64"]
        }
      ]
    }
  },
  "required": ["algorithm"],
  "additionalProperties": false
})json";

    uint64_t mask_for_width(int width) { return width == 64 ? UINT64_MAX : ((UINT64_C(1) << width) - UINT64_C(1)); }

    uint64_t reflect_bits(uint64_t value, int width) {
        uint64_t reflected = 0;
        for (int i = 0; i < width; ++i) {
            if (value & (UINT64_C(1) << i)) { reflected |= UINT64_C(1) << (width - 1 - i); }
        }
        return reflected;
    }

    struct crc_model_t {
        int width;
        uint64_t polynomial;
        uint64_t init;
        uint64_t xor_out;
        bool refin;
        bool refout;
    };

    uint64_t crc_update(uint64_t state, const crc_model_t &model, const omega_byte_t *bytes, int64_t length) {
        const uint64_t mask = mask_for_width(model.width);
        if (model.refin) {
            const uint64_t reflected_polynomial = reflect_bits(model.polynomial, model.width);
            for (int64_t i = 0; i < length; ++i) {
                state ^= static_cast<uint8_t>(bytes[i]);
                for (int bit = 0; bit < 8; ++bit) {
                    state = (state & 1U) ? ((state >> 1U) ^ reflected_polynomial) : (state >> 1U);
                }
                state &= mask;
            }
            return state;
        }

        const uint64_t top_bit = UINT64_C(1) << (model.width - 1);
        for (int64_t i = 0; i < length; ++i) {
            state ^= static_cast<uint64_t>(static_cast<uint8_t>(bytes[i])) << (model.width - 8);
            for (int bit = 0; bit < 8; ++bit) {
                state = (state & top_bit) ? ((state << 1U) ^ model.polynomial) : (state << 1U);
            }
            state &= mask;
        }
        return state;
    }

    uint64_t crc_finalize(uint64_t state, const crc_model_t &model) {
        if (model.refin != model.refout) { state = reflect_bits(state, model.width); }
        return (state ^ model.xor_out) & mask_for_width(model.width);
    }

    bool crc_model_for(const std::string &algorithm, crc_model_t &model, int &hex_width) {
        if (algorithm == "crc32") {
            model = {32, 0x04C11DB7U, 0xFFFFFFFFU, 0xFFFFFFFFU, true, true};
            hex_width = 8;
            return true;
        }
        if (algorithm == "crc32c") {
            model = {32, 0x1EDC6F41U, 0xFFFFFFFFU, 0xFFFFFFFFU, true, true};
            hex_width = 8;
            return true;
        }
        if (algorithm == "crc32-mpeg2") {
            model = {32, 0x04C11DB7U, 0xFFFFFFFFU, 0x00000000U, false, false};
            hex_width = 8;
            return true;
        }
        if (algorithm == "crc32-bzip2") {
            model = {32, 0x04C11DB7U, 0xFFFFFFFFU, 0xFFFFFFFFU, false, false};
            hex_width = 8;
            return true;
        }
        if (algorithm == "crc16-ibm" || algorithm == "crc16-arc") {
            model = {16, 0x8005U, 0x0000U, 0x0000U, true, true};
            hex_width = 4;
            return true;
        }
        if (algorithm == "crc16-modbus") {
            model = {16, 0x8005U, 0xFFFFU, 0x0000U, true, true};
            hex_width = 4;
            return true;
        }
        if (algorithm == "crc16-ccitt-false") {
            model = {16, 0x1021U, 0xFFFFU, 0x0000U, false, false};
            hex_width = 4;
            return true;
        }
        if (algorithm == "crc16-xmodem") {
            model = {16, 0x1021U, 0x0000U, 0x0000U, false, false};
            hex_width = 4;
            return true;
        }
        if (algorithm == "crc16-kermit") {
            model = {16, 0x1021U, 0x0000U, 0x0000U, true, true};
            hex_width = 4;
            return true;
        }
        if (algorithm == "crc8") {
            model = {8, 0x07U, 0x00U, 0x00U, false, false};
            hex_width = 2;
            return true;
        }
        return false;
    }

    uint32_t rotl32(uint32_t value, int count) { return (value << count) | (value >> (32 - count)); }

    uint64_t rotl64(uint64_t value, int count) { return (value << count) | (value >> (64 - count)); }

    uint32_t read32le(const omega_byte_t *bytes) {
        return static_cast<uint32_t>(bytes[0]) | (static_cast<uint32_t>(bytes[1]) << 8U) |
               (static_cast<uint32_t>(bytes[2]) << 16U) | (static_cast<uint32_t>(bytes[3]) << 24U);
    }

    uint64_t read64le(const omega_byte_t *bytes) {
        return static_cast<uint64_t>(read32le(bytes)) | (static_cast<uint64_t>(read32le(bytes + 4)) << 32U);
    }

    struct murmur3_32_t {
        uint32_t h = 0;
        uint64_t length = 0;
        std::array<omega_byte_t, 4> tail{};
        size_t tail_length = 0;

        void block(uint32_t k) {
            k *= 0xcc9e2d51U;
            k = rotl32(k, 15);
            k *= 0x1b873593U;
            h ^= k;
            h = rotl32(h, 13);
            h = (h * 5U) + 0xe6546b64U;
        }

        void update(const omega_byte_t *bytes, int64_t byte_count) {
            length += static_cast<uint64_t>(byte_count);
            size_t index = 0;
            if (tail_length > 0) {
                while (tail_length < tail.size() && index < static_cast<size_t>(byte_count)) {
                    tail[tail_length++] = bytes[index++];
                }
                if (tail_length == tail.size()) {
                    block(read32le(tail.data()));
                    tail_length = 0;
                }
            }
            while (index + 4 <= static_cast<size_t>(byte_count)) {
                block(read32le(bytes + index));
                index += 4;
            }
            while (index < static_cast<size_t>(byte_count)) { tail[tail_length++] = bytes[index++]; }
        }

        uint32_t final() const {
            uint32_t result = h;
            uint32_t k = 0;
            switch (tail_length) {
                case 3:
                    k ^= static_cast<uint32_t>(tail[2]) << 16U;
                    [[fallthrough]];
                case 2:
                    k ^= static_cast<uint32_t>(tail[1]) << 8U;
                    [[fallthrough]];
                case 1:
                    k ^= tail[0];
                    k *= 0xcc9e2d51U;
                    k = rotl32(k, 15);
                    k *= 0x1b873593U;
                    result ^= k;
                    break;
                default:
                    break;
            }
            result ^= static_cast<uint32_t>(length);
            result ^= result >> 16U;
            result *= 0x85ebca6bU;
            result ^= result >> 13U;
            result *= 0xc2b2ae35U;
            result ^= result >> 16U;
            return result;
        }
    };

    struct xxhash32_t {
        static constexpr uint32_t p1 = 2654435761U;
        static constexpr uint32_t p2 = 2246822519U;
        static constexpr uint32_t p3 = 3266489917U;
        static constexpr uint32_t p4 = 668265263U;
        static constexpr uint32_t p5 = 374761393U;

        uint64_t length = 0;
        uint32_t v1 = p1 + p2;
        uint32_t v2 = p2;
        uint32_t v3 = 0;
        uint32_t v4 = 0U - p1;
        std::array<omega_byte_t, 16> memory{};
        size_t memory_size = 0;

        static uint32_t round(uint32_t acc, uint32_t input) {
            acc += input * p2;
            acc = rotl32(acc, 13);
            return acc * p1;
        }

        void stripe(const omega_byte_t *bytes) {
            v1 = round(v1, read32le(bytes));
            v2 = round(v2, read32le(bytes + 4));
            v3 = round(v3, read32le(bytes + 8));
            v4 = round(v4, read32le(bytes + 12));
        }

        void update(const omega_byte_t *bytes, int64_t byte_count) {
            length += static_cast<uint64_t>(byte_count);
            size_t index = 0;
            if (memory_size + static_cast<size_t>(byte_count) < memory.size()) {
                std::memcpy(memory.data() + memory_size, bytes, static_cast<size_t>(byte_count));
                memory_size += static_cast<size_t>(byte_count);
                return;
            }
            if (memory_size > 0) {
                const size_t fill = memory.size() - memory_size;
                std::memcpy(memory.data() + memory_size, bytes, fill);
                stripe(memory.data());
                index += fill;
                memory_size = 0;
            }
            while (index + memory.size() <= static_cast<size_t>(byte_count)) {
                stripe(bytes + index);
                index += memory.size();
            }
            if (index < static_cast<size_t>(byte_count)) {
                memory_size = static_cast<size_t>(byte_count) - index;
                std::memcpy(memory.data(), bytes + index, memory_size);
            }
        }

        uint32_t final() const {
            uint32_t h = 0;
            if (length >= 16) {
                h = rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18);
            } else {
                h = p5;
            }
            h += static_cast<uint32_t>(length);
            size_t index = 0;
            while (index + 4 <= memory_size) {
                h += read32le(memory.data() + index) * p3;
                h = rotl32(h, 17) * p4;
                index += 4;
            }
            while (index < memory_size) {
                h += memory[index] * p5;
                h = rotl32(h, 11) * p1;
                ++index;
            }
            h ^= h >> 15U;
            h *= p2;
            h ^= h >> 13U;
            h *= p3;
            h ^= h >> 16U;
            return h;
        }
    };

    struct xxhash64_t {
        static constexpr uint64_t p1 = 11400714785074694791ULL;
        static constexpr uint64_t p2 = 14029467366897019727ULL;
        static constexpr uint64_t p3 = 1609587929392839161ULL;
        static constexpr uint64_t p4 = 9650029242287828579ULL;
        static constexpr uint64_t p5 = 2870177450012600261ULL;

        uint64_t length = 0;
        uint64_t v1 = p1 + p2;
        uint64_t v2 = p2;
        uint64_t v3 = 0;
        uint64_t v4 = 0U - p1;
        std::array<omega_byte_t, 32> memory{};
        size_t memory_size = 0;

        static uint64_t round(uint64_t acc, uint64_t input) {
            acc += input * p2;
            acc = rotl64(acc, 31);
            return acc * p1;
        }

        static uint64_t merge_round(uint64_t acc, uint64_t value) {
            acc ^= round(0, value);
            return (acc * p1) + p4;
        }

        void stripe(const omega_byte_t *bytes) {
            v1 = round(v1, read64le(bytes));
            v2 = round(v2, read64le(bytes + 8));
            v3 = round(v3, read64le(bytes + 16));
            v4 = round(v4, read64le(bytes + 24));
        }

        void update(const omega_byte_t *bytes, int64_t byte_count) {
            length += static_cast<uint64_t>(byte_count);
            size_t index = 0;
            if (memory_size + static_cast<size_t>(byte_count) < memory.size()) {
                std::memcpy(memory.data() + memory_size, bytes, static_cast<size_t>(byte_count));
                memory_size += static_cast<size_t>(byte_count);
                return;
            }
            if (memory_size > 0) {
                const size_t fill = memory.size() - memory_size;
                std::memcpy(memory.data() + memory_size, bytes, fill);
                stripe(memory.data());
                index += fill;
                memory_size = 0;
            }
            while (index + memory.size() <= static_cast<size_t>(byte_count)) {
                stripe(bytes + index);
                index += memory.size();
            }
            if (index < static_cast<size_t>(byte_count)) {
                memory_size = static_cast<size_t>(byte_count) - index;
                std::memcpy(memory.data(), bytes + index, memory_size);
            }
        }

        uint64_t final() const {
            uint64_t h = 0;
            if (length >= 32) {
                h = rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18);
                h = merge_round(h, v1);
                h = merge_round(h, v2);
                h = merge_round(h, v3);
                h = merge_round(h, v4);
            } else {
                h = p5;
            }
            h += length;
            size_t index = 0;
            while (index + 8 <= memory_size) {
                h ^= round(0, read64le(memory.data() + index));
                h = (rotl64(h, 27) * p1) + p4;
                index += 8;
            }
            if (index + 4 <= memory_size) {
                h ^= static_cast<uint64_t>(read32le(memory.data() + index)) * p1;
                h = (rotl64(h, 23) * p2) + p3;
                index += 4;
            }
            while (index < memory_size) {
                h ^= memory[index] * p5;
                h = rotl64(h, 11) * p1;
                ++index;
            }
            h ^= h >> 33U;
            h *= p2;
            h ^= h >> 29U;
            h *= p3;
            h ^= h >> 32U;
            return h;
        }
    };

}// namespace

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.common_checksums";
    info_ptr->name = "Common Checksums";
    info_ptr->description =
            "Inspect the selected range with common CRC, checksum, and non-cryptographic hash variants.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_TEXT_RESULT | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_STREAMING;
    info_ptr->help =
            "Choose a checksum, CRC, or non-cryptographic hash algorithm. Algorithms include crc32, crc32c, "
            "crc32-mpeg2, crc32-bzip2, crc16-ibm, crc16-ccitt-false, crc16-xmodem, crc16-modbus, crc16-kermit, "
            "crc8, adler32, fletcher16, fletcher32, internet-checksum, lrc, bcc, sum8, sum16, sum32, fnv1a32, "
            "fnv1a64, murmur3-32, xxhash32, and xxhash64.";
    info_ptr->example = "{\"algorithm\":\"crc32c\"}";
    info_ptr->default_args = "{\"algorithm\":\"crc32\"}";
    info_ptr->args_schema = CHECKSUM_ARGS_SCHEMA;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int
omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                             omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0 ||
        request_ptr->session_length < 0) {
        return -1;
    }

    std::map<std::string, std::string> options;
    if (!omega_edit::plugin::parse_string_options(request_ptr->options_json, options)) { return -1; }
    const auto algorithm = omega_edit::plugin::option_or(options, "algorithm", "crc32");

    crc_model_t crc_model{};
    int crc_hex_width = 0;
    if (crc_model_for(algorithm, crc_model, crc_hex_width)) {
        uint64_t crc = crc_model.init;
        const bool ok = omega_edit::plugin::for_each_chunk(request_ptr, [&](const omega_byte_t *bytes, int64_t length) {
            crc = crc_update(crc, crc_model, bytes, length);
            return true;
        });
        if (!ok) { return -1; }
        return omega_edit::plugin::set_text_result(
                request_ptr, response_ptr, algorithm,
                omega_edit::plugin::hex_value(crc_finalize(crc, crc_model), crc_hex_width));
    }

    uint32_t adler_a = 1;
    uint32_t adler_b = 0;
    uint32_t fletcher_a = 0;
    uint32_t fletcher_b = 0;
    uint64_t fletcher32_a = 0;
    uint64_t fletcher32_b = 0;
    uint32_t internet_sum = 0;
    uint32_t sum = 0;
    uint8_t lrc_sum = 0;
    uint8_t bcc = 0;
    uint32_t fnv32 = 2166136261U;
    uint64_t fnv64 = 14695981039346656037ULL;
    murmur3_32_t murmur3;
    xxhash32_t xx32;
    xxhash64_t xx64;
    bool have_odd_internet_byte = false;
    omega_byte_t odd_internet_byte = 0;
    bool have_odd_fletcher32_byte = false;
    omega_byte_t odd_fletcher32_byte = 0;

    const bool ok = omega_edit::plugin::for_each_chunk(request_ptr, [&](const omega_byte_t *bytes, int64_t length) {
        if (algorithm == "murmur3-32") {
            murmur3.update(bytes, length);
            return true;
        }
        if (algorithm == "xxhash32") {
            xx32.update(bytes, length);
            return true;
        }
        if (algorithm == "xxhash64") {
            xx64.update(bytes, length);
            return true;
        }
        for (int64_t i = 0; i < length; ++i) {
            const uint8_t byte = static_cast<uint8_t>(bytes[i]);
            if (algorithm == "adler32") {
                adler_a = (adler_a + byte) % 65521U;
                adler_b = (adler_b + adler_a) % 65521U;
            } else if (algorithm == "fletcher16") {
                fletcher_a = (fletcher_a + byte) % 255U;
                fletcher_b = (fletcher_b + fletcher_a) % 255U;
            } else if (algorithm == "fletcher32") {
                uint16_t word = 0;
                if (have_odd_fletcher32_byte) {
                    word = static_cast<uint16_t>((odd_fletcher32_byte << 8U) | byte);
                    have_odd_fletcher32_byte = false;
                } else if (i + 1 < length) {
                    word = static_cast<uint16_t>((byte << 8U) | static_cast<uint8_t>(bytes[++i]));
                } else {
                    odd_fletcher32_byte = byte;
                    have_odd_fletcher32_byte = true;
                    continue;
                }
                fletcher32_a = (fletcher32_a + word) % 65535U;
                fletcher32_b = (fletcher32_b + fletcher32_a) % 65535U;
            } else if (algorithm == "internet-checksum") {
                uint16_t word = 0;
                if (have_odd_internet_byte) {
                    word = static_cast<uint16_t>((odd_internet_byte << 8U) | byte);
                    have_odd_internet_byte = false;
                } else if (i + 1 < length) {
                    word = static_cast<uint16_t>((byte << 8U) | static_cast<uint8_t>(bytes[++i]));
                } else {
                    odd_internet_byte = byte;
                    have_odd_internet_byte = true;
                    continue;
                }
                internet_sum += word;
                internet_sum = (internet_sum & 0xFFFFU) + (internet_sum >> 16U);
            } else if (algorithm == "lrc") {
                lrc_sum = static_cast<uint8_t>(lrc_sum + byte);
            } else if (algorithm == "bcc") {
                bcc ^= byte;
            } else if (algorithm == "sum8" || algorithm == "sum16" || algorithm == "sum32") {
                sum += byte;
            } else if (algorithm == "fnv1a32") {
                fnv32 ^= byte;
                fnv32 *= 16777619U;
            } else if (algorithm == "fnv1a64") {
                fnv64 ^= byte;
                fnv64 *= 1099511628211ULL;
            } else {
                return false;
            }
        }
        return true;
    });
    if (!ok) { return -1; }

    if (algorithm == "adler32") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value((adler_b << 16U) | adler_a, 8));
    }
    if (algorithm == "fletcher16") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value((fletcher_b << 8U) | fletcher_a, 4));
    }
    if (algorithm == "fletcher32") {
        if (have_odd_fletcher32_byte) {
            fletcher32_a = (fletcher32_a + (static_cast<uint16_t>(odd_fletcher32_byte) << 8U)) % 65535U;
            fletcher32_b = (fletcher32_b + fletcher32_a) % 65535U;
        }
        return omega_edit::plugin::set_text_result(
                request_ptr, response_ptr, algorithm,
                omega_edit::plugin::hex_value(((fletcher32_b & 0xFFFFU) << 16U) | (fletcher32_a & 0xFFFFU), 8));
    }
    if (algorithm == "internet-checksum") {
        if (have_odd_internet_byte) { internet_sum += static_cast<uint32_t>(odd_internet_byte) << 8U; }
        while (internet_sum >> 16U) { internet_sum = (internet_sum & 0xFFFFU) + (internet_sum >> 16U); }
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value((~internet_sum) & 0xFFFFU, 4));
    }
    if (algorithm == "lrc") {
        return omega_edit::plugin::set_text_result(
                request_ptr, response_ptr, algorithm,
                omega_edit::plugin::hex_value(static_cast<uint8_t>(0U - lrc_sum), 2));
    }
    if (algorithm == "bcc") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value(bcc, 2));
    }
    if (algorithm == "sum8") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value(sum & 0xFFU, 2));
    }
    if (algorithm == "sum16") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value(sum & 0xFFFFU, 4));
    }
    if (algorithm == "sum32") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value(sum, 8));
    }
    if (algorithm == "fnv1a32") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value(fnv32, 8));
    }
    if (algorithm == "fnv1a64") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value(fnv64, 16));
    }
    if (algorithm == "murmur3-32") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value(murmur3.final(), 8));
    }
    if (algorithm == "xxhash32") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value(xx32.final(), 8));
    }
    if (algorithm == "xxhash64") {
        return omega_edit::plugin::set_text_result(request_ptr, response_ptr, algorithm,
                                                   omega_edit::plugin::hex_value(xx64.final(), 16));
    }
    return -1;
}
