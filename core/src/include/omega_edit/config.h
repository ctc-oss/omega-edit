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

#include <fcntl.h>
#include <omega_edit/features.h>// this header is generated at build time

#ifdef __cplusplus

#include <cstdint>
#include <cstdio>

#else

#include <stdint.h>
#include <stdio.h>

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

#if !defined(__CYGWIN__) && \
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

#ifdef _MSC_VER
#include <io.h>
// For MSVC, use _sopen_s
static inline int safe_open_(const char *filename, int oflag, int pmode) {
    int fd;
    _sopen_s(&fd, filename, oflag | _O_BINARY, _SH_DENYWR, pmode);
    return fd;
}
#else

// For other compilers/platforms, fall back to open
static inline int safe_open_(const char *filename, int oflag, int pmode) {
    // Note: The mode only applies if O_CREAT is part of oflag
    return open(filename, oflag, pmode);
}

#endif

/**
 * @brief Alias for the open function, accommodating large files if _LARGEFILE_SOURCE is defined.
 */
#ifndef OPEN
#define OPEN safe_open_
#endif

/**
 * @brief Function to safely open a file pointer, using fopen_s where supported.
 * @param filename file name to open
 * @param mode mode to open the file in
 * @return opened file pointer
 */
static inline FILE *safe_fopen_(const char *filename, const char *mode) {
    FILE *file;
#ifdef HAVE_FOPEN_S
    // Use fopen_s where supported
    fopen_s(&file, filename, mode);
#else
    // Fallback for compilers that don't support fopen_s
    file = fopen(filename, mode);
#endif
    return file;
}

/**
 * Alias for the fopen function used to open a file pointer.
 */
#ifndef FOPEN
#define FOPEN safe_fopen_
#endif

/**
 * Alias for the fclose function used to close a file pointer.
 */
#ifndef FCLOSE
#define FCLOSE fclose
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
#ifdef HAVE_FSEEKO
#define FSEEK fseeko
#else
#define FSEEK fseek
#endif
#endif

/**
 * Alias for the ftell/ftello function, using ftello if _LARGEFILE_SOURCE is defined to accommodate large files.
 */
#ifndef FTELL
#ifdef HAVE_FTELLO
#define FTELL ftello
#else
#define FTELL ftell
#endif
#endif


#endif//OMEGA_EDIT_CONFIG_H
