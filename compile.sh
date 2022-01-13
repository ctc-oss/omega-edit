#!/bin/bash

# Copyright (c) 2021-2022 Concurrent Technologies Corporation.                                                       
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


    if [[ $os == "linux" || $os == "mac" || $os == "win" ]]; then
        $os
    elif [[ $os == *"macos"* ]]; then
        mac
    elif [[ $os == *"ubuntu"* ]]; then
        linux
    elif [[ $os == *"windows"* ]]; then
        win
    else
        echo "$os is not a valid OS for script"
        exit 1
    fi
}

function gen-swig-java {
    swig -v -c++ -java -outdir src/bindings/java src/bindings/java/omega_edit.i
}

function linux {
    includes="-I${PWD}/src/include -I${PWD}/vendor/cwalk/include -I${JAVA_HOME}/include -I${JAVA_HOME}/include/linux"
    g++ -c -fPIC $includes src/bindings/java/omega_edit_wrap.cxx -o lib/omega_edit_wrap.o
    g++ -shared -fPIC -o lib/libomega_edit.so lib/omega_edit_wrap.o cmake-build-debug/vendor/cwalk/libcwalk.a -lc
}

function mac {
    includes="-I${PWD}/src/include -I${PWD}/vendor/cwalk/include -I${JAVA_HOME}/include -I${JAVA_HOME}/include/darwin "
    g++ -std=c++14 -c -fPIC $includes src/bindings/java/omega_edit_wrap.cxx -o lib/omega_edit_wrap.o
    g++ -std=c++14 -dynamiclib -o lib/libomega_edit.dylib lib/omega_edit_wrap.o cmake-build-debug/libomega_edit.a cmake-build-debug/vendor/cwalk/libcwalk.a -lc
}

function win {
    JAVA_HOME=$(echo $JAVA_HOME | sed -e "s|C:|/c|" | sed -e 's|\\|/|g')
    g++ -std=gnu++14 -c -I"${PWD}/src/include" -I"${PWD}/vendor/cwalk/include" -I"${JAVA_HOME}/include" -I"${JAVA_HOME}/include/win32" src/bindings/java/omega_edit_wrap.cxx -o lib/omega_edit_wrap.o
    g++ -shared -o lib/omega_edit.dll lib/omega_edit_wrap.o cmake-build-debug/libomega_edit.a cmake-build-debug/vendor/cwalk/libcwalk.a -Wl,--add-stdcall-alias
}

function win-ci {
    cmake -S . -B cmake-build-debug -DCMAKE_CXX_COMPILER="g++"
    cmake --build cmake-build-debug
}

function all {
    os=$1
    ci=$2
    gen-swig-java

    if [[ ($os == *"windows"* || $os == "win") && $ci == "ci" ]]; then
        win-ci
    else
        cmake -S . -B cmake-build-debug
        cmake --build cmake-build-debug
    fi


    if [[ ! -z $os ]]; then check_os $os; fi
}

function compile-lib {
    if [[ ! -z $2 ]]; then ci=$2; else ci=""; fi
    all $1 $ci
}

$@
