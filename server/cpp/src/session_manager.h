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
    size_t session_event_queue_capacity{1024};   ///< 0 = unbounded
    size_t viewport_event_queue_capacity{256};   ///< 0 = unbounded
    int64_t max_change_bytes{64 * 1024 * 1024};  ///< 0 = unbounded
    size_t max_viewports_per_session{256};       ///< 0 = unbounded
};

/// Session event data for streaming
struct SessionEventData {
    std::string session_id;
    int32_t session_event_kind;
    int64_t computed_file_size;
    int64_t change_count;
    int64_t undo_count;
    int64_t serial; // 0 if no change serial
};

/// Viewport event data for streaming
struct ViewportEventData {
    std::string session_id;
    std::string viewport_id;
    int32_t viewport_event_kind;
    int64_t serial; // 0 if no change serial
    int64_t offset;
    int64_t length;
    std::vector<uint8_t> data;
};

/// Thread-safe event queue
template <typename T>
class EventQueue {
public:
    explicit EventQueue(size_t max_size = 0, std::string label = "event queue")
        : max_size_(max_size), label_(std::move(label)) {}

    void push(const T &event) {
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
        queue_.push(event);
        cv_.notify_one();
    }

    bool pop(T &event, std::chrono::milliseconds timeout) {
        std::unique_lock<std::mutex> lock(mutex_);
        if (cv_.wait_for(lock, timeout, [this] { return !queue_.empty() || closed_; })) {
            if (closed_ && queue_.empty()) return false;
            event = queue_.front();
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
    static bool should_log_drops(size_t dropped_count) {
        return dropped_count == 1 || (dropped_count & (dropped_count - 1)) == 0;
    }

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

/// Information about a viewport managed by the session manager
struct ViewportInfo {
    omega_viewport_t *viewport;
    std::string session_id;
    std::string viewport_id;
    std::shared_ptr<EventQueue<ViewportEventData>> event_queue;
    int32_t event_interest;
};

/// Information about a session managed by the session manager
struct SessionInfo {
    omega_session_t *session;
    std::string session_id;
    std::string checkpoint_directory;
    bool owns_checkpoint_directory{false};
    size_t attachment_count{0};
    std::map<std::string, std::shared_ptr<ViewportInfo>> viewports;
    std::mutex session_subscription_mutex;
    std::vector<SessionEventSubscriptionInfo> session_subscriptions;
    std::chrono::steady_clock::time_point last_activity;
};

/// Error codes returned by SessionManager::create_session
enum class SessionCreateError {
    SUCCESS,
    INVALID_ID,    ///< desired_id contains the reserved ':' character
    ALREADY_EXISTS, ///< a session with the given id already exists
    CORE_ERROR,    ///< the underlying omega_edit API failed to create the session
};

/// Error codes returned by SessionManager::create_viewport
enum class ViewportCreateError {
    SUCCESS,
    SESSION_NOT_FOUND,
    INVALID_VIEWPORT_ID,   ///< desired_viewport_id contains the reserved ':' character
    DUPLICATE_VIEWPORT_ID, ///< a viewport with the given id already exists
    TOO_MANY_VIEWPORTS,    ///< the session has reached the configured viewport limit
    CORE_ERROR,            ///< the underlying omega_edit API failed to create the viewport
};

/// Manages all omega_edit sessions and viewports
class SessionManager {
public:
    explicit SessionManager(ResourceLimits limits = {});
    ~SessionManager();

    // Session lifecycle
    std::string create_session(const std::string &file_path, const std::string &desired_id,
                               const std::string &checkpoint_directory, const std::string *initial_data,
                               int64_t &file_size_out,
                               std::string &checkpoint_dir_out,
                               SessionCreateError *error_out = nullptr);
    bool destroy_session(const std::string &session_id);
    omega_session_t *get_session(const std::string &session_id);
    int64_t session_count() const;

    // Viewport lifecycle
    std::string create_viewport(const std::string &session_id, int64_t offset, int64_t capacity, bool is_floating,
                                const std::string &desired_viewport_id,
                                ViewportCreateError *error_out = nullptr);
    bool destroy_viewport(const std::string &session_id, const std::string &viewport_id);
    omega_viewport_t *get_viewport(const std::string &session_id, const std::string &viewport_id);

    // Event subscription
    std::shared_ptr<EventQueue<SessionEventData>> subscribe_session_events(const std::string &session_id,
                                                                           int32_t interest);
    void unsubscribe_session_events(const std::string &session_id);
    void unsubscribe_session_events(const std::string &session_id,
                                    const std::shared_ptr<EventQueue<SessionEventData>> &queue);
    std::shared_ptr<EventQueue<ViewportEventData>> subscribe_viewport_events(const std::string &session_id,
                                                                              const std::string &viewport_id,
                                                                              int32_t interest);
    void unsubscribe_viewport_events(const std::string &session_id, const std::string &viewport_id);

    // Session activity tracking
    void touch_session(const std::string &session_id);
    void touch_sessions(const std::vector<std::string> &session_ids);
    std::vector<std::string> get_idle_session_ids(std::chrono::milliseconds timeout) const;

    // Destroy all sessions (for shutdown)
    void destroy_all();

private:
    static std::string generate_uuid();
    static std::string make_viewport_fqid(const std::string &session_id, const std::string &viewport_id);
    static void cleanup_directory_best_effort(const std::string &directory_path);
    static void cleanup_stale_server_roots_best_effort(const std::string &root_path);
    static bool is_managed_server_root_name(const std::string &name);
    static std::string create_server_root_name();
    std::string create_managed_checkpoint_directory();
    void cleanup_managed_server_root_if_empty();

    // Callbacks
    static void session_event_callback(const omega_session_t *session, omega_session_event_t event, const void *ptr);
    static void viewport_event_callback(const omega_viewport_t *viewport, omega_viewport_event_t event,
                                        const void *ptr);

    mutable std::mutex mutex_;
    ResourceLimits limits_;
    std::map<std::string, std::shared_ptr<SessionInfo>> sessions_;
    std::string managed_server_root_;
};

} // namespace grpc_server
} // namespace omega_edit

#endif // OMEGA_EDIT_SESSION_MANAGER_H
