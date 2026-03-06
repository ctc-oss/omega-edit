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

/// @file stub_content_detector.cpp
/// Stub content-type detector used when libmagic is not available (e.g., Windows CI).
/// Always returns "application/octet-stream".

#include "content_detection.h"

namespace omega_edit {
namespace grpc_server {

class StubContentTypeDetector final : public IContentTypeDetector {
public:
    std::string detect(const uint8_t * /*data*/, int64_t /*length*/) override { return "application/octet-stream"; }
};

std::unique_ptr<IContentTypeDetector> create_default_content_type_detector() {
    return std::make_unique<StubContentTypeDetector>();
}

} // namespace grpc_server
} // namespace omega_edit
