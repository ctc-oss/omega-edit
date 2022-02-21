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

add_executable(replace replace.cpp)
target_link_libraries(replace omega_edit)

add_executable(rotate rotate.cpp)
target_link_libraries(rotate omega_edit)

add_executable(slice slice.cpp)
target_link_libraries(slice omega_edit)

add_executable(peek peek.cpp)
target_link_libraries(peek omega_edit)

add_executable(simple simple.cpp)
target_link_libraries(simple omega_edit)

add_executable(simple_c simple_c.c)
target_link_libraries(simple_c omega_edit)
