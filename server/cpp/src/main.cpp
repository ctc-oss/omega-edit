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

#ifdef HAS_GRPC_REFLECTION
#include <grpcpp/ext/proto_server_reflection_plugin.h>
#endif
#include <grpcpp/grpcpp.h>
#include <grpcpp/health_check_service_interface.h>

#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <atomic>
#include <fstream>
#include <iostream>
#include <regex>
#include <string>
#include <thread>

#ifdef _WIN32
#include <process.h>
#define getpid _getpid
#else
#include <unistd.h>
#endif

static std::unique_ptr<grpc::Server> g_server;
static std::atomic<bool> g_shutdown_requested{false};

// Signal handler — only sets an atomic flag (async-signal-safe).
// The main thread polls this flag and performs the actual shutdown.
static void signal_handler(int /*signum*/) { g_shutdown_requested.store(true, std::memory_order_relaxed); }

static void print_usage(const char *progname) {
    std::cerr << "Ωedit gRPC server (C++ middleware)\n"
              << "Usage: " << progname << " [OPTIONS]\n"
              << "  -i, --interface <addr>   Bind address (default: 127.0.0.1)\n"
              << "  -p, --port <port>        Listen port (default: 9000)\n"
              << "  -f, --pidfile <path>     Write PID to file\n"
              << "  -u, --unix-socket <path> Unix domain socket path (Linux/macOS only)\n"
              << "      --unix-socket-only   Bind only to Unix domain socket\n"
              << "  -h, --help               Show this help\n"
              << "  -v, --version            Show version\n";
}

int main(int argc, char **argv) {
    std::string interface_addr = "127.0.0.1";
    int port = 9000;
    std::string pidfile;
    std::string unix_socket;
    bool unix_socket_only = false;

    // Environment variable defaults
    if (const char *env = std::getenv("OMEGA_EDIT_SERVER_HOST")) {
        interface_addr = env;
    }
    if (const char *env = std::getenv("OMEGA_EDIT_SERVER_PORT")) {
        port = std::atoi(env);
    }
    if (const char *env = std::getenv("OMEGA_EDIT_SERVER_UNIX_SOCKET")) {
        unix_socket = env;
    }
    if (const char *env = std::getenv("OMEGA_EDIT_SERVER_UNIX_SOCKET_ONLY")) {
        std::string val(env);
        if (val == "true" || val == "1") {
            unix_socket_only = true;
        }
    }
    if (const char *env = std::getenv("OMEGA_EDIT_SERVER_PIDFILE")) {
        pidfile = env;
    }

    // Parse command line arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "-h" || arg == "--help") {
            print_usage(argv[0]);
            return 0;
        } else if (arg == "-v" || arg == "--version") {
            std::cout << "omega-edit-grpc-server v" << SERVER_VERSION << std::endl;
            return 0;
        } else if (arg == "--unix-socket-only") {
            unix_socket_only = true;
        } else {
            // Handle --key=value and --key value forms
            std::string key, value;
            auto eq_pos = arg.find('=');
            if (eq_pos != std::string::npos) {
                key = arg.substr(0, eq_pos);
                value = arg.substr(eq_pos + 1);
            } else {
                key = arg;
                if (i + 1 < argc) {
                    value = argv[++i];
                }
            }

            if (key == "-i" || key == "--interface") {
                interface_addr = value;
            } else if (key == "-p" || key == "--port") {
                port = std::atoi(value.c_str());
            } else if (key == "-f" || key == "--pidfile") {
                pidfile = value;
            } else if (key == "-u" || key == "--unix-socket") {
                unix_socket = value;
            }
            // Silently ignore unknown options (e.g., -Dlogback.configurationFile= from Scala compat)
        }
    }

    // Write PID file
    int pid = getpid();
    if (!pidfile.empty()) {
        std::ofstream pf(pidfile);
        if (pf.is_open()) {
            pf << pid;
            pf.close();
        } else {
            std::cerr << "Warning: could not write pidfile: " << pidfile << std::endl;
        }
    }

    // Set up signal handlers
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    // Parse heartbeat configuration from JAVA_OPTS (backward compat with Scala server)
    omega_edit::grpc_server::HeartbeatConfig heartbeat_config;
    if (const char *java_opts_env = std::getenv("JAVA_OPTS")) {
        std::string java_opts(java_opts_env);

        // Parse -Domega-edit.grpc.heartbeat.session-timeout=NNNms
        std::regex timeout_re(R"(-Domega-edit\.grpc\.heartbeat\.session-timeout=(\d+)ms)");
        std::smatch m;
        if (std::regex_search(java_opts, m, timeout_re)) {
            heartbeat_config.session_timeout = std::chrono::milliseconds(std::stoi(m[1].str()));
        }

        // Parse -Domega-edit.grpc.heartbeat.cleanup-interval=NNNms
        std::regex interval_re(R"(-Domega-edit\.grpc\.heartbeat\.cleanup-interval=(\d+)ms)");
        if (std::regex_search(java_opts, m, interval_re)) {
            heartbeat_config.cleanup_interval = std::chrono::milliseconds(std::stoi(m[1].str()));
        }

        // Parse -Domega-edit.grpc.heartbeat.shutdown-when-no-sessions=true/false
        std::regex shutdown_re(R"(-Domega-edit\.grpc\.heartbeat\.shutdown-when-no-sessions=(true|false))");
        if (std::regex_search(java_opts, m, shutdown_re)) {
            heartbeat_config.shutdown_when_no_sessions = (m[1].str() == "true");
        }
    }

    // Create service with shutdown callback that stops the gRPC server
    auto shutdown_callback = []() {
        if (g_server) {
            std::thread([]() {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
                g_server->Shutdown();
            }).detach();
        }
    };
    omega_edit::grpc_server::EditorServiceImpl service(heartbeat_config, shutdown_callback);

    grpc::EnableDefaultHealthCheckService(true);
