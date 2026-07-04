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
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace {

    constexpr const char *CHARACTER_TRANSCODE_ARGS_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"from\":{\"type\":\"string\",\"title\":\"From\","
            "\"description\":\"Source character encoding.\",\"default\":\"utf-8\",\"enum\":[\"ascii\",\"utf-8\","
            "\"utf-16le\",\"utf-16be\",\"utf-32le\",\"utf-32be\",\"iso-8859-1\",\"windows-1252\",\"ebcdic-037\","
            "\"ibm037\",\"ebcdic-500\",\"ibm500\",\"ebcdic-1047\",\"ibm1047\",\"ebcdic-1140\",\"ibm1140\"]},"
            "\"to\":{\"type\":\"string\",\"title\":\"To\",\"description\":\"Destination character encoding.\","
            "\"default\":\"utf-16le\",\"enum\":[\"ascii\",\"utf-8\",\"utf-16le\",\"utf-16be\",\"utf-32le\","
            "\"utf-32be\",\"iso-8859-1\",\"windows-1252\",\"ebcdic-037\",\"ibm037\",\"ebcdic-500\",\"ibm500\","
            "\"ebcdic-1047\",\"ibm1047\",\"ebcdic-1140\",\"ibm1140\"]}},\"additionalProperties\":false}";

    bool utf8_append(uint32_t codepoint, std::vector<omega_byte_t> &out) {
        if (codepoint <= 0x7FU) {
            out.push_back(static_cast<omega_byte_t>(codepoint));
        } else if (codepoint <= 0x7FFU) {
            out.push_back(static_cast<omega_byte_t>(0xC0U | (codepoint >> 6U)));
            out.push_back(static_cast<omega_byte_t>(0x80U | (codepoint & 0x3FU)));
        } else if (codepoint <= 0xFFFFU) {
            out.push_back(static_cast<omega_byte_t>(0xE0U | (codepoint >> 12U)));
            out.push_back(static_cast<omega_byte_t>(0x80U | ((codepoint >> 6U) & 0x3FU)));
            out.push_back(static_cast<omega_byte_t>(0x80U | (codepoint & 0x3FU)));
        } else if (codepoint <= 0x10FFFFU) {
            out.push_back(static_cast<omega_byte_t>(0xF0U | (codepoint >> 18U)));
            out.push_back(static_cast<omega_byte_t>(0x80U | ((codepoint >> 12U) & 0x3FU)));
            out.push_back(static_cast<omega_byte_t>(0x80U | ((codepoint >> 6U) & 0x3FU)));
            out.push_back(static_cast<omega_byte_t>(0x80U | (codepoint & 0x3FU)));
        } else {
            return false;
        }
        return true;
    }

    bool decode_utf8(const std::vector<omega_byte_t> &input, std::vector<uint32_t> &out) {
        out.clear();
        for (size_t i = 0; i < input.size();) {
            const uint32_t byte = static_cast<uint8_t>(input[i++]);
            if (byte < 0x80U) {
                out.push_back(byte);
            } else if ((byte & 0xE0U) == 0xC0U) {
                if (byte < 0xC2U || i >= input.size() || (input[i] & 0xC0U) != 0x80U) { return false; }
                out.push_back(((byte & 0x1FU) << 6U) | (static_cast<uint8_t>(input[i++]) & 0x3FU));
            } else if ((byte & 0xF0U) == 0xE0U) {
                if (i + 1 >= input.size() || (input[i] & 0xC0U) != 0x80U || (input[i + 1] & 0xC0U) != 0x80U ||
                    (byte == 0xE0U && static_cast<uint8_t>(input[i]) < 0xA0U) ||
                    (byte == 0xEDU && static_cast<uint8_t>(input[i]) > 0x9FU)) {
                    return false;
                }
                out.push_back(((byte & 0x0FU) << 12U) | ((static_cast<uint8_t>(input[i]) & 0x3FU) << 6U) |
                              (static_cast<uint8_t>(input[i + 1]) & 0x3FU));
                i += 2;
            } else if ((byte & 0xF8U) == 0xF0U) {
                if (byte > 0xF4U || i + 2 >= input.size() || (input[i] & 0xC0U) != 0x80U ||
                    (input[i + 1] & 0xC0U) != 0x80U || (input[i + 2] & 0xC0U) != 0x80U ||
                    (byte == 0xF0U && static_cast<uint8_t>(input[i]) < 0x90U) ||
                    (byte == 0xF4U && static_cast<uint8_t>(input[i]) > 0x8FU)) {
                    return false;
                }
                out.push_back(((byte & 0x07U) << 18U) | ((static_cast<uint8_t>(input[i]) & 0x3FU) << 12U) |
                              ((static_cast<uint8_t>(input[i + 1]) & 0x3FU) << 6U) |
                              (static_cast<uint8_t>(input[i + 2]) & 0x3FU));
                i += 3;
            } else {
                return false;
            }
        }
        return true;
    }

    uint32_t read_word(const std::vector<omega_byte_t> &input, size_t offset, bool little, int bytes) {
        uint32_t value = 0;
        if (little) {
            for (int i = bytes - 1; i >= 0; --i) { value = (value << 8U) | input[offset + static_cast<size_t>(i)]; }
        } else {
            for (int i = 0; i < bytes; ++i) { value = (value << 8U) | input[offset + static_cast<size_t>(i)]; }
        }
        return value;
    }

    void write_word(uint32_t value, bool little, int bytes, std::vector<omega_byte_t> &out) {
        if (little) {
            for (int i = 0; i < bytes; ++i) { out.push_back(static_cast<omega_byte_t>((value >> (8U * i)) & 0xFFU)); }
        } else {
            for (int i = bytes - 1; i >= 0; --i) {
                out.push_back(static_cast<omega_byte_t>((value >> (8U * i)) & 0xFFU));
            }
        }
    }

    bool decode_utf16(const std::vector<omega_byte_t> &input, bool little, std::vector<uint32_t> &out) {
        if ((input.size() % 2) != 0) { return false; }
        out.clear();
        for (size_t i = 0; i < input.size(); i += 2) {
            uint32_t word = read_word(input, i, little, 2);
            if (word >= 0xD800U && word <= 0xDBFFU) {
                if (i + 3 >= input.size()) { return false; }
                const uint32_t low = read_word(input, i + 2, little, 2);
                if (low < 0xDC00U || low > 0xDFFFU) { return false; }
                word = 0x10000U + (((word - 0xD800U) << 10U) | (low - 0xDC00U));
                i += 2;
            }
            out.push_back(word);
        }
        return true;
    }

    bool encode_utf16(const std::vector<uint32_t> &input, bool little, std::vector<omega_byte_t> &out) {
        out.clear();
        for (const auto codepoint : input) {
            if (codepoint <= 0xFFFFU) {
                if (codepoint >= 0xD800U && codepoint <= 0xDFFFU) { return false; }
                write_word(codepoint, little, 2, out);
            } else if (codepoint <= 0x10FFFFU) {
                const uint32_t value = codepoint - 0x10000U;
                write_word(0xD800U | (value >> 10U), little, 2, out);
                write_word(0xDC00U | (value & 0x3FFU), little, 2, out);
            } else {
                return false;
            }
        }
        return true;
    }

    bool decode_fixed_width(const std::vector<omega_byte_t> &input, bool little, int bytes,
                            std::vector<uint32_t> &out) {
        if ((input.size() % static_cast<size_t>(bytes)) != 0) { return false; }
        out.clear();
        for (size_t i = 0; i < input.size(); i += static_cast<size_t>(bytes)) {
            out.push_back(read_word(input, i, little, bytes));
        }
        return true;
    }

    uint32_t cp1252_decode(omega_byte_t byte) {
        static const std::map<omega_byte_t, uint32_t> extra = {
                {0x80, 0x20AC}, {0x82, 0x201A}, {0x83, 0x0192}, {0x84, 0x201E}, {0x85, 0x2026}, {0x86, 0x2020},
                {0x87, 0x2021}, {0x88, 0x02C6}, {0x89, 0x2030}, {0x8A, 0x0160}, {0x8B, 0x2039}, {0x8C, 0x0152},
                {0x8E, 0x017D}, {0x91, 0x2018}, {0x92, 0x2019}, {0x93, 0x201C}, {0x94, 0x201D}, {0x95, 0x2022},
                {0x96, 0x2013}, {0x97, 0x2014}, {0x98, 0x02DC}, {0x99, 0x2122}, {0x9A, 0x0161}, {0x9B, 0x203A},
                {0x9C, 0x0153}, {0x9E, 0x017E}, {0x9F, 0x0178}};
        const auto iter = extra.find(byte);
        return iter == extra.end() ? byte : iter->second;
    }

    bool cp1252_encode(uint32_t codepoint, omega_byte_t &byte) {
        if ((codepoint <= 0x7FU) || (codepoint >= 0xA0U && codepoint <= 0xFFU)) {
            byte = static_cast<omega_byte_t>(codepoint);
            return true;
        }
        for (int candidate = 0x80; candidate <= 0x9F; ++candidate) {
            if (cp1252_decode(static_cast<omega_byte_t>(candidate)) == codepoint) {
                byte = static_cast<omega_byte_t>(candidate);
                return true;
            }
        }
        return false;
    }

    uint32_t ebcdic037_decode(omega_byte_t byte) {
        if (byte >= 0x81 && byte <= 0x89) { return 'a' + (byte - 0x81); }
        if (byte >= 0x91 && byte <= 0x99) { return 'j' + (byte - 0x91); }
        if (byte >= 0xA2 && byte <= 0xA9) { return 's' + (byte - 0xA2); }
        if (byte >= 0xC1 && byte <= 0xC9) { return 'A' + (byte - 0xC1); }
        if (byte >= 0xD1 && byte <= 0xD9) { return 'J' + (byte - 0xD1); }
        if (byte >= 0xE2 && byte <= 0xE9) { return 'S' + (byte - 0xE2); }
        if (byte >= 0xF0 && byte <= 0xF9) { return '0' + (byte - 0xF0); }
        static const std::map<omega_byte_t, uint32_t> punctuation = {
                {0x40, ' '}, {0x4B, '.'}, {0x4C, '<'},  {0x4D, '('}, {0x4E, '+'}, {0x4F, '|'}, {0x50, '&'},
                {0x5A, '!'}, {0x5B, '$'}, {0x5C, '*'},  {0x5D, ')'}, {0x5E, ';'}, {0x60, '-'}, {0x61, '/'},
                {0x6B, ','}, {0x6C, '%'}, {0x6D, '_'},  {0x6E, '>'}, {0x6F, '?'}, {0x79, '`'}, {0x7A, ':'},
                {0x7B, '#'}, {0x7C, '@'}, {0x7D, '\''}, {0x7E, '='}, {0x7F, '"'}, {0xA1, '~'}, {0xBA, '['},
                {0xBB, ']'}, {0xC0, '{'}, {0xD0, '}'},  {0xE0, '\\'}};
        const auto iter = punctuation.find(byte);
        return iter == punctuation.end() ? 0xFFFDU : iter->second;
    }

    uint32_t ebcdic_decode(const std::string &charset, omega_byte_t byte) {
        if (charset == "ebcdic-500" || charset == "ibm500") {
            if (byte == 0x4A) { return '['; }
            if (byte == 0x4F) { return '!'; }
            if (byte == 0x5A) { return ']'; }
            if (byte == 0x5F) { return '^'; }
            if (byte == 0xBB) { return '|'; }
            return ebcdic037_decode(byte);
        }
        if (charset == "ebcdic-1047" || charset == "ibm1047") {
            if (byte == 0x5F) { return '^'; }
            if (byte == 0xAD) { return '['; }
            if (byte == 0xBD) { return ']'; }
            return ebcdic037_decode(byte);
        }
        if ((charset == "ebcdic-1140" || charset == "ibm1140") && byte == 0x9F) { return 0x20ACU; }
        return ebcdic037_decode(byte);
    }

    bool ebcdic037_encode(uint32_t codepoint, omega_byte_t &byte) {
        if (codepoint >= 'a' && codepoint <= 'i') {
            byte = static_cast<omega_byte_t>(0x81 + (codepoint - 'a'));
            return true;
        }
        if (codepoint >= 'j' && codepoint <= 'r') {
            byte = static_cast<omega_byte_t>(0x91 + (codepoint - 'j'));
            return true;
        }
        if (codepoint >= 's' && codepoint <= 'z') {
            byte = static_cast<omega_byte_t>(0xA2 + (codepoint - 's'));
            return true;
        }
        if (codepoint >= 'A' && codepoint <= 'I') {
            byte = static_cast<omega_byte_t>(0xC1 + (codepoint - 'A'));
            return true;
        }
        if (codepoint >= 'J' && codepoint <= 'R') {
            byte = static_cast<omega_byte_t>(0xD1 + (codepoint - 'J'));
            return true;
        }
        if (codepoint >= 'S' && codepoint <= 'Z') {
            byte = static_cast<omega_byte_t>(0xE2 + (codepoint - 'S'));
            return true;
        }
        if (codepoint >= '0' && codepoint <= '9') {
            byte = static_cast<omega_byte_t>(0xF0 + (codepoint - '0'));
            return true;
        }
        static const std::map<uint32_t, omega_byte_t> punctuation = {
                {' ', 0x40}, {'.', 0x4B}, {'<', 0x4C},  {'(', 0x4D}, {'+', 0x4E}, {'|', 0x4F}, {'&', 0x50},
                {'!', 0x5A}, {'$', 0x5B}, {'*', 0x5C},  {')', 0x5D}, {';', 0x5E}, {'-', 0x60}, {'/', 0x61},
                {',', 0x6B}, {'%', 0x6C}, {'_', 0x6D},  {'>', 0x6E}, {'?', 0x6F}, {'`', 0x79}, {':', 0x7A},
                {'#', 0x7B}, {'@', 0x7C}, {'\'', 0x7D}, {'=', 0x7E}, {'"', 0x7F}, {'~', 0xA1}, {'[', 0xBA},
                {']', 0xBB}, {'{', 0xC0}, {'}', 0xD0},  {'\\', 0xE0}};
        const auto iter = punctuation.find(codepoint);
        if (iter == punctuation.end()) { return false; }
        byte = iter->second;
        return true;
    }

    bool ebcdic_encode(const std::string &charset, uint32_t codepoint, omega_byte_t &byte) {
        if ((charset == "ebcdic-1140" || charset == "ibm1140") && codepoint == 0x20ACU) {
            byte = 0x9F;
            return true;
        }
        if (charset == "ebcdic-500" || charset == "ibm500") {
            if (codepoint == '[') {
                byte = 0x4A;
                return true;
            }
            if (codepoint == '!') {
                byte = 0x4F;
                return true;
            }
            if (codepoint == ']') {
                byte = 0x5A;
                return true;
            }
            if (codepoint == '^') {
                byte = 0x5F;
                return true;
            }
            if (codepoint == '|') {
                byte = 0xBB;
                return true;
            }
        }
        if (charset == "ebcdic-1047" || charset == "ibm1047") {
            if (codepoint == '^') {
                byte = 0x5F;
                return true;
            }
            if (codepoint == '[') {
                byte = 0xAD;
                return true;
            }
            if (codepoint == ']') {
                byte = 0xBD;
                return true;
            }
        }
        return ebcdic037_encode(codepoint, byte);
    }

    bool is_ebcdic(const std::string &charset) {
        return charset == "ebcdic-037" || charset == "ibm037" || charset == "ebcdic-500" || charset == "ibm500" ||
               charset == "ebcdic-1047" || charset == "ibm1047" || charset == "ebcdic-1140" || charset == "ibm1140";
    }

    bool decode_charset(const std::vector<omega_byte_t> &input, const std::string &charset,
                        std::vector<uint32_t> &out) {
        if (charset == "utf-8") { return decode_utf8(input, out); }
        if (charset == "utf-16le" || charset == "utf-16be") { return decode_utf16(input, charset == "utf-16le", out); }
        if (charset == "utf-32le" || charset == "utf-32be") {
            return decode_fixed_width(input, charset == "utf-32le", 4, out);
        }
        out.clear();
        for (const auto byte : input) {
            if (charset == "ascii") {
                if (byte > 0x7FU) { return false; }
                out.push_back(byte);
            } else if (charset == "iso-8859-1") {
                out.push_back(byte);
            } else if (charset == "windows-1252") {
                const uint32_t codepoint = cp1252_decode(byte);
                if (codepoint == 0xFFFDU) { return false; }
                out.push_back(codepoint);
            } else if (is_ebcdic(charset)) {
                const uint32_t codepoint = ebcdic_decode(charset, byte);
                if (codepoint == 0xFFFDU) { return false; }
                out.push_back(codepoint);
            } else {
                return false;
            }
        }
        return true;
    }

    bool encode_charset(const std::vector<uint32_t> &input, const std::string &charset,
                        std::vector<omega_byte_t> &out) {
        out.clear();
        if (charset == "utf-8") {
            for (const auto codepoint : input) {
                if (!utf8_append(codepoint, out)) { return false; }
            }
            return true;
        }
        if (charset == "utf-16le" || charset == "utf-16be") { return encode_utf16(input, charset == "utf-16le", out); }
        if (charset == "utf-32le" || charset == "utf-32be") {
            for (const auto codepoint : input) { write_word(codepoint, charset == "utf-32le", 4, out); }
            return true;
        }
        for (const auto codepoint : input) {
            omega_byte_t byte = 0;
            if (charset == "ascii") {
                if (codepoint > 0x7FU) { return false; }
                byte = static_cast<omega_byte_t>(codepoint);
            } else if (charset == "iso-8859-1") {
                if (codepoint > 0xFFU) { return false; }
                byte = static_cast<omega_byte_t>(codepoint);
            } else if (charset == "windows-1252") {
                if (!cp1252_encode(codepoint, byte)) { return false; }
            } else if (is_ebcdic(charset)) {
                if (!ebcdic_encode(charset, codepoint, byte)) { return false; }
            } else {
                return false;
            }
            out.push_back(byte);
        }
        return true;
    }

}// namespace

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.character_transcode";
    info_ptr->name = "Character Transcode";
    info_ptr->description = "Transcode common text encodings and single-byte EBCDIC code pages.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help =
            "Choose source and target charsets. Supported charsets include ascii, utf-8, utf-16le/be, utf-32le/be, "
            "iso-8859-1, windows-1252, ebcdic-037, ebcdic-500, ebcdic-1047, and ebcdic-1140.";
    info_ptr->example = "{\"from\":\"ebcdic-037\",\"to\":\"utf-8\"}";
    info_ptr->default_args = "{\"from\":\"utf-8\",\"to\":\"utf-16le\"}";
    info_ptr->args_schema = CHARACTER_TRANSCODE_ARGS_SCHEMA;
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
    const std::string from = omega_edit::plugin::option_or(options, "from", "utf-8");
    const std::string to = omega_edit::plugin::option_or(options, "to", "utf-16le");

    std::vector<uint32_t> codepoints;
    std::vector<omega_byte_t> output;
    if (!decode_charset(input, from, codepoints) || !encode_charset(codepoints, to, output)) { return -1; }
    return omega_edit::plugin::set_replacement(request_ptr, response_ptr, output);
}
