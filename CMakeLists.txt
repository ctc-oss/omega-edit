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

cmake_minimum_required(VERSION 3.13)

# Project information
project(omega_edit
        VERSION 0.6.2
        DESCRIPTION "Apache open source library for building editors"
        HOMEPAGE_URL "https://github.com/ctc-oss/omega-edit"
        LANGUAGES C CXX)

# Get verbose output from the makefile (useful for debugging the build)
set(CMAKE_VERBOSE_MAKEFILE ON CACHE BOOL "ON")

# Use C++14
set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED True)
list(APPEND CMAKE_MODULE_PATH "cmake")

# Let Conan do it's magic.
if(NOT EXISTS "${CMAKE_BINARY_DIR}/conan.cmake")
    message(STATUS "Downloading conan.cmake from https://github.com/conan-io/cmake-conan")
    file(DOWNLOAD "https://raw.githubusercontent.com/conan-io/cmake-conan/v0.16.1/conan.cmake"
            "${CMAKE_BINARY_DIR}/conan.cmake"
            EXPECTED_HASH SHA256=396e16d0f5eabdc6a14afddbcfff62a54a7ee75c6da23f32f7a31bc85db23484
            TLS_VERIFY ON)
else()
    message(STATUS "${CMAKE_BINARY_DIR}/conan.cmake exists")
endif()
include(${CMAKE_BINARY_DIR}/conan.cmake)
conan_cmake_autodetect(settings)
conan_cmake_configure(
        REQUIRES boost/1.77.0 catch2/2.13.8 cwalk/1.2.5 grpc/1.43.0
        OPTIONS boost:header_only=True
        GENERATORS cmake cmake_find_package
        IMPORTS "., license* -> ./licenses @ folder=True, ignore_case=True"
        IMPORTS "bin, protoc* -> ./build_tools"
        IMPORTS "bin, grpc_cpp_plugin* -> ./build_tools"
        IMPORTS "bin, grpc_node_plugin* -> ./build_tools")
conan_cmake_install(PATH_OR_REFERENCE .
        BUILD missing
        REMOTE conancenter
        SETTINGS ${settings})
include(${CMAKE_BINARY_DIR}/conanbuildinfo.cmake)
conan_basic_setup(TARGETS)

if(MSVC)
    set(protoc build_tools/protoc.exe)
    set(grpc_plugin build_tools/grpc_cpp_plugin.exe)
else()
    set(protoc build_tools/protoc)
    set(grpc_plugin build_tools/grpc_cpp_plugin)
endif()

# Proto file
get_filename_component(omega_proto "${CMAKE_CURRENT_SOURCE_DIR}/src/protos/omega_edit.proto" ABSOLUTE)
get_filename_component(omega_proto_path "${omega_proto}" PATH)

# Generated sources
set(omega_proto_srcs "${CMAKE_CURRENT_BINARY_DIR}/src/protos/omega_edit.pb.cc")
set(omega_proto_hdrs "${CMAKE_CURRENT_BINARY_DIR}/src/protos/omega_edit.pb.h")
set(omega_grpc_srcs "${CMAKE_CURRENT_BINARY_DIR}/src/protos/omega_edit.grpc.pb.cc")
set(omega_grpc_hdrs "${CMAKE_CURRENT_BINARY_DIR}/src/protos/omega_edit.grpc.pb.h")
make_directory("${CMAKE_CURRENT_BINARY_DIR}/src/protos")

add_custom_command(
        OUTPUT "${omega_proto_srcs}" "${omega_proto_hdrs}" "${omega_grpc_srcs}" "${omega_grpc_hdrs}"
        COMMAND ${protoc}
        ARGS --grpc_out=generate_mock_code=true:${CMAKE_CURRENT_BINARY_DIR}/src/protos
        --cpp_out=${CMAKE_CURRENT_BINARY_DIR}/src/protos
        --plugin=protoc-gen-grpc=${grpc_plugin}
        -I ${omega_proto_path}
        ${omega_proto}
        DEPENDS ${omega_proto}
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
        COMMENT "Running gRPC C++ protocol buffer compiler on ${omega_proto}"
        VERBATIM)

