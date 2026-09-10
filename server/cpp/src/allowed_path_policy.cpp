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
#include <cerrno>
#include <system_error>
#include <vector>

#ifndef _WIN32
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;

namespace omega_edit::grpc_server {
    namespace {
        bool lexical_path_is_safe(const std::string &value, bool reject_parent_traversal = true) {
            if (value.empty() || value.size() >= FILENAME_MAX) { return false; }
            if (std::any_of(value.begin(), value.end(),
                            [](unsigned char ch) { return ch == '\0' || ch < 0x20U || ch == 0x7FU; })) {
                return false;
            }
            if (!reject_parent_traversal) { return true; }
            const fs::path path(value);
            return std::none_of(path.begin(), path.end(), [](const fs::path &component) { return component == ".."; });
        }

        AllowedPathResult filesystem_failure(const std::error_code &ec, const std::string &operation,
                                             std::string &error) {
            error = operation + ": " + ec.message();
            return AllowedPathResult::FILESYSTEM_ERROR;
        }

#ifndef _WIN32
        int duplicate_fd(int fd) { return fcntl(fd, F_DUPFD_CLOEXEC, 0); }
#endif
    }// namespace

    AllowedPathLease::AllowedPathLease(AllowedPathLease &&other) noexcept
        : object_fd_(other.object_fd_), parent_fd_(other.parent_fd_), leaf_name_(std::move(other.leaf_name_)),
          display_path_(std::move(other.display_path_)) {
        other.object_fd_ = -1;
        other.parent_fd_ = -1;
    }

    auto AllowedPathLease::operator=(AllowedPathLease &&other) noexcept -> AllowedPathLease & {
        if (this != &other) {
            close_fds();
            object_fd_ = other.object_fd_;
            parent_fd_ = other.parent_fd_;
            leaf_name_ = std::move(other.leaf_name_);
            display_path_ = std::move(other.display_path_);
            other.object_fd_ = -1;
            other.parent_fd_ = -1;
        }
        return *this;
    }

    AllowedPathLease::~AllowedPathLease() { close_fds(); }

    void AllowedPathLease::close_fds() {
#ifndef _WIN32
        if (object_fd_ >= 0) { close(object_fd_); }
        if (parent_fd_ >= 0) { close(parent_fd_); }
#endif
        object_fd_ = -1;
        parent_fd_ = -1;
    }

    std::string AllowedPathLease::core_path() const {
#ifdef __linux__
        if (object_fd_ >= 0) { return "/proc/self/fd/" + std::to_string(object_fd_); }
#endif
        return target_path();
    }

    std::string AllowedPathLease::target_path() const {
#ifdef __linux__
        if (parent_fd_ >= 0 && !leaf_name_.empty()) {
            return "/proc/self/fd/" + std::to_string(parent_fd_) + "/" + leaf_name_;
        }
#endif
        return display_path_;
    }

    bool AllowedPathLease::target_matches_object() const {
#ifndef _WIN32
        if (object_fd_ < 0 || parent_fd_ < 0 || leaf_name_.empty()) { return false; }
        struct stat object_status {};
        struct stat target_status {};
        return fstat(object_fd_, &object_status) == 0 &&
               fstatat(parent_fd_, leaf_name_.c_str(), &target_status, AT_SYMLINK_NOFOLLOW) == 0 &&
               !S_ISLNK(target_status.st_mode) && object_status.st_dev == target_status.st_dev &&
               object_status.st_ino == target_status.st_ino;
#else
        return false;
#endif
    }

    AllowedPathPolicy::~AllowedPathPolicy() {
#ifndef _WIN32
        if (root_fd_ >= 0) { close(root_fd_); }
#endif
    }

