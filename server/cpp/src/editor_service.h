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
#include <omega_edit/v1/omega_edit.grpc.pb.h>
#include <omega_edit/fwd_defs.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>

namespace omega_edit {
namespace grpc_server {

/// Heartbeat / session-reaping configuration
struct HeartbeatConfig {
    std::chrono::milliseconds session_timeout{0};   ///< 0 = disabled
    std::chrono::milliseconds cleanup_interval{0};  ///< 0 = disabled
    bool shutdown_when_no_sessions{false};
};

class EditorServiceImpl final : public ::omega_edit::v1::EditorService::Service {
public:
    /// Construct with optional heartbeat config, resource limits, and shutdown callback
    explicit EditorServiceImpl(HeartbeatConfig heartbeat_config = {}, ResourceLimits resource_limits = {},
                               std::function<void()> shutdown_callback = nullptr);
    ~EditorServiceImpl() override;

    grpc::Status GetServerInfo(grpc::ServerContext *context, const ::omega_edit::v1::GetServerInfoRequest *request,
                               ::omega_edit::v1::GetServerInfoResponse *response) override;

    grpc::Status CreateSession(grpc::ServerContext *context, const ::omega_edit::v1::CreateSessionRequest *request,
                               ::omega_edit::v1::CreateSessionResponse *response) override;

    grpc::Status SaveSession(grpc::ServerContext *context, const ::omega_edit::v1::SaveSessionRequest *request,
                             ::omega_edit::v1::SaveSessionResponse *response) override;

    grpc::Status DestroySession(grpc::ServerContext *context, const ::omega_edit::v1::DestroySessionRequest *request,
                                ::omega_edit::v1::DestroySessionResponse *response) override;

    grpc::Status SubmitChange(grpc::ServerContext *context, const ::omega_edit::v1::SubmitChangeRequest *request,
                              ::omega_edit::v1::SubmitChangeResponse *response) override;

    grpc::Status UndoLastChange(grpc::ServerContext *context, const ::omega_edit::v1::UndoLastChangeRequest *request,
                                ::omega_edit::v1::UndoLastChangeResponse *response) override;

    grpc::Status RedoLastUndo(grpc::ServerContext *context, const ::omega_edit::v1::RedoLastUndoRequest *request,
                              ::omega_edit::v1::RedoLastUndoResponse *response) override;

    grpc::Status ClearChanges(grpc::ServerContext *context, const ::omega_edit::v1::ClearChangesRequest *request,
                              ::omega_edit::v1::ClearChangesResponse *response) override;

    grpc::Status PauseSessionChanges(grpc::ServerContext *context,
                                     const ::omega_edit::v1::PauseSessionChangesRequest *request,
                                     ::omega_edit::v1::PauseSessionChangesResponse *response) override;

    grpc::Status ResumeSessionChanges(grpc::ServerContext *context,
                                      const ::omega_edit::v1::ResumeSessionChangesRequest *request,
                                      ::omega_edit::v1::ResumeSessionChangesResponse *response) override;

    grpc::Status PauseViewportEvents(grpc::ServerContext *context,
                                     const ::omega_edit::v1::PauseViewportEventsRequest *request,
                                     ::omega_edit::v1::PauseViewportEventsResponse *response) override;

    grpc::Status ResumeViewportEvents(grpc::ServerContext *context,
                                      const ::omega_edit::v1::ResumeViewportEventsRequest *request,
                                      ::omega_edit::v1::ResumeViewportEventsResponse *response) override;

    grpc::Status SessionBeginTransaction(grpc::ServerContext *context,
                                         const ::omega_edit::v1::SessionBeginTransactionRequest *request,
                                         ::omega_edit::v1::SessionBeginTransactionResponse *response) override;

    grpc::Status SessionEndTransaction(grpc::ServerContext *context,
                                       const ::omega_edit::v1::SessionEndTransactionRequest *request,
                                       ::omega_edit::v1::SessionEndTransactionResponse *response) override;

    grpc::Status NotifyChangedViewports(grpc::ServerContext *context,
                                        const ::omega_edit::v1::NotifyChangedViewportsRequest *request,
                                        ::omega_edit::v1::NotifyChangedViewportsResponse *response) override;

    grpc::Status CreateViewport(grpc::ServerContext *context, const ::omega_edit::v1::CreateViewportRequest *request,
                                ::omega_edit::v1::CreateViewportResponse *response) override;

    grpc::Status ModifyViewport(grpc::ServerContext *context, const ::omega_edit::v1::ModifyViewportRequest *request,
                                ::omega_edit::v1::ModifyViewportResponse *response) override;

    grpc::Status ViewportHasChanges(grpc::ServerContext *context,
                                    const ::omega_edit::v1::ViewportHasChangesRequest *request,
                                    ::omega_edit::v1::ViewportHasChangesResponse *response) override;

    grpc::Status GetViewportData(grpc::ServerContext *context,
                                 const ::omega_edit::v1::GetViewportDataRequest *request,
                                 ::omega_edit::v1::GetViewportDataResponse *response) override;

    grpc::Status DestroyViewport(grpc::ServerContext *context,
                                 const ::omega_edit::v1::DestroyViewportRequest *request,
                                 ::omega_edit::v1::DestroyViewportResponse *response) override;

