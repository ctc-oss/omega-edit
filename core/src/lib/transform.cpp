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
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <regex>
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
#include <dlfcn.h>
#include <sys/mman.h>
#include <unistd.h>
#endif

namespace {
    constexpr size_t OMEGA_SCHEMA_REGEX_CACHE_LIMIT = 128;
    constexpr size_t OMEGA_SCHEMA_REGEX_MAX_PATTERN_BYTES = 4096;

    struct dynamic_library_t {
#ifdef _WIN32
        HMODULE handle{};
#else
        void *handle{};
#endif

        dynamic_library_t() = default;
        explicit dynamic_library_t(const char *path) {
#ifdef _WIN32
            handle = LoadLibraryA(path);
#else
            handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
#endif
        }

        dynamic_library_t(const dynamic_library_t &) = delete;
        auto operator=(const dynamic_library_t &) -> dynamic_library_t & = delete;

        dynamic_library_t(dynamic_library_t &&other) noexcept : handle(other.handle) { other.handle = nullptr; }

        auto operator=(dynamic_library_t &&other) noexcept -> dynamic_library_t & {
            if (this != &other) {
                close();
                handle = other.handle;
                other.handle = nullptr;
            }
            return *this;
        }

        ~dynamic_library_t() { close(); }

        auto ok() const -> bool { return handle != nullptr; }

        auto symbol(const char *name) const -> void * {
            if (!handle) { return nullptr; }
#ifdef _WIN32
            return reinterpret_cast<void *>(GetProcAddress(handle, name));
#else
            return dlsym(handle, name);
#endif
        }

    private:
        void close() {
            if (!handle) { return; }
#ifdef _WIN32
            FreeLibrary(handle);
#else
            dlclose(handle);
#endif
            handle = nullptr;
        }
    };

    struct loaded_plugin_t {
        dynamic_library_t library;
        omega_transform_plugin_info_t info{};
        omega_transform_plugin_apply_fn apply{};
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
            if (!parse_value(value)) { return false; }
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

