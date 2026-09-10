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

    AllowedPathPolicy unrestricted_policy;
    std::string unrestricted_error;
    std::string unrestricted_path;
    const auto parent_path = root / "nested" / ".." / "inside.dat";
    check(unrestricted_policy.resolve_existing_file(parent_path.string(), unrestricted_path, unrestricted_error) ==
                  AllowedPathResult::OK,
          "unrestricted file paths may contain parent components");
    check(fs::path(unrestricted_path) == fs::canonical(root / "inside.dat"),
          "unrestricted file paths should resolve to the canonical file");
    check(unrestricted_policy.resolve_output_file((root / "nested" / ".." / "result.dat").string(), unrestricted_path,
                                                  unrestricted_error) == AllowedPathResult::OK,
          "unrestricted output paths may contain parent components");
    check(unrestricted_policy.resolve_directory((root / "nested" / "..").string(), unrestricted_path,
                                                unrestricted_error) == AllowedPathResult::OK,
          "unrestricted directory paths may contain parent components");
    check(unrestricted_policy.resolve_directory((root / "unused-checkpoint").string(), unrestricted_path,
                                                unrestricted_error) == AllowedPathResult::OK,
          "unrestricted checkpoint directories should resolve before creation");
    check(!fs::exists(root / "unused-checkpoint"), "resolving a checkpoint directory must not create it");

    AllowedPathPolicy policy;
    std::string error;
    check(policy.configure("", error), "an empty allowed root should configure on every platform");
    check(!policy.enabled(), "an empty allowed root should leave confinement disabled");
#ifdef _WIN32
    check(!policy.configure(root.string(), error), "allowed root must fail configuration on Windows");
    check(error == "allowed-root confinement is not supported on Windows",
          "unsupported confinement should report a clear configuration error");
    check(!policy.enabled(), "unsupported confinement must not become enabled");
    check(policy.configure("", error), "unrestricted configuration should still succeed after a rejected root");
#else
    check(policy.configure(root.string(), error), "allowed root should configure");

    std::string resolved;
    check(policy.resolve_existing_file(parent_path.string(), resolved, error) == AllowedPathResult::INVALID_PATH,
          "confined file paths must reject parent components");
    check(policy.resolve_output_file(parent_path.string(), resolved, error) == AllowedPathResult::INVALID_PATH,
          "confined output paths must reject parent components");
    check(policy.resolve_directory((root / "nested" / "..").string(), resolved, error) ==
                  AllowedPathResult::INVALID_PATH,
          "confined directory paths must reject parent components");
    std::shared_ptr<omega_edit::grpc_server::AllowedPathLease> lease;
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
    check(policy.lease_output_file((root / "nested" / "leased.dat").string(), lease, error) == AllowedPathResult::OK,
          "output lease should succeed");
    const auto original_nested = root / "nested-original";
    fs::rename(root / "nested", original_nested);
    fs::create_directory_symlink(outside, root / "nested");
    std::ofstream(lease->core_path()) << "leased";
    check(fs::exists(original_nested / "leased.dat"), "leased output should remain in original directory");
    check(!fs::exists(outside / "leased.dat"), "leased output must not escape through replacement symlink");
    fs::remove(root / "nested");
    fs::rename(original_nested, root / "nested");
    error.clear();
    check(policy.resolve_output_file((root / "nested" / ".." / "result.dat").string(), resolved, error) ==
                  AllowedPathResult::INVALID_PATH,
          "parent traversal should be rejected");

    check(policy.lease_existing_file((root / "inside.dat").string(), lease, error) == AllowedPathResult::OK,
          "input lease should succeed");
    fs::rename(root / "inside.dat", root / "inside-original.dat");
    fs::create_symlink(outside / "outside.dat", root / "inside.dat");
    std::ifstream leased_input(lease->core_path());
    std::string leased_contents;
    leased_input >> leased_contents;
    check(leased_contents == "inside", "leased input should retain the originally opened file");

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
