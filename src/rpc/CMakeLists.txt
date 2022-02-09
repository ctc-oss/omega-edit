# Copyright (c) 2021-2022 Concurrent Technologies Corporation.
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software is distributed under the License is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
# implied.  See the License for the specific language governing permissions and limitations under the License.
project(omega_edit-rpc)

# Get verbose output from the makefile (useful for debugging the build)
set(CMAKE_VERBOSE_MAKEFILE ON CACHE BOOL "ON")

# Let Conan do it's magic.
if (NOT EXISTS "${CMAKE_CURRENT_BINARY_DIR}/conan.cmake")
    message(STATUS "Downloading conan.cmake from https://github.com/conan-io/cmake-conan")
    file(DOWNLOAD "https://raw.githubusercontent.com/conan-io/cmake-conan/v0.16.1/conan.cmake"
            "${CMAKE_CURRENT_BINARY_DIR}/conan.cmake"
            EXPECTED_HASH SHA256=396e16d0f5eabdc6a14afddbcfff62a54a7ee75c6da23f32f7a31bc85db23484
            TLS_VERIFY ON)
else ()
    message(STATUS "${CMAKE_CURRENT_BINARY_DIR}/conan.cmake exists")
endif ()
include(${CMAKE_CURRENT_BINARY_DIR}/conan.cmake)
conan_cmake_autodetect(settings)
conan_cmake_configure(
        REQUIRES boost/1.78.0 grpc/1.43.0
        OPTIONS boost:header_only=True
        GENERATORS cmake cmake_find_package
        IMPORTS "bin, protoc* -> ./build_tools"
        IMPORTS "bin, grpc_*_plugin* -> ./build_tools"
        IMPORTS "., license* -> ./licenses @ folder=True, ignore_case=True")
conan_cmake_install(PATH_OR_REFERENCE .
        BUILD missing
        REMOTE conancenter
        SETTINGS ${settings})
include(${CMAKE_CURRENT_BINARY_DIR}/conanbuildinfo.cmake)
conan_basic_setup()

if (MSVC)
    set(protoc build_tools/protoc.exe)
    set(grpc_cpp_plugin build_tools/grpc_cpp_plugin.exe)
    set(grpc_node_plugin build_tools/grpc_node_plugin.exe)
else ()
    set(protoc build_tools/protoc)
    set(grpc_cpp_plugin build_tools/grpc_cpp_plugin)
    set(grpc_node_plugin build_tools/grpc_node_plugin)
endif ()

# Proto file
get_filename_component(omega_proto "${CMAKE_CURRENT_SOURCE_DIR}/protos/omega_edit.proto" ABSOLUTE)
get_filename_component(omega_proto_path "${omega_proto}" PATH)

# Generated sources
make_directory("${CMAKE_CURRENT_BINARY_DIR}/protos_cpp")
make_directory("${CMAKE_CURRENT_BINARY_DIR}/protos_js")

set(omega_proto_cpp_srcs "${CMAKE_CURRENT_BINARY_DIR}/protos_cpp/omega_edit.pb.cc")
set(omega_proto_cpp_hdrs "${CMAKE_CURRENT_BINARY_DIR}/protos_cpp/omega_edit.pb.h")
set(omega_grpc_cpp_srcs "${CMAKE_CURRENT_BINARY_DIR}/protos_cpp/omega_edit.grpc.pb.cc")
set(omega_grpc_cpp_hdrs "${CMAKE_CURRENT_BINARY_DIR}/protos_cpp/omega_edit.grpc.pb.h")

set(omega_grpc_js_pb "${CMAKE_CURRENT_BINARY_DIR}/protos_js/omega_edit_grpc_pb.js")
set(omega_js_pb "${CMAKE_CURRENT_BINARY_DIR}/protos_js/omega_edit_pb.js")

add_custom_command(
        OUTPUT "${omega_proto_cpp_srcs}" "${omega_proto_cpp_hdrs}" "${omega_grpc_cpp_srcs}" "${omega_grpc_cpp_hdrs}"
        COMMAND ${protoc}
        ARGS --cpp_out=${CMAKE_CURRENT_BINARY_DIR}/protos_cpp
        --grpc_out=generate_mock_code=true:${CMAKE_CURRENT_BINARY_DIR}/protos_cpp
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
        ARGS --js_out=${CMAKE_CURRENT_BINARY_DIR}/protos_js
        --grpc_out=${CMAKE_CURRENT_BINARY_DIR}/protos_js
        --plugin=protoc-gen-grpc=${grpc_node_plugin}
        -I ${omega_proto_path} -I ${CONAN_INCLUDE_DIRS_PROTOBUF}
        ${omega_proto}
        DEPENDS ${omega_proto}
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
        COMMENT "Running gRPC JS protocol buffer compiler on ${omega_proto}"
        VERBATIM)

message(STATUS "Boost include dir: ${CONAN_INCLUDE_DIRS_BOOST}")
include_directories("${CONAN_INCLUDE_DIRS_BOOST}" "${CMAKE_CURRENT_BINARY_DIR}/protos_cpp/" "${CONAN_INCLUDE_DIRS_GRPC}" "${CONAN_INCLUDE_DIRS_PROTOBUF}")

SET(RPC_SOURCE_FILES "${omega_proto_cpp_srcs}" "${omega_proto_cpp_hdrs}" "${omega_grpc_cpp_srcs}" "${omega_grpc_cpp_hdrs}")
SET(WORKER_QUEUE_SOURCE_FILES "worker_queue/worker_queue.hpp" "worker_queue/worker_queue.cpp")

add_executable(server server.cpp ${WORKER_QUEUE_SOURCE_FILES} ${RPC_SOURCE_FILES})
target_link_libraries(server PRIVATE omega_edit ${CONAN_LIBS_GRPC} ${CONAN_LIBS_PROTOBUF} ${CONAN_LIBS_C-ARES} ${CONAN_LIBS_ABSEIL} ${CONAN_LIBS_RE2} ${CONAN_LIBS_ZLIB})

add_custom_target(client SOURCES "${omega_grpc_js_pb}" "${omega_js_pb}")
add_dependencies(server client)

add_executable(server_cbk server_cbk.cpp ${WORKER_QUEUE_SOURCE_FILES} ${RPC_SOURCE_FILES})
target_link_libraries(server_cbk PRIVATE omega_edit ${CONAN_LIBS_GRPC} ${CONAN_LIBS_PROTOBUF} ${CONAN_LIBS_C-ARES} ${CONAN_LIBS_ABSEIL} ${CONAN_LIBS_RE2} ${CONAN_LIBS_ZLIB})

add_executable(server_test server_test.cpp ${WORKER_QUEUE_SOURCE_FILES} ${RPC_SOURCE_FILES})
target_link_libraries(server_test PRIVATE omega_edit ${CONAN_LIBS_GRPC} ${CONAN_LIBS_PROTOBUF} ${CONAN_LIBS_C-ARES} ${CONAN_LIBS_ABSEIL} ${CONAN_LIBS_RE2} ${CONAN_LIBS_ZLIB})

