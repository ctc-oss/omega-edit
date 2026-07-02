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

#include <ctype.h>
#include <omega_edit/transform_plugin_sdk.h>
#include <string.h>

typedef enum omega_case_change_mode_t { OMEGA_CASE_CHANGE_UPPER, OMEGA_CASE_CHANGE_LOWER } omega_case_change_mode_t;

static const char CASE_CHANGE_ARGS_SCHEMA[] =
        "{\"type\":\"object\",\"properties\":{\"case\":{\"type\":\"string\",\"title\":\"Case\","
        "\"description\":\"Convert ASCII alphabetic bytes to upper or lower case.\",\"default\":\"upper\","
        "\"enum\":[\"upper\",\"lower\"]}},\"additionalProperties\":false}";

static void case_change_skip_ws(const char **cursor) {
    while (cursor && *cursor && isspace((unsigned char) **cursor)) { ++(*cursor); }
}

static int case_change_parse_json_string(const char **cursor, char *out, size_t out_size) {
    if (!cursor || !*cursor || **cursor != '"' || out_size == 0) { return -1; }
    ++(*cursor);
    size_t length = 0;
    while (**cursor && **cursor != '"') {
        char ch = **cursor;
        if (ch == '\\') {
            ++(*cursor);
            if (!**cursor) { return -1; }
            ch = **cursor;
        }
        if (length + 1 >= out_size) { return -1; }
        out[length++] = ch;
        ++(*cursor);
    }
    if (**cursor != '"') { return -1; }
    ++(*cursor);
    out[length] = '\0';
    return 0;
}

static int case_change_parse_mode_text(const char *value, omega_case_change_mode_t *mode_out) {
    if (!value || !mode_out) { return -1; }
    if (strcmp(value, "upper") == 0) {
        *mode_out = OMEGA_CASE_CHANGE_UPPER;
        return 0;
    }
    if (strcmp(value, "lower") == 0) {
        *mode_out = OMEGA_CASE_CHANGE_LOWER;
        return 0;
    }
    return -1;
}

static int case_change_parse_options(const char *options_json, omega_case_change_mode_t *mode_out) {
    if (!mode_out) { return -1; }
    *mode_out = OMEGA_CASE_CHANGE_UPPER;
    if (!options_json || !*options_json) { return 0; }

    const char *cursor = options_json;
    case_change_skip_ws(&cursor);
    if (*cursor != '{') { return -1; }
    ++cursor;
    case_change_skip_ws(&cursor);
    if (*cursor == '}') {
        ++cursor;
        case_change_skip_ws(&cursor);
        return *cursor == '\0' ? 0 : -1;
    }

    char key[32];
    if (case_change_parse_json_string(&cursor, key, sizeof(key)) != 0 || strcmp(key, "case") != 0) { return -1; }
    case_change_skip_ws(&cursor);
    if (*cursor != ':') { return -1; }
    ++cursor;
    case_change_skip_ws(&cursor);

    char mode[16];
    if (case_change_parse_json_string(&cursor, mode, sizeof(mode)) != 0 ||
        case_change_parse_mode_text(mode, mode_out) != 0) {
        return -1;
    }

    case_change_skip_ws(&cursor);
    if (*cursor != '}') { return -1; }
    ++cursor;
    case_change_skip_ws(&cursor);
    return *cursor == '\0' ? 0 : -1;
}

static omega_byte_t case_change_byte(omega_byte_t byte, omega_case_change_mode_t mode) {
    if (mode == OMEGA_CASE_CHANGE_UPPER && byte >= 'a' && byte <= 'z') { return (omega_byte_t) (byte - ('a' - 'A')); }
    if (mode == OMEGA_CASE_CHANGE_LOWER && byte >= 'A' && byte <= 'Z') { return (omega_byte_t) (byte + ('a' - 'A')); }
    return byte;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.case_change";
    info_ptr->name = "Case Change";
    info_ptr->description = "Convert ASCII alphabetic bytes to upper or lower case.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_ONE_FOR_ONE | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help =
            "Choose upper or lower case. Only ASCII alphabetic bytes are changed; all other bytes are preserved.";
    info_ptr->example = "{\"case\":\"lower\"}";
    info_ptr->default_args = "{\"case\":\"upper\"}";
    info_ptr->args_schema = CASE_CHANGE_ARGS_SCHEMA;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                               omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0 ||
        (request_ptr->input_length > 0 && !request_ptr->input_bytes)) {
        return -1;
    }

    omega_case_change_mode_t mode;
    if (case_change_parse_options(request_ptr->options_json, &mode) != 0) { return -1; }

    int has_change = 0;
    for (int64_t i = 0; i < request_ptr->input_length; ++i) {
        if ((i & 0xFFF) == 0 && omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
        if (case_change_byte(request_ptr->input_bytes[i], mode) != request_ptr->input_bytes[i]) {
            has_change = 1;
            break;
        }
    }
    if (!has_change) { return omega_transform_plugin_sdk_set_no_content_change(response_ptr); }

    omega_byte_t *output =
            (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, (size_t) request_ptr->input_length);
    if (!output) { return -1; }
    for (int64_t i = 0; i < request_ptr->input_length; ++i) {
        if ((i & 0xFFF) == 0 && omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
        output[i] = case_change_byte(request_ptr->input_bytes[i], mode);
    }
    response_ptr->replacement_bytes = output;
    response_ptr->replacement_length = request_ptr->input_length;
    return 0;
}
