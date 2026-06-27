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

/**
 * @file transform.h
 * @brief Dynamic transform plugin ABI and registry functions.
 */

#ifndef OMEGA_EDIT_TRANSFORM_H
#define OMEGA_EDIT_TRANSFORM_H

#include "byte.h"
#include "fwd_defs.h"

#ifdef __cplusplus

#include <cstddef>
#include <cstdint>

extern "C" {
#else

#include <stddef.h>
#include <stdint.h>

#endif

#define OMEGA_TRANSFORM_PLUGIN_ABI_VERSION 3

typedef enum {
    OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE = 1,
    OMEGA_TRANSFORM_PLUGIN_OPERATION_INSPECT = 2,
    OMEGA_TRANSFORM_PLUGIN_OPERATION_REPLACE_AND_INSPECT = 3
} omega_transform_plugin_operation_t;

typedef enum {
    OMEGA_TRANSFORM_PLUGIN_FLAG_ONE_FOR_ONE = 1,
    OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_EXPAND = 1 << 1,
    OMEGA_TRANSFORM_PLUGIN_FLAG_MAY_SHRINK = 1 << 2,
    OMEGA_TRANSFORM_PLUGIN_FLAG_TEXT_RESULT = 1 << 3,
    OMEGA_TRANSFORM_PLUGIN_FLAG_BINARY_SAFE = 1 << 4,
    OMEGA_TRANSFORM_PLUGIN_FLAG_STREAMING = 1 << 5
} omega_transform_plugin_flags_t;

typedef struct {
    uint32_t abi_version;
    const char *id;
    const char *name;
    const char *description;
    omega_transform_plugin_operation_t operation;
    uint32_t flags;
    /** Optional UI/help text for plugin-specific JSON arguments. */
    const char *help;
    /** Optional example JSON arguments. */
    const char *example;
    /** Optional default JSON arguments. */
    const char *default_args;
    /** Optional JSON Schema used to validate options_json before apply. */
    const char *args_schema;
} omega_transform_plugin_info_t;

typedef void *(*omega_transform_plugin_alloc_t)(size_t size, void *user_data_ptr);
typedef int64_t (*omega_transform_plugin_read_t)(int64_t relative_offset, omega_byte_t *buffer, int64_t length,
                                                 void *user_data_ptr);

typedef enum {
    OMEGA_TRANSFORM_PROGRESS_HAS_PROCESSED_BYTES = 1,
    OMEGA_TRANSFORM_PROGRESS_HAS_TOTAL_BYTES = 1 << 1,
    OMEGA_TRANSFORM_PROGRESS_HAS_PERCENT = 1 << 2,
    OMEGA_TRANSFORM_PROGRESS_INDETERMINATE = 1 << 3
} omega_transform_progress_flags_t;

typedef enum { OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE = 1 } omega_transform_plugin_response_flags_t;

typedef struct {
    int64_t processed_bytes;
    int64_t total_bytes;
    double percent;
    const char *phase;
    const char *message;
    uint32_t flags;
} omega_transform_plugin_progress_t;

typedef int (*omega_transform_plugin_progress_cbk_t)(const omega_transform_plugin_progress_t *progress_ptr,
                                                     void *user_data_ptr);

typedef struct {
    /** Bytes from the requested session range when the host materialized them. May be null for streaming requests. */
    const omega_byte_t *input_bytes;
    /** Length of input_bytes. */
    int64_t input_length;
    /** Start offset of input_bytes within the session. */
    int64_t session_offset;
    /** Requested range length after clamping to the session end. */
    int64_t session_length;
    /** Optional plugin-specific JSON options supplied by the caller. */
    const char *options_json;
    /** Allocator plugins must use for response buffers and strings. */
    omega_transform_plugin_alloc_t alloc;
    void *allocator_user_data_ptr;
    /** Read bytes from the requested range without requiring one contiguous input buffer. */
    omega_transform_plugin_read_t read;
    void *reader_user_data_ptr;
    /** Suggested maximum chunk size for read calls. */
    int64_t preferred_chunk_size;
    /** Optional callback for reporting long-running transform progress. */
    omega_transform_plugin_progress_cbk_t progress;
    void *progress_user_data_ptr;
} omega_transform_plugin_request_t;

/**
 * Response buffers and strings are owned by the caller after a successful plugin call.
 * Plugins must allocate them with omega_transform_plugin_request_t::alloc, and callers must
 * release them with omega_transform_plugin_response_clear().
 */
typedef struct {
    omega_byte_t *replacement_bytes;
    int64_t replacement_length;
    omega_byte_t *result_bytes;
    int64_t result_length;
    char *result_label;
    char *result_mime_type;
    uint32_t flags;
} omega_transform_plugin_response_t;

typedef int (*omega_transform_plugin_get_info_fn)(omega_transform_plugin_info_t *info_ptr);
typedef int (*omega_transform_plugin_apply_fn)(const omega_transform_plugin_request_t *request_ptr,
                                               omega_transform_plugin_response_t *response_ptr);

typedef struct omega_transform_plugin_registry_struct omega_transform_plugin_registry_t;

omega_transform_plugin_registry_t *omega_transform_plugin_registry_create(void);

void omega_transform_plugin_registry_destroy(omega_transform_plugin_registry_t *registry_ptr);

int omega_transform_plugin_registry_register_plugin(omega_transform_plugin_registry_t *registry_ptr,
                                                    const char *plugin_path);

int omega_transform_plugin_registry_register_directory(omega_transform_plugin_registry_t *registry_ptr,
                                                       const char *plugin_directory);

int64_t omega_transform_plugin_registry_get_count(const omega_transform_plugin_registry_t *registry_ptr);

int omega_transform_plugin_options_match_args_schema(const char *options_json, const char *args_schema);

const omega_transform_plugin_info_t *
omega_transform_plugin_registry_get_info(const omega_transform_plugin_registry_t *registry_ptr, int64_t index);

const omega_transform_plugin_info_t *
omega_transform_plugin_registry_find_info(const omega_transform_plugin_registry_t *registry_ptr, const char *plugin_id);

int omega_transform_plugin_registry_apply_to_session(omega_transform_plugin_registry_t *registry_ptr,
                                                     const char *plugin_id, omega_session_t *session_ptr,
                                                     int64_t offset, int64_t length, const char *options_json,
                                                     omega_transform_plugin_response_t *response_ptr);

int omega_transform_plugin_registry_apply_to_session_with_progress(
        omega_transform_plugin_registry_t *registry_ptr, const char *plugin_id, omega_session_t *session_ptr,
        int64_t offset, int64_t length, const char *options_json, omega_transform_plugin_progress_cbk_t progress,
        void *progress_user_data_ptr, omega_transform_plugin_response_t *response_ptr);

int omega_transform_plugin_registry_apply_to_session_with_progress_and_serial(
        omega_transform_plugin_registry_t *registry_ptr, const char *plugin_id, omega_session_t *session_ptr,
        int64_t offset, int64_t length, const char *options_json, omega_transform_plugin_progress_cbk_t progress,
        void *progress_user_data_ptr, omega_transform_plugin_response_t *response_ptr, int64_t *change_serial_out);

/**
 * Release response-owned replacement/result buffers and reset all fields to zero/null.
 */
void omega_transform_plugin_response_clear(omega_transform_plugin_response_t *response_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_TRANSFORM_H
