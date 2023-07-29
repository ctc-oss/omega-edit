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

#include <ctype.h>
#include <string.h>
#include <stdlib.h>
#include "omega_edit/plugins/replace.h"
#include "omega_edit/utility.h"

#define READ_BUFFER_SIZE 4096
#define SEARCH_THRESHOLD 10
#define MIN(a, b) ((a) < (b) ? (a) : (b))

static inline void
create_shift_table_(const omega_byte_t *search_token, int64_t search_len, int64_t *table, int case_insensitive) {
    int64_t i;

    for (i = 0; i < 256; ++i) {
        table[i] = search_len;
    }

    for (i = 0; i < search_len - 1; ++i) {
        table[case_insensitive ? tolower(search_token[i]) : search_token[i]] = search_len - 1 - i;
    }
}

static inline int64_t
boyer_moore_search_replace_(FILE *file_in, int64_t read_length, const omega_byte_t *search_token, int64_t search_len,
                            const omega_byte_t *replace_token, int64_t replace_len, FILE *file_out,
                            int case_insensitive) {
    int64_t buffer_fill = 0;
    int64_t read_count;
    int64_t replacements = 0;
    int64_t shift_table[256];
    int64_t total_read = 0;

    create_shift_table_(search_token, search_len, shift_table, case_insensitive);

    unsigned char *read_buffer = (unsigned char *) (malloc(READ_BUFFER_SIZE + search_len)); // overlap for searching
    if (read_buffer == NULL) {
        return -1;
    }

    while (total_read < read_length &&
           (read_count = fread(read_buffer + buffer_fill, 1, MIN(READ_BUFFER_SIZE, read_length - total_read),
                               file_in)) > 0) {
        total_read += read_count;
        size_t i = 0;
        buffer_fill += read_count;

        while (i <= buffer_fill - search_len) {
            if (case_insensitive ?
                omega_util_strnicmp((const char *) read_buffer + i, (const char *) search_token, search_len) != 0 :
                memcmp(read_buffer + i, search_token, search_len) != 0) {
                i += shift_table[case_insensitive ? tolower(read_buffer[i + search_len - 1]) : read_buffer[i +
                                                                                                           search_len -
                                                                                                           1]];
            } else {
                if (fwrite(replace_token, 1, replace_len, file_out) != replace_len) {
                    free(read_buffer);
                    return -1;
                }
                ++replacements;
                i += search_len;
            }
        }

        memmove(read_buffer, read_buffer + i, buffer_fill - i);
        buffer_fill -= i;
    }

    if (fwrite(read_buffer, 1, buffer_fill, file_out) != buffer_fill) {
        free(read_buffer);
        return -1;
    }

    free(read_buffer);
    return replacements;
}

static inline int64_t
simple_search_replace_(FILE *file_in, int64_t read_length, const omega_byte_t *search_token, int64_t search_len,
                       const omega_byte_t *replace_token, int64_t replace_len, FILE *file_out, int case_insensitive) {
    char c;
    int64_t replacements = 0;
    int64_t total_read = 0;
    unsigned char *buffer = (unsigned char *) (malloc(search_len));

    if (buffer == NULL) {
        return -1;
    }

    memset(buffer, 0, search_len);

    while (total_read < read_length && fread(&c, 1, 1, file_in) > 0) {
        ++total_read;
        memmove(buffer, buffer + 1, search_len - 1);
        buffer[search_len - 1] = c;

        if (case_insensitive ? omega_util_strnicmp((const char *) buffer, (const char *) search_token, search_len) == 0
                             : memcmp(buffer, search_token, search_len) == 0) {
            if (fwrite(replace_token, 1, replace_len, file_out) != replace_len) {
                free(buffer);
                return -1;
            }
            ++replacements;
            memset(buffer, 0, search_len);
        } else {
            if (fwrite(&buffer[0], 1, 1, file_out) != 1) {
                free(buffer);
                return -1;
            }
        }
    }

    free(buffer);
    return replacements;
}

static inline int64_t
stream_replace_(FILE *file_in, int64_t read_length, const omega_byte_t *search_token, int64_t search_len,
                const omega_byte_t *replace_token, int64_t replace_len, FILE *file_out, int case_insensitive) {
    return (search_len < SEARCH_THRESHOLD) ? simple_search_replace_(file_in, read_length, search_token, search_len,
                                                                    replace_token, replace_len, file_out,
                                                                    case_insensitive) : boyer_moore_search_replace_(
            file_in, read_length, search_token, search_len, replace_token, replace_len, file_out, case_insensitive);
}

int omega_edit_transform_replace(FILE *in, int64_t start_offset, int64_t length, FILE *out, void *context) {
    int rc;
    if (length < 1) {
        rc = fseeko(in, 0, SEEK_END);
        if (rc != 0) {
            return rc;
        }
        length = ftello(in) - start_offset;
        if (length < 1) {
            return -1;
        }
    }
    rc = fseeko(in, start_offset, SEEK_SET);
    if (rc == 0) {
        omega_edit_transform_replace_context_t *replace_context = (omega_edit_transform_replace_context_t *) context;

        replace_context->replacements = stream_replace_(in, length, replace_context->search,
                                                        replace_context->search_length, replace_context->replace,
                                                        replace_context->replace_length, out,
                                                        replace_context->case_insensitive);
    }
    return rc;
}

