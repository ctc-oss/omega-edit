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

#include <magic.h>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <mutex>

#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#include <climits>
#endif

namespace omega_edit {
namespace grpc_server {

// ── libmagic-backed content-type detector ────────────────────────────────────

/// Get the directory containing the running executable.
static std::string get_executable_dir() {
#ifdef _WIN32
    char buf[MAX_PATH] = {0};
    DWORD len = GetModuleFileNameA(nullptr, buf, MAX_PATH);
    if (len > 0 && len < MAX_PATH) {
        std::string path(buf, len);
        auto pos = path.find_last_of("\\/");
        if (pos != std::string::npos) return path.substr(0, pos);
    }
#else
    char buf[PATH_MAX] = {0};
    ssize_t len = readlink("/proc/self/exe", buf, PATH_MAX - 1);
    if (len > 0) {
        std::string path(buf, len);
        auto pos = path.find_last_of('/');
        if (pos != std::string::npos) return path.substr(0, pos);
    }
#endif
    return {};
}

class LibmagicContentTypeDetector final : public IContentTypeDetector {
public:
    LibmagicContentTypeDetector() {
        cookie_ = magic_open(MAGIC_MIME_TYPE | MAGIC_ERROR);
        if (!cookie_) {
            std::cerr << "warning: magic_open() failed, content detection will fall back to octet-stream\n";
            return;
        }

        // Try to load the magic database in order of preference:
        // 1. MAGIC_FILE env var (for custom deployments)
        // 2. magic.mgc adjacent to the executable (for bundled distributions)
        // 3. Compile-time path from vcpkg (MAGIC_MGC_PATH define)
        // 4. System default (nullptr)
        const char *magic_file = std::getenv("MAGIC_FILE");
        std::string adjacent_path;
        if (!magic_file) {
            auto dir = get_executable_dir();
            if (!dir.empty()) {
                adjacent_path = dir + "/magic.mgc";
                // Check if the file exists
                FILE *f = std::fopen(adjacent_path.c_str(), "rb");
                if (f) {
                    std::fclose(f);
                    magic_file = adjacent_path.c_str();
                }
            }
        }
#ifdef MAGIC_MGC_PATH
        if (!magic_file) {
            magic_file = MAGIC_MGC_PATH;
        }
#endif
        if (magic_load(cookie_, magic_file) != 0) {
            // Try without a path (system default)
            if (magic_load(cookie_, nullptr) != 0) {
                std::cerr << "warning: magic_load() failed: " << magic_error(cookie_)
                          << " — content detection will fall back to octet-stream\n";
                magic_close(cookie_);
                cookie_ = nullptr;
            }
        }
    }

    ~LibmagicContentTypeDetector() override {
        if (cookie_) {
            magic_close(cookie_);
        }
    }

    // Disallow copy
    LibmagicContentTypeDetector(const LibmagicContentTypeDetector &) = delete;
    LibmagicContentTypeDetector &operator=(const LibmagicContentTypeDetector &) = delete;

    std::string detect(const uint8_t *data, int64_t length) override {
        if (!data || length <= 0) {
            return "application/octet-stream";
        }
        if (!cookie_) {
            return "application/octet-stream";
        }

        // libmagic is not thread-safe for a single cookie, so serialize access
        std::lock_guard<std::mutex> lock(mutex_);
        const char *mime = magic_buffer(cookie_, data, static_cast<size_t>(length));
        if (!mime) {
            return "application/octet-stream";
        }
        return std::string(mime);
    }

private:
    magic_t cookie_ = nullptr;
    std::mutex mutex_;
};

std::unique_ptr<IContentTypeDetector> create_default_content_type_detector() {
    return std::make_unique<LibmagicContentTypeDetector>();
}

} // namespace grpc_server
} // namespace omega_edit
