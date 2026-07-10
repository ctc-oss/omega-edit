# Copyright (c) 2026 Concurrent Technologies Corporation.
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software distributed under the License is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
# implied.  See the License for the specific language governing permissions and limitations under the License.

include_guard(GLOBAL)

option(OMEGA_EDIT_USE_CCACHE "Use ccache as the C/C++ compiler launcher when available" ON)

if (OMEGA_EDIT_USE_CCACHE)
    find_program(OMEGA_EDIT_CCACHE_EXECUTABLE NAMES ccache)
    if (OMEGA_EDIT_CCACHE_EXECUTABLE)
        foreach (language IN ITEMS C CXX)
            if (NOT CMAKE_${language}_COMPILER_LAUNCHER)
                set(CMAKE_${language}_COMPILER_LAUNCHER "${OMEGA_EDIT_CCACHE_EXECUTABLE}" CACHE STRING
                    "Launcher for the ${language} compiler")
            endif()
        endforeach()
        message(STATUS "Using ccache compiler launcher: ${OMEGA_EDIT_CCACHE_EXECUTABLE}")
    else()
        message(STATUS "ccache not found; compiling without a compiler cache")
    endif()
endif()
