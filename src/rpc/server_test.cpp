/**********************************************************************************************************************
 * Copyright (c) 2022 Concurrent Technologies Corporation.                                                            *
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

#include <grpcpp/grpcpp.h>
#include <omega_edit.grpc.pb.h>
#include <sstream>

using grpc::Channel;
using grpc::ClientContext;
using grpc::Status;
using omega_edit::Change;
using omega_edit::ChangeKind;
using omega_edit::ChangeRequest;
using omega_edit::ChangeResponse;
using omega_edit::CreateSessionRequest;
using omega_edit::CreateSessionResponse;
using omega_edit::Editor;
using omega_edit::ObjectId;
using omega_edit::VersionResponse;
using omega_edit::SaveSessionRequest;
using omega_edit::SaveSessionResponse;

class OmegaEditServiceClient {
public:
    explicit OmegaEditServiceClient(const std::shared_ptr<Channel> &channel) : stub_(Editor::NewStub(channel)){};
    std::string GetOmegaEditVersion() const {
        VersionResponse response;
        google::protobuf::Empty request;
        ClientContext context;

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->GetOmegaVersion(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::lock_guard<std::mutex> lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock<std::mutex> lock(mu);
        while (!done) { cv.wait(lock); }

        if (status.ok()) {
            std::stringstream ss;
            ss << response.major() << "." << response.minor() << "." << response.patch();
            return ss.str();
        } else {
            std::cerr << status.error_code() << ": " << status.error_message() << std::endl;
            return "RPC failed";
        }
    }

    std::string CreateSession(std::string file_path = std::string()) const {
        CreateSessionRequest request;
        CreateSessionResponse response;
        ClientContext context;

        if (!file_path.empty()) { request.set_file_path(file_path); }
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->CreateSession(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::lock_guard<std::mutex> lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock<std::mutex> lock(mu);
        while (!done) { cv.wait(lock); }

        if (status.ok()) {
            return response.session_id().id();
        } else {
            std::cerr << status.error_code() << ": " << status.error_message() << std::endl;
            return "RPC failed";
        }
    }

    int64_t Insert(const std::string &session_id, int64_t offset, const std::string &str) const {
        ChangeRequest request;
        ChangeResponse response;
        ClientContext context;

        request.mutable_session_id()->set_id(session_id);
        request.set_kind(ChangeKind::CHANGE_INSERT);
        request.set_offset(offset);
        request.set_length(str.length());
        request.set_data(str);

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->SubmitChange(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::lock_guard<std::mutex> lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock<std::mutex> lock(mu);
        while (!done) { cv.wait(lock); }

        if (status.ok()) {
            return response.serial();
        } else {
            std::cerr << status.error_code() << ": " << status.error_message() << std::endl;
            return 0;
        }
    }

    int64_t Overwrite(const std::string &session_id, int64_t offset, const std::string &str) const {
        ChangeRequest request;
        ChangeResponse response;
        ClientContext context;

        request.mutable_session_id()->set_id(session_id);
        request.set_kind(ChangeKind::CHANGE_OVERWRITE);
        request.set_offset(offset);
        request.set_length(str.length());
        request.set_data(str);

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->SubmitChange(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::lock_guard<std::mutex> lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock<std::mutex> lock(mu);
        while (!done) { cv.wait(lock); }

        if (status.ok()) {
            return response.serial();
        } else {
            std::cerr << status.error_code() << ": " << status.error_message() << std::endl;
            return 0;
        }
    }

    int64_t Delete(const std::string &session_id, int64_t offset, int64_t length) const {
        ChangeRequest request;
        ChangeResponse response;
        ClientContext context;

        request.mutable_session_id()->set_id(session_id);
        request.set_kind(ChangeKind::CHANGE_DELETE);
        request.set_offset(offset);
        request.set_length(length);

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->SubmitChange(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::lock_guard<std::mutex> lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock<std::mutex> lock(mu);
        while (!done) { cv.wait(lock); }

        if (status.ok()) {
            return response.serial();
        } else {
            std::cerr << status.error_code() << ": " << status.error_message() << std::endl;
            return 0;
        }
    }

    std::string SaveSession(const std::string &session_id, const std::string &file_path) const {
            SaveSessionRequest request;
            SaveSessionResponse response;
            ClientContext context;

            request.mutable_session_id()->set_id(session_id);
            request.set_file_path(file_path);

            std::mutex mu;
            std::condition_variable cv;
            bool done = false;
            Status status;
            stub_->async()->SaveSession(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
                status = std::move(s);
                std::lock_guard<std::mutex> lock(mu);
                done = true;
                cv.notify_one();
            });

            std::unique_lock<std::mutex> lock(mu);
            while (!done) { cv.wait(lock); }

            if (status.ok()) {
                return response.file_path();
            } else {
                std::cerr << status.error_code() << ": " << status.error_message() << std::endl;
                return "RPC failed";
            }
    }

    std::string DestroySession(const std::string &session_id) const {
        ObjectId request;
        ObjectId response;
        ClientContext context;

        request.set_id(session_id);

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->DestroySession(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::lock_guard<std::mutex> lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock<std::mutex> lock(mu);
        while (!done) { cv.wait(lock); }

        if (status.ok()) {
            return response.id();
        } else {
            std::cerr << status.error_code() << ": " << status.error_message() << std::endl;
            return "RPC failed";
        }
    }

private:
    std::unique_ptr<Editor::Stub> stub_;
};

int main(int argc, char **argv) {
    // Instantiate the client. It requires a channel, out of which the actual RPCs are created. This channel models a
    // connection to an endpoint specified by the argument "--target=" which is the only expected argument.
    // We indicate that the channel isn't authenticated (use of InsecureChannelCredentials()).
    std::string target_str = "localhost:50042";
    if (argc > 1) {
        const std::string arg_val = argv[1];
        const std::string arg_str("--target");
        size_t start_pos = arg_val.find(arg_str);
        if (start_pos != std::string::npos) {
            start_pos += arg_str.size();
            if (arg_val[start_pos] == '=') {
                target_str = arg_val.substr(start_pos + 1);
            } else {
                std::cout << "The only correct argument syntax is --target=" << std::endl;
                return EXIT_FAILURE;
            }
        } else {
            std::cout << "The only acceptable argument is --target=" << std::endl;
            return EXIT_FAILURE;
        }
    }
    OmegaEditServiceClient server_test_client(grpc::CreateChannel(target_str, grpc::InsecureChannelCredentials()));
    auto reply = server_test_client.GetOmegaEditVersion();
    std::cout << "OmegaEditVersion received: " << reply << std::endl;

    auto session_id = server_test_client.CreateSession();
    std::cout << "CreateSession received: " << session_id << std::endl;
    auto serial = server_test_client.Insert(session_id, 0, "Hello Weird!!!!");
    std::cout << "Insert received: " << serial << std::endl;
    serial = server_test_client.Overwrite(session_id, 7, "orl");
    std::cout << "Overwrite received: " << serial << std::endl;
    serial = server_test_client.Delete(session_id, 11, 3);
    std::cout << "Delete received: " << serial << std::endl;
    reply = server_test_client.SaveSession(session_id, "/tmp/server_test.txt");
    std::cout << "SaveSession received: " << reply << std::endl;
    reply = server_test_client.DestroySession(session_id);
    std::cout << "DestroySession received: " << reply << std::endl;

    return EXIT_SUCCESS;
}