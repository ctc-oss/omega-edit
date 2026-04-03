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

# Read version from VERSION file. CMake project() only accepts numeric
# major.minor.patch values, so we parse prerelease/build metadata separately.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/VERSION" OMEGA_EDIT_VERSION)
string(STRIP "${OMEGA_EDIT_VERSION}" OMEGA_EDIT_VERSION)
set(OMEGA_EDIT_VERSION_FULL "${OMEGA_EDIT_VERSION}")

if (NOT OMEGA_EDIT_VERSION_FULL MATCHES "^([0-9]+)\\.([0-9]+)\\.([0-9]+)(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$")
    message(FATAL_ERROR
            "VERSION must use semantic versioning like 1.2.3 or 1.2.3-rc1. Got: ${OMEGA_EDIT_VERSION_FULL}")
endif()

set(OMEGA_EDIT_VERSION_BASE "${CMAKE_MATCH_1}.${CMAKE_MATCH_2}.${CMAKE_MATCH_3}")

# Project information
project(omega_edit
        VERSION ${OMEGA_EDIT_VERSION_BASE}
        DESCRIPTION "Apache open source library for building editors"
        HOMEPAGE_URL "https://github.com/ctc-oss/omega-edit"
        LANGUAGES C CXX)

set(OMEGA_EDIT_VERSION "${OMEGA_EDIT_VERSION_FULL}")

option(OMEGA_EDIT_EMBED_MODE "Configure a lean embeddable build with tests, docs, examples, and packaging disabled" OFF)

if (OMEGA_EDIT_EMBED_MODE)
    set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(BUILD_DOCS OFF CACHE BOOL "" FORCE)
    set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(BUILD_COVERAGE OFF CACHE BOOL "" FORCE)
endif()

# Include the core CMakeLists.txt
add_subdirectory(core)

# Packaging rules
if (NOT OMEGA_EDIT_EMBED_MODE)
    add_subdirectory(packages/core)
endif()
