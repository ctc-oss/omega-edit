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
#include <stdio.h>
#include <stdlib.h>

static int update_checksum(const omega_byte_t *bytes, int64_t length, unsigned int *checksum_ptr) {
    if (length < 0 || !checksum_ptr || (length > 0 && !bytes)) { return -1; }
    for (int64_t i = 0; i < length; ++i) { *checksum_ptr = (*checksum_ptr + bytes[i]) & 0xFF; }
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.checksum8";
    info_ptr->name = "Checksum-8";
    info_ptr->description = "Calculate an 8-bit additive checksum over the selected range.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_TEXT_RESULT | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_STREAMING;
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
    unsigned int checksum = 0;
    if (request_ptr->read) {
        const int64_t chunk_size = request_ptr->preferred_chunk_size > 0
                                           ? request_ptr->preferred_chunk_size
                                           : 65536;
        omega_byte_t *buffer = (omega_byte_t *) malloc((size_t) chunk_size);
        if (!buffer) { return -1; }
        for (int64_t position = 0; position < request_ptr->session_length;) {
            int64_t bytes_read = request_ptr->read(position, buffer, chunk_size, request_ptr->reader_user_data_ptr);
            if (bytes_read <= 0) {
                free(buffer);
                return -1;
            }
            if (update_checksum(buffer, bytes_read, &checksum) != 0) {
                free(buffer);
                return -1;
            }
            position += bytes_read;
        }
        free(buffer);
    } else if (update_checksum(request_ptr->input_bytes, request_ptr->input_length, &checksum) != 0) {
        return -1;
    }

    char result[16];
    snprintf(result, sizeof(result), "0x%02X", checksum);
    return omega_transform_plugin_sdk_set_text_result(request_ptr, response_ptr, "checksum8", result, "text/plain");
}
