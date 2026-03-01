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

# FetchCLD3.cmake - Downloads and builds CLD3 (Compact Language Detector v3)
# from source as a static library.  CLD3 is not available on Conan Center, so
# this module provides an alternative to the vcpkg port.
#
# Requires: protobuf (must already be found via find_package)
#
# Provides target: cld3::cld3

include(FetchContent)

FetchContent_Declare(
    cld3
    GIT_REPOSITORY https://github.com/google/cld3.git
    GIT_TAG        b48dc46512566f5a2d41118c8c1116c4f96dc661
    GIT_SHALLOW    TRUE
)

FetchContent_GetProperties(cld3)
if(NOT cld3_POPULATED)
    FetchContent_Populate(cld3)
endif()

# ── Apply patches that the vcpkg port uses ────────────────────────────────────
# Patch base.h and utf8statetable.cc: COMPILER_MSVC → _MSC_VER
file(READ "${cld3_SOURCE_DIR}/src/base.h" _base_h)
string(REPLACE "COMPILER_MSVC" "_MSC_VER" _base_h "${_base_h}")
file(WRITE "${cld3_SOURCE_DIR}/src/base.h" "${_base_h}")

file(READ "${cld3_SOURCE_DIR}/src/script_span/utf8statetable.cc" _utf8_cc)
string(REPLACE "COMPILER_MSVC" "_MSC_VER" _utf8_cc "${_utf8_cc}")
file(WRITE "${cld3_SOURCE_DIR}/src/script_span/utf8statetable.cc" "${_utf8_cc}")

file(READ "${cld3_SOURCE_DIR}/src/sentence_features.h" _sentfeat_h)
string(REPLACE "COMPILER_MSVC" "_MSC_VER" _sentfeat_h "${_sentfeat_h}")
file(WRITE "${cld3_SOURCE_DIR}/src/sentence_features.h" "${_sentfeat_h}")

# ── Generate protobuf sources for CLD3 ───────────────────────────────────────
set(_CLD3_PROTO_DIR "${cld3_SOURCE_DIR}/src")
set(_CLD3_PROTO_GEN "${CMAKE_CURRENT_BINARY_DIR}/cld3_proto_gen")
file(MAKE_DIRECTORY "${_CLD3_PROTO_GEN}/cld_3/protos")

set(_CLD3_PROTO_FILES
    "${_CLD3_PROTO_DIR}/feature_extractor.proto"
    "${_CLD3_PROTO_DIR}/sentence.proto"
    "${_CLD3_PROTO_DIR}/task_spec.proto"
)

set(_CLD3_PROTO_SRCS "")
set(_CLD3_PROTO_HDRS "")
foreach(_proto ${_CLD3_PROTO_FILES})
    get_filename_component(_proto_name ${_proto} NAME_WE)
    list(APPEND _CLD3_PROTO_SRCS "${_CLD3_PROTO_GEN}/cld_3/protos/${_proto_name}.pb.cc")
    list(APPEND _CLD3_PROTO_HDRS "${_CLD3_PROTO_GEN}/cld_3/protos/${_proto_name}.pb.h")
endforeach()

add_custom_command(
    OUTPUT ${_CLD3_PROTO_SRCS} ${_CLD3_PROTO_HDRS}
    COMMAND ${_PROTOBUF_PROTOC}
    ARGS --cpp_out=${_CLD3_PROTO_GEN}/cld_3/protos
         -I "${_CLD3_PROTO_DIR}"
         ${_CLD3_PROTO_FILES}
    DEPENDS ${_CLD3_PROTO_FILES}
    COMMENT "Generating CLD3 protobuf sources"
)

# ── Build CLD3 as a static library ───────────────────────────────────────────
set(_CLD3_SOURCES
    "${cld3_SOURCE_DIR}/src/base.cc"
    "${cld3_SOURCE_DIR}/src/embedding_feature_extractor.cc"
    "${cld3_SOURCE_DIR}/src/embedding_network.cc"
    "${cld3_SOURCE_DIR}/src/feature_extractor.cc"
    "${cld3_SOURCE_DIR}/src/feature_types.cc"
    "${cld3_SOURCE_DIR}/src/fml_parser.cc"
    "${cld3_SOURCE_DIR}/src/lang_id_nn_params.cc"
    "${cld3_SOURCE_DIR}/src/language_identifier_features.cc"
    "${cld3_SOURCE_DIR}/src/nnet_language_identifier.cc"
    "${cld3_SOURCE_DIR}/src/registry.cc"
    "${cld3_SOURCE_DIR}/src/relevant_script_feature.cc"
    "${cld3_SOURCE_DIR}/src/sentence_features.cc"
    "${cld3_SOURCE_DIR}/src/task_context.cc"
    "${cld3_SOURCE_DIR}/src/task_context_params.cc"
    "${cld3_SOURCE_DIR}/src/unicodetext.cc"
    "${cld3_SOURCE_DIR}/src/utils.cc"
    "${cld3_SOURCE_DIR}/src/workspace.cc"
    "${cld3_SOURCE_DIR}/src/script_span/fixunicodevalue.cc"
    "${cld3_SOURCE_DIR}/src/script_span/generated_entities.cc"
    "${cld3_SOURCE_DIR}/src/script_span/generated_ulscript.cc"
    "${cld3_SOURCE_DIR}/src/script_span/getonescriptspan.cc"
    "${cld3_SOURCE_DIR}/src/script_span/offsetmap.cc"
    "${cld3_SOURCE_DIR}/src/script_span/text_processing.cc"
    "${cld3_SOURCE_DIR}/src/script_span/utf8statetable.cc"
    ${_CLD3_PROTO_SRCS}
)

add_library(cld3_lib STATIC ${_CLD3_SOURCES})
set_target_properties(cld3_lib PROPERTIES OUTPUT_NAME cld3)
target_compile_features(cld3_lib PUBLIC cxx_std_11)

# Create a wrapper include directory so consumers can use #include <cld3/xxx.h>
# (mirrors the layout installed by vcpkg's unofficial-cld3 port).
set(_CLD3_INCLUDE_WRAPPER "${CMAKE_CURRENT_BINARY_DIR}/_cld3_include")
file(MAKE_DIRECTORY "${_CLD3_INCLUDE_WRAPPER}")
file(COPY "${cld3_SOURCE_DIR}/src/" DESTINATION "${_CLD3_INCLUDE_WRAPPER}/cld3"
     FILES_MATCHING PATTERN "*.h")

target_include_directories(cld3_lib
    PUBLIC
        "${cld3_SOURCE_DIR}/src"            # bare includes used inside CLD3 itself
        "${_CLD3_INCLUDE_WRAPPER}"          # allows #include <cld3/xxx.h>
        "${_CLD3_PROTO_GEN}"               # CLD3 public headers transitively include generated protos
)

# Link against protobuf-lite (prefer lite variant for smaller binary)
if(TARGET protobuf::libprotobuf-lite)
    target_link_libraries(cld3_lib PUBLIC protobuf::libprotobuf-lite)
else()
    target_link_libraries(cld3_lib PUBLIC protobuf::libprotobuf)
endif()

# Suppress warnings in third-party code
if(MSVC)
    target_compile_options(cld3_lib PRIVATE /W0)
else()
    target_compile_options(cld3_lib PRIVATE -w)
endif()

# Create a namespaced alias for uniform usage
add_library(cld3::cld3 ALIAS cld3_lib)

message(STATUS "CLD3 built from source via FetchContent")
