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

#ifndef OMEGA_EDIT_DATA_SEGMENT_DEF_HPP
#define OMEGA_EDIT_DATA_SEGMENT_DEF_HPP

#include "data_def.hpp"
#include "internal_fwd_defs.hpp"
#include <cstdint>
#include <cstdlib>

/**
 * A segment of data
 */
struct omega_data_segment_struct {
    int64_t offset{};   ///< Data offset as changes have been made
    int64_t length{};   ///< Populated data length (in bytes)
    int64_t capacity{}; ///< Data capacity (in bytes)
    omega_data_t data{};///< Copy of the data itself
};

inline omega_byte_t *omega_data_segment_get_data(omega_data_segment_t *data_segment_ptr) {
    return omega_data_get_data(&data_segment_ptr->data, std::abs(data_segment_ptr->capacity));
}

#endif//OMEGA_EDIT_DATA_SEGMENT_DEF_HPP
