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

#include "plugin_options.hpp"

#include <algorithm>
#include <vector>

namespace {
    constexpr const char *ENDIAN_SWAP_ARGS_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"width\":{\"type\":\"integer\",\"title\":\"Field width\","
            "\"description\":\"Bytes per integer field.\",\"default\":2,\"enum\":[2,4,8]}},"
            "\"additionalProperties\":false}";
}

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.endian_swap";
    info_ptr->name = "Endian Swap";
    info_ptr->description = "Reverse byte order in complete fixed-width 2, 4, or 8 byte fields.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_ONE_FOR_ONE | OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help =
            "Choose a field width of 2, 4, or 8 bytes. Trailing bytes that do not fill a complete field are left "
            "unchanged.";
    info_ptr->example = "{\"width\":4}";
    info_ptr->default_args = "{\"width\":2}";
    info_ptr->args_schema = ENDIAN_SWAP_ARGS_SCHEMA;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

extern "C" OMEGA_TRANSFORM_PLUGIN_EXPORT int
omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                             omega_transform_plugin_response_t *response_ptr) {
    std::vector<omega_byte_t> bytes;
    if (!omega_edit::plugin::selected_bytes(request_ptr, bytes) || !response_ptr || !request_ptr->alloc) { return -1; }
    std::map<std::string, std::string> options;
    if (!omega_edit::plugin::parse_string_options(request_ptr->options_json, options)) { return -1; }
    const int64_t width = omega_edit::plugin::option_int_or(options, "width", 2);
    if (!(width == 2 || width == 4 || width == 8)) { return -1; }
    using difference_type = std::vector<omega_byte_t>::difference_type;
    for (size_t offset = 0; offset + static_cast<size_t>(width) <= bytes.size(); offset += static_cast<size_t>(width)) {
        std::reverse(bytes.begin() + static_cast<difference_type>(offset),
                     bytes.begin() + static_cast<difference_type>(offset + static_cast<size_t>(width)));
    }
    return omega_edit::plugin::set_replacement(request_ptr, response_ptr, bytes);
}
