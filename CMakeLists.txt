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

if (POLICY CMP0091)
    cmake_policy(SET CMP0091 NEW)
endif()

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

include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/OmegaEditCcache.cmake")

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

if (NOT DEFINED BUILD_TRANSFORM_PLUGINS)
    if (BUILD_TESTS OR BUILD_EXAMPLES)
        set(BUILD_TRANSFORM_PLUGINS ON CACHE BOOL "build packaged transform plugins")
    else()
        set(BUILD_TRANSFORM_PLUGINS OFF CACHE BOOL "build packaged transform plugins")
    endif()
endif()

if (NOT OMEGA_EDIT_EMBED_MODE AND BUILD_TRANSFORM_PLUGINS)
    if (BUILD_TESTS AND NOT DEFINED OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR)
        set(OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR "${CMAKE_BINARY_DIR}/core/src/tests/plugins" CACHE PATH
                "Output directory for transform plugin modules")
    endif()
    add_subdirectory(plugins)
endif()

# Packaging rules
if (NOT OMEGA_EDIT_EMBED_MODE)
    add_subdirectory(packages/core)
endif()

# Source package configuration
if (CMAKE_SOURCE_DIR STREQUAL CMAKE_BINARY_DIR)
    message(WARNING "In-source builds not supported for source packages")
else()
    # Use the .cpack_ignore file for source package exclusions
    if (EXISTS "${CMAKE_SOURCE_DIR}/.cpack_ignore")
        file(READ "${CMAKE_SOURCE_DIR}/.cpack_ignore" _cpack_ignore)
        string(REGEX REPLACE "\n" ";" _cpack_ignore "${_cpack_ignore}")
        set(CPACK_SOURCE_IGNORE_FILES "${_cpack_ignore}")
    endif()
    set(CPACK_SOURCE_GENERATOR "TGZ")
    if (WIN32)
        set(CPACK_SOURCE_GENERATOR "ZIP")
    endif()
    set(CPACK_SOURCE_PACKAGE_FILE_NAME "${PROJECT_NAME}-${OMEGA_EDIT_VERSION_FULL}")
    set(CPACK_SOURCE_OUTPUT_FILE_PREFIX "${CMAKE_BINARY_DIR}/package")
    include(CPack)
endif()
