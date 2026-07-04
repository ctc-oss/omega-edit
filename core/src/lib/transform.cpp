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

#include "../include/omega_edit/transform.h"
#include "../include/omega_edit/edit.h"
#include "../include/omega_edit/segment.h"
#include "../include/omega_edit/session.h"

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <regex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <io.h>
#include <windows.h>
#ifdef min
#undef min
#endif
#ifdef max
#undef max
#endif
#else
#include <signal.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace {
    constexpr size_t OMEGA_SCHEMA_REGEX_CACHE_LIMIT = 128;
    constexpr size_t OMEGA_SCHEMA_REGEX_MAX_PATTERN_BYTES = 4096;

    struct plugin_info_storage_t {
        std::string id;
        std::string name;
        std::string description;
        std::string help;
        std::string example;
        std::string default_args;
        std::string args_schema;
    };

    struct loaded_plugin_t {
        omega_transform_plugin_info_t info{};
        plugin_info_storage_t info_storage;
        std::string path;
    };

    std::mutex g_schema_regex_cache_mutex;
    std::unordered_map<std::string, std::shared_ptr<const std::regex>> g_schema_regex_cache;

    struct regex_group_context_t {
        bool has_quantified_atom{};
        bool has_alternation{};
    };

    auto schema_regex_is_safe_(const std::string &pattern_text) -> bool {
        bool escaped = false;
        bool in_character_class = false;
        bool last_atom_exists = false;
        bool last_atom_is_group = false;
        bool last_group_has_risky_content = false;
        std::vector<regex_group_context_t> groups;

        auto remember_atom = [&](bool is_group, bool group_has_risky_content) {
            last_atom_exists = true;
            last_atom_is_group = is_group;
            last_group_has_risky_content = group_has_risky_content;
        };

        auto forget_atom = [&]() {
            last_atom_exists = false;
            last_atom_is_group = false;
            last_group_has_risky_content = false;
        };

        auto apply_quantifier = [&]() {
            if (!last_atom_exists) { return true; }
            if (last_atom_is_group && last_group_has_risky_content) { return false; }
            if (!groups.empty()) { groups.back().has_quantified_atom = true; }
            forget_atom();
            return true;
        };

        for (size_t index = 0; index < pattern_text.size(); ++index) {
            const auto ch = static_cast<unsigned char>(pattern_text[index]);

            if (escaped) {
                if (std::isdigit(ch) != 0) { return false; }
                remember_atom(false, false);
                escaped = false;
                continue;
            }

            if (ch == '\\') {
                escaped = true;
                continue;
            }

            if (in_character_class) {
                if (ch == ']') { in_character_class = false; }
                continue;
            }

            switch (ch) {
                case '[':
                    in_character_class = true;
                    remember_atom(false, false);
                    break;
                case '(':
                    if (index + 1 < pattern_text.size() && pattern_text[index + 1] == '?') { return false; }
                    groups.push_back({});
                    forget_atom();
                    break;
                case ')': {
                    if (groups.empty()) { return false; }
                    const auto group = groups.back();
                    groups.pop_back();
                    remember_atom(true, group.has_quantified_atom || group.has_alternation);
                    break;
                }
                case '|':
                    if (!groups.empty()) { groups.back().has_alternation = true; }
                    forget_atom();
                    break;
                case '*':
                case '+':
                case '?':
                    if (!apply_quantifier()) { return false; }
                    break;
                case '{': {
                    size_t end = index + 1;
                    bool has_digit = false;
                    bool valid_range_quantifier = true;
                    for (; end < pattern_text.size() && pattern_text[end] != '}'; ++end) {
                        const auto range_ch = static_cast<unsigned char>(pattern_text[end]);
                        if (std::isdigit(range_ch) != 0) {
                            has_digit = true;
                        } else if (range_ch != ',') {
                            valid_range_quantifier = false;
                            break;
                        }
                    }
                    if (end < pattern_text.size() && valid_range_quantifier && has_digit) {
                        if (!apply_quantifier()) { return false; }
                        index = end;
                    } else {
                        forget_atom();
                    }
                    break;
                }
                case '^':
                case '$':
                    forget_atom();
                    break;
                default:
                    remember_atom(false, false);
                    break;
            }
        }

        return !escaped && !in_character_class && groups.empty();
    }

    auto get_schema_regex_(const std::string &pattern_text) -> std::shared_ptr<const std::regex> {
        if (pattern_text.size() > OMEGA_SCHEMA_REGEX_MAX_PATTERN_BYTES || !schema_regex_is_safe_(pattern_text)) {
            return nullptr;
        }
        {
            std::lock_guard<std::mutex> lock(g_schema_regex_cache_mutex);
            const auto iter = g_schema_regex_cache.find(pattern_text);
            if (iter != g_schema_regex_cache.end()) { return iter->second; }
        }

        std::shared_ptr<const std::regex> compiled;
        try {
            compiled = std::make_shared<const std::regex>(pattern_text);
        } catch (const std::regex_error &) { return nullptr; }

        std::lock_guard<std::mutex> lock(g_schema_regex_cache_mutex);
        if (g_schema_regex_cache.size() >= OMEGA_SCHEMA_REGEX_CACHE_LIMIT) { g_schema_regex_cache.clear(); }
        const auto [iter, inserted] = g_schema_regex_cache.emplace(pattern_text, compiled);
        (void) inserted;
        return iter->second;
    }

    auto schema_regex_matches_(const std::string &value, const std::string &pattern_text) -> bool {
        const auto regex = get_schema_regex_(pattern_text);
        return regex && std::regex_match(value, *regex);
    }

    constexpr size_t JSON_MAX_NESTING_DEPTH = 256U;

    struct json_value_t {
        enum class kind_t { null_value, object, array, string, number, boolean };

        kind_t kind{kind_t::null_value};
        std::map<std::string, json_value_t> object_value;
        std::vector<json_value_t> array_value;
        std::string string_value;
        double number_value{};
        bool bool_value{};
    };

    class json_parser_t {
    public:
        explicit json_parser_t(const char *input) : input_(input ? input : "") {}

        auto parse(json_value_t &value) -> bool {
            skip_ws();
            if (!parse_value(value, 0)) { return false; }
            skip_ws();
            return input_[pos_] == '\0';
        }

    private:
        const char *input_;
        size_t pos_{};

        void skip_ws() {
            while (std::isspace(static_cast<unsigned char>(input_[pos_]))) { ++pos_; }
        }

        auto consume(char expected) -> bool {
            skip_ws();
            if (input_[pos_] != expected) { return false; }
            ++pos_;
            return true;
        }

        auto parse_value(json_value_t &value, size_t depth) -> bool {
            if (depth > JSON_MAX_NESTING_DEPTH) { return false; }
            skip_ws();
            switch (input_[pos_]) {
                case '{':
                    return parse_object(value, depth);
                case '[':
                    return parse_array(value, depth);
                case '"':
                    value.kind = json_value_t::kind_t::string;
                    return parse_string(value.string_value);
                case 't':
                    return parse_literal("true", json_value_t::kind_t::boolean, value, true);
                case 'f':
                    return parse_literal("false", json_value_t::kind_t::boolean, value, false);
                case 'n':
                    return parse_literal("null", json_value_t::kind_t::null_value, value, false);
                default:
                    return parse_number(value);
            }
        }

        auto parse_literal(const char *literal, json_value_t::kind_t kind, json_value_t &value,
                           bool bool_value) -> bool {
            const auto length = std::strlen(literal);
            if (std::strncmp(input_ + pos_, literal, length) != 0) { return false; }
            pos_ += length;
            value.kind = kind;
            value.bool_value = bool_value;
            return true;
        }

        auto parse_string(std::string &value) -> bool {
            if (input_[pos_] != '"') { return false; }
            ++pos_;
            value.clear();
            while (input_[pos_] != '\0') {
                const char ch = input_[pos_++];
                if (ch == '"') { return true; }
                if (static_cast<unsigned char>(ch) < 0x20) { return false; }
                if (ch != '\\') {
                    value.push_back(ch);
                    continue;
                }
                const char escaped = input_[pos_++];
                switch (escaped) {
                    case '"':
                    case '\\':
                    case '/':
                        value.push_back(escaped);
                        break;
                    case 'b':
                        value.push_back('\b');
                        break;
                    case 'f':
                        value.push_back('\f');
                        break;
                    case 'n':
                        value.push_back('\n');
                        break;
                    case 'r':
                        value.push_back('\r');
                        break;
                    case 't':
                        value.push_back('\t');
                        break;
                    case 'u':
                        if (!parse_unicode_escape(value)) { return false; }
                        break;
                    default:
                        return false;
                }
            }
            return false;
        }

        auto parse_object(json_value_t &value, size_t depth) -> bool {
            if (!consume('{')) { return false; }
            value = {};
            value.kind = json_value_t::kind_t::object;
            skip_ws();
            if (consume('}')) { return true; }
            while (input_[pos_] != '\0') {
                std::string key;
                skip_ws();
                if (!parse_string(key) || !consume(':')) { return false; }
                json_value_t member;
                if (!parse_value(member, depth + 1)) { return false; }
                value.object_value[key] = std::move(member);
                skip_ws();
                if (consume('}')) { return true; }
                if (!consume(',')) { return false; }
            }
            return false;
        }

        auto parse_array(json_value_t &value, size_t depth) -> bool {
            if (!consume('[')) { return false; }
            value = {};
            value.kind = json_value_t::kind_t::array;
            skip_ws();
            if (consume(']')) { return true; }
            while (input_[pos_] != '\0') {
                json_value_t item;
                if (!parse_value(item, depth + 1)) { return false; }
                value.array_value.push_back(std::move(item));
                skip_ws();
                if (consume(']')) { return true; }
                if (!consume(',')) { return false; }
            }
            return false;
        }

        auto parse_number(json_value_t &value) -> bool {
            skip_ws();
            const auto start = pos_;
            if (input_[pos_] == '-') { ++pos_; }
            if (!std::isdigit(static_cast<unsigned char>(input_[pos_]))) { return false; }
            if (input_[pos_] == '0') {
                ++pos_;
            } else {
                while (std::isdigit(static_cast<unsigned char>(input_[pos_]))) { ++pos_; }
            }
            if (input_[pos_] == '.') {
                ++pos_;
                if (!std::isdigit(static_cast<unsigned char>(input_[pos_]))) { return false; }
                while (std::isdigit(static_cast<unsigned char>(input_[pos_]))) { ++pos_; }
            }
            if (input_[pos_] == 'e' || input_[pos_] == 'E') {
                ++pos_;
                if (input_[pos_] == '+' || input_[pos_] == '-') { ++pos_; }
                if (!std::isdigit(static_cast<unsigned char>(input_[pos_]))) { return false; }
                while (std::isdigit(static_cast<unsigned char>(input_[pos_]))) { ++pos_; }
            }
            char *end_ptr = nullptr;
            const std::string token(input_ + start, pos_ - start);
            value.kind = json_value_t::kind_t::number;
            value.number_value = std::strtod(token.c_str(), &end_ptr);
            return end_ptr && *end_ptr == '\0';
        }

        static auto hex_digit_value(char ch) -> int {
            if (ch >= '0' && ch <= '9') { return ch - '0'; }
            if (ch >= 'a' && ch <= 'f') { return 10 + ch - 'a'; }
            if (ch >= 'A' && ch <= 'F') { return 10 + ch - 'A'; }
            return -1;
        }

        auto parse_hex4(unsigned int &code_unit) -> bool {
            code_unit = 0;
            for (auto index = 0; index < 4; ++index) {
                if (input_[pos_] == '\0') { return false; }
                const auto digit = hex_digit_value(input_[pos_]);
                if (digit < 0) { return false; }
                ++pos_;
                code_unit = (code_unit << 4U) | static_cast<unsigned int>(digit);
            }
            return true;
        }

        static void append_utf8(std::string &value, unsigned int code_point) {
            if (code_point <= 0x7F) {
                value.push_back(static_cast<char>(code_point));
            } else if (code_point <= 0x7FF) {
                value.push_back(static_cast<char>(0xC0U | (code_point >> 6U)));
                value.push_back(static_cast<char>(0x80U | (code_point & 0x3FU)));
            } else if (code_point <= 0xFFFF) {
                value.push_back(static_cast<char>(0xE0U | (code_point >> 12U)));
                value.push_back(static_cast<char>(0x80U | ((code_point >> 6U) & 0x3FU)));
                value.push_back(static_cast<char>(0x80U | (code_point & 0x3FU)));
            } else {
                value.push_back(static_cast<char>(0xF0U | (code_point >> 18U)));
                value.push_back(static_cast<char>(0x80U | ((code_point >> 12U) & 0x3FU)));
                value.push_back(static_cast<char>(0x80U | ((code_point >> 6U) & 0x3FU)));
                value.push_back(static_cast<char>(0x80U | (code_point & 0x3FU)));
            }
        }

        auto parse_unicode_escape(std::string &value) -> bool {
            unsigned int code_unit = 0;
            if (!parse_hex4(code_unit)) { return false; }

            if (code_unit >= 0xD800 && code_unit <= 0xDBFF) {
                if (input_[pos_] != '\\') { return false; }
                ++pos_;
                if (input_[pos_] != 'u') { return false; }
                ++pos_;
                unsigned int low_surrogate = 0;
                if (!parse_hex4(low_surrogate) || low_surrogate < 0xDC00 || low_surrogate > 0xDFFF) { return false; }
                const auto code_point = 0x10000U + (((code_unit - 0xD800U) << 10U) | (low_surrogate - 0xDC00U));
                append_utf8(value, code_point);
                return true;
            }

            if (code_unit >= 0xDC00 && code_unit <= 0xDFFF) { return false; }
            append_utf8(value, code_unit);
            return true;
        }
    };

    auto json_object_member_(const json_value_t &value, const char *key) -> const json_value_t * {
        if (value.kind != json_value_t::kind_t::object) { return nullptr; }
        const auto iter = value.object_value.find(key);
        return iter == value.object_value.end() ? nullptr : &iter->second;
    }

    auto json_string_value_(const json_value_t &value, std::string &out) -> bool {
        if (value.kind != json_value_t::kind_t::string) { return false; }
        out = value.string_value;
        return true;
    }

    auto json_boolean_value_(const json_value_t &value, bool &out) -> bool {
        if (value.kind != json_value_t::kind_t::boolean) { return false; }
        out = value.bool_value;
        return true;
    }

    auto json_values_equal_(const json_value_t &left, const json_value_t &right, size_t depth = 0) -> bool {
        if (depth > JSON_MAX_NESTING_DEPTH) { return false; }
        if (left.kind != right.kind) { return false; }
        switch (left.kind) {
            case json_value_t::kind_t::null_value:
                return true;
            case json_value_t::kind_t::string:
                return left.string_value == right.string_value;
            case json_value_t::kind_t::number:
                return left.number_value == right.number_value;
            case json_value_t::kind_t::boolean:
                return left.bool_value == right.bool_value;
            case json_value_t::kind_t::array:
                if (left.array_value.size() != right.array_value.size()) { return false; }
                for (size_t index = 0; index < left.array_value.size(); ++index) {
                    if (!json_values_equal_(left.array_value[index], right.array_value[index], depth + 1)) {
                        return false;
                    }
                }
                return true;
            case json_value_t::kind_t::object:
                if (left.object_value.size() != right.object_value.size()) { return false; }
                for (const auto &[key, left_value] : left.object_value) {
                    const auto right_iter = right.object_value.find(key);
                    if (right_iter == right.object_value.end()) { return false; }
                    if (!json_values_equal_(left_value, right_iter->second, depth + 1)) { return false; }
                }
                return true;
        }
        return false;
    }

    auto schema_number_(const json_value_t &schema, const char *key, double &out) -> bool {
        const auto *member = json_object_member_(schema, key);
        if (!member) { return false; }
        if (member->kind != json_value_t::kind_t::number) { return false; }
        out = member->number_value;
        return true;
    }

    auto schema_integer_(const json_value_t &schema, const char *key, int64_t &out) -> bool {
        double number = 0;
        if (!schema_number_(schema, key, number)) { return false; }
        out = static_cast<int64_t>(number);
        return number == static_cast<double>(out);
    }

    auto validate_schema_value_(const json_value_t &value, const json_value_t &schema, size_t depth = 0) -> bool {
        if (depth > JSON_MAX_NESTING_DEPTH) { return false; }
        if (schema.kind != json_value_t::kind_t::object) { return false; }

        const auto *one_of = json_object_member_(schema, "oneOf");
        if (one_of) {
            if (one_of->kind != json_value_t::kind_t::array) { return false; }
            auto matches = 0;
            for (const auto &candidate : one_of->array_value) {
                if (validate_schema_value_(value, candidate, depth + 1)) { ++matches; }
            }
            if (matches != 1) { return false; }
        }

        const auto *not_schema = json_object_member_(schema, "not");
        if (not_schema && validate_schema_value_(value, *not_schema, depth + 1)) { return false; }

        if (const auto *enum_values = json_object_member_(schema, "enum")) {
            if (enum_values->kind != json_value_t::kind_t::array) { return false; }
            auto matches = false;
            for (const auto &candidate : enum_values->array_value) {
                if (json_values_equal_(value, candidate, depth + 1)) {
                    matches = true;
                    break;
                }
            }
            if (!matches) { return false; }
        }

        std::string type;
        if (const auto *type_value = json_object_member_(schema, "type")) {
            if (!json_string_value_(*type_value, type)) { return false; }
            if (type == "object" && value.kind != json_value_t::kind_t::object) { return false; }
            if (type == "array" && value.kind != json_value_t::kind_t::array) { return false; }
            if (type == "string" && value.kind != json_value_t::kind_t::string) { return false; }
            if (type == "boolean" && value.kind != json_value_t::kind_t::boolean) { return false; }
            if (type == "integer") {
                if (value.kind != json_value_t::kind_t::number) { return false; }
                const auto integer_value = static_cast<int64_t>(value.number_value);
                if (value.number_value != static_cast<double>(integer_value)) { return false; }
            }
            if (type != "object" && type != "array" && type != "string" && type != "integer" && type != "boolean") {
                return false;
            }
        }

        if (const auto *required = json_object_member_(schema, "required")) {
            if (required->kind != json_value_t::kind_t::array) { return false; }
            if (value.kind != json_value_t::kind_t::object) { return false; }
            for (const auto &required_key : required->array_value) {
                std::string key;
                if (!json_string_value_(required_key, key) ||
                    value.object_value.find(key) == value.object_value.end()) {
                    return false;
                }
            }
        }

        if (value.kind == json_value_t::kind_t::object) {
            const auto *properties = json_object_member_(schema, "properties");
            if (properties && properties->kind != json_value_t::kind_t::object) { return false; }

            bool additional_properties = true;
            if (const auto *additional = json_object_member_(schema, "additionalProperties")) {
                if (!json_boolean_value_(*additional, additional_properties)) { return false; }
            }

            if (properties) {
                for (const auto &[key, member] : value.object_value) {
                    const auto property_iter = properties->object_value.find(key);
                    if (property_iter == properties->object_value.end()) {
                        if (!additional_properties) { return false; }
                        continue;
                    }
                    if (!validate_schema_value_(member, property_iter->second, depth + 1)) { return false; }
                }
            } else if (!additional_properties && !value.object_value.empty()) {
                return false;
            }
        }

        if (value.kind == json_value_t::kind_t::array) {
            int64_t min_items = 0;
            if (schema_integer_(schema, "minItems", min_items) &&
                static_cast<int64_t>(value.array_value.size()) < min_items) {
                return false;
            }
            if (const auto *items = json_object_member_(schema, "items")) {
                for (const auto &item : value.array_value) {
                    if (!validate_schema_value_(item, *items, depth + 1)) { return false; }
                }
            }
        }

        if (value.kind == json_value_t::kind_t::string) {
            if (const auto *pattern = json_object_member_(schema, "pattern")) {
                std::string pattern_text;
                if (!json_string_value_(*pattern, pattern_text)) { return false; }
                if (!schema_regex_matches_(value.string_value, pattern_text)) { return false; }
            }
        }

        if (type == "integer") {
            double minimum = 0;
            if (schema_number_(schema, "minimum", minimum) && value.number_value < minimum) { return false; }
            double maximum = 0;
            if (schema_number_(schema, "maximum", maximum) && value.number_value > maximum) { return false; }
        }

        return true;
    }

    auto args_schema_is_valid_(const char *args_schema) -> bool {
        if (!args_schema || !*args_schema) { return false; }
        json_value_t schema;
        if (!json_parser_t(args_schema).parse(schema)) { return false; }
        if (schema.kind != json_value_t::kind_t::object) { return false; }
        std::string type;
        const auto *type_value = json_object_member_(schema, "type");
        if (!type_value || !json_string_value_(*type_value, type)) { return false; }
        return type == "object";
    }

    auto options_match_args_schema_(const char *options_json, const char *args_schema) -> bool {
        if (!args_schema_is_valid_(args_schema)) { return false; }
        json_value_t options;
        json_value_t schema;
        if (!json_parser_t(args_schema).parse(schema)) { return false; }
        if (!options_json || !*options_json) {
            options.kind = json_value_t::kind_t::object;
        } else if (!json_parser_t(options_json).parse(options)) {
            return false;
        }
        return validate_schema_value_(options, schema);
    }

    auto plugin_operation_is_valid_(omega_transform_plugin_operation_t operation) -> bool {
        return operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE ||
               operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT ||
               operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT;
    }

    auto plugin_buffer_is_valid_(const omega_byte_t *bytes, int64_t length) -> bool {
        return length >= 0 && (length == 0 || bytes != nullptr);
    }

    auto plugin_response_has_no_content_change_(const omega_transform_plugin_response_t &response) -> bool {
        return (response.flags & OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE) != 0U;
    }

    auto assign_plugin_info_(loaded_plugin_t &plugin, const omega_transform_plugin_info_t &info) -> void {
        plugin.info_storage.id = info.id ? info.id : "";
        plugin.info_storage.name = info.name ? info.name : "";
        plugin.info_storage.description = info.description ? info.description : "";
        plugin.info_storage.help = info.help ? info.help : "";
        plugin.info_storage.example = info.example ? info.example : "";
        plugin.info_storage.default_args = info.default_args ? info.default_args : "";
        plugin.info_storage.args_schema = info.args_schema ? info.args_schema : "";

        plugin.info = {};
        plugin.info.abi_version = info.abi_version;
        plugin.info.operation = info.operation;
        plugin.info.flags = info.flags;
        plugin.info.support = info.support;
        plugin.info.id = plugin.info_storage.id.empty() ? nullptr : plugin.info_storage.id.c_str();
        plugin.info.name = plugin.info_storage.name.empty() ? nullptr : plugin.info_storage.name.c_str();
        plugin.info.description =
                plugin.info_storage.description.empty() ? nullptr : plugin.info_storage.description.c_str();
        plugin.info.help = plugin.info_storage.help.empty() ? nullptr : plugin.info_storage.help.c_str();
        plugin.info.example = plugin.info_storage.example.empty() ? nullptr : plugin.info_storage.example.c_str();
        plugin.info.default_args =
                plugin.info_storage.default_args.empty() ? nullptr : plugin.info_storage.default_args.c_str();
        plugin.info.args_schema =
                plugin.info_storage.args_schema.empty() ? nullptr : plugin.info_storage.args_schema.c_str();
    }

    auto plugin_info_is_valid_(const omega_transform_plugin_info_t &info) -> bool {
        return info.abi_version == OMEGA_TRANSFORM_PLUGIN_ABI_VERSION && info.id && *info.id &&
               plugin_operation_is_valid_(info.operation) &&
               (info.support == OMEGA_TRANSFORM_PLUGIN_SUPPORT_PRODUCTION ||
                info.support == OMEGA_TRANSFORM_PLUGIN_SUPPORT_EXPERIMENTAL ||
                info.support == OMEGA_TRANSFORM_PLUGIN_SUPPORT_TEST) &&
               args_schema_is_valid_(info.args_schema);
    }

    auto int64_to_size_(int64_t value, size_t &out) -> bool {
        if (value < 0) { return false; }
        if (static_cast<uint64_t>(value) > static_cast<uint64_t>((std::numeric_limits<size_t>::max)())) {
            return false;
        }
        out = static_cast<size_t>(value);
        return true;
    }

    auto plugin_extension_is_supported_(const std::filesystem::path &path) -> bool {
        const auto extension = path.extension().string();
#ifdef _WIN32
        return extension == ".dll";
#elif defined(__APPLE__)
        return extension == ".dylib" || extension == ".so";
#else
        return extension == ".so";
#endif
    }

    constexpr int64_t TRANSFORM_PLUGIN_STREAM_CHUNK_BYTES = 1024 * 1024;
    constexpr int64_t TRANSFORM_PLUGIN_CONTIGUOUS_INPUT_LIMIT_BYTES = 4 * 1024 * 1024;
    constexpr size_t TRANSFORM_PLUGIN_FILE_BACKED_ALLOC_LIMIT_BYTES = 64U * 1024U * 1024U;
    constexpr uint32_t PROCESS_HOST_INFO_MAGIC = 0x4F454931U;
    constexpr uint32_t PROCESS_HOST_REQUEST_MAGIC = 0x4F455251U;
    constexpr uint32_t PROCESS_HOST_RESPONSE_MAGIC = 0x4F455253U;
    constexpr uint32_t PROCESS_HOST_PROGRESS_MAGIC = 0x4F455047U;

    class file_backed_buffer_t {
    public:
        file_backed_buffer_t(const file_backed_buffer_t &) = delete;
        auto operator=(const file_backed_buffer_t &) -> file_backed_buffer_t & = delete;

        ~file_backed_buffer_t() {
            if (data_ != nullptr && size_ > 0) {
#ifdef _WIN32
                UnmapViewOfFile(data_);
#else
                munmap(data_, size_);
#endif
            }
#ifdef _WIN32
            if (mapping_handle_ != nullptr) { CloseHandle(mapping_handle_); }
            if (file_handle_ != INVALID_HANDLE_VALUE) { CloseHandle(file_handle_); }
#else
            if (fd_ >= 0) { close(fd_); }
#endif
            if (!path_.empty()) { omega_util_remove_file(path_.c_str()); }
        }

        static auto create(const char *directory, const char *prefix,
                           size_t size) -> std::shared_ptr<file_backed_buffer_t> {
            if (size == 0) { return nullptr; }
            const auto *const dir = (directory && *directory) ? directory : ".";
            char path[FILENAME_MAX + 1];
            const auto count =
                    snprintf(path, sizeof(path), "%s%c.%s.XXXXXX", dir, omega_util_directory_separator(), prefix);
            if (count < 0 || static_cast<size_t>(count) >= sizeof(path)) { return nullptr; }

            const auto fd = omega_util_mkstemp(path, 0600);
            if (fd < 0) { return nullptr; }

            auto buffer = std::shared_ptr<file_backed_buffer_t>(new file_backed_buffer_t());
            buffer->path_ = path;
            buffer->size_ = size;

#ifdef _WIN32
            _close(fd);
            buffer->file_handle_ =
                    CreateFileA(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                FILE_ATTRIBUTE_TEMPORARY | FILE_ATTRIBUTE_NOT_CONTENT_INDEXED, nullptr);
            if (buffer->file_handle_ == INVALID_HANDLE_VALUE) { return nullptr; }
            LARGE_INTEGER file_size;
            file_size.QuadPart = static_cast<LONGLONG>(size);
            if (!SetFilePointerEx(buffer->file_handle_, file_size, nullptr, FILE_BEGIN) ||
                !SetEndOfFile(buffer->file_handle_)) {
                return nullptr;
            }
            const auto mapped_size = static_cast<uint64_t>(size);
            buffer->mapping_handle_ = CreateFileMappingA(buffer->file_handle_, nullptr, PAGE_READWRITE,
                                                         static_cast<DWORD>(mapped_size >> 32U),
                                                         static_cast<DWORD>(mapped_size & 0xFFFFFFFFU), nullptr);
            if (buffer->mapping_handle_ == nullptr) { return nullptr; }
            buffer->data_ = static_cast<omega_byte_t *>(
                    MapViewOfFile(buffer->mapping_handle_, FILE_MAP_ALL_ACCESS, 0, 0, size));
            if (buffer->data_ == nullptr) { return nullptr; }
#else
            buffer->fd_ = fd;
            if (static_cast<uint64_t>(size) > static_cast<uint64_t>((std::numeric_limits<off_t>::max)())) {
                return nullptr;
            }
            if (ftruncate(buffer->fd_, static_cast<off_t>(size)) != 0) { return nullptr; }
            void *mapped = mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_SHARED, buffer->fd_, 0);
            if (mapped == MAP_FAILED) { return nullptr; }
            buffer->data_ = static_cast<omega_byte_t *>(mapped);
#endif
            return buffer;
        }

        auto data() const -> omega_byte_t * { return data_; }

    private:
        file_backed_buffer_t() = default;

        omega_byte_t *data_{};
        size_t size_{};
        std::string path_;
