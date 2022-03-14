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
project(omega_edit-examples LANGUAGES C CXX)

# Use C++17
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)

# Dependencies
find_package(omega_edit REQUIRED)

add_executable(replace replace.cpp)
target_link_libraries(replace PRIVATE omega_edit::omega_edit)

add_executable(rotate rotate.cpp)
target_link_libraries(rotate PRIVATE omega_edit::omega_edit)

add_executable(slice slice.cpp)
target_link_libraries(slice PRIVATE omega_edit::omega_edit)

add_executable(peek peek.cpp)
target_link_libraries(peek PRIVATE omega_edit::omega_edit)

add_executable(simple simple.cpp)
target_link_libraries(simple PRIVATE omega_edit::omega_edit)

add_executable(simple_c simple_c.c)
target_link_libraries(simple_c PRIVATE omega_edit::omega_edit)

add_executable(replay replay.cpp)
target_link_libraries(replay PRIVATE omega_edit::omega_edit)

add_executable(play play.cpp)
target_link_libraries(play PRIVATE omega_edit::omega_edit)
add_custom_command(TARGET play POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/data" "$<TARGET_FILE_DIR:play>/data/examples" WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
