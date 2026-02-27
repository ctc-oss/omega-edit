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

#include "editor_service.h"
#include "content_detection.h"

#include <omega_edit.h>
#include <omega_edit/character_counts.h>
#include <omega_edit/utility.h>
#include <omega_edit/version.h>

#include <algorithm>
#include <cstring>
#include <sstream>
#include <thread>

#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace omega_edit {
namespace grpc_server {

static std::string get_hostname() {
    char buf[256] = {};
#ifdef _WIN32
    DWORD size = sizeof(buf);
    if (GetComputerNameA(buf, &size)) return std::string(buf, size);
#else
    if (gethostname(buf, sizeof(buf)) == 0) return std::string(buf);
#endif
    return "unknown";
}

static int get_pid() {
#ifdef _WIN32
    return static_cast<int>(GetCurrentProcessId());
#else
    return static_cast<int>(getpid());
#endif
}

static int get_cpu_count() {
    auto n = std::thread::hardware_concurrency();
    return n > 0 ? static_cast<int>(n) : 1;
}

EditorServiceImpl::EditorServiceImpl(HeartbeatConfig heartbeat_config, std::function<void()> shutdown_callback)
    : start_time_(std::chrono::steady_clock::now()), heartbeat_config_(heartbeat_config),
      shutdown_callback_(std::move(shutdown_callback)) {
    if (heartbeat_config_.session_timeout.count() > 0 && heartbeat_config_.cleanup_interval.count() > 0) {
        reaper_thread_ = std::thread(&EditorServiceImpl::reaper_loop, this);
    }
}

EditorServiceImpl::~EditorServiceImpl() {
    reaper_stop_ = true;
    if (reaper_thread_.joinable()) {
        reaper_thread_.join();
    }
    session_manager_.destroy_all();
}

void EditorServiceImpl::reaper_loop() {
    while (!reaper_stop_) {
        std::this_thread::sleep_for(heartbeat_config_.cleanup_interval);
        if (reaper_stop_) break;

        auto idle_ids = session_manager_.get_idle_session_ids(heartbeat_config_.session_timeout);
        for (const auto &sid : idle_ids) {
            session_manager_.destroy_session(sid);
        }

        if (heartbeat_config_.shutdown_when_no_sessions && session_manager_.session_count() == 0 &&
            !idle_ids.empty()) {
            // We just reaped sessions and now there are none left
            if (shutdown_callback_) {
                shutdown_callback_();
            }
            break;
        }
    }
}

bool EditorServiceImpl::parse_viewport_id(const std::string &fqid, std::string &session_id,
                                           std::string &viewport_id) {
    auto pos = fqid.find(':');
    if (pos == std::string::npos) return false;
    session_id = fqid.substr(0, pos);
    viewport_id = fqid.substr(pos + 1);
    return !session_id.empty() && !viewport_id.empty();
}

void EditorServiceImpl::fill_change_details(const omega_change_t *change, const std::string &session_id,
                                             ::omega_edit::ChangeDetailsResponse *response) {
    response->set_session_id(session_id);
    response->set_serial(omega_change_get_serial(change));

    char kind_char = omega_change_get_kind_as_char(change);
    switch (kind_char) {
        case 'D': response->set_kind(::omega_edit::CHANGE_DELETE); break;
        case 'I': response->set_kind(::omega_edit::CHANGE_INSERT); break;
        case 'O': response->set_kind(::omega_edit::CHANGE_OVERWRITE); break;
        default: response->set_kind(::omega_edit::UNDEFINED_CHANGE); break;
    }

    response->set_offset(omega_change_get_offset(change));
    response->set_length(omega_change_get_length(change));

    const auto *bytes = omega_change_get_bytes(change);
    if (bytes && omega_change_get_length(change) > 0) {
        response->set_data(bytes, static_cast<size_t>(omega_change_get_length(change)));
    }
}

grpc::Status EditorServiceImpl::fill_viewport_data(const std::string &session_id, const std::string &viewport_id,
                                                    const std::string &fqid,
                                                    ::omega_edit::ViewportDataResponse *response) {
    auto *vp = session_manager_.get_viewport(session_id, viewport_id);
    if (!vp) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "viewport not found: " + fqid);
    }
    const auto *data = omega_viewport_get_data(vp);
    auto length = omega_viewport_get_length(vp);

    response->set_viewport_id(fqid);
    response->set_offset(omega_viewport_get_offset(vp));
    response->set_length(length);
    if (data && length > 0) {
        response->set_data(data, static_cast<size_t>(length));
    }
    response->set_following_byte_count(omega_viewport_get_following_byte_count(vp));
    return grpc::Status::OK;
}

