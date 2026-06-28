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

#ifndef OMEGA_EDIT_SAFE_MATH_HPP
#define OMEGA_EDIT_SAFE_MATH_HPP

#include <cstdint>
#include <limits>

namespace omega_edit::internal {

    inline bool add_overflows_int64_(int64_t lhs, int64_t rhs) {
        return (rhs > 0 && lhs > (std::numeric_limits<int64_t>::max)() - rhs) ||
               (rhs < 0 && lhs < (std::numeric_limits<int64_t>::min)() - rhs);
    }

    inline bool safe_add_int64_(int64_t lhs, int64_t rhs, int64_t &result) {
        if (add_overflows_int64_(lhs, rhs)) { return false; }
        result = lhs + rhs;
        return true;
    }

    inline bool valid_nonnegative_range_(int64_t offset, int64_t length) {
        int64_t end = 0;
        return offset >= 0 && length >= 0 && safe_add_int64_(offset, length, end);
    }

}// namespace omega_edit::internal

#endif//OMEGA_EDIT_SAFE_MATH_HPP