#ifdef _WIN32
        HANDLE file_handle_{INVALID_HANDLE_VALUE};
        HANDLE mapping_handle_{nullptr};
#else
        int fd_{-1};
#endif
    };

    class plugin_allocation_store_t {
    public:
        void add(void *ptr, std::shared_ptr<file_backed_buffer_t> allocation) {
            if (!ptr || !allocation) { return; }
            std::lock_guard<std::mutex> lock(mutex_);
            file_backed_allocations_[ptr] = std::move(allocation);
        }

        auto take(void *ptr, std::shared_ptr<file_backed_buffer_t> &allocation_out) -> bool {
            if (!ptr) { return false; }
            std::lock_guard<std::mutex> lock(mutex_);
            const auto iter = file_backed_allocations_.find(ptr);
            if (iter == file_backed_allocations_.end()) { return false; }
            allocation_out = std::move(iter->second);
            file_backed_allocations_.erase(iter);
            return true;
        }

    private:
        std::mutex mutex_;
        std::unordered_map<void *, std::shared_ptr<file_backed_buffer_t>> file_backed_allocations_;
    };

    plugin_allocation_store_t g_response_file_backed_allocations;

    void release_plugin_allocation_(plugin_allocation_store_t *allocation_store, void *ptr) {
        if (!ptr) { return; }
        std::shared_ptr<file_backed_buffer_t> file_backed;
        if (allocation_store) { allocation_store->take(ptr, file_backed); }
        if (!file_backed) { g_response_file_backed_allocations.take(ptr, file_backed); }
        if (!file_backed) { std::free(ptr); }
    }

    struct plugin_allocator_state_t {
        const char *checkpoint_directory{};
        plugin_allocation_store_t *allocation_store{};
        std::vector<void *> allocations;
    };

    void *plugin_alloc_(size_t size, void *user_data_ptr) {
        auto *state = static_cast<plugin_allocator_state_t *>(user_data_ptr);
        const auto requested_size = size == 0 ? 1 : size;
        void *ptr = nullptr;
        if (requested_size > TRANSFORM_PLUGIN_FILE_BACKED_ALLOC_LIMIT_BYTES && state && state->allocation_store) {
            auto file_backed =
                    file_backed_buffer_t::create(state->checkpoint_directory, "OmegaEdit-xform-alloc", requested_size);
            if (file_backed) {
                ptr = file_backed->data();
                state->allocation_store->add(ptr, std::move(file_backed));
            }
        } else {
            ptr = std::malloc(requested_size);
        }

        if (ptr && state) { state->allocations.push_back(ptr); }
        return ptr;
    }

    auto response_owns_allocation_(const omega_transform_plugin_response_t &response, void *ptr) -> bool {
        return ptr == response.replacement_bytes || ptr == response.result_bytes || ptr == response.result_label ||
               ptr == response.result_mime_type;
    }

    void release_unclaimed_plugin_allocations_(plugin_allocator_state_t &state,
                                               const omega_transform_plugin_response_t &response) {
        for (auto *ptr : state.allocations) {
            if (!response_owns_allocation_(response, ptr)) { release_plugin_allocation_(state.allocation_store, ptr); }
        }
        state.allocations.clear();
    }

    void promote_response_allocation_(plugin_allocator_state_t &state, void *ptr) {
        if (!ptr || !state.allocation_store) { return; }
        std::shared_ptr<file_backed_buffer_t> file_backed;
        if (state.allocation_store->take(ptr, file_backed)) {
            g_response_file_backed_allocations.add(ptr, std::move(file_backed));
        }
    }

    void promote_response_allocations_(plugin_allocator_state_t &state,
                                       const omega_transform_plugin_response_t &response) {
        promote_response_allocation_(state, response.replacement_bytes);
        promote_response_allocation_(state, response.result_bytes);
        promote_response_allocation_(state, response.result_label);
        promote_response_allocation_(state, response.result_mime_type);
    }

    void clear_plugin_response_(plugin_allocator_state_t &state, omega_transform_plugin_response_t *response_ptr) {
        if (!response_ptr) { return; }
        release_plugin_allocation_(state.allocation_store, response_ptr->replacement_bytes);
        release_plugin_allocation_(state.allocation_store, response_ptr->result_bytes);
        release_plugin_allocation_(state.allocation_store, response_ptr->result_label);
        release_plugin_allocation_(state.allocation_store, response_ptr->result_mime_type);
        *response_ptr = {};
    }

    struct session_range_reader_t {
        const omega_session_t *session_ptr{};
        int64_t offset{};
        int64_t length{};
        int64_t furthest_read{};
        omega_transform_plugin_progress_cbk_t progress{};
        void *progress_user_data_ptr{};
        omega_transform_plugin_is_cancelled_t is_cancelled{};
        void *cancel_user_data_ptr{};
    };

    struct materialized_input_t {
        std::vector<omega_byte_t> bytes;
        std::shared_ptr<file_backed_buffer_t> file_backed;
        int64_t length{};

        auto data() const -> const omega_byte_t * {
            if (file_backed) { return file_backed->data(); }
            return bytes.empty() ? nullptr : bytes.data();
        }
    };

    auto read_session_range_chunk_(int64_t relative_offset, omega_byte_t *buffer, int64_t length,
                                   void *user_data_ptr) -> int64_t;

    // Transfers plugin-owned response buffers to the caller. If no caller response is supplied,
    // the temporary response is cleared here so plugins never leak allocator-owned memory.
    void move_plugin_response_(plugin_allocator_state_t &state, omega_transform_plugin_response_t *response_ptr,
                               omega_transform_plugin_response_t &plugin_response) {
        if (!response_ptr) {
            clear_plugin_response_(state, &plugin_response);
            return;
        }
        omega_transform_plugin_response_clear(response_ptr);
        promote_response_allocations_(state, plugin_response);
        *response_ptr = plugin_response;
        plugin_response = {};
    }

    auto read_session_range_(const omega_session_t *session_ptr, int64_t offset, int64_t length,
                             omega_transform_plugin_progress_cbk_t progress, void *progress_user_data_ptr,
                             omega_transform_plugin_is_cancelled_t is_cancelled, void *cancel_user_data_ptr,
                             materialized_input_t &input) -> int {
        if (!session_ptr || offset < 0 || length < 0) { return -1; }
        if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) { return -1; }

        const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
        if (computed_file_size < 0 || offset > computed_file_size) { return -1; }
        const auto remaining = computed_file_size - offset;
        const auto requested_length = (length == 0 || length > remaining) ? remaining : length;
        if (requested_length < 0) { return -1; }
        if (requested_length == 0) {
            input = {};
            return 0;
        }

        omega_byte_t *destination = nullptr;
        if (requested_length <= TRANSFORM_PLUGIN_CONTIGUOUS_INPUT_LIMIT_BYTES) {
            size_t requested_size = 0;
            if (!int64_to_size_(requested_length, requested_size)) { return -1; }
            input.bytes.resize(requested_size);
            destination = input.bytes.data();
        } else {
            size_t requested_size = 0;
            if (!int64_to_size_(requested_length, requested_size)) { return -1; }
            input.file_backed = file_backed_buffer_t::create(omega_session_get_checkpoint_directory(session_ptr),
                                                             "OmegaEdit-xform-input", requested_size);
            if (!input.file_backed) { return -1; }
            destination = input.file_backed->data();
        }

        session_range_reader_t reader{
                session_ptr,         offset, requested_length, 0, progress, progress_user_data_ptr, is_cancelled,
                cancel_user_data_ptr};
        int64_t copied_length = 0;
        while (copied_length < requested_length) {
            if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) { return -1; }
            const auto chunk_length = std::min(TRANSFORM_PLUGIN_STREAM_CHUNK_BYTES, requested_length - copied_length);
            const auto read_length =
                    read_session_range_chunk_(copied_length, destination + copied_length, chunk_length, &reader);
            if (read_length <= 0) { return -1; }
            copied_length += read_length;
        }
        input.length = requested_length;
        return 0;
    }

    auto read_session_range_chunk_(int64_t relative_offset, omega_byte_t *buffer, int64_t length,
                                   void *user_data_ptr) -> int64_t {
        auto *reader = static_cast<session_range_reader_t *>(user_data_ptr);
        if (!reader || !reader->session_ptr || !buffer || relative_offset < 0 || length < 0 ||
            relative_offset > reader->length) {
            return -1;
        }
        if (reader->is_cancelled && reader->is_cancelled(reader->cancel_user_data_ptr) != 0) { return -1; }

        const auto remaining = reader->length - relative_offset;
        const auto read_length = std::min(std::min(length, remaining), TRANSFORM_PLUGIN_STREAM_CHUNK_BYTES);
        if (read_length == 0) { return 0; }

        auto *segment = omega_segment_create(read_length);
        if (!segment) { return -1; }
        const auto rc = omega_session_get_segment(reader->session_ptr, segment, reader->offset + relative_offset);
        if (rc != 0) {
            omega_segment_destroy(segment);
            return -1;
        }

        const auto segment_length = std::min(read_length, omega_segment_get_length(segment));
        auto *data = omega_segment_get_data(segment);
        if (segment_length > 0 && !data) {
            omega_segment_destroy(segment);
            return -1;
        }
        if (segment_length > 0) { std::memcpy(buffer, data, static_cast<size_t>(segment_length)); }
        omega_segment_destroy(segment);
        if (segment_length > 0 && reader->progress) {
            const auto processed = std::min(reader->length, relative_offset + segment_length);
            if (processed > reader->furthest_read) {
                reader->furthest_read = processed;
                omega_transform_plugin_progress_t progress{};
                progress.processed_bytes = processed;
                progress.total_bytes = reader->length;
                progress.percent =
                        reader->length > 0
                                ? (static_cast<double>(processed) / static_cast<double>(reader->length)) * 100.0
                                : 100.0;
                progress.phase = "reading";
                progress.flags = OMEGA_TRANSFORM_PROGRESS_HAS_PROCESSED_BYTES |
                                 OMEGA_TRANSFORM_PROGRESS_HAS_TOTAL_BYTES | OMEGA_TRANSFORM_PROGRESS_HAS_PERCENT;
                if (reader->progress(&progress, reader->progress_user_data_ptr) != 0) { return -1; }
            }
        }
        return segment_length;
    }

    template<typename T>
    auto write_pod_(std::ostream &out, const T &value) -> bool {
        out.write(reinterpret_cast<const char *>(&value), sizeof(T));
        return static_cast<bool>(out);
    }

    template<typename T>
    auto read_pod_(std::istream &in, T &value) -> bool {
        in.read(reinterpret_cast<char *>(&value), sizeof(T));
        return static_cast<bool>(in);
    }

    auto write_string_(std::ostream &out, const char *value) -> bool {
        const std::string text = value ? value : "";
        const auto length = static_cast<int64_t>(text.size());
        return write_pod_(out, length) &&
               (length == 0 || static_cast<bool>(out.write(text.data(), static_cast<std::streamsize>(length))));
    }

    auto read_string_(std::istream &in, std::string &value) -> bool {
        int64_t length = 0;
        if (!read_pod_(in, length) || length < 0) { return false; }
        value.assign(static_cast<size_t>(length), '\0');
        return length == 0 || static_cast<bool>(in.read(value.data(), static_cast<std::streamsize>(value.size())));
    }

    auto write_bytes_(std::ostream &out, const omega_byte_t *bytes, int64_t length) -> bool {
        if (length < 0 || (length > 0 && !bytes)) { return false; }
        return write_pod_(out, length) &&
               (length == 0 || static_cast<bool>(out.write(reinterpret_cast<const char *>(bytes),
                                                           static_cast<std::streamsize>(length))));
    }

    auto read_bytes_(std::istream &in, std::vector<omega_byte_t> &bytes) -> bool {
        int64_t length = 0;
        if (!read_pod_(in, length) || length < 0) { return false; }
        bytes.assign(static_cast<size_t>(length), omega_byte_t{});
        return length == 0 || static_cast<bool>(in.read(reinterpret_cast<char *>(bytes.data()),
                                                        static_cast<std::streamsize>(bytes.size())));
    }

    auto read_optional_string_(std::istream &in, std::string &value, bool &present) -> bool {
        uint8_t present_byte = 0;
        if (!read_pod_(in, present_byte)) { return false; }
        present = present_byte != 0;
        value.clear();
        return !present || read_string_(in, value);
    }

    struct host_command_monitor_t {
        bool (*poll)(void *user_data_ptr){};
        void *user_data_ptr{};
    };

    auto poll_host_command_monitor_(const host_command_monitor_t *monitor) -> bool {
        return !monitor || !monitor->poll || monitor->poll(monitor->user_data_ptr);
    }

    auto host_command_arguments_(const std::string &host_path, const std::string &command,
                                 const std::string &plugin_path, const std::string &request_path,
                                 const std::string &response_path) -> std::vector<std::string> {
        std::vector<std::string> args;
        args.reserve(request_path.empty() ? 4 : 5);
        args.emplace_back(host_path.empty() ? "omega-transform-plugin-host" : host_path);
        args.emplace_back(command);
        args.emplace_back(plugin_path);
        if (!request_path.empty()) { args.emplace_back(request_path); }
        args.emplace_back(response_path);
        return args;
    }

