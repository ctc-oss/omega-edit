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

#include "../../../lib/impl_/macros.h"
#include "./worker_queue/worker_queue.hpp"
#include "omega_edit.grpc.pb.h"
#include "omega_edit.h"
#include "omega_edit/fwd_defs.h"
#include "omega_edit/stl_string_adaptor.hpp"
#include <boost/uuid/uuid_generators.hpp>
#include <boost/uuid/uuid_io.hpp>
#include <cassert>
#include <grpcpp/ext/proto_server_reflection_plugin.h>
#include <grpcpp/grpcpp.h>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>

using grpc::CallbackServerContext;
using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerUnaryReactor;
using grpc::ServerWriter;
using grpc::ServerWriteReactor;
using grpc::Status;
using grpc::StatusCode;

using omega_edit::ByteFrequencyProfileRequest;
using omega_edit::ByteFrequencyProfileResponse;
using omega_edit::ChangeDetailsResponse;
using omega_edit::ChangeKind;
using omega_edit::ChangeRequest;
using omega_edit::ChangeResponse;
using omega_edit::ComputedFileSizeResponse;
using omega_edit::CountKind;
using omega_edit::CountRequest;
using omega_edit::CountResponse;
using omega_edit::CreateSessionRequest;
using omega_edit::CreateSessionResponse;
using omega_edit::CreateViewportRequest;
using omega_edit::CreateViewportResponse;
using omega_edit::EventSubscriptionRequest;
using omega_edit::ObjectId;
using omega_edit::SaveSessionRequest;
using omega_edit::SaveSessionResponse;
using omega_edit::SearchRequest;
using omega_edit::SearchResponse;
using omega_edit::SegmentRequest;
using omega_edit::SegmentResponse;
using omega_edit::SessionCountResponse;
using omega_edit::SessionEvent;
using omega_edit::SessionEventKind;
using omega_edit::VersionResponse;
using omega_edit::ViewportDataRequest;
using omega_edit::ViewportDataResponse;
using omega_edit::ViewportEvent;
using omega_edit::ViewportEventKind;

using google::protobuf::Empty;

class SessionEventWriter;
using session_event_subscription_map_t = std::map<std::string, SessionEventWriter *, std::less<>>;

class ViewportEventWriter;
using viewport_event_subscription_map_t = std::map<std::string, ViewportEventWriter *, std::less<>>;

static inline std::string create_uuid() { return boost::uuids::to_string(boost::uuids::random_generator()()); }

class SessionEventWriter final : public ServerWriteReactor<SessionEvent>, public omega_edit::IWorkerQueue {
    const CallbackServerContext *context_;
    const std::string session_id_;
    session_event_subscription_map_t &session_event_subscriptions_;

public:
    SessionEventWriter(const CallbackServerContext *context, std::string session_id,
                       session_event_subscription_map_t &session_event_subscriptions)
        : context_(context), session_id_(std::move(session_id)),
          session_event_subscriptions_(session_event_subscriptions) {
        assert(context_);
        assert(!session_id_.empty());
        // Add this instance to the session event subscriptions
        session_event_subscriptions_[session_id_] = this;
    }

    ~SessionEventWriter() override {
        const auto session_event_subscription_iter = session_event_subscriptions_.find(session_id_);
        assert(session_event_subscription_iter != session_event_subscriptions_.end());
        session_event_subscriptions_.erase(session_event_subscription_iter);
    }

    inline void OnDone() override { delete this; }

    void handle_item(std::shared_ptr<void> const &item) override {
        assert(item);
        StartWrite(std::static_pointer_cast<SessionEvent>(item).get());
    }
};

class ViewportEventWriter final : public ServerWriteReactor<ViewportEvent>, public omega_edit::IWorkerQueue {
    const CallbackServerContext *context_;
    const std::string viewport_id_;
    viewport_event_subscription_map_t &viewport_event_subscriptions_;

public:
    ViewportEventWriter(const CallbackServerContext *context, std::string viewport_id,
                        viewport_event_subscription_map_t &viewport_event_subscriptions)
        : context_(context), viewport_id_(std::move(viewport_id)),
          viewport_event_subscriptions_(viewport_event_subscriptions) {
        assert(context_);
        assert(!viewport_id_.empty());
        // Add this instance to the session event subscriptions
        viewport_event_subscriptions_[viewport_id_] = this;
    }

    ~ViewportEventWriter() override {
        const auto viewport_event_subscription_iter = viewport_event_subscriptions_.find(viewport_id_);
        assert(viewport_event_subscription_iter != viewport_event_subscriptions_.end());
        viewport_event_subscriptions_.erase(viewport_event_subscription_iter);
    }

    inline void OnDone() override { delete this; }

    void handle_item(std::shared_ptr<void> const &item) override {
        assert(item);
        StartWrite(std::static_pointer_cast<ViewportEvent>(item).get());
    }
};

