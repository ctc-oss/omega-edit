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

#ifndef OMEGA_EDIT_SESSION_MANAGER_H
#define OMEGA_EDIT_SESSION_MANAGER_H

#include <omega_edit.h>
#include <omega_edit/character_counts.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <utility>
#include <vector>

namespace omega_edit {
    namespace grpc_server {

        /// Configurable service limits to bound server-side resource usage.
        struct ResourceLimits {
            size_t session_event_queue_capacity{1024};                    ///< 0 = unbounded
            size_t viewport_event_queue_capacity{256};                    ///< 0 = unbounded
            int64_t max_change_bytes{64 * 1024 * 1024};                   ///< 0 = unbounded
            size_t max_viewports_per_session{256};                        ///< 0 = unbounded
            int64_t max_read_segment_bytes{OMEGA_VIEWPORT_CAPACITY_LIMIT};///< 0 = unbounded
            int64_t max_search_matches{1000000};                          ///< 0 = unbounded
        };

        struct TransformProgressData {
            std::string plugin_id;
            std::string operation_id;
            int64_t processed_bytes{0};
            int64_t total_bytes{0};
            double percent{0};
            std::string phase;
            std::string message;
            bool has_processed_bytes{false};
            bool has_total_bytes{false};
            bool has_percent{false};
            bool has_serial{false};
            bool indeterminate{false};
            int64_t serial{0};
        };

        /// Session event data for streaming
        struct SessionEventData {
            std::string session_id;
            int32_t session_event_kind;
            int64_t computed_file_size;
            int64_t change_count;
            int64_t undo_count;
            int64_t serial;// 0 if no change serial
            TransformProgressData transform_progress;
            bool has_transform_progress{false};
        };

        /// Viewport event data for streaming
        struct ViewportEventData {
            std::string session_id;
            std::string viewport_id;
            int32_t viewport_event_kind;
            int64_t serial;// 0 if no change serial
            int64_t offset;
            int64_t length;
            std::vector<uint8_t> data;
        };

        /// Thread-safe event queue
        template<typename T>
        class EventQueue {
        public:
            explicit EventQueue(size_t max_size = 0, std::string label = "event queue")
                : max_size_(max_size), label_(std::move(label)) {}

            void push(const T &event) { push_impl(event); }

            void push(T &&event) { push_impl(std::move(event)); }

            bool pop(T &event, std::chrono::milliseconds timeout) {
                std::unique_lock<std::mutex> lock(mutex_);
                if (cv_.wait_for(lock, timeout, [this] { return !queue_.empty() || closed_; })) {
                    if (closed_ && queue_.empty()) return false;
                    event = std::move(queue_.front());
                    queue_.pop();
                    return true;
                }
                return false;
            }

            void close() {
                std::lock_guard<std::mutex> lock(mutex_);
                closed_ = true;
                cv_.notify_all();
            }

            void clear() {
                std::lock_guard<std::mutex> lock(mutex_);
                std::queue<T> empty;
                queue_.swap(empty);
                dropped_count_.store(0, std::memory_order_relaxed);
            }

            bool is_closed() const { return closed_; }
            size_t dropped_count() const { return dropped_count_.load(std::memory_order_relaxed); }

        private:
            template<typename U>
            void push_impl(U &&event) {
                {
                    std::lock_guard<std::mutex> lock(mutex_);
                    if (closed_) { return; }
                    if (max_size_ > 0 && queue_.size() >= max_size_) {
                        queue_.pop();
                        const size_t dropped = ++dropped_count_;
                        if (should_log_drops(dropped)) {
                            std::cerr << "Warning: dropped " << dropped << " buffered event(s) from " << label_
                                      << " because the queue reached its capacity of " << max_size_ << std::endl;
                        }
                    }
                    queue_.push(std::forward<U>(event));
                }
                cv_.notify_one();
            }

            static bool should_log_drops(size_t dropped_count) { return (dropped_count & (dropped_count - 1)) == 0; }

            size_t max_size_;
            std::string label_;
            std::queue<T> queue_;
            std::mutex mutex_;
            std::condition_variable cv_;
            std::atomic<size_t> dropped_count_{0};
            std::atomic<bool> closed_{false};
        };

        /// Session event subscription state
        struct SessionEventSubscriptionInfo {
            std::shared_ptr<EventQueue<SessionEventData>> event_queue;
            int32_t interest;
        };

        /// Viewport event subscription state
        struct ViewportEventSubscriptionInfo {
            std::shared_ptr<EventQueue<ViewportEventData>> event_queue;
            int32_t interest;
        };

