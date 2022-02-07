/**********************************************************************************************************************
* Copyright (c) 2021-2022 Concurrent Technologies Corporation.                                                       *
*                                                                                                                    *
* Licensed under the Apache License, Version 2.0 (the "License");                                                    *
* you may not use this file except in compliance with the License.                                                   *
* You may obtain a copy of the License at                                                                            *
*                                                                                                                    *
*     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
*                                                                                                                    *
* Unless required by applicable law or agreed to in writing, software                                                *
* distributed under the License is distributed on an "AS IS" BASIS,                                                  *
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                                           *
* See the License for the specific language governing permissions and                                                *
* limitations under the License.                                                                                     *
**********************************************************************************************************************/

#include "worker_queue/worker_queue.hpp"
#include <boost/uuid/uuid_generators.hpp>
#include <boost/uuid/uuid_io.hpp>
#include <cassert>
#include <grpcpp/ext/proto_server_reflection_plugin.h>
#include <grpcpp/grpcpp.h>
#include <grpcpp/health_check_service_interface.h>
#include <iostream>
#include <omega_edit.grpc.pb.h>
#include <omega_edit.h>
#include <omega_edit/fwd_defs.h>
#include <omega_edit/stl_string_adaptor.hpp>
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

using omega_edit::ChangeDetailsResponse;
using omega_edit::ChangeKind;
using omega_edit::ChangeRequest;
using omega_edit::ChangeResponse;
using omega_edit::CreateSessionRequest;
using omega_edit::CreateSessionResponse;
using omega_edit::CreateViewportRequest;
using omega_edit::CreateViewportResponse;
using omega_edit::ObjectId;
using omega_edit::SaveSessionRequest;
using omega_edit::SaveSessionResponse;
using omega_edit::SessionChange;
using omega_edit::VersionResponse;
using omega_edit::ViewportChange;
using omega_edit::ViewportDataRequest;
using omega_edit::ViewportDataResponse;

using google::protobuf::Empty;

class SessionEventWriter;
using session_event_subscription_map_t = std::map<std::string, SessionEventWriter *>;

class ViewportEventWriter;
using viewport_event_subscription_map_t = std::map<std::string, ViewportEventWriter *>;

class SessionEventWriter final : public ServerWriteReactor<SessionChange>, public omega_edit::IWorkerQueue {
    const std::string session_id;
    session_event_subscription_map_t &session_event_subscriptions;

public:
    SessionEventWriter(std::string session_id, session_event_subscription_map_t &session_event_subscriptions)
        : session_id(std::move(session_id)), session_event_subscriptions(session_event_subscriptions) {
        // Add this instance to the session event subscriptions
        session_event_subscriptions[session_id] = this;
    }

    ~SessionEventWriter() override {
        Finish(Status::OK);
        // Remove this instance from the session event subscriptions
        auto session_event_subscription_iter = session_event_subscriptions.find(session_id);
        session_event_subscriptions.erase(session_event_subscription_iter);
    }

    void OnDone() override { delete this; }

    void HandleItem(std::shared_ptr<void> item) override {
        auto session_change_ptr = std::static_pointer_cast<SessionChange>(item);
        StartWrite(session_change_ptr.get());
    }
};

class ViewportEventWriter final : public ServerWriteReactor<ViewportChange>, public omega_edit::IWorkerQueue {
    const std::string viewport_id;
    viewport_event_subscription_map_t &viewport_event_subscriptions;

public:
    ViewportEventWriter(std::string viewport_id, viewport_event_subscription_map_t &viewport_event_subscriptions)
        : viewport_id(std::move(viewport_id)), viewport_event_subscriptions(viewport_event_subscriptions) {
        // Add this instance to the session event subscriptions
        viewport_event_subscriptions[viewport_id] = this;
    }

    ~ViewportEventWriter() override {
        Finish(Status::OK);
        // Remove this instance from the viewport event subscriptions
        auto viewport_event_subscription_iter = viewport_event_subscriptions.find(viewport_id);
        viewport_event_subscriptions.erase(viewport_event_subscription_iter);
    }