class SessionManager {
private:
    std::map<omega_session_t *, std::string> session_to_id_{};
    std::map<std::string, omega_session_t *, std::less<>> id_to_session_{};
    session_event_subscription_map_t session_event_subscriptions_{};

    std::map<omega_viewport_t *, std::string> viewport_to_id_{};
    std::map<std::string, omega_viewport_t *, std::less<>> id_to_viewport_{};
    viewport_event_subscription_map_t viewport_event_subscriptions_{};

public:
    inline std::string add_session(omega_session_t *session_ptr, const std::string *session_id_desired = nullptr) {
        assert(session_ptr);
        // Don't use const here because it prevents the automatic move on return
        auto session_id = session_id_desired ? *session_id_desired : create_uuid();
        assert(!session_id.empty());
        assert(id_to_session_.find(session_id) == id_to_session_.end());
        session_to_id_[session_ptr] = session_id;
        id_to_session_[session_id] = session_ptr;
        assert(session_to_id_.size() == id_to_session_.size());
        return session_id;
    }

    [[nodiscard]] inline size_t get_session_count() const { return session_to_id_.size(); }

    inline SessionEventWriter *destroy_session_subscription(const std::string &session_id) {
        assert(!session_id.empty());
        const auto session_event_subscription_iter = session_event_subscriptions_.find(session_id);
        if (session_event_subscription_iter != session_event_subscriptions_.end()) {
            assert(session_event_subscription_iter->second->empty());
            session_event_subscription_iter->second->Finish(Status::OK);
            return session_event_subscription_iter->second;
        }
        return nullptr;
    }

    void destroy_session(const std::string &session_id) {
        assert(!session_id.empty());
        const auto id_to_session_iter = id_to_session_.find(session_id);
        if (id_to_session_iter != id_to_session_.end()) {
            //DBG(CLOG << LOCATION << "destroying: " << session_id << std::endl;);
            const auto session_ptr = id_to_session_iter->second;
            assert(session_ptr);
            const auto session_to_id_iter = session_to_id_.find(session_ptr);
            assert(session_to_id_iter != session_to_id_.end());
            for (auto iter = id_to_viewport_.begin(); iter != id_to_viewport_.end(); iter = id_to_viewport_.begin()) {
                destroy_viewport(iter->first);
            }
            destroy_session_subscription(session_id);
            omega_edit_destroy_session(session_ptr);
            session_to_id_.erase(session_to_id_iter);
            id_to_session_.erase(id_to_session_iter);
            //DBG(CLOG << LOCATION << "destroyed: " << session_id << std::endl;);
        }
    }

    inline std::string get_session_id(const omega_session_t *session_ptr) {
        assert(session_ptr);
        // Don't use const here because it prevents the automatic move on return
        auto session_id = session_to_id_[const_cast<omega_session_t *>(session_ptr)];
        assert(!session_id.empty());
        return session_id;
    }

    inline omega_session_t *get_session_ptr(const std::string &session_id) {
        assert(!session_id.empty());
        // Don't use const here because it prevents the automatic move on return
        auto session_ptr = id_to_session_[session_id];
        assert(session_ptr);
        return session_ptr;
    }

    SessionEventWriter *create_session_subscription(const CallbackServerContext *context,
                                                    const std::string &session_id, int32_t interest) {
        assert(!session_id.empty());
        omega_session_set_event_interest(get_session_ptr(session_id), interest);
        const auto session_event_subscription_iter = session_event_subscriptions_.find(session_id);
        return (session_event_subscription_iter != session_event_subscriptions_.end())
                       ? session_event_subscription_iter->second
                       : new SessionEventWriter(context, session_id, session_event_subscriptions_);
    }

    inline SessionEventWriter *get_session_subscription(const std::string &session_id) {
        assert(!session_id.empty());
        const auto session_event_subscription_iter = session_event_subscriptions_.find(session_id);
        return (session_event_subscription_iter != session_event_subscriptions_.end())
                       ? session_event_subscription_iter->second
                       : nullptr;
    }

    inline std::string add_viewport(omega_viewport_t *viewport_ptr, const std::string *viewport_id_desired = nullptr) {
        assert(viewport_ptr);
        // Don't use const here because it prevents the automatic move on return
        auto viewport_id = viewport_id_desired
                                   ? *viewport_id_desired
                                   : get_session_id(omega_viewport_get_session(viewport_ptr)) + ":" + create_uuid();
        assert(!viewport_id.empty());
        assert(id_to_viewport_.find(viewport_id) == id_to_viewport_.end());
        //DBG(CLOG << LOCATION << "adding: " << viewport_id << std::endl;);
        viewport_to_id_[viewport_ptr] = viewport_id;
        id_to_viewport_[viewport_id] = viewport_ptr;
        assert(viewport_to_id_.size() == omega_session_get_num_viewports(omega_viewport_get_session(viewport_ptr)));
        return viewport_id;
    }

