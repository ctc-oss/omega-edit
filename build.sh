#!/usr/bin/env bash
########################################################################################################################
# Copyright (c) 2021 Concurrent Technologies Corporation.                                                              #
#                                                                                                                      #
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance       #
# with the License.  You may obtain a copy of the License at                                                           #
#                                                                                                                      #
#     http://www.apache.org/licenses/LICENSE-2.0                                                                       #
#                                                                                                                      #
# Unless required by applicable law or agreed to in writing, software is distributed under the License is              #
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                     #
# implied.  See the License for the specific language governing permissions and limitations under the License.         #
#                                                                                                                      #
########################################################################################################################

set -ex
cd "$(dirname "${BASH_SOURCE[0]}")"

#type="Release"
type="Debug"
#generator="Unix Makefiles"
generator="Ninja"
rm -rf "${PWD}/_install"

rm -rf build-static-$type
cmake -G "$generator" -S . -B build-static-$type -DBUILD_SHARED_LIBS=NO -DCMAKE_BUILD_TYPE=$type
cmake --build build-static-$type
cmake --install build-static-$type/packaging --prefix "${PWD}/_install"  --config $type
cpack --config build-static-$type/CPackSourceConfig.cmake
cpack --config build-static-$type/CPackConfig.cmake

rm -rf build-shared-$type
cmake -G "$generator" -S . -B build-shared-$type -DBUILD_SHARED_LIBS=YES -DCMAKE_BUILD_TYPE=$type
cmake --build build-shared-$type
cmake --install build-shared-$type/packaging --prefix "${PWD}/_install"  --config $type
cpack --config build-shared-$type/CPackSourceConfig.cmake
cpack --config build-shared-$type/CPackConfig.cmake

rm -rf build-examples-$type
cmake -G "$generator" -S src/examples -B build-examples-$type -DCMAKE_BUILD_TYPE=$type -DCMAKE_PREFIX_PATH="${PWD}/_install"
cmake --build build-examples-$type

rm -rf build-rpc-$type
cmake -G "$generator" -S src/rpc -B build-rpc-$type -DCMAKE_BUILD_TYPE=$type -DCMAKE_PREFIX_PATH="${PWD}/_install"
cmake --build build-rpc-$type
build-rpc-$type/bin/server_test

rm -rf build-tests-integration-$type
cmake -G "$generator" -S src/tests/integration -B build-tests-integration-$type -DCMAKE_BUILD_TYPE=$type -DCMAKE_PREFIX_PATH="${PWD}/_install"
cmake --build build-tests-integration-$type
pushd build-tests-integration-$type && ctest -C $type --output-on-failure && popd

cmake -G "$generator" -S src/tests -B build-tests-$type -DCMAKE_BUILD_TYPE=$type
pushd build-tests-$type && ctest -C $type --output-on-failure && popd