// ---------- Server Info ----------

grpc::Status EditorServiceImpl::GetServerInfo(grpc::ServerContext * /*context*/,
                                               const ::google::protobuf::Empty * /*request*/,
                                               ::omega_edit::ServerInfoResponse *response) {
    response->set_hostname(get_hostname());
    response->set_process_id(get_pid());

    std::ostringstream ver;
    ver << omega_version_major() << "." << omega_version_minor() << "." << omega_version_patch();
    response->set_server_version(ver.str());

    // No JVM for C++ server
    response->set_jvm_version("N/A (C++ server)");
    response->set_jvm_vendor("N/A");
    response->set_jvm_path("N/A");
    response->set_available_processors(get_cpu_count());
    return grpc::Status::OK;
}

// ---------- Session Lifecycle ----------

grpc::Status EditorServiceImpl::CreateSession(grpc::ServerContext * /*context*/,
                                               const ::omega_edit::CreateSessionRequest *request,
                                               ::omega_edit::CreateSessionResponse *response) {
    if (graceful_shutdown_.load()) {
        // During graceful shutdown, refuse new sessions (return empty like Scala)
        response->set_session_id("");
        response->set_checkpoint_directory("");
        return grpc::Status::OK;
    }

    std::string file_path;
    if (request->has_file_path()) {
        file_path = request->file_path();
    }

    std::string desired_id;
    if (request->has_session_id_desired()) {
        desired_id = request->session_id_desired();
    }

    std::string checkpoint_dir;
    if (request->has_checkpoint_directory()) {
        checkpoint_dir = request->checkpoint_directory();
    }

    int64_t file_size = 0;
    std::string checkpoint_dir_out;
    std::string session_id;
    try {
        session_id =
            session_manager_.create_session(file_path, desired_id, checkpoint_dir, file_size, checkpoint_dir_out);
    } catch (const std::exception &e) {
        return grpc::Status(grpc::StatusCode::INTERNAL, std::string("Failed to create session: ") + e.what());
    }

    if (session_id.empty()) {
        return grpc::Status(grpc::StatusCode::INTERNAL, "Failed to create session");
    }

    response->set_session_id(session_id);
    response->set_checkpoint_directory(checkpoint_dir_out);
    if (!file_path.empty()) {
        response->set_file_size(file_size);
    }
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::SaveSession(grpc::ServerContext * /*context*/,
                                             const ::omega_edit::SaveSessionRequest *request,
                                             ::omega_edit::SaveSessionResponse *response) {
    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    char saved_file_path[FILENAME_MAX] = {};
    int64_t offset = request->has_offset() ? request->offset() : 0;
    int64_t length = request->has_length() ? request->length() : 0;

    int result;
    if (offset != 0 || length != 0) {
        result = omega_edit_save_segment(session, request->file_path().c_str(), request->io_flags(), saved_file_path,
                                         offset, length);
    } else {
        result = omega_edit_save(session, request->file_path().c_str(), request->io_flags(), saved_file_path);
    }

    response->set_session_id(request->session_id());
    // If saved_file_path is populated (i.e., a new name was generated), use it; otherwise use the request file path
    std::string actual_path = (saved_file_path[0] != '\0') ? std::string(saved_file_path) : request->file_path();
    response->set_file_path(actual_path);
    response->set_save_status(result);
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::DestroySession(grpc::ServerContext * /*context*/,
                                                const ::omega_edit::ObjectId *request,
                                                ::omega_edit::ObjectId *response) {
    if (!session_manager_.destroy_session(request->id())) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }
    response->set_id(request->id());

    // If graceful shutdown is pending and no sessions remain, trigger shutdown
    if (graceful_shutdown_.load() && session_manager_.session_count() == 0) {
        if (shutdown_callback_) {
            shutdown_callback_();
        }
    }

    return grpc::Status::OK;
}

// ---------- Edit Operations ----------

grpc::Status EditorServiceImpl::SubmitChange(grpc::ServerContext * /*context*/,
                                              const ::omega_edit::ChangeRequest *request,
                                              ::omega_edit::ChangeResponse *response) {
    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    session_manager_.touch_session(request->session_id());
    int64_t serial = 0;
    switch (request->kind()) {
        case ::omega_edit::CHANGE_DELETE:
            serial = omega_edit_delete(session, request->offset(), request->length());
            break;
        case ::omega_edit::CHANGE_INSERT:
            if (request->has_data()) {
                serial = omega_edit_insert_bytes(session, request->offset(),
                                                 reinterpret_cast<const omega_byte_t *>(request->data().data()),
                                                 static_cast<int64_t>(request->data().size()));
            } else {
                serial = omega_edit_insert_bytes(session, request->offset(), nullptr, 0);
            }
            break;
        case ::omega_edit::CHANGE_OVERWRITE:
            if (request->has_data()) {
                serial = omega_edit_overwrite_bytes(session, request->offset(),
                                                    reinterpret_cast<const omega_byte_t *>(request->data().data()),
                                                    static_cast<int64_t>(request->data().size()));
            } else {
                serial = omega_edit_overwrite_bytes(session, request->offset(), nullptr, 0);
            }
            break;
        default:
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "undefined change kind");
    }

    if (serial == 0) {
        return grpc::Status(grpc::StatusCode::UNKNOWN, "change operation failed");
    }

    response->set_session_id(request->session_id());
    response->set_serial(serial);
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::UndoLastChange(grpc::ServerContext * /*context*/,
                                                const ::omega_edit::ObjectId *request,
                                                ::omega_edit::ChangeResponse *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    int64_t serial = omega_edit_undo_last_change(session);
    if (serial == 0) {
        return grpc::Status(grpc::StatusCode::UNKNOWN, "undo failed or nothing to undo");
    }

    response->set_session_id(request->id());
    response->set_serial(serial);
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::RedoLastUndo(grpc::ServerContext * /*context*/,
                                              const ::omega_edit::ObjectId *request,
                                              ::omega_edit::ChangeResponse *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    int64_t serial = omega_edit_redo_last_undo(session);
    if (serial == 0) {
        return grpc::Status(grpc::StatusCode::UNKNOWN, "redo failed or nothing to redo");
    }

    response->set_session_id(request->id());
    response->set_serial(serial);
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::ClearChanges(grpc::ServerContext * /*context*/,
                                              const ::omega_edit::ObjectId *request,
                                              ::omega_edit::ObjectId *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    int result = omega_edit_clear_changes(session);
    if (result != 0) {
        return grpc::Status(grpc::StatusCode::UNKNOWN, "clear changes failed");
    }

    response->set_id(request->id());
    return grpc::Status::OK;
}

// ---------- Session Control ----------

grpc::Status EditorServiceImpl::PauseSessionChanges(grpc::ServerContext * /*context*/,
                                                     const ::omega_edit::ObjectId *request,
                                                     ::omega_edit::ObjectId *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    omega_session_pause_changes(session);
    response->set_id(request->id());
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::ResumeSessionChanges(grpc::ServerContext * /*context*/,
                                                      const ::omega_edit::ObjectId *request,
                                                      ::omega_edit::ObjectId *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    omega_session_resume_changes(session);
    response->set_id(request->id());
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::PauseViewportEvents(grpc::ServerContext * /*context*/,
                                                     const ::omega_edit::ObjectId *request,
                                                     ::omega_edit::ObjectId *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    omega_session_pause_viewport_event_callbacks(session);
    response->set_id(request->id());
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::ResumeViewportEvents(grpc::ServerContext * /*context*/,
                                                      const ::omega_edit::ObjectId *request,
                                                      ::omega_edit::ObjectId *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    omega_session_resume_viewport_event_callbacks(session);
    response->set_id(request->id());
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::SessionBeginTransaction(grpc::ServerContext * /*context*/,
                                                         const ::omega_edit::ObjectId *request,
                                                         ::omega_edit::ObjectId *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    int result = omega_session_begin_transaction(session);
    if (result != 0) {
        return grpc::Status(grpc::StatusCode::UNKNOWN, "begin transaction failed");
    }

    response->set_id(request->id());
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::SessionEndTransaction(grpc::ServerContext * /*context*/,
                                                       const ::omega_edit::ObjectId *request,
                                                       ::omega_edit::ObjectId *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    int result = omega_session_end_transaction(session);
    if (result != 0) {
        return grpc::Status(grpc::StatusCode::UNKNOWN, "end transaction failed");
    }

    response->set_id(request->id());
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::NotifyChangedViewports(grpc::ServerContext * /*context*/,
                                                        const ::omega_edit::ObjectId *request,
                                                        ::omega_edit::IntResponse *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    int count = omega_session_notify_changed_viewports(session);
    response->set_response(count);
    return grpc::Status::OK;
}

// ---------- Viewport Operations ----------

grpc::Status EditorServiceImpl::CreateViewport(grpc::ServerContext * /*context*/,
                                                const ::omega_edit::CreateViewportRequest *request,
                                                ::omega_edit::ViewportDataResponse *response) {
    std::string desired_vp_id;
    if (request->has_viewport_id_desired()) {
        desired_vp_id = request->viewport_id_desired();
    }

    std::string fqid = session_manager_.create_viewport(request->session_id(), request->offset(), request->capacity(),
                                                         request->is_floating(), desired_vp_id);
    if (fqid.empty()) {
        return grpc::Status(grpc::StatusCode::INTERNAL, "failed to create viewport");
    }

    std::string sid, vid;
    if (!parse_viewport_id(fqid, sid, vid)) {
        return grpc::Status(grpc::StatusCode::INTERNAL, "malformed viewport id: " + fqid);
    }

    return fill_viewport_data(sid, vid, fqid, response);
}

grpc::Status EditorServiceImpl::ModifyViewport(grpc::ServerContext * /*context*/,
                                                const ::omega_edit::ModifyViewportRequest *request,
                                                ::omega_edit::ViewportDataResponse *response) {
    std::string sid, vid;
    if (!parse_viewport_id(request->viewport_id(), sid, vid)) {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "malformed viewport id: " + request->viewport_id());
    }

    auto *vp = session_manager_.get_viewport(sid, vid);
    if (!vp) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "viewport not found: " + request->viewport_id());
    }

    int result = omega_viewport_modify(vp, request->offset(), request->capacity(), request->is_floating() ? 1 : 0);
    if (result != 0) {
        return grpc::Status(grpc::StatusCode::UNKNOWN, "modify viewport failed");
    }

    return fill_viewport_data(sid, vid, request->viewport_id(), response);
}

grpc::Status EditorServiceImpl::ViewportHasChanges(grpc::ServerContext * /*context*/,
                                                    const ::omega_edit::ObjectId *request,
                                                    ::omega_edit::BooleanResponse *response) {
    std::string sid, vid;
    if (!parse_viewport_id(request->id(), sid, vid)) {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "malformed viewport id: " + request->id());
    }

    auto *vp = session_manager_.get_viewport(sid, vid);
    if (!vp) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "viewport not found: " + request->id());
    }

    response->set_response(omega_viewport_has_changes(vp) != 0);
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::GetViewportData(grpc::ServerContext * /*context*/,
                                                 const ::omega_edit::ViewportDataRequest *request,
                                                 ::omega_edit::ViewportDataResponse *response) {
    std::string sid, vid;
    if (!parse_viewport_id(request->viewport_id(), sid, vid)) {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                            "malformed viewport id: " + request->viewport_id());
    }

    return fill_viewport_data(sid, vid, request->viewport_id(), response);
}

grpc::Status EditorServiceImpl::DestroyViewport(grpc::ServerContext * /*context*/,
                                                 const ::omega_edit::ObjectId *request,
                                                 ::omega_edit::ObjectId *response) {
    std::string sid, vid;
    if (!parse_viewport_id(request->id(), sid, vid)) {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "malformed viewport id: " + request->id());
    }

    if (!session_manager_.destroy_viewport(sid, vid)) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "viewport not found: " + request->id());
    }

    response->set_id(request->id());
    return grpc::Status::OK;
}

