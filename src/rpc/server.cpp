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
#include <grpcpp/ext/proto_server_reflection_plugin.h>
#include <grpcpp/grpcpp.h>
#include <grpcpp/health_check_service_interface.h>
#include <iostream>
#include <omega_edit.grpc.pb.h>
#include <omega_edit.h>
#include <omega_edit/stl_string_adaptor.hpp>
#include <string>
#include <cassert>

using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerWriter;
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


class SessionEventQueue final : public omega_edit::IWorkerQueue {
public:
    SessionEventQueue(ServerWriter<SessionChange> *writer) : omega_edit::IWorkerQueue(), writer_(writer) {}
    SessionEventQueue(const SessionEventQueue &) = delete;
    SessionEventQueue operator=(const SessionEventQueue &) = delete;

    void HandleItem(std::shared_ptr<void> item) override {
        std::cout << "Not implemented" << std::endl;
    }

    ServerWriter<SessionChange> *GetWriter() const { return writer_; }

    void SetWriter(ServerWriter<SessionChange> *writer) { writer_ = writer; }

private:
    ServerWriter<SessionChange> *writer_ = nullptr;
};

class OmegaEditServiceImpl;

void session_event_callback(const omega_session_t * session_ptr, omega_session_event_t session_event, const omega_change_t * change_ptr) {
    assert(session_ptr);
    // TODO: Implement
}

class OmegaEditServiceImpl final : public omega_edit::Editor::Service {
private:
    std::map<omega_session_t *, std::string> session_to_id_{};
    std::map<std::string, omega_session_t *> id_to_session_{};
    std::map<omega_viewport_t *, std::string> viewport_to_id_{};
    std::map<std::string, omega_viewport_t *> id_to_viewport_{};

    std::string add_session_(omega_session_t *session_ptr) {
        const auto uuid = boost::uuids::random_generator()();
        auto session_id = boost::uuids::to_string(uuid);
        session_to_id_.insert(std::make_pair(session_ptr, session_id));
        id_to_session_.insert(std::make_pair(session_id, session_ptr));
        return session_id;
    }

    void destroy_session_(const std::string &session_id) {
        const auto id_to_session_iter = id_to_session_.find(session_id);
        if (id_to_session_iter != id_to_session_.end()) {
            const auto session_ptr = id_to_session_iter->second;
            const auto session_to_id_iter = session_to_id_.find(session_ptr);
            session_to_id_.erase(session_to_id_iter);
            id_to_session_.erase(id_to_session_iter);
            omega_edit_destroy_session(session_ptr);
        }
    }

    std::string add_viewport_(omega_viewport_t *viewport_ptr) {
        const auto uuid = boost::uuids::random_generator()();
        auto viewport_id = boost::uuids::to_string(uuid);
        viewport_to_id_.insert(std::make_pair(viewport_ptr, viewport_id));
        id_to_viewport_.insert(std::make_pair(viewport_id, viewport_ptr));
        return viewport_id;
    }

    void destroy_viewport_(const std::string &viewport_id) {
        const auto id_to_viewport_iter = id_to_viewport_.find(viewport_id);
        if (id_to_viewport_iter != id_to_viewport_.end()) {
            auto viewport_ptr = id_to_viewport_iter->second;
            const auto viewport_to_id_iter = viewport_to_id_.find(viewport_ptr);
            viewport_to_id_.erase(viewport_to_id_iter);
            id_to_viewport_.erase(id_to_viewport_iter);
            omega_edit_destroy_viewport(viewport_ptr);
        }
    }

public:
    OmegaEditServiceImpl() = default;
    OmegaEditServiceImpl(const OmegaEditServiceImpl &) = delete;
    OmegaEditServiceImpl &operator=(const OmegaEditServiceImpl &) = delete;

    ~OmegaEditServiceImpl() override {
        while (!id_to_session_.empty()) { destroy_session_(id_to_session_.begin()->first); }
        assert(session_to_id_.empty());
    }

    Status GetOmegaVersion(ServerContext *context, const Empty *request, VersionResponse *response) override {
        (void) context;
        (void) request;
        response->set_major(omega_version_major());
        response->set_minor(omega_version_minor());
        response->set_patch(omega_version_patch());
        return Status::OK;
    }

