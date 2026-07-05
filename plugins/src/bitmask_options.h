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

#ifndef OMEGA_EDIT_BITMASK_OPTIONS_H
#define OMEGA_EDIT_BITMASK_OPTIONS_H

#include "c_plugin_options.h"

#include <ctype.h>
#include <omega_edit/transform_plugin_sdk.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#define OMEGA_BITMASK_MAX_BYTES 256

typedef enum omega_bitmask_operation_t {
    OMEGA_BITMASK_AND,
    OMEGA_BITMASK_OR,
    OMEGA_BITMASK_XOR
} omega_bitmask_operation_t;

typedef struct omega_bitmask_options_t {
    omega_byte_t bytes[OMEGA_BITMASK_MAX_BYTES];
    size_t length;
    omega_bitmask_operation_t operation;
} omega_bitmask_options_t;

static const char OMEGA_BITMASK_OPTIONS_ARGS_SCHEMA[] =
        "{\"type\":\"object\",\"properties\":{\"operator\":{\"type\":\"string\",\"title\":\"Operator\","
        "\"description\":\"Logical operation to apply.\",\"default\":\"xor\",\"enum\":[\"and\",\"or\",\"xor\"]},"
        "\"byte\":{\"title\":\"Single byte\",\"description\":\"Apply one byte to every selected byte.\","
        "\"default\":\"0xFF\",\"x-omega-clears\":[\"mask\"],\"type\":\"string\","
        "\"pattern\":\"^0x[0-9A-Fa-f]{1,2}$\"},\"mask\":{\"title\":\"Repeating mask\","
        "\"description\":\"Apply a comma-separated byte mask repeatedly across the selection.\","
        "\"x-omega-clears\":[\"byte\"],\"type\":\"array\",\"minItems\":1,"
        "\"items\":{\"type\":\"string\",\"pattern\":\"^0x[0-9A-Fa-f]{1,2}$\"}}},"
        "\"additionalProperties\":false}";

static int omega_bitmask_parse_byte_text(const char *value, omega_byte_t *byte_out) {
    if (!value || !*value || !byte_out) { return -1; }

    char *end_ptr = NULL;
    const unsigned long parsed = strtoul(value, &end_ptr, 0);
    if (!end_ptr || *end_ptr != '\0' || parsed > 0xFFUL) { return -1; }
    *byte_out = (omega_byte_t) parsed;
    return 0;
}

