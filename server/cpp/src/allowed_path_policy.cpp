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

#include <algorithm>
#include <system_error>
#include <vector>

namespace fs = std::filesystem;

namespace omega_edit::grpc_server {
    namespace {
        bool lexical_path_is_safe(const std::string &value) {
            if (value.empty() || value.size() >= FILENAME_MAX) { return false; }
            if (std::any_of(value.begin(), value.end(),
                            [](unsigned char ch) { return ch == '\0' || ch < 0x20U || ch == 0x7FU; })) {
                return false;
            }
            const fs::path path(value);
            return std::none_of(path.begin(), path.end(), [](const fs::path &component) { return component == ".."; });
        }

        AllowedPathResult filesystem_failure(const std::error_code &ec, const std::string &operation,
                                             std::string &error) {
            error = operation + ": " + ec.message();
            return AllowedPathResult::FILESYSTEM_ERROR;
        }
    }// namespace

    bool AllowedPathPolicy::configure(const std::string &root, std::string &error) {
        if (root.empty()) {
            root_.clear();
            enabled_ = false;
            return true;
        }
        if (!lexical_path_is_safe(root)) {
            error = "allowed root is invalid";
            return false;
        }
        std::error_code ec;
        const auto absolute_root = fs::absolute(fs::path(root), ec);
        if (ec) {
            error = "could not make allowed root absolute: " + ec.message();
            return false;
        }
        const auto canonical_root = fs::canonical(absolute_root, ec);
        if (ec) {
            error = "could not resolve allowed root: " + ec.message();
            return false;
        }
        if (!fs::is_directory(canonical_root, ec) || ec) {
            error = "allowed root must be an existing directory";
            return false;
        }
        root_ = canonical_root.lexically_normal();
        enabled_ = true;
        return true;
    }

    bool AllowedPathPolicy::contains(const fs::path &path) const {
        if (!enabled_) { return true; }
        const auto normalized = path.lexically_normal();
        auto root_it = root_.begin();
        auto path_it = normalized.begin();
        for (; root_it != root_.end(); ++root_it, ++path_it) {
            if (path_it == normalized.end() || *root_it != *path_it) { return false; }
        }
        return true;
    }

    AllowedPathResult AllowedPathPolicy::resolve_existing_file(const std::string &path, std::string &resolved,
                                                               std::string &error) const {
        if (!lexical_path_is_safe(path)) {
            error = "path is invalid or contains a parent traversal component";
            return AllowedPathResult::INVALID_PATH;
        }
        std::error_code ec;
        const auto canonical_path = fs::canonical(fs::absolute(fs::path(path), ec), ec);
        if (ec == std::errc::no_such_file_or_directory) {
            error = "path does not exist";
            return AllowedPathResult::NOT_FOUND;
        }
        if (ec) { return filesystem_failure(ec, "could not resolve path", error); }
        if (!fs::is_regular_file(canonical_path, ec) || ec) {
            error = "path must identify a regular file";
            return AllowedPathResult::INVALID_PATH;
        }
        if (enabled_ && !contains(canonical_path)) {
            error = "path is outside the configured allowed root";
            return AllowedPathResult::OUTSIDE_ROOT;
        }
        resolved = canonical_path.string();
        return AllowedPathResult::OK;
    }

    AllowedPathResult AllowedPathPolicy::resolve_directory(const std::string &path, std::string &resolved,
                                                           std::string &error) const {
        return resolve_creatable_path(path, true, resolved, error);
    }

    AllowedPathResult AllowedPathPolicy::resolve_output_file(const std::string &path, std::string &resolved,
                                                             std::string &error) const {
        return resolve_creatable_path(path, false, resolved, error);
    }

    AllowedPathResult AllowedPathPolicy::resolve_creatable_path(const std::string &path, bool directory,
                                                                std::string &resolved, std::string &error) const {
        if (!lexical_path_is_safe(path)) {
            error = "path is invalid or contains a parent traversal component";
            return AllowedPathResult::INVALID_PATH;
        }

        std::error_code ec;
        auto absolute_path = fs::absolute(fs::path(path), ec).lexically_normal();
        if (ec) { return filesystem_failure(ec, "could not make path absolute", error); }

        const auto status = fs::symlink_status(absolute_path, ec);
        if (ec && ec != std::errc::no_such_file_or_directory) {
            return filesystem_failure(ec, "could not inspect path", error);
        }
        const auto target_exists = !ec && fs::exists(status);
        if (!ec && fs::is_symlink(status)) {
            error = "path must not be a symbolic link";
            return AllowedPathResult::OUTSIDE_ROOT;
        }
        ec.clear();

        std::vector<fs::path> missing_components;
        auto ancestor = absolute_path;
        if (!target_exists) { missing_components.push_back(ancestor.filename()); }
        if (!target_exists) { ancestor = ancestor.parent_path(); }
        while (!fs::exists(ancestor, ec)) {
            if (ec) { return filesystem_failure(ec, "could not inspect path ancestor", error); }
            missing_components.push_back(ancestor.filename());
            const auto parent = ancestor.parent_path();
            if (parent == ancestor || parent.empty()) {
                error = "path has no existing ancestor";
                return AllowedPathResult::INVALID_PATH;
            }
            ancestor = parent;
        }
        const auto canonical_ancestor = fs::canonical(ancestor, ec);
        if (ec) { return filesystem_failure(ec, "could not resolve path ancestor", error); }
        if (enabled_ && !contains(canonical_ancestor)) {
            error = "path is outside the configured allowed root";
            return AllowedPathResult::OUTSIDE_ROOT;
        }

        auto resolved_path = canonical_ancestor;
        for (auto it = missing_components.rbegin(); it != missing_components.rend(); ++it) { resolved_path /= *it; }
        if (enabled_ && !contains(resolved_path)) {
            error = "path is outside the configured allowed root";
            return AllowedPathResult::OUTSIDE_ROOT;
        }

        if (missing_components.empty()) {
            if (directory) {
                if (!fs::is_directory(canonical_ancestor, ec) || ec) {
                    error = "path must identify a directory";
                    return AllowedPathResult::INVALID_PATH;
                }
            } else if (fs::is_directory(canonical_ancestor, ec) || ec) {
                error = "output path must not identify a directory";
                return AllowedPathResult::INVALID_PATH;
            }
        } else if (!fs::is_directory(canonical_ancestor, ec) || ec) {
            error = "nearest existing path ancestor must be a directory";
            return AllowedPathResult::INVALID_PATH;
        }

        resolved = resolved_path.string();
        return AllowedPathResult::OK;
    }

}// namespace omega_edit::grpc_server
