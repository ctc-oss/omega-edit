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

cmake_minimum_required(VERSION 3.16)

# Read version from VERSION file. CMake project() only accepts numeric
# major.minor.patch values, so we parse prerelease/build metadata separately.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../../VERSION" OMEGA_EDIT_SERVER_VERSION)
string(STRIP "${OMEGA_EDIT_SERVER_VERSION}" OMEGA_EDIT_SERVER_VERSION)
set(OMEGA_EDIT_SERVER_VERSION_FULL "${OMEGA_EDIT_SERVER_VERSION}")

if (NOT OMEGA_EDIT_SERVER_VERSION_FULL MATCHES "^([0-9]+)\\.([0-9]+)\\.([0-9]+)(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$")
    message(FATAL_ERROR
            "VERSION must use semantic versioning like 1.2.3 or 1.2.3-rc1. Got: ${OMEGA_EDIT_SERVER_VERSION_FULL}")
endif()

set(OMEGA_EDIT_SERVER_VERSION_BASE "${CMAKE_MATCH_1}.${CMAKE_MATCH_2}.${CMAKE_MATCH_3}")

project(omega_edit_grpc_server
        VERSION ${OMEGA_EDIT_SERVER_VERSION_BASE}
        DESCRIPTION "Omega Edit gRPC Server (C++ middleware)"
        HOMEPAGE_URL "https://github.com/ctc-oss/omega-edit"
        LANGUAGES C CXX)

include("${CMAKE_CURRENT_SOURCE_DIR}/../../cmake/OmegaEditCcache.cmake" OPTIONAL)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)
set(CMAKE_VERBOSE_MAKEFILE ON)

# ── Find dependencies ─────────────────────────────────────────────────────────
# These find_package calls work with both Conan (CMakeDeps generator) and
# vcpkg (CMAKE_TOOLCHAIN_FILE).  Target names are normalised below.
find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)
find_package(Threads REQUIRED)

# ── Resolve protoc and grpc_cpp_plugin executables ────────────────────────────
# Try target property first, fall back to find_program.
# Must happen before FetchCLD3.cmake which uses _PROTOBUF_PROTOC.
# Prefer package-manager tool paths before PATH so generated protobuf code
# matches the protobuf headers used for compilation.
# Note: With vcpkg static triplets, tools may be in the non-static triplet directory
# (e.g., x64-windows/tools/ instead of x64-windows-static/tools/)
string(REGEX REPLACE "-static$" "" _VCPKG_TOOL_TRIPLET "${VCPKG_TARGET_TRIPLET}")

set(_PROTOBUF_PROTOC_CANDIDATES "")

foreach(_protobuf_config IN ITEMS "${CMAKE_BUILD_TYPE}" Release Debug RelWithDebInfo MinSizeRel)
    if(_protobuf_config)
        string(TOUPPER "${_protobuf_config}" _protobuf_config_upper)
        if(DEFINED protobuf_PACKAGE_FOLDER_${_protobuf_config_upper})
            list(APPEND _PROTOBUF_PROTOC_CANDIDATES
                "${protobuf_PACKAGE_FOLDER_${_protobuf_config_upper}}/bin/protoc${CMAKE_EXECUTABLE_SUFFIX}")
        endif()
    endif()
endforeach()

list(APPEND _PROTOBUF_PROTOC_CANDIDATES
    "${_VCPKG_INSTALLED_DIR}/${_VCPKG_TOOL_TRIPLET}/tools/protobuf/protoc${CMAKE_EXECUTABLE_SUFFIX}"
    "${_VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/tools/protobuf/protoc${CMAKE_EXECUTABLE_SUFFIX}")

if(TARGET protobuf::protoc)
    get_target_property(_PROTOBUF_PROTOC protobuf::protoc IMPORTED_LOCATION)
endif()

foreach(_protoc_candidate ${_PROTOBUF_PROTOC_CANDIDATES})
    if(EXISTS "${_protoc_candidate}")
        set(_PROTOBUF_PROTOC "${_protoc_candidate}")
        break()
    endif()
endforeach()

