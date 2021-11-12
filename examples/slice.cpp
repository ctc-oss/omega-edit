/*
* Copyright 2021 Concurrent Technologies Corporation
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

#include "../omega_edit/omega_edit.h"
#include <string>

using namespace std;

int main(int argc, char **argv) {
    if (argc != 5) {
        fprintf(stderr,
                "This program extracts a slice from the infile and writes it to the outfile using an Omega Edit\n"
                "session.\n\n"
                "USAGE: %s infile outfile offset length\n",
                argv[0]);
        return -1;
    }
    auto in_filename = argv[1];
    auto out_filename = argv[2];
    auto in_fptr = fopen(in_filename, "r");
    if (!in_fptr) {
        fprintf(stderr, "failed to open %s for reading\n", in_filename);
        return -1;
    }
    auto out_fptr = fopen(out_filename, "w");
    if (!out_fptr) {
        fprintf(stderr, "failed to open %s for writing\n", out_filename);
        return -1;
    }
    auto session_ptr =
            create_session(in_fptr, nullptr, nullptr, DEFAULT_VIEWPORT_MAX_CAPACITY, stoll(argv[3]), stoll(argv[4]));
    if (session_ptr) {
        save_to_file(session_ptr, out_fptr);
        destroy_session(session_ptr);
    } else {
        fprintf(stderr, "failed to create session, probably because the offset and/or length are out of range for the\n"
                        "given input file\n");
    }
    fclose(out_fptr);
    fclose(in_fptr);
    return 0;
}