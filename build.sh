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
#toolchain_file=mingw64-toolchain.cmake

type=${type:-"Debug"}
generator=${generator:-"Ninja"}
build_docs=${build_docs:-"NO"}
install_dir="${PWD}/_install"
cmake_extra_args=""

if [[ -n "$toolchain" && -z "$toolchain_file" ]]; then
  toolchain_file="${PWD}/toolchains/${toolchain}.cmake"
fi

if [[ -n "$toolchain_file" ]]; then
  if [[ ! -f "$toolchain_file" ]]; then
    echo "Toolchain file not found: $toolchain_file"
    exit 1
  fi
  cmake_extra_args=-DCMAKE_TOOLCHAIN_FILE=${toolchain_file}
fi

for objtype in shared static; do
  build_shared_libs="NO"
  if [[ $objtype == "shared" ]]; then
    build_shared_libs="YES"
  fi

  rm -rf "build-${objtype}-$type" "${install_dir}-${objtype}-$type"
  # shellcheck disable=SC2090
  cmake -G "$generator" -S . -B "build-${objtype}-$type" $cmake_extra_args -DBUILD_SHARED_LIBS="$build_shared_libs" -DBUILD_DOCS="$build_docs" -DCMAKE_BUILD_TYPE="$type"
  cmake --build "build-${objtype}-$type" --config "$type"
  ctest -C "$type" --test-dir "build-${objtype}-${type}/core" --output-on-failure
  cmake --install "build-${objtype}-${type}/packages/core" --prefix "${install_dir}-${objtype}-$type" --config "$type"
  cpack --config "build-${objtype}-${type}/CPackSourceConfig.cmake"
  cpack --config "build-${objtype}-${type}/CPackConfig.cmake" -C "$type"
done

# OE_LIB_DIR is used by scala native code to bundle the proper library file
# NOTE: Windows uses bin for shared libraries, and non-Windows uses lib
if [[ -d "${install_dir}-shared-${type}/bin" ]]; then
  export OE_LIB_DIR="$(readlink -f "${install_dir}-shared-${type}/bin")"
else
  export OE_LIB_DIR="$(readlink -f "${install_dir}-shared-${type}/lib")"
fi

# Copy the shared library to the _install directory
if [[ -d "$OE_LIB_DIR" ]]; then
  rm -rf _install
  # Use cp instead of a symlink so it works on Windows
  cp -a "$OE_LIB_DIR" _install
fi

# Install common packages and check lint for client and server
yarn install
yarn lint

# Build, test, and package Scala server node module
yarn workspace @omega-edit/server package

# Build, test, and package the TypeScript client node module
yarn workspace @omega-edit/client test

echo "✔ Done! ✨"
