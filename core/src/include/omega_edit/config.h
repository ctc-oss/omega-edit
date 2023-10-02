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
 * @file config.h
 * @brief Configuration settings.
 */

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

/** Define to enable debugging */
#define DEBUG

#ifndef OMEGA_VIEWPORT_CAPACITY_LIMIT
/** Default maximum viewport capacity */
#define OMEGA_VIEWPORT_CAPACITY_LIMIT (1024 * 1024)
#endif//OMEGA_VIEWPORT_CAPACITY_LIMIT

#ifndef OMEGA_SEARCH_PATTERN_LENGTH_LIMIT
/** Define the maximum length of a pattern for searching */
#define OMEGA_SEARCH_PATTERN_LENGTH_LIMIT (OMEGA_VIEWPORT_CAPACITY_LIMIT / 2)
#endif//OMEGA_SEARCH_PATTERN_LENGTH_LIMIT

#ifndef OMEGA_BYTE_T
/** Define the byte type to be used across the project */
#define OMEGA_BYTE_T unsigned char
#endif//OMEGA_BYTE_T

#if !defined(__CYGWIN__) &&                                                                                            \
        (defined(WIN32) || defined(_WIN32) || defined(__WIN32) || defined(_WIN64) || defined(_MSC_BUILD))
/** Define if building for Windows */
#define OMEGA_BUILD_WINDOWS
#else
/** Define if building for Unix-like operating systems */
#define OMEGA_BUILD_UNIX
#endif

#if INTPTR_MAX == INT64_MAX
/** Define if building for 64-bit */
#define OMEGA_BUILD_64_BIT
#elif INTPTR_MAX == INT32_MAX
/** Define if building for 32-bit */
#define OMEGA_BUILD_32_BIT
#else
#error Unknown pointer size or missing size macros!
#endif

/**
 * @brief Alias for the open function, accommodating large files if _LARGEFILE_SOURCE is defined.
 */
#ifndef OPEN
#ifdef _LARGEFILE_SOURCE
#define OPEN open
#else
#define OPEN open
#endif
#endif

/**
 * Alias for the close function used to close a file descriptor.
 */
#ifndef CLOSE
#define CLOSE close
#endif

/**
 * Alias for the fseek/fseeko function, using fseeko if _LARGEFILE_SOURCE is defined to accommodate large files.
 */
#ifndef FSEEK
#ifdef _LARGEFILE_SOURCE
#define FSEEK fseeko
#else
#define FSEEK fseek
#endif
#endif

/**
 * Alias for the ftell/ftello function, using ftello if _LARGEFILE_SOURCE is defined to accommodate large files.
 */
#ifndef FTELL
#ifdef _LARGEFILE_SOURCE
#define FTELL ftello
#else
#define FTELL ftell
#endif
#endif


#endif//OMEGA_EDIT_CONFIG_H
