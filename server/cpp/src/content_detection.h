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

#ifndef OMEGA_EDIT_CONTENT_DETECTION_H
#define OMEGA_EDIT_CONTENT_DETECTION_H

#include <cstdint>
#include <memory>
#include <string>

namespace omega_edit {
namespace grpc_server {

// ── Pluggable interfaces ─────────────────────────────────────────────────────

/// Abstract interface for content/MIME type detection.
/// Implementations may use libmagic, heuristics, or any other backend.
class IContentTypeDetector {
public:
    virtual ~IContentTypeDetector() = default;

    /// Detect the MIME type of a data buffer.
    /// @param data pointer to the raw bytes
    /// @param length number of bytes
    /// @return MIME type string (e.g. "text/plain", "application/pdf")
    virtual std::string detect(const uint8_t *data, int64_t length) = 0;
};

/// Abstract interface for language detection.
/// Implementations may use CLD3, trigrams, or any other backend.
class ILanguageDetector {
public:
    virtual ~ILanguageDetector() = default;

    /// Detect the language of a text buffer.
    /// @param data pointer to the raw bytes (expected to be text)
    /// @param length number of bytes
    /// @param bom byte-order mark hint (e.g. "UTF-8", "UTF-16LE", "none")
    /// @return ISO 639-1 language code (e.g. "en", "ja") or "unknown"
    virtual std::string detect(const uint8_t *data, int64_t length, const std::string &bom) = 0;
};

// ── Factory functions ────────────────────────────────────────────────────────

/// Create the default content-type detector (libmagic-backed).
std::unique_ptr<IContentTypeDetector> create_default_content_type_detector();

/// Create the default language detector (CLD3-backed).
std::unique_ptr<ILanguageDetector> create_default_language_detector();

} // namespace grpc_server
} // namespace omega_edit

#endif // OMEGA_EDIT_CONTENT_DETECTION_H
