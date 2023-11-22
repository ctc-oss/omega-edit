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

#include <inttypes.h>
#include <omega_edit.h>
#include <omega_edit/character_counts.h>
#include <stdio.h>

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <filename>\n", argv[0]);
        return 1;
    }
    omega_session_t *session_ptr = omega_edit_create_session(argv[1], NULL, NULL, NO_EVENTS, NULL);
    omega_character_counts_t *character_counts_ptr = omega_character_counts_create();
    omega_session_character_counts(session_ptr, character_counts_ptr, 0,
                                   omega_session_get_computed_file_size(session_ptr),
                                   omega_session_detect_BOM(session_ptr, 0));

    printf("File: %s, BOM: %s\n", argv[1],
           omega_util_BOM_to_string(omega_character_counts_get_BOM(character_counts_ptr)));
    printf("  Single-byte characters: %" PRId64 "\n", omega_character_counts_single_byte_chars(character_counts_ptr));
    printf("  Double-byte characters: %" PRId64 "\n", omega_character_counts_double_byte_chars(character_counts_ptr));
    printf("  Triple-byte characters: %" PRId64 "\n", omega_character_counts_triple_byte_chars(character_counts_ptr));
    printf("  Quad-byte characters  : %" PRId64 "\n", omega_character_counts_quad_byte_chars(character_counts_ptr));
    printf("  Invalid bytes         : %" PRId64 "\n", omega_character_counts_invalid_bytes(character_counts_ptr));

    omega_character_counts_destroy(character_counts_ptr);
    omega_edit_destroy_session(session_ptr);
    return 0;
}