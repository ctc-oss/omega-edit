/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License");                                                    *
 * you may not use this file except in compliance with the License.                                                   *
 * You may obtain a copy of the License at                                                                            *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software                                                *
 * distributed under the License is distributed on an "AS IS" BASIS,                                                  *
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                                           *
 * See the License for the specific language governing permissions and                                                *
 * limitations under the License.                                                                                     *
 **********************************************************************************************************************/

#include "../omega_edit/omega_edit.h"
#include "../omega_edit/include/stl_string_adaptor.hpp"
#include <iostream>

int main(int arc, char **argv) {
    if (arc != 5) {
        std::cerr << argv[0] << " in_file out_file search replace" << std::endl;
        return -1;
    }
    int64_t replacements = 0;
    const std::string replace = argv[4];
    auto session_ptr = omega_edit_create_session(argv[1]);
    std::clog << "session created\n";
    auto match_context_ptr = omega_match_create_context_string(session_ptr, argv[3]);
    std::clog << "match context created\n";
    assert(match_context_ptr);
    int64_t advance_context = 1;
    while (omega_match_find(match_context_ptr, advance_context)) {
        auto pattern_offset = omega_match_context_get_offset(match_context_ptr);
        auto pattern_length = omega_match_context_get_length(match_context_ptr);
        // Remove the search pattern
        omega_edit_delete(session_ptr, pattern_offset, pattern_length);
        // Insert the replacement string
        omega_edit_insert_string(session_ptr, pattern_offset, replace);
        advance_context = static_cast<int64_t>(replace.length());
        ++replacements;
    }
    omega_match_destroy_context(match_context_ptr);
    omega_edit_save(session_ptr, argv[2]);
    omega_edit_destroy_session(session_ptr);
    std::clog << "Replaced " << replacements << " instances" << std::endl;
    return 0;
}
