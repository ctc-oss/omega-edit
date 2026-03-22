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
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <atomic>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
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

/// Parse a string as an integer in [min_val, max_val], writing the result to out.
/// Returns true on success; on failure prints a message to stderr and returns false.
static bool parse_int(const std::string &str, const std::string &name, long min_val, long max_val, int &out) {
    try {
        size_t pos = 0;
        long v = std::stol(str, &pos);
        if (pos != str.size()) {
            std::cerr << "Error: " << name << " must be a valid integer, got: " << str << "\n";
            return false;
        }
        if (v < min_val || v > max_val) {
            std::cerr << "Error: " << name << " must be between " << min_val << " and " << max_val
                      << ", got: " << v << "\n";
            return false;
        }
        out = static_cast<int>(v);
        return true;
    } catch (const std::exception &) {
        std::cerr << "Error: " << name << " must be a valid integer, got: " << str << "\n";
        return false;
    }
}

/// Parse a string as an int64 in [min_val, max_val], writing the result to out.
/// Returns true on success; on failure prints a message to stderr and returns false.
static bool parse_int64(const std::string &str, const std::string &name, int64_t min_val, int64_t max_val,
                        int64_t &out) {
    try {
        size_t pos = 0;
        long long v = std::stoll(str, &pos);
        if (pos != str.size()) {
            std::cerr << "Error: " << name << " must be a valid integer, got: " << str << "\n";
            return false;
        }
        if (v < min_val || v > max_val) {
            std::cerr << "Error: " << name << " must be between " << min_val << " and " << max_val
                      << ", got: " << v << "\n";
            return false;
        }
        out = static_cast<int64_t>(v);
        return true;
    } catch (const std::exception &) {
        std::cerr << "Error: " << name << " must be a valid integer, got: " << str << "\n";
        return false;
    }
}

/// Parse a string as a size_t in [min_val, max_val], writing the result to out.
/// Returns true on success; on failure prints a message to stderr and returns false.
static bool parse_size_t(const std::string &str, const std::string &name, size_t min_val, size_t max_val,
                         size_t &out) {
    try {
        size_t pos = 0;
        unsigned long long v = std::stoull(str, &pos);
        if (pos != str.size()) {
            std::cerr << "Error: " << name << " must be a valid integer, got: " << str << "\n";
            return false;
        }
        if (v < min_val || v > max_val) {
            std::cerr << "Error: " << name << " must be between " << min_val << " and " << max_val
                      << ", got: " << v << "\n";
            return false;
        }
        out = static_cast<size_t>(v);
        return true;
    } catch (const std::exception &) {
        std::cerr << "Error: " << name << " must be a valid integer, got: " << str << "\n";
        return false;
    }
}

static void print_usage(const char *progname) {
    std::cerr << "Ωedit gRPC server (C++ middleware)\n"
              << "Usage: " << progname << " [OPTIONS]\n"
              << "\nConnection options:\n"
              << "  -i, --interface <addr>           Bind address (default: 127.0.0.1)\n"
              << "  -p, --port <port>                Listen port (default: 9000)\n"
              << "  -f, --pidfile <path>             Write PID to file\n"
              << "  -u, --unix-socket <path>         Unix domain socket path (Linux/macOS only)\n"
              << "      --unix-socket-only           Bind only to Unix domain socket\n"
              << "\nHeartbeat / session-reaping options:\n"
              << "      --session-timeout <ms>       Idle session timeout in milliseconds (0 = disabled)\n"
              << "      --cleanup-interval <ms>      Reaper sweep interval in milliseconds (0 = disabled)\n"
              << "      --shutdown-when-no-sessions  Exit after the last session is reaped\n"
              << "\nResource limit options:\n"
              << "      --session-event-queue-capacity <count>\n"
              << "                                   Cap buffered session events per subscription (0 = unbounded)\n"
              << "      --viewport-event-queue-capacity <count>\n"
              << "                                   Cap buffered viewport events per subscription (0 = unbounded)\n"
              << "      --max-change-bytes <bytes>   Limit insert/overwrite payload size (0 = unbounded)\n"
              << "      --max-viewports-per-session <count>\n"
              << "                                   Limit concurrently open viewports per session (0 = unbounded)\n"
              << "\nGeneral:\n"
              << "  -h, --help                       Show this help\n"
              << "  -v, --version                    Show version\n";
}

