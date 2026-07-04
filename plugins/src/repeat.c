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
#include <string.h>

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.repeat";
    info_ptr->name = "Repeat Range";
    info_ptr->description = "Replace the selected range with two copies of itself.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help = "No options are used.";
    info_ptr->example = "";
    info_ptr->default_args = "";
    info_ptr->args_schema = OMEGA_TRANSFORM_PLUGIN_NO_ARGS_SCHEMA;
    info_ptr->support = OMEGA_TRANSFORM_PLUGIN_SUPPORT_EXPERIMENTAL;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                               omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0) { return -1; }
    if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
    if (request_ptr->input_length > INT64_MAX / 2) { return -1; }
    const int64_t replacement_length = request_ptr->input_length * 2;
    response_ptr->replacement_length = replacement_length;
    if (replacement_length == 0) { return omega_transform_plugin_sdk_set_no_content_change(response_ptr); }
    response_ptr->replacement_bytes =
            (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, (size_t) replacement_length);
    if (!response_ptr->replacement_bytes) { return -1; }
    if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
    memcpy(response_ptr->replacement_bytes, request_ptr->input_bytes, (size_t) request_ptr->input_length);
    if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
    memcpy(response_ptr->replacement_bytes + request_ptr->input_length, request_ptr->input_bytes,
           (size_t) request_ptr->input_length);
    return 0;
}
