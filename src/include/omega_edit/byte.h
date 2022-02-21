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

#ifndef OMEGA_EDIT_BYTE_H
#define OMEGA_EDIT_BYTE_H

#include "config.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef OMEGA_BYTE_T omega_byte_t;

#ifdef __cplusplus
}
static_assert(1 == sizeof(omega_byte_t), "size of omega_byte_t is expected to be 1 byte");
#endif

#endif//OMEGA_EDIT_BYTE_H