int main(int argc, char **argv) {
    std::string interface_addr = "127.0.0.1";
    int port = 9000;
    std::string pidfile;
    std::string unix_socket;
    bool unix_socket_only = false;

    // Heartbeat / session-reaping defaults (0 = disabled)
    int session_timeout_ms = 0;
    int cleanup_interval_ms = 0;
    bool shutdown_when_no_sessions = false;
    omega_edit::grpc_server::ResourceLimits resource_limits;
    size_t session_event_queue_capacity = resource_limits.session_event_queue_capacity;
    size_t viewport_event_queue_capacity = resource_limits.viewport_event_queue_capacity;
    int64_t max_change_bytes = resource_limits.max_change_bytes;
    size_t max_viewports_per_session = resource_limits.max_viewports_per_session;
    // Environment variable defaults
    if (const char *env = std::getenv("OMEGA_EDIT_SERVER_HOST")) {
        interface_addr = env;
    }
    if (const char *env = std::getenv("OMEGA_EDIT_SERVER_PORT")) {
        if (!parse_int(env, "OMEGA_EDIT_SERVER_PORT", 1, 65535, port)) return 1;
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

    // Native heartbeat environment variables
    if (const char *env = std::getenv("OMEGA_EDIT_SESSION_TIMEOUT_MS")) {
        if (!parse_int(env, "OMEGA_EDIT_SESSION_TIMEOUT_MS", 0, INT_MAX, session_timeout_ms)) return 1;
    }
    if (const char *env = std::getenv("OMEGA_EDIT_CLEANUP_INTERVAL_MS")) {
        if (!parse_int(env, "OMEGA_EDIT_CLEANUP_INTERVAL_MS", 0, INT_MAX, cleanup_interval_ms)) return 1;
    }
    if (const char *env = std::getenv("OMEGA_EDIT_SHUTDOWN_WHEN_NO_SESSIONS")) {
        std::string val(env);
        shutdown_when_no_sessions = (val == "true" || val == "1");
    }
    if (const char *env = std::getenv("OMEGA_EDIT_SESSION_EVENT_QUEUE_CAPACITY")) {
        if (!parse_size_t(env, "OMEGA_EDIT_SESSION_EVENT_QUEUE_CAPACITY", 0, std::numeric_limits<size_t>::max(),
                       session_event_queue_capacity)) return 1;
    }
    if (const char *env = std::getenv("OMEGA_EDIT_VIEWPORT_EVENT_QUEUE_CAPACITY")) {
        if (!parse_size_t(env, "OMEGA_EDIT_VIEWPORT_EVENT_QUEUE_CAPACITY", 0, std::numeric_limits<size_t>::max(),
                       viewport_event_queue_capacity)) return 1;
    }
    if (const char *env = std::getenv("OMEGA_EDIT_MAX_CHANGE_BYTES")) {
        if (!parse_int64(env, "OMEGA_EDIT_MAX_CHANGE_BYTES", 0, std::numeric_limits<int64_t>::max(),
                         max_change_bytes)) return 1;
    }
    if (const char *env = std::getenv("OMEGA_EDIT_MAX_VIEWPORTS_PER_SESSION")) {
        if (!parse_size_t(env, "OMEGA_EDIT_MAX_VIEWPORTS_PER_SESSION", 0, std::numeric_limits<size_t>::max(),
                       max_viewports_per_session)) return 1;
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
        } else if (arg == "--shutdown-when-no-sessions") {
            shutdown_when_no_sessions = true;
        } else {
            // Handle --key=value and --key value forms
            std::string key, value;
            auto eq_pos = arg.find('=');
            if (eq_pos != std::string::npos) {
                key = arg.substr(0, eq_pos);
                value = arg.substr(eq_pos + 1);
            } else {
                key = arg;
                // Only consume the next argument as a value if it exists and doesn't look like a flag
                if (i + 1 < argc && argv[i + 1][0] != '-') {
                    value = argv[++i];
                }
            }

            if (key == "-i" || key == "--interface") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                interface_addr = value;
            } else if (key == "-p" || key == "--port") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                if (!parse_int(value, "--port", 1, 65535, port)) return 1;
            } else if (key == "-f" || key == "--pidfile") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                pidfile = value;
            } else if (key == "-u" || key == "--unix-socket") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                unix_socket = value;
            } else if (key == "--session-timeout") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                if (!parse_int(value, "--session-timeout", 0, INT_MAX, session_timeout_ms)) return 1;
            } else if (key == "--cleanup-interval") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                if (!parse_int(value, "--cleanup-interval", 0, INT_MAX, cleanup_interval_ms)) return 1;
            } else if (key == "--session-event-queue-capacity") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                if (!parse_size_t(value, "--session-event-queue-capacity", 0, std::numeric_limits<size_t>::max(),
                               session_event_queue_capacity)) return 1;
            } else if (key == "--viewport-event-queue-capacity") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                if (!parse_size_t(value, "--viewport-event-queue-capacity", 0, std::numeric_limits<size_t>::max(),
                               viewport_event_queue_capacity)) return 1;
            } else if (key == "--max-change-bytes") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                if (!parse_int64(value, "--max-change-bytes", 0, std::numeric_limits<int64_t>::max(),
                                 max_change_bytes)) return 1;
            } else if (key == "--max-viewports-per-session") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                if (!parse_size_t(value, "--max-viewports-per-session", 0, std::numeric_limits<size_t>::max(),
                               max_viewports_per_session)) return 1;
            }
            // Silently ignore unknown options.
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

    // Build heartbeat config from CLI flags and OMEGA_EDIT_* environment variables.
    omega_edit::grpc_server::HeartbeatConfig heartbeat_config;
    heartbeat_config.session_timeout = std::chrono::milliseconds(session_timeout_ms);
    heartbeat_config.cleanup_interval = std::chrono::milliseconds(cleanup_interval_ms);
    heartbeat_config.shutdown_when_no_sessions = shutdown_when_no_sessions;
    resource_limits.session_event_queue_capacity = session_event_queue_capacity;
    resource_limits.viewport_event_queue_capacity = viewport_event_queue_capacity;
    resource_limits.max_change_bytes = max_change_bytes;
    resource_limits.max_viewports_per_session = max_viewports_per_session;

    // Create service with shutdown callback that requests shutdown via the monitor thread
    auto shutdown_callback = []() {
        // Set the shutdown flag so the monitor thread exits cleanly and shuts down the server
        g_shutdown_requested.store(true, std::memory_order_relaxed);
    };
    omega_edit::grpc_server::EditorServiceImpl service(heartbeat_config, resource_limits, shutdown_callback);

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
