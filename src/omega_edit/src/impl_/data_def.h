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

#ifndef OMEGA_EDIT_DATA_DEF_H
#define OMEGA_EDIT_DATA_DEF_H

#include "../../include/byte.h"
#include <memory>

typedef std::unique_ptr<omega_byte_t[]> data_ptr_t;

/**
 * Union to hold consecutive bytes of data.  If the length of the data is less than 8, the data will be stored directly
 * in the sm_bytes field.  If the length is greater than 7, the data will be stored in allocated space on the heap
 * whose address will be stored in the bytes field.
 */
union data_t {
    data_ptr_t bytes_ptr{};  ///< Hold bytes of length greater than 7
    omega_byte_t sm_bytes[8];///< Hold bytes of length less than 8
    ~data_t(){};             // NOLINT This destructor is required, but don't use =default
};

#endif//OMEGA_EDIT_DATA_DEF_H
