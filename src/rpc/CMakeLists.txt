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
project(omega_edit-rpc LANGUAGES C CXX)

# Use C++17
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)

# GCC needs to pass the -lstdc++fs flag to link C++17 filesystem implementation.
if (CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND NOT MINGW)
    set(FILESYSTEM_LIB stdc++fs)
endif ()

# Get verbose output from the makefile (useful for debugging the build)
set(CMAKE_VERBOSE_MAKEFILE ON CACHE BOOL "ON")

#######################################################################################################################
# DEPENDENCIES
#######################################################################################################################
if (NOT EXISTS "cmake/conan.cmake")
    message(STATUS "Downloading conan.cmake from https://github.com/conan-io/cmake-conan")
    file(DOWNLOAD "https://raw.githubusercontent.com/conan-io/cmake-conan/0.18.1/conan.cmake"
            "cmake/conan.cmake"
            TLS_VERIFY ON)
endif ()

include("cmake/conan.cmake")

function(conan_config_set)
    # Set a config value.
    # Arguments NAME and VALUE are required
    # Example usage:
    #    conan_config_set(NAME general.revision_enabled
    #                     VALUE 1)
    #
    # See: https://docs.conan.io/en/latest/reference/commands/consumer/config.html
    set(oneValueArgs NAME VALUE)
    cmake_parse_arguments(CONAN "" "${oneValueArgs}" "" ${ARGN})
    if(DEFINED CONAN_COMMAND)
        set(CONAN_CMD ${CONAN_COMMAND})
    else()
        conan_check(REQUIRED)
    endif()
    message(STATUS "Conan: Setting ${CONAN_NAME} to ${CONAN_VALUE}")
    execute_process(COMMAND ${CONAN_CMD} config set ${CONAN_NAME}=${CONAN_VALUE} RESULT_VARIABLE return_code)
    if(NOT "${return_code}" STREQUAL "0")
        message(FATAL_ERROR "Conan config set failed='${return_code}'")
    endif()
endfunction()

conan_config_set(NAME general.revisions_enabled VALUE 1)
conan_cmake_configure(
        REQUIRES "boost/1.79.0" "grpc/1.45.2@#4124668439356e3a496b04b0b2595223"
        GENERATORS cmake cmake_find_package
        IMPORTS "bin, protoc* -> ./build_tools"
        IMPORTS "bin, grpc_*_plugin* -> ./build_tools"
        IMPORTS "., license* -> ./licenses @ folder=True, ignore_case=True")
conan_cmake_autodetect(settings)
conan_cmake_install(PATH_OR_REFERENCE . BUILD missing REMOTE conancenter SETTINGS ${settings})
include("${CMAKE_CURRENT_BINARY_DIR}/conanbuildinfo.cmake")
conan_basic_setup()

# Dependencies
set(Boost_INSTALL_DIR ${CONAN_BOOST_ROOT})
find_package(Boost 1.79.0 COMPONENTS program_options REQUIRED)
message(STATUS "Boost include dir: ${CONAN_INCLUDE_DIRS_BOOST}")

find_package(omega_edit REQUIRED)

if (MSVC)
    set(protoc "build_tools/protoc.exe")
    set(grpc_cpp_plugin "build_tools/grpc_cpp_plugin.exe")
    set(grpc_node_plugin "build_tools/grpc_node_plugin.exe")
else ()
    set(protoc "build_tools/protoc")
    set(grpc_cpp_plugin "build_tools/grpc_cpp_plugin")
    set(grpc_node_plugin "build_tools/grpc_node_plugin")
endif ()

# Proto file
get_filename_component(omega_proto "${CMAKE_CURRENT_SOURCE_DIR}/protos/omega_edit.proto" ABSOLUTE)
get_filename_component(omega_proto_path "${omega_proto}" PATH)

# Generated sources
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/protos/cpp" "${CMAKE_CURRENT_BINARY_DIR}/client/js")

