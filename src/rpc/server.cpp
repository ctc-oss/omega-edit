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

#include <boost/lexical_cast.hpp>
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

using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::Status;

using omega_edit::ChangeRequest;
using omega_edit::ChangeResponse;
using omega_edit::CreateSessionRequest;
using omega_edit::CreateSessionResponse;
using omega_edit::ObjectId;
using omega_edit::SaveSessionRequest;
using omega_edit::SaveSessionResponse;

class OmegaEditServiceImpl final : public omega_edit::Editor::Service {
private:
    std::map<omega_session_t *, std::string> session_to_id_{};
    std::map<std::string, omega_session_t *> id_to_session_{};

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
            auto session_ptr = id_to_session_iter->second;
            const auto session_to_id_iter = session_to_id_.find(session_ptr);
            session_to_id_.erase(session_to_id_iter);
            id_to_session_.erase(id_to_session_iter);
            omega_edit_destroy_session(session_ptr);
        }
    }

public:
    OmegaEditServiceImpl() = default;

    ~OmegaEditServiceImpl() override {
        while (!id_to_session_.empty()) { destroy_session_(id_to_session_.begin()->first); }
        assert(session_to_id_.empty());
    }

    Status CreateSession(ServerContext *context, const CreateSessionRequest *request,
                         CreateSessionResponse *response) override {
        (void) context;
        const auto &file_path = request->file_path();
        auto session_ptr = omega_edit_create_session(file_path.c_str(), nullptr, nullptr);
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
        response->set_change_id(change_serial);
        return Status::OK;
    }

    Status DestroySession(ServerContext *context, const ObjectId *request, ObjectId *response) override {
        (void) context;
        const auto &session_id = request->id();
        destroy_session_(session_id);
        response->set_id(session_id);
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
