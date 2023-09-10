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

#include "../include/omega_edit/character_counts.h"
#include "impl_/character_counts_def.h"
#include <assert.h>
#include <stdlib.h>

omega_character_counts_t *omega_character_counts_create() {
    // use calloc to initialize all fields to zero
    omega_character_counts_t *counts_ptr = (omega_character_counts_t *) calloc(1, sizeof(omega_character_counts_t));
    assert(counts_ptr);
    return counts_ptr;
}

void omega_character_counts_destroy(omega_character_counts_t *counts_ptr) {
    assert(counts_ptr);
    free(counts_ptr);
}

void omega_character_counts_reset(omega_character_counts_t *counts_ptr) {
    assert(counts_ptr);
    counts_ptr->bomBytes = 0;
    counts_ptr->singleByteChars = 0;
    counts_ptr->doubleByteChars = 0;
    counts_ptr->tripleByteChars = 0;
    counts_ptr->quadByteChars = 0;
    counts_ptr->invalidBytes = 0;
}

omega_bom_t omega_character_counts_get_BOM(const omega_character_counts_t *counts_ptr) {
    assert(counts_ptr);
    return counts_ptr->bom;
}

void omega_character_counts_set_BOM(omega_character_counts_t *counts_ptr, omega_bom_t bom) {
    assert(counts_ptr);
    counts_ptr->bom = bom;
}

int64_t omega_character_counts_bom_bytes(const omega_character_counts_t *counts_ptr) {
    assert(counts_ptr);
    return counts_ptr->bomBytes;
}

int64_t omega_character_counts_single_byte_chars(const omega_character_counts_t *counts_ptr) {
    assert(counts_ptr);
    return counts_ptr->singleByteChars;
}

int64_t omega_character_counts_double_byte_chars(const omega_character_counts_t *counts_ptr) {
    assert(counts_ptr);
    return counts_ptr->doubleByteChars;
}

int64_t omega_character_counts_triple_byte_chars(const omega_character_counts_t *counts_ptr) {
    assert(counts_ptr);
    return counts_ptr->tripleByteChars;
}

int64_t omega_character_counts_quad_byte_chars(const omega_character_counts_t *counts_ptr) {
    assert(counts_ptr);
    return counts_ptr->quadByteChars;
}

int64_t omega_character_counts_invalid_bytes(const omega_character_counts_t *counts_ptr) {
    assert(counts_ptr);
    return counts_ptr->invalidBytes;
}
