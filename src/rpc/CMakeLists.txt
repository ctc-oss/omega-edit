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
if(NOT EXISTS "${CMAKE_CURRENT_BINARY_DIR}/conan.cmake")
    message(STATUS "Downloading conan.cmake from https://github.com/conan-io/cmake-conan")
    file(DOWNLOAD "https://raw.githubusercontent.com/conan-io/cmake-conan/v0.16.1/conan.cmake"
            "${CMAKE_CURRENT_BINARY_DIR}/conan.cmake"
            EXPECTED_HASH SHA256=396e16d0f5eabdc6a14afddbcfff62a54a7ee75c6da23f32f7a31bc85db23484
            TLS_VERIFY ON)
else()
    message(STATUS "${CMAKE_CURRENT_BINARY_DIR}/conan.cmake exists")
endif()
include(${CMAKE_CURRENT_BINARY_DIR}/conan.cmake)
conan_cmake_autodetect(settings)
conan_cmake_configure(
        REQUIRES boost/1.77.0 grpc/1.43.0
        OPTIONS boost:header_only=True
        GENERATORS cmake cmake_find_package
        IMPORTS "bin, protoc* -> ./build_tools"
        IMPORTS "bin, grpc_cpp_plugin* -> ./build_tools"
        IMPORTS "bin, grpc_node_plugin* -> ./build_tools")
conan_cmake_install(PATH_OR_REFERENCE .
        BUILD missing
        REMOTE conancenter
        SETTINGS ${settings})
include(${CMAKE_CURRENT_BINARY_DIR}/conanbuildinfo.cmake)
conan_basic_setup()

if(MSVC)
    set(protoc build_tools/protoc.exe)
    set(grpc_plugin build_tools/grpc_cpp_plugin.exe)
else()
    set(protoc build_tools/protoc)
    set(grpc_plugin build_tools/grpc_cpp_plugin)
endif()

# Proto file
get_filename_component(omega_proto "${CMAKE_CURRENT_SOURCE_DIR}/protos/omega_edit.proto" ABSOLUTE)
get_filename_component(omega_proto_path "${omega_proto}" PATH)

# Generated sources
set(omega_proto_srcs "${CMAKE_CURRENT_BINARY_DIR}/protos/omega_edit.pb.cc")
set(omega_proto_hdrs "${CMAKE_CURRENT_BINARY_DIR}/protos/omega_edit.pb.h")
set(omega_grpc_srcs "${CMAKE_CURRENT_BINARY_DIR}/protos/omega_edit.grpc.pb.cc")
set(omega_grpc_hdrs "${CMAKE_CURRENT_BINARY_DIR}/protos/omega_edit.grpc.pb.h")
make_directory("${CMAKE_CURRENT_BINARY_DIR}/protos")

add_custom_command(
        OUTPUT "${omega_proto_srcs}" "${omega_proto_hdrs}" "${omega_grpc_srcs}" "${omega_grpc_hdrs}"
        COMMAND ${protoc}
        ARGS --cpp_out=${CMAKE_CURRENT_BINARY_DIR}/protos
        --grpc_out=generate_mock_code=true:${CMAKE_CURRENT_BINARY_DIR}/protos
        --plugin=protoc-gen-grpc=${grpc_plugin}
        -I ${omega_proto_path}
        ${omega_proto}
        DEPENDS ${omega_proto}
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
        COMMENT "Running gRPC C++ protocol buffer compiler on ${omega_proto}"
        VERBATIM)

add_executable(server server.cpp "${omega_proto_srcs}" "${omega_proto_hdrs}" "${omega_grpc_srcs}" "${omega_grpc_hdrs}")
target_link_libraries(server PRIVATE omega_edit)
target_link_libraries(server PRIVATE ${CONAN_LIBS_GRPC})

target_include_directories(server PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/protos/")
target_include_directories(server PRIVATE "${CONAN_INCLUDE_DIRS_BOOST}")
target_include_directories(server PRIVATE "${CONAN_INCLUDE_DIRS_GRPC}")
target_include_directories(server PRIVATE "${CONAN_INCLUDE_DIRS_PROTOBUF}")

include_directories("${CONAN_INCLUDE_DIRS_BOOST}")