    Status CreateSession(ServerContext *context, const CreateSessionRequest *request,
                         CreateSessionResponse *response) override {
        (void) context;
        const auto &file_path = request->file_path();
        auto session_ptr = omega_edit_create_session(file_path.c_str(), session_event_callback, this);
        response->mutable_session_id()->set_id(this->add_session_(session_ptr));
        return Status::OK;
    }

    Status SaveSession(ServerContext *context, const SaveSessionRequest *request,
                       SaveSessionResponse *response) override {
        (void) context;
        const auto &session_id = request->session_id().id();
        const auto &file_path = request->file_path();
        auto session_ptr = id_to_session_[session_id];
        omega_edit_save(session_ptr, file_path.c_str(), 1, nullptr);
        return Status::OK;
    }

    Status SubmitChange(ServerContext *context, const ChangeRequest *request, ChangeResponse *response) override {
        (void) context;
        const auto &session_id = request->session_id().id();
        auto session_ptr = id_to_session_[session_id];
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
        return Status::OK;
    }

    Status DestroySession(ServerContext *context, const ObjectId *request, ObjectId *response) override {
        (void) context;
        const auto &session_id = request->id();
        destroy_session_(session_id);
        response->set_id(session_id);
        return Status::OK;
    }

    Status CreateViewport(ServerContext *context, const CreateViewportRequest *request,
                          CreateViewportResponse *response) override {
        (void) context;
        const auto &session_id = request->session_id().id();
        auto session_ptr = id_to_session_[session_id];
        auto offset = request->offset();
        auto capacity = request->capacity();
        auto viewport_ptr = omega_edit_create_viewport(session_ptr, offset, capacity, nullptr, nullptr);
        auto viewport_id = add_viewport_(viewport_ptr);
        response->mutable_viewport_id()->set_id(viewport_id);
        return Status::OK;
    }

    Status GetViewportData(ServerContext *context, const ViewportDataRequest *request,
                           ViewportDataResponse *response) override {
        (void) context;
        const auto &viewport_id = request->viewport_id().id();
        auto viewport_ptr = id_to_viewport_[viewport_id];
        response->set_length(omega_viewport_get_length(viewport_ptr));
        response->set_data(omega_viewport_get_string(viewport_ptr));
        response->mutable_viewport_id()->set_id(viewport_id);
        return Status::OK;
    }

    Status GetChangeDetails(ServerContext *context, const SessionChange *request,
                            ChangeDetailsResponse *response) override {
        (void) context;
        const auto &session_id = request->session_id().id();
        const auto session_ptr = id_to_session_[session_id];
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
        return Status::OK;
    }

    Status SubscribeOnChangeSession(::grpc::ServerContext *context, const ::omega_edit::ObjectId *request,
                                    ::grpc::ServerWriter<SessionChange> *writer) override {
        (void) context;
        (void) writer;
        const auto &session_id = request->id();

        // TODO: The problem here is that we need to be able to write a stream of messages over the course of an
        //  editing session, so this needs to be long lived, and not busy waiting.  If we create a thread and return
        //  from this function, the channel will be closed.  If we don't return, the main thread will be blocked.  We
        //  need to switch over to an asynchronous service model for us to be able to return, and have a background
        //  thread writing events into the channel.

        return Status::OK;
    }

    Status SubscribeOnChangeViewport(::grpc::ServerContext *context,
                                     const ::omega_edit::SubscribeOnChangeViewportRequest *request,
                                     ::grpc::ServerWriter<ViewportChange> *writer) override {
        (void) context;
        (void) request;
        (void) writer;
        return Status::OK;
    }
};

void RunServer() {
    std::string server_address("0.0.0.0:50042");
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
    std::cout << "Server listening on " << server_address << std::endl;

    // Wait for the server to shut down. Note that some other thread must be
    // responsible for shutting down the server for this call to ever return.
    server->Wait();
}

int main(int argc, char **argv) {
    (void) argc;
    (void) argv;
    RunServer();
    return 0;
}