#ifdef HAS_GRPC_REFLECTION
    grpc::reflection::InitProtoReflectionServerBuilderPlugin();
#endif

    grpc::ServerBuilder builder;

    if (unix_socket_only) {
#ifdef _WIN32
        std::cerr << "Unix domain sockets are not supported on Windows" << std::endl;
        return 1;
#else
        if (unix_socket.empty()) {
            std::cerr << "--unix-socket-only requires --unix-socket" << std::endl;
            return 1;
        }
        std::string unix_addr = "unix:" + unix_socket;
        builder.AddListeningPort(unix_addr, grpc::InsecureServerCredentials());
        std::cerr << "Ωedit gRPC server (v" << SERVER_VERSION << ") with PID " << pid << " bound to " << unix_addr
                  << ": ready..." << std::endl;
#endif
    } else {
        std::string server_address = interface_addr + ":" + std::to_string(port);
        builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());
        std::cerr << "Ωedit gRPC server (v" << SERVER_VERSION << ") with PID " << pid << " bound to "
                  << server_address << ": ready..." << std::endl;

#ifndef _WIN32
        if (!unix_socket.empty()) {
            std::string unix_addr = "unix:" + unix_socket;
            builder.AddListeningPort(unix_addr, grpc::InsecureServerCredentials());
            std::cerr << "Ωedit gRPC server additionally exposed via " << unix_addr << std::endl;
        }
#endif
    }

    builder.RegisterService(&service);
    g_server = builder.BuildAndStart();

    if (!g_server) {
        std::cerr << "Failed to start server" << std::endl;
        return 1;
    }

    // Monitor shutdown flag in a background thread so the main thread can
    // block on Wait().  When the signal handler sets the flag, this thread
    // triggers a graceful shutdown.
    std::thread shutdown_monitor([&]() {
        while (!g_shutdown_requested.load(std::memory_order_relaxed)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        std::cerr << "Received shutdown signal, shutting down..." << std::endl;
        if (g_server) {
            g_server->Shutdown();
        }
    });

    g_server->Wait();
    shutdown_monitor.join();

    std::cerr << "Ωedit gRPC server (v" << SERVER_VERSION << ") with PID " << pid << ": exiting..." << std::endl;

    // Cleanup PID file
    if (!pidfile.empty()) {
        std::remove(pidfile.c_str());
    }

    return 0;
}
