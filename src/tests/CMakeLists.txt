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

get_target_property(OMEGA_EDIT_PUBLIC_HEADER_DIR omega_edit INTERFACE_INCLUDE_DIRECTORIES)
include_directories(${OMEGA_EDIT_PUBLIC_HEADER_DIR})

add_executable(generate_file generate_file.cpp test_util.h)

add_executable(omega_test omega_test.cpp test_util.h)
target_link_libraries(omega_test omega_edit)
target_include_directories(omega_test PRIVATE "${CONAN_INCLUDE_DIRS_CATCH2}")
add_custom_command(TARGET omega_test
        POST_BUILD COMMAND ${CMAKE_COMMAND}
        -E copy_directory ${CMAKE_SOURCE_DIR}/src/tests/data/ $<TARGET_FILE_DIR:omega_test>/data
        WORKING_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

add_executable(play play.cpp)
target_link_libraries(play omega_edit)

add_executable(replay replay.cpp)
target_link_libraries(replay omega_edit)
