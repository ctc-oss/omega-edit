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

#ifndef OMEGA_EDIT_WORKER_QUEUE_HPP
#define OMEGA_EDIT_WORKER_QUEUE_HPP

#include <condition_variable>
#include <memory>
#include <mutex>
#include <queue>
#include <thread>

namespace omega_edit {

    class IWorkerQueue {
    public:
        /**
         * Users are expected subclass IWorkerQueue and implement this method
         * @param msg message to handle
         */
        virtual void handle_item(std::shared_ptr<void> item) = 0;

        // No copy constructor
        IWorkerQueue(const IWorkerQueue &) = delete;

        // No assignment operator
        IWorkerQueue &operator=(const IWorkerQueue &) = delete;

        /**
         * Constructor
         */
        IWorkerQueue() = default;

        /**
         * Destructor
         */
        virtual ~IWorkerQueue();

        /**
         * Called once to create the worker thread
         * @return True if thread is created and false otherwise.
         */
        bool create_thread();

        /**
         * Called once a program exit to exit the worker thread
         */
        void exit_thread();

        /**
         * Get the ID of this thread instance
         * @return ID of this thread instance
         */
        std::thread::id thread_id() const;

        /**
         * Push an item on to the queue
         * @param item to push on to the queue
         */
        void push(std::shared_ptr<void> item);

    private:
        /**
         * Entry point for the worker thread
         */
        void process_();

        struct thread_item_t;

        std::unique_ptr<std::thread> thread_ = nullptr;
        std::queue<std::shared_ptr<thread_item_t>> queue_{};
        std::mutex mutex_{};
        std::condition_variable cv_{};
    };

}// namespace omega_edit

#endif// OMEGA_EDIT_WORKER_QUEUE_HPP
