/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed under the License is            *
 * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                   *
 * implied.  See the License for the specific language governing permissions and limitations under the License.       *
 *                                                                                                                    *
 **********************************************************************************************************************/

#include <omega_edit/transform_plugin_sdk.h>

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    info_ptr->id = "omega.example.xor_ff";
    info_ptr->name = "XOR 0xFF";
    info_ptr->description = "Invert every byte in the selected range.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_ONE_FOR_ONE | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                              omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0) { return -1; }
    omega_byte_t *bytes = omega_transform_plugin_sdk_copy_bytes(request_ptr, request_ptr->input_bytes,
                                                                request_ptr->input_length);
    if (!bytes) { return -1; }
    for (int64_t i = 0; i < request_ptr->input_length; ++i) {
        bytes[i] = request_ptr->input_bytes[i] ^ 0xFF;
    }
    response_ptr->replacement_bytes = bytes;
    response_ptr->replacement_length = request_ptr->input_length;
    return 0;
}
