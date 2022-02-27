#!/bin/bash

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

function win-ci {
    cmake -S . -B cmake-build-debug -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_COMPILER="g++"
    cmake --build cmake-build-debug
}

function compile-lib {
    os=${1:-"not-win"}
    ci=${2:-""}

    if [[ ($os == *"windows"* || $os == "win") && $ci == "ci" ]]; then
        win-ci
    else
        cmake -S . -B cmake-build-debug -DCMAKE_BUILD_TYPE=Debug
        cmake --build cmake-build-debug
    fi
}

$@
