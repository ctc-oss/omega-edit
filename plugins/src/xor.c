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

#include <omega_edit/transform_plugin_sdk.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

static void skip_ws(const char **cursor) {
    while (**cursor && isspace((unsigned char) **cursor)) { ++(*cursor); }
}

static int parse_json_string(const char **cursor, char *out, size_t out_size) {
    if (**cursor != '"' || out_size == 0) { return -1; }
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

static int parse_byte_text(const char *value, omega_byte_t *byte_out) {
    if (!value || !*value || !byte_out) { return -1; }

    char *end_ptr = NULL;
    const unsigned long parsed = strtoul(value, &end_ptr, 0);
    if (!end_ptr || *end_ptr != '\0' || parsed > 0xFFUL) { return -1; }
    *byte_out = (omega_byte_t) parsed;
    return 0;
}

static int parse_byte_number(const char **cursor, omega_byte_t *byte_out) {
    if (!isdigit((unsigned char) **cursor)) { return -1; }

    unsigned long parsed = 0;
    while (isdigit((unsigned char) **cursor)) {
        parsed = (parsed * 10UL) + (unsigned long) (**cursor - '0');
        if (parsed > 0xFFUL) { return -1; }
        ++(*cursor);
    }
    *byte_out = (omega_byte_t) parsed;
    return 0;
}

static int skip_json_string(const char **cursor) {
    if (**cursor != '"') { return -1; }
    ++(*cursor);
    while (**cursor && **cursor != '"') {
        if (**cursor == '\\') {
            ++(*cursor);
            if (!**cursor) { return -1; }
        }
        ++(*cursor);
    }
    if (**cursor != '"') { return -1; }
    ++(*cursor);
    return 0;
}

static int skip_json_value(const char **cursor) {
    skip_ws(cursor);
    if (**cursor == '"') { return skip_json_string(cursor); }

    if (**cursor == '{' || **cursor == '[') {
        const char open = **cursor;
        const char close = open == '{' ? '}' : ']';
        int depth = 1;
        ++(*cursor);
        while (**cursor && depth > 0) {
            if (**cursor == '"') {
                if (skip_json_string(cursor) != 0) { return -1; }
                continue;
            }
            if (**cursor == open) { ++depth; }
            if (**cursor == close) { --depth; }
            ++(*cursor);
        }
        return depth == 0 ? 0 : -1;
    }

    while (**cursor && **cursor != ',' && **cursor != '}' && **cursor != ']') { ++(*cursor); }
    return 0;
}

static int parse_xor_options(const char *options_json, omega_byte_t *mask_out) {
    *mask_out = 0xFF;
    if (!options_json || !*options_json) { return 0; }

    const char *cursor = options_json;
    skip_ws(&cursor);
    if (*cursor != '{') { return -1; }
    ++cursor;

    skip_ws(&cursor);
    if (*cursor == '}') {
        ++cursor;
        skip_ws(&cursor);
        return *cursor == '\0' ? 0 : -1;
    }

    while (*cursor) {
        char key[32];
        if (parse_json_string(&cursor, key, sizeof(key)) != 0) { return -1; }
        skip_ws(&cursor);
        if (*cursor != ':') { return -1; }
        ++cursor;
        skip_ws(&cursor);

        if (strcmp(key, "byte") == 0 || strcmp(key, "mask") == 0) {
            if (*cursor == '"') {
                char value[16];
                if (parse_json_string(&cursor, value, sizeof(value)) != 0) { return -1; }
                if (parse_byte_text(value, mask_out) != 0) { return -1; }
            } else if (parse_byte_number(&cursor, mask_out) != 0) {
                return -1;
            }
        } else {
            if (skip_json_value(&cursor) != 0) { return -1; }
        }

        skip_ws(&cursor);
        if (*cursor == '}') {
            ++cursor;
            skip_ws(&cursor);
            return *cursor == '\0' ? 0 : -1;
        }
        if (*cursor != ',') { return -1; }
        ++cursor;
        skip_ws(&cursor);
    }

    return -1;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    info_ptr->id = "omega.example.xor";
    info_ptr->name = "XOR";
    info_ptr->description =
            "XOR every byte in the selected range. Options JSON may supply {\"byte\":\"0x42\"}; default byte is 0xFF.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_ONE_FOR_ONE | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                              omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0) { return -1; }
    omega_byte_t mask = 0xFF;
    if (parse_xor_options(request_ptr->options_json, &mask) != 0) { return -1; }

    omega_byte_t *bytes = omega_transform_plugin_sdk_copy_bytes(request_ptr, request_ptr->input_bytes,
                                                                request_ptr->input_length);
    if (!bytes) { return -1; }
    for (int64_t i = 0; i < request_ptr->input_length; ++i) {
        bytes[i] = request_ptr->input_bytes[i] ^ mask;
    }
    response_ptr->replacement_bytes = bytes;
    response_ptr->replacement_length = request_ptr->input_length;
    return 0;
}