    void OnDone() override { delete this; }

    void HandleItem(std::shared_ptr<void> item) override {
        auto viewport_change_ptr = std::static_pointer_cast<ViewportChange>(item);
        StartWrite(viewport_change_ptr.get());
    }
};

class SessionManager {
private:
    std::map<omega_session_t *, std::string> session_to_id_{};
    std::map<std::string, omega_session_t *> id_to_session_{};
    session_event_subscription_map_t session_event_subscriptions_{};

    std::map<omega_viewport_t *, std::string> viewport_to_id_{};
    std::map<std::string, omega_viewport_t *> id_to_viewport_{};
    viewport_event_subscription_map_t viewport_event_subscriptions_{};

public:
    std::string add_session(omega_session_t *session_ptr) {
        assert(session_ptr);
        const auto uuid = boost::uuids::random_generator()();
        auto session_id = boost::uuids::to_string(uuid);
        session_to_id_.insert(std::make_pair(session_ptr, session_id));
        id_to_session_.insert(std::make_pair(session_id, session_ptr));
        return session_id;
    }

    void destroy_session(const std::string &session_id) {
        const auto id_to_session_iter = id_to_session_.find(session_id);
        if (id_to_session_iter != id_to_session_.end()) {
            const auto session_ptr = id_to_session_iter->second;
            assert(session_ptr);
            const auto session_to_id_iter = session_to_id_.find(session_ptr);
            session_to_id_.erase(session_to_id_iter);
            id_to_session_.erase(id_to_session_iter);
            const auto session_event_subscription_iter = session_event_subscriptions_.find(session_id);
            if (session_event_subscription_iter != session_event_subscriptions_.end()) {
                session_event_subscription_iter->second->OnDone();
                session_event_subscriptions_.erase(session_event_subscription_iter);
            }
            omega_edit_destroy_session(session_ptr);
        }
    }

    std::string get_session_id(const omega_session_t *session_ptr) {
        return session_to_id_[const_cast<omega_session_t *>(session_ptr)];
    }

    omega_session_t *get_session_ptr(const std::string &session_id) { return id_to_session_[session_id]; }

    SessionEventWriter *create_subscription(const std::string &session_id) {
        const auto session_event_subscription_iter = session_event_subscriptions_.find(session_id);
        return (session_event_subscription_iter != session_event_subscriptions_.end())
                       ? session_event_subscription_iter->second
                       : new SessionEventWriter(session_id, session_event_subscriptions_);
    }

    SessionEventWriter *get_subscription(const std::string &session_id) {
        const auto session_event_subscription_iter = session_event_subscriptions_.find(session_id);
        return (session_event_subscription_iter != session_event_subscriptions_.end())
                       ? session_event_subscription_iter->second
                       : nullptr;
    }

    std::string add_viewport(omega_viewport_t *viewport_ptr) {
        const auto uuid = boost::uuids::random_generator()();
        auto viewport_id = boost::uuids::to_string(uuid);
        viewport_to_id_.insert(std::make_pair(viewport_ptr, viewport_id));
        id_to_viewport_.insert(std::make_pair(viewport_id, viewport_ptr));
        return viewport_id;
    }

    void destroy_viewport(const std::string &viewport_id) {
        const auto id_to_viewport_iter = id_to_viewport_.find(viewport_id);
        if (id_to_viewport_iter != id_to_viewport_.end()) {
            auto viewport_ptr = id_to_viewport_iter->second;
            const auto viewport_to_id_iter = viewport_to_id_.find(viewport_ptr);
            viewport_to_id_.erase(viewport_to_id_iter);
            id_to_viewport_.erase(id_to_viewport_iter);
            omega_edit_destroy_viewport(viewport_ptr);
        }
    }

    std::string get_viewport_id(const omega_viewport_t *viewport_ptr) {
        return viewport_to_id_[const_cast<omega_viewport_t *>(viewport_ptr)];
    }

    omega_viewport_t *get_viewport_ptr(const std::string &viewport_id) { return id_to_viewport_[viewport_id]; }

