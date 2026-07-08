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

#include <cld3/nnet_language_identifier.h>

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

    constexpr const char *LANGUAGE_ARGS_SCHEMA = R"json({
  "type": "object",
  "properties": {
    "byteOrderMark": {
      "type": "string",
      "title": "Byte order mark",
      "description": "Encoding hint for converting selected text to UTF-8 before CLD3 detection.",
      "default": "none",
      "enum": ["none", "unknown", "UTF-8", "UTF-16LE", "UTF-16BE", "UTF-32LE", "UTF-32BE"]
    }
  },
  "additionalProperties": false
})json";

    const std::unordered_map<std::string, std::string> &bcp47_to_short() {
        static const std::unordered_map<std::string, std::string> table = {
                {"en", "en"}, {"fr", "fr"}, {"de", "de"},    {"es", "es"},         {"pt", "pt"}, {"it", "it"},
                {"nl", "nl"}, {"sv", "sv"}, {"ru", "ru"},    {"ar", "ar"},         {"hi", "hi"}, {"el", "el"},
                {"ja", "ja"}, {"ko", "ko"}, {"zh", "zh-CN"}, {"zh-Latn", "zh-CN"},
        };
        return table;
    }

    std::string normalize_language_code(const std::string &cld3_code) {
        if (cld3_code == chrome_lang_id::NNetLanguageIdentifier::kUnknown) { return "unknown"; }

        const auto &table = bcp47_to_short();
        auto it = table.find(cld3_code);
        if (it != table.end()) { return it->second; }

        const auto dash = cld3_code.find('-');
        if (dash != std::string::npos) {
            const auto base = cld3_code.substr(0, dash);
            it = table.find(base);
            if (it != table.end()) { return it->second; }
            return base;
        }
        return cld3_code;
    }

    void push_utf8_codepoint(std::string &result, uint32_t cp) {
        if (cp < 0x80) {
            result += static_cast<char>(cp);
        } else if (cp < 0x800) {
            result += static_cast<char>(0xc0 | (cp >> 6));
            result += static_cast<char>(0x80 | (cp & 0x3f));
        } else if (cp < 0x10000) {
            result += static_cast<char>(0xe0 | (cp >> 12));
            result += static_cast<char>(0x80 | ((cp >> 6) & 0x3f));
            result += static_cast<char>(0x80 | (cp & 0x3f));
        } else if (cp < 0x110000) {
            result += static_cast<char>(0xf0 | (cp >> 18));
            result += static_cast<char>(0x80 | ((cp >> 12) & 0x3f));
            result += static_cast<char>(0x80 | ((cp >> 6) & 0x3f));
            result += static_cast<char>(0x80 | (cp & 0x3f));
        }
    }

    std::string convert_to_utf8(const uint8_t *data, int64_t length, const std::string &bom) {
        if (!data || length <= 0) { return {}; }
        if (bom == "none" || bom == "unknown" || bom == "UTF-8") {
            if (length >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf) {
                return std::string(reinterpret_cast<const char *>(data + 3), static_cast<size_t>(length - 3));
            }
            return std::string(reinterpret_cast<const char *>(data), static_cast<size_t>(length));
        }

        std::string result;
        if (bom == "UTF-16LE") {
            const int64_t start = (length >= 2 && data[0] == 0xff && data[1] == 0xfe) ? 2 : 0;
            for (int64_t i = start; i + 1 < length; i += 2) {
                push_utf8_codepoint(result,
                                    static_cast<uint16_t>(data[i]) |
                                            (static_cast<uint16_t>(data[i + 1]) << 8));
            }
        } else if (bom == "UTF-16BE") {
            const int64_t start = (length >= 2 && data[0] == 0xfe && data[1] == 0xff) ? 2 : 0;
            for (int64_t i = start; i + 1 < length; i += 2) {
                push_utf8_codepoint(result,
                                    (static_cast<uint16_t>(data[i]) << 8) | static_cast<uint16_t>(data[i + 1]));
            }
        } else if (bom == "UTF-32LE") {
            const int64_t start =
                    (length >= 4 && data[0] == 0xff && data[1] == 0xfe && data[2] == 0x00 && data[3] == 0x00) ? 4
                                                                                                              : 0;
            for (int64_t i = start; i + 3 < length; i += 4) {
                push_utf8_codepoint(result, static_cast<uint32_t>(data[i]) |
                                                    (static_cast<uint32_t>(data[i + 1]) << 8) |
                                                    (static_cast<uint32_t>(data[i + 2]) << 16) |
                                                    (static_cast<uint32_t>(data[i + 3]) << 24));
            }
        } else if (bom == "UTF-32BE") {
            const int64_t start =
                    (length >= 4 && data[0] == 0x00 && data[1] == 0x00 && data[2] == 0xfe && data[3] == 0xff) ? 4
                                                                                                              : 0;
            for (int64_t i = start; i + 3 < length; i += 4) {
                push_utf8_codepoint(result, (static_cast<uint32_t>(data[i]) << 24) |
                                                    (static_cast<uint32_t>(data[i + 1]) << 16) |
                                                    (static_cast<uint32_t>(data[i + 2]) << 8) |
                                                    static_cast<uint32_t>(data[i + 3]));
            }
        } else {
            return std::string(reinterpret_cast<const char *>(data), static_cast<size_t>(length));
        }

        return result;
    }

    std::string detect_language(const std::vector<omega_byte_t> &input, const std::string &bom) {
        if (input.empty()) { return "unknown"; }

        const auto *data = reinterpret_cast<const uint8_t *>(input.data());
        const std::string text = convert_to_utf8(data, static_cast<int64_t>(input.size()), bom);
        if (text.size() < 10) { return "unknown"; }

        chrome_lang_id::NNetLanguageIdentifier identifier(0, 4096);
        const auto result = identifier.FindLanguage(text);
        if (result.language == chrome_lang_id::NNetLanguageIdentifier::kUnknown) { return "unknown"; }

        std::string lang = normalize_language_code(result.language);
        static constexpr size_t MIN_JA_DETECT_BYTES = 100;
        if (lang == "ja" && text.size() < MIN_JA_DETECT_BYTES) { return "unknown"; }
        return lang;
    }

}// namespace

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.detect.language";
    info_ptr->name = "Language Detection";
    info_ptr->description = "Detect the selected text language using CLD3.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_TEXT_RESULT | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_STREAMING;
    info_ptr->help = "Pass byteOrderMark when the selection is UTF-16 or UTF-32 so the plugin can convert it to UTF-8.";
    info_ptr->example = "{\"byteOrderMark\":\"UTF-16LE\"}";
    info_ptr->default_args = "{\"byteOrderMark\":\"none\"}";
    info_ptr->args_schema = LANGUAGE_ARGS_SCHEMA;
    info_ptr->support = OMEGA_TRANSFORM_PLUGIN_SUPPORT_PRODUCTION;
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

    const std::string bom = omega_edit::plugin::option_or(options, "byteOrderMark", "none");
    const std::string language = detect_language(input, bom);
    return omega_edit::plugin::set_text_result(request_ptr, response_ptr, "language", language);
}
