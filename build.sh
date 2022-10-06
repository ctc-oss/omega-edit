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

set +e
checker=""
which valgrind >/dev/null; [[ $? -eq 0 ]] && checker="valgrind --leak-check=full --show-leak-kinds=all -s"
set -e

rm -rf ./lib/*
for objtype in shared static; do
  build_shared_libs="NO"
  if [ $objtype == "shared" ]; then
    build_shared_libs="YES"
  fi

  rm -rf "build-$objtype-$type" "$install_dir-$objtype"
  cmake -G "$generator" -S . -B "build-$objtype-$type" -DBUILD_SHARED_LIBS="$build_shared_libs" -DBUILD_DOCS="$build_docs" -DCMAKE_BUILD_TYPE="$type" --install-prefix "$install_dir-$objtype"
  cmake --build "build-$objtype-$type"
  cmake --install "build-$objtype-$type/packaging" --prefix "$install_dir-$objtype"  --config "$type"
  cpack --config "build-$objtype-$type/CPackSourceConfig.cmake"
  cpack --config "build-$objtype-$type/CPackConfig.cmake"

  rm -rf "build-tests-integration-$objtype-$type"
  cmake -G "$generator" -S src/tests/integration -B "build-tests-integration-$objtype-$type" -DCMAKE_BUILD_TYPE="$type" -DCMAKE_PREFIX_PATH="$install_dir-$objtype"
  cmake --build "build-tests-integration-$objtype-$type"
  pushd "build-tests-integration-$objtype-$type" && ctest -C "$type" --output-on-failure && popd

  cmake -G "$generator" -S src/tests -B "build-tests-$objtype-$type" -DCMAKE_BUILD_TYPE="$type"
  pushd "build-tests-$objtype-$type" && ctest -C "$type" --output-on-failure && popd

  if [ -d "$install_dir-$objtype/lib64/" ]; then
    cp -av "$install_dir-$objtype/lib64/"* ./lib
  else
    cp -av "$install_dir-$objtype/lib/"* ./lib
  fi
done

# Build and test the Scala server
pushd src/rpc/server/scala
sbt installM2
sbt test
sbt pkgServer
sbt serv/test
pushd serv/target/universal/
unzip -o "*.zip"
kill "$( lsof -i:9000 | sed -n '2p' | awk '{print $2}' )" >/dev/null 2>&1 || true
./omega-edit-grpc-server*/bin/omega-edit-grpc-server --port=9000&
server_pid=$!
popd
popd
pushd src/rpc/client/ts/
npm install
npm run compile-src
npm run lint
npm test
popd
kill $server_pid

kill -9 "$( lsof -i:9000 | sed -n '2p' | awk '{print $2}' )" >/dev/null 2>&1 || true
echo "✔ Done! ✨"
