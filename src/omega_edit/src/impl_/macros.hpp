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

#ifndef OMEGA_EDIT_MACROS_HPP
#define OMEGA_EDIT_MACROS_HPP

#include "../../include/config.h"
#include <cstdlib>
#include <cstring>
#include <iostream>

#define SOURCE_FILENAME (std::strrchr(__FILE__, '/') ? std::strrchr(__FILE__, '/') + 1 : __FILE__)
#define LOCATION SOURCE_FILENAME << "@" << __LINE__ << "::" << __FUNCTION__ << ":"
#define ABORT(x)                                                                                                       \
    do { x std::abort(); } while (0)

#ifndef CLOG
#define CLOG std::clog
#endif//CLOG

#define DEBUG
#ifdef DEBUG
#define DBG(x)                                                                                                         \
    do { x } while (0)
#else//DEBUG
#define DBG(x)
#endif//DEBUG

#endif//OMEGA_EDIT_MACROS_HPP
