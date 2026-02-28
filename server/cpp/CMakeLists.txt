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

# Read version from VERSION file
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../../VERSION" OMEGA_EDIT_SERVER_VERSION)
string(STRIP "${OMEGA_EDIT_SERVER_VERSION}" OMEGA_EDIT_SERVER_VERSION)

project(omega_edit_grpc_server
        VERSION ${OMEGA_EDIT_SERVER_VERSION}
        DESCRIPTION "Omega Edit gRPC Server (C++ middleware)"
        HOMEPAGE_URL "https://github.com/ctc-oss/omega-edit"
        LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)
set(CMAKE_VERBOSE_MAKEFILE ON)

# ── Find dependencies ─────────────────────────────────────────────────────────
find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)
find_package(Threads REQUIRED)
find_package(unofficial-cld3 CONFIG REQUIRED)
find_package(unofficial-libmagic CONFIG REQUIRED)

# On Windows with static CRT (vcpkg x64-windows-static), ensure we use /MT
if(VCPKG_TARGET_TRIPLET MATCHES "static$" AND MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

# ── Generated proto sources ───────────────────────────────────────────────────
set(PROTO_FILE "${CMAKE_CURRENT_SOURCE_DIR}/../../proto/omega_edit.proto")
set(PROTO_GEN_DIR "${CMAKE_CURRENT_BINARY_DIR}/proto_gen")
file(MAKE_DIRECTORY ${PROTO_GEN_DIR})

# Get the protoc and grpc_cpp_plugin executables
# Try target property first, fall back to find_program
# Note: With vcpkg static triplets, tools may be in the non-static triplet directory
# (e.g., x64-windows/tools/ instead of x64-windows-static/tools/)
string(REGEX REPLACE "-static$" "" _VCPKG_TOOL_TRIPLET "${VCPKG_TARGET_TRIPLET}")

get_target_property(_PROTOBUF_PROTOC protobuf::protoc IMPORTED_LOCATION)
if(NOT _PROTOBUF_PROTOC OR _PROTOBUF_PROTOC STREQUAL "_PROTOBUF_PROTOC-NOTFOUND")
    find_program(_PROTOBUF_PROTOC protoc
        HINTS "${_VCPKG_INSTALLED_DIR}/${_VCPKG_TOOL_TRIPLET}/tools/protobuf"
              "${_VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/tools/protobuf"
        REQUIRED)
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

# Generate protobuf and gRPC sources
set(PROTO_SRCS "${PROTO_GEN_DIR}/omega_edit.pb.cc")
set(PROTO_HDRS "${PROTO_GEN_DIR}/omega_edit.pb.h")
set(GRPC_SRCS "${PROTO_GEN_DIR}/omega_edit.grpc.pb.cc")
set(GRPC_HDRS "${PROTO_GEN_DIR}/omega_edit.grpc.pb.h")

add_custom_command(
    OUTPUT ${PROTO_SRCS} ${PROTO_HDRS} ${GRPC_SRCS} ${GRPC_HDRS}
    COMMAND ${_PROTOBUF_PROTOC}
    ARGS --grpc_out=${PROTO_GEN_DIR}
         --cpp_out=${PROTO_GEN_DIR}
         -I "${CMAKE_CURRENT_SOURCE_DIR}/../../proto"
         --plugin=protoc-gen-grpc=${_GRPC_CPP_PLUGIN}
         "${PROTO_FILE}"
    DEPENDS "${PROTO_FILE}"
    COMMENT "Generating gRPC/Protobuf sources from omega_edit.proto"
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
    src/content_detection.h
    src/cld3_language_detector.cpp
    src/libmagic_content_detector.cpp
    ${PROTO_SRCS}
    ${GRPC_SRCS}
)

add_executable(omega-edit-grpc-server ${SERVER_SOURCES})

target_include_directories(omega-edit-grpc-server PRIVATE
    ${PROTO_GEN_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# Check if gRPC reflection is available (not always present in vcpkg builds)
if(TARGET gRPC::grpc++_reflection)
    target_compile_definitions(omega-edit-grpc-server PRIVATE HAS_GRPC_REFLECTION)
    set(_GRPC_REFLECTION_LIB gRPC::grpc++_reflection)
else()
    set(_GRPC_REFLECTION_LIB "")
endif()

if(omega_edit_FOUND)
    target_link_libraries(omega-edit-grpc-server PRIVATE
        omega_edit::omega_edit
        gRPC::grpc++
        ${_GRPC_REFLECTION_LIB}
        protobuf::libprotobuf
        Threads::Threads
        unofficial::cld3::cld3
        unofficial::libmagic::libmagic
    )
else()
    target_include_directories(omega-edit-grpc-server PRIVATE ${OMEGA_EDIT_INCLUDE})
    target_link_libraries(omega-edit-grpc-server PRIVATE
        ${OMEGA_EDIT_LIB}
        gRPC::grpc++
        ${_GRPC_REFLECTION_LIB}
        protobuf::libprotobuf
        Threads::Threads
        unofficial::cld3::cld3
        unofficial::libmagic::libmagic
    )
endif()

# Version definitions
target_compile_definitions(omega-edit-grpc-server PRIVATE
    "SERVER_VERSION=\"${PROJECT_VERSION}\""
)

# Provide the path to the magic database file for content type detection
if(DEFINED unofficial-libmagic_DICTIONARY)
    target_compile_definitions(omega-edit-grpc-server PRIVATE
        "MAGIC_MGC_PATH=\"${unofficial-libmagic_DICTIONARY}\""
    )
endif()

# Platform-specific link libraries
if(WIN32)
    target_link_libraries(omega-edit-grpc-server PRIVATE rpcrt4)
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
