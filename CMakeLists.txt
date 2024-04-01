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

cmake_minimum_required(VERSION 3.13)

# Project information
project(omega_edit
        VERSION 0.9.80
        DESCRIPTION "Apache open source library for building editors"
        HOMEPAGE_URL "https://github.com/ctc-oss/omega-edit"
        LANGUAGES C CXX)

# Include the core CMakeLists.txt
add_subdirectory(core)

# Packaging rules
add_subdirectory(packages/core)