    ViewportEventWriter *destroy_viewport_subscription(const std::string &viewport_id) {
        assert(!viewport_id.empty());
        const auto viewport_event_subscription_iter = viewport_event_subscriptions_.find(viewport_id);
        if (viewport_event_subscription_iter != viewport_event_subscriptions_.end()) {
            assert(viewport_event_subscription_iter->second->empty());
            viewport_event_subscription_iter->second->Finish(Status::OK);
            return viewport_event_subscription_iter->second;
        }
        return nullptr;
    }

    void destroy_viewport(const std::string &viewport_id) {
        assert(!viewport_id.empty());
        const auto id_to_viewport_iter = id_to_viewport_.find(viewport_id);
        if (id_to_viewport_iter != id_to_viewport_.end()) {
            //DBG(CLOG << LOCATION << "removing: " << viewport_id << std::endl;);
            const auto viewport_ptr = id_to_viewport_iter->second;
            assert(viewport_ptr);
            const auto viewport_to_id_iter = viewport_to_id_.find(viewport_ptr);
            assert(viewport_to_id_iter != viewport_to_id_.end());
            destroy_viewport_subscription(viewport_id);
            omega_edit_destroy_viewport(viewport_ptr);
            viewport_to_id_.erase(viewport_to_id_iter);
            id_to_viewport_.erase(id_to_viewport_iter);
            assert(viewport_to_id_.size() == omega_session_get_num_viewports(omega_viewport_get_session(viewport_ptr)));
        }
    }

    inline std::string get_viewport_id(const omega_viewport_t *viewport_ptr) {
        assert(viewport_ptr);
        // Don't use const here because it prevents the automatic move on return
        auto viewport_id = viewport_to_id_[const_cast<omega_viewport_t *>(viewport_ptr)];
        assert(!viewport_id.empty());
        return viewport_id;
    }

    inline omega_viewport_t *get_viewport_ptr(const std::string &viewport_id) {
        assert(!viewport_id.empty());
        // Don't use const here because it prevents the automatic move on return
        auto viewport_ptr = id_to_viewport_[viewport_id];
        assert(viewport_ptr);
        return viewport_ptr;
    }

    inline ViewportEventWriter *create_viewport_subscription(const CallbackServerContext *context,
                                                             const std::string &viewport_id, int32_t interest) {
        assert(!viewport_id.empty());
        omega_viewport_set_event_interest(get_viewport_ptr(viewport_id), interest);
        const auto viewport_event_subscription_iter = viewport_event_subscriptions_.find(viewport_id);
        return (viewport_event_subscription_iter != viewport_event_subscriptions_.end())
                       ? viewport_event_subscription_iter->second
                       : new ViewportEventWriter(context, viewport_id, viewport_event_subscriptions_);
    }

    inline ViewportEventWriter *get_viewport_subscription(const std::string &viewport_id) {
        assert(!viewport_id.empty());
        const auto viewport_event_subscription_iter = viewport_event_subscriptions_.find(viewport_id);
        return (viewport_event_subscription_iter != viewport_event_subscriptions_.end())
                       ? viewport_event_subscription_iter->second
                       : nullptr;
    }
};

static inline SessionEventKind omega_session_event_to_rpc_event(omega_session_event_t session_event) {
    switch (session_event) {
        case SESSION_EVT_UNDEFINED:
            return SessionEventKind::SESSION_EVT_UNDEFINED;
        case SESSION_EVT_CREATE:
            return SessionEventKind::SESSION_EVT_CREATE;
        case SESSION_EVT_EDIT:
            return SessionEventKind::SESSION_EVT_EDIT;
        case SESSION_EVT_UNDO:
            return SessionEventKind::SESSION_EVT_UNDO;
        case SESSION_EVT_CLEAR:
            return SessionEventKind::SESSION_EVT_CLEAR;
        case SESSION_EVT_TRANSFORM:
            return SessionEventKind::SESSION_EVT_TRANSFORM;
        case SESSION_EVT_CREATE_CHECKPOINT:
            return SessionEventKind::SESSION_EVT_CREATE_CHECKPOINT;
        case SESSION_EVT_DESTROY_CHECKPOINT:
            return SessionEventKind::SESSION_EVT_DESTROY_CHECKPOINT;
        case SESSION_EVT_SAVE:
            return SessionEventKind::SESSION_EVT_SAVE;
        case SESSION_EVT_CREATE_VIEWPORT:
            return SessionEventKind::SESSION_EVT_CREATE_VIEWPORT;
        case SESSION_EVT_DESTROY_VIEWPORT:
            return SessionEventKind::SESSION_EVT_DESTROY_VIEWPORT;
        default:
            abort();
    }
}

