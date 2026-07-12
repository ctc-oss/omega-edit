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
#include <omega_edit/config.h>
#include <omega_edit/transform_plugin_sdk.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <zstd.h>

typedef enum omega_zstd_action_t { OMEGA_ZSTD_COMPRESS, OMEGA_ZSTD_DECOMPRESS } omega_zstd_action_t;

typedef struct omega_zstd_options_t {
    omega_zstd_action_t action;
    int level;
    int64_t max_output_bytes;
} omega_zstd_options_t;

static const char ZSTD_ARGS_SCHEMA[] =
        "{\"type\":\"object\",\"properties\":{\"action\":{\"type\":\"string\",\"title\":\"Action\","
        "\"description\":\"Compress or decompress zstd data.\",\"default\":\"compress\","
        "\"enum\":[\"compress\",\"decompress\"]},\"level\":{\"type\":\"integer\",\"title\":\"Compression level\","
        "\"description\":\"Used when compressing: 1 is fastest; 22 is smallest.\",\"default\":3,"
        "\"minimum\":1,\"maximum\":22},\"maxOutputBytes\":{\"type\":\"integer\","
        "\"title\":\"Maximum decompressed bytes\",\"description\":\"Used when decompressing. Expansion above this "
        "limit fails before allocating more output memory.\",\"default\":67108864,\"minimum\":1}},"
        "\"additionalProperties\":false}";

static const int64_t ZSTD_DEFAULT_MAX_OUTPUT_BYTES = OMEGA_MEMORY_BUFFER_LIMIT;

static int zstd_parse_action(const char *value, omega_zstd_action_t *action_out) {
    if (!value || !action_out) { return -1; }
    if (strcmp(value, "compress") == 0) {
        *action_out = OMEGA_ZSTD_COMPRESS;
        return 0;
    }
    if (strcmp(value, "decompress") == 0) {
        *action_out = OMEGA_ZSTD_DECOMPRESS;
        return 0;
    }
    return -1;
}

static int zstd_parse_level(const char **cursor, int *value_out) {
    omega_plugin_json_skip_ws(cursor);
    char *end_ptr = NULL;
    const long parsed = strtol(*cursor, &end_ptr, 10);
    if (end_ptr == *cursor || parsed < 1 || parsed > 22) { return -1; }
    *cursor = end_ptr;
    *value_out = (int) parsed;
    return 0;
}

static int zstd_parse_positive_int64(const char **cursor, int64_t *value_out) {
    omega_plugin_json_skip_ws(cursor);
    errno = 0;
    char *end_ptr = NULL;
    const long long parsed = strtoll(*cursor, &end_ptr, 10);
    if (end_ptr == *cursor || errno == ERANGE || parsed < 1) { return -1; }
    *cursor = end_ptr;
    *value_out = (int64_t) parsed;
    return 0;
}

static int zstd_parse_options(const char *options_json, omega_zstd_options_t *options_out) {
    if (!options_out) { return -1; }
    options_out->action = OMEGA_ZSTD_COMPRESS;
    options_out->level = 3;
    options_out->max_output_bytes = ZSTD_DEFAULT_MAX_OUTPUT_BYTES;
    if (!options_json || !*options_json) { return 0; }

    const char *cursor = options_json;
    omega_plugin_json_skip_ws(&cursor);
    if (*cursor++ != '{') { return -1; }
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
        if (*cursor++ != ':') { return -1; }
        omega_plugin_json_skip_ws(&cursor);
        if (strcmp(key, "action") == 0) {
            char action[16];
            if (omega_plugin_json_parse_string(&cursor, action, sizeof(action)) != 0 ||
                zstd_parse_action(action, &options_out->action) != 0) {
                return -1;
            }
        } else if (strcmp(key, "level") == 0) {
            if (zstd_parse_level(&cursor, &options_out->level) != 0) { return -1; }
        } else if (strcmp(key, "maxOutputBytes") == 0) {
            if (zstd_parse_positive_int64(&cursor, &options_out->max_output_bytes) != 0) { return -1; }
        } else {
            return -1;
        }
        omega_plugin_json_skip_ws(&cursor);
        if (*cursor == '}') {
            ++cursor;
            omega_plugin_json_skip_ws(&cursor);
            return *cursor == '\0' ? 0 : -1;
        }
        if (*cursor++ != ',') { return -1; }
        omega_plugin_json_skip_ws(&cursor);
    }
    return -1;
}

static int grow_buffer(omega_byte_t **buffer_ptr, size_t *capacity_ptr, size_t max_capacity) {
    if (!buffer_ptr || !capacity_ptr || *capacity_ptr >= max_capacity) { return -1; }
    size_t next_capacity = *capacity_ptr == 0 ? ZSTD_DStreamOutSize() : *capacity_ptr * 2;
    if (next_capacity < *capacity_ptr) { return -1; }
    if (next_capacity > max_capacity) { next_capacity = max_capacity; }
    omega_byte_t *next_buffer = (omega_byte_t *) realloc(*buffer_ptr, next_capacity);
    if (!next_buffer) { return -1; }
    *buffer_ptr = next_buffer;
    *capacity_ptr = next_capacity;
    return 0;
}

