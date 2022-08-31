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
        VERSION 0.9.20
        DESCRIPTION "Apache open source library for building editors"
        HOMEPAGE_URL "https://github.com/ctc-oss/omega-edit"
        LANGUAGES C CXX)

option(BUILD_SHARED_LIBS "Build shared libraries instead of static ones" ON)

## Let omega_edit_SHARED_LIBS override BUILD_SHARED_LIBS
if (DEFINED omega_edit_SHARED_LIBS)
    set(BUILD_SHARED_LIBS "${omega_edit_SHARED_LIBS}")
endif ()

message(STATUS "Building ${PROJECT_NAME} ${PROJECT_VERSION} (shared libs: ${BUILD_SHARED_LIBS})")

# Make sure windows shared library is created properly
set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS ON)

# Get verbose output from the makefile (useful for debugging the build)
set(CMAKE_VERBOSE_MAKEFILE ON CACHE BOOL "ON")

# Use C++17
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)
list(APPEND CMAKE_MODULE_PATH "cmake")
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_BINARY_DIR}")

# GCC needs to pass the -lstdc++fs flag to link C++17 filesystem implementation.
if (CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND NOT MINGW)
    set(FILESYSTEM_LIB stdc++fs)
endif ()

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
        REQUIRES "boost/1.79.0" "catch2/2.13.9" "grpc/1.45.2@#4124668439356e3a496b04b0b2595223"
        OPTIONS boost:header_only=True
        GENERATORS cmake cmake_find_package
        IMPORTS "bin, protoc* -> ./build_tools"
        IMPORTS "bin, grpc_*_plugin* -> ./build_tools"
        IMPORTS "., license* -> ./licenses @ folder=True, ignore_case=True")
conan_cmake_autodetect(settings)
conan_cmake_install(PATH_OR_REFERENCE . BUILD missing REMOTE conancenter SETTINGS ${settings})
include("${CMAKE_CURRENT_BINARY_DIR}/conanbuildinfo.cmake")
conan_basic_setup()

set(Boost_INSTALL_DIR ${CONAN_BOOST_ROOT})
find_package(Boost 1.79.0 REQUIRED)
message(STATUS "Boost include dir: ${CONAN_INCLUDE_DIRS_BOOST}")

# Don't add RPATH so we can manipulate the library search path using the environment at runtime
set(CMAKE_MACOSX_RPATH OFF)

#######################################################################################################################
# CORE LIBRARY
#######################################################################################################################
# Define the library source files
set(OMEGA_EDIT_SOURCE_FILES
        "src/include/omega_edit.h"
        "src/include/omega_edit/config.h"
        "src/include/omega_edit/fwd_defs.h"
        "src/include/omega_edit/byte.h"
        "src/include/omega_edit/scoped_ptr.hpp"
        "src/include/omega_edit/stl_string_adaptor.hpp" "src/lib/stl_string_adapter.cpp"
        "src/include/omega_edit/change.h" "src/lib/change.cpp" "src/lib/impl_/change_def.hpp"
        "src/include/omega_edit/check.h" "src/lib/check.cpp"
        "src/include/omega_edit/edit.h" "src/lib/edit.cpp"
        "src/include/omega_edit/search.h" "src/lib/search.cpp" "src/lib/impl_/search_context_def.h"
        "src/include/omega_edit/segment.h" "src/lib/segment.cpp" "src/lib/impl_/segment_def.hpp"
        "src/include/omega_edit/version.h" "src/lib/version.c"
        "src/include/omega_edit/visit.h" "src/lib/visit.cpp"
        "src/include/omega_edit/session.h" "src/lib/session.cpp" "src/lib/impl_/session_def.hpp"
        "src/include/omega_edit/viewport.h" "src/lib/viewport.cpp" "src/lib/impl_/viewport_def.hpp"
        "src/include/omega_edit/license.h" "src/lib/license.c"
        "src/include/omega_edit/utility.h" "src/lib/utility.c"
        "src/include/omega_edit/encode.h" "src/lib/encode.c"
        "src/include/omega_edit/filesystem.h" "src/lib/filesystem.cpp"
        "src/lib/impl_/internal_fun.hpp" "src/lib/impl_/internal_fun.cpp"
        "src/lib/impl_/find.h" "src/lib/impl_/find.cpp"
        "src/lib/impl_/data_def.hpp" "src/lib/impl_/model_def.hpp" "src/lib/impl_/model_segment_def.hpp"
        "src/lib/impl_/macros.h" "src/include/omega_edit/export.h"
        "src/lib/impl_/internal_fwd_defs.hpp")

