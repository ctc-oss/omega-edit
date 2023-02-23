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

rm -rf ./lib/*
for objtype in shared static; do
  build_shared_libs="NO"
  if [ $objtype == "shared" ]; then
    build_shared_libs="YES"
  fi

  rm -rf "build-$objtype-$type" "$install_dir-$objtype"
  cmake -G "$generator" -S . -B "build-$objtype-$type" -DBUILD_SHARED_LIBS="$build_shared_libs" -DBUILD_DOCS="$build_docs" -DCMAKE_BUILD_TYPE="$type"
  cmake --build "build-$objtype-$type"
  ctest -C "$type" --test-dir "build-$objtype-$type" --output-on-failure
  cmake --install "build-$objtype-$type/packaging" --prefix "$install_dir-$objtype" --config "$type"
  cpack --config "build-$objtype-$type/CPackSourceConfig.cmake"
  cpack --config "build-$objtype-$type/CPackConfig.cmake"

  if [ -d "$install_dir-$objtype/lib64/" ]; then
    cp -av "$install_dir-$objtype/lib64/"* ./lib
  else
    cp -av "$install_dir-$objtype/lib/"* ./lib
  fi
done

# Kill the RPC server if it's up and running for some reason
kill -9 "$( lsof -i:9000 | sed -n '2p' | awk '{print $2}' )" >/dev/null 2>&1 || true

# Build and test the Scala server
pushd src/rpc/server/scala
sbt test
sbt pkgServer
sbt serv/test
popd

# Build and test the TypeScript client
pushd src/rpc/client/ts/
unzip -o ../../server/scala/serv/target/universal/*.zip
chmod +x omega-edit-grpc-server-*/bin/*
yarn install
yarn compile-src
yarn lint
yarn test
popd

# Kill the RPC server if it hasn't been shutdown already
kill -9 "$( lsof -i:9000 | sed -n '2p' | awk '{print $2}' )" >/dev/null 2>&1 || true

echo "✔ Done! ✨"
