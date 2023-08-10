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

#include "../include/omega_edit/version.h"

#ifndef OMEGA_EDIT_VERSION_MAJOR
#define OMEGA_EDIT_VERSION_MAJOR 0
#endif

#ifndef OMEGA_EDIT_VERSION_MINOR
#define OMEGA_EDIT_VERSION_MINOR 0
#endif

#ifndef OMEGA_EDIT_VERSION_PATCH
#define OMEGA_EDIT_VERSION_PATCH 0
#endif

#define OMEGA_EDIT_VERSION                                                                                             \
    (((OMEGA_EDIT_VERSION_MAJOR) << 24) + ((OMEGA_EDIT_VERSION_MINOR) << 16) + (OMEGA_EDIT_VERSION_PATCH))

#ifdef OMEGA_EDIT_STATIC_DEFINE
#define OMEGA_EDIT_LIBTYPE "static"
#else
#define OMEGA_EDIT_LIBTYPE "shared"
#endif

int omega_version_major() { return OMEGA_EDIT_VERSION_MAJOR; }

int omega_version_minor() { return OMEGA_EDIT_VERSION_MINOR; }

int omega_version_patch() { return OMEGA_EDIT_VERSION_PATCH; }

int omega_version() { return OMEGA_EDIT_VERSION; }

char const *omega_libtype() { return OMEGA_EDIT_LIBTYPE; }
