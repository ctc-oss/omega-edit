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

from conan import ConanFile


class OmegaEditGrpcServerConan(ConanFile):
    """Conan recipe for the Omega Edit C++ gRPC middleware server.

    Provides gRPC and protobuf from Conan Center with pre-built binaries where
    available (dramatically faster CI builds compared to building from source
    via vcpkg).
    """

    settings = "os", "compiler", "build_type", "arch"
    generators = "CMakeDeps", "CMakeToolchain"

    def requirements(self):
        self.requires("grpc/1.72.0")
        self.requires("openssl/3.3.2")
        # protobuf is a transitive dependency of grpc and will be pulled in
        # automatically.

    def layout(self):
        # Use a flat layout so that --output-folder=build places all
        # generated files (CMakePresets.json, conan_toolchain.cmake, etc.)
        # directly in the output folder without extra nesting.
        self.folders.source = "."
        self.folders.build = "."
        self.folders.generators = "."
