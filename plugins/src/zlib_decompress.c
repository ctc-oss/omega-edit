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
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

static int grow_buffer(omega_byte_t **buffer_ptr, size_t *capacity_ptr) {
    if (!buffer_ptr || !capacity_ptr || *capacity_ptr > (SIZE_MAX / 2)) { return -1; }

    const size_t next_capacity = *capacity_ptr == 0 ? 1024 : *capacity_ptr * 2;
    omega_byte_t *next_buffer = (omega_byte_t *) realloc(*buffer_ptr, next_capacity);
    if (!next_buffer) { return -1; }

    *buffer_ptr = next_buffer;
    *capacity_ptr = next_capacity;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    info_ptr->id = "omega.example.zlib_decompress";
    info_ptr->name = "Zlib Decompress";
    info_ptr->description = "Decompress zlib-compressed data.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                              omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0 ||
        (request_ptr->input_length > 0 && !request_ptr->input_bytes)) {
        return -1;
    }
    if ((uint64_t) request_ptr->input_length > UINT_MAX) { return -1; }

    z_stream stream;
    memset(&stream, 0, sizeof(stream));
    stream.next_in = (Bytef *) request_ptr->input_bytes;
    stream.avail_in = (uInt) request_ptr->input_length;

    if (inflateInit(&stream) != Z_OK) { return -1; }

    omega_byte_t *output = NULL;
    size_t capacity = 0;
    int result = -1;

    while (1) {
        if (stream.total_out >= capacity && grow_buffer(&output, &capacity) != 0) { break; }

        const uLong previous_total_in = stream.total_in;
        const uLong previous_total_out = stream.total_out;
        stream.next_out = output + stream.total_out;
        stream.avail_out = (uInt) (capacity - stream.total_out > UINT_MAX ? UINT_MAX
                                                                          : capacity - stream.total_out);

        const int rc = inflate(&stream, Z_NO_FLUSH);
        if (rc == Z_STREAM_END) {
            if (stream.avail_in != 0 || (uint64_t) stream.total_out > INT64_MAX) { break; }
            response_ptr->replacement_length = (int64_t) stream.total_out;
            response_ptr->replacement_bytes =
                    omega_transform_plugin_sdk_copy_bytes(request_ptr, output, response_ptr->replacement_length);
            result = response_ptr->replacement_bytes || response_ptr->replacement_length == 0 ? 0 : -1;
            break;
        }
        if (rc != Z_OK || (stream.total_in == previous_total_in && stream.total_out == previous_total_out)) { break; }
    }

    inflateEnd(&stream);
    free(output);
    return result;
}
