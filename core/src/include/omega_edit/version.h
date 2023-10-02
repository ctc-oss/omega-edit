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

/**
 * @file version.h
 * @brief Functions that return version information.
 */

#ifndef OMEGA_EDIT_VERSION_H
#define OMEGA_EDIT_VERSION_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Get the major version of the library
 * @return the major version of the library
 */
int omega_version_major();

/**
 * Get the minor version of the library
 * @return the minor version of the library
 */
int omega_version_minor();

/**
 * Get the patch-level of the library
 * @return the patch-level of the library
 */
int omega_version_patch();

/**
 * Get the integer representation of the version of the library
 * @return the integer representation of the version of the library
 * @code
 *      auto version = omega_version();
 *      auto major = (version >> 24) & 0xFF;
 *      auto minor = (version >> 16) & 0xFF;
 *      auto patch = version & 0xFF;
 * @endcode
 */
int omega_version();

/**
 * Returns "shared" if the library has been built as a shared library, or "static" if the library is built as a static
 * library
 * @return "shared" if the library has been built as a shared library, or "static" if the library is built as a static
 * library
 */
char const *omega_libtype();

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_VERSION_H
