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

#include <iostream>
#include <omega_edit/stl_string_adaptor.hpp>

using namespace std;

int main(int argc, char **argv) {
    if (argc != 6) {
        cerr << "This program finds patterns from the infile using Ωedit.\n\nUSAGE: " << argv[0]
             << " infile pattern offset length case_insensitive" << endl;
        return -1;
    }
    const auto in_filename = argv[1];
    const auto pattern = argv[2];
    const auto start_offset = stoi(argv[3]);
    const auto length = stoi(argv[4]);
    const auto case_insensitive = stoi(argv[5]);
    if (auto session_ptr = omega_edit_create_session(in_filename, nullptr, nullptr, NO_EVENTS, nullptr)) {
        int num_matches = 0;
        auto search_context =
                omega_search_create_context(session_ptr, pattern, 0, start_offset, length, case_insensitive);
        while (omega_search_next_match(search_context, 1)) {
            const auto match_offset = omega_search_context_get_offset(search_context);
            const auto match_length = omega_search_context_get_length(search_context);
            cout << "offset: " << match_offset << ", length: " << match_length
                 << ", segment: " << omega_session_get_segment_string(session_ptr, match_offset, match_length) << endl;
            ++num_matches;
        }
        cout << "matches found: " << num_matches << endl;
        omega_edit_destroy_session(session_ptr);
    } else {
        cerr << "failed to create session, probably because the infile doesn't exist or is readable, or the offset "
                "and/or length are out of range for the given input file"
             << endl;
        return -1;
    }
    return 0;
}