# Define the library source files
set(OMEGA_EDIT_SOURCE_FILES
        src/include/omega_edit.h
        src/include/omega_edit/config.h
        src/include/omega_edit/fwd_defs.h
        src/include/omega_edit/byte.h
        src/include/omega_edit/scoped_ptr.hpp
        src/include/omega_edit/stl_string_adaptor.hpp
        src/include/omega_edit/change.h src/lib/change.cpp src/lib/impl_/change_def.hpp
        src/include/omega_edit/check.h src/lib/check.cpp
        src/include/omega_edit/edit.h src/lib/edit.cpp
        src/include/omega_edit/search.h src/lib/search.cpp
        src/include/omega_edit/version.h src/lib/version.c
        src/include/omega_edit/visit.h src/lib/visit.cpp
        src/include/omega_edit/session.h src/lib/session.cpp src/lib/impl_/session_def.hpp
        src/include/omega_edit/viewport.h src/lib/viewport.cpp src/lib/impl_/viewport_def.hpp
        src/include/omega_edit/license.h src/lib/license.c
        src/include/omega_edit/utility.h src/lib/utility.c
        src/include/omega_edit/encodings.h src/lib/encodings.c
        src/lib/impl_/internal_fun.hpp src/lib/impl_/internal_fun.cpp
        src/lib/impl_/find.h src/lib/impl_/find.cpp
        src/lib/impl_/data_def.hpp src/lib/impl_/data_segment_def.hpp
        src/lib/impl_/model_def.hpp src/lib/impl_/model_segment_def.hpp
        src/lib/impl_/macros.h
        src/lib/impl_/internal_fwd_defs.hpp)

# Create the library archive for static linking
add_library(omega_edit ${OMEGA_EDIT_SOURCE_FILES} "${omega_proto_srcs}" "${omega_proto_hdrs}" "${omega_grpc_srcs}" "${omega_grpc_hdrs}")
target_include_directories(omega_edit PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src/include")
target_include_directories(omega_edit PRIVATE "${omega_proto_path}")
target_include_directories(omega_edit PRIVATE "${CONAN_INCLUDE_DIRS_CATCH2}")
target_include_directories(omega_edit PRIVATE "${CONAN_INCLUDE_DIRS_CWALK}")
target_include_directories(omega_edit PRIVATE "${CONAN_INCLUDE_DIRS_GRPC}")
target_include_directories(omega_edit PRIVATE "${CONAN_INCLUDE_DIRS_PROTOBUF}")
# Parse version information
string(TOUPPER "${PROJECT_NAME}" PREFIX)

# Send version information into libomega_edit through macro definitions
foreach (level MAJOR MINOR PATCH)
    target_compile_definitions(omega_edit PRIVATE "${PREFIX}_VERSION_${level}=${${PROJECT_NAME}_VERSION_${level}}")
endforeach ()

# Add additional subdirectories with CMakeLists.txt to the build
add_subdirectory(src/examples)
add_subdirectory(src/tests)

target_link_libraries(omega_edit PRIVATE CONAN_PKG::cwalk)
target_link_libraries(omega_edit PRIVATE CONAN_PKG::grpc)

option(BUILD_DOCS "build documentation" ON)
if (BUILD_DOCS)
    # Generate API documentation using Doxygen
    find_package(Doxygen OPTIONAL_COMPONENTS dot dia mscgen)
    if (DOXYGEN_FOUND)
        message(STATUS "API documentation generation enabled")
        set(DOXYGEN_GENERATE_HTML YES)
        set(DOXYGEN_GENERATE_MAN YES)
        set(DOXYGEN_GENERATE_XML YES)
        set(DOXYGEN_OPTIMIZE_OUTPUT_FOR_C YES)
        set(DOXYGEN_EXTRACT_ALL YES)
        set(DOXYGEN_OUTPUT_DIRECTORY docs)
        doxygen_add_docs(docs "src/include" ALL)
        # Add the cmake folder so the FindSphinx module is found
        set(CMAKE_MODULE_PATH "${PROJECT_SOURCE_DIR}/cmake" "${CMAKE_MODULE_PATH}")
        find_package(Sphinx REQUIRED)
        if (SPHINX_FOUND)
            # Generate user documentation using Sphinx
            message(STATUS "User documentation generation enabled")
            set(DOXYGEN_INDEX_DIR "${CMAKE_CURRENT_BINARY_DIR}/docs/xml")
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
                    "${DOXYGEN_INDEX_DIR}/index.xml"
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
