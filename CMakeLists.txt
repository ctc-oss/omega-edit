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
        HOMEPAGE_URL https://github.com/ctc-oss/omega-edit
        LANGUAGES C CXX)

# Get verbose output from the makefile (useful for debugging the build)
set(CMAKE_VERBOSE_MAKEFILE ON)

# Use C++14
set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED True)
list(APPEND CMAKE_MODULE_PATH cmake)


option(BUILD_DOCS "build documentation" ON)
if(BUILD_DOCS)
    # Generate API documentation using Doxygen
    find_package(Doxygen OPTIONAL_COMPONENTS dot dia mscgen)
    if(DOXYGEN_FOUND)
        message(STATUS "API documentation generation enabled")
        set(DOXYGEN_GENERATE_HTML YES)
        set(DOXYGEN_GENERATE_MAN YES)
        set(DOXYGEN_GENERATE_XML YES)
        set(DOXYGEN_OPTIMIZE_OUTPUT_FOR_C YES)
        set(DOXYGEN_EXTRACT_ALL YES)
        set(DOXYGEN_OUTPUT_DIRECTORY docs)
        doxygen_add_docs(docs src/include ALL)
        # Add the cmake folder so the FindSphinx module is found
        set(CMAKE_MODULE_PATH "${PROJECT_SOURCE_DIR}/cmake" ${CMAKE_MODULE_PATH})
        find_package(Sphinx REQUIRED)
        if(SPHINX_FOUND)
            # Generate user documentation using Sphinx
            message(STATUS "User documentation generation enabled")
            set(DOXYGEN_INDEX_DIR ${CMAKE_CURRENT_BINARY_DIR}/docs/xml)
            set(SPHINX_SOURCE ${CMAKE_CURRENT_SOURCE_DIR}/sphinx)
            set(SPHINX_BUILD ${CMAKE_CURRENT_BINARY_DIR}/docs/sphinx)
            set(SPHINX_INDEX_FILE ${SPHINX_BUILD}/index.html)
            add_custom_command(OUTPUT ${SPHINX_INDEX_FILE}
                    COMMAND ${SPHINX_EXECUTABLE} -b html
                    # Tell Breathe where to find the Doxygen output
                    -Dbreathe_projects.omega_edit=${DOXYGEN_INDEX_DIR}
                    ${SPHINX_SOURCE} ${SPHINX_BUILD}
                    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
                    DEPENDS
                    # Other docs files you want to track should go here (or in some variable)
                    ${SPHINX_SOURCE}/index.rst
                    ${DOXYGEN_INDEX_DIR}/index.xml
                    MAIN_DEPENDENCY ${SPHINX_SOURCE}/conf.py
                    COMMENT "Generating documentation with Sphinx")
            # Nice named target so we can run the job easily
            add_custom_target(sphinx ALL DEPENDS ${SPHINX_INDEX_FILE})
            add_dependencies(sphinx docs)
            include(GNUInstallDirs)
            install(DIRECTORY ${SPHINX_BUILD} DESTINATION ${CMAKE_INSTALL_DOCDIR})
        else(SPHINX_FOUND)
            message(STATUS "Sphinx need to be installed to generate user documentation")
        endif(SPHINX_FOUND)
    else(DOXYGEN_FOUND)
        message(STATUS "Doxygen need to be installed to generate API documentation")
    endif(DOXYGEN_FOUND)
endif(BUILD_DOCS)

message(STATUS "Using gRPC via add_subdirectory")
# Build gRPC using FetchContent or add_subdirectory
set(BUILD_TESTING OFF)
set(ABSL_PROPAGATE_CXX_STD ON)
set(gRPC_INSTALL ON)
set(CMAKE_INSTALL_PREFIX_SAVED "${CMAKE_INSTALL_PREFIX}")
set(CMAKE_INSTALL_PREFIX "${CMAKE_CURRENT_BINARY_DIR}/grpc")
if (${CMAKE_SYSTEM_NAME} MATCHES "Darwin")
    set(CMAKE_MACOSX_RPATH 1)
endif()
add_subdirectory(vendor/grpc)
add_custom_command(
        OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/grpc/bin/protoc"
        "${CMAKE_CURRENT_BINARY_DIR}/grpc/bin/grpc_cpp_plugin"
        "${CMAKE_CURRENT_BINARY_DIR}/grpc/bin/grpc_node_plugin"
        WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/vendor/grpc"
        COMMAND make
        ARGS -j4 install
        DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/vendor/grpc/Makefile"
)
set(CMAKE_INSTALL_PREFIX "${CMAKE_INSTALL_PREFIX_SAVED}")

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
        COMMAND ${CMAKE_CURRENT_BINARY_DIR}/grpc/bin/protoc
        ARGS --grpc_out "${CMAKE_CURRENT_BINARY_DIR}/src/protos"
        --cpp_out "${CMAKE_CURRENT_BINARY_DIR}/src/protos"
        -I "${omega_proto_path}"
        --plugin=protoc-gen-grpc="${CMAKE_CURRENT_BINARY_DIR}/grpc/bin/grpc_cpp_plugin"
        "${omega_proto}"
        DEPENDS "${omega_proto}"
        "${CMAKE_CURRENT_BINARY_DIR}/grpc/bin/protoc"
        "${CMAKE_CURRENT_BINARY_DIR}/grpc/bin/grpc_cpp_plugin")

# Define the library source files
set(SOURCE_FILES
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
add_library(omega_edit ${SOURCE_FILES} "${omega_proto_srcs}" "${omega_proto_hdrs}" "${omega_grpc_srcs}" "${omega_grpc_hdrs}")
#add_library(omega_edit ${SOURCE_FILES})
target_include_directories(omega_edit PUBLIC src/include)
target_include_directories(omega_edit PRIVATE "${omega_proto_path}")
# Parse version information
string(TOUPPER ${PROJECT_NAME} PREFIX)

# Send version information into libomega_edit through macro definitions
foreach(level MAJOR MINOR PATCH)
    target_compile_definitions(omega_edit PRIVATE ${PREFIX}_VERSION_${level}=${${PROJECT_NAME}_VERSION_${level}})
endforeach()

# Add additional subdirectories with CMakeLists.txt to the build
add_subdirectory(src/examples)
add_subdirectory(src/tests)
add_subdirectory(vendor/cwalk)

target_link_libraries(omega_edit PRIVATE cwalk)

set(Boost_USE_STATIC_LIBS        ON)  # only find static libs
set(Boost_USE_DEBUG_LIBS        OFF)  # ignore debug libs and
set(Boost_USE_RELEASE_LIBS       ON)  # only find release libs
set(Boost_USE_MULTITHREADED      ON)
set(Boost_USE_STATIC_RUNTIME    OFF)
find_package(Boost 1.66.0 COMPONENTS date_time filesystem system)
if(Boost_FOUND)
    message(STATUS "Boost found ${Boost_VERSION_STRING}")
    target_include_directories(omega_edit PRIVATE ${Boost_INCLUDE_DIRS})
    target_link_libraries(omega_edit PRIVATE ${Boost_LIBRARIES})
endif(Boost_FOUND)

target_link_libraries(omega_edit PUBLIC grpc++)
