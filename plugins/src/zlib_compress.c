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
#include <zlib.h>

static int input_length_to_ulong(int64_t input_length, uLong *input_length_out) {
    if (!input_length_out || input_length < 0 || (uint64_t) input_length > ULONG_MAX) { return -1; }
    *input_length_out = (uLong) input_length;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    info_ptr->id = "omega.example.zlib_compress";
    info_ptr->name = "Zlib Compress";
    info_ptr->description = "Compress the selected range with zlib.";
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

    uLong input_length = 0;
    if (input_length_to_ulong(request_ptr->input_length, &input_length) != 0) { return -1; }

    uLongf output_length = compressBound(input_length);
    if ((uint64_t) output_length > INT64_MAX) { return -1; }

    omega_byte_t *output = (omega_byte_t *) malloc((size_t) output_length);
    if (!output) { return -1; }

    static const omega_byte_t empty_input = 0;
    const Bytef *input = request_ptr->input_length == 0 ? &empty_input : request_ptr->input_bytes;
    const int rc = compress2((Bytef *) output, &output_length, input, input_length, Z_DEFAULT_COMPRESSION);
    if (rc != Z_OK || (uint64_t) output_length > INT64_MAX) {
        free(output);
        return -1;
    }

    response_ptr->replacement_length = (int64_t) output_length;
    response_ptr->replacement_bytes =
            omega_transform_plugin_sdk_copy_bytes(request_ptr, output, response_ptr->replacement_length);
    free(output);
    return response_ptr->replacement_bytes || response_ptr->replacement_length == 0 ? 0 : -1;
}
