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

#ifndef OMEGA_EDIT_RESOURCE_ADMISSION_H
#define OMEGA_EDIT_RESOURCE_ADMISSION_H

#include <atomic>
#include <cstddef>

namespace omega_edit::grpc_server {

    class ResourceAdmissionGate;

    class ResourceAdmissionLease {
    public:
        ResourceAdmissionLease() = default;
        ResourceAdmissionLease(const ResourceAdmissionLease &) = delete;
        auto operator=(const ResourceAdmissionLease &) -> ResourceAdmissionLease & = delete;
        ResourceAdmissionLease(ResourceAdmissionLease &&other) noexcept;
        auto operator=(ResourceAdmissionLease &&other) noexcept -> ResourceAdmissionLease &;
        ~ResourceAdmissionLease();

        explicit operator bool() const noexcept { return gate_ != nullptr; }

    private:
        friend class ResourceAdmissionGate;
        explicit ResourceAdmissionLease(ResourceAdmissionGate *gate) : gate_(gate) {}
        void release();
        ResourceAdmissionGate *gate_{};
    };

    class ResourceAdmissionGate {
    public:
        explicit ResourceAdmissionGate(size_t limit = 0) : limit_(limit) {}

        ResourceAdmissionLease try_acquire();
        [[nodiscard]] size_t active() const { return active_.load(std::memory_order_relaxed); }
        [[nodiscard]] size_t peak() const { return peak_.load(std::memory_order_relaxed); }
        [[nodiscard]] int64_t rejected() const { return rejected_.load(std::memory_order_relaxed); }

    private:
        friend class ResourceAdmissionLease;
        void release();

        size_t limit_{};
        std::atomic<size_t> active_{0};
        std::atomic<size_t> peak_{0};
        std::atomic<int64_t> rejected_{0};
    };

}// namespace omega_edit::grpc_server

#endif// OMEGA_EDIT_RESOURCE_ADMISSION_H
