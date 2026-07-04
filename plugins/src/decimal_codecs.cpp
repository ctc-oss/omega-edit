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

#include <cctype>
#include <string>
#include <vector>

namespace {

    constexpr const char *DECIMAL_CODEC_ARGS_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"codec\":{\"type\":\"string\",\"title\":\"Codec\","
            "\"description\":\"Decimal representation to encode or decode.\",\"default\":\"bcd\",\"enum\":[\"bcd\","
            "\"packed-decimal\",\"comp-3\",\"zoned-decimal\",\"overpunch\"]},\"direction\":{\"type\":\"string\","
            "\"title\":\"Direction\",\"default\":\"encode\",\"enum\":[\"encode\",\"decode\"]}},"
            "\"additionalProperties\":false}";
    constexpr size_t DECIMAL_CODEC_CANCEL_POLL_INTERVAL = 4096;

    bool cancel_requested(const omega_transform_plugin_request_t *request_ptr, size_t &work_count) {
        if ((work_count++ & (DECIMAL_CODEC_CANCEL_POLL_INTERVAL - 1U)) != 0U) { return false; }
        return omega_transform_plugin_sdk_is_cancelled(request_ptr) != 0;
    }

    bool is_ascii_space(omega_byte_t byte) { return std::isspace(static_cast<unsigned char>(byte)) != 0; }

    bool is_ascii_digit(omega_byte_t byte) { return std::isdigit(static_cast<unsigned char>(byte)) != 0; }

    bool digits_from_ascii(const omega_transform_plugin_request_t *request_ptr, const std::vector<omega_byte_t> &input,
                           std::string &digits, bool &negative) {
        digits.clear();
        negative = false;
        size_t work_count = 0;
        for (const auto byte : input) {
            if (cancel_requested(request_ptr, work_count)) { return false; }
            if (byte == '+' || is_ascii_space(byte)) { continue; }
            if (byte == '-') {
                negative = true;
                continue;
            }
            if (!is_ascii_digit(byte)) { return false; }
            digits.push_back(static_cast<char>(byte));
        }
        return !digits.empty();
    }

    std::vector<omega_byte_t> ascii_bytes(const std::string &text) {
        return std::vector<omega_byte_t>(text.begin(), text.end());
    }

    bool decode_nibble(unsigned int nibble, char &digit) {
        if (nibble > 9U) { return false; }
        digit = static_cast<char>('0' + nibble);
        return true;
    }

    bool encode_bcd(const omega_transform_plugin_request_t *request_ptr, const std::vector<omega_byte_t> &input,
                    std::vector<omega_byte_t> &out) {
        std::string digits;
        bool negative = false;
        if (!digits_from_ascii(request_ptr, input, digits, negative) || negative) { return false; }
        if ((digits.size() % 2) != 0) { digits.insert(digits.begin(), '0'); }
        out.clear();
        size_t work_count = 0;
        for (size_t i = 0; i < digits.size(); i += 2) {
            if (cancel_requested(request_ptr, work_count)) { return false; }
            out.push_back(static_cast<omega_byte_t>(((digits[i] - '0') << 4U) | (digits[i + 1] - '0')));
        }
        return true;
    }

    bool decode_bcd(const omega_transform_plugin_request_t *request_ptr, const std::vector<omega_byte_t> &input,
                    std::vector<omega_byte_t> &out) {
        std::string digits;
        size_t work_count = 0;
        for (const auto byte : input) {
            if (cancel_requested(request_ptr, work_count)) { return false; }
            char high = 0;
            char low = 0;
            if (!decode_nibble((byte >> 4U) & 0x0FU, high) || !decode_nibble(byte & 0x0FU, low)) { return false; }
            digits.push_back(high);
            digits.push_back(low);
        }
        out = ascii_bytes(digits);
        return true;
    }

    bool encode_packed(const omega_transform_plugin_request_t *request_ptr, const std::vector<omega_byte_t> &input,
                       std::vector<omega_byte_t> &out) {
        std::string digits;
        bool negative = false;
        if (!digits_from_ascii(request_ptr, input, digits, negative)) { return false; }
        digits.push_back(negative ? 'D' : 'C');
        if ((digits.size() % 2) != 0) { digits.insert(digits.begin(), '0'); }
        out.clear();
        size_t work_count = 0;
        for (size_t i = 0; i < digits.size(); i += 2) {
            if (cancel_requested(request_ptr, work_count)) { return false; }
            const unsigned int high = digits[i] >= 'A' ? 0x0DU : static_cast<unsigned int>(digits[i] - '0');
            const unsigned int low = digits[i + 1] >= 'A' ? (digits[i + 1] == 'D' ? 0x0DU : 0x0CU)
                                                          : static_cast<unsigned int>(digits[i + 1] - '0');
            out.push_back(static_cast<omega_byte_t>((high << 4U) | low));
        }
        return true;
    }

