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
#include <string>
#include <vector>

namespace omega_edit {
namespace grpc_server {

/// Detect the content/MIME type of a data buffer.
/// Uses libmagic on platforms where it is available, falls back to heuristic detection.
std::string detect_content_type(const uint8_t *data, int64_t length);

/// Detect the language of a text buffer.
/// Uses trigram-based language detection to identify the language of UTF-8 text.
/// Returns a 2-letter ISO 639-1 language code, or "unknown" if the language cannot be determined.
std::string detect_language(const uint8_t *data, int64_t length, const std::string &bom);

} // namespace grpc_server
} // namespace omega_edit

#endif // OMEGA_EDIT_CONTENT_DETECTION_H
