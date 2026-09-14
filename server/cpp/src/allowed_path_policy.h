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

#ifndef OMEGA_EDIT_ALLOWED_PATH_POLICY_H
#define OMEGA_EDIT_ALLOWED_PATH_POLICY_H

#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace omega_edit::grpc_server {

    enum class AllowedPathResult {
        OK,
        INVALID_PATH,
        NOT_FOUND,
        OUTSIDE_ROOT,
        FILESYSTEM_ERROR,
    };

    class AllowedPathLease {
    public:
        AllowedPathLease() = default;
        AllowedPathLease(const AllowedPathLease &) = delete;
        auto operator=(const AllowedPathLease &) -> AllowedPathLease & = delete;
        AllowedPathLease(AllowedPathLease &&other) noexcept;
        auto operator=(AllowedPathLease &&other) noexcept -> AllowedPathLease &;
        ~AllowedPathLease();

        [[nodiscard]] int object_fd() const noexcept { return object_fd_; }
        [[nodiscard]] int parent_fd() const noexcept { return parent_fd_; }
        [[nodiscard]] const std::string &leaf_name() const noexcept { return leaf_name_; }
        [[nodiscard]] const std::string &display_path() const noexcept { return display_path_; }
        [[nodiscard]] std::string core_path() const;
        [[nodiscard]] std::string target_path() const;
        [[nodiscard]] bool target_matches_object() const;

    private:
        friend class AllowedPathPolicy;
        void close_fds();

        int object_fd_{-1};
        int parent_fd_{-1};
        std::string leaf_name_;
        std::string display_path_;
    };

    class AllowedPathPolicy {
    public:
        AllowedPathPolicy() = default;
        AllowedPathPolicy(const AllowedPathPolicy &) = delete;
        auto operator=(const AllowedPathPolicy &) -> AllowedPathPolicy & = delete;
        ~AllowedPathPolicy();

        bool configure(const std::string &root, std::string &error);
        [[nodiscard]] bool enabled() const noexcept { return enabled_; }
        [[nodiscard]] const std::filesystem::path &root() const noexcept { return root_; }

        AllowedPathResult resolve_existing_file(const std::string &path, std::string &resolved,
                                                std::string &error) const;
        AllowedPathResult resolve_directory(const std::string &path, std::string &resolved, std::string &error) const;
        AllowedPathResult resolve_output_file(const std::string &path, std::string &resolved, std::string &error) const;

        AllowedPathResult lease_existing_file(const std::string &path, std::shared_ptr<AllowedPathLease> &lease,
                                              std::string &error) const;
        AllowedPathResult lease_directory(const std::string &path, std::shared_ptr<AllowedPathLease> &lease,
                                          std::string &error) const;
        AllowedPathResult lease_output_file(const std::string &path, std::shared_ptr<AllowedPathLease> &lease,
                                            std::string &error) const;

    private:
        AllowedPathResult resolve_creatable_path(const std::string &path, bool directory, std::string &resolved,
                                                 std::string &error) const;
        AllowedPathResult relative_components(const std::string &path, std::vector<std::string> &components,
                                              std::string &display_path, std::string &error) const;
        AllowedPathResult lease_parent(const std::vector<std::string> &components, bool create_missing, int &parent_fd,
                                       std::string &leaf_name, std::string &error) const;
        [[nodiscard]] bool contains(const std::filesystem::path &path) const;

        std::filesystem::path root_;
        int root_fd_{-1};
        bool enabled_{false};
    };

}// namespace omega_edit::grpc_server

#endif// OMEGA_EDIT_ALLOWED_PATH_POLICY_H