    ViewportEventWriter *create_viewport_subscription(const std::string &viewport_id) {
        const auto viewport_event_subscription_iter = viewport_event_subscriptions_.find(viewport_id);
        return (viewport_event_subscription_iter != viewport_event_subscriptions_.end())
                       ? viewport_event_subscription_iter->second
                       : new ViewportEventWriter(viewport_id, viewport_event_subscriptions_);
    }

    ViewportEventWriter *get_viewport_subscription(const std::string &viewport_id) {
        const auto viewport_event_subscription_iter = viewport_event_subscriptions_.find(viewport_id);
        return (viewport_event_subscription_iter != viewport_event_subscriptions_.end())
                       ? viewport_event_subscription_iter->second
                       : nullptr;
    }
};

static inline omega_edit::SessionChangeKind omega_session_event_to_rpc_event(omega_session_event_t session_event) {
    switch (session_event) {
        case SESSION_EVT_UNDEFINED:
            return omega_edit::SessionChangeKind::SESSION_EVT_UNDEFINED;
        case SESSION_EVT_CREATE:
            return omega_edit::SessionChangeKind::SESSION_EVT_CREATE;
        case SESSION_EVT_EDIT:
            return omega_edit::SessionChangeKind::SESSION_EVT_EDIT;
        case SESSION_EVT_UNDO:
            return omega_edit::SessionChangeKind::SESSION_EVT_UNDO;
        case SESSION_EVT_CLEAR:
            return omega_edit::SessionChangeKind::SESSION_EVT_CLEAR;
        case SESSION_EVT_TRANSFORM:
            return omega_edit::SessionChangeKind::SESSION_EVT_TRANSFORM;
        case SESSION_EVT_CREATE_CHECKPOINT:
            return omega_edit::SessionChangeKind::SESSION_EVT_CREATE_CHECKPOINT;
        case SESSION_EVT_DESTROY_CHECKPOINT:
            return omega_edit::SessionChangeKind::SESSION_EVT_DESTROY_CHECKPOINT;
        case SESSION_EVT_SAVE:
            return omega_edit::SessionChangeKind::SESSION_EVT_SAVE;
        default:
            assert(0);
    }
}

static inline omega_edit::ViewportChangeKind omega_viewport_event_to_rpc_event(omega_viewport_event_t viewport_event) {
    switch (viewport_event) {
        case VIEWPORT_EVT_UNDEFINED:
            return omega_edit::ViewportChangeKind::VIEWPORT_EVT_UNDEFINED;
        case VIEWPORT_EVT_CREATE:
            return omega_edit::ViewportChangeKind::VIEWPORT_EVT_CREATE;
        case VIEWPORT_EVT_EDIT:
            return omega_edit::ViewportChangeKind::VIEWPORT_EVT_EDIT;
        case VIEWPORT_EVT_UNDO:
            return omega_edit::ViewportChangeKind::VIEWPORT_EVT_UNDO;
        case VIEWPORT_EVT_CLEAR:
            return omega_edit::ViewportChangeKind::VIEWPORT_EVT_CLEAR;
        case VIEWPORT_EVT_TRANSFORM:
            return omega_edit::ViewportChangeKind::VIEWPORT_EVT_TRANSFORM;
        default:
            assert(0);
    }
}

void session_event_callback(const omega_session_t *session_ptr, omega_session_event_t session_event,
                            const omega_change_t *change_ptr) {
    assert(session_ptr);
    const auto session_manager_ptr = reinterpret_cast<SessionManager *>(omega_session_get_user_data(session_ptr));
    const auto session_id = session_manager_ptr->get_session_id(session_ptr);
    const auto session_event_writer_ptr = session_manager_ptr->get_subscription(session_id);
    if (session_event_writer_ptr) {
        // This session is subscribed, so populate the RPC message and push it onto the worker queue
        const auto session_change_ptr = std::make_shared<SessionChange>();
        session_change_ptr->mutable_session_id()->set_id(session_id);
        session_change_ptr->set_session_change_kind(omega_session_event_to_rpc_event(session_event));
        if (change_ptr) { session_change_ptr->set_serial(omega_change_get_serial(change_ptr)); }
        session_event_writer_ptr->Push(session_change_ptr);
    }
}