    bool decode_packed(const omega_transform_plugin_request_t *request_ptr, const std::vector<omega_byte_t> &input,
                       std::vector<omega_byte_t> &out) {
        if (input.empty()) { return false; }
        std::string digits;
        bool negative = false;
        size_t work_count = 0;
        for (size_t i = 0; i < input.size(); ++i) {
            if (cancel_requested(request_ptr, work_count)) { return false; }
            const unsigned int high = (input[i] >> 4U) & 0x0FU;
            const unsigned int low = input[i] & 0x0FU;
            char digit = 0;
            if (!decode_nibble(high, digit)) { return false; }
            digits.push_back(digit);
            if (i + 1 == input.size()) {
                if (low == 0x0DU || low == 0x0BU) {
                    negative = true;
                } else if (low != 0x0CU && low != 0x0FU) {
                    return false;
                }
            } else {
                if (!decode_nibble(low, digit)) { return false; }
                digits.push_back(digit);
            }
        }
        if (negative) { digits.insert(digits.begin(), '-'); }
        out = ascii_bytes(digits);
        return true;
    }

    bool encode_zoned(const omega_transform_plugin_request_t *request_ptr, const std::vector<omega_byte_t> &input,
                      std::vector<omega_byte_t> &out, bool overpunch) {
        std::string digits;
        bool negative = false;
        if (!digits_from_ascii(request_ptr, input, digits, negative)) { return false; }
        out.clear();
        size_t work_count = 0;
        for (size_t i = 0; i < digits.size(); ++i) {
            if (cancel_requested(request_ptr, work_count)) { return false; }
            const unsigned int digit = static_cast<unsigned int>(digits[i] - '0');
            if (overpunch && i + 1 == digits.size()) {
                out.push_back(static_cast<omega_byte_t>((negative ? 0xD0U : 0xC0U) | digit));
            } else {
                out.push_back(static_cast<omega_byte_t>(0xF0U | digit));
            }
        }
        return true;
    }

    bool decode_zoned(const omega_transform_plugin_request_t *request_ptr, const std::vector<omega_byte_t> &input,
                      std::vector<omega_byte_t> &out, bool overpunch) {
        if (input.empty()) { return false; }
        std::string digits;
        bool negative = false;
        size_t work_count = 0;
        for (size_t i = 0; i < input.size(); ++i) {
            if (cancel_requested(request_ptr, work_count)) { return false; }
            const unsigned int zone = (input[i] >> 4U) & 0x0FU;
            const unsigned int digit = input[i] & 0x0FU;
            if (digit > 9U) { return false; }
            if (overpunch && i + 1 == input.size()) {
                if (zone == 0x0DU) {
                    negative = true;
                } else if (zone != 0x0CU && zone != 0x0FU) {
                    return false;
                }
            } else if (zone != 0x0FU) {
                return false;
            }
            digits.push_back(static_cast<char>('0' + digit));
        }
        if (negative) { digits.insert(digits.begin(), '-'); }
        out = ascii_bytes(digits);
        return true;
    }

}// namespace

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.decimal_codecs";
    info_ptr->name = "Decimal Codecs";
    info_ptr->description = "Encode or decode BCD, packed decimal/COMP-3, zoned decimal, and signed overpunch fields.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help =
            "Choose a decimal codec and encode or decode direction. Codecs include bcd, packed-decimal/comp-3, "
            "zoned-decimal, and overpunch.";
    info_ptr->example = "{\"codec\":\"packed-decimal\",\"direction\":\"encode\"}";
    info_ptr->default_args = "{\"codec\":\"bcd\",\"direction\":\"encode\"}";
    info_ptr->args_schema = DECIMAL_CODEC_ARGS_SCHEMA;
    info_ptr->support = OMEGA_TRANSFORM_PLUGIN_SUPPORT_EXPERIMENTAL;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int
omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                             omega_transform_plugin_response_t *response_ptr) {
    std::vector<omega_byte_t> input;
    if (!omega_edit::plugin::selected_bytes(request_ptr, input) || !response_ptr || !request_ptr->alloc) { return -1; }
    std::map<std::string, std::string> options;
    if (!omega_edit::plugin::parse_string_options(request_ptr->options_json, options)) { return -1; }
    std::string codec = omega_edit::plugin::option_or(options, "codec", "bcd");
    const std::string direction = omega_edit::plugin::option_or(options, "direction", "encode");
    if (codec == "comp-3") { codec = "packed-decimal"; }

    std::vector<omega_byte_t> output;
    bool ok = false;
    if (codec == "bcd") {
        ok = direction == "encode" ? encode_bcd(request_ptr, input, output) : decode_bcd(request_ptr, input, output);
    } else if (codec == "packed-decimal") {
        ok = direction == "encode" ? encode_packed(request_ptr, input, output)
                                   : decode_packed(request_ptr, input, output);
    } else if (codec == "zoned-decimal") {
        ok = direction == "encode" ? encode_zoned(request_ptr, input, output, false)
                                   : decode_zoned(request_ptr, input, output, false);
    } else if (codec == "overpunch") {
        ok = direction == "encode" ? encode_zoned(request_ptr, input, output, true)
                                   : decode_zoned(request_ptr, input, output, true);
    }
    if (!ok || omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
    return omega_edit::plugin::set_replacement(request_ptr, response_ptr, output);
}
