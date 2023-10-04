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
#generator="Unix Makefiles"

type=${type:-"Debug"}
generator=${generator:-"Ninja"}
build_docs=${build_docs:-"NO"}
install_dir="${PWD}/_install"

for objtype in shared static; do
  build_shared_libs="NO"
  if [ $objtype == "shared" ]; then
    build_shared_libs="YES"
  fi

  rm -rf "build-$objtype-$type" "$install_dir-$objtype-$type"
  cmake -G "$generator" -S . -B "build-$objtype-$type" -DBUILD_SHARED_LIBS="$build_shared_libs" -DBUILD_DOCS="$build_docs" -DCMAKE_BUILD_TYPE="$type"
  cmake --build "build-$objtype-$type" --config "$type"
  ctest -C "$type" --test-dir "build-$objtype-$type/core" --output-on-failure
  cmake --install "build-$objtype-$type/packages/core" --prefix "$install_dir-$objtype-$type" --config "$type"
  cpack --config "build-$objtype-$type/CPackSourceConfig.cmake"
  cpack --config "build-$objtype-$type/CPackConfig.cmake"
done

# used by scala native code to bundle the proper library file
# shellcheck disable=SC2155
export OE_LIB_DIR="$(readlink -f "$install_dir-shared-$type/lib")"

# Build and test the Scala server
pushd server/scala
sbt test
sbt serv/test
popd

# install common packages and check lint for client and server
yarn install
yarn lint

# Package scala server node module
yarn workspace @omega-edit/server package # this creates the server zip as well

# Build and test the TypeScript client
yarn workspace @omega-edit/client test

echo "✔ Done! ✨"
