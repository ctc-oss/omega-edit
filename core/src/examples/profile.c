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
* This application can be used to test out and demonstrate the Omega-Edit session profiler.
*/
#define __STDC_FORMAT_MACROS

#include <assert.h>
#include <ctype.h>
#include <inttypes.h>
#include <omega_edit.h>
#include <stdio.h>

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "Usage: %s infile\n", argv[0]);
        return -1;
    }
    omega_byte_frequency_profile_t byte_frequency_profile;
    omega_session_t *session_ptr = omega_edit_create_session(argv[1], NULL, NULL, NO_EVENTS, NULL);
    const int64_t file_size = omega_session_get_computed_file_size(session_ptr);
    omega_session_byte_frequency_profile(session_ptr, &byte_frequency_profile, 0, file_size);
    omega_edit_destroy_session(session_ptr);
    int64_t ascii_bytes = 0;
    int64_t non_ascii_bytes = 0;
    for (int i = 0; i < 256; ++i) {
        const int64_t freq = byte_frequency_profile[i];
        // use the byte frequency profile to sum ASCII and non-ASCII bytes
        if (0 < freq) {
            if (isascii(i)) {
                ascii_bytes += freq;
            } else {
                non_ascii_bytes += freq;
            }
        }
        fprintf(stdout, "%d:%" PRId64 ", ", i, byte_frequency_profile[i]);
        if (0 == (i + 1) % 16) fprintf(stdout, "\n");
    }
    assert(file_size == ascii_bytes + non_ascii_bytes);
    fprintf(stdout, "\nTotal bytes: %" PRId64 "\n", file_size);
    fprintf(stdout, "ASCII bytes: %" PRId64 "\n", ascii_bytes);
    fprintf(stdout, "non-ASCII bytes: %" PRId64 "\n", non_ascii_bytes);
    fprintf(stdout, "Carriage return bytes: %" PRId64 "\n", byte_frequency_profile['\r']);
    fprintf(stdout, "Line feed bytes: %" PRId64 "\n", byte_frequency_profile['\n']);
    return 0;
}
