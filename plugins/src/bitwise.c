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

#include "bitmask_options.h"

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.bitwise";
    info_ptr->name = "Bitwise";
    info_ptr->description = "Apply AND, OR, or XOR to every byte in the selected range.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_ONE_FOR_ONE | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help = "Choose a logical operator and provide either a single byte or a repeating byte mask. "
                     "The default is XOR with 0xFF.";
    info_ptr->example = "{\"operator\":\"xor\",\"mask\":[\"0x42\",\"0x24\"]}";
    info_ptr->default_args = "{\"operator\":\"xor\",\"byte\":\"0xFF\"}";
    info_ptr->args_schema = OMEGA_BITMASK_OPTIONS_ARGS_SCHEMA;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                               omega_transform_plugin_response_t *response_ptr) {
    omega_bitmask_options_t options;
    if (omega_bitmask_parse_options(request_ptr ? request_ptr->options_json : NULL, 0xFF, OMEGA_BITMASK_XOR,
                                    &options) != 0) {
        return -1;
    }
    return omega_bitmask_apply_replace(request_ptr, response_ptr, &options);
}
