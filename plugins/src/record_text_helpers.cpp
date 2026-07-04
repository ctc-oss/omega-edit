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

#include "plugin_options.hpp"

#include <cctype>
#include <cstdio>
#include <string>
#include <vector>

namespace {

    constexpr const char *RECORD_TEXT_ARGS_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"action\":{\"type\":\"string\",\"title\":\"Action\","
            "\"description\":\"Text or record operation to "
            "apply.\",\"default\":\"newline-lf\",\"enum\":[\"newline-lf\","
            "\"newline-crlf\",\"newline-cr\",\"fixed-width-lines\",\"delimiter-escape\",\"delimiter-unescape\","
            "\"csv-quote\",\"csv-unquote\",\"xml-escape\",\"xml-unescape\",\"json-escape\",\"json-unescape\"]},"
            "\"width\":{\"type\":\"integer\",\"title\":\"Width\",\"description\":\"Characters per fixed-width line.\","
            "\"default\":80,\"minimum\":1,\"maximum\":4096},\"delimiter\":{\"type\":\"string\",\"title\":\"Delimiter\","
            "\"description\":\"Delimiter character for delimiter escape actions.\",\"default\":\",\"},\"escape\":{"
            "\"type\":\"string\",\"title\":\"Escape\",\"description\":\"Escape character for delimiter actions.\","
            "\"default\":\"\\\\\"}},\"additionalProperties\":false}";

    std::vector<omega_byte_t> text_bytes(const std::string &text) {
        return std::vector<omega_byte_t>(text.begin(), text.end());
    }

    std::string as_text(const std::vector<omega_byte_t> &input) { return std::string(input.begin(), input.end()); }

    int hex_value(omega_byte_t byte) {
        if (byte >= '0' && byte <= '9') { return byte - '0'; }
        if (byte >= 'a' && byte <= 'f') { return byte - 'a' + 10; }
        if (byte >= 'A' && byte <= 'F') { return byte - 'A' + 10; }
        return -1;
    }

    std::vector<omega_byte_t> normalize_newlines(const std::vector<omega_byte_t> &input, const std::string &newline) {
        std::vector<omega_byte_t> out;
        for (size_t i = 0; i < input.size(); ++i) {
            if (input[i] == '\r') {
                if (i + 1 < input.size() && input[i + 1] == '\n') { ++i; }
                out.insert(out.end(), newline.begin(), newline.end());
            } else if (input[i] == '\n') {
                out.insert(out.end(), newline.begin(), newline.end());
            } else {
                out.push_back(input[i]);
            }
        }
        return out;
    }

    std::vector<omega_byte_t> fixed_width_lines(const std::vector<omega_byte_t> &input, int64_t width) {
        std::vector<omega_byte_t> out;
        for (size_t i = 0; i < input.size(); ++i) {
            if (i > 0 && (i % static_cast<size_t>(width)) == 0) { out.push_back('\n'); }
            out.push_back(input[i]);
        }
        return out;
    }

    std::vector<omega_byte_t> delimiter_escape(const std::vector<omega_byte_t> &input, omega_byte_t delimiter,
                                               omega_byte_t escape) {
        std::vector<omega_byte_t> out;
        for (const auto byte : input) {
            if (byte == delimiter || byte == escape) { out.push_back(escape); }
            out.push_back(byte);
        }
        return out;
    }

    bool delimiter_unescape(const std::vector<omega_byte_t> &input, omega_byte_t escape,
                            std::vector<omega_byte_t> &out) {
        out.clear();
        bool escaped = false;
        for (const auto byte : input) {
            if (escaped) {
                out.push_back(byte);
                escaped = false;
            } else if (byte == escape) {
                escaped = true;
            } else {
                out.push_back(byte);
            }
        }
        return !escaped;
    }

    std::vector<omega_byte_t> csv_quote(const std::vector<omega_byte_t> &input) {
        std::vector<omega_byte_t> out;
        out.push_back('"');
        for (const auto byte : input) {
            if (byte == '"') { out.push_back('"'); }
            out.push_back(byte);
        }
        out.push_back('"');
        return out;
    }

    bool csv_unquote(const std::vector<omega_byte_t> &input, std::vector<omega_byte_t> &out) {
        if (input.size() < 2 || input.front() != '"' || input.back() != '"') { return false; }
        out.clear();
        for (size_t i = 1; i + 1 < input.size(); ++i) {
            if (input[i] == '"') {
                if (i + 1 >= input.size() - 1 || input[i + 1] != '"') { return false; }
                ++i;
            }
            out.push_back(input[i]);
        }
        return true;
    }

    std::vector<omega_byte_t> xml_escape(const std::vector<omega_byte_t> &input) {
        std::string out;
        for (const auto byte : input) {
            switch (byte) {
                case '&':
                    out += "&amp;";
                    break;
                case '<':
                    out += "&lt;";
                    break;
                case '>':
                    out += "&gt;";
                    break;
                case '"':
                    out += "&quot;";
                    break;
                case '\'':
                    out += "&apos;";
                    break;
                default:
                    out.push_back(static_cast<char>(byte));
                    break;
            }
        }
        return text_bytes(out);
    }

    bool replace_all(std::string &text, const std::string &from, const std::string &to) {
        size_t pos = 0;
        while ((pos = text.find(from, pos)) != std::string::npos) {
            text.replace(pos, from.size(), to);
            pos += to.size();
        }
        return true;
    }

