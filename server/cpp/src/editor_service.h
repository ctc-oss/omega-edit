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

#ifndef OMEGA_EDIT_EDITOR_SERVICE_H
#define OMEGA_EDIT_EDITOR_SERVICE_H

#include "content_detection.h"
#include "session_manager.h"

#include <grpcpp/grpcpp.h>
#include <omega_edit.grpc.pb.h>
#include <omega_edit/fwd_defs.h>

#include <atomic>
#include <chrono>
#include <functional>
#include <memory>
#include <thread>

namespace omega_edit {
namespace grpc_server {

/// Heartbeat / session-reaping configuration
struct HeartbeatConfig {
    std::chrono::milliseconds session_timeout{0};   ///< 0 = disabled
    std::chrono::milliseconds cleanup_interval{0};  ///< 0 = disabled
    bool shutdown_when_no_sessions{false};
};

class EditorServiceImpl final : public ::omega_edit::Editor::Service {
public:
    /// Construct with optional heartbeat config and shutdown callback
    explicit EditorServiceImpl(HeartbeatConfig heartbeat_config = {},
                               std::function<void()> shutdown_callback = nullptr);
    ~EditorServiceImpl() override;

    grpc::Status GetServerInfo(grpc::ServerContext *context, const ::google::protobuf::Empty *request,
                               ::omega_edit::ServerInfoResponse *response) override;

    grpc::Status CreateSession(grpc::ServerContext *context, const ::omega_edit::CreateSessionRequest *request,
                               ::omega_edit::CreateSessionResponse *response) override;

    grpc::Status SaveSession(grpc::ServerContext *context, const ::omega_edit::SaveSessionRequest *request,
                             ::omega_edit::SaveSessionResponse *response) override;

    grpc::Status DestroySession(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                ::omega_edit::ObjectId *response) override;

    grpc::Status SubmitChange(grpc::ServerContext *context, const ::omega_edit::ChangeRequest *request,
                              ::omega_edit::ChangeResponse *response) override;

    grpc::Status UndoLastChange(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                ::omega_edit::ChangeResponse *response) override;

    grpc::Status RedoLastUndo(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                              ::omega_edit::ChangeResponse *response) override;

    grpc::Status ClearChanges(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                              ::omega_edit::ObjectId *response) override;

    grpc::Status PauseSessionChanges(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                     ::omega_edit::ObjectId *response) override;

    grpc::Status ResumeSessionChanges(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                      ::omega_edit::ObjectId *response) override;

    grpc::Status PauseViewportEvents(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                     ::omega_edit::ObjectId *response) override;

    grpc::Status ResumeViewportEvents(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                      ::omega_edit::ObjectId *response) override;

    grpc::Status SessionBeginTransaction(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                         ::omega_edit::ObjectId *response) override;

    grpc::Status SessionEndTransaction(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                       ::omega_edit::ObjectId *response) override;

    grpc::Status NotifyChangedViewports(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                        ::omega_edit::IntResponse *response) override;

    grpc::Status CreateViewport(grpc::ServerContext *context, const ::omega_edit::CreateViewportRequest *request,
                                ::omega_edit::ViewportDataResponse *response) override;

    grpc::Status ModifyViewport(grpc::ServerContext *context, const ::omega_edit::ModifyViewportRequest *request,
                                ::omega_edit::ViewportDataResponse *response) override;

    grpc::Status ViewportHasChanges(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                    ::omega_edit::BooleanResponse *response) override;

    grpc::Status GetViewportData(grpc::ServerContext *context, const ::omega_edit::ViewportDataRequest *request,
                                 ::omega_edit::ViewportDataResponse *response) override;

    grpc::Status DestroyViewport(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                 ::omega_edit::ObjectId *response) override;

    grpc::Status GetChangeDetails(grpc::ServerContext *context, const ::omega_edit::SessionEvent *request,
                                  ::omega_edit::ChangeDetailsResponse *response) override;

    grpc::Status GetLastChange(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                               ::omega_edit::ChangeDetailsResponse *response) override;

