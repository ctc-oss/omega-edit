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
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <vector>

namespace omega_edit {
namespace grpc_server {

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
    void push(const T &event) {
        std::lock_guard<std::mutex> lock(mutex_);
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

    bool is_closed() const { return closed_; }

private:
    std::queue<T> queue_;
    std::mutex mutex_;
    std::condition_variable cv_;
    std::atomic<bool> closed_{false};
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
    std::map<std::string, std::shared_ptr<ViewportInfo>> viewports;
    std::shared_ptr<EventQueue<SessionEventData>> event_queue;
    int32_t event_interest;
    std::chrono::steady_clock::time_point last_activity;
};

/// Manages all omega_edit sessions and viewports
class SessionManager {
public:
    SessionManager();
    ~SessionManager();

    // Session lifecycle
    std::string create_session(const std::string &file_path, const std::string &desired_id,
                               const std::string &checkpoint_directory, int64_t &file_size_out,
                               std::string &checkpoint_dir_out);
    bool destroy_session(const std::string &session_id);
    omega_session_t *get_session(const std::string &session_id);
    int64_t session_count() const;

    // Viewport lifecycle
    std::string create_viewport(const std::string &session_id, int64_t offset, int64_t capacity, bool is_floating,
                                const std::string &desired_viewport_id);
    bool destroy_viewport(const std::string &session_id, const std::string &viewport_id);
    omega_viewport_t *get_viewport(const std::string &session_id, const std::string &viewport_id);

    // Event subscription
    std::shared_ptr<EventQueue<SessionEventData>> subscribe_session_events(const std::string &session_id,
                                                                           int32_t interest);
    void unsubscribe_session_events(const std::string &session_id);
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

    // Callbacks
    static void session_event_callback(const omega_session_t *session, omega_session_event_t event, const void *ptr);
    static void viewport_event_callback(const omega_viewport_t *viewport, omega_viewport_event_t event,
                                        const void *ptr);

    mutable std::mutex mutex_;
    std::map<std::string, std::shared_ptr<SessionInfo>> sessions_;
};

} // namespace grpc_server
} // namespace omega_edit

#endif // OMEGA_EDIT_SESSION_MANAGER_H
