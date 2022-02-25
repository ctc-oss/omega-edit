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

# Use C++14
set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED True)

# Get verbose output from the makefile (useful for debugging the build)
set(CMAKE_VERBOSE_MAKEFILE ON CACHE BOOL "ON")

include("cmake/conan.cmake")
conan_cmake_autodetect(settings)
conan_cmake_configure(REQUIRES "boost/1.78.0" "catch2/2.13.8" GENERATORS cmake cmake_find_package OPTIONS boost:shared=False)
conan_cmake_install(PATH_OR_REFERENCE . BUILD missing REMOTE conancenter SETTINGS ${settings})
include("${CMAKE_CURRENT_BINARY_DIR}/conanbuildinfo.cmake")
conan_basic_setup()

# Dependencies
Set(Boost_INSTALL_DIR ${CONAN_BOOST_ROOT})
find_package(Boost 1.78.0 COMPONENTS filesystem REQUIRED)
find_package(omega_edit REQUIRED)

enable_testing()

add_executable(omega_test omega_test.cpp test_util.h)
target_link_libraries(omega_test PRIVATE omega_edit::omega_edit Boost::filesystem)
target_include_directories(omega_test PRIVATE "${CONAN_INCLUDE_DIRS_CATCH2}")
add_custom_command(TARGET omega_test POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/data" "$<TARGET_FILE_DIR:omega_test>/data" WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")

add_executable(generate_file generate_file.cpp test_util.h)
target_link_libraries(generate_file PRIVATE omega_edit::omega_edit Boost::filesystem)

include(CTest)
include(Catch)
catch_discover_tests(omega_test WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")
