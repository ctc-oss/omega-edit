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

#include "resource_admission.h"

namespace omega_edit::grpc_server {

    ResourceAdmissionLease::ResourceAdmissionLease(ResourceAdmissionLease &&other) noexcept : gate_(other.gate_) {
        other.gate_ = nullptr;
    }

    auto ResourceAdmissionLease::operator=(ResourceAdmissionLease &&other) noexcept -> ResourceAdmissionLease & {
        if (this != &other) {
            release();
            gate_ = other.gate_;
            other.gate_ = nullptr;
        }
        return *this;
    }

    ResourceAdmissionLease::~ResourceAdmissionLease() { release(); }

    void ResourceAdmissionLease::release() {
        if (gate_) { gate_->release(); }
        gate_ = nullptr;
    }

    ResourceAdmissionLease ResourceAdmissionGate::try_acquire() {
        auto current = active_.load(std::memory_order_relaxed);
        while (true) {
            if (limit_ > 0 && current >= limit_) {
                ++rejected_;
                return {};
            }
            if (active_.compare_exchange_weak(current, current + 1, std::memory_order_relaxed)) {
                auto peak = peak_.load(std::memory_order_relaxed);
                while (peak < current + 1 &&
                       !peak_.compare_exchange_weak(peak, current + 1, std::memory_order_relaxed)) {}
                return ResourceAdmissionLease(this);
            }
        }
    }

    void ResourceAdmissionGate::release() { active_.fetch_sub(1, std::memory_order_relaxed); }

}// namespace omega_edit::grpc_server