void viewport_event_callback(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                             const omega_change_t *change_ptr) {
    assert(viewport_ptr);
    const auto session_manager_ptr = reinterpret_cast<SessionManager *>(omega_viewport_get_user_data(viewport_ptr));
    const auto viewport_id = session_manager_ptr->get_viewport_id(viewport_ptr);
    const auto viewport_event_writer_ptr = session_manager_ptr->get_viewport_subscription(viewport_id);
    if (viewport_event_writer_ptr) {
        // This session is subscribed, so populate the RPC message and push it onto the worker queue
        const auto viewport_change_ptr = std::make_shared<ViewportChange>();
        viewport_change_ptr->mutable_viewport_id()->set_id(viewport_id);
        viewport_change_ptr->set_viewport_change_kind(omega_viewport_event_to_rpc_event(viewport_event));
        if (change_ptr) { viewport_change_ptr->set_serial(omega_change_get_serial(change_ptr)); }
        viewport_event_writer_ptr->Push(viewport_change_ptr);
    }
}

class OmegaEditServiceImpl final : public omega_edit::Editor::CallbackService {
private:
    SessionManager session_manager_{};

public:
    OmegaEditServiceImpl() = default;
    OmegaEditServiceImpl(const OmegaEditServiceImpl &) = delete;
    OmegaEditServiceImpl &operator=(const OmegaEditServiceImpl &) = delete;

