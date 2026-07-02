/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed on an "AS IS" BASIS, WITHOUT    *
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the License for the specific language         *
 * governing permissions and limitations under the License.                                                           *
 *                                                                                                                    *
 **********************************************************************************************************************/

#ifndef OMEGA_EDIT_PLUGIN_OPTIONS_HPP
#define OMEGA_EDIT_PLUGIN_OPTIONS_HPP

#include <omega_edit/transform_plugin_sdk.h>

#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace omega_edit {
    namespace plugin {

        inline void skip_ws(const char *&cursor) {
            while (*cursor && std::isspace(static_cast<unsigned char>(*cursor))) { ++cursor; }
        }

        inline bool parse_json_string(const char *&cursor, std::string &out) {
            if (*cursor != '"') { return false; }
            ++cursor;
            out.clear();
            while (*cursor && *cursor != '"') {
                char ch = *cursor++;
                if (ch == '\\') {
                    ch = *cursor++;
                    switch (ch) {
                        case '"':
                        case '\\':
                        case '/':
                            out.push_back(ch);
                            break;
                        case 'b':
                            out.push_back('\b');
                            break;
                        case 'f':
                            out.push_back('\f');
                            break;
                        case 'n':
                            out.push_back('\n');
                            break;
                        case 'r':
                            out.push_back('\r');
                            break;
                        case 't':
                            out.push_back('\t');
                            break;
                        default:
                            return false;
                    }
                    continue;
                }
                out.push_back(ch);
            }
            if (*cursor != '"') { return false; }
            ++cursor;
            return true;
        }

        inline bool skip_json_value(const char *&cursor) {
            skip_ws(cursor);
            if (*cursor == '"') {
                std::string ignored;
                return parse_json_string(cursor, ignored);
            }
            if (*cursor == '{' || *cursor == '[') {
                const char open = *cursor++;
                const char close = open == '{' ? '}' : ']';
                int depth = 1;
                while (*cursor && depth > 0) {
                    if (*cursor == '"') {
                        std::string ignored;
                        if (!parse_json_string(cursor, ignored)) { return false; }
                        continue;
                    }
                    if (*cursor == open) { ++depth; }
                    if (*cursor == close) { --depth; }
                    ++cursor;
                }
                return depth == 0;
            }
            while (*cursor && *cursor != ',' && *cursor != '}' && *cursor != ']') { ++cursor; }
            return true;
        }

        inline bool parse_string_options(const char *json, std::map<std::string, std::string> &out) {
            out.clear();
            if (!json || !*json) { return true; }
            const char *cursor = json;
            skip_ws(cursor);
            if (*cursor != '{') { return false; }
            ++cursor;
            skip_ws(cursor);
            if (*cursor == '}') {
                ++cursor;
                skip_ws(cursor);
                return *cursor == '\0';
            }
            while (*cursor) {
                std::string key;
                if (!parse_json_string(cursor, key)) { return false; }
                skip_ws(cursor);
                if (*cursor != ':') { return false; }
                ++cursor;
                skip_ws(cursor);
                if (*cursor == '"') {
                    std::string value;
                    if (!parse_json_string(cursor, value)) { return false; }
                    out[key] = value;
                } else {
                    const char *start = cursor;
                    if (!skip_json_value(cursor)) { return false; }
                    const char *end = cursor;
                    while (end > start && std::isspace(static_cast<unsigned char>(*(end - 1)))) { --end; }
                    out[key] = std::string(start, end);
                }
                skip_ws(cursor);
                if (*cursor == '}') {
                    ++cursor;
                    skip_ws(cursor);
                    return *cursor == '\0';
                }
                if (*cursor != ',') { return false; }
                ++cursor;
                skip_ws(cursor);
            }
            return false;
        }

        inline std::string option_or(const std::map<std::string, std::string> &options, const char *key,
                                     const char *fallback) {
            const auto iter = options.find(key);
            return iter == options.end() ? std::string(fallback) : iter->second;
        }

        inline int64_t option_int_or(const std::map<std::string, std::string> &options, const char *key,
                                     int64_t fallback) {
            const auto iter = options.find(key);
            if (iter == options.end()) { return fallback; }
            char *end_ptr = nullptr;
            const auto parsed = std::strtoll(iter->second.c_str(), &end_ptr, 10);
            return end_ptr && *end_ptr == '\0' ? parsed : fallback;
        }

        inline int set_replacement(const omega_transform_plugin_request_t *request_ptr,
                                   omega_transform_plugin_response_t *response_ptr,
                                   const std::vector<omega_byte_t> &bytes) {
            if (!request_ptr || !response_ptr || !request_ptr->alloc) { return -1; }
            if (bytes.empty()) {
                return omega_transform_plugin_sdk_set_replacement(request_ptr, response_ptr, nullptr, 0);
            }
            auto *copy = static_cast<omega_byte_t *>(omega_transform_plugin_sdk_alloc(request_ptr, bytes.size()));
            if (!copy) { return -1; }
            std::memcpy(copy, bytes.data(), bytes.size());
            response_ptr->replacement_bytes = copy;
            response_ptr->replacement_length = static_cast<int64_t>(bytes.size());
            return 0;
        }

        inline int set_text_result(const omega_transform_plugin_request_t *request_ptr,
                                   omega_transform_plugin_response_t *response_ptr, const std::string &label,
                                   const std::string &value) {
            return omega_transform_plugin_sdk_set_text_result(request_ptr, response_ptr, label.c_str(), value.c_str(),
                                                              "text/plain");
        }

        inline bool selected_bytes(const omega_transform_plugin_request_t *request_ptr,
                                   std::vector<omega_byte_t> &out) {
            out.clear();
            if (!request_ptr || request_ptr->input_length < 0 ||
                (request_ptr->input_length > 0 && !request_ptr->input_bytes)) {
                return false;
            }
            if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return false; }
            out.assign(request_ptr->input_bytes, request_ptr->input_bytes + request_ptr->input_length);
            return true;
        }

        inline std::string hex_value(uint64_t value, int width) {
            std::ostringstream stream;
            stream << "0x";
            stream.setf(std::ios::uppercase);
            stream.fill('0');
            stream.width(width);
            stream << std::hex << value;
            return stream.str();
        }

        inline bool for_each_chunk(const omega_transform_plugin_request_t *request_ptr,
                                   const std::function<bool(const omega_byte_t *, int64_t)> &callback) {
            if (!request_ptr || request_ptr->session_length < 0 || request_ptr->input_length < 0) { return false; }
            if (!request_ptr->read) {
                if (request_ptr->input_length > 0 && !request_ptr->input_bytes) { return false; }
                if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return false; }
                return callback(request_ptr->input_bytes, request_ptr->input_length);
            }

            const int64_t max_chunk = 1024 * 1024;
            const int64_t fallback_chunk = 64 * 1024;
            int64_t chunk_size =
                    request_ptr->preferred_chunk_size > 0 ? request_ptr->preferred_chunk_size : fallback_chunk;
            if (chunk_size > max_chunk) { chunk_size = max_chunk; }
            std::vector<omega_byte_t> buffer(static_cast<size_t>(chunk_size));
            for (int64_t position = 0; position < request_ptr->session_length;) {
                if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return false; }
                const int64_t remaining = request_ptr->session_length - position;
                const int64_t requested = remaining < chunk_size ? remaining : chunk_size;
                const int64_t bytes_read =
                        request_ptr->read(position, buffer.data(), requested, request_ptr->reader_user_data_ptr);
                if (bytes_read <= 0 || bytes_read > requested) { return false; }
                if (!callback(buffer.data(), bytes_read)) { return false; }
                position += bytes_read;
            }
            return true;
        }

    }// namespace plugin
}// namespace omega_edit

#endif// OMEGA_EDIT_PLUGIN_OPTIONS_HPP
