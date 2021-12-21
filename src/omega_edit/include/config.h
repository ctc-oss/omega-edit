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

#ifndef OMEGA_EDIT_CONFIG_H
#define OMEGA_EDIT_CONFIG_H

/***********************************************************************************************************************
 * CONFIGURATION
 **********************************************************************************************************************/

// Define to enable debugging
//#define DEBUG

// Default maximum viewport capacity
#ifndef OMEGA_VIEWPORT_CAPACITY_LIMIT
#define OMEGA_VIEWPORT_CAPACITY_LIMIT (1024 * 1024)
#endif//OMEGA_VIEWPORT_CAPACITY_LIMIT

// Define the maximum length of a pattern for searching
#ifndef OMEGA_SEARCH_PATTERN_LENGTH_LIMIT
#define OMEGA_SEARCH_PATTERN_LENGTH_LIMIT (OMEGA_VIEWPORT_CAPACITY_LIMIT / 2)
#endif//OMEGA_SEARCH_PATTERN_LENGTH_LIMIT

// Define the byte type to be used across the project
#ifndef OMEGA_BYTE_T
#define OMEGA_BYTE_T unsigned char
#endif//OMEGA_BYTE_T

#endif//OMEGA_EDIT_CONFIG_H