// ---------- Change Details ----------

grpc::Status EditorServiceImpl::GetChangeDetails(grpc::ServerContext * /*context*/,
                                                  const ::omega_edit::SessionEvent *request,
                                                  ::omega_edit::ChangeDetailsResponse *response) {
    if (!request->has_serial()) {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "change serial id required");
    }

    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    const auto *change = omega_session_get_change(session, request->serial());
    if (!change) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "change not found");
    }

    fill_change_details(change, request->session_id(), response);
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::GetLastChange(grpc::ServerContext * /*context*/,
                                               const ::omega_edit::ObjectId *request,
                                               ::omega_edit::ChangeDetailsResponse *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    const auto *change = omega_session_get_last_change(session);
    if (!change) {
        return grpc::Status(grpc::StatusCode::UNKNOWN, "no changes available");
    }

    fill_change_details(change, request->id(), response);
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::GetLastUndo(grpc::ServerContext * /*context*/,
                                             const ::omega_edit::ObjectId *request,
                                             ::omega_edit::ChangeDetailsResponse *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    const auto *change = omega_session_get_last_undo(session);
    if (!change) {
        return grpc::Status(grpc::StatusCode::UNKNOWN, "no undone changes available");
    }

    fill_change_details(change, request->id(), response);
    return grpc::Status::OK;
}

// ---------- Computed File Size ----------

grpc::Status EditorServiceImpl::GetComputedFileSize(grpc::ServerContext * /*context*/,
                                                     const ::omega_edit::ObjectId *request,
                                                     ::omega_edit::ComputedFileSizeResponse *response) {
    auto *session = session_manager_.get_session(request->id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    session_manager_.touch_session(request->id());
    response->set_session_id(request->id());
    response->set_computed_file_size(omega_session_get_computed_file_size(session));
    return grpc::Status::OK;
}

// ---------- BOM / Content Type / Language ----------

grpc::Status EditorServiceImpl::GetByteOrderMark(grpc::ServerContext * /*context*/,
                                                  const ::omega_edit::SegmentRequest *request,
                                                  ::omega_edit::ByteOrderMarkResponse *response) {
    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    omega_bom_t bom = omega_session_detect_BOM(session, request->offset());
    const char *bom_str = omega_util_BOM_to_cstring(bom);
    auto bom_size = static_cast<int64_t>(omega_util_BOM_size(bom));

    response->set_session_id(request->session_id());
    response->set_offset(request->offset());
    response->set_length(bom_size);
    response->set_byte_order_mark(bom_str);
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::GetContentType(grpc::ServerContext * /*context*/,
                                                const ::omega_edit::SegmentRequest *request,
                                                ::omega_edit::ContentTypeResponse *response) {
    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    // Get segment data
    auto *segment = omega_segment_create(request->length());
    if (!segment) {
        return grpc::Status(grpc::StatusCode::INTERNAL, "failed to allocate segment");
    }

    int result = omega_session_get_segment(session, segment, request->offset());
    std::string content_type;
    if (result == 0) {
        auto *data = omega_segment_get_data(segment);
        auto length = omega_segment_get_length(segment);
        content_type = detect_content_type(data, static_cast<size_t>(length));
    } else {
        omega_segment_destroy(segment);
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "couldn't get segment");
    }
    omega_segment_destroy(segment);

    response->set_session_id(request->session_id());
    response->set_offset(request->offset());
    response->set_length(request->length());
    response->set_content_type(content_type);
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::GetLanguage(grpc::ServerContext * /*context*/,
                                             const ::omega_edit::TextRequest *request,
                                             ::omega_edit::LanguageResponse *response) {
    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    // Get segment data
    auto *segment = omega_segment_create(request->length());
    if (!segment) {
        return grpc::Status(grpc::StatusCode::INTERNAL, "failed to allocate segment");
    }

    int result = omega_session_get_segment(session, segment, request->offset());
    std::string language;
    if (result == 0) {
        auto *data = omega_segment_get_data(segment);
        auto length = omega_segment_get_length(segment);
        std::string bom_str = request->byte_order_mark();
        language = detect_language(data, static_cast<size_t>(length), bom_str);
    } else {
        omega_segment_destroy(segment);
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "couldn't get segment");
    }
    omega_segment_destroy(segment);

    response->set_session_id(request->session_id());
    response->set_offset(request->offset());
    response->set_length(request->length());
    response->set_language(language);
    return grpc::Status::OK;
}

// ---------- Counts ----------

grpc::Status EditorServiceImpl::GetCount(grpc::ServerContext * /*context*/,
                                          const ::omega_edit::CountRequest *request,
                                          ::omega_edit::CountResponse *response) {
    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    response->set_session_id(request->session_id());

    for (int i = 0; i < request->kind_size(); ++i) {
        auto kind = request->kind(i);
        int64_t count_value = 0;
        switch (kind) {
            case ::omega_edit::COUNT_COMPUTED_FILE_SIZE:
                count_value = omega_session_get_computed_file_size(session);
                break;
            case ::omega_edit::COUNT_CHANGES:
                count_value = omega_session_get_num_changes(session);
                break;
            case ::omega_edit::COUNT_UNDOS:
                count_value = omega_session_get_num_undone_changes(session);
                break;
            case ::omega_edit::COUNT_VIEWPORTS:
                count_value = omega_session_get_num_viewports(session);
                break;
            case ::omega_edit::COUNT_CHECKPOINTS:
                count_value = omega_session_get_num_checkpoints(session);
                break;
            case ::omega_edit::COUNT_SEARCH_CONTEXTS:
                count_value = omega_session_get_num_search_contexts(session);
                break;
            case ::omega_edit::COUNT_CHANGE_TRANSACTIONS:
                count_value = omega_session_get_num_change_transactions(session);
                break;
            case ::omega_edit::COUNT_UNDO_TRANSACTIONS:
                count_value = omega_session_get_num_undone_change_transactions(session);
                break;
            default:
                return grpc::Status(grpc::StatusCode::UNKNOWN, "undefined count kind");
        }
        auto *single = response->add_counts();
        single->set_kind(kind);
        single->set_count(count_value);
    }

    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::GetSessionCount(grpc::ServerContext * /*context*/,
                                                 const ::google::protobuf::Empty * /*request*/,
                                                 ::omega_edit::SessionCountResponse *response) {
    response->set_count(session_manager_.session_count());
    return grpc::Status::OK;
}

// ---------- Segment ----------

grpc::Status EditorServiceImpl::GetSegment(grpc::ServerContext * /*context*/,
                                            const ::omega_edit::SegmentRequest *request,
                                            ::omega_edit::SegmentResponse *response) {
    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    auto *segment = omega_segment_create(request->length());
    if (!segment) {
        return grpc::Status(grpc::StatusCode::INTERNAL, "failed to allocate segment");
    }

    int result = omega_session_get_segment(session, segment, request->offset());
    if (result != 0) {
        omega_segment_destroy(segment);
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "couldn't find segment");
    }

    auto *data = omega_segment_get_data(segment);
    auto length = omega_segment_get_length(segment);

    response->set_session_id(request->session_id());
    response->set_offset(omega_segment_get_offset(segment));
    if (data && length > 0) {
        response->set_data(data, static_cast<size_t>(length));
    }

    omega_segment_destroy(segment);
    return grpc::Status::OK;
}

// ---------- Search ----------

grpc::Status EditorServiceImpl::SearchSession(grpc::ServerContext * /*context*/,
                                               const ::omega_edit::SearchRequest *request,
                                               ::omega_edit::SearchResponse *response) {
    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    bool case_insensitive = request->has_is_case_insensitive() ? request->is_case_insensitive() : false;
    bool is_reverse = request->has_is_reverse() ? request->is_reverse() : false;
    int64_t offset = request->has_offset() ? request->offset() : 0;
    int64_t length = request->has_length() ? request->length() : 0;
    int64_t limit = request->has_limit() ? request->limit() : 0; // 0 = no limit

    auto *ctx = omega_search_create_context_bytes(
        session, reinterpret_cast<const omega_byte_t *>(request->pattern().data()),
        static_cast<int64_t>(request->pattern().size()), offset, length, case_insensitive ? 1 : 0,
        is_reverse ? 1 : 0);

    response->set_session_id(request->session_id());
    response->set_pattern(request->pattern());
    response->set_is_case_insensitive(case_insensitive);
    response->set_is_reverse(is_reverse);
    response->set_offset(offset);
    response->set_length(length);

    if (ctx) {
        int64_t num_matches = 0;
        while (omega_search_next_match(ctx, 1) > 0) {
            if (limit > 0 && num_matches >= limit) break;
            response->add_match_offset(omega_search_context_get_match_offset(ctx));
            ++num_matches;
        }
        omega_search_destroy_context(ctx);
    }

    return grpc::Status::OK;
}

// ---------- Byte Frequency Profile ----------

grpc::Status EditorServiceImpl::GetByteFrequencyProfile(grpc::ServerContext * /*context*/,
                                                         const ::omega_edit::SegmentRequest *request,
                                                         ::omega_edit::ByteFrequencyProfileResponse *response) {
    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    omega_byte_frequency_profile_t profile;
    std::memset(profile, 0, sizeof(profile));

    int result = omega_session_byte_frequency_profile(session, &profile, request->offset(), request->length());
    if (result != 0) {
        return grpc::Status(grpc::StatusCode::UNKNOWN,
                            "Profile function failed with error code: " + std::to_string(result));
    }

    response->set_session_id(request->session_id());
    response->set_offset(request->offset());
    response->set_length(request->length());

    for (int i = 0; i < OMEGA_EDIT_BYTE_FREQUENCY_PROFILE_SIZE; ++i) {
        response->add_frequency(profile[i]);
    }

    return grpc::Status::OK;
}

// ---------- Character Counts ----------

grpc::Status EditorServiceImpl::GetCharacterCounts(grpc::ServerContext * /*context*/,
                                                    const ::omega_edit::TextRequest *request,
                                                    ::omega_edit::CharacterCountResponse *response) {
    auto *session = session_manager_.get_session(request->session_id());
    if (!session) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->session_id());
    }

    omega_bom_t bom = omega_util_cstring_to_BOM(request->byte_order_mark().c_str());
    auto *counts = omega_character_counts_create();
    omega_character_counts_set_BOM(counts, bom);

    int result = omega_session_character_counts(session, counts, request->offset(), request->length(), bom);
    if (result != 0) {
        omega_character_counts_destroy(counts);
        return grpc::Status(grpc::StatusCode::UNKNOWN,
                            "CharCount function failed with error code: " + std::to_string(result));
    }

    response->set_session_id(request->session_id());
    response->set_offset(request->offset());
    response->set_length(request->length());
    response->set_byte_order_mark(omega_util_BOM_to_cstring(omega_character_counts_get_BOM(counts)));
    response->set_byte_order_mark_bytes(omega_character_counts_bom_bytes(counts));
    response->set_single_byte_chars(omega_character_counts_single_byte_chars(counts));
    response->set_double_byte_chars(omega_character_counts_double_byte_chars(counts));
    response->set_triple_byte_chars(omega_character_counts_triple_byte_chars(counts));
    response->set_quad_byte_chars(omega_character_counts_quad_byte_chars(counts));
    response->set_invalid_bytes(omega_character_counts_invalid_bytes(counts));

    omega_character_counts_destroy(counts);
    return grpc::Status::OK;
}