static inline ViewportEventKind omega_viewport_event_to_rpc_event(omega_viewport_event_t viewport_event) {
    switch (viewport_event) {
        case VIEWPORT_EVT_UNDEFINED:
            return ViewportEventKind::VIEWPORT_EVT_UNDEFINED;
        case VIEWPORT_EVT_CREATE:
            return ViewportEventKind::VIEWPORT_EVT_CREATE;
        case VIEWPORT_EVT_EDIT:
            return ViewportEventKind::VIEWPORT_EVT_EDIT;
        case VIEWPORT_EVT_UNDO:
            return ViewportEventKind::VIEWPORT_EVT_UNDO;
        case VIEWPORT_EVT_CLEAR:
            return ViewportEventKind::VIEWPORT_EVT_CLEAR;
        case VIEWPORT_EVT_TRANSFORM:
            return ViewportEventKind::VIEWPORT_EVT_TRANSFORM;
        case VIEWPORT_EVT_MODIFY:
            return ViewportEventKind::VIEWPORT_EVT_MODIFY;
        default:
            abort();
    }
}

void handle_session_event(const omega_session_t *session_ptr, omega_session_event_t session_event,
                          const void *session_event_ptr) {
    assert(session_ptr);
    const auto session_manager_ptr = reinterpret_cast<SessionManager *>(omega_session_get_user_data_ptr(session_ptr));
    const auto session_id = session_manager_ptr->get_session_id(session_ptr);
    assert(!session_id.empty());
    const auto session_event_writer_ptr = session_manager_ptr->get_session_subscription(session_id);
    if (session_event_writer_ptr) {
        // This session is subscribed, so populate the RPC message and push it onto the worker queue
        const auto session_change_ptr = std::make_shared<SessionEvent>();
        session_change_ptr->set_session_id(session_id);
        session_change_ptr->set_session_event_kind(omega_session_event_to_rpc_event(session_event));
        session_change_ptr->set_computed_file_size(omega_session_get_computed_file_size(session_ptr));
        session_change_ptr->set_change_count(omega_session_get_num_changes(session_ptr));
        session_change_ptr->set_undo_count(omega_session_get_num_undone_changes(session_ptr));
        if (session_event_ptr) {
            session_change_ptr->set_serial(
                    omega_change_get_serial(reinterpret_cast<const omega_change_t *>(session_event_ptr)));
        }
        session_event_writer_ptr->push(session_change_ptr);
    }
}

void session_event_callback(const omega_session_t *session_ptr, omega_session_event_t session_event,
                            const void *session_event_ptr) {
    assert(session_ptr);
    // When this callback is called from the underlying library at session creation time, the session doesn't have an
    // ID yet.  Once the session is created and gets an ID assigned, handle_session_event will be called with the
    // "fully-baked" session and the SESSION_EVT_CREATE event.
    if (session_event != omega_session_event_t::SESSION_EVT_CREATE) {
        handle_session_event(session_ptr, session_event, session_event_ptr);
    }
}

void handle_viewport_event(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                           const void *viewport_event_ptr) {
    assert(viewport_ptr);
    const auto session_manager_ptr = reinterpret_cast<SessionManager *>(omega_viewport_get_user_data_ptr(viewport_ptr));
    const auto viewport_id = session_manager_ptr->get_viewport_id(viewport_ptr);
    assert(!viewport_id.empty());
    const auto viewport_event_writer_ptr = session_manager_ptr->get_viewport_subscription(viewport_id);
    if (viewport_event_writer_ptr) {
        // This viewport is subscribed, so populate the RPC message and push it onto the worker queue
        const auto session_id = session_manager_ptr->get_session_id(omega_viewport_get_session(viewport_ptr));
        assert(!session_id.empty());
        const auto viewport_change_ptr = std::make_shared<ViewportEvent>();
        viewport_change_ptr->set_session_id(session_id);
        viewport_change_ptr->set_viewport_id(viewport_id);
        viewport_change_ptr->set_offset(omega_viewport_get_offset(viewport_ptr));
        viewport_change_ptr->set_viewport_event_kind(omega_viewport_event_to_rpc_event(viewport_event));
        if (viewport_event_ptr) {
            viewport_change_ptr->set_serial(
                    omega_change_get_serial(reinterpret_cast<const omega_change_t *>(viewport_event_ptr)));
        }
        viewport_change_ptr->set_data(omega_viewport_get_string(viewport_ptr));
        viewport_change_ptr->set_length((int64_t) viewport_change_ptr->data().length());
        viewport_event_writer_ptr->push(viewport_change_ptr);
    }
}