if(NOT _PROTOBUF_PROTOC OR _PROTOBUF_PROTOC STREQUAL "_PROTOBUF_PROTOC-NOTFOUND")
    if(Protobuf_PROTOC_EXECUTABLE)
        set(_PROTOBUF_PROTOC "${Protobuf_PROTOC_EXECUTABLE}")
    else()
        find_program(_PROTOBUF_PROTOC protoc REQUIRED)
    endif()
endif()

execute_process(
    COMMAND "${_PROTOBUF_PROTOC}" --version
    OUTPUT_VARIABLE _PROTOBUF_PROTOC_VERSION_OUTPUT
    ERROR_VARIABLE _PROTOBUF_PROTOC_VERSION_ERROR
    RESULT_VARIABLE _PROTOBUF_PROTOC_VERSION_RESULT
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_STRIP_TRAILING_WHITESPACE)
if(NOT _PROTOBUF_PROTOC_VERSION_RESULT EQUAL 0)
    message(FATAL_ERROR "Could not run protoc at ${_PROTOBUF_PROTOC}: ${_PROTOBUF_PROTOC_VERSION_ERROR}")
endif()

if(Protobuf_VERSION MATCHES "^([0-9]+)\\.([0-9]+)(\\.([0-9]+))?")
    set(_PROTOBUF_VERSION_MAJOR "${CMAKE_MATCH_1}")
    set(_PROTOBUF_VERSION_MINOR "${CMAKE_MATCH_2}")
    set(_PROTOBUF_VERSION_PATCH "${CMAKE_MATCH_4}")

    set(_PROTOBUF_EXPECTED_PROTOC_VERSION "${_PROTOBUF_VERSION_MAJOR}.${_PROTOBUF_VERSION_MINOR}")
    set(_PROTOBUF_EXPECTED_PROTOC_VERSION_PATTERN "${_PROTOBUF_VERSION_MAJOR}\\.${_PROTOBUF_VERSION_MINOR}")
    if(DEFINED CMAKE_MATCH_4 AND NOT CMAKE_MATCH_4 STREQUAL "")
        string(APPEND _PROTOBUF_EXPECTED_PROTOC_VERSION ".${_PROTOBUF_VERSION_PATCH}")
        string(APPEND _PROTOBUF_EXPECTED_PROTOC_VERSION_PATTERN "\\.${_PROTOBUF_VERSION_PATCH}")
    else()
        string(APPEND _PROTOBUF_EXPECTED_PROTOC_VERSION_PATTERN "(\\.[0-9]+)?")
    endif()

    set(_PROTOBUF_ACCEPTED_PROTOC_VERSION_PATTERNS "${_PROTOBUF_EXPECTED_PROTOC_VERSION_PATTERN}")
    set(_PROTOBUF_ACCEPTED_PROTOC_VERSIONS "${_PROTOBUF_EXPECTED_PROTOC_VERSION}")
    if(_PROTOBUF_VERSION_MAJOR GREATER_EQUAL 4)
        set(_PROTOBUF_COMPILER_VERSION_PATTERN "${_PROTOBUF_VERSION_MINOR}")
        set(_PROTOBUF_COMPILER_VERSION "${_PROTOBUF_VERSION_MINOR}")
        if(DEFINED CMAKE_MATCH_4 AND NOT CMAKE_MATCH_4 STREQUAL "")
            string(APPEND _PROTOBUF_COMPILER_VERSION_PATTERN "\\.${_PROTOBUF_VERSION_PATCH}")
            string(APPEND _PROTOBUF_COMPILER_VERSION ".${_PROTOBUF_VERSION_PATCH}")
        else()
            string(APPEND _PROTOBUF_COMPILER_VERSION_PATTERN "(\\.[0-9]+)?")
        endif()
        list(APPEND _PROTOBUF_ACCEPTED_PROTOC_VERSION_PATTERNS "${_PROTOBUF_COMPILER_VERSION_PATTERN}")
        list(APPEND _PROTOBUF_ACCEPTED_PROTOC_VERSIONS "${_PROTOBUF_COMPILER_VERSION}")
    endif()

    set(_PROTOBUF_PROTOC_VERSION_MATCHED FALSE)
    foreach(_PROTOBUF_ACCEPTED_PROTOC_VERSION_PATTERN IN LISTS _PROTOBUF_ACCEPTED_PROTOC_VERSION_PATTERNS)
        if(_PROTOBUF_PROTOC_VERSION_OUTPUT MATCHES "libprotoc ${_PROTOBUF_ACCEPTED_PROTOC_VERSION_PATTERN}([^0-9.]|$)")
            set(_PROTOBUF_PROTOC_VERSION_MATCHED TRUE)
        endif()
    endforeach()

    if(NOT _PROTOBUF_PROTOC_VERSION_MATCHED)
        string(JOIN " or " _PROTOBUF_ACCEPTED_PROTOC_VERSION_MESSAGE ${_PROTOBUF_ACCEPTED_PROTOC_VERSIONS})
        message(FATAL_ERROR
            "protoc version mismatch: ${_PROTOBUF_PROTOC} reports '${_PROTOBUF_PROTOC_VERSION_OUTPUT}', "
            "but protobuf headers are ${Protobuf_VERSION}; expected libprotoc ${_PROTOBUF_ACCEPTED_PROTOC_VERSION_MESSAGE}. "
            "Use the protoc from the same package manager as protobuf.")
    endif()