static int omega_bitmask_parse_byte_number(const char **cursor, omega_byte_t *byte_out) {
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

static int omega_bitmask_parse_byte_value(const char **cursor, omega_byte_t *byte_out) {
    omega_plugin_json_skip_ws(cursor);
    if (**cursor == '"') {
        char value[16];
        if (omega_plugin_json_parse_string(cursor, value, sizeof(value)) != 0) { return -1; }
        return omega_bitmask_parse_byte_text(value, byte_out);
    }
    return omega_bitmask_parse_byte_number(cursor, byte_out);
}

static int omega_bitmask_parse_operation_text(const char *value, omega_bitmask_operation_t *operation_out) {
    if (!value || !operation_out) { return -1; }
    if (strcmp(value, "and") == 0) {
        *operation_out = OMEGA_BITMASK_AND;
        return 0;
    }
    if (strcmp(value, "or") == 0) {
        *operation_out = OMEGA_BITMASK_OR;
        return 0;
    }
    if (strcmp(value, "xor") == 0) {
        *operation_out = OMEGA_BITMASK_XOR;
        return 0;
    }
    return -1;
}

static int omega_bitmask_parse_operation_value(const char **cursor, omega_bitmask_operation_t *operation_out) {
    omega_plugin_json_skip_ws(cursor);
    char value[16];
    if (omega_plugin_json_parse_string(cursor, value, sizeof(value)) != 0) { return -1; }
    return omega_bitmask_parse_operation_text(value, operation_out);
}

static int omega_bitmask_parse_mask_value(const char **cursor, omega_bitmask_options_t *mask_out) {
    if (!cursor || !*cursor || !mask_out) { return -1; }

    omega_plugin_json_skip_ws(cursor);
    if (**cursor != '[') {
        mask_out->length = 1;
        return omega_bitmask_parse_byte_value(cursor, &mask_out->bytes[0]);
    }

    ++(*cursor);
    omega_plugin_json_skip_ws(cursor);
    if (**cursor == ']') { return -1; }

    size_t length = 0;
    while (**cursor) {
        if (length >= OMEGA_BITMASK_MAX_BYTES ||
            omega_bitmask_parse_byte_value(cursor, &mask_out->bytes[length]) != 0) {
            return -1;
        }
        ++length;

        omega_plugin_json_skip_ws(cursor);
        if (**cursor == ']') {
            ++(*cursor);
            mask_out->length = length;
            return 0;
        }
        if (**cursor != ',') { return -1; }
        ++(*cursor);
        omega_plugin_json_skip_ws(cursor);
    }

    return -1;
}

static int omega_bitmask_parse_options(const char *options_json, omega_byte_t default_byte,
                                       omega_bitmask_operation_t default_operation, omega_bitmask_options_t *mask_out) {
    if (!mask_out) { return -1; }
    mask_out->bytes[0] = default_byte;
    mask_out->length = 1;
    mask_out->operation = default_operation;
    if (!options_json || !*options_json) { return 0; }

    const char *cursor = options_json;
    omega_plugin_json_skip_ws(&cursor);
    if (*cursor != '{') { return -1; }
    ++cursor;

    omega_plugin_json_skip_ws(&cursor);
    if (*cursor == '}') {
        ++cursor;
        omega_plugin_json_skip_ws(&cursor);
        return *cursor == '\0' ? 0 : -1;
    }

    while (*cursor) {
        char key[32];
        if (omega_plugin_json_parse_string(&cursor, key, sizeof(key)) != 0) { return -1; }
        omega_plugin_json_skip_ws(&cursor);
        if (*cursor != ':') { return -1; }
        ++cursor;
        omega_plugin_json_skip_ws(&cursor);

        if (strcmp(key, "operator") == 0) {
            if (omega_bitmask_parse_operation_value(&cursor, &mask_out->operation) != 0) { return -1; }
        } else if (strcmp(key, "byte") == 0 || strcmp(key, "mask") == 0) {
            if (omega_bitmask_parse_mask_value(&cursor, mask_out) != 0) { return -1; }
        } else {
            if (omega_plugin_json_skip_value(&cursor, OMEGA_BITMASK_MAX_BYTES) != 0) { return -1; }
        }

        omega_plugin_json_skip_ws(&cursor);
        if (*cursor == '}') {
            ++cursor;
            omega_plugin_json_skip_ws(&cursor);
            return *cursor == '\0' ? 0 : -1;
        }
        if (*cursor != ',') { return -1; }
        ++cursor;
        omega_plugin_json_skip_ws(&cursor);
    }

    return -1;
}

static omega_byte_t omega_bitmask_apply_byte(omega_byte_t value, omega_byte_t mask,
                                             omega_bitmask_operation_t operation) {
    switch (operation) {
        case OMEGA_BITMASK_AND:
            return (omega_byte_t) (value & mask);
        case OMEGA_BITMASK_OR:
            return (omega_byte_t) (value | mask);
        case OMEGA_BITMASK_XOR:
            return (omega_byte_t) (value ^ mask);
    }
    return value;
}

static int omega_bitmask_mask_is_identity(const omega_bitmask_options_t *mask_ptr) {
    if (!mask_ptr || mask_ptr->length == 0) { return 0; }

    omega_byte_t identity_byte;
    switch (mask_ptr->operation) {
        case OMEGA_BITMASK_AND:
            identity_byte = 0xFF;
            break;
        case OMEGA_BITMASK_OR:
            identity_byte = 0x00;
            break;
        case OMEGA_BITMASK_XOR:
            identity_byte = 0x00;
            break;
        default:
            return 0;
    }

    for (size_t i = 0; i < mask_ptr->length; ++i) {
        if (mask_ptr->bytes[i] != identity_byte) { return 0; }
    }
    return 1;
}

static int omega_bitmask_apply_replace(const omega_transform_plugin_request_t *request_ptr,
                                       omega_transform_plugin_response_t *response_ptr,
                                       const omega_bitmask_options_t *mask_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || !mask_ptr || mask_ptr->length == 0 ||
        request_ptr->input_length < 0 || (request_ptr->input_length > 0 && !request_ptr->input_bytes)) {
        return -1;
    }

    if (request_ptr->input_length == 0 || omega_bitmask_mask_is_identity(mask_ptr)) {
        return omega_transform_plugin_sdk_set_no_content_change(response_ptr);
    }

    omega_byte_t *bytes =
            omega_transform_plugin_sdk_copy_bytes(request_ptr, request_ptr->input_bytes, request_ptr->input_length);
    if (!bytes) { return -1; }

    for (int64_t i = 0; i < request_ptr->input_length; ++i) {
        if ((i & 0xFFF) == 0 && omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
        const omega_byte_t mask = mask_ptr->bytes[(size_t) i % mask_ptr->length];
        bytes[i] = omega_bitmask_apply_byte(request_ptr->input_bytes[i], mask, mask_ptr->operation);
    }
    response_ptr->replacement_bytes = bytes;
    response_ptr->replacement_length = request_ptr->input_length;
    return 0;
}

#endif//OMEGA_EDIT_BITMASK_OPTIONS_H
