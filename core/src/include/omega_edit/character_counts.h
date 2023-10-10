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
 * @file character_counts.h
 * @brief Functions that operate on character counts (omega_character_counts_t).
 */

#ifndef OMEGA_EDIT_CHARACTER_COUNTS_H
#define OMEGA_EDIT_CHARACTER_COUNTS_H

#include "fwd_defs.h"

#ifdef __cplusplus

#include <cstdint>

extern "C" {
#else

#include <stdint.h>

#endif

/**
 * Create a new omega_character_counts_t object
 * @return new omega_character_counts_t object
 */
omega_character_counts_t *omega_character_counts_create();

/**
 * Destroy an omega_character_counts_t object
 * @param counts_ptr omega_character_counts_t object to destroy
 */
void omega_character_counts_destroy(omega_character_counts_t *counts_ptr);

/**
 * Reset an omega_character_counts_t object
 * @param counts_ptr omega_character_counts_t object to reset
 * @return given omega_character_counts_t object
 * @note This function does not reset the byte order mark (BOM)
 */
omega_character_counts_t *omega_character_counts_reset(omega_character_counts_t *counts_ptr);

/**
 * Get the byte order mark (BOM) for the given omega_character_counts_t object
 * @param counts_ptr omega_character_counts_t object to get the BOM from
 * @return BOM for the given omega_character_counts_t object
 */
omega_bom_t omega_character_counts_get_BOM(const omega_character_counts_t *counts_ptr);

/**
 * Set the byte order mark (BOM) for the given omega_character_counts_t object
 * @param counts_ptr omega_character_counts_t object to set the BOM for
 * @param bom BOM to set for the given omega_character_counts_t object
 * @return given omega_character_counts_t object
 */
omega_character_counts_t *omega_character_counts_set_BOM(omega_character_counts_t *counts_ptr, omega_bom_t bom);

/**
 * Get the number of BOM bytes found for the given omega_character_counts_t object
 * @param counts_ptr omega_character_counts_t object to get the number of BOM bytes from
 * @return number of BOM bytes found for the given omega_character_counts_t object
 */
int64_t omega_character_counts_bom_bytes(const omega_character_counts_t *counts_ptr);

/**
 * Get the number of single byte characters for the given omega_character_counts_t object
 * @param counts_ptr omega_character_counts_t object to get the number of single byte characters from
 * @return number of single byte characters for the given omega_character_counts_t object
 */
int64_t omega_character_counts_single_byte_chars(const omega_character_counts_t *counts_ptr);

/**
 * Get the number of double byte characters for the given omega_character_counts_t object
 * @param counts_ptr omega_character_counts_t object to get the number of double byte characters from
 * @return number of double byte characters for the given omega_character_counts_t object
 */
int64_t omega_character_counts_double_byte_chars(const omega_character_counts_t *counts_ptr);

/**
 * Get the number of triple byte characters for the given omega_character_counts_t object
 * @param counts_ptr omega_character_counts_t object to get the number of triple byte characters from
 * @return number of triple byte characters for the given omega_character_counts_t object
 */
int64_t omega_character_counts_triple_byte_chars(const omega_character_counts_t *counts_ptr);

/**
 * Get the number of quad byte characters for the given omega_character_counts_t object
 * @param counts_ptr omega_character_counts_t object to get the number of quad byte characters from
 * @return number of quad byte characters for the given omega_character_counts_t object
 */
int64_t omega_character_counts_quad_byte_chars(const omega_character_counts_t *counts_ptr);

/**
 * Get the number of invalid sequences for the given omega_character_counts_t object
 * @param counts_ptr omega_character_counts_t object to get the number of invalid sequences from
 * @return number of invalid sequences for the given omega_character_counts_t object
 */
int64_t omega_character_counts_invalid_bytes(const omega_character_counts_t *counts_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_CHARACTER_COUNTS_H