    std::vector<omega_byte_t> xml_unescape(const std::vector<omega_byte_t> &input) {
        std::string text = as_text(input);
        replace_all(text, "&lt;", "<");
        replace_all(text, "&gt;", ">");
        replace_all(text, "&quot;", "\"");
        replace_all(text, "&apos;", "'");
        replace_all(text, "&amp;", "&");
        return text_bytes(text);
    }

    std::vector<omega_byte_t> json_escape(const std::vector<omega_byte_t> &input) {
        std::string out;
        for (const auto byte : input) {
            switch (byte) {
                case '"':
                    out += "\\\"";
                    break;
                case '\\':
                    out += "\\\\";
                    break;
                case '\b':
                    out += "\\b";
                    break;
                case '\f':
                    out += "\\f";
                    break;
                case '\n':
                    out += "\\n";
                    break;
                case '\r':
                    out += "\\r";
                    break;
                case '\t':
                    out += "\\t";
                    break;
                default:
                    if (byte < 0x20) {
                        char escaped[7];
                        std::snprintf(escaped, sizeof(escaped), "\\u%04X", byte);
                        out += escaped;
                    } else {
                        out.push_back(static_cast<char>(byte));
                    }
                    break;
            }
        }
        return text_bytes(out);
    }

    bool json_unescape(const std::vector<omega_byte_t> &input, std::vector<omega_byte_t> &out) {
        out.clear();
        for (size_t i = 0; i < input.size(); ++i) {
            if (input[i] != '\\') {
                out.push_back(input[i]);
                continue;
            }
            if (++i >= input.size()) { return false; }
            switch (input[i]) {
                case '"':
                case '\\':
                case '/':
                    out.push_back(input[i]);
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
                case 'u': {
                    if (i + 4 >= input.size()) { return false; }
                    int value = 0;
                    for (int n = 0; n < 4; ++n) {
                        const int nibble = hex_value(input[++i]);
                        if (nibble < 0) { return false; }
                        value = (value << 4) | nibble;
                    }
                    if (value > 0x7F) { return false; }
                    out.push_back(static_cast<omega_byte_t>(value));
                    break;
                }
                default:
                    return false;
            }
        }
        return true;
    }

}// namespace

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.record_text_helpers";
    info_ptr->name = "Record/Text Helpers";
    info_ptr->description = "Normalize records and escape or unescape common text container syntaxes.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help =
            "Choose an action such as newline-lf, newline-crlf, fixed-width-lines, delimiter-escape, csv-quote, "
            "xml-escape, or json-escape. Use width for fixed-width-lines and delimiter/escape for delimiter helpers.";
    info_ptr->example = "{\"action\":\"fixed-width-lines\",\"width\":80}";
    info_ptr->default_args = "{\"action\":\"newline-lf\"}";
    info_ptr->args_schema = RECORD_TEXT_ARGS_SCHEMA;
    info_ptr->support = OMEGA_TRANSFORM_PLUGIN_SUPPORT_EXPERIMENTAL;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int
omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                             omega_transform_plugin_response_t *response_ptr) {
    std::vector<omega_byte_t> input;
    if (!omega_edit::plugin::selected_bytes(request_ptr, input) || !response_ptr || !request_ptr->alloc) { return -1; }
    std::map<std::string, std::string> options;
    if (!omega_edit::plugin::parse_string_options(request_ptr->options_json, options)) { return -1; }
    const std::string action = omega_edit::plugin::option_or(options, "action", "newline-lf");

    std::vector<omega_byte_t> output;
    bool ok = true;
    if (action == "newline-lf") {
        output = normalize_newlines(input, "\n");
    } else if (action == "newline-crlf") {
        output = normalize_newlines(input, "\r\n");
    } else if (action == "newline-cr") {
        output = normalize_newlines(input, "\r");
    } else if (action == "fixed-width-lines") {
        const int64_t width = omega_edit::plugin::option_int_or(options, "width", 80);
        if (width < 1 || width > 4096) { return -1; }
        output = fixed_width_lines(input, width);
    } else if (action == "delimiter-escape") {
        const std::string delimiter = omega_edit::plugin::option_or(options, "delimiter", ",");
        const std::string escape = omega_edit::plugin::option_or(options, "escape", "\\");
        if (delimiter.size() != 1 || escape.size() != 1) { return -1; }
        output = delimiter_escape(input, static_cast<omega_byte_t>(delimiter[0]), static_cast<omega_byte_t>(escape[0]));
    } else if (action == "delimiter-unescape") {
        const std::string escape = omega_edit::plugin::option_or(options, "escape", "\\");
        if (escape.size() != 1) { return -1; }
        ok = delimiter_unescape(input, static_cast<omega_byte_t>(escape[0]), output);
    } else if (action == "csv-quote") {
        output = csv_quote(input);
    } else if (action == "csv-unquote") {
        ok = csv_unquote(input, output);
    } else if (action == "xml-escape") {
        output = xml_escape(input);
    } else if (action == "xml-unescape") {
        output = xml_unescape(input);
    } else if (action == "json-escape") {
        output = json_escape(input);
    } else if (action == "json-unescape") {
        ok = json_unescape(input, output);
    } else {
        return -1;
    }
    return ok ? omega_edit::plugin::set_replacement(request_ptr, response_ptr, output) : -1;
}
