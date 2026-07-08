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

# FetchProtobuf.cmake - Builds a compact static Protobuf tool/runtime for the
# CLD3 fallback path when the host system or package manager did not provide one.

include(FetchContent)

set(_OMEGA_EDIT_PROTOBUF_ORIGINAL_BUILD_SHARED_LIBS ${BUILD_SHARED_LIBS})
set(_OMEGA_EDIT_PROTOBUF_ORIGINAL_POSITION_INDEPENDENT_CODE ${CMAKE_POSITION_INDEPENDENT_CODE})
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(protobuf_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(protobuf_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(protobuf_BUILD_PROTOC_BINARIES ON CACHE BOOL "" FORCE)
set(protobuf_BUILD_LIBPROTOC ON CACHE BOOL "" FORCE)
set(protobuf_BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
    protobuf
    GIT_REPOSITORY https://github.com/protocolbuffers/protobuf.git
    GIT_TAG        v3.21.12
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(protobuf)

set(BUILD_SHARED_LIBS ${_OMEGA_EDIT_PROTOBUF_ORIGINAL_BUILD_SHARED_LIBS} CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ${_OMEGA_EDIT_PROTOBUF_ORIGINAL_POSITION_INDEPENDENT_CODE})

if(TARGET libprotobuf-lite AND NOT TARGET protobuf::libprotobuf-lite)
    add_library(protobuf::libprotobuf-lite ALIAS libprotobuf-lite)
endif()
if(TARGET libprotobuf AND NOT TARGET protobuf::libprotobuf)
    add_library(protobuf::libprotobuf ALIAS libprotobuf)
endif()
if(TARGET protoc AND NOT TARGET protobuf::protoc)
    add_executable(protobuf::protoc ALIAS protoc)
endif()

message(STATUS "Protobuf built from source via FetchContent")
