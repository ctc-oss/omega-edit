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
project(omega_edit-tests LANGUAGES C CXX)

enable_testing()

if (MSVC)
    set(CTEST_CONFIGURATION_TYPE "${JOB_BUILD_CONFIGURATION}")
endif ()

if (CMAKE_HOST_WIN32)
    string(TOUPPER "${CMAKE_BUILD_TYPE}" BT)
    set(static_opts "-DCMAKE_${BT}_POSTFIX=_static")
    set(LDD dumpbin /dependents)
    set(EXT .exe)
elseif (CMAKE_HOST_APPLE)
    set(LDD otool -L)
else ()
    set(LDD ldd)
endif ()

# Set up install trees for subsequent tests
add_test(NAME build_shared COMMAND ${CMAKE_CTEST_COMMAND} --build-and-test "${CMAKE_CURRENT_LIST_DIR}/../.." "${CMAKE_CURRENT_BINARY_DIR}/build-shared" --build-generator ${CMAKE_GENERATOR} --build-options -DBUILD_SHARED_LIBS=YES -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE} -DBUILD_DOCS=NO)
add_test(NAME build_static COMMAND ${CMAKE_CTEST_COMMAND} --build-and-test "${CMAKE_CURRENT_LIST_DIR}/../.." "${CMAKE_CURRENT_BINARY_DIR}/build-static" --build-generator ${CMAKE_GENERATOR} --build-options -DBUILD_SHARED_LIBS=NO ${static_opts} -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE} -DBUILD_DOCS=NO)
add_test(NAME install_shared COMMAND ${CMAKE_COMMAND} --install "${CMAKE_CURRENT_BINARY_DIR}/build-shared" --prefix "${CMAKE_CURRENT_BINARY_DIR}/install-shared")
add_test(NAME install_static COMMAND ${CMAKE_COMMAND} --install "${CMAKE_CURRENT_BINARY_DIR}/build-static" --prefix "${CMAKE_CURRENT_BINARY_DIR}/install-static")
add_test(NAME install_shared_both COMMAND ${CMAKE_COMMAND} --install "${CMAKE_CURRENT_BINARY_DIR}/build-shared" --prefix "${CMAKE_CURRENT_BINARY_DIR}/install-both")
add_test(NAME install_static_both COMMAND ${CMAKE_COMMAND} --install "${CMAKE_CURRENT_BINARY_DIR}/build-static" --prefix "${CMAKE_CURRENT_BINARY_DIR}/install-both")
set_tests_properties(build_shared build_static PROPERTIES FIXTURES_SETUP "builds")
set_tests_properties(install_shared install_static install_shared_both install_static_both PROPERTIES FIXTURES_SETUP "installs" FIXTURES_REQUIRED "builds")

# Function to encapsulate test creation
function(add_integration_test)
    cmake_parse_arguments(arg "" "NAME;ROOT;EXPECTED" OPTIONS ${ARGN})
    add_test(NAME ${arg_NAME} COMMAND ${CMAKE_CTEST_COMMAND} --build-and-test "${CMAKE_CURRENT_LIST_DIR}/integration" "${CMAKE_CURRENT_BINARY_DIR}/${arg_NAME}" --build-generator ${CMAKE_GENERATOR} --build-options ${arg_OPTIONS} "-Domega_edit_ROOT=${CMAKE_CURRENT_BINARY_DIR}/${arg_ROOT}" -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE} --test-command ${CMAKE_CTEST_COMMAND})
    add_test(NAME ${arg_NAME}_linkage_check COMMAND ${LDD} "${CMAKE_CURRENT_BINARY_DIR}/${arg_NAME}/bin/omega_test${EXT}")
    set_tests_properties(${arg_NAME} PROPERTIES FIXTURES_SETUP "${arg_NAME}" FIXTURES_REQUIRED "installs")
    set_tests_properties(${arg_NAME}_linkage_check PROPERTIES FIXTURES_REQUIRED "${arg_NAME};installs")
    if (arg_EXPECTED STREQUAL "shared")
        set_tests_properties(${arg_NAME}_linkage_check PROPERTIES PASS_REGULAR_EXPRESSION "omega_edit")
    elseif (arg_EXPECTED STREQUAL "static")
        set_tests_properties(${arg_NAME}_linkage_check PROPERTIES FAIL_REGULAR_EXPRESSION "omega_edit")
    else ()
        set_tests_properties(${arg_NAME} PROPERTIES WILL_FAIL TRUE FAIL_REGULAR_EXPRESSION "${arg_EXPECTED}")
        set_tests_properties(${arg_NAME}_linkage_check PROPERTIES WILL_FAIL TRUE)
    endif ()
endfunction()

## Joint install directory tests
add_integration_test(NAME default ROOT install-both EXPECTED static)
add_integration_test(NAME default-static ROOT install-both OPTIONS -DBUILD_SHARED_LIBS=NO EXPECTED static)
add_integration_test(NAME default-shared ROOT install-both OPTIONS -DBUILD_SHARED_LIBS=YES EXPECTED shared)
add_integration_test(NAME cache-shared ROOT install-both OPTIONS -Domega_edit_SHARED_LIBS=YES EXPECTED shared)
add_integration_test(NAME cache-static-override ROOT install-both OPTIONS -Domega_edit_SHARED_LIBS=NO -DBUILD_SHARED_LIBS=YES EXPECTED static)
add_integration_test(NAME cache-shared-override ROOT install-both OPTIONS -Domega_edit_SHARED_LIBS=YES -DBUILD_SHARED_LIBS=NO EXPECTED shared)

## Shared only
add_integration_test(NAME default-shared-only ROOT install-shared EXPECTED shared)
add_integration_test(NAME cache-shared-only ROOT install-shared OPTIONS -Domega_edit_SHARED_LIBS=YES -DBUILD_SHARED_LIBS=NO EXPECTED shared)
add_integration_test(NAME fail-cache-static-shared-only ROOT install-shared OPTIONS -Domega_edit_SHARED_LIBS=NO EXPECTED "omega_edit `static` libraries were requested but not found")

## Static only
add_integration_test(NAME default-static-only ROOT install-static EXPECTED static)
add_integration_test(NAME cache-static-only ROOT install-static OPTIONS -Domega_edit_SHARED_LIBS=NO -DBUILD_SHARED_LIBS=YES EXPECTED static)
add_integration_test(NAME fail-cache-shared-static-only ROOT install-static OPTIONS -Domega_edit_SHARED_LIBS=YES EXPECTED "omega_edit `shared` libraries were requested but not found")