#ifdef _WIN32
    auto windows_quote_argument_(const std::string &value) -> std::string {
        if (value.empty()) { return "\"\""; }

        std::string quoted = "\"";
        size_t backslashes = 0;
        for (const auto ch : value) {
            if (ch == '\\') {
                ++backslashes;
                continue;
            }
            if (ch == '"') {
                quoted.append(backslashes * 2 + 1, '\\');
                quoted.push_back(ch);
                backslashes = 0;
                continue;
            }
            quoted.append(backslashes, '\\');
            backslashes = 0;
            quoted.push_back(ch);
        }
        quoted.append(backslashes * 2, '\\');
        quoted.push_back('"');
        return quoted;
    }
#endif

    auto create_temp_file_path_(const char *directory, const char *prefix, std::string &path_out) -> bool {
        std::string temp_directory;
        if (!directory || !*directory) {
            try {
                temp_directory = std::filesystem::temp_directory_path().string();
            } catch (const std::filesystem::filesystem_error &) { temp_directory = "."; }
        }
        const auto *const dir = (directory && *directory) ? directory : temp_directory.c_str();
        char path[FILENAME_MAX + 1];
        const auto count =
                snprintf(path, sizeof(path), "%s%c.%s.XXXXXX", dir, omega_util_directory_separator(), prefix);
        if (count < 0 || static_cast<size_t>(count) >= sizeof(path)) { return false; }
        const auto fd = omega_util_mkstemp(path, 0600);
        if (fd < 0) { return false; }
#ifdef _WIN32
        _close(fd);
#else
        close(fd);
#endif
        path_out = path;
        return true;
    }

    class scoped_temp_file_t {
    public:
        scoped_temp_file_t() = default;
        explicit scoped_temp_file_t(std::string path) : path_(std::move(path)) {}
        scoped_temp_file_t(const scoped_temp_file_t &) = delete;
        auto operator=(const scoped_temp_file_t &) -> scoped_temp_file_t & = delete;
        scoped_temp_file_t(scoped_temp_file_t &&other) noexcept : path_(std::move(other.path_)) { other.path_.clear(); }
        ~scoped_temp_file_t() { reset(); }

        auto path() const -> const std::string & { return path_; }

        void reset() {
            if (!path_.empty()) {
                omega_util_remove_file(path_.c_str());
                path_.clear();
            }
        }

    private:
        std::string path_;
    };

    auto run_host_command_(const std::string &host_path, const std::string &command, const std::string &plugin_path,
                           const std::string &request_path, const std::string &response_path,
                           const host_command_monitor_t *monitor = nullptr) -> bool {
        const auto args = host_command_arguments_(host_path, command, plugin_path, request_path, response_path);
#ifdef _WIN32
        std::ostringstream cmd;
        for (size_t i = 0; i < args.size(); ++i) {
            if (i != 0) { cmd << ' '; }
            cmd << windows_quote_argument_(args[i]);
        }
        const auto command_line = cmd.str();
        std::vector<char> mutable_command_line(command_line.begin(), command_line.end());
        mutable_command_line.push_back('\0');

        STARTUPINFOA startup_info{};
        startup_info.cb = sizeof(startup_info);
        PROCESS_INFORMATION process_info{};
        if (!CreateProcessA(nullptr, mutable_command_line.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr,
                            &startup_info, &process_info)) {
            return false;
        }

        DWORD wait_result = WAIT_FAILED;
        do {
            wait_result = WaitForSingleObject(process_info.hProcess, monitor ? 50U : INFINITE);
            if (wait_result == WAIT_TIMEOUT && !poll_host_command_monitor_(monitor)) {
                TerminateProcess(process_info.hProcess, 1);
                WaitForSingleObject(process_info.hProcess, INFINITE);
                CloseHandle(process_info.hThread);
                CloseHandle(process_info.hProcess);
                return false;
            }
        } while (wait_result == WAIT_TIMEOUT);

        DWORD exit_code = 1;
        const auto got_exit_code = GetExitCodeProcess(process_info.hProcess, &exit_code);
        CloseHandle(process_info.hThread);
        CloseHandle(process_info.hProcess);
        return wait_result == WAIT_OBJECT_0 && got_exit_code && exit_code == 0;
#else
        std::vector<char *> argv;
        argv.reserve(args.size() + 1);
        for (const auto &arg : args) { argv.push_back(const_cast<char *>(arg.c_str())); }
        argv.push_back(nullptr);

        const auto pid = fork();
        if (pid < 0) { return false; }
        if (pid == 0) {
            execvp(argv[0], argv.data());
            _exit(127);
        }

        int status = 0;
        while (true) {
            const auto waited = waitpid(pid, &status, monitor ? WNOHANG : 0);
            if (waited == pid) { break; }
            if (waited < 0) {
                if (errno == EINTR) { continue; }
                return false;
            }
            if (!poll_host_command_monitor_(monitor)) {
                kill(pid, SIGTERM);
                while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
                return false;
            }
            usleep(50000);
        }
        return WIFEXITED(status) && WEXITSTATUS(status) == 0;
#endif
    }

    auto write_host_apply_request_(const std::string &request_path, int64_t session_offset, int64_t session_length,
                                   const char *options_json, const materialized_input_t &input,
                                   const std::string &progress_path, const std::string &cancel_path) -> bool {
        std::ofstream out(request_path, std::ios::binary | std::ios::trunc);
        if (!out) { return false; }
        return write_pod_(out, PROCESS_HOST_REQUEST_MAGIC) && write_pod_(out, session_offset) &&
               write_pod_(out, session_length) && write_pod_(out, TRANSFORM_PLUGIN_STREAM_CHUNK_BYTES) &&
               write_string_(out, options_json) && write_bytes_(out, input.data(), input.length) &&
               write_string_(out, progress_path.c_str()) && write_string_(out, cancel_path.c_str());
    }

    struct host_apply_control_t {
        std::string progress_path;
        std::string cancel_path;
        std::streampos progress_offset{};
        omega_transform_plugin_progress_cbk_t progress{};
        void *progress_user_data_ptr{};
        omega_transform_plugin_is_cancelled_t is_cancelled{};
        void *cancel_user_data_ptr{};
        bool cancel_requested{};
    };

    auto write_host_cancel_request_(const std::string &cancel_path, bool cancel) -> bool {
        if (cancel_path.empty()) { return true; }
        std::ofstream out(cancel_path, std::ios::binary | std::ios::trunc);
        const uint8_t cancel_byte = cancel ? 1U : 0U;
        return out && write_pod_(out, cancel_byte);
    }

    auto request_host_cancel_(host_apply_control_t &control) -> bool {
        control.cancel_requested = true;
        return write_host_cancel_request_(control.cancel_path, true);
    }

    auto read_host_progress_events_(host_apply_control_t &control) -> bool {
        if (!control.progress || control.progress_path.empty()) { return true; }

        std::ifstream in(control.progress_path, std::ios::binary);
        if (!in) { return false; }
        in.seekg(control.progress_offset);

        while (true) {
            const auto record_start = in.tellg();
            uint32_t magic = 0;
            int64_t processed_bytes = 0;
            int64_t total_bytes = 0;
            double percent = 0.0;
            uint32_t flags = 0;
            std::string phase;
            std::string message;
            if (!read_pod_(in, magic)) { break; }
            if (magic != PROCESS_HOST_PROGRESS_MAGIC) { return false; }
            if (!read_pod_(in, processed_bytes) || !read_pod_(in, total_bytes) || !read_pod_(in, percent) ||
                !read_pod_(in, flags) || !read_string_(in, phase) || !read_string_(in, message)) {
                in.clear();
                in.seekg(record_start);
                break;
            }

            omega_transform_plugin_progress_t progress{};
            progress.processed_bytes = processed_bytes;
            progress.total_bytes = total_bytes;
            progress.percent = percent;
            progress.flags = flags;
            progress.phase = phase.empty() ? nullptr : phase.c_str();
            progress.message = message.empty() ? nullptr : message.c_str();
            if (control.progress(&progress, control.progress_user_data_ptr) != 0 && !request_host_cancel_(control)) {
                return false;
            }

            const auto record_end = in.tellg();
            if (record_end == std::streampos(-1)) { break; }
            control.progress_offset = record_end;
        }
        return true;
    }

    auto poll_host_apply_control_(void *user_data_ptr) -> bool {
        auto *control = static_cast<host_apply_control_t *>(user_data_ptr);
        if (!control) { return true; }
        if (!read_host_progress_events_(*control)) { return false; }
        if (control->is_cancelled && control->is_cancelled(control->cancel_user_data_ptr) != 0) {
            return request_host_cancel_(*control);
        }
        return true;
    }

    auto read_host_info_response_(const std::string &response_path, loaded_plugin_t &plugin) -> bool {
        std::ifstream in(response_path, std::ios::binary);
        uint32_t magic = 0;
        int32_t status = -1;
        if (!in || !read_pod_(in, magic) || magic != PROCESS_HOST_INFO_MAGIC || !read_pod_(in, status) || status != 0) {
            return false;
        }

        omega_transform_plugin_info_t info{};
        int32_t operation = 0;
        int32_t support = 0;
        if (!read_pod_(in, info.abi_version) || !read_pod_(in, operation) || !read_pod_(in, info.flags) ||
            !read_pod_(in, support)) {
            return false;
        }

        plugin_info_storage_t storage;
        if (!read_string_(in, storage.id) || !read_string_(in, storage.name) ||
            !read_string_(in, storage.description) || !read_string_(in, storage.help) ||
            !read_string_(in, storage.example) || !read_string_(in, storage.default_args) ||
            !read_string_(in, storage.args_schema)) {
            return false;
        }

        info.operation = static_cast<omega_transform_plugin_operation_t>(operation);
        info.support = static_cast<omega_transform_plugin_support_t>(support);
        info.id = storage.id.empty() ? nullptr : storage.id.c_str();
        info.name = storage.name.empty() ? nullptr : storage.name.c_str();
        info.description = storage.description.empty() ? nullptr : storage.description.c_str();
        info.help = storage.help.empty() ? nullptr : storage.help.c_str();
        info.example = storage.example.empty() ? nullptr : storage.example.c_str();
        info.default_args = storage.default_args.empty() ? nullptr : storage.default_args.c_str();
        info.args_schema = storage.args_schema.empty() ? nullptr : storage.args_schema.c_str();
        assign_plugin_info_(plugin, info);
        return plugin_info_is_valid_(plugin.info);
    }

    auto copy_host_bytes_(plugin_allocator_state_t &allocator_state, const std::vector<omega_byte_t> &source,
                          omega_byte_t **bytes_out, int64_t *length_out) -> bool {
        if (!bytes_out || !length_out) { return false; }
        *bytes_out = nullptr;
        *length_out = static_cast<int64_t>(source.size());
        if (source.empty()) { return true; }
        auto *copy = static_cast<omega_byte_t *>(plugin_alloc_(source.size(), &allocator_state));
        if (!copy) { return false; }
        std::memcpy(copy, source.data(), source.size());
        *bytes_out = copy;
        return true;
    }

    auto copy_host_string_(plugin_allocator_state_t &allocator_state, const std::string &source, bool present,
                           char **string_out) -> bool {
        if (!string_out) { return false; }
        *string_out = nullptr;
        if (!present) { return true; }
        auto *copy = static_cast<char *>(plugin_alloc_(source.size() + 1, &allocator_state));
        if (!copy) { return false; }
        std::memcpy(copy, source.c_str(), source.size() + 1);
        *string_out = copy;
        return true;
    }

    auto read_host_apply_response_(const std::string &response_path, plugin_allocator_state_t &allocator_state,
                                   omega_transform_plugin_response_t &response) -> bool {
        std::ifstream in(response_path, std::ios::binary);
        uint32_t magic = 0;
        int32_t status = -1;
        if (!in || !read_pod_(in, magic) || magic != PROCESS_HOST_RESPONSE_MAGIC || !read_pod_(in, status) ||
            status != 0) {
            return false;
        }

        uint32_t flags = 0;
        std::vector<omega_byte_t> replacement;
        std::vector<omega_byte_t> result;
        std::string result_label;
        std::string result_mime_type;
        bool has_result_label = false;
        bool has_result_mime_type = false;
        if (!read_pod_(in, flags) || !read_bytes_(in, replacement) || !read_bytes_(in, result) ||
            !read_optional_string_(in, result_label, has_result_label) ||
            !read_optional_string_(in, result_mime_type, has_result_mime_type)) {
            return false;
        }

        response = {};
        response.flags = flags;
        return copy_host_bytes_(allocator_state, replacement, &response.replacement_bytes,
                                &response.replacement_length) &&
               copy_host_bytes_(allocator_state, result, &response.result_bytes, &response.result_length) &&
               copy_host_string_(allocator_state, result_label, has_result_label, &response.result_label) &&
               copy_host_string_(allocator_state, result_mime_type, has_result_mime_type, &response.result_mime_type);
    }

    auto materialize_reader_input_(int64_t session_length, const char *checkpoint_directory,
                                   omega_transform_plugin_read_t read, void *reader_user_data_ptr,
                                   int64_t preferred_chunk_size, omega_transform_plugin_progress_cbk_t progress,
                                   void *progress_user_data_ptr, omega_transform_plugin_is_cancelled_t is_cancelled,
                                   void *cancel_user_data_ptr, materialized_input_t &input) -> int {
        if (!read || session_length < 0) { return -1; }
        if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) { return -1; }
        if (session_length == 0) {
            input = {};
            return 0;
        }

        size_t requested_size = 0;
        if (!int64_to_size_(session_length, requested_size)) { return -1; }
        omega_byte_t *destination = nullptr;
        if (session_length <= TRANSFORM_PLUGIN_CONTIGUOUS_INPUT_LIMIT_BYTES) {
            input.bytes.resize(requested_size);
            destination = input.bytes.data();
        } else {
            input.file_backed =
                    file_backed_buffer_t::create(checkpoint_directory, "OmegaEdit-xform-reader", requested_size);
            if (!input.file_backed) { return -1; }
            destination = input.file_backed->data();
        }

        const auto chunk_limit = preferred_chunk_size > 0
                                         ? std::min(preferred_chunk_size, TRANSFORM_PLUGIN_STREAM_CHUNK_BYTES)
                                         : TRANSFORM_PLUGIN_STREAM_CHUNK_BYTES;
        int64_t copied_length = 0;
        while (copied_length < session_length) {
            if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) { return -1; }
            const auto chunk_length = std::min(chunk_limit, session_length - copied_length);
            const auto read_length =
                    read(copied_length, destination + copied_length, chunk_length, reader_user_data_ptr);
            if (read_length <= 0 || read_length > chunk_length) { return -1; }
            copied_length += read_length;
            if (progress) {
                omega_transform_plugin_progress_t progress_event{};
                progress_event.processed_bytes = copied_length;
                progress_event.total_bytes = session_length;
                progress_event.percent =
                        session_length > 0
                                ? (static_cast<double>(copied_length) / static_cast<double>(session_length)) * 100.0
                                : 100.0;
                progress_event.phase = "reading";
                progress_event.flags = OMEGA_TRANSFORM_PROGRESS_HAS_PROCESSED_BYTES |
                                       OMEGA_TRANSFORM_PROGRESS_HAS_TOTAL_BYTES | OMEGA_TRANSFORM_PROGRESS_HAS_PERCENT;
                if (progress(&progress_event, progress_user_data_ptr) != 0) { return -1; }
            }
        }
        input.length = session_length;
        return 0;
    }

    auto invoke_isolated_plugin_(const loaded_plugin_t &plugin, const std::string &host_path, int64_t session_offset,
                                 int64_t session_length, const char *options_json, const materialized_input_t &input,
                                 plugin_allocator_state_t &allocator_state,
                                 omega_transform_plugin_progress_cbk_t progress, void *progress_user_data_ptr,
                                 omega_transform_plugin_is_cancelled_t is_cancelled, void *cancel_user_data_ptr,
                                 omega_transform_plugin_response_t &response) -> bool {
        std::string request_path;
        std::string response_path;
        std::string progress_path;
        std::string cancel_path;
        const auto *checkpoint_directory = allocator_state.checkpoint_directory;
        if (!create_temp_file_path_(checkpoint_directory, "OmegaEdit-xform-request", request_path) ||
            !create_temp_file_path_(checkpoint_directory, "OmegaEdit-xform-response", response_path)) {
            return false;
        }
        if (progress && !create_temp_file_path_(checkpoint_directory, "OmegaEdit-xform-progress", progress_path)) {
            return false;
        }
        if ((progress || is_cancelled) &&
            !create_temp_file_path_(checkpoint_directory, "OmegaEdit-xform-cancel", cancel_path)) {
            return false;
        }
        scoped_temp_file_t request_file(request_path);
        scoped_temp_file_t response_file(response_path);
        scoped_temp_file_t progress_file(progress_path);
        scoped_temp_file_t cancel_file(cancel_path);
        host_apply_control_t control{progress_path,          cancel_path,  std::streampos(0),    progress,
                                     progress_user_data_ptr, is_cancelled, cancel_user_data_ptr, false};
        host_command_monitor_t monitor{poll_host_apply_control_, &control};

        if (!write_host_cancel_request_(cancel_path, false)) { return false; }
        if (!write_host_apply_request_(request_path, session_offset, session_length, options_json, input, progress_path,
                                       cancel_path)) {
            return false;
        }
        if (!run_host_command_(host_path, "--apply", plugin.path, request_path, response_path,
                               (progress || is_cancelled) ? &monitor : nullptr)) {
            return false;
        }
        if (!poll_host_apply_control_(&control) || control.cancel_requested) { return false; }
        return read_host_apply_response_(response_path, allocator_state, response);
    }

    auto env_value_is_true_(const char *value) -> bool {
        if (!value) { return false; }
        std::string normalized;
        normalized.reserve(std::strlen(value));
        for (const char *ptr = value; *ptr; ++ptr) {
            normalized.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(*ptr))));
        }
        return normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on";
    }

}// namespace

