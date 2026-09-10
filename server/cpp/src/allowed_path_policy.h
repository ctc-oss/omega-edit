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
#include <string>

namespace omega_edit::grpc_server {

    enum class AllowedPathResult {
        OK,
        INVALID_PATH,
        NOT_FOUND,
        OUTSIDE_ROOT,
        FILESYSTEM_ERROR,
    };

    class AllowedPathPolicy {
    public:
        bool configure(const std::string &root, std::string &error);
        [[nodiscard]] bool enabled() const noexcept { return enabled_; }
        [[nodiscard]] const std::filesystem::path &root() const noexcept { return root_; }

        AllowedPathResult resolve_existing_file(const std::string &path, std::string &resolved,
                                                std::string &error) const;
        AllowedPathResult resolve_directory(const std::string &path, std::string &resolved, std::string &error) const;
        AllowedPathResult resolve_output_file(const std::string &path, std::string &resolved, std::string &error) const;

    private:
        AllowedPathResult resolve_creatable_path(const std::string &path, bool directory, std::string &resolved,
                                                 std::string &error) const;
        [[nodiscard]] bool contains(const std::filesystem::path &path) const;

        std::filesystem::path root_;
        bool enabled_{false};
    };

}// namespace omega_edit::grpc_server

#endif// OMEGA_EDIT_ALLOWED_PATH_POLICY_H