        /// Information about a viewport managed by the session manager
        struct ViewportInfo {
            omega_viewport_t *viewport{};
            std::string session_id;
            std::string viewport_id;
            std::mutex viewport_subscription_mutex;
            std::vector<ViewportEventSubscriptionInfo> viewport_subscriptions;
        };

        /// Information about a session managed by the session manager
        struct SessionInfo {
            omega_session_t *session{};
            bool initialization_complete{false};
            std::string session_id;
            std::string canonical_file_path;
            std::string checkpoint_directory;
            bool owns_checkpoint_directory{false};
            // Shared sessions begin life with one attached author and are only reaped
            // after the last attachment detaches.
            size_t attachment_count{0};
            std::map<std::string, std::shared_ptr<ViewportInfo>> viewports;
            bool transform_in_progress{false};
            std::shared_ptr<std::atomic_bool> transform_cancel_requested{std::make_shared<std::atomic_bool>(false)};
            size_t active_mutations{0};
            // Serializes all access to the underlying non-thread-safe omega_session_t and its viewports.
            std::mutex core_mutex;
            std::mutex initialization_mutex;
            std::condition_variable initialization_cv;
            std::mutex session_subscription_mutex;
            std::vector<SessionEventSubscriptionInfo> session_subscriptions;
            std::chrono::steady_clock::time_point last_activity;
        };

        struct LockedSession {
            std::shared_ptr<SessionInfo> info;
            std::unique_lock<std::mutex> lock;

            omega_session_t *session() const { return info ? info->session : nullptr; }
            explicit operator bool() const { return session() != nullptr; }
        };

        struct LockedViewport {
            std::shared_ptr<SessionInfo> info;
            std::shared_ptr<ViewportInfo> viewport_info;
            std::unique_lock<std::mutex> lock;

            omega_viewport_t *viewport() const { return viewport_info ? viewport_info->viewport : nullptr; }
            explicit operator bool() const { return viewport() != nullptr; }
        };

        /// Error codes returned by SessionManager::create_session
        enum class SessionCreateError {
            SUCCESS,
            INVALID_ID,                  ///< desired_id is not a bounded caller ID token
            INVALID_FILE_PATH,           ///< file_path is not safe to pass to the core C API
            INVALID_CHECKPOINT_DIRECTORY,///< checkpoint_directory is not safe to pass to the core C API
            ALREADY_EXISTS,              ///< a session with the given id already exists
            CORE_ERROR,                  ///< the underlying omega_edit API failed to create the session
        };

        /// Error codes returned by SessionManager::create_viewport
        enum class ViewportCreateError {
            SUCCESS,
            SESSION_NOT_FOUND,
            INVALID_VIEWPORT_ID,  ///< desired_viewport_id is not a bounded caller ID token
            DUPLICATE_VIEWPORT_ID,///< a viewport with the given id already exists
            TOO_MANY_VIEWPORTS,   ///< the session has reached the configured viewport limit
            CORE_ERROR,           ///< the underlying omega_edit API failed to create the viewport
        };

        enum class SessionOperationStartResult {
            STARTED,
            SESSION_NOT_FOUND,
            TRANSFORM_IN_PROGRESS,
            MUTATION_IN_PROGRESS,
        };

        enum class SessionOperationKind {
            MUTATION,
            TRANSFORM,
        };

        class SessionManager;

        class SessionOperationGuard {
        public:
            SessionOperationGuard() = default;
            SessionOperationGuard(const SessionOperationGuard &) = delete;
            auto operator=(const SessionOperationGuard &) -> SessionOperationGuard & = delete;
            SessionOperationGuard(SessionOperationGuard &&other) noexcept;
            auto operator=(SessionOperationGuard &&other) noexcept -> SessionOperationGuard &;
            ~SessionOperationGuard();

            explicit operator bool() const { return result_ == SessionOperationStartResult::STARTED; }
            SessionOperationStartResult result() const { return result_; }

        private:
            friend class SessionManager;

            SessionOperationGuard(SessionManager *manager, std::string session_id, SessionOperationKind kind,
                                  SessionOperationStartResult result);

            void release();

            SessionManager *manager_{nullptr};
            std::string session_id_;
            SessionOperationKind kind_{SessionOperationKind::MUTATION};
            SessionOperationStartResult result_{SessionOperationStartResult::SESSION_NOT_FOUND};
        };

        /// Manages all omega_edit sessions and viewports
        class SessionManager {
        public:
            explicit SessionManager(ResourceLimits limits = {});
            ~SessionManager();

