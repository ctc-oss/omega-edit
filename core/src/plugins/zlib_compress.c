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

#define ZLIB_STORED_BLOCK_MAX 65535

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
    info_ptr->id = "omega.example.zlib_compress";
    info_ptr->name = "Zlib Compress";
    info_ptr->description = "Wrap the selected range in a valid zlib stream using stored DEFLATE blocks.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                              omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0) { return -1; }

    /* This exemplar emits stored blocks only, so options_json/compression-level settings are intentionally ignored. */
    const int64_t block_count = request_ptr->input_length == 0
                                        ? 1
                                        : (request_ptr->input_length + ZLIB_STORED_BLOCK_MAX - 1) /
                                                  ZLIB_STORED_BLOCK_MAX;
    if (block_count > (INT64_MAX - request_ptr->input_length - 6) / 5) { return -1; }
    const int64_t output_length = 2 + request_ptr->input_length + (block_count * 5) + 4;
    omega_byte_t *output = (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, (size_t) output_length);
    if (!output) { return -1; }

    int64_t output_index = 0;
    output[output_index++] = 0x78;
    output[output_index++] = 0x01;

    int64_t input_index = 0;
    for (int64_t block_index = 0; block_index < block_count; ++block_index) {
        const int is_final_block = block_index == block_count - 1;
        const int64_t remaining = request_ptr->input_length - input_index;
        const uint16_t block_length =
                (uint16_t) (remaining > ZLIB_STORED_BLOCK_MAX ? ZLIB_STORED_BLOCK_MAX : remaining);
        const uint16_t nlen = (uint16_t) ~block_length;

        output[output_index++] = (omega_byte_t) (is_final_block ? 0x01 : 0x00);
        output[output_index++] = (omega_byte_t) (block_length & 0xFF);
        output[output_index++] = (omega_byte_t) ((block_length >> 8) & 0xFF);
        output[output_index++] = (omega_byte_t) (nlen & 0xFF);
        output[output_index++] = (omega_byte_t) ((nlen >> 8) & 0xFF);
        if (block_length > 0) {
            memcpy(output + output_index, request_ptr->input_bytes + input_index, block_length);
            output_index += block_length;
            input_index += block_length;
        }
    }

    const uint32_t checksum = adler32_(request_ptr->input_bytes, request_ptr->input_length);
    output[output_index++] = (omega_byte_t) ((checksum >> 24) & 0xFF);
    output[output_index++] = (omega_byte_t) ((checksum >> 16) & 0xFF);
    output[output_index++] = (omega_byte_t) ((checksum >> 8) & 0xFF);
    output[output_index++] = (omega_byte_t) (checksum & 0xFF);

    response_ptr->replacement_bytes = output;
    response_ptr->replacement_length = output_length;
    return output_index == output_length ? 0 : -1;
}
