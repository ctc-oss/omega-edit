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

#ifndef OMEGA_EDIT_SEARCH_H
#define OMEGA_EDIT_SEARCH_H

#ifdef __cplusplus
#include <cstddef>
extern "C" {
#else
#include <stddef.h>
#endif

struct omega_search_skip_table_t;

/**
 * Preprocess the needle to create a skip table for use in the omega_search function
 * @param needle needle to process
 * @param needle_length length of the needle to process
 * @return skip table for use in the omega_search function
 */
const omega_search_skip_table_t *omega_search_create_skip_table(const unsigned char *needle, size_t needle_length);

/**
 * Finds the first offset in the haystack where the needle is found, otherwise, return haystack_length
 * @param haystack haystack to search in
 * @param haystack_length length of haystack
 * @param skip_table_ptr skip table for this needle, created using the omega_search_create_skip_table function
 * @param needle needle to find
 * @param needle_length length of needle to find
 * @return first offset in the haystack where the needle was found, or haystack length
 */
const unsigned char *omega_search(const unsigned char *haystack, size_t haystack_length,
                                  const omega_search_skip_table_t *skip_table_ptr, const unsigned char *needle,
                                  size_t needle_length);

/**
 * Destroys a skip table created by omega_search_create_skip_table
 * @param skip_table_ptr skip table to destroy
 */
void omega_search_destroy_skip_table(const omega_search_skip_table_t *skip_table_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_SEARCH_H
