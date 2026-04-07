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
#include <omega_edit/filesystem.h>
#include <omega_edit/search.h>
#include <omega_edit/segment.h>
#include <omega_edit/session.h>
#include <omega_edit/version.h>
#include <omega_edit/viewport.h>

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cinttypes>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <random>
#include <sstream>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#include <rpc.h>
#pragma comment(lib, "rpcrt4.lib")
#else
#include <signal.h>
#include <unistd.h>
#include <uuid/uuid.h>
#endif

namespace omega_edit {
namespace grpc_server {
namespace fs = std::filesystem;

namespace {

constexpr char kManagedTempRootName[] = "omega-edit-grpc-server";
constexpr char kManagedServerPrefix[] = "server-";
constexpr char kManagedSessionPrefix[] = "session-";

int get_current_process_id() {
#ifdef _WIN32
    return static_cast<int>(GetCurrentProcessId());
#else
    return static_cast<int>(getpid());
#endif
}

std::string get_managed_temp_root_path() {
    char *temp_dir = omega_util_get_temp_directory();
    if (temp_dir == nullptr) {
        return "";
    }

    const std::string root_path = (fs::path(temp_dir) / kManagedTempRootName).string();
    free(temp_dir);
    return root_path;
}

bool parse_managed_server_root_pid(const std::string &name, int &pid_out) {
    if (name.rfind(kManagedServerPrefix, 0) != 0) {
        return false;
    }

    const size_t pid_start = std::strlen(kManagedServerPrefix);
    const size_t pid_end = name.find('-', pid_start);
    if (pid_end == std::string::npos || pid_end == pid_start) {
        return false;
    }

    const std::string pid_str = name.substr(pid_start, pid_end - pid_start);
    if (!std::all_of(pid_str.begin(), pid_str.end(), [](unsigned char ch) { return std::isdigit(ch) != 0; })) {
        return false;
    }

    try {
        pid_out = std::stoi(pid_str);
    } catch (...) {
        return false;
    }

    return pid_out > 0;
}

bool is_process_alive(int pid) {
    if (pid <= 0) {
        return false;
    }

#ifdef _WIN32
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid));
    if (process == nullptr) {
        return false;
    }

    DWORD exit_code = 0;
    const BOOL ok = GetExitCodeProcess(process, &exit_code);
    CloseHandle(process);
    return ok != FALSE && exit_code == STILL_ACTIVE;
#else
    if (kill(static_cast<pid_t>(pid), 0) == 0) {
        return true;
    }

    return errno == EPERM;
#endif
}

} // namespace

// ── Base64 encoding (URL-safe, no padding — matches Java Base64.getUrlEncoder().withoutPadding()) ──
static const char base64_chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

static std::string base64_encode(const std::string &input) {
    std::string output;
    output.reserve(((input.size() + 2) / 3) * 4);

    for (size_t i = 0; i < input.size(); i += 3) {
        unsigned int n = static_cast<unsigned char>(input[i]) << 16;
        if (i + 1 < input.size()) n |= static_cast<unsigned char>(input[i + 1]) << 8;
        if (i + 2 < input.size()) n |= static_cast<unsigned char>(input[i + 2]);

        output.push_back(base64_chars[(n >> 18) & 0x3F]);
        output.push_back(base64_chars[(n >> 12) & 0x3F]);
        if (i + 1 < input.size()) output.push_back(base64_chars[(n >> 6) & 0x3F]);
        if (i + 2 < input.size()) output.push_back(base64_chars[n & 0x3F]);
    }
    return output;
}

// ── UUID generation ──────────────────────────────────────────────────────────
#ifdef _WIN32
static std::string generate_random_uuid_fallback() {
    std::random_device rd;
    std::mt19937_64 gen(rd());
    std::uniform_int_distribution<uint64_t> dis;
    uint64_t hi = dis(gen);
    uint64_t lo = dis(gen);
    // Set version 4 and variant bits per RFC 4122
    hi = (hi & 0xFFFFFFFFFFFF0FFFULL) | 0x0000000000004000ULL;
    lo = (lo & 0x3FFFFFFFFFFFFFFFULL) | 0x8000000000000000ULL;
    char buf[37];
    std::snprintf(buf, sizeof(buf),
                  "%08" PRIx32 "-%04" PRIx16 "-%04" PRIx16 "-%04" PRIx16 "-%012" PRIx64,
                  static_cast<uint32_t>(hi >> 32), static_cast<uint16_t>(hi >> 16),
                  static_cast<uint16_t>(hi), static_cast<uint16_t>(lo >> 48),
                  static_cast<uint64_t>(lo & 0x0000FFFFFFFFFFFFULL));
    return std::string(buf);
}
#endif