    grpc::Status GetLastUndo(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                             ::omega_edit::ChangeDetailsResponse *response) override;

    grpc::Status GetComputedFileSize(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                     ::omega_edit::ComputedFileSizeResponse *response) override;

    grpc::Status GetByteOrderMark(grpc::ServerContext *context, const ::omega_edit::SegmentRequest *request,
                                  ::omega_edit::ByteOrderMarkResponse *response) override;

    grpc::Status GetContentType(grpc::ServerContext *context, const ::omega_edit::SegmentRequest *request,
                                ::omega_edit::ContentTypeResponse *response) override;

    grpc::Status GetLanguage(grpc::ServerContext *context, const ::omega_edit::TextRequest *request,
                             ::omega_edit::LanguageResponse *response) override;

    grpc::Status GetCount(grpc::ServerContext *context, const ::omega_edit::CountRequest *request,
                          ::omega_edit::CountResponse *response) override;

    grpc::Status GetSessionCount(grpc::ServerContext *context, const ::google::protobuf::Empty *request,
                                 ::omega_edit::SessionCountResponse *response) override;

    grpc::Status GetSegment(grpc::ServerContext *context, const ::omega_edit::SegmentRequest *request,
                            ::omega_edit::SegmentResponse *response) override;

    grpc::Status SearchSession(grpc::ServerContext *context, const ::omega_edit::SearchRequest *request,
                               ::omega_edit::SearchResponse *response) override;

    grpc::Status GetByteFrequencyProfile(grpc::ServerContext *context, const ::omega_edit::SegmentRequest *request,
                                         ::omega_edit::ByteFrequencyProfileResponse *response) override;

    grpc::Status GetCharacterCounts(grpc::ServerContext *context, const ::omega_edit::TextRequest *request,
                                    ::omega_edit::CharacterCountResponse *response) override;

    grpc::Status ServerControl(grpc::ServerContext *context, const ::omega_edit::ServerControlRequest *request,
                               ::omega_edit::ServerControlResponse *response) override;

    grpc::Status GetHeartbeat(grpc::ServerContext *context, const ::omega_edit::HeartbeatRequest *request,
                              ::omega_edit::HeartbeatResponse *response) override;

    grpc::Status SubscribeToSessionEvents(grpc::ServerContext *context,
                                          const ::omega_edit::EventSubscriptionRequest *request,
                                          grpc::ServerWriter<::omega_edit::SessionEvent> *writer) override;

    grpc::Status SubscribeToViewportEvents(grpc::ServerContext *context,
                                           const ::omega_edit::EventSubscriptionRequest *request,
                                           grpc::ServerWriter<::omega_edit::ViewportEvent> *writer) override;

    grpc::Status UnsubscribeToSessionEvents(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                            ::omega_edit::ObjectId *response) override;

    grpc::Status UnsubscribeToViewportEvents(grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                             ::omega_edit::ObjectId *response) override;

private:
    // Parse "sessionId:viewportId" format
    static bool parse_viewport_id(const std::string &fqid, std::string &session_id, std::string &viewport_id);
    grpc::Status fill_viewport_data(const std::string &session_id, const std::string &viewport_id,
                                    const std::string &fqid, ::omega_edit::ViewportDataResponse *response);
    void fill_change_details(const omega_change_t *change, const std::string &session_id,
                             ::omega_edit::ChangeDetailsResponse *response);

    SessionManager session_manager_;
    std::unique_ptr<IContentTypeDetector> content_type_detector_;
    std::unique_ptr<ILanguageDetector> language_detector_;
    std::chrono::steady_clock::time_point start_time_;
    std::atomic<bool> graceful_shutdown_{false};

    // Session reaping
    HeartbeatConfig heartbeat_config_;
    std::function<void()> shutdown_callback_;
    std::thread reaper_thread_;
    std::atomic<bool> reaper_stop_{false};
    void reaper_loop();
};

} // namespace grpc_server
} // namespace omega_edit

#endif // OMEGA_EDIT_EDITOR_SERVICE_H