set(omega_proto_cpp_srcs "${CMAKE_CURRENT_BINARY_DIR}/protos/cpp/omega_edit.pb.cc")
set(omega_proto_cpp_hdrs "${CMAKE_CURRENT_BINARY_DIR}/protos/cpp/omega_edit.pb.h")
set(omega_grpc_cpp_srcs "${CMAKE_CURRENT_BINARY_DIR}/protos/cpp/omega_edit.grpc.pb.cc")
set(omega_grpc_cpp_hdrs "${CMAKE_CURRENT_BINARY_DIR}/protos/cpp/omega_edit.grpc.pb.h")

set(omega_grpc_js_pb "${CMAKE_CURRENT_BINARY_DIR}/client/js/omega_edit_grpc_pb.js")
set(omega_js_pb "${CMAKE_CURRENT_BINARY_DIR}/client/js/omega_edit_pb.js")

add_custom_command(
        OUTPUT "${omega_proto_cpp_srcs}" "${omega_proto_cpp_hdrs}" "${omega_grpc_cpp_srcs}" "${omega_grpc_cpp_hdrs}"
        COMMAND ${protoc}
        ARGS --cpp_out=${CMAKE_CURRENT_BINARY_DIR}/protos/cpp
        --grpc_out=generate_mock_code=true:${CMAKE_CURRENT_BINARY_DIR}/protos/cpp
        --plugin=protoc-gen-grpc=${grpc_cpp_plugin}
        -I ${omega_proto_path} -I ${CONAN_INCLUDE_DIRS_PROTOBUF}
        ${omega_proto}
        DEPENDS ${omega_proto}
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
        COMMENT "Running gRPC C++ protocol buffer compiler on ${omega_proto}"
        VERBATIM)

add_custom_command(
        OUTPUT "${omega_grpc_js_pb}" "${omega_js_pb}"
        COMMAND ${protoc}
        ARGS --js_out=${CMAKE_CURRENT_BINARY_DIR}/client/js
        --grpc_out=${CMAKE_CURRENT_BINARY_DIR}/client/js
        --plugin=protoc-gen-grpc=${grpc_node_plugin}
        -I ${omega_proto_path} -I ${CONAN_INCLUDE_DIRS_PROTOBUF}
        ${omega_proto}
        DEPENDS ${omega_proto}
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
        COMMENT "Running gRPC JS protocol buffer compiler on ${omega_proto}"
        VERBATIM)

message(STATUS "Boost include dir: ${CONAN_INCLUDE_DIRS_BOOST}")
include_directories("${CONAN_INCLUDE_DIRS_BOOST}" "${CMAKE_CURRENT_BINARY_DIR}/protos/cpp/" "${CONAN_INCLUDE_DIRS_GRPC}" "${CONAN_INCLUDE_DIRS_PROTOBUF}")

SET(RPC_SOURCE_FILES "${omega_proto_cpp_srcs}" "${omega_proto_cpp_hdrs}" "${omega_grpc_cpp_srcs}" "${omega_grpc_cpp_hdrs}")
SET(WORKER_QUEUE_SOURCE_FILES "server/cpp/worker_queue/worker_queue.hpp" "server/cpp/worker_queue/worker_queue.cpp")

add_executable(server "server/cpp/server.cpp" ${WORKER_QUEUE_SOURCE_FILES} ${RPC_SOURCE_FILES})
target_link_libraries(server PRIVATE omega_edit::omega_edit Boost::program_options ${FILESYSTEM_LIB} ${CONAN_LIBS_GRPC} ${CONAN_LIBS_PROTOBUF} ${CONAN_LIBS_C-ARES} ${CONAN_LIBS_ABSEIL} ${CONAN_LIBS_RE2} ${CONAN_LIBS_ZLIB})

add_custom_target(client SOURCES "${omega_grpc_js_pb}" "${omega_js_pb}")
add_dependencies(server client)

add_executable(server_test "tests/server_test.cpp" ${RPC_SOURCE_FILES})
target_link_libraries(server_test PRIVATE Boost::program_options ${FILESYSTEM_LIB} ${CONAN_LIBS_GRPC} ${CONAN_LIBS_PROTOBUF} ${CONAN_LIBS_C-ARES} ${CONAN_LIBS_ABSEIL} ${CONAN_LIBS_RE2} ${CONAN_LIBS_ZLIB})
add_dependencies(server_test server)
