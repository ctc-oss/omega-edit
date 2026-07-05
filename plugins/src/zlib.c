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

#include "c_plugin_options.h"

#include <errno.h>
#include <limits.h>
#include <omega_edit/config.h>
#include <omega_edit/transform_plugin_sdk.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

typedef enum omega_zlib_action_t { OMEGA_ZLIB_COMPRESS, OMEGA_ZLIB_DECOMPRESS } omega_zlib_action_t;

typedef struct omega_zlib_options_t {
    omega_zlib_action_t action;
    int level;
    int64_t max_output_bytes;
} omega_zlib_options_t;

static const char ZLIB_ARGS_SCHEMA[] =
        "{\"type\":\"object\",\"properties\":{\"action\":{\"type\":\"string\",\"title\":\"Action\","
        "\"description\":\"Compress or decompress zlib data.\",\"default\":\"compress\","
        "\"enum\":[\"compress\",\"decompress\"]},\"level\":{\"type\":\"integer\",\"title\":\"Compression level\","
        "\"description\":\"Used when compressing: -1 uses the zlib default; 0 stores without compression; "
        "9 is smallest.\",\"default\":-1,\"minimum\":-1,\"maximum\":9},\"maxOutputBytes\":{\"type\":\"integer\","
        "\"title\":\"Maximum decompressed bytes\",\"description\":\"Used when decompressing. Expansion above this "
        "limit fails before allocating more output memory.\",\"default\":67108864,\"minimum\":1}},"
        "\"additionalProperties\":false}";

static const int64_t ZLIB_DEFAULT_MAX_OUTPUT_BYTES = OMEGA_MEMORY_BUFFER_LIMIT;

static int input_length_to_ulong(int64_t input_length, uLong *input_length_out) {
    if (!input_length_out || input_length < 0 || (uint64_t) input_length > ULONG_MAX) { return -1; }
    *input_length_out = (uLong) input_length;
    return 0;
}

static int zlib_parse_action_text(const char *value, omega_zlib_action_t *action_out) {
    if (!value || !action_out) { return -1; }
    if (strcmp(value, "compress") == 0) {
        *action_out = OMEGA_ZLIB_COMPRESS;
        return 0;
    }
    if (strcmp(value, "decompress") == 0) {
        *action_out = OMEGA_ZLIB_DECOMPRESS;
        return 0;
    }
    return -1;
}

static int zlib_parse_integer(const char **cursor, int *value_out) {
    omega_plugin_json_skip_ws(cursor);
    char *end_ptr = NULL;
    const long parsed = strtol(*cursor, &end_ptr, 10);
    if (end_ptr == *cursor || parsed < Z_DEFAULT_COMPRESSION || parsed > Z_BEST_COMPRESSION) { return -1; }
    *cursor = end_ptr;
    *value_out = (int) parsed;
    return 0;
}

static int zlib_parse_positive_int64(const char **cursor, int64_t *value_out) {
    if (!cursor || !*cursor || !value_out) { return -1; }
    omega_plugin_json_skip_ws(cursor);
    errno = 0;
    char *end_ptr = NULL;
    const long long parsed = strtoll(*cursor, &end_ptr, 10);
    if (end_ptr == *cursor || errno == ERANGE || parsed < 1 || (uint64_t) parsed > INT64_MAX) { return -1; }
    *cursor = end_ptr;
    *value_out = (int64_t) parsed;
    return 0;
}

static int zlib_parse_options(const char *options_json, omega_zlib_options_t *options_out) {
    if (!options_out) { return -1; }
    options_out->action = OMEGA_ZLIB_COMPRESS;
    options_out->level = Z_DEFAULT_COMPRESSION;
    options_out->max_output_bytes = ZLIB_DEFAULT_MAX_OUTPUT_BYTES;
    if (!options_json || !*options_json) { return 0; }

    const char *cursor = options_json;
    omega_plugin_json_skip_ws(&cursor);
    if (*cursor != '{') { return -1; }
    ++cursor;
    omega_plugin_json_skip_ws(&cursor);
    if (*cursor == '}') {
        ++cursor;
        omega_plugin_json_skip_ws(&cursor);
        return *cursor == '\0' ? 0 : -1;
    }

    while (*cursor) {
        char key[32];
        if (omega_plugin_json_parse_string(&cursor, key, sizeof(key)) != 0) { return -1; }
        omega_plugin_json_skip_ws(&cursor);
        if (*cursor != ':') { return -1; }
        ++cursor;
        omega_plugin_json_skip_ws(&cursor);

        if (strcmp(key, "action") == 0) {
            char action[16];
            if (omega_plugin_json_parse_string(&cursor, action, sizeof(action)) != 0 ||
                zlib_parse_action_text(action, &options_out->action) != 0) {
                return -1;
            }
        } else if (strcmp(key, "level") == 0) {
            if (zlib_parse_integer(&cursor, &options_out->level) != 0) { return -1; }
        } else if (strcmp(key, "maxOutputBytes") == 0) {
            if (zlib_parse_positive_int64(&cursor, &options_out->max_output_bytes) != 0) { return -1; }
        } else {
            return -1;
        }

        omega_plugin_json_skip_ws(&cursor);
        if (*cursor == '}') {
            ++cursor;
            omega_plugin_json_skip_ws(&cursor);
            return *cursor == '\0' ? 0 : -1;
        }
        if (*cursor != ',') { return -1; }
        ++cursor;
        omega_plugin_json_skip_ws(&cursor);
    }
    return -1;
}

