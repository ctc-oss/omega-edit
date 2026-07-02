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
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static const char BASE64_ALPHABET[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

typedef enum omega_base64_direction_t { OMEGA_BASE64_ENCODE, OMEGA_BASE64_DECODE } omega_base64_direction_t;

static const char BASE64_ARGS_SCHEMA[] =
        "{\"type\":\"object\",\"properties\":{\"direction\":{\"type\":\"string\",\"title\":\"Direction\","
        "\"description\":\"Encode bytes as Base64 text or decode Base64 text to bytes.\",\"default\":\"encode\","
        "\"enum\":[\"encode\",\"decode\"]}},\"additionalProperties\":false}";

static void base64_skip_ws(const char **cursor) {
    while (cursor && *cursor && isspace((unsigned char) **cursor)) { ++(*cursor); }
}

static int base64_parse_json_string(const char **cursor, char *out, size_t out_size) {
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

static int base64_parse_direction_text(const char *value, omega_base64_direction_t *direction_out) {
    if (!value || !direction_out) { return -1; }
    if (strcmp(value, "encode") == 0) {
        *direction_out = OMEGA_BASE64_ENCODE;
        return 0;
    }
    if (strcmp(value, "decode") == 0) {
        *direction_out = OMEGA_BASE64_DECODE;
        return 0;
    }
    return -1;
}

static int base64_parse_options(const char *options_json, omega_base64_direction_t *direction_out) {
    if (!direction_out) { return -1; }
    *direction_out = OMEGA_BASE64_ENCODE;
    if (!options_json || !*options_json) { return 0; }

    const char *cursor = options_json;
    base64_skip_ws(&cursor);
    if (*cursor != '{') { return -1; }
    ++cursor;
    base64_skip_ws(&cursor);
    if (*cursor == '}') {
        ++cursor;
        base64_skip_ws(&cursor);
        return *cursor == '\0' ? 0 : -1;
    }

    char key[32];
    if (base64_parse_json_string(&cursor, key, sizeof(key)) != 0 || strcmp(key, "direction") != 0) { return -1; }
    base64_skip_ws(&cursor);
    if (*cursor != ':') { return -1; }
    ++cursor;
    base64_skip_ws(&cursor);

    char direction[16];
    if (base64_parse_json_string(&cursor, direction, sizeof(direction)) != 0 ||
        base64_parse_direction_text(direction, direction_out) != 0) {
        return -1;
    }

    base64_skip_ws(&cursor);
    if (*cursor != '}') { return -1; }
    ++cursor;
    base64_skip_ws(&cursor);
    return *cursor == '\0' ? 0 : -1;
}

static int is_base64_whitespace(omega_byte_t byte) {
    return byte == ' ' || byte == '\t' || byte == '\n' || byte == '\r';
}

static int decode_base64_value(omega_byte_t byte) {
    if (byte >= 'A' && byte <= 'Z') { return byte - 'A'; }
    if (byte >= 'a' && byte <= 'z') { return byte - 'a' + 26; }
    if (byte >= '0' && byte <= '9') { return byte - '0' + 52; }
    if (byte == '+') { return 62; }
    if (byte == '/') { return 63; }
    if (byte == '=') { return -2; }
    return -1;
}

static int validate_base64(const omega_transform_plugin_request_t *request_ptr, int64_t *encoded_length_ptr,
                           int *padding_ptr) {
    int64_t encoded_length = 0;
    int padding = 0;
    int saw_padding = 0;

    for (int64_t i = 0; i < request_ptr->input_length; ++i) {
        if ((i & 0xFFF) == 0 && omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
        const omega_byte_t byte = request_ptr->input_bytes[i];
        if (is_base64_whitespace(byte)) { continue; }
        const int value = decode_base64_value(byte);
        if (value == -1) { return -1; }

        const int quartet_position = (int) (encoded_length % 4);
        if (value == -2) {
            if (quartet_position < 2) { return -1; }
            saw_padding = 1;
            ++padding;
        } else if (saw_padding) {
            return -1;
        }
        ++encoded_length;
    }

    if (encoded_length == 0) {
        *encoded_length_ptr = 0;
        *padding_ptr = 0;
        return 0;
    }
    if ((encoded_length % 4) != 0 || padding > 2) { return -1; }

    *encoded_length_ptr = encoded_length;
    *padding_ptr = padding;
    return 0;
}

static int base64_encode(const omega_transform_plugin_request_t *request_ptr,
                         omega_transform_plugin_response_t *response_ptr) {
    if (request_ptr->input_length == 0) {
        return omega_transform_plugin_sdk_set_replacement(request_ptr, response_ptr, NULL, 0);
    }
    if (request_ptr->input_length > ((INT64_MAX / 4) - 1) * 3) { return -1; }

    const int64_t output_length = ((request_ptr->input_length + 2) / 3) * 4;
    omega_byte_t *output = (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, (size_t) output_length);
    if (!output) { return -1; }

    int64_t input_index = 0;
    int64_t output_index = 0;
    while (input_index < request_ptr->input_length) {
        if ((input_index & 0xFFF) == 0 && omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
        const unsigned int octet_a = request_ptr->input_bytes[input_index++];
        const int has_b = input_index < request_ptr->input_length;
        const unsigned int octet_b = has_b ? request_ptr->input_bytes[input_index++] : 0;
        const int has_c = input_index < request_ptr->input_length;
        const unsigned int octet_c = has_c ? request_ptr->input_bytes[input_index++] : 0;
        const unsigned int triple = (octet_a << 16) | (octet_b << 8) | octet_c;

        output[output_index++] = (omega_byte_t) BASE64_ALPHABET[(triple >> 18) & 0x3F];
        output[output_index++] = (omega_byte_t) BASE64_ALPHABET[(triple >> 12) & 0x3F];
        output[output_index++] = (omega_byte_t) (has_b ? BASE64_ALPHABET[(triple >> 6) & 0x3F] : '=');
        output[output_index++] = (omega_byte_t) (has_c ? BASE64_ALPHABET[triple & 0x3F] : '=');
    }

    response_ptr->replacement_bytes = output;
    response_ptr->replacement_length = output_length;
    return 0;
}

static int base64_decode(const omega_transform_plugin_request_t *request_ptr,
                         omega_transform_plugin_response_t *response_ptr) {
    int64_t encoded_length = 0;
    int padding = 0;
    if (validate_base64(request_ptr, &encoded_length, &padding) != 0) { return -1; }
    if (encoded_length == 0) { return omega_transform_plugin_sdk_set_replacement(request_ptr, response_ptr, NULL, 0); }

    const int64_t output_length = (encoded_length / 4) * 3 - padding;
    omega_byte_t *output = (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, (size_t) output_length);
    if (!output) { return -1; }

    int quartet[4] = {0, 0, 0, 0};
    int quartet_index = 0;
    int64_t output_index = 0;
    for (int64_t i = 0; i < request_ptr->input_length; ++i) {
        if ((i & 0xFFF) == 0 && omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
        const omega_byte_t byte = request_ptr->input_bytes[i];
        if (is_base64_whitespace(byte)) { continue; }
        const int value = decode_base64_value(byte);
        quartet[quartet_index++] = value == -2 ? 0 : value;
        if (quartet_index < 4) { continue; }

        const unsigned int triple = ((unsigned int) quartet[0] << 18) | ((unsigned int) quartet[1] << 12) |
                                    ((unsigned int) quartet[2] << 6) | (unsigned int) quartet[3];
        if (output_index < output_length) { output[output_index++] = (omega_byte_t) ((triple >> 16) & 0xFF); }
        if (output_index < output_length) { output[output_index++] = (omega_byte_t) ((triple >> 8) & 0xFF); }
        if (output_index < output_length) { output[output_index++] = (omega_byte_t) (triple & 0xFF); }
        quartet_index = 0;
    }

    response_ptr->replacement_bytes = output;
    response_ptr->replacement_length = output_length;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.base64";
    info_ptr->name = "Base64";
    info_ptr->description = "Encode or decode RFC 4648 base64 data.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help = "Choose whether to encode bytes as Base64 text or decode Base64 text back to bytes. "
                     "Decoding tolerates ASCII whitespace.";
    info_ptr->example = "{\"direction\":\"decode\"}";
    info_ptr->default_args = "{\"direction\":\"encode\"}";
    info_ptr->args_schema = BASE64_ARGS_SCHEMA;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                               omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0 ||
        (request_ptr->input_length > 0 && !request_ptr->input_bytes)) {
        return -1;
    }

    omega_base64_direction_t direction;
    if (base64_parse_options(request_ptr->options_json, &direction) != 0) { return -1; }
    return direction == OMEGA_BASE64_ENCODE ? base64_encode(request_ptr, response_ptr)
                                            : base64_decode(request_ptr, response_ptr);
}
