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

/**
 * @file transform_plugin_sdk.h
 * @brief Helper macros and allocation helpers for Omega Edit transform plugins.
 */

#ifndef OMEGA_EDIT_TRANSFORM_PLUGIN_SDK_H
#define OMEGA_EDIT_TRANSFORM_PLUGIN_SDK_H

#include "transform.h"

#include <string.h>

#ifdef _WIN32
#define OMEGA_TRANSFORM_PLUGIN_EXPORT __declspec(dllexport)
#else
#define OMEGA_TRANSFORM_PLUGIN_EXPORT __attribute__((visibility("default")))
#endif

static const char OMEGA_TRANSFORM_PLUGIN_NO_ARGS_SCHEMA[] = "";

static inline void *omega_transform_plugin_sdk_alloc(const omega_transform_plugin_request_t *request_ptr, size_t size) {
    if (!request_ptr || !request_ptr->alloc) { return NULL; }
    return request_ptr->alloc(size == 0 ? 1 : size, request_ptr->allocator_user_data_ptr);
}

static inline omega_byte_t *omega_transform_plugin_sdk_copy_bytes(
        const omega_transform_plugin_request_t *request_ptr, const omega_byte_t *bytes, int64_t length) {
    if (!request_ptr || length < 0 || (length > 0 && !bytes)) { return NULL; }
    omega_byte_t *copy = (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, (size_t) length);
    if (!copy) { return NULL; }
    if (length > 0) { memcpy(copy, bytes, (size_t) length); }
    return copy;
}

static inline char *omega_transform_plugin_sdk_copy_cstring(const omega_transform_plugin_request_t *request_ptr,
                                                           const char *value) {
    if (!value) { return NULL; }
    const size_t length = strlen(value);
    char *copy = (char *) omega_transform_plugin_sdk_alloc(request_ptr, length + 1);
    if (!copy) { return NULL; }
    memcpy(copy, value, length + 1);
    return copy;
}

static inline int omega_transform_plugin_sdk_report_progress(
        const omega_transform_plugin_request_t *request_ptr, const omega_transform_plugin_progress_t *progress_ptr) {
    if (!request_ptr || !request_ptr->progress || !progress_ptr) { return 0; }
    return request_ptr->progress(progress_ptr, request_ptr->progress_user_data_ptr);
}

static inline int omega_transform_plugin_sdk_report_byte_progress(
        const omega_transform_plugin_request_t *request_ptr, int64_t processed_bytes, int64_t total_bytes,
        const char *phase, const char *message) {
    if (processed_bytes < 0 || total_bytes < 0) { return -1; }
    omega_transform_plugin_progress_t progress;
    memset(&progress, 0, sizeof(progress));
    progress.processed_bytes = processed_bytes;
    progress.total_bytes = total_bytes;
    progress.percent = total_bytes > 0 ? ((double) processed_bytes / (double) total_bytes) * 100.0 : 100.0;
    progress.phase = phase;
    progress.message = message;
    progress.flags = OMEGA_TRANSFORM_PROGRESS_HAS_PROCESSED_BYTES |
                     OMEGA_TRANSFORM_PROGRESS_HAS_TOTAL_BYTES |
                     OMEGA_TRANSFORM_PROGRESS_HAS_PERCENT;
    return omega_transform_plugin_sdk_report_progress(request_ptr, &progress);
}

static inline int omega_transform_plugin_sdk_report_phase(
        const omega_transform_plugin_request_t *request_ptr, const char *phase, const char *message) {
    omega_transform_plugin_progress_t progress;
    memset(&progress, 0, sizeof(progress));
    progress.phase = phase;
    progress.message = message;
    progress.flags = OMEGA_TRANSFORM_PROGRESS_INDETERMINATE;
    return omega_transform_plugin_sdk_report_progress(request_ptr, &progress);
}

static inline int omega_transform_plugin_sdk_set_no_content_change(omega_transform_plugin_response_t *response_ptr) {
    if (!response_ptr) { return -1; }
    response_ptr->replacement_bytes = NULL;
    response_ptr->replacement_length = 0;
    response_ptr->flags |= OMEGA_TRANSFORM_PLUGIN_RESPONSE_NO_CONTENT_CHANGE;
    return 0;
}

static inline int omega_transform_plugin_sdk_set_replacement(
        const omega_transform_plugin_request_t *request_ptr, omega_transform_plugin_response_t *response_ptr,
        const omega_byte_t *bytes, int64_t length) {
    if (!request_ptr || !response_ptr || length < 0 || (length > 0 && !bytes)) { return -1; }
    if (length == 0 && request_ptr->input_length == 0) {
        return omega_transform_plugin_sdk_set_no_content_change(response_ptr);
    }
    response_ptr->replacement_length = length;
    if (length == 0) { return 0; }
    response_ptr->replacement_bytes = omega_transform_plugin_sdk_copy_bytes(request_ptr, bytes, length);
    return response_ptr->replacement_bytes ? 0 : -1;
}

static inline int omega_transform_plugin_sdk_set_text_result(
        const omega_transform_plugin_request_t *request_ptr, omega_transform_plugin_response_t *response_ptr,
        const char *label, const char *value, const char *mime_type) {
    if (!request_ptr || !response_ptr || !value) { return -1; }
    const size_t value_length = strlen(value);
    response_ptr->result_bytes = (omega_byte_t *) omega_transform_plugin_sdk_alloc(request_ptr, value_length);
    if (!response_ptr->result_bytes) { return -1; }
    memcpy(response_ptr->result_bytes, value, value_length);
    response_ptr->result_length = (int64_t) value_length;
    if (label) {
        response_ptr->result_label = omega_transform_plugin_sdk_copy_cstring(request_ptr, label);
        if (!response_ptr->result_label) { return -1; }
    }
    if (mime_type) {
        response_ptr->result_mime_type = omega_transform_plugin_sdk_copy_cstring(request_ptr, mime_type);
        if (!response_ptr->result_mime_type) { return -1; }
    }
    return 0;
}

#endif//OMEGA_EDIT_TRANSFORM_PLUGIN_SDK_H
