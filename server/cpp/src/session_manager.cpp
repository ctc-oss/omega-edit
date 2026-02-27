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

#include "session_manager.h"

#include <omega_edit/edit.h>
#include <omega_edit/search.h>
#include <omega_edit/segment.h>
#include <omega_edit/session.h>
#include <omega_edit/version.h>
#include <omega_edit/viewport.h>

#include <algorithm>
#include <cstring>
#include <random>
#include <sstream>

#ifdef _WIN32
#include <rpc.h>
#pragma comment(lib, "rpcrt4.lib")
#else
#include <uuid/uuid.h>
#endif

namespace omega_edit {
namespace grpc_server {

// ── UUID generation ──────────────────────────────────────────────────────────
std::string SessionManager::generate_uuid() {
#ifdef _WIN32
    UUID uuid;
    UuidCreate(&uuid);
    RPC_CSTR str;
    UuidToStringA(&uuid, &str);
    std::string result(reinterpret_cast<char *>(str));
    RpcStringFreeA(&str);
    return result;
#else
    uuid_t uuid;
    char str[37];
    uuid_generate(uuid);
    uuid_unparse_lower(uuid, str);
    return std::string(str);
#endif
}

std::string SessionManager::make_viewport_fqid(const std::string &session_id, const std::string &viewport_id) {
    return session_id + ":" + viewport_id;
}

// ── Callbacks ────────────────────────────────────────────────────────────────
void SessionManager::session_event_callback(const omega_session_t *session, omega_session_event_t event,
                                            const void *ptr) {
    auto *info = static_cast<SessionInfo *>(const_cast<void *>(omega_session_get_user_data_ptr(session)));
    if (!info || !info->event_queue) return;

    SessionEventData evt;
    evt.session_id = info->session_id;
    evt.session_event_kind = static_cast<int32_t>(event);
    evt.computed_file_size = omega_session_get_computed_file_size(session);
    evt.change_count = omega_session_get_num_changes(session);
    evt.undo_count = omega_session_get_num_undone_changes(session);

    // If the event pointer is a change, get its serial
    if (ptr) {
        auto *change = static_cast<const omega_change_t *>(ptr);
        evt.serial = omega_change_get_serial(change);
    } else {
        evt.serial = 0;
    }

    info->event_queue->push(evt);
}

void SessionManager::viewport_event_callback(const omega_viewport_t *viewport, omega_viewport_event_t event,
                                             const void *ptr) {
    auto *info = static_cast<ViewportInfo *>(const_cast<void *>(omega_viewport_get_user_data_ptr(viewport)));
    if (!info || !info->event_queue) return;

    ViewportEventData evt;
    evt.session_id = info->session_id;
    evt.viewport_id = make_viewport_fqid(info->session_id, info->viewport_id);
    evt.viewport_event_kind = static_cast<int32_t>(event);

    if (ptr) {
        auto *change = static_cast<const omega_change_t *>(ptr);
        evt.serial = omega_change_get_serial(change);
    } else {
        evt.serial = 0;
    }

    evt.offset = omega_viewport_get_offset(viewport);
    auto length = omega_viewport_get_length(viewport);
    evt.length = length;
    const auto *data = omega_viewport_get_data(viewport);
    if (data && length > 0) {
        evt.data.assign(data, data + length);
    }

    info->event_queue->push(evt);
}

// ── Constructor / Destructor ─────────────────────────────────────────────────
SessionManager::SessionManager() = default;

SessionManager::~SessionManager() { destroy_all(); }

// ── Session lifecycle ────────────────────────────────────────────────────────
std::string SessionManager::create_session(const std::string &file_path, const std::string &desired_id,
                                           const std::string &checkpoint_directory, int64_t &file_size_out,
                                           std::string &checkpoint_dir_out) {
    std::lock_guard<std::mutex> lock(mutex_);

    std::string session_id = desired_id.empty() ? generate_uuid() : desired_id;

    // Check for duplicate
    if (sessions_.count(session_id)) {
        return ""; // Already exists
    }

    auto info = std::make_shared<SessionInfo>();
    info->session_id = session_id;
    info->event_queue = std::make_shared<EventQueue<SessionEventData>>();
    info->event_interest = 0;
    info->last_activity = std::chrono::steady_clock::now();

    // Store info first so the callback can find it
    sessions_[session_id] = info;

    const char *path = file_path.empty() ? nullptr : file_path.c_str();
    const char *chkpt_dir = checkpoint_directory.empty() ? nullptr : checkpoint_directory.c_str();

    omega_session_t *session =
        omega_edit_create_session(path, session_event_callback, info.get(), 0, chkpt_dir);

    if (!session) {
        sessions_.erase(session_id);
        return ""; // Failed to create
    }

    info->session = session;
    file_size_out = omega_session_get_computed_file_size(session);

    const char *chkpt = omega_session_get_checkpoint_directory(session);
    checkpoint_dir_out = chkpt ? chkpt : "";

    return session_id;
}

bool SessionManager::destroy_session(const std::string &session_id) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = sessions_.find(session_id);
    if (it == sessions_.end()) return false;

    auto &info = it->second;

    // Close event queues
    if (info->event_queue) {
        info->event_queue->close();
    }

    // Destroy all viewports first
    for (auto &vp : info->viewports) {
        if (vp.second->event_queue) {
            vp.second->event_queue->close();
        }
        // Viewports are destroyed when session is destroyed
    }

    // Destroy the session (this also destroys all viewports)
    omega_edit_destroy_session(info->session);

