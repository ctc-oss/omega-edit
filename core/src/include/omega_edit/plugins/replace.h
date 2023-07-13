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

#ifndef OMEGA_EDIT_PLUGINS_REPLACE_H
#define OMEGA_EDIT_PLUGINS_REPLACE_H

#include <stdio.h>
#include "omega_edit/export.h"
#include "omega_edit/byte.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Replace context.
 */
OMEGA_EDIT_EXPORT typedef struct {
    omega_byte_t *search;
    int64_t search_length;
    omega_byte_t *replace;
    int64_t replace_length;
    int case_insensitive;
    int64_t replacements;
} omega_edit_transform_replace_context_t;

/**
 * Replaces tokens in a stream.
 * @param in input stream
 * @param start_offset offset in input stream to start reading
 * @param length number of bytes to read from input stream
 * @param out output stream
 * @param context context
 * @return 0 on success, non-zero on failure
 */
OMEGA_EDIT_EXPORT int omega_edit_transform_replace(FILE *in, int64_t start_offset, int64_t length, FILE *out, void *context);

#ifdef __cplusplus
}
#endif

#endif //OMEGA_EDIT_PLUGINS_REPLACE_H
