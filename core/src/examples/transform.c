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

/**
* This application can be used to test out applying byte transforms with Omega Edit.
*/
#include <ctype.h>
#include <omega_edit.h>
#include <stdio.h>

omega_byte_t to_lower(omega_byte_t byte, void *unused) { return (omega_byte_t) tolower(byte); }
omega_byte_t to_upper(omega_byte_t byte, void *unused) { return (omega_byte_t) toupper(byte); }

int main(int argc, char **argv) {
    if (argc != 4) {
        fprintf(stderr, "Usage: %s <transform> infile outfile\n", argv[0]);
        return -1;
    }
    omega_session_t *session_ptr = omega_edit_create_session(argv[2], NULL, NULL, NO_EVENTS, NULL);
    omega_edit_apply_transform(session_ptr, (argv[1][0] == 'l') ? &to_lower : &to_upper, NULL, 0, 0);
    omega_edit_save(session_ptr, argv[3], 1, NULL);
    omega_edit_destroy_session(session_ptr);
    return 0;
}