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

#ifndef OMEGA_EDIT_ENCODINGS_H
#define OMEGA_EDIT_ENCODINGS_H

#include "byte.h"

#ifdef __cplusplus
#include <cstddef>
extern "C" {
#else
#include <stddef.h>
#endif

/**
 * Given a pointer to bytes, and a character pointer destination, write the hex values of the bytes to the destination
 * @param src pointer to bytes
 * @param dst destination, must be memory sufficient to hold (src_length * 2) + 1 bytes (will be null-terminated)
 * @param src_length src_length of the bytes
 * @return number of characters written to the destination, or 0 if unsuccessful
 */
size_t omega_bin2hex(const omega_byte_t *src, char *dst, size_t src_length);

/**
 * Given a pointer to hex characters, write the binary representation to dst
 * @param src pointer to hex characters
 * @param dst destination, must be memory sufficient to hold (src_length / 2) bytes
 * @param src_length src_length of the hex characters
 * @return number of bytes written to the destination, or 0 if unsuccessful
 */
size_t omega_hex2bin(const char *src, omega_byte_t *dst, size_t src_length);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_ENCODINGS_H