struct omega_transform_plugin_registry_struct {
    std::vector<std::unique_ptr<loaded_plugin_t>> plugins;
    plugin_allocation_store_t allocation_store;
    std::string host_path;
    bool allow_experimental{};
    bool allow_test{};
};

namespace {
    auto plugin_support_allowed_(const omega_transform_plugin_registry_t *registry_ptr,
                                 omega_transform_plugin_support_t support) -> bool {
        if (!registry_ptr) { return false; }
        switch (support) {
            case OMEGA_TRANSFORM_PLUGIN_SUPPORT_PRODUCTION:
                return true;
            case OMEGA_TRANSFORM_PLUGIN_SUPPORT_EXPERIMENTAL:
                return registry_ptr->allow_experimental;
            case OMEGA_TRANSFORM_PLUGIN_SUPPORT_TEST:
                return registry_ptr->allow_test;
        }
        return false;
    }
}// namespace

omega_transform_plugin_registry_t *omega_transform_plugin_registry_create(void) {
    auto *registry = new omega_transform_plugin_registry_t();
    if (const auto *env = std::getenv("OMEGA_EDIT_TRANSFORM_PLUGIN_HOST")) { registry->host_path = env; }
    registry->allow_experimental = env_value_is_true_(std::getenv("OMEGA_EDIT_TRANSFORM_PLUGIN_ALLOW_EXPERIMENTAL"));
    registry->allow_test = env_value_is_true_(std::getenv("OMEGA_EDIT_TRANSFORM_PLUGIN_ALLOW_TEST"));
    return registry;
}