endif()

if(TARGET gRPC::grpc_cpp_plugin)
    get_target_property(_GRPC_CPP_PLUGIN gRPC::grpc_cpp_plugin IMPORTED_LOCATION)
endif()
if(NOT _GRPC_CPP_PLUGIN OR _GRPC_CPP_PLUGIN STREQUAL "_GRPC_CPP_PLUGIN-NOTFOUND")
    find_program(_GRPC_CPP_PLUGIN grpc_cpp_plugin
        HINTS "${_VCPKG_INSTALLED_DIR}/${_VCPKG_TOOL_TRIPLET}/tools/grpc"
              "${_VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/tools/grpc"
        REQUIRED)
endif()

message(STATUS "Using protoc: ${_PROTOBUF_PROTOC}")
message(STATUS "Using grpc_cpp_plugin: ${_GRPC_CPP_PLUGIN}")

# On Windows with static CRT (vcpkg x64-windows-static), ensure we use /MT
if(VCPKG_TARGET_TRIPLET MATCHES "static$" AND MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

# ── Generated proto sources ───────────────────────────────────────────────────

# Updated for v1 proto path and generated files
set(PROTO_FILE "${CMAKE_CURRENT_SOURCE_DIR}/../../proto/omega_edit/v1/omega_edit.proto")
set(PROTO_GEN_DIR "${CMAKE_CURRENT_BINARY_DIR}/proto_gen")
file(MAKE_DIRECTORY ${PROTO_GEN_DIR})

# Generate protobuf and gRPC sources for v1
set(PROTO_SRCS "${PROTO_GEN_DIR}/omega_edit/v1/omega_edit.pb.cc")
set(PROTO_HDRS "${PROTO_GEN_DIR}/omega_edit/v1/omega_edit.pb.h")
set(GRPC_SRCS "${PROTO_GEN_DIR}/omega_edit/v1/omega_edit.grpc.pb.cc")
set(GRPC_HDRS "${PROTO_GEN_DIR}/omega_edit/v1/omega_edit.grpc.pb.h")

add_custom_command(
    OUTPUT ${PROTO_SRCS} ${PROTO_HDRS} ${GRPC_SRCS} ${GRPC_HDRS}
    COMMAND ${_PROTOBUF_PROTOC}
    ARGS --grpc_out=${PROTO_GEN_DIR}
         --cpp_out=${PROTO_GEN_DIR}
         -I "${CMAKE_CURRENT_SOURCE_DIR}/../../proto"
         --plugin=protoc-gen-grpc=${_GRPC_CPP_PLUGIN}
         "${PROTO_FILE}"
    DEPENDS "${PROTO_FILE}"
    COMMENT "Generating gRPC/Protobuf sources from omega_edit/v1/omega_edit.proto"
)

# ── omega_edit core library ───────────────────────────────────────────────────
# Look for the omega_edit library. Allow the user to specify the path via OE_LIB_DIR
# or via standard CMake prefix paths / find_package config.
if(DEFINED ENV{OE_LIB_DIR})
    set(OE_LIB_DIR "$ENV{OE_LIB_DIR}")
endif()

# Try CMake config first for installed omega_edit
find_package(omega_edit CONFIG QUIET)
if(NOT omega_edit_FOUND)
    # Fallback: find library and headers manually
    find_library(OMEGA_EDIT_LIB
        NAMES omega_edit
        HINTS ${OE_LIB_DIR}
              "${CMAKE_CURRENT_SOURCE_DIR}/../../_install/lib"
              "${CMAKE_CURRENT_SOURCE_DIR}/../../_install/bin"
              "${CMAKE_CURRENT_SOURCE_DIR}/../../_install"
              "${CMAKE_CURRENT_SOURCE_DIR}/../../_install-win-static/lib"
              "${CMAKE_CURRENT_SOURCE_DIR}/../../_install-win-static-mt/lib"
              "${CMAKE_CURRENT_SOURCE_DIR}/../../_install_core/lib"
    )
    find_path(OMEGA_EDIT_INCLUDE
        NAMES omega_edit.h
        HINTS "${CMAKE_CURRENT_SOURCE_DIR}/../../_install-static-Debug/include"
              "${CMAKE_CURRENT_SOURCE_DIR}/../../_install-win-static/include"
              "${CMAKE_CURRENT_SOURCE_DIR}/../../_install-win-static-mt/include"
              "${CMAKE_CURRENT_SOURCE_DIR}/../../_install_core/include"
              "${CMAKE_CURRENT_SOURCE_DIR}/../../core/src/include"
    )
    if(NOT OMEGA_EDIT_LIB)
        message(FATAL_ERROR "Could not find omega_edit library. Set OE_LIB_DIR or install the library.")
    endif()
    message(STATUS "Found omega_edit library: ${OMEGA_EDIT_LIB}")
    message(STATUS "Found omega_edit headers: ${OMEGA_EDIT_INCLUDE}")
endif()

# ── Server executable ─────────────────────────────────────────────────────────
set(SERVER_SOURCES
    src/main.cpp
    src/editor_service.cpp
    src/editor_service.h
    src/session_manager.cpp
    src/session_manager.h
    ${PROTO_SRCS}
    ${GRPC_SRCS}
)

add_executable(omega-edit-grpc-server ${SERVER_SOURCES})

target_include_directories(omega-edit-grpc-server PRIVATE
    ${PROTO_GEN_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

if(NOT TARGET gRPC::grpc++_unsecure)
    message(FATAL_ERROR "gRPC::grpc++_unsecure is required because the native server exposes only insecure endpoints")
endif()

if(omega_edit_FOUND)
    target_link_libraries(omega-edit-grpc-server PRIVATE
        omega_edit::omega_edit
        gRPC::grpc++_unsecure
        protobuf::libprotobuf
        Threads::Threads
    )
else()
    target_include_directories(omega-edit-grpc-server PRIVATE ${OMEGA_EDIT_INCLUDE})
    target_link_libraries(omega-edit-grpc-server PRIVATE
        ${OMEGA_EDIT_LIB}
        gRPC::grpc++_unsecure
        protobuf::libprotobuf
        Threads::Threads
    )
endif()

# Version definitions
target_compile_definitions(omega-edit-grpc-server PRIVATE
    "SERVER_VERSION=\"${OMEGA_EDIT_SERVER_VERSION_FULL}\""
)

# Platform-specific link libraries
if(WIN32)
    target_link_libraries(omega-edit-grpc-server PRIVATE rpcrt4 psapi)
elseif(NOT APPLE)
    # libuuid on Linux
    find_library(UUID_LIB uuid)
    if(UUID_LIB)
        target_link_libraries(omega-edit-grpc-server PRIVATE ${UUID_LIB})
    endif()
endif()

# ── Install rules ─────────────────────────────────────────────────────────────
install(TARGETS omega-edit-grpc-server
    RUNTIME DESTINATION bin
)