    grpc::Status GetChangeDetails(grpc::ServerContext *context,
                                  const ::omega_edit::v1::GetChangeDetailsRequest *request,
                                  ::omega_edit::v1::GetChangeDetailsResponse *response) override;

    grpc::Status GetLastChange(grpc::ServerContext *context, const ::omega_edit::v1::GetLastChangeRequest *request,
                               ::omega_edit::v1::GetLastChangeResponse *response) override;

    grpc::Status GetLastUndo(grpc::ServerContext *context, const ::omega_edit::v1::GetLastUndoRequest *request,
                             ::omega_edit::v1::GetLastUndoResponse *response) override;

    grpc::Status GetComputedFileSize(grpc::ServerContext *context,
                                     const ::omega_edit::v1::GetComputedFileSizeRequest *request,
                                     ::omega_edit::v1::GetComputedFileSizeResponse *response) override;

    grpc::Status GetByteOrderMark(grpc::ServerContext *context,
                                  const ::omega_edit::v1::GetByteOrderMarkRequest *request,
                                  ::omega_edit::v1::GetByteOrderMarkResponse *response) override;

    grpc::Status GetContentType(grpc::ServerContext *context,
                                const ::omega_edit::v1::GetContentTypeRequest *request,
                                ::omega_edit::v1::GetContentTypeResponse *response) override;

    grpc::Status GetLanguage(grpc::ServerContext *context, const ::omega_edit::v1::GetLanguageRequest *request,
                             ::omega_edit::v1::GetLanguageResponse *response) override;

    grpc::Status GetCount(grpc::ServerContext *context, const ::omega_edit::v1::GetCountRequest *request,
                          ::omega_edit::v1::GetCountResponse *response) override;

    grpc::Status GetSessionCount(grpc::ServerContext *context,
                                 const ::omega_edit::v1::GetSessionCountRequest *request,
                                 ::omega_edit::v1::GetSessionCountResponse *response) override;

    grpc::Status GetSegment(grpc::ServerContext *context, const ::omega_edit::v1::GetSegmentRequest *request,
                            ::omega_edit::v1::GetSegmentResponse *response) override;

    grpc::Status SearchSession(grpc::ServerContext *context,
                               const ::omega_edit::v1::SearchSessionRequest *request,
                               ::omega_edit::v1::SearchSessionResponse *response) override;

    grpc::Status GetByteFrequencyProfile(grpc::ServerContext *context,
                                         const ::omega_edit::v1::GetByteFrequencyProfileRequest *request,
                                         ::omega_edit::v1::GetByteFrequencyProfileResponse *response) override;

    grpc::Status GetCharacterCounts(grpc::ServerContext *context,
                                    const ::omega_edit::v1::GetCharacterCountsRequest *request,
                                    ::omega_edit::v1::GetCharacterCountsResponse *response) override;

    grpc::Status ServerControl(grpc::ServerContext *context, const ::omega_edit::v1::ServerControlRequest *request,
                               ::omega_edit::v1::ServerControlResponse *response) override;

    grpc::Status GetHeartbeat(grpc::ServerContext *context, const ::omega_edit::v1::GetHeartbeatRequest *request,
                              ::omega_edit::v1::GetHeartbeatResponse *response) override;

    grpc::Status SubscribeToSessionEvents(
        grpc::ServerContext *context, const ::omega_edit::v1::SubscribeToSessionEventsRequest *request,
        grpc::ServerWriter<::omega_edit::v1::SubscribeToSessionEventsResponse> *writer) override;

    grpc::Status SubscribeToViewportEvents(
        grpc::ServerContext *context, const ::omega_edit::v1::SubscribeToViewportEventsRequest *request,
        grpc::ServerWriter<::omega_edit::v1::SubscribeToViewportEventsResponse> *writer) override;

    grpc::Status UnsubscribeToSessionEvents(
        grpc::ServerContext *context, const ::omega_edit::v1::UnsubscribeToSessionEventsRequest *request,
        ::omega_edit::v1::UnsubscribeToSessionEventsResponse *response) override;

    grpc::Status UnsubscribeToViewportEvents(
        grpc::ServerContext *context, const ::omega_edit::v1::UnsubscribeToViewportEventsRequest *request,
        ::omega_edit::v1::UnsubscribeToViewportEventsResponse *response) override;

private:
    // Parse "sessionId:viewportId" format
    static bool parse_viewport_id(const std::string &fqid, std::string &session_id, std::string &viewport_id);
    template <typename T>
    grpc::Status fill_viewport_data(const std::string &session_id, const std::string &viewport_id,
                                    const std::string &fqid, T *response);
    template <typename T>
    void fill_change_details(const omega_change_t *change, const std::string &session_id, T *response);

    SessionManager session_manager_;
    std::unique_ptr<IContentTypeDetector> content_type_detector_;
    std::unique_ptr<ILanguageDetector> language_detector_;
    std::chrono::steady_clock::time_point start_time_;
    std::atomic<bool> graceful_shutdown_{false};

    // Session reaping
    HeartbeatConfig heartbeat_config_;
    ResourceLimits resource_limits_;
    std::function<void()> shutdown_callback_;
    std::thread reaper_thread_;
    std::atomic<bool> reaper_stop_{false};
    std::mutex reaper_cv_mutex_;
    std::condition_variable reaper_cv_;
    void reaper_loop();
};

} // namespace grpc_server
} // namespace omega_edit

#endif // OMEGA_EDIT_EDITOR_SERVICE_H
