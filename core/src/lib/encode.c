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

#include "omega_edit/encode.h"
#include <assert.h>

size_t omega_encode_bin2hex(const omega_byte_t *src, char *dst, size_t src_length) {
    assert(src);
    assert(dst);
    static const char HEX_CONVERSION_TABLE[] = "0123456789abcdef";
    size_t j = 0;

    for (size_t i = 0; i < src_length; ++i) {
        dst[j++] = HEX_CONVERSION_TABLE[src[i] >> 4];
        dst[j++] = HEX_CONVERSION_TABLE[src[i] & 15];
    }
    dst[j] = '\0';
    return j;
}

size_t omega_encode_hex2bin(const char *src, omega_byte_t *dst, size_t src_length) {
    assert(src);
    assert(dst);
    const size_t dst_length = src_length >> 1;
    size_t i = 0;
    size_t j = 0;

    while (i < dst_length) {
        omega_byte_t c = src[j++];
        omega_byte_t d;

        if (c >= '0' && c <= '9') {
            d = (omega_byte_t) ((c - '0') << 4);
        } else if (c >= 'a' && c <= 'f') {
            d = (omega_byte_t) ((c - 'a' + 10) << 4);
        } else if (c >= 'A' && c <= 'F') {
            d = (omega_byte_t) ((c - 'A' + 10) << 4);
        } else {
            return 0;
        }
        c = src[j++];

        if (c >= '0' && c <= '9') {
            d |= c - '0';
        } else if (c >= 'a' && c <= 'f') {
            d |= c - 'a' + 10;
        } else if (c >= 'A' && c <= 'F') {
            d |= c - 'A' + 10;
        } else {
            return 0;
        }
        dst[i++] = d;
    }
    dst[i] = '\0';
    return i;
}