        auto parse_value(json_value_t &value) -> bool {
            skip_ws();
            switch (input_[pos_]) {
                case '{':
                    return parse_object(value);
                case '[':
                    return parse_array(value);
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

        auto parse_object(json_value_t &value) -> bool {
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
                if (!parse_value(member)) { return false; }
                value.object_value[key] = std::move(member);
                skip_ws();
                if (consume('}')) { return true; }
                if (!consume(',')) { return false; }
            }
            return false;
        }

        auto parse_array(json_value_t &value) -> bool {
            if (!consume('[')) { return false; }
            value = {};
            value.kind = json_value_t::kind_t::array;
            skip_ws();
            if (consume(']')) { return true; }
            while (input_[pos_] != '\0') {
                json_value_t item;
                if (!parse_value(item)) { return false; }
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

    auto json_values_equal_(const json_value_t &left, const json_value_t &right) -> bool {
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
                    if (!json_values_equal_(left.array_value[index], right.array_value[index])) { return false; }
                }
                return true;
            case json_value_t::kind_t::object:
                if (left.object_value.size() != right.object_value.size()) { return false; }
                for (const auto &[key, left_value] : left.object_value) {
                    const auto right_iter = right.object_value.find(key);
                    if (right_iter == right.object_value.end()) { return false; }
                    if (!json_values_equal_(left_value, right_iter->second)) { return false; }
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

    auto validate_schema_value_(const json_value_t &value, const json_value_t &schema) -> bool {
        if (schema.kind != json_value_t::kind_t::object) { return false; }

        const auto *one_of = json_object_member_(schema, "oneOf");
        if (one_of) {
            if (one_of->kind != json_value_t::kind_t::array) { return false; }
            auto matches = 0;
            for (const auto &candidate : one_of->array_value) {
                if (validate_schema_value_(value, candidate)) { ++matches; }
            }
            if (matches != 1) { return false; }
        }

        const auto *not_schema = json_object_member_(schema, "not");
        if (not_schema && validate_schema_value_(value, *not_schema)) { return false; }

        if (const auto *enum_values = json_object_member_(schema, "enum")) {
            if (enum_values->kind != json_value_t::kind_t::array) { return false; }
            auto matches = false;
            for (const auto &candidate : enum_values->array_value) {
                if (json_values_equal_(value, candidate)) {
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
            if (type == "integer") {
                if (value.kind != json_value_t::kind_t::number) { return false; }
                const auto integer_value = static_cast<int64_t>(value.number_value);
                if (value.number_value != static_cast<double>(integer_value)) { return false; }
            }
            if (type != "object" && type != "array" && type != "string" && type != "integer") { return false; }
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
                    if (!validate_schema_value_(member, property_iter->second)) { return false; }
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
                    if (!validate_schema_value_(item, *items)) { return false; }
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

    auto options_match_args_schema_(const char *options_json, const char *args_schema) -> bool {
        if (!options_json || !*options_json) { return true; }
        if (!args_schema || !*args_schema) { return false; }
        json_value_t options;
        json_value_t schema;
        if (!json_parser_t(options_json).parse(options)) { return false; }
        if (!json_parser_t(args_schema).parse(schema)) { return false; }
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

    std::mutex g_file_backed_allocations_mutex;
    std::unordered_map<void *, std::shared_ptr<file_backed_buffer_t>> g_file_backed_allocations;

    void release_plugin_allocation_(void *ptr) {
        if (!ptr) { return; }
        std::shared_ptr<file_backed_buffer_t> file_backed;
        {
            std::lock_guard<std::mutex> lock(g_file_backed_allocations_mutex);
            const auto iter = g_file_backed_allocations.find(ptr);
            if (iter != g_file_backed_allocations.end()) {
                file_backed = std::move(iter->second);
                g_file_backed_allocations.erase(iter);
            }
        }
        if (!file_backed) { std::free(ptr); }
    }

    struct plugin_allocator_state_t {
        const char *checkpoint_directory{};
        std::vector<void *> allocations;
    };

    void *plugin_alloc_(size_t size, void *user_data_ptr) {
        auto *state = static_cast<plugin_allocator_state_t *>(user_data_ptr);
        const auto requested_size = size == 0 ? 1 : size;
        void *ptr = nullptr;
        if (requested_size > TRANSFORM_PLUGIN_FILE_BACKED_ALLOC_LIMIT_BYTES && state) {
            auto file_backed =
                    file_backed_buffer_t::create(state->checkpoint_directory, "OmegaEdit-xform-alloc", requested_size);
            if (file_backed) {
                ptr = file_backed->data();
                std::lock_guard<std::mutex> lock(g_file_backed_allocations_mutex);
                g_file_backed_allocations[ptr] = std::move(file_backed);
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
            if (!response_owns_allocation_(response, ptr)) { release_plugin_allocation_(ptr); }
        }
        state.allocations.clear();
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
    void move_plugin_response_(omega_transform_plugin_response_t *response_ptr,
                               omega_transform_plugin_response_t &plugin_response) {
        if (!response_ptr) {
            omega_transform_plugin_response_clear(&plugin_response);
            return;
        }
        omega_transform_plugin_response_clear(response_ptr);
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
}// namespace

struct omega_transform_plugin_registry_struct {
    std::vector<std::unique_ptr<loaded_plugin_t>> plugins;
};

omega_transform_plugin_registry_t *omega_transform_plugin_registry_create(void) {
    return new omega_transform_plugin_registry_t();
}

void omega_transform_plugin_registry_destroy(omega_transform_plugin_registry_t *registry_ptr) { delete registry_ptr; }

int omega_transform_plugin_registry_register_plugin(omega_transform_plugin_registry_t *registry_ptr,
                                                    const char *plugin_path) {
    if (!registry_ptr || !plugin_path || !*plugin_path) { return -1; }

    auto plugin = std::make_unique<loaded_plugin_t>();
    plugin->path = plugin_path;
    plugin->library = dynamic_library_t(plugin_path);
    if (!plugin->library.ok()) { return -1; }

    const auto get_info = reinterpret_cast<omega_transform_plugin_get_info_fn>(
            plugin->library.symbol("omega_transform_plugin_get_info"));
    plugin->apply =
            reinterpret_cast<omega_transform_plugin_apply_fn>(plugin->library.symbol("omega_transform_plugin_apply"));
    if (!get_info || !plugin->apply) { return -1; }
    if (0 != get_info(&plugin->info)) { return -1; }
    if (plugin->info.abi_version == 0 || plugin->info.abi_version > OMEGA_TRANSFORM_PLUGIN_ABI_VERSION ||
        !plugin->info.id || !*plugin->info.id || !plugin_operation_is_valid_(plugin->info.operation)) {
        return -1;
    }
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
    const auto can_stream = ((*iter)->info.flags & OMEGA_TRANSFORM_PLUGIN_FLAG_STREAMING) != 0;
    const auto should_materialize = !can_stream || requested_length <= TRANSFORM_PLUGIN_CONTIGUOUS_INPUT_LIMIT_BYTES;

    materialized_input_t input;
    if (should_materialize && 0 != read_session_range_(session_ptr, offset, length, progress, progress_user_data_ptr,
                                                       is_cancelled, cancel_user_data_ptr, input)) {
        return -1;
    }

    session_range_reader_t reader{
            session_ptr,         offset, requested_length, 0, progress, progress_user_data_ptr, is_cancelled,
            cancel_user_data_ptr};
    plugin_allocator_state_t allocator_state{omega_session_get_checkpoint_directory(session_ptr), {}};

    omega_transform_plugin_request_t request{};
    request.input_bytes = input.data();
    request.input_length = input.length;
    request.session_offset = offset;
    request.session_length = requested_length;
    request.options_json = options_json;
    request.alloc = plugin_alloc_;
    request.allocator_user_data_ptr = &allocator_state;
    request.read = read_session_range_chunk_;
    request.reader_user_data_ptr = &reader;
    request.preferred_chunk_size = TRANSFORM_PLUGIN_STREAM_CHUNK_BYTES;
    request.progress = progress;
    request.progress_user_data_ptr = progress_user_data_ptr;
    request.is_cancelled = is_cancelled;
    request.cancel_user_data_ptr = cancel_user_data_ptr;

    omega_transform_plugin_response_t plugin_response{};
    if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) { return -1; }
    if (0 != (*iter)->apply(&request, &plugin_response)) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        omega_transform_plugin_response_clear(&plugin_response);
        return -1;
    }
    if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        omega_transform_plugin_response_clear(&plugin_response);
        return -1;
    }
    if (!plugin_buffer_is_valid_(plugin_response.replacement_bytes, plugin_response.replacement_length) ||
        !plugin_buffer_is_valid_(plugin_response.result_bytes, plugin_response.result_length)) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        omega_transform_plugin_response_clear(&plugin_response);
        return -1;
    }
    if (plugin_response_has_no_content_change_(plugin_response) &&
        (plugin_response.replacement_bytes != nullptr || plugin_response.replacement_length != 0)) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        omega_transform_plugin_response_clear(&plugin_response);
        return -1;
    }

    if (operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE ||
        operation == OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT) {
        const auto no_content_change = plugin_response_has_no_content_change_(plugin_response);
        if (!no_content_change && requested_length == 0 && plugin_response.replacement_length == 0) {
            release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
            omega_transform_plugin_response_clear(&plugin_response);
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
                omega_transform_plugin_response_clear(&plugin_response);
                return -1;
            }
            if (change_serial_out) { *change_serial_out = change_serial; }
        }
    }

    release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
    move_plugin_response_(response_ptr, plugin_response);
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

    plugin_allocator_state_t allocator_state{checkpoint_directory, {}};

    omega_transform_plugin_request_t request{};
    request.input_length = 0;
    request.session_offset = session_offset;
    request.session_length = session_length;
    request.options_json = options_json;
    request.alloc = plugin_alloc_;
    request.allocator_user_data_ptr = &allocator_state;
    request.read = read;
    request.reader_user_data_ptr = reader_user_data_ptr;
    request.preferred_chunk_size = preferred_chunk_size > 0
                                           ? std::min(preferred_chunk_size, TRANSFORM_PLUGIN_STREAM_CHUNK_BYTES)
                                           : TRANSFORM_PLUGIN_STREAM_CHUNK_BYTES;
    request.progress = progress;
    request.progress_user_data_ptr = progress_user_data_ptr;
    request.is_cancelled = is_cancelled;
    request.cancel_user_data_ptr = cancel_user_data_ptr;

    omega_transform_plugin_response_t plugin_response{};
    if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) { return -1; }
    if (0 != (*iter)->apply(&request, &plugin_response)) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        omega_transform_plugin_response_clear(&plugin_response);
        return -1;
    }
    if (is_cancelled && is_cancelled(cancel_user_data_ptr) != 0) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        omega_transform_plugin_response_clear(&plugin_response);
        return -1;
    }
    if (!plugin_buffer_is_valid_(plugin_response.replacement_bytes, plugin_response.replacement_length) ||
        !plugin_buffer_is_valid_(plugin_response.result_bytes, plugin_response.result_length) ||
        plugin_response.replacement_bytes != nullptr || plugin_response.replacement_length != 0) {
        release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
        omega_transform_plugin_response_clear(&plugin_response);
        return -1;
    }

    release_unclaimed_plugin_allocations_(allocator_state, plugin_response);
    move_plugin_response_(response_ptr, plugin_response);
    return 0;
}

void omega_transform_plugin_response_clear(omega_transform_plugin_response_t *response_ptr) {
    if (!response_ptr) { return; }
    release_plugin_allocation_(response_ptr->replacement_bytes);
    release_plugin_allocation_(response_ptr->result_bytes);
    release_plugin_allocation_(response_ptr->result_label);
    release_plugin_allocation_(response_ptr->result_mime_type);
    *response_ptr = {};
}
