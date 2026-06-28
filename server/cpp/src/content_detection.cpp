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
#include <cstring>
#include <string>

namespace omega_edit {
    namespace grpc_server {
        namespace {

            bool starts_with(const uint8_t *data, int64_t length, const char *signature, size_t signature_length) {
                return data != nullptr && length >= static_cast<int64_t>(signature_length) &&
                       std::memcmp(data, signature, signature_length) == 0;
            }

            bool starts_with_bytes(const uint8_t *data, int64_t length, const uint8_t *signature,
                                   size_t signature_length) {
                return data != nullptr && length >= static_cast<int64_t>(signature_length) &&
                       std::memcmp(data, signature, signature_length) == 0;
            }

            std::string lower_extension(const std::string &file_path) {
                const auto slash = file_path.find_last_of("\\/");
                const auto dot = file_path.find_last_of('.');
                if (dot == std::string::npos || (slash != std::string::npos && dot < slash)) { return ""; }

                std::string ext = file_path.substr(dot);
                std::transform(ext.begin(), ext.end(), ext.begin(),
                               [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
                return ext;
            }

            bool has_utf16_bom(const uint8_t *data, int64_t length) {
                return length >= 2 && ((data[0] == 0xff && data[1] == 0xfe) || (data[0] == 0xfe && data[1] == 0xff));
            }

            bool has_utf8_bom(const uint8_t *data, int64_t length) {
                return length >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf;
            }

            bool is_valid_utf8(const uint8_t *data, int64_t length) {
                for (int64_t i = 0; i < length;) {
                    const uint8_t byte = data[i];
                    if (byte < 0x80) {
                        ++i;
                        continue;
                    }

                    int extra = 0;
                    if ((byte & 0xe0) == 0xc0) {
                        extra = 1;
                        if (byte < 0xc2) return false;
                    } else if ((byte & 0xf0) == 0xe0) {
                        extra = 2;
                    } else if ((byte & 0xf8) == 0xf0) {
                        extra = 3;
                        if (byte > 0xf4) return false;
                    } else {
                        return false;
                    }

                    if (i + extra >= length) return false;
                    for (int j = 1; j <= extra; ++j) {
                        if ((data[i + j] & 0xc0) != 0x80) return false;
                    }

                    i += extra + 1;
                }
                return true;
            }

            bool is_likely_text(const uint8_t *data, int64_t length) {
                if (!data || length <= 0) return false;
                if (has_utf16_bom(data, length) || has_utf8_bom(data, length)) return true;
                if (!is_valid_utf8(data, length)) return false;

                int64_t control_count = 0;
                for (int64_t i = 0; i < length; ++i) {
                    const uint8_t byte = data[i];
                    if (byte == 0) return false;
                    if (byte < 0x20 && byte != '\t' && byte != '\r' && byte != '\n' && byte != '\f' && byte != '\b') {
                        ++control_count;
                    }
                }

                return control_count <= std::max<int64_t>(1, length / 50);
            }

            std::string ascii_prefix(const uint8_t *data, int64_t length) {
                const int64_t limit = std::min<int64_t>(length, 4096);
                std::string text;
                text.reserve(static_cast<size_t>(limit));
                for (int64_t i = 0; i < limit; ++i) {
                    const uint8_t byte = data[i];
                    text.push_back(byte < 0x80 ? static_cast<char>(byte) : ' ');
                }
                std::transform(text.begin(), text.end(), text.begin(),
                               [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
                return text;
            }

            bool extension_is_markdown(const std::string &ext) {
                return ext == ".md" || ext == ".markdown" || ext == ".mdown" || ext == ".mkd";
            }

            bool extension_is_plain_text(const std::string &ext) {
                return ext == ".txt" || ext == ".log" || ext == ".csv" || ext == ".tsv" || ext == ".yaml" ||
                       ext == ".yml" || ext == ".toml" || ext == ".ini" || ext == ".css" || ext == ".js" ||
                       ext == ".ts" || ext == ".tsx" || ext == ".jsx" || ext == ".py" || ext == ".sh" ||
                       ext == ".ps1" || ext == ".c" || ext == ".cc" || ext == ".cpp" || ext == ".h" || ext == ".hpp" ||
                       ext == ".java" || ext == ".rs" || ext == ".go" || ext == ".sql";
            }

            bool looks_like_markdown(const std::string &text) {
                int score = 0;
                if (text.find("\n# ") != std::string::npos || text.rfind("# ", 0) == 0) ++score;
                if (text.find("\n##") != std::string::npos || text.rfind("##", 0) == 0) ++score;
                if (text.find("\n- ") != std::string::npos || text.find("\n* ") != std::string::npos) ++score;
                if (text.find("](") != std::string::npos) ++score;
                if (text.find("\n```") != std::string::npos || text.rfind("```", 0) == 0) ++score;
                if (text.find("\n|") != std::string::npos && text.find("|") != std::string::npos) ++score;
                if (text.find("<h1") != std::string::npos || text.find("<div") != std::string::npos) ++score;
                return score >= 2;
            }

            std::string detect_text_type(const uint8_t *data, int64_t length, const std::string &ext) {
                const std::string text = ascii_prefix(data, length);
                const size_t first = text.find_first_not_of(" \t\r\n");
                const std::string leading = first == std::string::npos ? "" : text.substr(first, 32);

                if (extension_is_markdown(ext) || looks_like_markdown(text)) return "text/markdown";
                if (ext == ".json" || leading.rfind("{", 0) == 0 || leading.rfind("[", 0) == 0)
                    return "application/json";
                if (ext == ".xml" || leading.rfind("<?xml", 0) == 0) return "application/xml";
                if (ext == ".html" || ext == ".htm" || leading.rfind("<!doctype html", 0) == 0 ||
                    leading.rfind("<html", 0) == 0) {
                    return "text/html";
                }
                if (extension_is_plain_text(ext)) return "text/plain";
                return "text/plain";
            }

        }// namespace

        std::string detect_builtin_content_type(const uint8_t *data, int64_t length, const std::string &file_path) {
            if (!data || length <= 0) { return "application/octet-stream"; }

            static constexpr uint8_t png_signature[] = {0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a};
            static constexpr uint8_t jpg_signature[] = {0xff, 0xd8, 0xff};
            static constexpr uint8_t gzip_signature[] = {0x1f, 0x8b};
            static constexpr uint8_t elf_signature[] = {0x7f, 'E', 'L', 'F'};

            if (starts_with_bytes(data, length, png_signature, sizeof(png_signature))) return "image/png";
            if (starts_with_bytes(data, length, jpg_signature, sizeof(jpg_signature))) return "image/jpeg";
            if (starts_with(data, length, "GIF87a", 6) || starts_with(data, length, "GIF89a", 6)) return "image/gif";
            if (starts_with(data, length, "%PDF-", 5)) return "application/pdf";
            if (starts_with(data, length, "PK\003\004", 4) || starts_with(data, length, "PK\005\006", 4) ||
                starts_with(data, length, "PK\007\010", 4)) {
                return "application/zip";
            }
            if (starts_with_bytes(data, length, gzip_signature, sizeof(gzip_signature))) return "application/gzip";
            if (starts_with(data, length, "BM", 2)) return "image/bmp";
            if (starts_with_bytes(data, length, elf_signature, sizeof(elf_signature))) return "application/x-elf";
            if (length >= 12 && starts_with(data, length, "RIFF", 4) && std::memcmp(data + 8, "WEBP", 4) == 0) {
                return "image/webp";
            }

            if (is_likely_text(data, length)) { return detect_text_type(data, length, lower_extension(file_path)); }

            return "application/octet-stream";
        }

    }// namespace grpc_server
}// namespace omega_edit