void omega_transform_plugin_registry_destroy(omega_transform_plugin_registry_t *registry_ptr) { delete registry_ptr; }

int omega_transform_plugin_registry_register_plugin(omega_transform_plugin_registry_t *registry_ptr,
                                                    const char *plugin_path) {
    if (!registry_ptr || !plugin_path || !*plugin_path) { return -1; }

    auto plugin = std::make_unique<loaded_plugin_t>();
    plugin->path = plugin_path;
    std::string response_path;
    if (!create_temp_file_path_(nullptr, "OmegaEdit-xform-info", response_path)) { return -1; }
    scoped_temp_file_t response_file(response_path);
    if (!run_host_command_(registry_ptr->host_path, "--get-info", plugin->path, "", response_path) ||
        !read_host_info_response_(response_path, *plugin)) {
        return -1;
    }
    if (!plugin_support_allowed_(registry_ptr, plugin->info.support)) { return -1; }
    if (omega_transform_plugin_registry_find_info(registry_ptr, plugin->info.id) != nullptr) { return -1; }

    registry_ptr->plugins.push_back(std::move(plugin));
    return 0;
}

int omega_transform_plugin_registry_register_directory(omega_transform_plugin_registry_t *registry_ptr,
                                                       const char *plugin_directory) {
    if (!registry_ptr || !plugin_directory || !*plugin_directory) { return -1; }
    const std::filesystem::path directory(plugin_directory);

    int loaded_count = 0;
    try {
        if (!std::filesystem::is_directory(directory)) { return -1; }
        for (const auto &entry : std::filesystem::directory_iterator(directory)) {
            if (!entry.is_regular_file() || !plugin_extension_is_supported_(entry.path())) { continue; }
            const auto path = entry.path().string();
            if (0 == omega_transform_plugin_registry_register_plugin(registry_ptr, path.c_str())) { ++loaded_count; }
        }
    } catch (const std::filesystem::filesystem_error &) { return loaded_count > 0 ? loaded_count : -1; }
    return loaded_count;
}

