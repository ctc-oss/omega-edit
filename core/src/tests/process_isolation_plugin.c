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
    info_ptr->id = "omega.test.process_isolation";
    info_ptr->name = "Process Isolation Test";
    info_ptr->description = "Test plugin that can deliberately crash during apply.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->args_schema = OMEGA_TRANSFORM_PLUGIN_NO_ARGS_SCHEMA;
    info_ptr->support = OMEGA_TRANSFORM_PLUGIN_SUPPORT_TEST;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                               omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0 ||
        (request_ptr->input_length > 0 && !request_ptr->input_bytes)) {
        return -1;
    }
    if (request_ptr->input_length == 5 && memcmp(request_ptr->input_bytes, "crash", 5) == 0) {
        volatile int *boom = (volatile int *) 0;
        *boom = 1;
    }
    if (request_ptr->input_length == 8 && memcmp(request_ptr->input_bytes, "progress", 8) == 0) {
        if (omega_transform_plugin_sdk_report_byte_progress(request_ptr, 4, 8, "worker", "halfway") != 0) { return -1; }
    }
    if (request_ptr->input_length == 6 && memcmp(request_ptr->input_bytes, "cancel", 6) == 0 &&
        omega_transform_plugin_sdk_is_cancelled(request_ptr)) {
        return -1;
    }
    static const omega_byte_t replacement[] = {'i', 's', 'o', 'l', 'a', 't', 'e', 'd'};
    return omega_transform_plugin_sdk_set_replacement(request_ptr, response_ptr, replacement,
                                                      (int64_t) sizeof(replacement));
}
