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

#ifdef __cplusplus
#include <cstdint>
#else
#include <stdint.h>
#endif//__cplusplus

/***********************************************************************************************************************
 * CONFIGURATION
 **********************************************************************************************************************/

// Define to enable debugging
#define DEBUG

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

#if !defined(__CYGWIN__) &&                                                                                            \
        (defined(WIN32) || defined(_WIN32) || defined(__WIN32) || defined(_WIN64) || defined(_MSC_BUILD))
#define OMEGA_BUILD_WINDOWS
#else
#define OMEGA_BUILD_UNIX
#endif

#if INTPTR_MAX == INT64_MAX
#define OMEGA_BUILD_64_BIT
#elif INTPTR_MAX == INT32_MAX
#define OMEGA_BUILD_32_BIT
#else
#error Unknown pointer size or missing size macros!
#endif

#ifndef OPEN
#ifdef _LARGEFILE_SOURCE
#define OPEN open
#else
#define OPEN open
#endif
#endif

#ifndef FSEEK
#ifdef _LARGEFILE_SOURCE
#define FSEEK fseeko
#else
#define FSEEK fseek
#endif
#endif

#ifndef FTELL
#ifdef _LARGEFILE_SOURCE
#define FTELL ftello
#else
#define FTELL ftell
#endif
#endif

#endif//OMEGA_EDIT_CONFIG_H
