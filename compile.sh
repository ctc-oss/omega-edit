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

function check_os {
    os=$1


    if [[ $os == "linux" || $os == "mac" || os == "win" ]]; then
        $os
    elif [[ $os == "macos-11" ]]; then
        mac
    elif [[ $os == "ubuntu-20.04" ]]; then
        linux
    else
        echo "$os is not a valid OS for script"
        exit 1
    fi
}

function gen-swig-java {
    swig -v -c++ -java -outdir src/bindings/java src/bindings/java/omega_edit.i
}

function linux {
    g++ -c -fPIC -I${JAVA_HOME}/include -I${JAVA_HOME}/include/linux src/bindings/java/omega_edit_wrap.cxx -o lib/omega_edit_wrap.o
    g++ -shared -fPIC -o lib/libomega_edit.so lib/omega_edit_wrap.o -lc
}

function mac {
    g++ -std=c++11 -c -fPIC -I${JAVA_HOME}/include -I${JAVA_HOME}/include/darwin src/bindings/java/omega_edit_wrap.cxx -o lib/omega_edit_wrap.o
    g++ -std=c++11 -dynamiclib -o lib/libomega_edit.dylib cmake-build-debug/libomega_edit.a lib/omega_edit_wrap.o -lc
}

function win {
    "g++ -c -I%JAVA_HOME%\include -I%JAVA_HOME%\include\win32 src/bindings/java/omega_edit_wrap.cxx -o lib/omega_edit_wrap.o"
    "g++ -shared -o native.dll lib/omega_edit_wrap.o -Wl,--add-stdcall-alias"
}

function all {
    os=$1
    gen-swig-java
    cmake -S . -B cmake-build-debug
    cmake --build cmake-build-debug

    if [[ ! -z $os ]]; then check_os $os; fi
}

function compile-lib {
    all $1
}

$@