# Create the library
add_library(omega_edit ${OMEGA_EDIT_SOURCE_FILES})
add_library(omega_edit::omega_edit ALIAS omega_edit)
set_target_properties(omega_edit PROPERTIES VERSION ${omega_edit_VERSION} SOVERSION ${omega_edit_VERSION_MAJOR})
target_include_directories(omega_edit PUBLIC "$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src/include>")
target_compile_definitions(omega_edit PUBLIC "$<$<NOT:$<BOOL:${BUILD_SHARED_LIBS}>>:OMEGA_EDIT_STATIC_DEFINE>")
target_link_libraries(omega_edit PRIVATE ${FILESYSTEM_LIB})

## Include the install rules if the user wanted them (included by default when top-level)
string(COMPARE EQUAL "${CMAKE_SOURCE_DIR}" "${CMAKE_CURRENT_SOURCE_DIR}" is_top_level)
option(omega_edit_INCLUDE_PACKAGING "Include packaging rules for OmegaEdit" "${is_top_level}")
if (omega_edit_INCLUDE_PACKAGING)
    message(STATUS "Including packaging")
    add_subdirectory(packaging)
endif ()

# Parse version information
string(TOUPPER "${PROJECT_NAME}" PREFIX)

# Send version information into libomega_edit through macro definitions
foreach (level MAJOR MINOR PATCH)
    target_compile_definitions(omega_edit PRIVATE "${PREFIX}_VERSION_${level}=${${PROJECT_NAME}_VERSION_${level}}")
endforeach ()

#######################################################################################################################
# RPC
#######################################################################################################################
option(BUILD_RPC "build RPC" ON)
if (BUILD_RPC)
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
    get_filename_component(omega_proto "${CMAKE_CURRENT_SOURCE_DIR}/src/rpc/protos/omega_edit.proto" ABSOLUTE)
    get_filename_component(omega_proto_path "${omega_proto}" PATH)

    # Generated sources
    file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/src/rpc/protos/cpp" "${CMAKE_CURRENT_BINARY_DIR}/src/rpc/client/js")

    set(omega_proto_cpp_srcs "${CMAKE_CURRENT_BINARY_DIR}/src/rpc/protos/cpp/omega_edit.pb.cc")
    set(omega_proto_cpp_hdrs "${CMAKE_CURRENT_BINARY_DIR}/src/rpc/protos/cpp/omega_edit.pb.h")
    set(omega_grpc_cpp_srcs "${CMAKE_CURRENT_BINARY_DIR}/src/rpc/protos/cpp/omega_edit.grpc.pb.cc")
    set(omega_grpc_cpp_hdrs "${CMAKE_CURRENT_BINARY_DIR}/src/rpc/protos/cpp/omega_edit.grpc.pb.h")

    set(omega_grpc_js_pb "${CMAKE_CURRENT_BINARY_DIR}/src/rpc/client/js/omega_edit_grpc_pb.js")
    set(omega_js_pb "${CMAKE_CURRENT_BINARY_DIR}/src/rpc/client/js/omega_edit_pb.js")

    add_custom_command(
            OUTPUT "${omega_proto_cpp_srcs}" "${omega_proto_cpp_hdrs}" "${omega_grpc_cpp_srcs}" "${omega_grpc_cpp_hdrs}"
            COMMAND ${protoc}
            ARGS --cpp_out=${CMAKE_CURRENT_BINARY_DIR}/src/rpc/protos/cpp
            --grpc_out=generate_mock_code=true:${CMAKE_CURRENT_BINARY_DIR}/src/rpc/protos/cpp
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
            ARGS --js_out=${CMAKE_CURRENT_BINARY_DIR}/src/rpc/client/js
            --grpc_out=${CMAKE_CURRENT_BINARY_DIR}/src/rpc/client/js
            --plugin=protoc-gen-grpc=${grpc_node_plugin}
            -I ${omega_proto_path} -I ${CONAN_INCLUDE_DIRS_PROTOBUF}
            ${omega_proto}
            DEPENDS ${omega_proto}
            WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
            COMMENT "Running gRPC JS protocol buffer compiler on ${omega_proto}"
            VERBATIM)

    SET(RPC_SOURCE_FILES "${omega_proto_cpp_srcs}" "${omega_proto_cpp_hdrs}" "${omega_grpc_cpp_srcs}" "${omega_grpc_cpp_hdrs}")
    SET(WORKER_QUEUE_SOURCE_FILES "src/rpc/server/cpp/worker_queue/worker_queue.hpp" "src/rpc/server/cpp/worker_queue/worker_queue.cpp")

    add_executable(server "src/rpc/server/cpp/server.cpp" ${WORKER_QUEUE_SOURCE_FILES} ${RPC_SOURCE_FILES})
    target_include_directories(server PRIVATE "${CONAN_INCLUDE_DIRS_BOOST}" "${CMAKE_CURRENT_BINARY_DIR}/src/rpc/protos/cpp/" "${CONAN_INCLUDE_DIRS_GRPC}" "${CONAN_INCLUDE_DIRS_PROTOBUF}")
    target_link_libraries(server PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB} ${CONAN_LIBS_GRPC} ${CONAN_LIBS_PROTOBUF} ${CONAN_LIBS_C-ARES} ${CONAN_LIBS_ABSEIL} ${CONAN_LIBS_RE2} ${CONAN_LIBS_ZLIB})

    add_custom_target(client SOURCES "${omega_grpc_js_pb}" "${omega_js_pb}")
    add_dependencies(server client)
