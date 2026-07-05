/**********************************************************************************************************************
 * Copyright (c) 2026 Concurrent Technologies Corporation.                                                            *
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

#ifndef OMEGA_EDIT_C_PLUGIN_OPTIONS_H
#define OMEGA_EDIT_C_PLUGIN_OPTIONS_H

#include <ctype.h>
#include <stddef.h>
#include <string.h>

static inline void omega_plugin_json_skip_ws(const char **cursor) {
    while (cursor && *cursor && isspace((unsigned char) **cursor)) { ++(*cursor); }
}

static inline int omega_plugin_json_parse_string(const char **cursor, char *out, size_t out_size) {
    if (!cursor || !*cursor || **cursor != '"' || out_size == 0) { return -1; }
    ++(*cursor);
    size_t length = 0;
    while (**cursor && **cursor != '"') {
        char ch = **cursor;
        if (ch == '\\') {
            ++(*cursor);
            if (!**cursor) { return -1; }
            ch = **cursor;
        }
        if (length + 1 >= out_size) { return -1; }
        out[length++] = ch;
        ++(*cursor);
    }
    if (**cursor != '"') { return -1; }
    ++(*cursor);
    out[length] = '\0';
    return 0;
}

static inline int omega_plugin_json_parse_bool(const char **cursor, int *value_out) {
    if (!cursor || !*cursor || !value_out) { return -1; }
    if (strncmp(*cursor, "true", 4) == 0) {
        *cursor += 4;
        *value_out = 1;
        return 0;
    }
    if (strncmp(*cursor, "false", 5) == 0) {
        *cursor += 5;
        *value_out = 0;
        return 0;
    }
    return -1;
}

static inline int omega_plugin_json_skip_string(const char **cursor) {
    if (!cursor || !*cursor || **cursor != '"') { return -1; }
    ++(*cursor);
    while (**cursor && **cursor != '"') {
        if (**cursor == '\\') {
            ++(*cursor);
            if (!**cursor) { return -1; }
        }
        ++(*cursor);
    }
    if (**cursor != '"') { return -1; }
    ++(*cursor);
    return 0;
}

static inline int omega_plugin_json_skip_value(const char **cursor, size_t max_depth) {
    if (!cursor || !*cursor || max_depth == 0) { return -1; }
    omega_plugin_json_skip_ws(cursor);
    if (**cursor == '"') { return omega_plugin_json_skip_string(cursor); }

    if (**cursor == '{' || **cursor == '[') {
        char nesting[256];
        size_t depth = 0;
        if (max_depth > sizeof(nesting)) { max_depth = sizeof(nesting); }

        nesting[depth++] = **cursor;
        ++(*cursor);
        while (**cursor && depth > 0) {
            if (**cursor == '"') {
                if (omega_plugin_json_skip_string(cursor) != 0) { return -1; }
                continue;
            }
            if (**cursor == '{' || **cursor == '[') {
                if (depth >= max_depth) { return -1; }
                nesting[depth++] = **cursor;
                ++(*cursor);
                continue;
            }
            if (**cursor == '}' || **cursor == ']') {
                const char expected = nesting[depth - 1] == '{' ? '}' : ']';
                if (**cursor != expected) { return -1; }
                --depth;
                ++(*cursor);
                continue;
            }
            ++(*cursor);
        }
        return depth == 0 ? 0 : -1;
    }

    while (**cursor && **cursor != ',' && **cursor != '}' && **cursor != ']') { ++(*cursor); }
    return 0;
}

#endif// OMEGA_EDIT_C_PLUGIN_OPTIONS_H
