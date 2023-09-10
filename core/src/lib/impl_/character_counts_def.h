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

#ifndef OMEGA_EDIT_CHARACTER_COUNTS_DEF_H
#define OMEGA_EDIT_CHARACTER_COUNTS_DEF_H

#include "../../include/omega_edit/fwd_defs.h"
#include <stdint.h>

/**
 * Counts of single byte, and multi-byte characters for the given byte order mark (BOM)
 */
struct omega_character_counts_struct {
    omega_bom_t bom;
    int64_t bomBytes;
    int64_t singleByteChars;
    int64_t doubleByteChars;
    int64_t tripleByteChars;
    int64_t quadByteChars;
    int64_t invalidBytes;
};

#endif //OMEGA_EDIT_CHARACTER_COUNTS_DEF_H