endif ()

#######################################################################################################################
# EXAMPLES
#######################################################################################################################
option(BUILD_EXAMPLES "build examples" ON)
if (BUILD_EXAMPLES)
    add_executable(replace "src/examples/replace.cpp")
    target_link_libraries(replace PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    add_executable(rotate "src/examples/rotate.cpp")
    target_link_libraries(rotate PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    add_executable(slice "src/examples/slice.cpp")
    target_link_libraries(slice PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    add_executable(peek "src/examples/peek.cpp")
    target_link_libraries(peek PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    add_executable(search "src/examples/search.cpp")
    target_link_libraries(search PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    add_executable(simple "src/examples/simple.cpp")
    target_link_libraries(simple PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    add_executable(simple_c "src/examples/simple_c.c")
    target_link_libraries(simple_c PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    add_executable(replay "src/examples/replay.cpp")
    target_link_libraries(replay PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    add_executable(transform "src/examples/transform.c")
    target_link_libraries(transform PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    add_executable(profile "src/examples/profile.c")
    target_link_libraries(profile PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    add_executable(play "src/examples/play.cpp")
    target_link_libraries(play PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})
    add_custom_command(TARGET play POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/src/examples/data" "$<TARGET_FILE_DIR:play>/data/examples" WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
endif ()

#######################################################################################################################
# TESTING
#######################################################################################################################
option(BUILD_TESTS "build tests" ON)
if (BUILD_TESTS)
    enable_testing()

    if (MSVC)
        set(CTEST_CONFIGURATION_TYPE "${JOB_BUILD_CONFIGURATION}")
    endif ()

    add_executable(omega_test "src/tests/integration/omega_test.cpp" "src/tests/integration/test_util.h")
    target_link_libraries(omega_test PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})
    target_include_directories(omega_test PRIVATE "${CONAN_INCLUDE_DIRS_CATCH2}")
    add_custom_command(TARGET omega_test POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/src/tests/integration/data" "$<TARGET_FILE_DIR:omega_test>/data" WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")

    add_executable(generate_file "src/tests/integration/generate_file.cpp" "src/tests/integration/test_util.h")
    target_link_libraries(generate_file PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})

    if (BUILD_RPC)
        add_executable(server_test "src/rpc/server/cpp/tests/server_test.cpp" ${RPC_SOURCE_FILES})
        target_link_libraries(server_test PRIVATE ${FILESYSTEM_LIB} ${CONAN_LIBS_GRPC} ${CONAN_LIBS_PROTOBUF} ${CONAN_LIBS_C-ARES} ${CONAN_LIBS_ABSEIL} ${CONAN_LIBS_RE2} ${CONAN_LIBS_ZLIB})
        target_include_directories(server_test PRIVATE "${CONAN_INCLUDE_DIRS_BOOST}" "${CMAKE_CURRENT_BINARY_DIR}/src/rpc/protos/cpp/" "${CONAN_INCLUDE_DIRS_GRPC}" "${CONAN_INCLUDE_DIRS_PROTOBUF}")
        add_dependencies(server_test server)
    endif ()

    include(CTest)
    include(Catch)
    catch_discover_tests(omega_test WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")
endif ()

#######################################################################################################################
# DOCUMENTATION
#######################################################################################################################
option(BUILD_DOCS "build documentation" ON)
if (BUILD_DOCS)
    # Generate API documentation using Doxygen
    find_package(Doxygen COMPONENTS dot)
    if (DOXYGEN_FOUND)
        message(STATUS "API documentation generation enabled")
        set(DOXYGEN_GENERATE_HTML YES)
        set(DOXYGEN_GENERATE_MAN YES)
        set(DOXYGEN_GENERATE_XML YES)
        set(DOXYGEN_OPTIMIZE_OUTPUT_FOR_C YES)
        set(DOXYGEN_EXTRACT_ALL YES)
        set(DOXYGEN_INDEX_DIR "${CMAKE_CURRENT_BINARY_DIR}/docs/xml")
        set(DOXYGEN_INDEX_FILE "${DOXYGEN_INDEX_DIR}/index.xml")
        set(DOXYGEN_OUTPUT_DIRECTORY docs)
        doxygen_add_docs(docs "src/include" ALL COMMENT "Generate doxygen docs")
        # Add the cmake folder so the FindSphinx module is found
        set(CMAKE_MODULE_PATH "${PROJECT_SOURCE_DIR}/cmake" "${CMAKE_MODULE_PATH}")
        find_package(Sphinx REQUIRED)
        if (SPHINX_FOUND)
            # Generate user documentation using Sphinx
            message(STATUS "User documentation generation enabled")
            set(SPHINX_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/sphinx")
            set(SPHINX_BUILD "${CMAKE_CURRENT_BINARY_DIR}/docs/sphinx")
            set(SPHINX_INDEX_FILE "${SPHINX_BUILD}/index.html")
            add_custom_command(OUTPUT "${SPHINX_INDEX_FILE}"
                    COMMAND "${SPHINX_EXECUTABLE}"
                    ARGS -b html
                    # Tell Breathe where to find the Doxygen output
                    -Dbreathe_projects.omega_edit="${DOXYGEN_INDEX_DIR}"
                    "${SPHINX_SOURCE}" "${SPHINX_BUILD}"
                    WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
                    DEPENDS
                    # Other docs files you want to track should go here (or in some variable)
                    "${SPHINX_SOURCE}/index.rst"
                    MAIN_DEPENDENCY "${SPHINX_SOURCE}/conf.py"
                    COMMENT "Generating documentation with Sphinx")
            # Nice named target so we can run the job easily
            add_custom_target(sphinx ALL DEPENDS "${SPHINX_INDEX_FILE}")
            add_dependencies(sphinx docs)
            include(GNUInstallDirs)
            install(DIRECTORY "${SPHINX_BUILD}" DESTINATION "${CMAKE_INSTALL_DOCDIR}")
        else (SPHINX_FOUND)
            message(STATUS "Sphinx need to be installed to generate user documentation")
        endif (SPHINX_FOUND)
    else (DOXYGEN_FOUND)
        message(STATUS "Doxygen need to be installed to generate API documentation")
    endif (DOXYGEN_FOUND)
endif (BUILD_DOCS)
