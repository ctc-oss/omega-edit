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

#include "../../include/omega_edit/config.h"
#include "../../include/omega_edit/fwd_defs.h"
#include "../../lib/impl_/macros.h"
#include "omega_edit.grpc.pb.h"
#include <condition_variable>
#include <csignal>
#include <filesystem>
#include <grpcpp/grpcpp.h>
#include <sstream>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

using grpc::Channel;
using grpc::ClientContext;
using grpc::ClientReader;
using grpc::Status;

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
using omega_edit::Editor;
using omega_edit::ObjectId;
using omega_edit::SaveSessionRequest;
using omega_edit::SaveSessionResponse;
using omega_edit::SearchRequest;
using omega_edit::SearchResponse;
using omega_edit::SegmentRequest;
using omega_edit::SegmentResponse;
using omega_edit::SessionCountResponse;
using omega_edit::VersionResponse;
using omega_edit::ViewportDataRequest;
using omega_edit::ViewportDataResponse;
using omega_edit::ViewportEvent;
using omega_edit::ViewportEventKind;

std::mutex write_mutex;

#ifdef OMEGA_BUILD_UNIX
pid_t spawn_process(const char *program, char **arg_list) {
    pid_t ch_pid = fork();
    if (ch_pid == -1) {
        perror("fork");
        exit(EXIT_FAILURE);
    } else if (ch_pid == 0) {
        execve(program, arg_list, nullptr);
        perror("execve");
        exit(EXIT_FAILURE);
    }
    assert(0 < ch_pid);
    return ch_pid;
}
#else
#include <tchar.h>
#include <windows.h>

void spawn_widows_process(PROCESS_INFORMATION &pi, TCHAR *cmd) {
    STARTUPINFO si;

    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    // Start the child process.
    if (!CreateProcess(NULL, // No module name (use command line)
                       cmd,  // Command line
                       NULL, // Process handle not inheritable
                       NULL, // Thread handle not inheritable
                       FALSE,// Set handle inheritance to FALSE
                       0,    // No creation flags
                       NULL, // Use parent's environment block
                       NULL, // Use parent's starting directory
                       &si,  // Pointer to STARTUPINFO structure
                       &pi)  // Pointer to PROCESS_INFORMATION structure
    ) {
        DBG(CLOG << LOCATION << "CreateProcess failed: " << GetLastError() << std::endl;);
        return;
    }
}
#endif

class OmegaEditServiceClient final {
public:
    explicit OmegaEditServiceClient(const std::shared_ptr<Channel> &channel) : stub_(Editor::NewStub(channel)) {
        assert(channel);
        assert(stub_);
    };

    ~OmegaEditServiceClient() {
        while (!viewport_subscription_handler_threads_.empty()) {
            viewport_subscription_handler_threads_.back()->join();
            viewport_subscription_handler_threads_.pop_back();
        }
    }