// ---------- Server Control ----------

grpc::Status EditorServiceImpl::ServerControl(grpc::ServerContext * /*context*/,
                                               const ::omega_edit::ServerControlRequest *request,
                                               ::omega_edit::ServerControlResponse *response) {
    response->set_kind(request->kind());
    response->set_pid(get_pid());

    switch (request->kind()) {
        case ::omega_edit::SERVER_CONTROL_GRACEFUL_SHUTDOWN:
            graceful_shutdown_.store(true);
            // Check if no sessions remain - if so, we can stop immediately
            if (session_manager_.session_count() == 0) {
                response->set_response_code(0);
                if (shutdown_callback_) {
                    shutdown_callback_();
                }
            } else {
                response->set_response_code(1); // Sessions still active
            }
            break;

        case ::omega_edit::SERVER_CONTROL_IMMEDIATE_SHUTDOWN:
            session_manager_.destroy_all();
            response->set_response_code(0);
            if (shutdown_callback_) {
                shutdown_callback_();
            }
            break;

        default:
            return grpc::Status(grpc::StatusCode::UNKNOWN, "undefined server control kind");
    }

    return grpc::Status::OK;
}

// ---------- Heartbeat ----------

grpc::Status EditorServiceImpl::GetHeartbeat(grpc::ServerContext * /*context*/,
                                              const ::omega_edit::HeartbeatRequest *request,
                                              ::omega_edit::HeartbeatResponse *response) {
    // Touch sessions referenced in the heartbeat to keep them alive
    if (request->session_ids_size() > 0) {
        std::vector<std::string> ids(request->session_ids().begin(), request->session_ids().end());
        session_manager_.touch_sessions(ids);
    }

    auto now = std::chrono::system_clock::now();
    auto uptime = std::chrono::steady_clock::now() - start_time_;

    response->set_session_count(static_cast<int32_t>(session_manager_.session_count()));
    response->set_timestamp(std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count());
    response->set_uptime(std::chrono::duration_cast<std::chrono::milliseconds>(uptime).count());
    response->set_cpu_count(get_cpu_count());

    // CPU load average - only available on POSIX
#ifdef _WIN32
    response->set_cpu_load_average(-1.0);
#else
    double loadavg[1] = {0.0};
    if (getloadavg(loadavg, 1) == 1) {
        response->set_cpu_load_average(loadavg[0]);
    } else {
        response->set_cpu_load_average(-1.0);
    }
#endif

    // Memory stats - rough approximation since C++ doesn't have JVM-like memory reporting
    // We report reasonable defaults
    response->set_max_memory(0);
    response->set_committed_memory(0);
    response->set_used_memory(0);

    return grpc::Status::OK;
}

