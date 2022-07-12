/**********************************************************************************************************************
* Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
*                                                                                                                    *
* Licensed under the Apache License, Version 2.0 (the "License");                                                    *
* you may not use this file except in compliance with the License.                                                   *
* You may obtain a copy of the License at                                                                            *
*                                                                                                                    *
*     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
*                                                                                                                    *
* Unless required by applicable law or agreed to in writing, software                                                *
* distributed under the License is distributed on an "AS IS" BASIS,                                                  *
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                                           *
* See the License for the specific language governing permissions and                                                *
* limitations under the License.                                                                                     *
**********************************************************************************************************************/

#include "worker_queue.hpp"
#include <cassert>

namespace omega_edit {

    enum class thread_item_kind_t { EXIT_THREAD = 1, USER_ITEM = 2 };

    struct IWorkerQueue::thread_item_t {
        thread_item_t(thread_item_kind_t thread_item_kind, std::shared_ptr<void> m)
            : thread_item_kind(thread_item_kind), item_ptr(std::move(m)) {}
        const thread_item_kind_t thread_item_kind;
        const std::shared_ptr<void> item_ptr;
    };

    IWorkerQueue::~IWorkerQueue() { exit_thread(); }

    bool IWorkerQueue::create_thread() {
        if (!thread_) { thread_ = std::make_unique<std::thread>(std::thread(&IWorkerQueue::process_, this)); }
        return (bool) thread_;
    }

    std::thread::id IWorkerQueue::thread_id() const {
        assert(thread_ != nullptr);
        return thread_->get_id();
    }

    void IWorkerQueue::exit_thread() {
        if (thread_) {
            const auto thread_item_ptr = std::make_shared<thread_item_t>(thread_item_kind_t::EXIT_THREAD, nullptr);
            {
                std::scoped_lock lock(mutex_);
                queue_.push(thread_item_ptr);
                cv_.notify_one();
            }
            thread_->join();
            thread_ = nullptr;
        }
    }

    void IWorkerQueue::push(std::shared_ptr<void> const &item) {
        create_thread();
        assert(thread_);

        const auto thread_message_ptr = std::make_shared<thread_item_t>(thread_item_kind_t::USER_ITEM, item);

        // Add user data to queue and notify worker thread (Process_)
        std::unique_lock lk(mutex_);
        queue_.push(thread_message_ptr);
        cv_.notify_one();
    }

    void IWorkerQueue::process_() {
        while (true) {
            std::shared_ptr<thread_item_t> thread_item_ptr;
            {
                // Wait for a message to be added to the queue (Push)
                std::unique_lock lk(mutex_);
                cv_.wait(lk, [this] { return !queue_.empty(); });
                if (queue_.empty()) { continue; }
                thread_item_ptr = queue_.front();
                queue_.pop();
            }

            switch (thread_item_ptr->thread_item_kind) {
                case thread_item_kind_t::USER_ITEM:
                    assert(thread_item_ptr->item_ptr);
                    handle_item(thread_item_ptr->item_ptr);
                    break;
                case thread_item_kind_t::EXIT_THREAD:
                    return;
                default:
                    assert(0);
            }
        }
    }

    bool IWorkerQueue::empty() const { return queue_.empty(); }

}// namespace omega_edit