int omega_transform_plugin_registry_set_host_path(omega_transform_plugin_registry_t *registry_ptr,
                                                  const char *host_path) {
    if (!registry_ptr || !registry_ptr->plugins.empty()) { return -1; }
    registry_ptr->host_path = host_path ? host_path : "";
    return 0;
}

int omega_transform_plugin_registry_set_allow_experimental(omega_transform_plugin_registry_t *registry_ptr, int allow) {
    if (!registry_ptr || !registry_ptr->plugins.empty()) { return -1; }
    registry_ptr->allow_experimental = allow != 0;
    return 0;
}

int omega_transform_plugin_registry_set_allow_test(omega_transform_plugin_registry_t *registry_ptr, int allow) {
    if (!registry_ptr || !registry_ptr->plugins.empty()) { return -1; }
    registry_ptr->allow_test = allow != 0;
    return 0;
}

int64_t omega_transform_plugin_registry_get_count(const omega_transform_plugin_registry_t *registry_ptr) {
    if (!registry_ptr) { return 0; }
    return static_cast<int64_t>(registry_ptr->plugins.size());
}

int omega_transform_plugin_options_match_args_schema(const char *options_json, const char *args_schema) {
    return options_match_args_schema_(options_json, args_schema) ? 0 : -1;
}

const omega_transform_plugin_info_t *
omega_transform_plugin_registry_get_info(const omega_transform_plugin_registry_t *registry_ptr, int64_t index) {
    if (!registry_ptr || index < 0 || index >= static_cast<int64_t>(registry_ptr->plugins.size())) { return nullptr; }
    return &registry_ptr->plugins[static_cast<size_t>(index)]->info;
}

