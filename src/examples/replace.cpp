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

/**
 * This application can be used to test out how to do search and replace with Omega Edit.  It also demonstrates how a
 * smart pointer can be used to manage session and match context pointers as safe alternative to explict destruction.
 */
#include "../omega_edit/include/stl_string_adaptor.hpp"
#include "../omega_edit/include/utility.h"
#include "../omega_edit/omega_edit.h"
#include <functional>
#include <iostream>
#include <memory>

using namespace std;

// scoped smart pointer with custom deleter
template<typename T>
using scoped_ptr = std::unique_ptr<T, std::function<void(T *)>>;

int main(int arc, char **argv) {
    if (arc != 5) {
        cerr << argv[0] << " in_file out_file search replace" << endl;
        return -1;
    }
    const auto in_filename = argv[1];
    if (!omega_util_file_exists(in_filename)) {
        cerr << "ERROR: Input file '" << in_filename << "' does not exist (cwd: " << omega_util_get_current_dir() << ")"
             << endl;
        return -1;
    }
    int64_t replacements = 0;
    const string replacement = argv[4];
    auto session_ptr = scoped_ptr<omega_session_t>(omega_edit_create_session(in_filename), omega_edit_destroy_session);
    auto match_context_ptr = scoped_ptr<omega_match_context_t>(
            omega_match_create_context_string(session_ptr.get(), argv[3]), omega_match_destroy_context);
    auto pattern_length = omega_match_context_get_length(match_context_ptr.get());
    if (omega_match_find(match_context_ptr.get())) {
        const auto replacement_length = static_cast<int64_t>(replacement.length());
        do {
            const auto pattern_offset = omega_match_context_get_offset(match_context_ptr.get());
            if (pattern_length == replacement_length) {
                // pattern length matches the replacement length, so a single overwrite is sufficient
                if (0 >= omega_edit_overwrite_string(session_ptr.get(), pattern_offset, replacement)) {
                    cerr << "Error overwriting" << endl;
                    return -1;
                }
            } else {
                // pattern length does not match the replacement length, so first we must delete the pattern, then
                // insert the replacement
                if (0 >= omega_edit_delete(session_ptr.get(), pattern_offset, pattern_length)) {
                    cerr << "Error deleting" << endl;
                    return -1;
                }
                if (0 >= omega_edit_insert_string(session_ptr.get(), pattern_offset, replacement)) {
                    cerr << "Error inserting" << endl;
                    return -1;
                }
            }
            ++replacements;
        } while (omega_match_find(match_context_ptr.get(), replacement_length));//advance find by the replacement length
    }
    if(0 != omega_edit_save(session_ptr.get(), argv[2])) {
        cerr << "Error saving session to " << argv[2] << endl;
        return -1;
    }
    clog << "Replaced " << replacements << " instances using " << omega_session_get_num_changes(session_ptr.get())
         << " changes." << endl;
    return 0;
}
