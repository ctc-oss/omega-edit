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

#ifndef OMEGA_EDIT_MACROS_H
#define OMEGA_EDIT_MACROS_H

#include "omega_edit/config.h"

#ifdef __cplusplus

#include <cstdlib>
#include <cstring>
#include <iostream>

#define SOURCE_FILENAME (std::strrchr(__FILE__, '/') ? std::strrchr(__FILE__, '/') + 1 : __FILE__)
#define ABORT(x)                                                                                                       \
    do { x std::abort(); } while (0)
#else

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SOURCE_FILENAME (strrchr(__FILE__, '/') ? strrchr(__FILE__, '/') + 1 : __FILE__)
#define ABORT(x)                                                                                                       \
    do { x abort(); } while (0)
#endif

#ifdef DEBUG
#define DBG(x)                                                                                                         \
    do { x } while (0)
#else//DEBUG
#define DBG(x)
#endif//DEBUG

#ifdef __cplusplus
#define LOCATION SOURCE_FILENAME << "@" << __LINE__ << "::" << __FUNCTION__ << ": "
#ifndef CLOG
#define CLOG std::clog
#endif//CLOG
#define LOG_ERROR(x)                                                                                                   \
    do { CLOG << LOCATION << x << std::endl; } while (0)
#define LOG_ERRNO()                                                                                                    \
    do { CLOG << LOCATION << "errno=" << errno << ": " << std::strerror(errno) << std::endl; } while (0)
#else
#define LOG_ERROR(x)                                                                                                   \
    do { fprintf(stderr, "%s@%d::%s: %s\n", SOURCE_FILENAME, __LINE__, __FUNCTION__, (x)); } while (0)
#define LOG_ERRNO()                                                                                                    \
    do {                                                                                                               \
        fprintf(stderr, "%s@%d::%s: errno=%d: %s\n", SOURCE_FILENAME, __LINE__, __FUNCTION__, errno, strerror(errno)); \
    } while (0)
#endif

#endif//OMEGA_EDIT_MACROS_H
