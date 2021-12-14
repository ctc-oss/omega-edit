/**********************************************************************************************************************
* Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
*                                                                                                                    *
* Licensed under the Apache License, Version 2.0 (the "License");                                                    *
* you may not use this file except in compliance with the License.                                                   *
* You may obtain a copy of the License at                                                                            *
*                                                                                                                    *
*     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
*                                                                                                                    *
* Unless required by applicable law or agreed to in writing, software                                                *
* distributed under the License is distributed on an "AS IS" BASIS,                                                  *
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                                           *
* See the License for the specific language governing permissions and                                                *
* limitations under the License.                                                                                     *
**********************************************************************************************************************/

#ifndef OMEGA_EDIT_SEARCH_H
#define OMEGA_EDIT_SEARCH_H

#include <cstddef>

#ifdef __cplusplus
extern "C" {
#endif

struct skip_table_t;

/**
 * Preprocess the needle to create a skip table for use in the string_search function
 * @param needle needle to process
 * @param needle_length length of the needle to process
 * @return skip table for use in the string_search function
 */
const skip_table_t *create_skip_table(const unsigned char *needle, size_t needle_length);

/**
 * Finds the first offset in the haystack where the needle is found, otherwise, return haystack_length
 * @param haystack haystack to search in
 * @param haystack_length length of haystack
 * @param skip_table_ptr skip table for this needle, created using the create_skip_table function
 * @param needle needle to find
 * @param needle_length length of needle to find
 * @return first offset in the haystack where the needle was found, or haystack length
 */
const unsigned char *string_search(const unsigned char *haystack, size_t haystack_length,
                                   const skip_table_t *skip_table_ptr, const unsigned char *needle,
                                   size_t needle_length);

/**
 * Destroys a skip table created by create_skip_table
 * @param skip_table_ptr skip table to destroy
 */
void destroy_skip_table(const skip_table_t *skip_table_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_SEARCH_H