            // Session lifecycle
            std::string create_session(const std::string &file_path, const std::string &desired_id,
                                       const std::string &checkpoint_directory, const std::string *initial_data,
                                       int64_t &file_size_out, std::string &checkpoint_dir_out,
                                       SessionCreateError *error_out = nullptr);
            bool destroy_session(const std::string &session_id);
            bool detach_session(const std::string &session_id);
            omega_session_t *get_session(const std::string &session_id);
            LockedSession lock_session(const std::string &session_id);
            SessionOperationGuard try_begin_mutation(const std::string &session_id);
            SessionOperationGuard try_begin_transform(const std::string &session_id);
            bool session_transform_in_progress(const std::string &session_id) const;
            bool publish_transform_progress(const std::string &session_id, int32_t event_kind,
                                            const TransformProgressData &progress);
            int64_t session_count() const;

            // Viewport lifecycle
            std::string create_viewport(const std::string &session_id, int64_t offset, int64_t capacity,
                                        bool is_floating, const std::string &desired_viewport_id,
                                        ViewportCreateError *error_out = nullptr);
            bool destroy_viewport(const std::string &session_id, const std::string &viewport_id);
            omega_viewport_t *get_viewport(const std::string &session_id, const std::string &viewport_id);
            LockedViewport lock_viewport(const std::string &session_id, const std::string &viewport_id);

            // Event subscription
            std::shared_ptr<EventQueue<SessionEventData>> subscribe_session_events(const std::string &session_id,
                                                                                   int32_t interest);
            void unsubscribe_session_events(const std::string &session_id);
            void unsubscribe_session_events(const std::string &session_id,
                                            const std::shared_ptr<EventQueue<SessionEventData>> &queue);
            std::shared_ptr<EventQueue<ViewportEventData>>
            subscribe_viewport_events(const std::string &session_id, const std::string &viewport_id, int32_t interest);
            void unsubscribe_viewport_events(const std::string &session_id, const std::string &viewport_id);
            void unsubscribe_viewport_events(const std::string &session_id, const std::string &viewport_id,
                                             const std::shared_ptr<EventQueue<ViewportEventData>> &queue);

            // Session activity tracking
            void touch_session(const std::string &session_id);
            template<typename SessionIdRange>
            void touch_sessions(const SessionIdRange &session_ids) {
                std::lock_guard<std::mutex> lock(mutex_);
                const auto now = std::chrono::steady_clock::now();
                for (const auto &sid : session_ids) {
                    auto it = sessions_.find(sid);
                    if (it != sessions_.end()) { it->second->last_activity = now; }
                }
            }
            std::vector<std::string> get_idle_session_ids(std::chrono::milliseconds timeout) const;

            // Destroy all sessions (for shutdown)
            void destroy_all();

        private:
            friend class SessionOperationGuard;

            static std::string generate_uuid_v4();
            static std::string generate_uuid_v7();
            static std::string generate_prefixed_id(const char *prefix);
            static std::string generate_session_id();
            static std::string generate_viewport_id();
            static std::string generate_subscription_id();
            static std::string make_viewport_fqid(const std::string &session_id, const std::string &viewport_id);
            static void cleanup_directory_best_effort(const std::string &directory_path);
            static void cleanup_stale_server_roots_best_effort(const std::string &root_path);
            static bool is_managed_server_root_name(const std::string &name);
            static std::string create_server_root_name();
            std::string create_managed_checkpoint_directory();
            void cleanup_managed_server_root_if_empty();
            void destroy_session_info(const std::shared_ptr<SessionInfo> &info);
            bool destroy_session_locked(std::unique_lock<std::mutex> &lock,
                                        const std::map<std::string, std::shared_ptr<SessionInfo>>::iterator &it);
            void finish_operation(const std::string &session_id, SessionOperationKind kind);

            // Callbacks
            static void session_event_callback(const omega_session_t *session, omega_session_event_t event,
                                               const void *ptr);
            static void viewport_event_callback(const omega_viewport_t *viewport, omega_viewport_event_t event,
                                                const void *ptr);

            mutable std::mutex mutex_;
            ResourceLimits limits_;
            std::map<std::string, std::shared_ptr<SessionInfo>> sessions_;
            std::map<std::string, std::string> file_sessions_by_path_;
            std::string managed_server_root_;
        };

    }// namespace grpc_server
}// namespace omega_edit

#endif// OMEGA_EDIT_SESSION_MANAGER_H