    // Unary services
    ServerUnaryReactor *GetOmegaVersion(CallbackServerContext *context, const Empty *request,
                                        VersionResponse *response) override {
        (void) request;
        response->set_major(omega_version_major());
        response->set_minor(omega_version_minor());
        response->set_patch(omega_version_patch());
        auto *reactor = context->DefaultReactor();
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *CreateSession(CallbackServerContext *context, const CreateSessionRequest *request,
                                      CreateSessionResponse *response) override {
        const char *file_path = (request->has_file_path()) ? request->file_path().c_str() : nullptr;
        auto session_ptr = omega_edit_create_session(file_path, session_event_callback, &session_manager_);
        assert(session_ptr);
        response->mutable_session_id()->set_id(session_manager_.add_session(session_ptr));
        auto *reactor = context->DefaultReactor();
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *SubmitChange(CallbackServerContext *context, const ChangeRequest *request,
                                     ChangeResponse *response) override {
        const auto &session_id = request->session_id().id();
        auto session_ptr = session_manager_.get_session_ptr(session_id);
        auto change_kind = request->kind();
        int64_t change_serial = 0;
        switch (change_kind) {
            case omega_edit::CHANGE_DELETE:
                change_serial = omega_edit_delete(session_ptr, request->offset(), request->length());
                break;
            case omega_edit::CHANGE_INSERT:
                change_serial = omega_edit_insert_string(session_ptr, request->offset(), request->data());
                break;
            case omega_edit::CHANGE_OVERWRITE:
                change_serial = omega_edit_overwrite_string(session_ptr, request->offset(), request->data());
                break;
            default:
                // TODO: Implement error handling
                break;
        }
        response->mutable_session_id()->set_id(session_id);
        response->set_serial(change_serial);
        auto *reactor = context->DefaultReactor();
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *SaveSession(CallbackServerContext *context, const SaveSessionRequest *request,
                                    SaveSessionResponse *response) override {
        const auto &session_id = request->session_id().id();
        const auto &file_path = request->file_path();
        auto session_ptr = session_manager_.get_session_ptr(session_id);
        auto *reactor = context->DefaultReactor();
        if (0 == omega_edit_save(session_ptr, file_path.c_str(), 1, nullptr)) {
            response->mutable_session_id()->set_id(session_id);
            response->set_file_path(file_path);
            reactor->Finish(Status::OK);
        } else {
            // TODO: Error handing
            reactor->Finish(Status::OK);
        }
        return reactor;
    }

    ServerUnaryReactor *DestroySession(CallbackServerContext *context, const ObjectId *request,
                                       ObjectId *response) override {
        const auto &session_id = request->id();
        session_manager_.destroy_session(session_id);
        response->set_id(session_id);
        auto *reactor = context->DefaultReactor();
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *GetChangeDetails(CallbackServerContext *context, const SessionChange *request,
                                         ChangeDetailsResponse *response) override {
        const auto &session_id = request->session_id().id();
        const auto session_ptr = session_manager_.get_session_ptr(session_id);
        const auto serial = request->serial();
        auto change_ptr = omega_session_get_change(session_ptr, serial);
        response->mutable_change()->set_serial(serial);
        response->mutable_change()->set_offset(omega_change_get_offset(change_ptr));
        response->mutable_change()->set_length(omega_change_get_length(change_ptr));
        const auto kind = omega_change_get_kind_as_char(change_ptr);
        switch (kind) {
            case 'D':
                response->mutable_change()->set_kind(ChangeKind::CHANGE_DELETE);
                break;
            case 'I':
                response->mutable_change()->set_kind(ChangeKind::CHANGE_INSERT);
                response->mutable_change()->set_data(omega_change_get_string(change_ptr));
                break;
            case 'O':
                response->mutable_change()->set_kind(ChangeKind::CHANGE_OVERWRITE);
                response->mutable_change()->set_data(omega_change_get_string(change_ptr));
                break;
            default:
                // TODO: Handle error
                break;
        }
        auto *reactor = context->DefaultReactor();
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *CreateViewport(CallbackServerContext *context, const CreateViewportRequest *request,
                                       CreateViewportResponse *response) override {
        (void) context;
        const auto &session_id = request->session_id().id();
        auto session_ptr = session_manager_.get_session_ptr(session_id);
        auto offset = request->offset();
        auto capacity = request->capacity();
        auto viewport_ptr =
                omega_edit_create_viewport(session_ptr, offset, capacity, viewport_event_callback, &session_manager_);
        auto viewport_id = session_manager_.add_viewport(viewport_ptr);
        response->mutable_viewport_id()->set_id(viewport_id);
        auto *reactor = context->DefaultReactor();
        reactor->Finish(Status::OK);
        return reactor;
    }

    ServerUnaryReactor *GetViewportData(CallbackServerContext *context, const ViewportDataRequest *request,
                                        ViewportDataResponse *response) override {
        (void) context;
        const auto &viewport_id = request->viewport_id().id();
        auto viewport_ptr = session_manager_.get_viewport_ptr(viewport_id);
        response->set_length(omega_viewport_get_length(viewport_ptr));
        response->set_data(omega_viewport_get_string(viewport_ptr));
        response->mutable_viewport_id()->set_id(viewport_id);
        auto *reactor = context->DefaultReactor();
        reactor->Finish(Status::OK);
        return reactor;
    }

    // Subscription services
    ServerWriteReactor<SessionChange> *SubscribeOnChangeSession(CallbackServerContext *context,
                                                                const ::omega_edit::ObjectId *request) override {
        const auto &session_id = request->id();
        return session_manager_.create_subscription(session_id);
    }
};

void RunServer(const std::string &server_address) {
    OmegaEditServiceImpl service;

    grpc::EnableDefaultHealthCheckService(true);
    grpc::reflection::InitProtoReflectionServerBuilderPlugin();
    ServerBuilder builder;

    // Listen on the given address without any authentication mechanism.
    builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());

    // Register "service" as the instance through which we'll communicate with
    // clients. In this case it corresponds to an *synchronous* service.
    builder.RegisterService(&service);

    // Finally, assemble the server.
    std::unique_ptr<Server> server(builder.BuildAndStart());
    std::clog << "Server listening on " << server_address << std::endl;

    // Wait for the server to shut down. Note that some other thread must be
    // responsible for shutting down the server for this call to ever return.
    server->Wait();
}

int main(int argc, char **argv) {
    (void) argc;
    (void) argv;
    RunServer("0.0.0.0:50042");
    return 0;
}
