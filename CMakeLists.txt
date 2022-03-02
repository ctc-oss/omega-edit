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
        VERSION 0.8.1
        DESCRIPTION "Apache open source library for building editors"
        HOMEPAGE_URL "https://github.com/ctc-oss/omega-edit"
        LANGUAGES C CXX)
message(STATUS "Building ${PROJECT_NAME} ${PROJECT_VERSION}")

# Get verbose output from the makefile (useful for debugging the build)
set(CMAKE_VERBOSE_MAKEFILE ON CACHE BOOL "ON")

# Use C++14
set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED True)
list(APPEND CMAKE_MODULE_PATH "cmake")
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_BINARY_DIR}")

include("cmake/conan.cmake")
conan_cmake_autodetect(settings)
conan_cmake_configure(
        REQUIRES "boost/1.78.0"
        GENERATORS cmake cmake_find_package
        OPTIONS boost:shared=False
        IMPORTS "., license* -> ./licenses @ folder=True, ignore_case=True")
conan_cmake_install(PATH_OR_REFERENCE . BUILD missing REMOTE conancenter SETTINGS ${settings})
include("${CMAKE_CURRENT_BINARY_DIR}/conanbuildinfo.cmake")
conan_basic_setup()

# Dependencies
Set(Boost_INSTALL_DIR ${CONAN_BOOST_ROOT})
find_package(Boost 1.78.0 COMPONENTS filesystem REQUIRED)

# Define the library source files
set(OMEGA_EDIT_SOURCE_FILES
        "src/include/omega_edit.h"
        "src/include/omega_edit/config.h"
        "src/include/omega_edit/fwd_defs.h"
        "src/include/omega_edit/byte.h"
        "src/include/omega_edit/scoped_ptr.hpp"
        "src/include/omega_edit/stl_string_adaptor.hpp"
        "src/include/omega_edit/change.h" "src/lib/change.cpp" "src/lib/impl_/change_def.hpp"
        "src/include/omega_edit/check.h" "src/lib/check.cpp"
        "src/include/omega_edit/edit.h" "src/lib/edit.cpp"
        "src/include/omega_edit/search.h" "src/lib/search.cpp"
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
        "src/lib/impl_/data_def.hpp" "src/lib/impl_/data_segment_def.hpp"
        "src/lib/impl_/model_def.hpp" "src/lib/impl_/model_segment_def.hpp"
        "src/lib/impl_/macros.h" "src/include/omega_edit/export.h"
        "src/lib/impl_/internal_fwd_defs.hpp")

## Let omega_edit_SHARED_LIBS override BUILD_SHARED_LIBS
if (DEFINED omega_edit_SHARED_LIBS)
    set(BUILD_SHARED_LIBS "${omega_edit_SHARED_LIBS}")
endif ()

# Create the library archive for static linking
add_library(omega_edit ${OMEGA_EDIT_SOURCE_FILES})
add_library(omega_edit::omega_edit ALIAS omega_edit)
set_target_properties(omega_edit PROPERTIES VERSION ${omega_edit_VERSION} SOVERSION ${omega_edit_VERSION_MAJOR})
target_include_directories(omega_edit PUBLIC "$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src/include>")
target_include_directories(omega_edit PRIVATE "${CONAN_INCLUDE_DIRS_BOOST}")
target_link_libraries(omega_edit Boost::filesystem)
target_compile_definitions(omega_edit PUBLIC "$<$<NOT:$<BOOL:${BUILD_SHARED_LIBS}>>:OMEGA_EDIT_STATIC_DEFINE>")
target_include_directories(omega_edit PUBLIC "$<BUILD_INTERFACE:${CMAKE_CURRENT_BINARY_DIR}/src/include>")

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