// ---------- Event Streams ----------

grpc::Status EditorServiceImpl::SubscribeToSessionEvents(
    grpc::ServerContext *context, const ::omega_edit::EventSubscriptionRequest *request,
    grpc::ServerWriter<::omega_edit::SessionEvent> *writer) {

    auto queue = session_manager_.subscribe_session_events(request->id(),
                                                           request->has_interest() ? request->interest() : 0);
    if (!queue) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "session not found: " + request->id());
    }

    SessionEventData event_data;
    while (!context->IsCancelled()) {
        if (queue->pop(event_data, std::chrono::milliseconds(500))) {
            ::omega_edit::SessionEvent event;
            event.set_session_id(event_data.session_id);
            event.set_session_event_kind(
                static_cast<::omega_edit::SessionEventKind>(event_data.session_event_kind));
            event.set_computed_file_size(event_data.computed_file_size);
            event.set_change_count(event_data.change_count);
            event.set_undo_count(event_data.undo_count);
            if (event_data.serial != 0) {
                event.set_serial(event_data.serial);
            }
            if (!writer->Write(event)) {
                break;
            }
        }
        if (queue->is_closed()) break;
    }

    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::SubscribeToViewportEvents(
    grpc::ServerContext *context, const ::omega_edit::EventSubscriptionRequest *request,
    grpc::ServerWriter<::omega_edit::ViewportEvent> *writer) {

    std::string sid, vid;
    if (!parse_viewport_id(request->id(), sid, vid)) {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "malformed viewport id: " + request->id());
    }

    auto queue = session_manager_.subscribe_viewport_events(sid, vid,
                                                             request->has_interest() ? request->interest() : 0);
    if (!queue) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, "viewport not found: " + request->id());
    }

    ViewportEventData event_data;
    while (!context->IsCancelled()) {
        if (queue->pop(event_data, std::chrono::milliseconds(500))) {
            ::omega_edit::ViewportEvent event;
            event.set_session_id(event_data.session_id);
            event.set_viewport_id(event_data.session_id + ":" + event_data.viewport_id);
            event.set_viewport_event_kind(
                static_cast<::omega_edit::ViewportEventKind>(event_data.viewport_event_kind));
            if (event_data.serial != 0) {
                event.set_serial(event_data.serial);
            }
            if (event_data.offset >= 0) {
                event.set_offset(event_data.offset);
            }
            if (event_data.length >= 0) {
                event.set_length(event_data.length);
            }
            if (!event_data.data.empty()) {
                event.set_data(event_data.data.data(), event_data.data.size());
            }
            if (!writer->Write(event)) {
                break;
            }
        }
        if (queue->is_closed()) break;
    }

    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::UnsubscribeToSessionEvents(grpc::ServerContext * /*context*/,
                                                            const ::omega_edit::ObjectId *request,
                                                            ::omega_edit::ObjectId *response) {
    session_manager_.unsubscribe_session_events(request->id());
    response->set_id(request->id());
    return grpc::Status::OK;
}

grpc::Status EditorServiceImpl::UnsubscribeToViewportEvents(grpc::ServerContext * /*context*/,
                                                             const ::omega_edit::ObjectId *request,
                                                             ::omega_edit::ObjectId *response) {
    std::string sid, vid;
    if (!parse_viewport_id(request->id(), sid, vid)) {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, "malformed viewport id: " + request->id());
    }

    session_manager_.unsubscribe_viewport_events(sid, vid);
    response->set_id(request->id());
    return grpc::Status::OK;
}

} // namespace grpc_server
} // namespace omega_edit
