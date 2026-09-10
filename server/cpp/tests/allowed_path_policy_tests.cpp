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

#include "allowed_path_policy.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

namespace fs = std::filesystem;
using omega_edit::grpc_server::AllowedPathPolicy;
using omega_edit::grpc_server::AllowedPathResult;

namespace {
    int failures = 0;

    void check(bool condition, const char *message) {
        if (!condition) {
            std::cerr << message << '\n';
            ++failures;
        }
    }
}// namespace

int main() {
    const auto unique = std::to_string(std::chrono::steady_clock::now().time_since_epoch().count());
    const auto base = fs::temp_directory_path() / ("omega-edit-allowed-root-" + unique);
    const auto root = base / "root";
    const auto outside = base / "outside";
    fs::create_directories(root / "nested");
    fs::create_directories(outside);
    std::ofstream(root / "inside.dat") << "inside";
    std::ofstream(outside / "outside.dat") << "outside";

    AllowedPathPolicy policy;
    std::string error;
    check(policy.configure(root.string(), error), "allowed root should configure");

    std::string resolved;
    error.clear();
    check(policy.resolve_existing_file((root / "inside.dat").string(), resolved, error) == AllowedPathResult::OK,
          "file inside root should resolve");
    error.clear();
    check(policy.resolve_existing_file((outside / "outside.dat").string(), resolved, error) ==
                  AllowedPathResult::OUTSIDE_ROOT,
          "file outside root should be rejected");
    error.clear();
    check(policy.resolve_output_file((root / "nested" / "new" / "result.dat").string(), resolved, error) ==
                  AllowedPathResult::OK,
          "new output inside root should resolve");
    error.clear();
    check(policy.resolve_output_file((root / "nested" / ".." / "result.dat").string(), resolved, error) ==
                  AllowedPathResult::INVALID_PATH,
          "parent traversal should be rejected");

#ifndef _WIN32
    fs::create_symlink(outside / "outside.dat", root / "escape.dat");
    error.clear();
    check(policy.resolve_existing_file((root / "escape.dat").string(), resolved, error) ==
                  AllowedPathResult::OUTSIDE_ROOT,
          "symlink escape should be rejected");
    fs::create_directory_symlink(outside, root / "escape-dir");
    error.clear();
    check(policy.resolve_output_file((root / "escape-dir" / "result.dat").string(), resolved, error) ==
                  AllowedPathResult::OUTSIDE_ROOT,
          "output through escaping symlink should be rejected");
#endif

    fs::remove_all(base);
    return failures == 0 ? 0 : 1;
}