const omega_transform_plugin_info_t *
omega_transform_plugin_registry_find_info(const omega_transform_plugin_registry_t *registry_ptr,
                                          const char *plugin_id) {
    if (!registry_ptr || !plugin_id || !*plugin_id) { return nullptr; }
    const auto iter =
            std::find_if(registry_ptr->plugins.cbegin(), registry_ptr->plugins.cend(),
                         [plugin_id](const auto &plugin) { return plugin->info.id == std::string(plugin_id); });
    return iter != registry_ptr->plugins.cend() ? &(*iter)->info : nullptr;
}

int omega_transform_plugin_registry_apply_to_session(omega_transform_plugin_registry_t *registry_ptr,
                                                     const char *plugin_id, omega_session_t *session_ptr,
                                                     int64_t offset, int64_t length, const char *options_json,
                                                     omega_transform_plugin_response_t *response_ptr) {
    return omega_transform_plugin_registry_apply_to_session_with_progress(
            registry_ptr, plugin_id, session_ptr, offset, length, options_json, nullptr, nullptr, response_ptr);
}

int omega_transform_plugin_registry_apply_to_session_with_progress(
        omega_transform_plugin_registry_t *registry_ptr, const char *plugin_id, omega_session_t *session_ptr,
        int64_t offset, int64_t length, const char *options_json, omega_transform_plugin_progress_cbk_t progress,
        void *progress_user_data_ptr, omega_transform_plugin_response_t *response_ptr) {
    return omega_transform_plugin_registry_apply_to_session_with_progress_and_serial(
            registry_ptr, plugin_id, session_ptr, offset, length, options_json, progress, progress_user_data_ptr,
            response_ptr, nullptr);
}