static int grow_buffer(omega_byte_t **buffer_ptr, size_t *capacity_ptr, size_t max_capacity) {
    if (!buffer_ptr || !capacity_ptr || max_capacity == 0 || *capacity_ptr >= max_capacity) { return -1; }

    const size_t next_capacity = *capacity_ptr == 0 ? 1024 : *capacity_ptr * 2;
    if (next_capacity < *capacity_ptr) { return -1; }
    const size_t bounded_capacity = next_capacity > max_capacity ? max_capacity : next_capacity;
    omega_byte_t *next_buffer = (omega_byte_t *) realloc(*buffer_ptr, bounded_capacity);
    if (!next_buffer) { return -1; }

    *buffer_ptr = next_buffer;
    *capacity_ptr = bounded_capacity;
    return 0;
}

static int zlib_compress(const omega_transform_plugin_request_t *request_ptr,
                         omega_transform_plugin_response_t *response_ptr, int level) {
    uLong input_length = 0;
    if (input_length_to_ulong(request_ptr->input_length, &input_length) != 0) { return -1; }
    if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }

    uLongf output_length = compressBound(input_length);
    if ((uint64_t) output_length > INT64_MAX) { return -1; }

    response_ptr->replacement_length = (int64_t) output_length;
    response_ptr->replacement_bytes =
            (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, response_ptr->replacement_length);
    if (!response_ptr->replacement_bytes && response_ptr->replacement_length != 0) { return -1; }

    static const omega_byte_t empty_input = 0;
    const Bytef *input = request_ptr->input_length == 0 ? &empty_input : request_ptr->input_bytes;
    const int rc = compress2((Bytef *) response_ptr->replacement_bytes, &output_length, input, input_length, level);
    if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { return -1; }
    if (rc != Z_OK || (uint64_t) output_length > INT64_MAX) { return -1; }

    response_ptr->replacement_length = (int64_t) output_length;
    return 0;
}

static int zlib_decompress(const omega_transform_plugin_request_t *request_ptr,
                           omega_transform_plugin_response_t *response_ptr, int64_t max_output_bytes) {
    if ((uint64_t) request_ptr->input_length > UINT_MAX) { return -1; }
    if (max_output_bytes < 1 || (uint64_t) max_output_bytes > SIZE_MAX) { return -1; }
    const size_t max_output_size = (size_t) max_output_bytes;

    z_stream stream;
    memset(&stream, 0, sizeof(stream));
    stream.next_in = (Bytef *) request_ptr->input_bytes;
    stream.avail_in = (uInt) request_ptr->input_length;

    if (inflateInit(&stream) != Z_OK) { return -1; }

    omega_byte_t *output = NULL;
    size_t capacity = 0;
    int result = -1;

    while (1) {
        if (omega_transform_plugin_sdk_is_cancelled(request_ptr)) { break; }
        if (stream.total_out >= capacity && grow_buffer(&output, &capacity, max_output_size) != 0) { break; }

        const uLong previous_total_in = stream.total_in;
        const uLong previous_total_out = stream.total_out;
        stream.next_out = output + stream.total_out;
        stream.avail_out = (uInt) (capacity - stream.total_out > UINT_MAX ? UINT_MAX : capacity - stream.total_out);

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

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.zlib";
    info_ptr->name = "Zlib";
    info_ptr->description = "Compress or decompress zlib data.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help = "Choose compress or decompress. Compression level uses -1 for the zlib default, "
                     "0 for no compression, 1 for fastest compression, or 9 for best compression. "
                     "Decompression stops at maxOutputBytes, defaulting to 64 MiB.";
    info_ptr->example = "{\"action\":\"compress\",\"level\":9}";
    info_ptr->default_args = "{\"action\":\"compress\",\"level\":-1}";
    info_ptr->args_schema = ZLIB_ARGS_SCHEMA;
    info_ptr->support = OMEGA_TRANSFORM_PLUGIN_SUPPORT_EXPERIMENTAL;
    info_ptr->abi_version = OMEGA_TRANSFORM_PLUGIN_ABI_VERSION;
    return 0;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_apply(const omega_transform_plugin_request_t *request_ptr,
                                                               omega_transform_plugin_response_t *response_ptr) {
    if (!request_ptr || !response_ptr || !request_ptr->alloc || request_ptr->input_length < 0 ||
        (request_ptr->input_length > 0 && !request_ptr->input_bytes)) {
        return -1;
    }

    omega_zlib_options_t options;
    if (zlib_parse_options(request_ptr->options_json, &options) != 0) { return -1; }
    return options.action == OMEGA_ZLIB_COMPRESS ? zlib_compress(request_ptr, response_ptr, options.level)
                                                 : zlib_decompress(request_ptr, response_ptr, options.max_output_bytes);
}