void viewport_event_callback(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                             const void *viewport_event_ptr) {
    assert(viewport_ptr);
    // When this callback is called from the underlying library at viewport creation time, the viewport doesn't have an
    // ID yet.  Once the viewport is created and gets an ID assigned, handle_viewport_event will be called with the
    // "fully-baked" viewport and the VIEWPORT_EVT_CREATE event.
    if (viewport_event != omega_viewport_event_t::VIEWPORT_EVT_CREATE) {
        handle_viewport_event(viewport_ptr, viewport_event, viewport_event_ptr);
    }
}

class OmegaEditServiceImpl final : public omega_edit::Editor::CallbackService {
private:
    SessionManager session_manager_{};
    std::mutex edit_mutex_;

public:
    OmegaEditServiceImpl() = default;
    OmegaEditServiceImpl(const OmegaEditServiceImpl &) = delete;
    OmegaEditServiceImpl &operator=(const OmegaEditServiceImpl &) = delete;

    // Unary services
    ServerUnaryReactor *GetVersion(CallbackServerContext *context, const Empty *request,
                                   VersionResponse *response) override {
        (void) request;
        auto *reactor = context->DefaultReactor();
        response->set_major(omega_version_major());
        response->set_minor(omega_version_minor());
        response->set_patch(omega_version_patch());
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *CreateSession(CallbackServerContext *context, const CreateSessionRequest *request,
                                      CreateSessionResponse *response) override {
        const char *file_path = (request->has_file_path()) ? request->file_path().c_str() : nullptr;
        auto *reactor = context->DefaultReactor();
        const auto event_interest = request->has_event_interest() ? request->event_interest() : NO_EVENTS;
        omega_session_t *session_ptr;
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            session_ptr =
                    omega_edit_create_session(file_path, session_event_callback, &session_manager_, event_interest);
        }
        assert(session_ptr);
        const auto session_id = session_manager_.add_session(
                session_ptr, request->has_session_id_desired() ? &request->session_id_desired() : nullptr);
        assert(!session_id.empty());
        assert(session_id == session_manager_.get_session_id(session_ptr));
        response->set_session_id(session_id);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *SubmitChange(CallbackServerContext *context, const ChangeRequest *request,
                                     ChangeResponse *response) override {
        const auto &session_id = request->session_id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        const auto change_kind = request->kind();
        const auto offset = request->offset();
        assert(0 <= offset);
        int64_t change_serial;
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            switch (change_kind) {
                case omega_edit::CHANGE_DELETE:
                    // Ignores request data
                    change_serial = omega_edit_delete(session_ptr, offset, request->length());
                    break;
                case omega_edit::CHANGE_INSERT:
                    // Ignores request length
                    change_serial = omega_edit_insert_string(session_ptr, offset, request->data());
                    break;
                case omega_edit::CHANGE_OVERWRITE:
                    // Ignores request length
                    change_serial = omega_edit_overwrite_string(session_ptr, offset, request->data());
                    break;
                default:
                    reactor->Finish(Status(StatusCode::INVALID_ARGUMENT, std::string("Illegal change kind")));
                    return reactor;
            }
        }
        response->set_session_id(session_id);
        response->set_serial(change_serial);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *UndoLastChange(CallbackServerContext *context, const ObjectId *request,
                                       ChangeResponse *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        int64_t change_serial;
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            change_serial = omega_edit_undo_last_change(session_ptr);
        }
        response->set_session_id(session_id);
        response->set_serial(change_serial);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *RedoLastUndo(CallbackServerContext *context, const ObjectId *request,
                                     ChangeResponse *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        int64_t change_serial;
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            change_serial = omega_edit_redo_last_undo(session_ptr);
        }
        response->set_session_id(session_id);
        response->set_serial(change_serial);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *ClearChanges(CallbackServerContext *context, const ObjectId *request,
                                     ObjectId *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        int rc;
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            rc = omega_edit_clear_changes(session_ptr);
        }
        if (0 == rc) {
            response->set_id(session_id);
            reactor->Finish(Status::OK);
        } else {
            std::stringstream ss;
            ss << "ERROR: " << rc << ", clearing: " << session_id;
            reactor->Finish(Status(StatusCode::INTERNAL, ss.str()));
        }
        return reactor;
    }