int omega_transform_plugin_registry_apply_to_session_with_progress_and_serial(
        omega_transform_plugin_registry_t *registry_ptr, const char *plugin_id, omega_session_t *session_ptr,
        int64_t offset, int64_t length, const char *options_json, omega_transform_plugin_progress_cbk_t progress,
        void *progress_user_data_ptr, omega_transform_plugin_response_t *response_ptr, int64_t *change_serial_out) {
    return omega_transform_plugin_registry_apply_to_session_with_progress_cancel_and_serial(
            registry_ptr, plugin_id, session_ptr, offset, length, options_json, progress, progress_user_data_ptr,
            nullptr, nullptr, response_ptr, change_serial_out);
}

int omega_transform_plugin_registry_apply_to_session_with_progress_cancel_and_serial(
        omega_transform_plugin_registry_t *registry_ptr, const char *plugin_id, omega_session_t *session_ptr,
        int64_t offset, int64_t length, const char *options_json, omega_transform_plugin_progress_cbk_t progress,
        void *progress_user_data_ptr, omega_transform_plugin_is_cancelled_t is_cancelled, void *cancel_user_data_ptr,
        omega_transform_plugin_response_t *response_ptr, int64_t *change_serial_out) {
    if (response_ptr) { omega_transform_plugin_response_clear(response_ptr); }
    if (change_serial_out) { *change_serial_out = 0; }
    if (!registry_ptr || !plugin_id || !*plugin_id || !session_ptr || offset < 0 || length < 0) { return -1; }
    if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) { return -1; }

    // The registry owns plugin lookup/lifetime, but omega_session_t itself is not thread-safe.
    // Callers that share sessions across threads must hold their session/core lock across this call.
    auto iter = std::find_if(registry_ptr->plugins.begin(), registry_ptr->plugins.end(),
                             [plugin_id](const auto &plugin) { return plugin->info.id == std::string(plugin_id); });
    if (iter == registry_ptr->plugins.end()) { return -1; }
    if (0 != omega_transform_plugin_options_match_args_schema(options_json, (*iter)->info.args_schema)) { return -1; }

    const auto computed_file_size = omega_session_get_computed_file_size(session_ptr);
    const auto requested_length =
            length == 0 ? computed_file_size - offset : std::min(length, computed_file_size - offset);
    if (requested_length < 0) { return -1; }

    const auto operation = (*iter)->info.operation;

    materialized_input_t input;
    if (0 != read_session_range_(session_ptr, offset, length, progress, progress_user_data_ptr, is_cancelled,
                                 cancel_user_data_ptr, input)) {
        return -1;
    }

    plugin_allocator_state_t allocator_state{omega_session_get_checkpoint_directory(session_ptr),
                                             &registry_ptr->allocation_store,
                                             {}};

    omega_transform_plugin_response_t plugin_response{};
    if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) { return -1; }
    if (!invoke_isolated_plugin_(**iter, registry_ptr->host_path, offset, requested_length, options_json, input,
                                 allocator_state, progress, progress_user_data_ptr, is_cancelled, cancel_user_data_ptr,
                                 plugin_response)) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        clear_plugin_response_(allocator_state, &plugin_response);
        return -1;
    }
    if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        clear_plugin_response_(allocator_state, &plugin_response);
        return -1;
    }
    if (!plugin_buffer_is_valid_(plugin_response.replacement_bytes, plugin_response.replacement_length) ||
        !plugin_buffer_is_valid_(plugin_response.result_bytes, plugin_response.result_length)) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        clear_plugin_response_(allocator_state, &plugin_response);
        return -1;
    }
    if (plugin_response_has_no_content_change_(plugin_response) &&
        (plugin_response.replacement_bytes != nullptr || plugin_response.replacement_length != 0)) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        clear_plugin_response_(allocator_state, &plugin_response);
        return -1;
    }

    if (operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE ||
        operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT) {
        const auto no_content_change = plugin_response_has_no_content_change_(plugin_response);
        if (!no_content_change && requested_length == 0 && plugin_response.replacement_length == 0) {
            release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
            clear_plugin_response_(allocator_state, &plugin_response);
            return -1;
        }
        if (no_content_change) {
            if (change_serial_out) { *change_serial_out = 0; }
        } else {
            const auto change_serial = omega_edit_replace_bytes_as_transform(
                    session_ptr, offset, requested_length, plugin_response.replacement_bytes,
                    plugin_response.replacement_length, plugin_id, options_json);
            if (change_serial <= 0) {
                release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
                clear_plugin_response_(allocator_state, &plugin_response);
                return -1;
            }
            if (change_serial_out) { *change_serial_out = change_serial; }
        }
    }

    release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
    move_plugin_response_(allocator_state, response_ptr, plugin_response);
    return 0;
}

int omega_transform_plugin_registry_inspect_reader(omega_transform_plugin_registry_t *registry_ptr,
                                                   const char *plugin_id, int64_t session_offset,
                                                   int64_t session_length, const char *options_json,
                                                   const char *checkpoint_directory, omega_transform_plugin_read_t read,
                                                   void *reader_user_data_ptr, int64_t preferred_chunk_size,
                                                   omega_transform_plugin_progress_cbk_t progress,
                                                   void *progress_user_data_ptr,
                                                   omega_transform_plugin_response_t *response_ptr) {
    return omega_transform_plugin_registry_inspect_reader_with_cancel(
            registry_ptr, plugin_id, session_offset, session_length, options_json, checkpoint_directory, read,
            reader_user_data_ptr, preferred_chunk_size, progress, progress_user_data_ptr, nullptr, nullptr,
            response_ptr);
}

int omega_transform_plugin_registry_inspect_reader_with_cancel(
        omega_transform_plugin_registry_t *registry_ptr, const char *plugin_id, int64_t session_offset,
        int64_t session_length, const char *options_json, const char *checkpoint_directory,
        omega_transform_plugin_read_t read, void *reader_user_data_ptr, int64_t preferred_chunk_size,
        omega_transform_plugin_progress_cbk_t progress, void *progress_user_data_ptr,
        omega_transform_plugin_is_cancelled_t is_cancelled, void *cancel_user_data_ptr,
        omega_transform_plugin_response_t *response_ptr) {
    if (response_ptr) { omega_transform_plugin_response_clear(response_ptr); }
    if (!registry_ptr || !plugin_id || !*plugin_id || session_offset < 0 || session_length < 0 || !read) { return -1; }
    if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) { return -1; }

    auto iter = std::find_if(registry_ptr->plugins.begin(), registry_ptr->plugins.end(),
                             [plugin_id](const auto &plugin) { return plugin->info.id == std::string(plugin_id); });
    if (iter == registry_ptr->plugins.end()) { return -1; }
    if ((*iter)->info.operation != OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT) { return -1; }
    if (((*iter)->info.flags & OMEGA_TRANSFORM_PLUGIN_FLAG_STREAMING) == 0U) { return -1; }
    if (0 != omega_transform_plugin_options_match_args_schema(options_json, (*iter)->info.args_schema)) { return -1; }

    plugin_allocator_state_t allocator_state{checkpoint_directory, &registry_ptr->allocation_store, {}};
    materialized_input_t input;
    if (0 != materialize_reader_input_(session_length, checkpoint_directory, read, reader_user_data_ptr,
                                       preferred_chunk_size, progress, progress_user_data_ptr, is_cancelled,
                                       cancel_user_data_ptr, input)) {
        return -1;
    }

    omega_transform_plugin_response_t plugin_response{};
    if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) { return -1; }
    if (!invoke_isolated_plugin_(**iter, registry_ptr->host_path, session_offset, session_length, options_json, input,
                                 allocator_state, progress, progress_user_data_ptr, is_cancelled, cancel_user_data_ptr,
                                 plugin_response)) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        clear_plugin_response_(allocator_state, &plugin_response);
        return -1;
    }
    if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        clear_plugin_response_(allocator_state, &plugin_response);
        return -1;
    }
    if (!plugin_buffer_is_valid_(plugin_response.replacement_bytes, plugin_response.replacement_length) ||
        !plugin_buffer_is_valid_(plugin_response.result_bytes, plugin_response.result_length) ||
        plugin_response.replacement_bytes != nullptr || plugin_response.replacement_length != 0) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        clear_plugin_response_(allocator_state, &plugin_response);
        return -1;
    }

    release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
    move_plugin_response_(allocator_state, response_ptr, plugin_response);
    return 0;
}

void omega_transform_plugin_response_clear(omega_transform_plugin_response_t *response_ptr) {
    if (!response_ptr) { return; }
    release_plugin_allocation_(nullptr, response_ptr->replacement_bytes);
    release_plugin_allocation_(nullptr, response_ptr->result_bytes);
    release_plugin_allocation_(nullptr, response_ptr->result_label);
    release_plugin_allocation_(nullptr, response_ptr->result_mime_type);
    *response_ptr = {};
}
