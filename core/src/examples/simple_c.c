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

#include <omega_edit.h>
#include <stdio.h>
#include <stdlib.h>

void vpt_change_cbk(const omega_viewport_t *viewport_ptr, omega_viewport_event_t viewport_event,
                    const void *viewport_event_ptr) {
    switch (viewport_event) {
        case VIEWPORT_EVT_CREATE:
        case VIEWPORT_EVT_EDIT: {
            char change_kind = viewport_event_ptr
                               ? omega_change_get_kind_as_char((const omega_change_t *) (viewport_event_ptr))
                               : 'R';
            fprintf((FILE *) (omega_viewport_get_user_data_ptr(viewport_ptr)), "%c: [%s]\n", change_kind,
                    omega_viewport_get_data(viewport_ptr));
            break;
        }
        default:
            abort();
    }
}

int main() {
    omega_session_t *session_ptr = omega_edit_create_session(NULL, NULL, NULL, NO_EVENTS, NULL);
    omega_edit_create_viewport(session_ptr, 0, 100, 0, vpt_change_cbk, stdout, VIEWPORT_EVT_CREATE | VIEWPORT_EVT_EDIT);
    omega_edit_insert(session_ptr, 0, "Hello Weird!!!!", 0);
    omega_edit_overwrite(session_ptr, 7, "orl", 0);
    omega_edit_delete(session_ptr, 11, 3);
    omega_edit_save(session_ptr, "hello.txt", IO_FLG_OVERWRITE, NULL);
    omega_edit_destroy_session(session_ptr);
    return 0;
}