    ServerUnaryReactor *GetSessionCount(CallbackServerContext *context, const Empty *request,
                                        SessionCountResponse *response) override {
        response->set_count(static_cast<int64_t>(session_manager_.get_session_count()));
        auto *reactor = context->DefaultReactor();
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *GetCount(CallbackServerContext *context, const CountRequest *request,
                                 CountResponse *response) override {
        const auto &session_id = request->session_id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        const auto count_kind = request->kind();
        auto *reactor = context->DefaultReactor();
        int64_t count = -1;
        switch (count_kind) {
            case CountKind::UNDEFINED_COUNT_KIND:
                break;
            case CountKind::COUNT_FILE_SIZE:
                count = omega_session_get_computed_file_size(session_ptr);
                break;
            case CountKind::COUNT_CHANGES:
                count = omega_session_get_num_changes(session_ptr);
                break;
            case CountKind::COUNT_UNDOS:
                count = omega_session_get_num_undone_changes(session_ptr);
                break;
            case CountKind::COUNT_VIEWPORTS:
                count = omega_session_get_num_viewports(session_ptr);
                break;
            case CountKind::COUNT_CHECKPOINTS:
                count = omega_session_get_num_checkpoints(session_ptr);
                break;
            case CountKind::COUNT_SEARCH_CONTEXTS:
                count = omega_session_get_num_search_contexts(session_ptr);
                break;
            default:
                reactor->Finish(Status(StatusCode::INVALID_ARGUMENT, std::string("Illegal count kind")));
                return reactor;
        }
        assert(0 <= count);
        response->set_session_id(session_id);
        response->set_kind(count_kind);
        response->set_count(count);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *GetSegment(CallbackServerContext *context, const SegmentRequest *request,
                                   SegmentResponse *response) override {
        const auto &session_id = request->session_id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            response->set_data(omega_session_get_segment_string(session_ptr, request->offset(), request->length()));
        }
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *SaveSession(CallbackServerContext *context, const SaveSessionRequest *request,
                                    SaveSessionResponse *response) override {
        const auto &session_id = request->session_id();
        assert(!session_id.empty());
        const auto &file_path = request->file_path();
        const auto allow_overwrite = !request->has_allow_overwrite() || request->allow_overwrite();
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        int rc;
        char saved_file_buffer[FILENAME_MAX];
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            rc = omega_edit_save(session_ptr, file_path.c_str(), allow_overwrite ? 1 : 0, saved_file_buffer);
        }
        if (0 == rc) {
            assert(0 < strlen(saved_file_buffer));
            response->set_session_id(session_id);
            response->set_file_path(saved_file_buffer);
            reactor->Finish(Status::OK);
        } else {
            std::stringstream ss;
            ss << "ERROR: " << rc << ", saving session: " << session_id << ", to file path: " << file_path;
            reactor->Finish(Status(StatusCode::INTERNAL, ss.str()));
        }
        return reactor;
    }

    ServerUnaryReactor *PauseSessionChanges(CallbackServerContext *context, const ObjectId *request,
                                            ObjectId *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            omega_session_pause_changes(session_ptr);
        }
        response->set_id(session_id);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *ResumeSessionChanges(CallbackServerContext *context, const ObjectId *request,
                                             ObjectId *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            omega_session_resume_changes(session_ptr);
        }
        response->set_id(session_id);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *PauseViewportEvents(CallbackServerContext *context, const ObjectId *request,
                                            ObjectId *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            omega_session_pause_viewport_event_callbacks(session_ptr);
        }
        response->set_id(session_id);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *ResumeViewportEvents(CallbackServerContext *context, const ObjectId *request,
                                             ObjectId *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            omega_session_resume_viewport_event_callbacks(session_ptr);
        }
        response->set_id(session_id);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *DestroySession(CallbackServerContext *context, const ObjectId *request,
                                       ObjectId *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        auto *reactor = context->DefaultReactor();
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            session_manager_.destroy_session(session_id);
        }
        response->set_id(session_id);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *GetChangeDetails(CallbackServerContext *context, const SessionEvent *request,
                                         ChangeDetailsResponse *response) override {
        const auto &session_id = request->session_id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        const auto serial = request->serial();
        const auto change_ptr = omega_session_get_change(session_ptr, serial);
        assert(change_ptr);
        response->set_serial(serial);
        response->set_offset(omega_change_get_offset(change_ptr));
        response->set_length(omega_change_get_length(change_ptr));
        switch (omega_change_get_kind_as_char(change_ptr)) {
            case 'D':
                response->set_kind(ChangeKind::CHANGE_DELETE);
                break;
            case 'I':
                response->set_kind(ChangeKind::CHANGE_INSERT);
                response->set_data(omega_change_get_string(change_ptr));
                break;
            case 'O':
                response->set_kind(ChangeKind::CHANGE_OVERWRITE);
                response->set_data(omega_change_get_string(change_ptr));
                break;
            default:
                reactor->Finish(Status(StatusCode::INVALID_ARGUMENT, std::string("Illegal change kind")));
                return reactor;
        }
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *GetLastChange(CallbackServerContext *context, const ObjectId *request,
                                      ChangeDetailsResponse *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        const auto change_ptr = omega_session_get_last_change(session_ptr);
        assert(change_ptr);
        response->set_session_id(session_id);
        response->set_serial(omega_change_get_serial(change_ptr));
        response->set_offset(omega_change_get_offset(change_ptr));
        response->set_length(omega_change_get_length(change_ptr));
        switch (omega_change_get_kind_as_char(change_ptr)) {
            case 'D':
                response->set_kind(ChangeKind::CHANGE_DELETE);
                break;
            case 'I':
                response->set_kind(ChangeKind::CHANGE_INSERT);
                response->set_data(omega_change_get_string(change_ptr));
                break;
            case 'O':
                response->set_kind(ChangeKind::CHANGE_OVERWRITE);
                response->set_data(omega_change_get_string(change_ptr));
                break;
            default:
                reactor->Finish(Status(StatusCode::INVALID_ARGUMENT, std::string("Illegal change kind")));
                return reactor;
        }
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *GetLastUndo(CallbackServerContext *context, const ObjectId *request,
                                    ChangeDetailsResponse *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        const auto change_ptr = omega_session_get_last_undo(session_ptr);
        assert(change_ptr);
        response->set_session_id(session_id);
        response->set_serial(omega_change_get_serial(change_ptr));
        response->set_offset(omega_change_get_offset(change_ptr));
        response->set_length(omega_change_get_length(change_ptr));
        switch (omega_change_get_kind_as_char(change_ptr)) {
            case 'D':
                response->set_kind(ChangeKind::CHANGE_DELETE);
                break;
            case 'I':
                response->set_kind(ChangeKind::CHANGE_INSERT);
                response->set_data(omega_change_get_string(change_ptr));
                break;
            case 'O':
                response->set_kind(ChangeKind::CHANGE_OVERWRITE);
                response->set_data(omega_change_get_string(change_ptr));
                break;
            default:
                reactor->Finish(Status(StatusCode::INVALID_ARGUMENT, std::string("Illegal change kind")));
                return reactor;
        }
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *GetComputedFileSize(CallbackServerContext *context, const ObjectId *request,
                                            ComputedFileSizeResponse *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        response->set_session_id(session_id);
        response->set_computed_file_size(omega_session_get_computed_file_size(session_ptr));
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *CreateViewport(CallbackServerContext *context, const CreateViewportRequest *request,
                                       CreateViewportResponse *response) override {
        (void) context;
        const auto &session_id = request->session_id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        auto *reactor = context->DefaultReactor();
        const auto offset = request->offset();
        const auto capacity = request->capacity();
        const auto event_interest = (request->has_event_interest()) ? request->event_interest() : 0;
        omega_viewport_t *viewport_ptr;
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            viewport_ptr = omega_edit_create_viewport(session_ptr, offset, capacity, request->is_floating() ? 1 : 0,
                                                      viewport_event_callback, &session_manager_, event_interest);
        }
        assert(viewport_ptr);
        const auto viewport_id = session_manager_.add_viewport(
                viewport_ptr, request->has_viewport_id_desired() ? &request->viewport_id_desired() : nullptr);
        assert(!viewport_id.empty());
        response->set_session_id(session_id);
        response->set_viewport_id(viewport_id);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *GetViewportData(CallbackServerContext *context, const ViewportDataRequest *request,
                                        ViewportDataResponse *response) override {
        (void) context;
        const auto &viewport_id = request->viewport_id();
        assert(!viewport_id.empty());
        auto *reactor = context->DefaultReactor();
        const auto viewport_ptr = session_manager_.get_viewport_ptr(viewport_id);
        assert(viewport_ptr);
        {
            std::scoped_lock<std::mutex> edit_lock(edit_mutex_);
            response->set_offset(omega_viewport_get_offset(viewport_ptr));
            response->set_length(omega_viewport_get_length(viewport_ptr));
            response->set_data(omega_viewport_get_string(viewport_ptr));
        }
        response->set_viewport_id(viewport_id);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *DestroyViewport(CallbackServerContext *context, const ObjectId *request,
                                        ObjectId *response) override {
        const auto &viewport_id = request->id();
        assert(!viewport_id.empty());
        auto *reactor = context->DefaultReactor();
        session_manager_.destroy_viewport(viewport_id);
        response->set_id(viewport_id);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *SearchSession(CallbackServerContext *context, const SearchRequest *request,
                                      SearchResponse *response) override {
        const auto &session_id = request->session_id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        const auto &pattern = request->pattern();
        const auto is_case_insensitive = request->has_is_case_insensitive() && request->is_case_insensitive();
        const auto offset = request->has_offset() ? request->offset() : 0;
        const auto length =
                request->has_length() ? request->length() : omega_session_get_computed_file_size(session_ptr) - offset;
        auto limit = request->has_limit() ? request->limit() : -1;
        auto *reactor = context->DefaultReactor();
        if (auto search_context_ptr =
                    omega_search_create_context_string(session_ptr, pattern, offset, length, is_case_insensitive)) {
            while (limit && omega_search_next_match(search_context_ptr, 1)) {
                response->add_match_offset(omega_search_context_get_offset(search_context_ptr));
                --limit;
            }
            omega_search_destroy_context(search_context_ptr);
        }
        response->set_session_id(session_id);
        response->set_pattern(pattern);
        response->set_is_case_insensitive(is_case_insensitive);
        response->set_offset(offset);
        response->set_length(length);
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *GetByteFrequencyProfile(CallbackServerContext *context,
                                                const ByteFrequencyProfileRequest *request,
                                                ByteFrequencyProfileResponse *response) override {
        const auto &session_id = request->session_id();
        assert(!session_id.empty());
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        assert(session_ptr);
        const auto offset = request->has_offset() ? request->offset() : 0;
        const auto length =
                request->has_length() ? request->length() : omega_session_get_computed_file_size(session_ptr) - offset;
        auto *reactor = context->DefaultReactor();
        omega_byte_frequency_profile_t byte_frequency_profile;
        const auto rc = omega_session_profile(session_ptr, &byte_frequency_profile, offset, length);
        assert(rc == 0);
        response->set_session_id(session_id);
        response->set_offset(offset);
        response->set_length(length);
        for (const auto i : byte_frequency_profile) { response->add_frequency(i); }
        reactor->Finish(Status::OK);
        return reactor;
    }

    // Subscription services
    ServerWriteReactor<SessionEvent> *SubscribeToSessionEvents(CallbackServerContext *context,
                                                               const EventSubscriptionRequest *request) override {
        const auto &session_id = request->id();
        const auto interest = request->has_interest() ? request->interest() : ALL_EVENTS;
        assert(!session_id.empty());
        auto writer = session_manager_.create_session_subscription(context, session_id, interest);
        assert(writer);
        return writer;
    }

    ServerUnaryReactor *UnsubscribeToSessionEvents(CallbackServerContext *context, const ObjectId *request,
                                                   ObjectId *response) override {
        const auto &session_id = request->id();
        assert(!session_id.empty());
        auto writer = session_manager_.destroy_session_subscription(session_id);
        assert(writer);
        response->set_id(session_id);
        auto *reactor = context->DefaultReactor();
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerWriteReactor<ViewportEvent> *SubscribeToViewportEvents(CallbackServerContext *context,
                                                                 const EventSubscriptionRequest *request) override {
        const auto &viewport_id = request->id();
        const auto interest = request->has_interest() ? request->interest() : ALL_EVENTS;
        assert(!viewport_id.empty());
        auto writer = session_manager_.create_viewport_subscription(context, viewport_id, interest);
        assert(writer);
        return writer;
    }

    ServerUnaryReactor *UnsubscribeToViewportEvents(CallbackServerContext *context, const ObjectId *request,
                                                    ObjectId *response) override {
        const auto &viewport_id = request->id();
        assert(!viewport_id.empty());
        auto writer = session_manager_.destroy_viewport_subscription(viewport_id);
        assert(writer);
        response->set_id(viewport_id);
        auto *reactor = context->DefaultReactor();
        reactor->Finish(Status::OK);
        return reactor;
    }
};

void RunServer(const std::string &server_address) {
    OmegaEditServiceImpl service;

    grpc::reflection::InitProtoReflectionServerBuilderPlugin();
    ServerBuilder builder;

    // Listen on the given address without any authentication mechanism.
    builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());

    // Register "service" as the instance through which we'll communicate with
    // clients. In this case it corresponds to an *synchronous* service.
    builder.RegisterService(&service);

    // Finally, assemble the server.
    std::unique_ptr<Server> server(builder.BuildAndStart());
    DBG(CLOG << LOCATION << "Ωedit server (v" << omega_version_major() << "." << omega_version_minor() << "."
             << omega_version_patch() << ") listening on: " << server_address << std::endl;);

    // Wait for the server to shut down. Note that some other thread must be
    // responsible for shutting down the server for this call to ever return.
    server->Wait();
}

int main(int argc, char **argv) {
    (void) argc;
    (void) argv;
    // Server can run HTTP2 or Unix Domain Sockets (on compatible OSes)
#ifdef OMEGA_BUILD_UNIX
    std::string target_str("unix:///tmp/omega_edit.sock");
#else
    std::string target_str("localhost:50042");
#endif

    if (argc > 1) {
        const std::string arg_val(argv[1]);
        const std::string arg_str("--target");
        auto start_pos = arg_val.find(arg_str);
        if (start_pos != std::string::npos) {
            start_pos += arg_str.size();
            if (arg_val[start_pos] == '=') {
                target_str = arg_val.substr(start_pos + 1);
            } else {
                std::cerr << "The only correct argument syntax is --target=" << std::endl;
                return EXIT_FAILURE;
            }
        } else {
            std::cerr << "The only acceptable argument is --target=" << std::endl;
            return EXIT_FAILURE;
        }
    }

    RunServer(target_str);
    return EXIT_SUCCESS;
}