static int zstd_compress(const omega_transform_plugin_request_t *request_ptr,
                         omega_transform_plugin_response_t *response_ptr, int level) {
    if ((uint64_t) request_ptr->input_length > SIZE_MAX || omega_transform_plugin_sdk_is_cancelled(request_ptr)) {
        return -1;
    }
    const size_t input_length = (size_t) request_ptr->input_length;
    const size_t output_capacity = ZSTD_compressBound(input_length);
    if (ZSTD_isError(output_capacity) || output_capacity > INT64_MAX) { return -1; }
    response_ptr->replacement_bytes =
            (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, (int64_t) output_capacity);
    if (!response_ptr->replacement_bytes && output_capacity != 0) { return -1; }

    static const omega_byte_t empty_input = 0;
    const void *input = input_length == 0 ? &empty_input : request_ptr->input_bytes;
    const size_t output_length =
            ZSTD_compress(response_ptr->replacement_bytes, output_capacity, input, input_length, level);
    if (ZSTD_isError(output_length) || output_length > INT64_MAX ||
        omega_transform_plugin_sdk_is_cancelled(request_ptr)) {
        return -1;
    }
    response_ptr->replacement_length = (int64_t) output_length;
    return 0;
}

static int zstd_decompress(const omega_transform_plugin_request_t *request_ptr,
                           omega_transform_plugin_response_t *response_ptr, int64_t max_output_bytes) {
    if ((uint64_t) request_ptr->input_length > SIZE_MAX || max_output_bytes < 1 ||
        (uint64_t) max_output_bytes > SIZE_MAX) {
        return -1;
    }
    ZSTD_DCtx *context = ZSTD_createDCtx();
    if (!context) { return -1; }

    omega_byte_t *output = NULL;
    size_t capacity = 0;
    size_t output_length = 0;
    ZSTD_inBuffer input = {request_ptr->input_bytes, (size_t) request_ptr->input_length, 0};
    int result = -1;
    size_t remaining = 1;

    while (input.pos < input.size || remaining != 0) {
        if (omega_transform_plugin_sdk_is_cancelled(request_ptr) ||
            (output_length == capacity && grow_buffer(&output, &capacity, (size_t) max_output_bytes) != 0)) {
            goto cleanup;
        }
        ZSTD_outBuffer destination = {output, capacity, output_length};
        const size_t previous_input = input.pos;
        remaining = ZSTD_decompressStream(context, &destination, &input);
        if (ZSTD_isError(remaining)) { goto cleanup; }
        output_length = destination.pos;
        if (input.pos == previous_input && output_length == capacity && capacity == (size_t) max_output_bytes) {
            goto cleanup;
        }
        if (input.pos == input.size && remaining != 0 && destination.pos < destination.size) { goto cleanup; }
    }

    if (output_length > INT64_MAX) { goto cleanup; }
    response_ptr->replacement_length = (int64_t) output_length;
    response_ptr->replacement_bytes =
            omega_transform_plugin_sdk_copy_bytes(request_ptr, output, response_ptr->replacement_length);
    result = response_ptr->replacement_bytes || output_length == 0 ? 0 : -1;

cleanup:
    ZSTD_freeDCtx(context);
    free(output);
    return result;
}

OMEGA_TRANSFORM_PLUGIN_EXPORT int omega_transform_plugin_get_info(omega_transform_plugin_info_t *info_ptr) {
    if (!info_ptr) { return -1; }
    info_ptr->id = "omega.example.zstd";
    info_ptr->name = "Zstandard";
    info_ptr->description = "Compress or decompress Zstandard data.";
    info_ptr->operation = OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE;
    info_ptr->flags = OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND | OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK |
                      OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE;
    info_ptr->help = "Choose compress or decompress. Compression level ranges from 1 (fastest) through 22 "
                     "(smallest), defaulting to 3. Decompression stops at maxOutputBytes, defaulting to 64 MiB.";
    info_ptr->example = "{\"action\":\"compress\",\"level\":19}";
    info_ptr->default_args = "{\"action\":\"compress\",\"level\":3}";
    info_ptr->args_schema = ZSTD_ARGS_SCHEMA;
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
    omega_zstd_options_t options;
    if (zstd_parse_options(request_ptr->options_json, &options) != 0) { return -1; }
    return options.action == OMEGA_ZSTD_COMPRESS ? zstd_compress(request_ptr, response_ptr, options.level)
                                                 : zstd_decompress(request_ptr, response_ptr, options.max_output_bytes);
}
