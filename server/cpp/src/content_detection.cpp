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

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <map>
#include <unordered_map>
#include <vector>

namespace omega_edit {
namespace grpc_server {

// ── Content type detection ───────────────────────────────────────────────────

std::string detect_content_type(const uint8_t *data, int64_t length) {
    if (!data || length <= 0) {
        return "application/octet-stream";
    }

    // Check for common magic bytes
    if (length >= 4) {
        // PDF
        if (data[0] == 0x25 && data[1] == 0x50 && data[2] == 0x44 && data[3] == 0x46) {
            return "application/pdf";
        }
        // PNG
        if (data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47) {
            return "image/png";
        }
        // GIF
        if (data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38) {
            return "image/gif";
        }
        // ZIP/DOCX/XLSX/JAR
        if (data[0] == 0x50 && data[1] == 0x4B && data[2] == 0x03 && data[3] == 0x04) {
            return "application/zip";
        }
    }
    if (length >= 2) {
        // JPEG
        if (data[0] == 0xFF && data[1] == 0xD8) {
            return "image/jpeg";
        }
    }

    // Check for BOM-prefixed text
    if (length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF) {
        return "text/plain"; // UTF-8 BOM
    }
    if (length >= 2) {
        if ((data[0] == 0xFE && data[1] == 0xFF) || (data[0] == 0xFF && data[1] == 0xFE)) {
            return "text/plain"; // UTF-16 BOM
        }
    }
    if (length >= 4) {
        if ((data[0] == 0x00 && data[1] == 0x00 && data[2] == 0xFE && data[3] == 0xFF) ||
            (data[0] == 0xFF && data[1] == 0xFE && data[2] == 0x00 && data[3] == 0x00)) {
            return "text/plain"; // UTF-32 BOM
        }
    }

    // Heuristic: check if the data appears to be text
    int non_text_bytes = 0;
    int check_len = static_cast<int>(std::min(length, static_cast<int64_t>(8192)));
    for (int i = 0; i < check_len; ++i) {
        uint8_t b = data[i];
        if (b == 0) {
            // Null byte usually means binary
            return "application/octet-stream";
        }
        if (b < 0x08 || (b > 0x0D && b < 0x20 && b != 0x1B)) {
            ++non_text_bytes;
        }
    }

    // If more than ~5% of bytes are non-text control chars, treat as binary
    if (non_text_bytes > check_len / 20) {
        return "application/octet-stream";
    }

    // Check for HTML
    std::string start(reinterpret_cast<const char *>(data), std::min(length, static_cast<int64_t>(256)));
    std::string lower_start = start;
    std::transform(lower_start.begin(), lower_start.end(), lower_start.begin(), ::tolower);
    if (lower_start.find("<!doctype html") != std::string::npos || lower_start.find("<html") != std::string::npos) {
        return "text/html";
    }
    if (lower_start.find("<?xml") != std::string::npos) {
        return "application/xml";
    }

    return "text/plain";
}

// ── Language detection ───────────────────────────────────────────────────────

// Trigram-based language detection.
// This is a simplified implementation using top trigram profiles for common languages.
// The Scala/Tika implementation uses Optimaize which has more sophisticated detection.

using TrigramProfile = std::unordered_map<std::string, int>;

static std::string make_trigram_key(const char *s) { return std::string(s, 3); }

static TrigramProfile build_profile(const std::string &text, int max_trigrams = 300) {
    TrigramProfile profile;
    if (text.size() < 3) return profile;

    for (size_t i = 0; i + 2 < text.size(); ++i) {
        // Skip trigrams with control characters
        if (static_cast<unsigned char>(text[i]) < 0x20 || static_cast<unsigned char>(text[i + 1]) < 0x20 ||
            static_cast<unsigned char>(text[i + 2]) < 0x20) {
            continue;
        }
        std::string tri = text.substr(i, 3);
        profile[tri]++;
    }

    // Keep only top N trigrams
    if (static_cast<int>(profile.size()) > max_trigrams) {
        std::vector<std::pair<std::string, int>> sorted_trigrams(profile.begin(), profile.end());
        std::sort(sorted_trigrams.begin(), sorted_trigrams.end(),
                  [](const auto &a, const auto &b) { return a.second > b.second; });
        profile.clear();
        for (int i = 0; i < max_trigrams && i < static_cast<int>(sorted_trigrams.size()); ++i) {
            profile[sorted_trigrams[i].first] = sorted_trigrams[i].second;
        }
    }

    return profile;
}

// Pre-computed top trigram signatures for various languages.
// These are simplified profiles using the most common Unicode trigram sequences
// for each language. In practice, a production system would use a larger database.
// clang-format off
struct LangProfile {
    const char *code;
    // Top trigrams as UTF-8 strings (space character represents word boundary)
    std::vector<std::string> top_trigrams;
};

static const std::vector<LangProfile> &get_lang_profiles() {
    static const std::vector<LangProfile> profiles = {
        // Arabic - characterized by Arabic script trigrams
        {"ar", {
            "\xd8\xa7\xd9\x84", "\xd9\x84\xd8\xa7", "\xd9\x85\xd8\xa7", "\xd8\xa7\xd9\x86",
            "\xd9\x88\xd8\xa7\xd9\x84", "\xd9\x81\xd9\x8a", "\xd8\xb9\xd9\x84\xd9\x89",
            "\xd8\xa3\xd9\x86", "\xd9\x85\xd9\x86", "\xd8\xa8\xd8\xa7\xd9\x84",
            "\xd9\x84\xd9\x84", "\xd8\xb0\xd9\x84\xd9\x83", "\xd9\x87\xd8\xb0\xd8\xa7"
        }},
        // Chinese - characterized by CJK trigrams
        {"zh-CN", {
            "\xe7\x9a\x84", "\xe4\xb8\x80", "\xe6\x98\xaf", "\xe4\xb8\x8d",
            "\xe4\xba\x86", "\xe4\xba\xba", "\xe6\x88\x91", "\xe5\x9c\xa8",
            "\xe6\x9c\x89", "\xe4\xbb\x96", "\xe8\xbf\x99", "\xe4\xb8\xad",
            "\xe5\xa4\xa7", "\xe6\x9d\xa5", "\xe4\xb8\x8a", "\xe5\x9b\xbd"
        }},
        // Dutch
        {"nl", {
            " de", "de ", "en ", " he", "het", "et ", "an ", " va", "van", " en",
            "er ", "een", " ee", "in ", " in", "aar", "den", " da", "dat", "nde"
        }},
        // English
        {"en", {
            " th", "the", "he ", " an", "and", "nd ", " to", " of", "of ", "to ",
            "in ", " in", "ion", "tio", "ati", " is", "ed ", "er ", " co", "ent"
        }},
        // French
        {"fr", {
            " de", "de ", "es ", " le", "le ", "ent", " la", "la ", "ion", " co",
            "les", " et", "et ", "ons", " pa", "des", " qu", "que", "ue ", " en"
        }},
        // German
        {"de", {
            "en ", "er ", " de", "der", " di", "die", "ie ", "ch ", "ein", " ei",
            "sch", "den", " un", "und", "nd ", "che", "ich", " da", "in ", "gen"
        }},
        // Greek - characterized by Greek script trigrams
        {"el", {
            "\xce\xb1\xce\xb9", "\xce\xbf\xcf\x85", "\xcf\x84\xce\xb7",
            "\xcf\x84\xce\xbf", "\xce\xb7\xce\xbd", "\xce\xb5\xce\xb9",
            "\xcf\x84\xce\xb1", "\xce\xba\xce\xb1\xce\xb9",
            "\xcf\x83\xcf\x84", "\xce\xb1\xce\xbd", "\xce\xb7\xcf\x82",
            "\xce\xb1\xcf\x82", "\xce\xbf\xce\xbd", "\xce\xb5\xcf\x82"
        }},
        // Hindi - characterized by Devanagari script
        {"hi", {
            "\xe0\xa4\x95", "\xe0\xa4\xb9", "\xe0\xa4\xae", "\xe0\xa4\xb0",
            "\xe0\xa4\xa8", "\xe0\xa4\xa4", "\xe0\xa4\xb2", "\xe0\xa4\xaa",
            "\xe0\xa4\x95\xe0\xa5\x87", "\xe0\xa4\x95\xe0\xa4\xbe",
            "\xe0\xa4\xae\xe0\xa5\x87\xe0\xa4\x82"
        }},
        // Italian
        {"it", {
            " di", "di ", " de", "la ", " la", "ell", " il", "il ", "del", "che",
            " ch", "one", " co", "ato", " in", "ent", "per", " pe", "lla", "zio"
        }},
        // Japanese - characterized by Hiragana/Katakana/CJK mix
        {"ja", {
            "\xe3\x81\xae", "\xe3\x81\xab", "\xe3\x81\x97", "\xe3\x81\xa6",
            "\xe3\x82\x92", "\xe3\x81\xaf", "\xe3\x81\xa8", "\xe3\x81\x8c",
            "\xe3\x81\xae\xe3\x81\xa7", "\xe3\x81\xbe\xe3\x81\x99",
            "\xe3\x81\xa7\xe3\x81\x99"
        }},
        // Korean - characterized by Hangul
        {"ko", {
            "\xec\x9d\x98", "\xec\x9d\xb4", "\xeb\x8a\x94", "\xec\x9d\x80",
            "\xed\x95\x98", "\xec\x97\x90", "\xeb\xa5\xbc", "\xeb\x8b\xa4",
            "\xea\xb3\xbc", "\xec\x97\x90\xec\x84\x9c"
        }},
        // Portuguese
        {"pt", {
            " de", "de ", "os ", " a ", " co", "do ", " do", "da ", " da", "que",
            " qu", "ent", "ão ", " no", " em", " se", "es ", "ção", "com", "par"
        }},
        // Russian - characterized by Cyrillic script
        {"ru", {
            "\xd0\xbe\xd0\xb2", "\xd0\xb5\xd0\xbd", "\xd0\xbd\xd0\xb0",
            "\xd0\xbd\xd0\xbe", "\xd0\xd0\xb5", "\xd0\xb0\xd0\xbd",
            "\xd1\x82\xd0\xbe", "\xd0\xb8\xd0\xb5", "\xd0\xbe\xd0\xb3\xd0\xbe",
            "\xd0\xb2\xd0\xbe", "\xd0\xbb\xd1\x8c", "\xd0\xbd\xd0\xb8"
        }},
        // Spanish
        {"es", {
            " de", "de ", " la", "la ", "os ", " el", "el ", "en ", " en", "ión",
            " co", "que", " qu", "es ", "ent", " lo", "nte", "las", " se", " un"
        }},
        // Swedish
        {"sv", {
            "en ", " oc", "och", "ch ", "er ", "att", " at", "tt ", "en ", "det",
            " de", "för", " fö", " so", "som", "om ", " ha", "har", " i ", "ing"
        }},
    };
    return profiles;
}
// clang-format on

/// Convert data from a specific BOM encoding to UTF-8
static std::string convert_to_utf8(const uint8_t *data, int64_t length, const std::string &bom) {
    if (bom == "none" || bom == "unknown" || bom == "UTF-8") {
        // Skip UTF-8 BOM if present
        if (length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF) {
            return std::string(reinterpret_cast<const char *>(data + 3), length - 3);
        }
        return std::string(reinterpret_cast<const char *>(data), length);
    }

    // For non-UTF-8 encoded text, we do a simplified conversion
    // In production, you'd use iconv or ICU here.
    // For UTF-16/UTF-32, we do a basic conversion that handles common BMP characters.

    std::string result;
    if (bom == "UTF-16LE") {
        // Skip BOM (2 bytes)
        int64_t start = (length >= 2 && data[0] == 0xFF && data[1] == 0xFE) ? 2 : 0;
        for (int64_t i = start; i + 1 < length; i += 2) {
            uint16_t cp = static_cast<uint16_t>(data[i]) | (static_cast<uint16_t>(data[i + 1]) << 8);
            if (cp < 0x80) {
                result += static_cast<char>(cp);
            } else if (cp < 0x800) {
                result += static_cast<char>(0xC0 | (cp >> 6));
                result += static_cast<char>(0x80 | (cp & 0x3F));
            } else {
                result += static_cast<char>(0xE0 | (cp >> 12));
                result += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
                result += static_cast<char>(0x80 | (cp & 0x3F));
            }
        }
    } else if (bom == "UTF-16BE") {
        int64_t start = (length >= 2 && data[0] == 0xFE && data[1] == 0xFF) ? 2 : 0;
        for (int64_t i = start; i + 1 < length; i += 2) {
            uint16_t cp = (static_cast<uint16_t>(data[i]) << 8) | static_cast<uint16_t>(data[i + 1]);
            if (cp < 0x80) {
                result += static_cast<char>(cp);
            } else if (cp < 0x800) {
                result += static_cast<char>(0xC0 | (cp >> 6));
                result += static_cast<char>(0x80 | (cp & 0x3F));
            } else {
                result += static_cast<char>(0xE0 | (cp >> 12));
                result += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
                result += static_cast<char>(0x80 | (cp & 0x3F));
            }
        }
    } else if (bom == "UTF-32LE") {
        int64_t start =
            (length >= 4 && data[0] == 0xFF && data[1] == 0xFE && data[2] == 0x00 && data[3] == 0x00) ? 4 : 0;
        for (int64_t i = start; i + 3 < length; i += 4) {
            uint32_t cp = static_cast<uint32_t>(data[i]) | (static_cast<uint32_t>(data[i + 1]) << 8) |
                          (static_cast<uint32_t>(data[i + 2]) << 16) | (static_cast<uint32_t>(data[i + 3]) << 24);
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
        }
    } else if (bom == "UTF-32BE") {
        int64_t start =
            (length >= 4 && data[0] == 0x00 && data[1] == 0x00 && data[2] == 0xFE && data[3] == 0xFF) ? 4 : 0;
        for (int64_t i = start; i + 3 < length; i += 4) {
            uint32_t cp = (static_cast<uint32_t>(data[i]) << 24) | (static_cast<uint32_t>(data[i + 1]) << 16) |
                          (static_cast<uint32_t>(data[i + 2]) << 8) | static_cast<uint32_t>(data[i + 3]);
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
        }
    } else {
        // Unknown encoding, return as-is
        return std::string(reinterpret_cast<const char *>(data), length);
    }

    return result;
}

/// Score how well the text matches a language profile
static double score_profile(const TrigramProfile &text_profile, const std::vector<std::string> &lang_trigrams) {
    if (text_profile.empty() || lang_trigrams.empty()) return 0.0;

    double matches = 0;
    for (const auto &tri : lang_trigrams) {
        auto it = text_profile.find(tri);
        if (it != text_profile.end()) {
            matches += static_cast<double>(it->second);
        }
    }

    // Normalize by the total count
    double total = 0;
    for (const auto &kv : text_profile) {
        total += kv.second;
    }

    return total > 0 ? matches / total : 0.0;
}

/// Detect if a byte sequence is primarily a specific Unicode script
static bool is_script(const uint8_t *data, int64_t length, uint32_t range_start, uint32_t range_end) {
    int script_chars = 0;
    int total_chars = 0;
    for (int64_t i = 0; i < length;) {
        uint32_t cp = 0;
        int bytes = 0;
        uint8_t b = data[i];
        if (b < 0x80) {
            cp = b;
            bytes = 1;
        } else if ((b & 0xE0) == 0xC0) {
            cp = b & 0x1F;
            bytes = 2;
        } else if ((b & 0xF0) == 0xE0) {
            cp = b & 0x0F;
            bytes = 3;
        } else if ((b & 0xF8) == 0xF0) {
            cp = b & 0x07;
            bytes = 4;
        } else {
            i++;
            continue;
        }
        if (i + bytes > length) break;
        for (int j = 1; j < bytes; ++j) {
            cp = (cp << 6) | (data[i + j] & 0x3F);
        }
        i += bytes;
        if (cp >= 0x20) { // Skip control chars
            total_chars++;
            if (cp >= range_start && cp <= range_end) {
                script_chars++;
            }
        }
    }
    return total_chars > 0 && script_chars > total_chars / 3;
}

std::string detect_language(const uint8_t *data, int64_t length, const std::string &bom) {
    if (!data || length <= 0) {
        return "unknown";
    }

    // Convert to UTF-8 for analysis
    std::string text = convert_to_utf8(data, length, bom);
    if (text.empty() || text.size() < 10) {
        return "unknown";
    }

    // Quick script-based detection for non-Latin scripts using Unicode ranges
    const uint8_t *utf8_data = reinterpret_cast<const uint8_t *>(text.data());
    int64_t utf8_len = static_cast<int64_t>(text.size());

    // Arabic: U+0600-U+06FF
    if (is_script(utf8_data, utf8_len, 0x0600, 0x06FF)) {
        return "ar";
    }
    // Devanagari (Hindi): U+0900-U+097F
    if (is_script(utf8_data, utf8_len, 0x0900, 0x097F)) {
        return "hi";
    }
    // CJK detection - need to distinguish between Chinese, Japanese, Korean
    bool has_cjk = is_script(utf8_data, utf8_len, 0x4E00, 0x9FFF);
    bool has_hiragana = is_script(utf8_data, utf8_len, 0x3040, 0x309F);
    bool has_katakana = is_script(utf8_data, utf8_len, 0x30A0, 0x30FF);
    bool has_hangul = is_script(utf8_data, utf8_len, 0xAC00, 0xD7AF);

    if (has_hangul) return "ko";
    if (has_hiragana || has_katakana) return "ja";
    if (has_cjk) return "zh-CN";

    // Greek: U+0370-U+03FF
    if (is_script(utf8_data, utf8_len, 0x0370, 0x03FF)) {
        return "el";
    }
    // Cyrillic: U+0400-U+04FF
    if (is_script(utf8_data, utf8_len, 0x0400, 0x04FF)) {
        return "ru";
    }

    // For Latin-based scripts, use trigram analysis
    auto text_profile = build_profile(text);
    if (text_profile.empty()) {
        return "unknown";
    }

    const auto &lang_profiles = get_lang_profiles();
    std::string best_lang = "unknown";
    double best_score = 0.0;

    for (const auto &lang : lang_profiles) {
        double score = score_profile(text_profile, lang.top_trigrams);
        if (score > best_score) {
            best_score = score;
            best_lang = lang.code;
        }
    }

    // Require a minimum confidence score
    if (best_score < 0.001) {
        return "unknown";
    }

    return best_lang;
}

} // namespace grpc_server
} // namespace omega_edit
