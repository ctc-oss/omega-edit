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

# NOTICE: Expected that the below softwares are installed:
#  - cmake (https://cmake.org/download/)
#    - Downloaded, installed and added to path
#  - Ninja (https://github.com/ninja-build/ninja/releases)
#    - Downloaded to the home directory at $HOME/ninja.exe
#  - mingw64 (https://github.com/brechtsanders/winlibs_mingw/releases/download/15.1.0posix-13.0.0-ucrt-r2/winlibs-i686-posix-dwarf-gcc-15.1.0-mingw-w64ucrt-13.0.0-r2.zip)
#    - Downloaded an extracted to $HOME/mingw64 and binaries are found at $HOME/wingw64/bin

$type = "Debug"
$generator = "Ninja"
$build_docs = "NO"
$install_dir = "${PWD}/_install"
$build_shared_libs = "YES"

# Remove directories if already exists
Remove-Item -Path "_install" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "build-$type" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "${install_dir}-$type" -Recurse -Force -ErrorAction SilentlyContinue

cmake -G "$generator" -D CMAKE_MAKE_PROGRAM="$HOME/ninja.exe" -S . -B "build-$type" $cmake_extra_args -DBUILD_SHARED_LIBS="$build_shared_libs" -DBUILD_DOCS="$build_docs" -DCMAKE_BUILD_TYPE="$type"
cmake --build "build-$type" --config "$type"
ctest -C "$type" --test-dir "build-$type/core" --output-on-failure
cmake --install "build-$type/packages/core" --prefix "${install_dir}-$type" --config "$type"

# Copy installed directory to _install
Copy-Item -Path "${install_dir}-$type" -Destination "_install" -Recurse -Force

# Install common packages and check lint for client and server
yarn install
yarn lint

# Build, test, and package Scala server node module
yarn workspace @omega-edit/server package

# Build, test, and package the TypeScript client node module
yarn workspace @omega-edit/client test

echo "Done!"
