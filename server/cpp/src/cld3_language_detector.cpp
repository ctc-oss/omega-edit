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

#include "content_detection.h"

#include <cld3/nnet_language_identifier.h>
#include <algorithm>
#include <cstring>
#include <unordered_map>

namespace omega_edit {
namespace grpc_server {

// ── CLD3-backed language detector ────────────────────────────────────────────

/// Maps CLD3's BCP-47 codes to the short codes expected by the test suite
/// (which historically used Tika/Optimaize style codes).
static const std::unordered_map<std::string, std::string> &bcp47_to_short() {
    static const std::unordered_map<std::string, std::string> table = {
        {"en", "en"}, {"fr", "fr"}, {"de", "de"}, {"es", "es"}, {"pt", "pt"}, {"it", "it"},
        {"nl", "nl"}, {"sv", "sv"}, {"ru", "ru"}, {"ar", "ar"}, {"hi", "hi"}, {"el", "el"},
        {"ja", "ja"}, {"ko", "ko"}, {"zh", "zh-CN"}, {"zh-Latn", "zh-CN"},
    };
    return table;
}

/// Convert CLD3 language code to the codes expected by downstream clients.
static std::string normalize_language_code(const std::string &cld3_code) {
    // CLD3 returns "und" for undetermined
    if (cld3_code == chrome_lang_id::NNetLanguageIdentifier::kUnknown) {
        return "unknown";
    }
    // Try exact match first
    auto &table = bcp47_to_short();
    auto it = table.find(cld3_code);
    if (it != table.end()) {
        return it->second;
    }
    // Split on '-' and try the base tag (e.g. "zh-Hant" → "zh")
    auto dash = cld3_code.find('-');
    if (dash != std::string::npos) {
        auto base = cld3_code.substr(0, dash);
        it = table.find(base);
        if (it != table.end()) {
            return it->second;
        }
        return base;
    }
    return cld3_code;
}

/// Convert data from a BOM encoding to a UTF-8 std::string for analysis.
static std::string convert_to_utf8(const uint8_t *data, int64_t length, const std::string &bom) {
    if (bom == "none" || bom == "unknown" || bom == "UTF-8") {
        // Skip UTF-8 BOM if present
        if (length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF) {
            return std::string(reinterpret_cast<const char *>(data + 3), length - 3);
        }
        return std::string(reinterpret_cast<const char *>(data), length);
    }

    // Simplified UTF-16/32 → UTF-8 for BMP characters
    std::string result;

    auto push_codepoint = [&](uint32_t cp) {
        if (cp < 0x80) {
            result += static_cast<char>(cp);
        } else if (cp < 0x800) {
            result += static_cast<char>(0xC0 | (cp >> 6));
            result += static_cast<char>(0x80 | (cp & 0x3F));
        } else if (cp < 0x10000) {
            result += static_cast<char>(0xE0 | (cp >> 12));
            result += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            result += static_cast<char>(0x80 | (cp & 0x3F));
        } else if (cp < 0x110000) {
            result += static_cast<char>(0xF0 | (cp >> 18));
            result += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
            result += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            result += static_cast<char>(0x80 | (cp & 0x3F));
        }
    };

    if (bom == "UTF-16LE") {
        int64_t start = (length >= 2 && data[0] == 0xFF && data[1] == 0xFE) ? 2 : 0;
        for (int64_t i = start; i + 1 < length; i += 2) {
            push_codepoint(static_cast<uint16_t>(data[i]) | (static_cast<uint16_t>(data[i + 1]) << 8));
        }
    } else if (bom == "UTF-16BE") {
        int64_t start = (length >= 2 && data[0] == 0xFE && data[1] == 0xFF) ? 2 : 0;
        for (int64_t i = start; i + 1 < length; i += 2) {
            push_codepoint((static_cast<uint16_t>(data[i]) << 8) | static_cast<uint16_t>(data[i + 1]));
        }
    } else if (bom == "UTF-32LE") {
        int64_t start = (length >= 4 && data[0] == 0xFF && data[1] == 0xFE && data[2] == 0x00 && data[3] == 0x00)
                            ? 4
                            : 0;
        for (int64_t i = start; i + 3 < length; i += 4) {
            push_codepoint(static_cast<uint32_t>(data[i]) | (static_cast<uint32_t>(data[i + 1]) << 8) |
                           (static_cast<uint32_t>(data[i + 2]) << 16) | (static_cast<uint32_t>(data[i + 3]) << 24));
        }
    } else if (bom == "UTF-32BE") {
        int64_t start = (length >= 4 && data[0] == 0x00 && data[1] == 0x00 && data[2] == 0xFE && data[3] == 0xFF)
                            ? 4
                            : 0;
        for (int64_t i = start; i + 3 < length; i += 4) {
            push_codepoint((static_cast<uint32_t>(data[i]) << 24) | (static_cast<uint32_t>(data[i + 1]) << 16) |
                           (static_cast<uint32_t>(data[i + 2]) << 8) | static_cast<uint32_t>(data[i + 3]));
        }
    } else {
        return std::string(reinterpret_cast<const char *>(data), length);
    }

    return result;
}

class Cld3LanguageDetector final : public ILanguageDetector {
public:
    Cld3LanguageDetector() : identifier_(0, 4096) {}

    std::string detect(const uint8_t *data, int64_t length, const std::string &bom) override {
        if (!data || length <= 0) {
            return "unknown";
        }

        std::string text = convert_to_utf8(data, length, bom);
        if (text.size() < 10) {
            return "unknown";
        }

        auto result = identifier_.FindLanguage(text);
        if (result.language == chrome_lang_id::NNetLanguageIdentifier::kUnknown) {
            return "unknown";
        }

        std::string lang = normalize_language_code(result.language);

        // CLD3 detects Japanese aggressively due to its distinctive script
        // mixture (kanji + kana).  For parity with the Scala server's
        // Tika/Optimaize backend (which needed more text for Japanese),
        // require a minimum UTF-8 byte count for Japanese detection only.
        static constexpr size_t MIN_JA_DETECT_BYTES = 100;
        if (lang == "ja" && text.size() < MIN_JA_DETECT_BYTES) {
            return "unknown";
        }

        return lang;
    }

private:
    chrome_lang_id::NNetLanguageIdentifier identifier_;
};

std::unique_ptr<ILanguageDetector> create_default_language_detector() {
    return std::make_unique<Cld3LanguageDetector>();
}

} // namespace grpc_server
} // namespace omega_edit