    [[nodiscard]] std::string GetOmegaEditVersion() const {
        VersionResponse response;
        google::protobuf::Empty request;
        ClientContext context;

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->GetVersion(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            std::stringstream ss;
            ss << response.major() << "." << response.minor() << "." << response.patch();
            return ss.str();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    std::string CreateSession(const std::string *file_path = nullptr,
                              const std::string *session_id_desired = nullptr) const {
        CreateSessionRequest request;
        CreateSessionResponse response;
        ClientContext context;

        if (file_path) { request.set_file_path(*file_path); }
        if (session_id_desired) { request.set_session_id_desired(*session_id_desired); }
        request.set_event_interest(ALL_EVENTS);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->CreateSession(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            auto session_id = response.session_id();
            assert(!session_id.empty());
            return session_id;
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    [[nodiscard]] int64_t Insert(const std::string &session_id, int64_t offset, const std::string &str) const {
        assert(!session_id.empty());
        ChangeRequest request;
        ChangeResponse response;
        ClientContext context;

        request.set_session_id(session_id);
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
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.serial();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return 0;
        }
    }

    [[nodiscard]] int64_t Overwrite(const std::string &session_id, int64_t offset, const std::string &str) const {
        assert(!session_id.empty());
        ChangeRequest request;
        ChangeResponse response;
        ClientContext context;

        request.set_session_id(session_id);
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
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.serial();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return 0;
        }
    }

    [[nodiscard]] int64_t Delete(const std::string &session_id, int64_t offset, int64_t length) const {
        assert(!session_id.empty());
        ChangeRequest request;
        ChangeResponse response;
        ClientContext context;

        request.set_session_id(session_id);
        request.set_kind(ChangeKind::CHANGE_DELETE);
        request.set_offset(offset);
        request.set_length(length);

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->SubmitChange(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.serial();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return 0;
        }
    }

    [[nodiscard]] int64_t Undo(const std::string &session_id) const {
        assert(!session_id.empty());
        ObjectId request;
        ChangeResponse response;
        ClientContext context;

        request.set_id(session_id);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->UndoLastChange(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.serial();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return 0;
        }
    }

    [[nodiscard]] int64_t Redo(const std::string &session_id) const {
        assert(!session_id.empty());
        ObjectId request;
        ChangeResponse response;
        ClientContext context;

        request.set_id(session_id);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->RedoLastUndo(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.serial();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return 0;
        }
    }

    [[nodiscard]] std::string Clear(const std::string &session_id) const {
        assert(!session_id.empty());
        ObjectId request;
        ObjectId response;
        ClientContext context;

        request.set_id(session_id);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->ClearChanges(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.id();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    [[nodiscard]] std::string PauseSessionChanges(const std::string &session_id) const {
        assert(!session_id.empty());
        ObjectId request;
        ObjectId response;
        ClientContext context;

        request.set_id(session_id);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->PauseSessionChanges(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.id();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    [[nodiscard]] std::string ResumeSessionChanges(const std::string &session_id) const {
        assert(!session_id.empty());
        ObjectId request;
        ObjectId response;
        ClientContext context;

        request.set_id(session_id);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->ResumeSessionChanges(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.id();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    [[nodiscard]] std::string PauseViewportEvents(const std::string &session_id) const {
        assert(!session_id.empty());
        ObjectId request;
        ObjectId response;
        ClientContext context;

        request.set_id(session_id);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->PauseViewportEvents(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.id();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    [[nodiscard]] std::string ResumeViewportEvents(const std::string &session_id) const {
        assert(!session_id.empty());
        ObjectId request;
        ObjectId response;
        ClientContext context;

        request.set_id(session_id);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->ResumeViewportEvents(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.id();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    [[nodiscard]] std::string SaveSession(const std::string &session_id, const std::string &file_path,
                                          bool allow_overwrite) const {
        assert(!session_id.empty());
        assert(!file_path.empty());
        SaveSessionRequest request;
        SaveSessionResponse response;
        ClientContext context;

        request.set_session_id(session_id);
        request.set_file_path(file_path);
        request.set_allow_overwrite(allow_overwrite);

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->SaveSession(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.file_path();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    [[nodiscard]] std::string DestroySession(const std::string &session_id) const {
        assert(!session_id.empty());
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
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.id();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    std::string CreateViewport(const std::string &session_id, int64_t offset, int64_t capacity, bool is_floating,
                               const std::string *viewport_id_desired = nullptr) const {
        assert(!session_id.empty());
        CreateViewportRequest request;
        CreateViewportResponse response;
        ClientContext context;

        request.set_session_id(session_id);
        request.set_offset(offset);
        request.set_capacity(capacity);
        request.set_is_floating(is_floating);
        request.set_event_interest(ALL_EVENTS);
        if (viewport_id_desired) { request.set_viewport_id_desired(*viewport_id_desired); }

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->CreateViewport(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            auto viewport_1_id = response.viewport_id();
            assert(!viewport_1_id.empty());
            return viewport_1_id;
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    [[nodiscard]] std::string GetViewportData(const std::string &viewport_id) const {
        assert(!viewport_id.empty());
        ViewportDataRequest request;
        ViewportDataResponse response;
        ClientContext context;

        request.set_viewport_id(viewport_id);

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->GetViewportData(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.data();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    [[nodiscard]] std::string DestroyViewport(const std::string &viewport_id) const {
        assert(!viewport_id.empty());
        ObjectId request;
        ObjectId response;
        ClientContext context;

        request.set_id(viewport_id);

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->DestroyViewport(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.id();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "RPC failed";
        }
    }

    int GetLastChange(const std::string &session_id, ChangeDetailsResponse &response) const {
        assert(!session_id.empty());
        ObjectId request;
        ClientContext context;

        request.set_id(session_id);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->GetLastChange(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return 0;
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return -1;
        }
    }

    int GetLastUndo(const std::string &session_id, ChangeDetailsResponse &response) const {
        assert(!session_id.empty());
        ObjectId request;
        ClientContext context;

        request.set_id(session_id);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->GetLastUndo(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return 0;
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return -1;
        }
    }

    [[nodiscard]] std::string GetSegment(const std::string &session_id, int64_t offset, int64_t length) const {
        assert(!session_id.empty());
        SegmentRequest request;
        SegmentResponse response;
        ClientContext context;

        request.set_session_id(session_id);
        request.set_offset(offset);
        request.set_length(length);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->GetSegment(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.data();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return "";
        }
    }

    [[nodiscard]] int64_t GetComputedFileSize(const std::string &session_id) const {
        assert(!session_id.empty());
        ObjectId request;
        ComputedFileSizeResponse response;
        ClientContext context;

        request.set_id(session_id);
        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->GetComputedFileSize(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.computed_file_size();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return -1;
        }
    }

    [[nodiscard]] int64_t GetCount(const std::string &session_id, CountKind count_kind) const {
        assert(!session_id.empty());
        CountRequest request;
        CountResponse response;
        ClientContext context;

        request.set_session_id(session_id);
        request.set_kind(count_kind);

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->GetCount(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.count();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return -1;
        }
    }

    [[nodiscard]] int64_t GetSessionCount() const {
        google::protobuf::Empty request;
        SessionCountResponse response;
        ClientContext context;

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->GetSessionCount(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });

        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            return response.count();
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return -1;
        }
    }

    int SearchSession(const std::string &session_id, const std::string &pattern, bool is_case_insensitive,
                      int64_t offset, int64_t length, int64_t limit, std::vector<int64_t> &match_offset) {
        assert(!session_id.empty());
        SearchRequest request;
        SearchResponse response;
        ClientContext context;

        request.set_session_id(session_id);
        request.set_pattern(pattern);
        request.set_is_case_insensitive(is_case_insensitive);
        request.set_offset(offset);
        request.set_length(length);
        if (limit) { request.set_limit(limit); }

        std::mutex mu;
        std::condition_variable cv;
        bool done = false;
        Status status;
        stub_->async()->SearchSession(&context, &request, &response, [&mu, &cv, &done, &status](Status s) {
            status = std::move(s);
            std::scoped_lock lock(mu);
            done = true;
            cv.notify_one();
        });
        std::unique_lock lock(mu);
        cv.wait(lock, [&done] { return done; });

        if (status.ok()) {
            const auto num_matches = response.match_offset_size();
            match_offset.reserve(num_matches);
            for (int i = 0; i < num_matches; ++i) { match_offset.push_back(response.match_offset(i)); }
            return num_matches;
        } else {
            DBG(CLOG << LOCATION << status.error_code() << ": " << status.error_message() << std::endl;);
            return -1;
        }
    }

    static void HandleViewportChanges(std::unique_ptr<ClientContext> context_ptr,
                                      std::unique_ptr<ClientReader<ViewportEvent>> reader_ptr) {
        assert(reader_ptr);
        (void) context_ptr;// Though we're not using the context pointer, we need to manage its lifecycle in this scope.
        ViewportEvent viewport_event;
        reader_ptr->WaitForInitialMetadata();
        while (reader_ptr->Read(&viewport_event)) {
            auto const &session_id = viewport_event.session_id();
            assert(!session_id.empty());
            auto const &viewport_id = viewport_event.viewport_id();
            assert(!viewport_id.empty());
            const std::scoped_lock write_lock(write_mutex);
            if (viewport_event.has_serial()) {
                DBG(CLOG << LOCATION << "session id: " << session_id << ", viewport id: " << viewport_id
                         << ", event kind: " << viewport_event.viewport_event_kind()
                         << ", change serial: " << viewport_event.serial() << ", offset: " << viewport_event.offset()
                         << ", length: " << viewport_event.length() << ", data: [" << viewport_event.data() << "]"
                         << std::endl;);
            } else {
                DBG(CLOG << LOCATION << "viewport id: " << viewport_id
                         << ", event kind: " << viewport_event.viewport_event_kind() << std::endl;);
                if (ViewportEventKind::VIEWPORT_EVT_CREATE == viewport_event.viewport_event_kind()) {
                    DBG(CLOG << LOCATION << "viewport id: " << viewport_id << " finishing" << std::endl;);
                    reader_ptr->Finish();
                    break;
                }
            }
        }
    }

    std::thread::id SubscribeOnChangeViewport(const std::string &viewport_id) {
        assert(!viewport_id.empty());
        ObjectId request;
        auto context_ptr = std::make_unique<ClientContext>();

        request.set_id(viewport_id);

        viewport_subscription_handler_threads_.push_back(std::make_unique<std::thread>(
                std::thread(&OmegaEditServiceClient::HandleViewportChanges, std::move(context_ptr),
                            stub_->SubscribeToViewportEvents(context_ptr.get(), request))));
        return viewport_subscription_handler_threads_.back()->get_id();
    }

private:
    std::unique_ptr<Editor::Stub> stub_;
    std::vector<std::unique_ptr<std::thread>> viewport_subscription_handler_threads_;
};

void run_tests(const std::string &target_str, int repetitions, bool log) {
    const int64_t vpt_capacity = 5;
    fs::remove_all(fs::current_path() / "server_test_out");
    OmegaEditServiceClient server_test_client(grpc::CreateChannel(target_str, grpc::InsecureChannelCredentials()));
    while (repetitions--) {
        if (log) {
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] Establishing a channel to Ωedit server on: " << target_str << std::endl;);
        }
        //OmegaEditServiceClient server_test_client(grpc::CreateChannel(target_str, grpc::InsecureChannelCredentials()));

        auto reply = server_test_client.GetOmegaEditVersion();
        if (log) {
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Channel established to Ωedit server version: "
                     << reply << " on " << target_str << std::endl;);
        }

        const std::string session_id("session-1");
        reply = server_test_client.CreateSession(nullptr, &session_id);
        assert(session_id == reply);
        if (log)
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] CreateSession received: " << session_id
                     << std::endl;);

        const std::string viewport_0_id = session_id + "~viewport-0";
        reply = server_test_client.CreateViewport(session_id, 0, 64, false, &viewport_0_id);
        assert(viewport_0_id == reply);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] CreateViewport received: " << viewport_0_id
                     << std::endl;);
        }

        auto thread_0_id = server_test_client.SubscribeOnChangeViewport(viewport_0_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] SubscribeOnChangeViewport received: " << thread_0_id << std::endl;);
        }

        const std::string viewport_1_id = session_id + "~viewport-1";
        reply = server_test_client.CreateViewport(session_id, 0 * vpt_capacity, vpt_capacity, false, &viewport_1_id);
        assert(viewport_1_id == reply);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] CreateViewport received: " << viewport_1_id
                     << std::endl;);
        }

        auto thread_1_id = server_test_client.SubscribeOnChangeViewport(viewport_1_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] SubscribeOnChangeViewport received: " << thread_1_id << std::endl;);
        }

        const std::string viewport_2_id = session_id + "~viewport-2";
        reply = server_test_client.CreateViewport(session_id, 1 * vpt_capacity, vpt_capacity, false, &viewport_2_id);
        assert(viewport_2_id == reply);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] CreateViewport received: " << viewport_2_id
                     << std::endl;);
        }

        auto thread_2_id = server_test_client.SubscribeOnChangeViewport(viewport_2_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] SubscribeOnChangeViewport received: " << thread_2_id << std::endl;);
        }

        const std::string viewport_3_id = session_id + "~viewport-3";
        reply = server_test_client.CreateViewport(session_id, 2 * vpt_capacity, vpt_capacity, false, &viewport_3_id);
        assert(viewport_3_id == reply);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] CreateViewport received: " << viewport_3_id
                     << std::endl;);
        }

        auto thread_3_id = server_test_client.SubscribeOnChangeViewport(viewport_3_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] SubscribeOnChangeViewport received: " << thread_3_id << std::endl;);
        }

        auto serial = server_test_client.Insert(session_id, 0, "Hello Weird!!!!");
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Insert received: " << serial << std::endl;);
        }

        auto segment = server_test_client.GetSegment(session_id, 0, 32);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] GetSegment received length: " << segment.length() << ", data: " << segment << std::endl;);
        }
        assert(segment.length() == 15);
        assert(segment == "Hello Weird!!!!");

        ChangeDetailsResponse change_details;
        auto rc = server_test_client.GetLastChange(session_id, change_details);
        assert(0 == rc);
        assert(serial == change_details.serial());
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] GetLastChange received: " << rc
                     << " serial: " << change_details.serial() << std::endl;);
        }

        serial = server_test_client.Undo(session_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Undo received: " << serial << std::endl;);
        }

        rc = server_test_client.GetLastUndo(session_id, change_details);
        assert(0 == rc);
        assert(serial == change_details.serial());
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] GetLastUndo received: " << rc
                     << " serial: " << change_details.serial() << std::endl;);
        }

        serial = server_test_client.Redo(session_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Redo received: " << serial << std::endl;);
        }

        reply = server_test_client.PauseViewportEvents(session_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] PauseViewportEvents received: " << reply
                     << std::endl;);
        }

        reply = server_test_client.Clear(session_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Clear received: " << reply << std::endl;);
        }

        serial = server_test_client.Insert(session_id, 0, "Hello Weird!!!!");
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Insert received: " << serial << std::endl;);
        }

        reply = server_test_client.ResumeViewportEvents(session_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] ResumeViewportEvents received: " << reply
                     << std::endl;);
        }

        auto match_offsets = std::vector<int64_t>();
        auto num_matches = server_test_client.SearchSession(session_id, "weird", true, 0, 0, 0, match_offsets);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] SearchSession received: " << num_matches
                     << std::endl;);
        }

        auto count = server_test_client.GetCount(session_id, CountKind::COUNT_SEARCH_CONTEXTS);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] GetCount(CountKind::COUNT_SEARCH_CONTEXTS) received: " << count << std::endl;);
        }
        assert(0 == count);

        serial = server_test_client.Overwrite(session_id, 7, "orl");
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Overwrite received: " << serial << std::endl;);
        }

        serial = server_test_client.Delete(session_id, 11, 3);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Delete received: " << serial << std::endl;);
        }

        auto computed_file_size = server_test_client.GetComputedFileSize(session_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] GetComputedFileSize received: " << computed_file_size << std::endl;);
        }

        auto save_file = fs::current_path() / "server_test_out" / "hello-rpc.txt";
        reply = server_test_client.SaveSession(session_id, save_file.string(), true);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] SaveSession received: " << reply << std::endl;);
        }

        count = server_test_client.GetSessionCount();
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] GetSessionCount received: " << count
                     << std::endl;);
        }

        count = server_test_client.GetCount(session_id, CountKind::COUNT_FILE_SIZE);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] GetCount(CountKind::COUNT_FILE_SIZE) received: " << count << std::endl;);
        }
        assert(computed_file_size == count);

        count = server_test_client.GetCount(session_id, CountKind::COUNT_CHANGES);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] GetCount(CountKind::COUNT_CHANGES) received: " << count << std::endl;);
        }

        count = server_test_client.GetCount(session_id, CountKind::COUNT_UNDOS);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] GetCount(CountKind::COUNT_UNDOS) received: " << count << std::endl;);
        }

        count = server_test_client.GetCount(session_id, CountKind::COUNT_VIEWPORTS);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] GetCount(CountKind::COUNT_VIEWPORTS) received: " << count << std::endl;);
        }

        count = server_test_client.GetCount(session_id, CountKind::COUNT_CHECKPOINTS);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] GetCount(CountKind::COUNT_CHECKPOINTS) received: " << count << std::endl;);
        }

        segment = server_test_client.GetSegment(session_id, 0, 32);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions
                     << "] GetSegment received length: " << segment.length() << ", data: " << segment << std::endl;);
        }
        assert(segment.length() == 12);
        assert(segment == "Hello World!");

        reply = server_test_client.SaveSession(session_id, save_file.string(), false);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] SaveSession received: " << reply << std::endl;);
        }

        reply = server_test_client.GetViewportData(viewport_0_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Viewport 0 data: [" << reply << "]"
                     << std::endl;);
        }

        reply = server_test_client.GetViewportData(viewport_1_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Viewport 1 data: [" << reply << "]"
                     << std::endl;);
        }

        reply = server_test_client.DestroyViewport(viewport_1_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] DestroyViewport 1 received: " << reply
                     << std::endl;);
        }

        reply = server_test_client.GetViewportData(viewport_2_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Viewport 2 data: [" << reply << "]"
                     << std::endl;);
        }

        reply = server_test_client.DestroyViewport(viewport_2_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] DestroyViewport 2 received: " << reply
                     << std::endl;);
        }

        reply = server_test_client.GetViewportData(viewport_3_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] Viewport 3 data: [" << reply << "]"
                     << std::endl;);
        }

        reply = server_test_client.DestroyViewport(viewport_3_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] DestroyViewport 3 received: " << reply
                     << std::endl;);
        }

        reply = server_test_client.DestroyViewport(viewport_0_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] DestroyViewport 0 received: " << reply
                     << std::endl;);
        }

        reply = server_test_client.DestroySession(session_id);
        if (log) {
            const std::scoped_lock write_lock(write_mutex);
            DBG(CLOG << LOCATION << "[Remaining: " << repetitions << "] DestroySession received: " << reply
                     << std::endl;);
        }
    }
}

