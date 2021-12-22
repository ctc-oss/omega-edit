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

#include "../omega_edit/omega_edit.h"
#include <stdio.h>

void vpt_change_cbk(const omega_viewport_t *viewport_ptr, const omega_change_t *change_ptr) {
    char change_kind = (change_ptr) ? omega_change_get_kind_as_char(change_ptr) : 'R';
    fprintf(stdout, "%c: [%s]\n", change_kind, omega_viewport_get_data(viewport_ptr));
}

int main() {
    omega_session_t *session_ptr = omega_edit_create_session(NULL, NULL, NULL);
    omega_edit_create_viewport(session_ptr, 0, 100, vpt_change_cbk, NULL);
    omega_edit_insert(session_ptr, 0, "Hello Weird!!!!", 0);
    omega_edit_overwrite(session_ptr, 7, "orl", 0);
    omega_edit_delete(session_ptr, 11, 3);
    omega_edit_save(session_ptr, "hello.txt");
    omega_edit_destroy_session(session_ptr);
    return 0;
}