    bool AllowedPathPolicy::configure(const std::string &root, std::string &error) {
#ifndef _WIN32
        if (root_fd_ >= 0) {
            close(root_fd_);
            root_fd_ = -1;
        }
#endif
        if (root.empty()) {
            root_.clear();
            enabled_ = false;
            return true;
        }
#ifdef _WIN32
        error = "allowed-root confinement is not supported on Windows";
        return false;
#else
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
        root_fd_ = open(canonical_root.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
        if (root_fd_ < 0) {
            error = "could not open allowed root: " + std::error_code(errno, std::generic_category()).message();
            return false;
        }
        root_ = canonical_root.lexically_normal();
        enabled_ = true;
        return true;
#endif
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

    AllowedPathResult AllowedPathPolicy::relative_components(const std::string &path,
                                                             std::vector<std::string> &components,
                                                             std::string &display_path, std::string &error) const {
        if (!lexical_path_is_safe(path)) {
            error = "path is invalid or contains a parent traversal component";
            return AllowedPathResult::INVALID_PATH;
        }
        std::error_code ec;
        const auto absolute = fs::absolute(fs::path(path), ec).lexically_normal();
        if (ec) { return filesystem_failure(ec, "could not make path absolute", error); }
        if (enabled_ && !contains(absolute)) {
            error = "path is outside the configured allowed root";
            return AllowedPathResult::OUTSIDE_ROOT;
        }
        const auto relative = enabled_ ? absolute.lexically_relative(root_) : absolute.relative_path();
        for (const auto &component : relative) {
            if (component.empty() || component == ".") { continue; }
            if (component == ".." || component.has_root_path()) {
                error = "path escapes the configured allowed root";
                return AllowedPathResult::OUTSIDE_ROOT;
            }
            components.push_back(component.string());
        }
        if (components.empty()) {
            error = "path must identify an entry beneath the allowed root";
            return AllowedPathResult::INVALID_PATH;
        }
        display_path = absolute.string();
        return AllowedPathResult::OK;
    }

    AllowedPathResult AllowedPathPolicy::lease_parent(const std::vector<std::string> &components, bool create_missing,
                                                      int &parent_fd, std::string &leaf_name,
                                                      std::string &error) const {
#ifdef _WIN32
        (void) components;
        (void) create_missing;
        (void) parent_fd;
        (void) leaf_name;
        error = "descriptor-relative confinement is unavailable on Windows";
        return AllowedPathResult::FILESYSTEM_ERROR;
#else
        int current_fd = enabled_ ? duplicate_fd(root_fd_) : open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
        if (current_fd < 0) {
            error = "could not duplicate allowed root descriptor";
            return AllowedPathResult::FILESYSTEM_ERROR;
        }
        for (size_t i = 0; i + 1 < components.size(); ++i) {
            auto next_fd = openat(current_fd, components[i].c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
            if (next_fd < 0 && create_missing && errno == ENOENT) {
                if (mkdirat(current_fd, components[i].c_str(), 0777) != 0 && errno != EEXIST) {
                    error = "could not create path component: " +
                            std::error_code(errno, std::generic_category()).message();
                    close(current_fd);
                    return AllowedPathResult::FILESYSTEM_ERROR;
                }
                next_fd = openat(current_fd, components[i].c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
            }
            if (next_fd < 0) {
                const auto saved_errno = errno;
                close(current_fd);
                error = "could not securely open path component: " +
                        std::error_code(saved_errno, std::generic_category()).message();
                return saved_errno == ENOENT ? AllowedPathResult::NOT_FOUND : AllowedPathResult::OUTSIDE_ROOT;
            }
            close(current_fd);
            current_fd = next_fd;
        }
        parent_fd = current_fd;
        leaf_name = components.back();
        return AllowedPathResult::OK;
#endif
    }

    AllowedPathResult AllowedPathPolicy::lease_existing_file(const std::string &path,
                                                             std::shared_ptr<AllowedPathLease> &lease,
                                                             std::string &error) const {
        if (!enabled_) {
            std::string resolved;
            const auto result = resolve_existing_file(path, resolved, error);
            if (result == AllowedPathResult::OK) {
                lease = std::make_shared<AllowedPathLease>();
                lease->display_path_ = resolved;
            }
            return result;
        }
#ifndef _WIN32
        std::vector<std::string> components;
        std::string display_path;
        auto result = relative_components(path, components, display_path, error);
        if (result != AllowedPathResult::OK) { return result; }
        int parent_fd = -1;
        std::string leaf;
        result = lease_parent(components, false, parent_fd, leaf, error);
        if (result != AllowedPathResult::OK) { return result; }
        const auto object_fd = openat(parent_fd, leaf.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
        if (object_fd < 0) {
            const auto saved_errno = errno;
            close(parent_fd);
            error = "could not securely open file: " + std::error_code(saved_errno, std::generic_category()).message();
            return saved_errno == ENOENT ? AllowedPathResult::NOT_FOUND : AllowedPathResult::OUTSIDE_ROOT;
        }
        struct stat status {};
        if (fstat(object_fd, &status) != 0 || !S_ISREG(status.st_mode)) {
            close(object_fd);
            close(parent_fd);
            error = "path must identify a regular file";
            return AllowedPathResult::INVALID_PATH;
        }
        lease = std::make_shared<AllowedPathLease>();
        lease->object_fd_ = object_fd;
        lease->parent_fd_ = parent_fd;
        lease->leaf_name_ = std::move(leaf);
        lease->display_path_ = std::move(display_path);
        return AllowedPathResult::OK;
#else
        return AllowedPathResult::FILESYSTEM_ERROR;
#endif
    }

    AllowedPathResult AllowedPathPolicy::lease_directory(const std::string &path,
                                                         std::shared_ptr<AllowedPathLease> &lease,
                                                         std::string &error) const {
        if (!enabled_) {
            std::string resolved;
            const auto result = resolve_directory(path, resolved, error);
            if (result == AllowedPathResult::OK) {
                lease = std::make_shared<AllowedPathLease>();
                lease->display_path_ = resolved;
            }
            return result;
        }
#ifndef _WIN32
        std::vector<std::string> components;
        std::string display_path;
        auto result = relative_components(path, components, display_path, error);
        if (result != AllowedPathResult::OK) { return result; }
        int parent_fd = -1;
        std::string leaf;
        result = lease_parent(components, true, parent_fd, leaf, error);
        if (result != AllowedPathResult::OK) { return result; }
        auto object_fd = openat(parent_fd, leaf.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
        if (object_fd < 0 && errno == ENOENT) {
            if (mkdirat(parent_fd, leaf.c_str(), 0777) == 0 || errno == EEXIST) {
                object_fd = openat(parent_fd, leaf.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
            }
        }
        if (object_fd < 0) {
            const auto saved_errno = errno;
            close(parent_fd);
            error = "could not securely open directory: " +
                    std::error_code(saved_errno, std::generic_category()).message();
            return AllowedPathResult::OUTSIDE_ROOT;
        }
        lease = std::make_shared<AllowedPathLease>();
        lease->object_fd_ = object_fd;
        lease->parent_fd_ = parent_fd;
        lease->leaf_name_ = std::move(leaf);
        lease->display_path_ = std::move(display_path);
        return AllowedPathResult::OK;
#else
        return AllowedPathResult::FILESYSTEM_ERROR;
#endif
    }

    AllowedPathResult AllowedPathPolicy::lease_output_file(const std::string &path,
                                                           std::shared_ptr<AllowedPathLease> &lease,
                                                           std::string &error) const {
        if (!enabled_) {
            std::string resolved;
            const auto result = resolve_output_file(path, resolved, error);
            if (result == AllowedPathResult::OK) {
                lease = std::make_shared<AllowedPathLease>();
                lease->display_path_ = resolved;
            }
            return result;
        }
#ifndef _WIN32
        std::vector<std::string> components;
        std::string display_path;
        auto result = relative_components(path, components, display_path, error);
        if (result != AllowedPathResult::OK) { return result; }
        int parent_fd = -1;
        std::string leaf;
        result = lease_parent(components, true, parent_fd, leaf, error);
        if (result != AllowedPathResult::OK) { return result; }
        struct stat status {};
        errno = 0;
        const auto stat_result = fstatat(parent_fd, leaf.c_str(), &status, AT_SYMLINK_NOFOLLOW);
        if (stat_result == 0 && S_ISLNK(status.st_mode)) {
            close(parent_fd);
            error = "output path must not be a symbolic link";
            return AllowedPathResult::OUTSIDE_ROOT;
        }
        if (stat_result != 0 && errno != ENOENT) {
            const auto saved_errno = errno;
            close(parent_fd);
            error = "could not inspect output path: " + std::error_code(saved_errno, std::generic_category()).message();
            return AllowedPathResult::FILESYSTEM_ERROR;
        }
        lease = std::make_shared<AllowedPathLease>();
        lease->parent_fd_ = parent_fd;
        lease->leaf_name_ = std::move(leaf);
        lease->display_path_ = std::move(display_path);
        return AllowedPathResult::OK;
#else
        return AllowedPathResult::FILESYSTEM_ERROR;
#endif
    }

    AllowedPathResult AllowedPathPolicy::resolve_existing_file(const std::string &path, std::string &resolved,
                                                               std::string &error) const {
        if (enabled_) {
            std::shared_ptr<AllowedPathLease> lease;
            const auto result = lease_existing_file(path, lease, error);
            if (result == AllowedPathResult::OK) { resolved = lease->display_path(); }
            return result;
        }
        if (!lexical_path_is_safe(path, enabled_)) {
            error = "path is invalid or contains a parent traversal component";
            return AllowedPathResult::INVALID_PATH;
        }
        std::error_code ec;
        const auto canonical_path = fs::canonical(fs::absolute(fs::path(path), ec), ec);
        if (ec == std::errc::no_such_file_or_directory) {
            error = "file does not exist";
            return AllowedPathResult::NOT_FOUND;
        }
        if (ec) { return filesystem_failure(ec, "could not resolve path", error); }
        if (!fs::is_regular_file(canonical_path, ec) || ec) {
            error = "path must identify a regular file";
            return AllowedPathResult::INVALID_PATH;
        }
        resolved = canonical_path.string();
        return AllowedPathResult::OK;
    }

    AllowedPathResult AllowedPathPolicy::resolve_directory(const std::string &path, std::string &resolved,
                                                           std::string &error) const {
        if (enabled_) {
            std::shared_ptr<AllowedPathLease> lease;
            const auto result = lease_directory(path, lease, error);
            if (result == AllowedPathResult::OK) { resolved = lease->display_path(); }
            return result;
        }
        return resolve_creatable_path(path, true, resolved, error);
    }

    AllowedPathResult AllowedPathPolicy::resolve_output_file(const std::string &path, std::string &resolved,
                                                             std::string &error) const {
        if (enabled_) {
            std::shared_ptr<AllowedPathLease> lease;
            const auto result = lease_output_file(path, lease, error);
            if (result == AllowedPathResult::OK) { resolved = lease->display_path(); }
            return result;
        }
        return resolve_creatable_path(path, false, resolved, error);
    }

    AllowedPathResult AllowedPathPolicy::resolve_creatable_path(const std::string &path, bool directory,
                                                                std::string &resolved, std::string &error) const {
        if (!lexical_path_is_safe(path, enabled_)) {
            error = "path is invalid or contains a parent traversal component";
            return AllowedPathResult::INVALID_PATH;
        }
        std::error_code ec;
        auto absolute_path = fs::absolute(fs::path(path), ec).lexically_normal();
        if (ec) { return filesystem_failure(ec, "could not make path absolute", error); }
        if (directory && fs::exists(absolute_path, ec) && !fs::is_directory(absolute_path, ec)) {
            error = "path must identify a directory";
            return AllowedPathResult::INVALID_PATH;
        }
        if (ec) { return filesystem_failure(ec, "could not resolve path", error); }
        resolved = absolute_path.string();
        return AllowedPathResult::OK;
    }

}// namespace omega_edit::grpc_server