int main(int argc, char **argv) {
    // Instantiate the client. It requires a channel, out of which the actual RPCs are created. This channel models a
    // connection to an endpoint specified by the argument "--target=" which is the only expected argument.
    // We indicate that the channel isn't authenticated (use of InsecureChannelCredentials()).

    // Client can connect to HTTP2 or Unix Domain Sockets (on compatible OSes)
#ifdef OMEGA_BUILD_UNIX
    std::string target_str("unix:///tmp/omega_edit.sock");
#else
    std::string target_str("localhost:50042");
#endif

    if (argc > 1) {
        const std::string arg_val = argv[1];
        const std::string arg_str("--target");
        size_t start_pos = arg_val.find(arg_str);
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
    // change current working path to that of this executable
    fs::current_path(fs::path(argv[0]).parent_path());
    bool run_server = true;
#ifdef OMEGA_BUILD_UNIX
    pid_t server_pid = 0;
#else
    PROCESS_INFORMATION pi;
#endif
    if (run_server) {
        const auto server_program = fs::current_path() / "server";
        const auto target = std::string("--target=") + target_str;
#ifdef OMEGA_BUILD_UNIX
        char *arg_list[] = {(char *) server_program.c_str(), (char *) target.c_str(), nullptr};
        server_pid = spawn_process(server_program.c_str(), arg_list);
        DBG(CLOG << LOCATION << "Ωedit " << server_program << " pid: " << server_pid << std::endl;);
        // TODO: Check to see if the server is up and serving instead of using sleep
        sleep(2);// sleep 2 seconds for the server to come online
#else
        auto cmd = server_program.string() + " " + "--target=" + target_str + ".exe";
        spawn_widows_process(pi, (TCHAR *) cmd.c_str());
#endif
    }

    run_tests(target_str, 99, true);
    if (run_server) {
#ifdef OMEGA_BUILD_UNIX
        kill(server_pid, SIGTERM);
#else
        // Wait until child process exits.
        TerminateProcess(pi.hProcess, 0);

        // Close process and thread handles.
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
#endif
    }
    return EXIT_SUCCESS;
}
