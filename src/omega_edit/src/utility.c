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

#include "../include/utility.h"

int omega_util_left_shift_buffer(omega_byte_t *buffer, int64_t len, omega_byte_t shift_left) {
    if (shift_left > 0 && shift_left < 8) {
        omega_byte_t shift_right = 8 - shift_left;
        omega_byte_t mask = ((1 << shift_left) - 1) << shift_right;
        omega_byte_t bits1 = 0;
        for (int64_t i = len - 1; i >= 0; --i) {
            const unsigned char bits2 = buffer[i] & mask;
            buffer[i] <<= shift_left;
            buffer[i] |= bits1 >> shift_right;
            bits1 = bits2;
        }
        return 0;
    }
    return -1;
}

int omega_util_right_shift_buffer(omega_byte_t *buffer, int64_t len, omega_byte_t shift_right) {
    if (shift_right > 0 && shift_right < 8) {
        omega_byte_t shift_left = 8 - shift_right;
        omega_byte_t mask = (1 << shift_right) - 1;
        omega_byte_t bits1 = 0;
        for (int64_t i = len - 1; i >= 0; --i) {
            const unsigned char bits2 = buffer[i] & mask;
            buffer[i] >>= shift_right;
            buffer[i] |= bits1 << shift_left;
            bits1 = bits2;
        }
        return 0;
    }
    return -1;
}
