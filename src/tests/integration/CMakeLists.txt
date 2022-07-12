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
project(omega_edit-integration_tests LANGUAGES C CXX)

# Use C++17
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)

# Get verbose output from the makefile (useful for debugging the build)
set(CMAKE_VERBOSE_MAKEFILE ON CACHE BOOL "ON")

include("cmake/conan.cmake")
conan_cmake_autodetect(settings)
conan_cmake_configure(REQUIRES "catch2/2.13.9" GENERATORS cmake cmake_find_package)
conan_cmake_install(PATH_OR_REFERENCE . BUILD missing REMOTE conancenter SETTINGS ${settings})
include("${CMAKE_CURRENT_BINARY_DIR}/conanbuildinfo.cmake")
conan_basic_setup()

# Dependencies
find_package(omega_edit REQUIRED)

enable_testing()

if (MSVC)
    set(CTEST_CONFIGURATION_TYPE "${JOB_BUILD_CONFIGURATION}")
endif ()

add_executable(omega_test omega_test.cpp test_util.h)
target_link_libraries(omega_test PRIVATE omega_edit::omega_edit)
target_include_directories(omega_test PRIVATE "${CONAN_INCLUDE_DIRS_CATCH2}")
add_custom_command(TARGET omega_test POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/data" "$<TARGET_FILE_DIR:omega_test>/data" WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")

add_executable(generate_file generate_file.cpp test_util.h)
target_link_libraries(generate_file PRIVATE omega_edit::omega_edit)

include(CTest)
include(Catch)
catch_discover_tests(omega_test WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")
