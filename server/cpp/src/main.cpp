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
#include <chrono>
#include <cctype>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <mutex>
#include <regex>
#include <sstream>
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

enum class LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
};

static std::mutex g_log_mutex;
static LogLevel g_log_level = LogLevel::Info;
static std::ofstream g_log_file_stream;
static std::ostream *g_log_stream = &std::cerr;

// Signal handler — only sets an atomic flag (async-signal-safe).
// The main thread polls this flag and performs the actual shutdown.
static void signal_handler(int /*signum*/) { g_shutdown_requested.store(true, std::memory_order_relaxed); }

static const char *log_level_name(LogLevel level) {
    switch (level) {
        case LogLevel::Debug: return "DEBUG";
        case LogLevel::Info: return "INFO";
        case LogLevel::Warn: return "WARN";
        case LogLevel::Error: return "ERROR";
    }
    return "INFO";
}

static bool try_parse_log_level(const std::string &value, LogLevel &out) {
    std::string normalized;
    normalized.reserve(value.size());
    for (char ch : value) {
        normalized.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(ch))));
    }
    if (normalized == "trace" || normalized == "debug") {
        out = LogLevel::Debug;
        return true;
    }
    if (normalized == "info") {
        out = LogLevel::Info;
        return true;
    }
    if (normalized == "warn" || normalized == "warning") {
        out = LogLevel::Warn;
        return true;
    }
    if (normalized == "error" || normalized == "fatal" || normalized == "critical") {
        out = LogLevel::Error;
        return true;
    }
    return false;
}

static bool parse_log_level(const std::string &value, const std::string &name, LogLevel &out) {
    if (!try_parse_log_level(value, out)) {
        std::cerr << "Error: " << name
                  << " must be one of trace, debug, info, warn, warning, error, fatal, critical; got: "
                  << value << "\n";
        return false;
    }
    return true;
}

static std::string current_timestamp() {
    const auto now = std::chrono::system_clock::now();
    const std::time_t now_time = std::chrono::system_clock::to_time_t(now);
    std::tm tm_snapshot{};
#ifdef _WIN32
    localtime_s(&tm_snapshot, &now_time);
#else
    localtime_r(&now_time, &tm_snapshot);
#endif
    std::ostringstream stream;
    stream << std::put_time(&tm_snapshot, "%Y-%m-%d %H:%M:%S");
    return stream.str();
}

static void log_message(LogLevel level, const std::string &message) {
    if (static_cast<int>(level) < static_cast<int>(g_log_level)) {
        return;
    }

    std::lock_guard<std::mutex> lock(g_log_mutex);
    (*g_log_stream) << "[" << current_timestamp() << "] "
                    << "[" << log_level_name(level) << "] "
                    << message << std::endl;
}

static bool configure_log_output(const std::string &log_file) {
    if (log_file.empty()) {
        g_log_stream = &std::cerr;
        return true;
    }

    g_log_file_stream.open(log_file, std::ios::out | std::ios::app);
    if (!g_log_file_stream.is_open()) {
        std::cerr << "Error: could not open log file: " << log_file << "\n";
        return false;
    }
    g_log_stream = &g_log_file_stream;
    return true;
}

static bool apply_log_config_file(const std::string &config_path, std::string &log_file, LogLevel &log_level) {
    std::ifstream file(config_path);
    if (!file.is_open()) {
        std::cerr << "Error: could not open log config file: " << config_path << "\n";
        return false;
    }

    std::ostringstream buffer;
    buffer << file.rdbuf();
    const std::string contents = buffer.str();

    const std::regex file_regex(R"OMEGA(<file>\s*([^<]+?)\s*</file>)OMEGA", std::regex::icase);
    const std::regex root_level_regex(R"OMEGA(<root[^>]*level\s*=\s*"([^"]+)")OMEGA", std::regex::icase);
    std::smatch match;

    if (std::regex_search(contents, match, file_regex)) {
        log_file = match[1].str();
    }
    if (std::regex_search(contents, match, root_level_regex)) {
        LogLevel parsed_level;
        if (!parse_log_level(match[1].str(), "--log-config root level", parsed_level)) {
            return false;
        }
        log_level = parsed_level;
    }

    return true;
}

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
              << "\nLogging options:\n"
              << "      --log-file <path>            Append native server logs to file\n"
              << "      --log-level <level>          Native log level (debug, info, warn, error)\n"
              << "      --log-config <path>          Compatibility shim: read log file/level from logback-style XML\n"
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
    std::string log_file;
    std::string log_config_file;
    bool unix_socket_only = false;
    LogLevel log_level = LogLevel::Info;

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
    if (const char *env = std::getenv("OMEGA_EDIT_SERVER_LOG_CONFIG")) {
        log_config_file = env;
        if (!apply_log_config_file(log_config_file, log_file, log_level)) return 1;
    }
    if (const char *env = std::getenv("OMEGA_EDIT_SERVER_LOG_FILE")) {
        log_file = env;
    }
    if (const char *env = std::getenv("OMEGA_EDIT_SERVER_LOG_LEVEL")) {
        if (!parse_log_level(env, "OMEGA_EDIT_SERVER_LOG_LEVEL", log_level)) return 1;
    } else if (const char *env = std::getenv("OMEGA_EDIT_LOG_LEVEL")) {
        if (!parse_log_level(env, "OMEGA_EDIT_LOG_LEVEL", log_level)) return 1;
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
            } else if (key == "--log-file") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                log_file = value;
            } else if (key == "--log-level") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                if (!parse_log_level(value, "--log-level", log_level)) return 1;
            } else if (key == "--log-config") {
                if (value.empty()) {
                    std::cerr << "Error: " << key << " requires a value\n";
                    return 1;
                }
                log_config_file = value;
                // Pre-scan for explicit --log-file / --log-level flags so that they
                // always win over the config file regardless of argument order.
                bool has_explicit_log_file = false;
                bool has_explicit_log_level = false;
                for (int j = 1; j < argc; ++j) {
                    const std::string a = argv[j];
                    if (a == "--log-file" || a.rfind("--log-file=", 0) == 0) {
                        has_explicit_log_file = true;
                    } else if (a == "--log-level" || a.rfind("--log-level=", 0) == 0) {
                        has_explicit_log_level = true;
                    }
                }
                std::string config_log_file = log_file;
                LogLevel config_log_level = log_level;
                if (!apply_log_config_file(log_config_file, config_log_file, config_log_level)) return 1;
                if (!has_explicit_log_file) {
                    log_file = config_log_file;
                }
                if (!has_explicit_log_level) {
                    log_level = config_log_level;
                }
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

    g_log_level = log_level;
    if (!configure_log_output(log_file)) return 1;
    if (!log_file.empty()) {
        log_message(LogLevel::Info, "native server logging redirected to " + log_file);
    }

    // Write PID file
    int pid = getpid();
    if (!pidfile.empty()) {
        std::ofstream pf(pidfile);
        if (pf.is_open()) {
            pf << pid;
            pf.close();
        } else {
            log_message(LogLevel::Warn, "could not write pidfile: " + pidfile);
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
        log_message(LogLevel::Error, "Unix domain sockets are not supported on Windows");
        return 1;
#else
        if (unix_socket.empty()) {
            log_message(LogLevel::Error, "--unix-socket-only requires --unix-socket");
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
