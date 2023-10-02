# Copyright (c) 2021 Concurrent Technologies Corporation.
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software is distributed under the License is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
# implied.  See the License for the specific language governing permissions and limitations under the License.

cmake_minimum_required(VERSION 3.13)

set(omega_edit_known_comps static shared)
set(omega_edit_comp_static NO)
set(omega_edit_comp_shared NO)
foreach (omega_edit_comp IN LISTS ${CMAKE_FIND_PACKAGE_NAME}_FIND_COMPONENTS)
    if (omega_edit_comp IN_LIST omega_edit_known_comps)
        set(omega_edit_comp_${omega_edit_comp} YES)
    else ()
        set(${CMAKE_FIND_PACKAGE_NAME}_NOT_FOUND_MESSAGE
                "omega_edit does not recognize component `${omega_edit_comp}`.")
        set(${CMAKE_FIND_PACKAGE_NAME}_FOUND FALSE)
        return()
    endif ()
endforeach ()

if (omega_edit_comp_static AND omega_edit_comp_shared)
    set(${CMAKE_FIND_PACKAGE_NAME}_NOT_FOUND_MESSAGE
            "omega_edit `static` and `shared` components are mutually exclusive.")
    set(${CMAKE_FIND_PACKAGE_NAME}_FOUND FALSE)
    return()
endif ()

set(omega_edit_static_targets "${CMAKE_CURRENT_LIST_DIR}/omega_edit-static-targets.cmake")
set(omega_edit_shared_targets "${CMAKE_CURRENT_LIST_DIR}/omega_edit-shared-targets.cmake")

macro(omega_edit_load_targets type)
    if (NOT EXISTS "${omega_edit_${type}_targets}")
        set(${CMAKE_FIND_PACKAGE_NAME}_NOT_FOUND_MESSAGE
                "omega_edit `${type}` libraries were requested but not found.")
        set(${CMAKE_FIND_PACKAGE_NAME}_FOUND FALSE)
        return()
    endif ()
    include("${omega_edit_${type}_targets}")
endmacro()

if (omega_edit_comp_static)
    omega_edit_load_targets(static)
elseif (omega_edit_comp_shared)
    omega_edit_load_targets(shared)
elseif (DEFINED omega_edit_SHARED_LIBS AND omega_edit_SHARED_LIBS)
    omega_edit_load_targets(shared)
elseif (DEFINED omega_edit_SHARED_LIBS AND NOT omega_edit_SHARED_LIBS)
    omega_edit_load_targets(static)
elseif (BUILD_SHARED_LIBS)
    if (EXISTS "${omega_edit_shared_targets}")
        omega_edit_load_targets(shared)
    else ()
        omega_edit_load_targets(static)
    endif ()
else ()
    if (EXISTS "${omega_edit_static_targets}")
        omega_edit_load_targets(static)
    else ()
        omega_edit_load_targets(shared)
    endif ()
endif ()
