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
 * @file changelog.h
 * @brief Non-mutating, coordinate-aware change-log export.
 */

#ifndef OMEGA_EDIT_CHANGELOG_H
#define OMEGA_EDIT_CHANGELOG_H

#include "byte.h"
#include "fwd_defs.h"

#ifdef __cplusplus
#include <cstdint>
extern "C" {
#else
#include <stdint.h>
#endif

typedef enum {
    OMEGA_CHANGELOG_PLAN_DELETE = 1,
    OMEGA_CHANGELOG_PLAN_INSERT = 2,
    OMEGA_CHANGELOG_PLAN_OVERWRITE = 3,
    OMEGA_CHANGELOG_PLAN_REPLACE = 4,
    OMEGA_CHANGELOG_PLAN_TRANSFORM = 5
} omega_changelog_plan_kind_t;

/** Read a plan payload. Returns bytes read, zero exactly at end, or -1 on failure. */
typedef int64_t (*omega_changelog_payload_read_cbk_t)(void *context, int64_t offset, omega_byte_t *destination,
                                                      int64_t capacity);

typedef struct {
    omega_changelog_plan_kind_t kind;
    int64_t offset;
    int64_t length;
    int64_t payload_length;
    omega_changelog_payload_read_cbk_t read_payload;
    void *payload_context;

    const char *transform_id;
    const char *options_json;
    int64_t replacement_length;
    int64_t computed_file_size_before;
    int64_t computed_file_size_after;
} omega_changelog_plan_entry_t;

typedef int (*omega_changelog_plan_visitor_cbk_t)(const omega_changelog_plan_entry_t *entry, void *user_data);

typedef struct {
    int64_t length;
    omega_changelog_payload_read_cbk_t read;
    void *context;
} omega_changelog_content_source_t;

typedef struct {
    int64_t resolved_first_change_serial;
    int64_t resolved_last_change_serial;
    int64_t source_change_count;
    omega_changelog_content_source_t before;
    omega_changelog_content_source_t after;
} omega_changelog_export_summary_t;

typedef int (*omega_changelog_export_summary_cbk_t)(const omega_changelog_export_summary_t *summary, void *user_data);

typedef struct {
    uint32_t flags;              /**< Reserved; must be zero. */
    int64_t first_change_serial; /**< Zero resolves to the first active serial. */
    int64_t last_change_serial;  /**< Zero resolves to the active tip; inclusive. */
    int64_t max_span_bytes;      /**< Zero selects the 64 MiB default. */
    int64_t max_entries;         /**< Zero disables the output-entry cap. */
    int prefer_overwrite_form;   /**< Emit OVERWRITE instead of equal-length REPLACE. */
} omega_changelog_export_options_t;

/**
 * Plans an inclusive active-serial range without mutating the session.
 *
 * The entire plan is completed and checked before the first callback. Payload sources and borrowed strings are valid
 * only during their callback. Returns zero on success, -1 for invalid input or planning/I/O failure, -2 if max_entries
 * would be exceeded, or the visitor's non-zero return value.
 */
int omega_edit_export_changelog_optimized(const omega_session_t *session_ptr,
                                          const omega_changelog_export_options_t *options,
                                          omega_changelog_plan_visitor_cbk_t cbk, void *user_data);

/**
 * General ranged exporter used by streaming transports. The summary and its content readers are borrowed for the
 * duration of the summary callback. Set optimize to zero for validated all-model raw export.
 */
int omega_edit_export_changelog(const omega_session_t *session_ptr, const omega_changelog_export_options_t *options,
                                int optimize, omega_changelog_export_summary_cbk_t summary_cbk,
                                omega_changelog_plan_visitor_cbk_t entry_cbk, void *user_data);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_CHANGELOG_H
