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

#include "omega_edit/plugins/replace.h"
#include "omega_edit/check.h"
#include <omega_edit.h>
#include <string.h>
#include <stdlib.h>
#include <assert.h>

int main(int argc, char **argv) {
    if (argc != 6) {
        fprintf(stderr, "USAGE: %s <input file> <output file> <search string> <replace string> <case insensitive>\n",
                argv[0]);
        return -1;
    }

    omega_session_t *session_ptr = omega_edit_create_session(argv[1], NULL, NULL, NO_EVENTS, NULL);
    if (!session_ptr) {
        fprintf(stderr, "ERROR: Failed to open input file %s\n", argv[1]);
        return -1;
    }

    // Create the context
    omega_edit_transform_replace_context_t context;
    context.search = (omega_byte_t *) argv[3];
    context.search_length = (int64_t) strlen(argv[3]);
    context.replace = (omega_byte_t *) argv[4];
    context.replace_length = (int64_t) strlen(argv[4]);
    context.case_insensitive = atoi(argv[5]);
    context.replacements = 0;

    int rc = omega_check_model(session_ptr);
    fprintf(stderr, "%d\n", rc);
    assert(0 == rc);
    omega_edit_apply_transform(session_ptr, 0, 0, omega_edit_transform_replace, &context);
    rc = omega_check_model(session_ptr);
    fprintf(stderr, "%d\n", rc);
    assert(0 == rc);
    return omega_edit_save(session_ptr, argv[2], IO_FLG_OVERWRITE, NULL);
}