std::string SessionManager::generate_uuid() {
#ifdef _WIN32
    UUID uuid;
    if (UuidCreate(&uuid) != RPC_S_OK) {
        return generate_random_uuid_fallback();
    }
    RPC_CSTR str = nullptr;
    if (UuidToStringA(&uuid, &str) != RPC_S_OK) {
        if (str != nullptr) RpcStringFreeA(&str);
        return generate_random_uuid_fallback();
    }
    if (str == nullptr) {
        return generate_random_uuid_fallback();
    }
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

void SessionManager::cleanup_directory_best_effort(const std::string &directory_path) {
    if (directory_path.empty()) {
        return;
    }

    std::error_code ec;
    fs::remove_all(fs::path(directory_path), ec);
}

void SessionManager::cleanup_stale_server_roots_best_effort(const std::string &root_path) {
    if (root_path.empty()) {
        return;
    }

    std::error_code ec;
    const fs::path managed_root(root_path);
    if (!fs::exists(managed_root, ec) || !fs::is_directory(managed_root, ec)) {
        return;
    }

    for (fs::directory_iterator it(managed_root, ec), end; !ec && it != end; it.increment(ec)) {
        std::error_code entry_ec;
        if (!it->is_directory(entry_ec)) {
            continue;
        }

        const std::string name = it->path().filename().string();
        if (!is_managed_server_root_name(name)) {
            continue;
        }

        int pid = 0;
        if (!parse_managed_server_root_pid(name, pid) || is_process_alive(pid)) {
            continue;
        }

        std::error_code remove_ec;
        fs::remove_all(it->path(), remove_ec);
    }
}

bool SessionManager::is_managed_server_root_name(const std::string &name) {
    int pid = 0;
    return parse_managed_server_root_pid(name, pid);
}

std::string SessionManager::create_server_root_name() {
    return std::string(kManagedServerPrefix) + std::to_string(get_current_process_id()) + "-" + generate_uuid();
}

std::string SessionManager::create_managed_checkpoint_directory() {
    if (managed_server_root_.empty()) {
        const std::string managed_root_parent = get_managed_temp_root_path();
        if (managed_root_parent.empty()) {
            return "";
        }

        std::error_code ec;
        const fs::path managed_root_parent_path(managed_root_parent);
        fs::create_directories(managed_root_parent_path, ec);
        if (ec) {
            return "";
        }

        cleanup_stale_server_roots_best_effort(managed_root_parent);

        const fs::path server_root = managed_root_parent_path / create_server_root_name();
        ec.clear();
        fs::create_directories(server_root, ec);
        if (ec) {
            return "";
        }

        managed_server_root_ = server_root.string();
    }

    std::error_code ec;
    const fs::path checkpoint_directory =
        fs::path(managed_server_root_) / (std::string(kManagedSessionPrefix) + generate_uuid());
    fs::create_directories(checkpoint_directory, ec);
    if (ec) {
        return "";
    }

    return checkpoint_directory.string();
}

void SessionManager::cleanup_managed_server_root_if_empty() {
    if (managed_server_root_.empty() || !sessions_.empty()) {
        return;
    }

    std::error_code ec;
    const fs::path server_root(managed_server_root_);
    if (fs::exists(server_root, ec) && fs::is_directory(server_root, ec) && fs::is_empty(server_root, ec)) {
        ec.clear();
        fs::remove(server_root, ec);
    }

    ec.clear();
    if (!fs::exists(server_root, ec)) {
        managed_server_root_.clear();
    }
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

    // Only EDIT and UNDO events provide an omega_change_t* payload.
    // CLEAR and TRANSFORM are notified with nullptr; other events pass different types
    // (e.g., viewport pointer for CREATE_VIEWPORT/DESTROY_VIEWPORT, char* for SAVE).
    evt.serial = 0;
    switch (event) {
    case SESSION_EVT_EDIT:
    case SESSION_EVT_UNDO:
        if (ptr) {
            auto *change = static_cast<const omega_change_t *>(ptr);
            evt.serial = omega_change_get_serial(change);
        }
        break;
    default:
        break;
    }

    info->event_queue->push(evt);
}

void SessionManager::viewport_event_callback(const omega_viewport_t *viewport, omega_viewport_event_t event,
                                             const void *ptr) {
    auto *info = static_cast<ViewportInfo *>(const_cast<void *>(omega_viewport_get_user_data_ptr(viewport)));
    if (!info || !info->event_queue) return;

    ViewportEventData evt;
    evt.session_id = info->session_id;
    evt.viewport_id = info->viewport_id;
    evt.viewport_event_kind = static_cast<int32_t>(event);

    // Only EDIT and UNDO events provide an omega_change_t* payload.
    // CLEAR and TRANSFORM are notified with nullptr; CREATE passes a viewport pointer.
    evt.serial = 0;
    switch (event) {
    case VIEWPORT_EVT_EDIT:
    case VIEWPORT_EVT_UNDO:
        if (ptr) {
            auto *change = static_cast<const omega_change_t *>(ptr);
            evt.serial = omega_change_get_serial(change);
        }
        break;
    default:
        break;
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
SessionManager::SessionManager(ResourceLimits limits) : limits_(limits) {
    cleanup_stale_server_roots_best_effort(get_managed_temp_root_path());
}

SessionManager::~SessionManager() { destroy_all(); }

// ── Session lifecycle ────────────────────────────────────────────────────────
std::string SessionManager::create_session(const std::string &file_path, const std::string &desired_id,
                                           const std::string &checkpoint_directory, const std::string *initial_data,
                                           int64_t &file_size_out,
                                           std::string &checkpoint_dir_out,
                                           SessionCreateError *error_out) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (error_out) { *error_out = SessionCreateError::SUCCESS; }

    // Session ID priority: desired_id > base64(file_path) > UUID
    std::string session_id;
    if (!desired_id.empty()) {
        // The ':' character is reserved as the session:viewport FQID separator
        if (desired_id.find(':') != std::string::npos) {
            if (error_out) { *error_out = SessionCreateError::INVALID_ID; }
            return ""; // Invalid: contains reserved character
        }
        session_id = desired_id;
    } else if (!file_path.empty()) {
        session_id = base64_encode(file_path);
    } else {
        session_id = generate_uuid();
    }

    const bool share_existing_file_session = desired_id.empty() && !file_path.empty() && initial_data == nullptr;

    auto existing = sessions_.find(session_id);
    if (existing != sessions_.end()) {
        if (share_existing_file_session) {
            auto &info = existing->second;
            ++info->attachment_count;
            info->last_activity = std::chrono::steady_clock::now();
            file_size_out = omega_session_get_computed_file_size(info->session);
            checkpoint_dir_out = info->checkpoint_directory;
            return session_id;
        }

        if (error_out) { *error_out = SessionCreateError::ALREADY_EXISTS; }
        return ""; // Already exists
    }

    auto info = std::make_shared<SessionInfo>();
    info->session_id = session_id;
    info->event_queue = std::make_shared<EventQueue<SessionEventData>>(
        limits_.session_event_queue_capacity, "session subscription '" + session_id + "'");
    info->event_interest = 0;
    info->attachment_count = 1;
    info->last_activity = std::chrono::steady_clock::now();

    // Store info first so the callback can find it
    sessions_[session_id] = info;

    std::string effective_checkpoint_directory = checkpoint_directory;
    if (effective_checkpoint_directory.empty()) {
        effective_checkpoint_directory = create_managed_checkpoint_directory();
        if (effective_checkpoint_directory.empty()) {
            sessions_.erase(session_id);
            if (error_out) { *error_out = SessionCreateError::CORE_ERROR; }
            return "";
        }
        info->owns_checkpoint_directory = true;
    }

    info->checkpoint_directory = effective_checkpoint_directory;
    const char *chkpt_dir = effective_checkpoint_directory.empty() ? nullptr : effective_checkpoint_directory.c_str();

    omega_session_t *session = nullptr;
    if (initial_data != nullptr) {
        session = omega_edit_create_session_from_bytes(
            reinterpret_cast<const omega_byte_t *>(initial_data->data()), static_cast<int64_t>(initial_data->size()),
            session_event_callback, info.get(), 0, chkpt_dir);
    } else {
        const char *path = file_path.empty() ? nullptr : file_path.c_str();
        session = omega_edit_create_session(path, session_event_callback, info.get(), 0, chkpt_dir);
    }

    if (!session) {
        if (info->owns_checkpoint_directory) {
            cleanup_directory_best_effort(info->checkpoint_directory);
        }
        sessions_.erase(session_id);
        cleanup_managed_server_root_if_empty();
        if (error_out) { *error_out = SessionCreateError::CORE_ERROR; }
        return ""; // Failed to create
    }

    info->session = session;
    file_size_out = omega_session_get_computed_file_size(session);

    const char *chkpt = omega_session_get_checkpoint_directory(session);
    checkpoint_dir_out = chkpt ? chkpt : "";
    if (!checkpoint_dir_out.empty()) {
        info->checkpoint_directory = checkpoint_dir_out;
    }

    return session_id;
}

bool SessionManager::destroy_session(const std::string &session_id) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = sessions_.find(session_id);
    if (it == sessions_.end()) return false;

    auto &info = it->second;
    if (info->attachment_count > 1) {
        --info->attachment_count;
        info->last_activity = std::chrono::steady_clock::now();
        return true;
    }

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
    if (info->owns_checkpoint_directory) {
        cleanup_directory_best_effort(info->checkpoint_directory);
    }

    sessions_.erase(it);
    cleanup_managed_server_root_if_empty();
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
                                            bool is_floating, const std::string &desired_viewport_id,
                                            ViewportCreateError *error_out) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto sit = sessions_.find(session_id);
    if (sit == sessions_.end()) {
        if (error_out) *error_out = ViewportCreateError::SESSION_NOT_FOUND;
        return "";
    }

    // The ':' character is reserved as the session:viewport FQID separator
    if (!desired_viewport_id.empty() && desired_viewport_id.find(':') != std::string::npos) {
        if (error_out) *error_out = ViewportCreateError::INVALID_VIEWPORT_ID;
        return ""; // Invalid: contains reserved character
    }

    auto &session_info = sit->second;
    std::string viewport_id = desired_viewport_id.empty() ? generate_uuid() : desired_viewport_id;

    // Check for duplicate viewport
    if (session_info->viewports.count(viewport_id)) {
        if (error_out) *error_out = ViewportCreateError::DUPLICATE_VIEWPORT_ID;
        return "";
    }

    if (limits_.max_viewports_per_session > 0 &&
        session_info->viewports.size() >= limits_.max_viewports_per_session) {
        if (error_out) *error_out = ViewportCreateError::TOO_MANY_VIEWPORTS;
        return "";
    }

    auto vp_info = std::make_shared<ViewportInfo>();
    vp_info->session_id = session_id;
    vp_info->viewport_id = viewport_id;
    vp_info->event_queue = std::make_shared<EventQueue<ViewportEventData>>(
        limits_.viewport_event_queue_capacity,
        "viewport subscription '" + make_viewport_fqid(session_id, viewport_id) + "'");
    vp_info->event_interest = 0;

    // Store first so callback has access
    session_info->viewports[viewport_id] = vp_info;

    omega_viewport_t *viewport = omega_edit_create_viewport(session_info->session, offset, capacity,
                                                            is_floating ? 1 : 0, viewport_event_callback,
                                                            vp_info.get(), 0);

    if (!viewport) {
        session_info->viewports.erase(viewport_id);
        if (error_out) *error_out = ViewportCreateError::CORE_ERROR;
        return "";
    }

    vp_info->viewport = viewport;
    if (error_out) *error_out = ViewportCreateError::SUCCESS;
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
    if (info->event_queue) {
        info->event_queue->clear();
    }
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
    if (vp_info->event_queue) {
        vp_info->event_queue->clear();
    }
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
        if (info->owns_checkpoint_directory) {
            cleanup_directory_best_effort(info->checkpoint_directory);
        }
    }
    sessions_.clear();
    cleanup_managed_server_root_if_empty();
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