    sessions_.erase(it);
    return true;
}

omega_session_t *SessionManager::get_session(const std::string &session_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = sessions_.find(session_id);
    return (it != sessions_.end()) ? it->second->session : nullptr;
}

int64_t SessionManager::session_count() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return static_cast<int64_t>(sessions_.size());
}

// ── Viewport lifecycle ───────────────────────────────────────────────────────
std::string SessionManager::create_viewport(const std::string &session_id, int64_t offset, int64_t capacity,
                                            bool is_floating, const std::string &desired_viewport_id) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto sit = sessions_.find(session_id);
    if (sit == sessions_.end()) return "";

    auto &session_info = sit->second;
    std::string viewport_id = desired_viewport_id.empty() ? generate_uuid() : desired_viewport_id;

    // Check for duplicate viewport
    if (session_info->viewports.count(viewport_id)) return "";

    auto vp_info = std::make_shared<ViewportInfo>();
    vp_info->session_id = session_id;
    vp_info->viewport_id = viewport_id;
    vp_info->event_queue = std::make_shared<EventQueue<ViewportEventData>>();
    vp_info->event_interest = 0;

    // Store first so callback has access
    session_info->viewports[viewport_id] = vp_info;

    omega_viewport_t *viewport = omega_edit_create_viewport(session_info->session, offset, capacity,
                                                            is_floating ? 1 : 0, viewport_event_callback,
                                                            vp_info.get(), 0);

    if (!viewport) {
        session_info->viewports.erase(viewport_id);
        return "";
    }

    vp_info->viewport = viewport;
    return make_viewport_fqid(session_id, viewport_id);
}

bool SessionManager::destroy_viewport(const std::string &session_id, const std::string &viewport_id) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto sit = sessions_.find(session_id);
    if (sit == sessions_.end()) return false;

    auto &session_info = sit->second;
    auto vit = session_info->viewports.find(viewport_id);
    if (vit == session_info->viewports.end()) return false;

    auto &vp_info = vit->second;
    if (vp_info->event_queue) {
        vp_info->event_queue->close();
    }

    omega_edit_destroy_viewport(vp_info->viewport);
    session_info->viewports.erase(vit);
    return true;
}

omega_viewport_t *SessionManager::get_viewport(const std::string &session_id, const std::string &viewport_id) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto sit = sessions_.find(session_id);
    if (sit == sessions_.end()) return nullptr;

    auto vit = sit->second->viewports.find(viewport_id);
    return (vit != sit->second->viewports.end()) ? vit->second->viewport : nullptr;
}

// ── Event subscription ───────────────────────────────────────────────────────
std::shared_ptr<EventQueue<SessionEventData>>
SessionManager::subscribe_session_events(const std::string &session_id, int32_t interest) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = sessions_.find(session_id);
    if (it == sessions_.end()) return nullptr;

    auto &info = it->second;
    info->event_interest = interest;
    omega_session_set_event_interest(info->session, interest);
    return info->event_queue;
}

void SessionManager::unsubscribe_session_events(const std::string &session_id) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = sessions_.find(session_id);
    if (it == sessions_.end()) return;

    auto &info = it->second;
    info->event_interest = 0;
    omega_session_set_event_interest(info->session, 0);
}

std::shared_ptr<EventQueue<ViewportEventData>>
SessionManager::subscribe_viewport_events(const std::string &session_id, const std::string &viewport_id,
                                           int32_t interest) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto sit = sessions_.find(session_id);
    if (sit == sessions_.end()) return nullptr;

    auto vit = sit->second->viewports.find(viewport_id);
    if (vit == sit->second->viewports.end()) return nullptr;

    auto &vp_info = vit->second;
    vp_info->event_interest = interest;
    omega_viewport_set_event_interest(vp_info->viewport, interest);
    return vp_info->event_queue;
}

void SessionManager::unsubscribe_viewport_events(const std::string &session_id, const std::string &viewport_id) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto sit = sessions_.find(session_id);
    if (sit == sessions_.end()) return;

    auto vit = sit->second->viewports.find(viewport_id);
    if (vit == sit->second->viewports.end()) return;

    auto &vp_info = vit->second;
    vp_info->event_interest = 0;
    omega_viewport_set_event_interest(vp_info->viewport, 0);
}

void SessionManager::destroy_all() {
    std::lock_guard<std::mutex> lock(mutex_);

    for (auto &pair : sessions_) {
        auto &info = pair.second;
        if (info->event_queue) info->event_queue->close();
        for (auto &vp : info->viewports) {
            if (vp.second->event_queue) vp.second->event_queue->close();
        }
        omega_edit_destroy_session(info->session);
    }
    sessions_.clear();
}

void SessionManager::touch_session(const std::string &session_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = sessions_.find(session_id);
    if (it != sessions_.end()) {
        it->second->last_activity = std::chrono::steady_clock::now();
    }
}

void SessionManager::touch_sessions(const std::vector<std::string> &session_ids) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto now = std::chrono::steady_clock::now();
    for (const auto &sid : session_ids) {
        auto it = sessions_.find(sid);
        if (it != sessions_.end()) {
            it->second->last_activity = now;
        }
    }
}

std::vector<std::string> SessionManager::get_idle_session_ids(std::chrono::milliseconds timeout) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto now = std::chrono::steady_clock::now();
    std::vector<std::string> idle;
    for (const auto &pair : sessions_) {
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - pair.second->last_activity);
        if (elapsed >= timeout) {
            idle.push_back(pair.first);
        }
    }
    return idle;
}

} // namespace grpc_server
} // namespace omega_edit
