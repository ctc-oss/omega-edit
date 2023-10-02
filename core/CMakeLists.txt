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
        VERSION 0.9.73
        DESCRIPTION "Apache open source library for building editors"
        HOMEPAGE_URL "https://github.com/ctc-oss/omega-edit"
        LANGUAGES C CXX)

option(BUILD_SHARED_LIBS "Build shared libraries instead of static ones" ON)
option(BUILD_TESTS "build tests" ON)
option(BUILD_DOCS "build documentation" ON)
option(BUILD_EXAMPLES "build examples" ON)

## Let omega_edit_SHARED_LIBS override BUILD_SHARED_LIBS
if (DEFINED omega_edit_SHARED_LIBS)
    set(BUILD_SHARED_LIBS "${omega_edit_SHARED_LIBS}")
endif ()

message(STATUS "Building ${PROJECT_NAME} ${PROJECT_VERSION} (shared libs: ${BUILD_SHARED_LIBS})")

# Common configurations
set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS ON)
set(CMAKE_VERBOSE_MAKEFILE ON CACHE BOOL "ON")
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

if (CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND NOT MINGW)
    set(FILESYSTEM_LIB stdc++fs)
endif ()

# Dependencies
if (BUILD_TESTS)
    include(FetchContent)
    FetchContent_Declare(
            Catch2
            GIT_SHALLOW TRUE
            GIT_REPOSITORY https://github.com/catchorg/Catch2.git
            GIT_TAG v3.4.0)
    FetchContent_MakeAvailable(Catch2)
    list(APPEND CMAKE_MODULE_PATH "${Catch2_SOURCE_DIR}/extras")
endif ()

# Core library configuration
file(GLOB_RECURSE OMEGA_EDIT_SOURCE_FILES "src/include/*.h" "src/include/*.hpp" "src/lib/*.c" "src/lib/*.cpp")
add_library(omega_edit ${OMEGA_EDIT_SOURCE_FILES})
add_library(omega_edit::omega_edit ALIAS omega_edit)
set_target_properties(omega_edit PROPERTIES VERSION ${PROJECT_VERSION} SOVERSION ${PROJECT_VERSION_MAJOR})
target_include_directories(omega_edit PUBLIC "$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src/include>")
target_compile_definitions(omega_edit PUBLIC "$<$<NOT:$<BOOL:${BUILD_SHARED_LIBS}>>:OMEGA_EDIT_STATIC_DEFINE>")
target_link_libraries(omega_edit PRIVATE ${FILESYSTEM_LIB})

# Packaging rules
string(COMPARE EQUAL "${CMAKE_SOURCE_DIR}" "${CMAKE_CURRENT_SOURCE_DIR}" is_top_level)
option(omega_edit_INCLUDE_PACKAGING "Include packaging rules for OmegaEdit" "${is_top_level}")
if (omega_edit_INCLUDE_PACKAGING)
    add_subdirectory(packaging)
endif ()

# Version definitions
string(TOUPPER "${PROJECT_NAME}" PREFIX)
foreach (level MAJOR MINOR PATCH)
    target_compile_definitions(omega_edit PRIVATE "${PREFIX}_VERSION_${level}=${${PROJECT_NAME}_VERSION_${level}}")
endforeach ()

# Examples
if (BUILD_EXAMPLES)
    file(GLOB_RECURSE EXAMPLES_SRC "src/examples/*.c" "src/examples/*.cpp")
    foreach (example_src ${EXAMPLES_SRC})
        get_filename_component(example_name ${example_src} NAME_WE)
        add_executable(${example_name} ${example_src})
        target_link_libraries(${example_name} PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})
    endforeach ()
endif ()

# Tests
if (BUILD_TESTS)
    enable_testing()
    add_executable(omega_test "src/tests/omega_test.cpp" "src/tests/test_util.h")
    target_link_libraries(omega_test PRIVATE omega_edit::omega_edit Catch2::Catch2WithMain ${FILESYSTEM_LIB})
    add_custom_command(TARGET omega_test POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/src/tests/data" "$<TARGET_FILE_DIR:omega_test>/data")
    include(CTest)
    include(Catch)
    catch_discover_tests(omega_test WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")
    find_program(VALGRIND "valgrind")
    if (VALGRIND)
        add_custom_target(valgrind COMMAND ${VALGRIND} --leak-check=full --show-leak-kinds=all --track-origins=yes --verbose --log-file=valgrind-out.txt $<TARGET_FILE:omega_test> COMMENT "Running tests under valgrind" DEPENDS omega_test)
    endif ()
endif ()

# Documentation
if (BUILD_DOCS)
    find_package(Doxygen)
    if (DOXYGEN_FOUND)
        set(DOXYGEN_GENERATE_XML YES)
        set(DOXYGEN_OUTPUT_DIRECTORY docs)
        set(DOXYGEN_INDEX_DIR "${CMAKE_CURRENT_BINARY_DIR}/docs/xml")
        doxygen_add_docs(docs "src/include" ALL)
        find_package(Sphinx)
        if (SPHINX_FOUND)
            set(SPHINX_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/sphinx")
            set(SPHINX_BUILD "${CMAKE_CURRENT_BINARY_DIR}/docs/sphinx")
            add_custom_target(
                    sphinx ALL
                    COMMAND "${SPHINX_EXECUTABLE}" -b html
                    -Dbreathe_projects.omega_edit="${DOXYGEN_INDEX_DIR}"
                    "${SPHINX_SOURCE}" "${SPHINX_BUILD}"
                    WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
                    COMMENT "Generating documentation with Sphinx"
            )
            add_dependencies(sphinx docs)
            include(GNUInstallDirs)
            install(DIRECTORY "${SPHINX_BUILD}" DESTINATION "${CMAKE_INSTALL_DOCDIR}")
        endif ()
    endif ()
endif ()
