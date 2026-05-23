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

static int is_base64_whitespace_(omega_byte_t byte) {
    return byte == ' ' || byte == '\t' || byte == '\n' || byte == '\r';
}

/* RFC 4648 base64 with MIME-style whitespace tolerance. Non-whitespace invalid bytes fail validation. */
static int decode_base64_value_(omega_byte_t byte) {
    if (byte >= 'A' && byte <= 'Z') { return byte - 'A'; }
    if (byte >= 'a' && byte <= 'z') { return byte - 'a' + 26; }
    if (byte >= '0' && byte <= '9') { return byte - '0' + 52; }
    if (byte == '+') { return 62; }
    if (byte == '/') { return 63; }
    if (byte == '=') { return -2; }
    return -1;
}

static int validate_base64_(const omega_transform_plugin_request_t *request_ptr, int64_t *encoded_length_ptr,
                            int *padding_ptr) {
    int64_t encoded_length = 0;
    int padding = 0;
    int saw_padding = 0;

    for (int64_t i = 0; i < request_ptr->input_length; ++i) {
        const omega_byte_t byte = request_ptr->input_bytes[i];
        if (is_base64_whitespace_(byte)) { continue; }
        const int value = decode_base64_value_(byte);
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

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    info_ptr->id = "omega.example.base64_decode";
    info_ptr->name = "Base64 Decode";
    info_ptr->description = "Decode RFC 4648 base64 text from the selected range.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                              omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0) { return -1; }

    int64_t encoded_length = 0;
    int padding = 0;
    if (0 != validate_base64_(request_ptr, &encoded_length, &padding)) { return -1; }
    if (encoded_length == 0) { return omega_transform_plugin_sdk_set_replacement(request_ptr, response_ptr, NULL, 0); }

    const int64_t output_length = (encoded_length / 4) * 3 - padding;
    omega_byte_t *output = (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, (size_t) output_length);
    if (!output) { return -1; }

    int quartet[4] = {0, 0, 0, 0};
    int quartet_index = 0;
    int64_t output_index = 0;
    for (int64_t i = 0; i < request_ptr->input_length; ++i) {
        const omega_byte_t byte = request_ptr->input_bytes[i];
        if (is_base64_whitespace_(byte)) { continue; }
        const int value = decode_base64_value_(byte);
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
