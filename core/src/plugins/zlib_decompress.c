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

static uint32_t adler32_(const omega_byte_t *bytes, int64_t length) {
    uint32_t s1 = 1;
    uint32_t s2 = 0;
    for (int64_t i = 0; i < length; ++i) {
        s1 = (s1 + bytes[i]) % 65521;
        s2 = (s2 + s1) % 65521;
    }
    return (s2 << 16) | s1;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    info_ptr->id = "omega.example.zlib_decompress";
    info_ptr->name = "Zlib Decompress";
    info_ptr->description = "Decode zlib streams that use stored DEFLATE blocks.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                              omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0) { return -1; }
    if (request_ptr->input_length < 6) { return -1; }

    const omega_byte_t *input = request_ptr->input_bytes;
    const int64_t input_length = request_ptr->input_length;
    const uint16_t zlib_header = (uint16_t) ((input[0] << 8) | input[1]);
    if ((input[0] & 0x0F) != 8 || (input[0] >> 4) > 7 || (zlib_header % 31) != 0 || (input[1] & 0x20) != 0) {
        return -1;
    }

    int64_t input_index = 2;
    int saw_final_block = 0;
    int64_t output_length = 0;

    while (!saw_final_block) {
        if (input_index + 5 > input_length - 4) { return -1; }
        const omega_byte_t block_header = input[input_index++];
        saw_final_block = (block_header & 0x01) != 0;
        if (((block_header >> 1) & 0x03) != 0 || (block_header & 0xF8) != 0) { return -1; }

        const uint16_t block_length = (uint16_t) (input[input_index] | (input[input_index + 1] << 8));
        const uint16_t nlen = (uint16_t) (input[input_index + 2] | (input[input_index + 3] << 8));
        input_index += 4;
        if ((uint16_t) ~block_length != nlen || input_index + block_length > input_length - 4) { return -1; }
        if (output_length > INT64_MAX - block_length) { return -1; }
        output_length += block_length;
        input_index += block_length;
    }

    if (input_index != input_length - 4) { return -1; }
    omega_byte_t *output =
            output_length == 0 ? NULL : (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr,
                                                                                          (size_t) output_length);
    if (output_length > 0 && !output) { return -1; }

    input_index = 2;
    int64_t output_index = 0;
    saw_final_block = 0;
    while (!saw_final_block) {
        const omega_byte_t block_header = input[input_index++];
        saw_final_block = (block_header & 0x01) != 0;
        const uint16_t block_length = (uint16_t) (input[input_index] | (input[input_index + 1] << 8));
        input_index += 4;
        if (block_length > 0) {
            memcpy(output + output_index, input + input_index, block_length);
            output_index += block_length;
            input_index += block_length;
        }
    }

    const uint32_t expected_checksum = ((uint32_t) input[input_index] << 24) |
                                       ((uint32_t) input[input_index + 1] << 16) |
                                       ((uint32_t) input[input_index + 2] << 8) |
                                       (uint32_t) input[input_index + 3];
    if (expected_checksum != adler32_(output, output_length)) { return -1; }

    response_ptr->replacement_bytes = output;
    response_ptr->replacement_length = output_length;
    return 0;
}
