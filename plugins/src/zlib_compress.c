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
#include <ctype.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

static int input_length_to_ulong(int64_t input_length, uLong *input_length_out) {
    if (!input_length_out || input_length < 0 || (uint64_t) input_length > ULONG_MAX) { return -1; }
    *input_length_out = (uLong) input_length;
    return 0;
}

static void skip_ws(const char **cursor) {
    while (cursor && *cursor && isspace((unsigned char) **cursor)) { ++(*cursor); }
}

static int consume_char(const char **cursor, char ch) {
    skip_ws(cursor);
    if (!cursor || !*cursor || **cursor != ch) { return -1; }
    ++(*cursor);
    return 0;
}

static int parse_level_options(const char *options_json, int *level_out) {
    if (!level_out) { return -1; }
    *level_out = Z_DEFAULT_COMPRESSION;
    if (!options_json || !*options_json) { return 0; }

    const char *cursor = options_json;
    if (consume_char(&cursor, '{') != 0) { return -1; }
    skip_ws(&cursor);
    if (*cursor == '}') {
        ++cursor;
        skip_ws(&cursor);
        return *cursor == '\0' ? 0 : -1;
    }

    if (*cursor != '"') { return -1; }
    ++cursor;
    if (strncmp(cursor, "level", 5) != 0 || cursor[5] != '"') { return -1; }
    cursor += 6;
    if (consume_char(&cursor, ':') != 0) { return -1; }

    char *end_ptr = NULL;
    const long level = strtol(cursor, &end_ptr, 10);
    if (end_ptr == cursor || level < Z_DEFAULT_COMPRESSION || level > Z_BEST_COMPRESSION) { return -1; }
    cursor = end_ptr;
    skip_ws(&cursor);
    if (*cursor != '}') { return -1; }
    ++cursor;
    skip_ws(&cursor);
    if (*cursor != '\0') { return -1; }

    *level_out = (int) level;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.zlib_compress";
    info_ptr->name = "Zlib Compress";
    info_ptr->description = "Compress the selected range with zlib.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help = "Options JSON accepts {\"level\":9}. Use -1 for the zlib default, 0 for no compression, "
                     "1 for fastest compression, or 9 for best compression.";
    info_ptr->example = "{\"level\":9}";
    info_ptr->default_args = "{\"level\":-1}";
    info_ptr->args_schema = "{\"type\":\"object\",\"properties\":{\"level\":{\"type\":\"integer\",\"minimum\":-1,"
                            "\"maximum\":9}},\"additionalProperties\":false}";
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
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
    int level = Z_DEFAULT_COMPRESSION;
    if (parse_level_options(request_ptr->options_json, &level) != 0) { return -1; }

    uLongf output_length = compressBound(input_length);
    if ((uint64_t) output_length > INT64_MAX) { return -1; }

    response_ptr->replacement_length = (int64_t) output_length;
    response_ptr->replacement_bytes =
            (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, response_ptr->replacement_length);
    if (!response_ptr->replacement_bytes && response_ptr->replacement_length != 0) { return -1; }

    static const omega_byte_t empty_input = 0;
    const Bytef *input = request_ptr->input_length == 0 ? &empty_input : request_ptr->input_bytes;
    const int rc = compress2((Bytef *) response_ptr->replacement_bytes, &output_length, input, input_length, level);
    if (rc != Z_OK || (uint64_t) output_length > INT64_MAX) { return -1; }

    response_ptr->replacement_length = (int64_t) output_length;
    return 0;
}
