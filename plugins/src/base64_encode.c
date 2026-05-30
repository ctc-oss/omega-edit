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

static const char BASE64_ALPHABET[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.base64_encode";
    info_ptr->name = "Base64 Encode";
    info_ptr->description = "Encode the selected range as RFC 4648 base64 text.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help = "No JSON options are used.";
    info_ptr->example = "";
    info_ptr->default_args = "";
    info_ptr->args_schema = OMEGA_TRANSFORM_PLUGIN_NO_ARGS_SCHEMA;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                              omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0) { return -1; }
    if (request_ptr->input_length == 0) { return omega_transform_plugin_sdk_set_replacement(request_ptr, response_ptr, NULL, 0); }
    if (request_ptr->input_length > ((INT64_MAX / 4) - 1) * 3) { return -1; }

    const int64_t output_length = ((request_ptr->input_length + 2) / 3) * 4;
    omega_byte_t *output = (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, (size_t) output_length);
    if (!output) { return -1; }

    int64_t input_index = 0;
    int64_t output_index = 0;
    while (input_index < request_ptr->input_length) {
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
