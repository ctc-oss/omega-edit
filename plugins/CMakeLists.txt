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

if (POLICY CMP0091)
    cmake_policy(SET CMP0091 NEW)
endif()

if (CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    set(OMEGA_EDIT_PLUGINS_VERSION_FILE "${CMAKE_CURRENT_SOURCE_DIR}/../VERSION")
    if (NOT EXISTS "${OMEGA_EDIT_PLUGINS_VERSION_FILE}")
        set(OMEGA_EDIT_PLUGINS_VERSION_FILE "${CMAKE_CURRENT_SOURCE_DIR}/VERSION")
    endif()
    file(READ "${OMEGA_EDIT_PLUGINS_VERSION_FILE}" OMEGA_EDIT_PLUGINS_VERSION)
    string(STRIP "${OMEGA_EDIT_PLUGINS_VERSION}" OMEGA_EDIT_PLUGINS_VERSION)
    if (NOT OMEGA_EDIT_PLUGINS_VERSION MATCHES "^([0-9]+)\\.([0-9]+)\\.([0-9]+)(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$")
        message(FATAL_ERROR
                "VERSION must use semantic versioning like 1.2.3 or 1.2.3-rc1. Got: ${OMEGA_EDIT_PLUGINS_VERSION}")
    endif()
    set(OMEGA_EDIT_PLUGINS_VERSION_BASE "${CMAKE_MATCH_1}.${CMAKE_MATCH_2}.${CMAKE_MATCH_3}")
else()
    set(OMEGA_EDIT_PLUGINS_VERSION "${PROJECT_VERSION}")
    set(OMEGA_EDIT_PLUGINS_VERSION_BASE "${PROJECT_VERSION}")
endif()

project(omega_edit_transform_plugins
        VERSION ${OMEGA_EDIT_PLUGINS_VERSION_BASE}
        DESCRIPTION "Example transform plugins for Omega Edit"
        HOMEPAGE_URL "https://github.com/ctc-oss/omega-edit"
        LANGUAGES C CXX)

option(BUILD_TESTS "build plugin tests" ON)

include(GNUInstallDirs)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)

if (CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND NOT MINGW)
    set(FILESYSTEM_LIB stdc++fs)
endif()

if (BUILD_COVERAGE AND (CMAKE_C_COMPILER_ID MATCHES "GNU|Clang" OR CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang"))
    add_compile_options(--coverage -fprofile-arcs -ftest-coverage)
    add_link_options(--coverage)
endif()

if (NOT TARGET omega_edit::omega_edit)
    find_package(omega_edit CONFIG REQUIRED)
endif()
set(OPENSSL_USE_STATIC_LIBS TRUE)
find_package(OpenSSL 3 REQUIRED COMPONENTS Crypto)
find_package(ZLIB REQUIRED)
get_target_property(OMEGA_EDIT_INCLUDE_DIRS omega_edit::omega_edit INTERFACE_INCLUDE_DIRECTORIES)

if (NOT DEFINED OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR)
    set(OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR "${CMAKE_CURRENT_BINARY_DIR}/plugins" CACHE PATH
            "Output directory for transform plugin modules")
endif()

foreach (stale_plugin_name
        and
        base64_decode
        base64_encode
        blake2b512
        blake2s256
        checksum8
        fnv1a64
        md5
        or
        sha1
        sha224
        sha256
        sha384
        sha3_256
        sha3_512
        sha512
        xor
        zlib_compress
        zlib_decompress)
    file(REMOVE "${OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR}/omega_transform_${stale_plugin_name}${CMAKE_SHARED_MODULE_SUFFIX}")
endforeach()

set(OMEGA_EDIT_TRANSFORM_PLUGIN_TARGETS)
foreach (plugin_src
        src/base64.c
        src/bitwise.c
        src/character_transcode.cpp
        src/common_checksums.cpp
        src/decimal_codecs.cpp
        src/endian_swap.cpp
        src/format_inspectors.cpp
        src/openssl_digests.c
        src/record_text_helpers.cpp
        src/text_codecs.cpp
        src/zlib.c
        src/repeat.c
)
    get_filename_component(plugin_name ${plugin_src} NAME_WE)
    set(plugin_target "omega_transform_${plugin_name}")
    add_library(${plugin_target} MODULE ${plugin_src})
    target_include_directories(${plugin_target} PRIVATE ${OMEGA_EDIT_INCLUDE_DIRS})
    if (plugin_name STREQUAL "zlib")
        target_link_libraries(${plugin_target} PRIVATE ZLIB::ZLIB)
    endif()
    if (plugin_name STREQUAL "openssl_digests")
        target_link_libraries(${plugin_target} PRIVATE OpenSSL::Crypto)
        if (CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
            target_compile_options(${plugin_target} PRIVATE -fvisibility=hidden)
        endif()
        if (UNIX AND NOT APPLE)
            target_link_options(${plugin_target} PRIVATE "LINKER:--exclude-libs,ALL")
        elseif (APPLE)
            target_link_options(${plugin_target} PRIVATE "LINKER:-dead_strip")
        endif()
    endif()
    set_target_properties(
            ${plugin_target} PROPERTIES
            PREFIX ""
            RUNTIME_OUTPUT_DIRECTORY "${OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR}"
            LIBRARY_OUTPUT_DIRECTORY "${OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR}"
            RUNTIME_OUTPUT_DIRECTORY_DEBUG "${OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR}"
            LIBRARY_OUTPUT_DIRECTORY_DEBUG "${OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR}"
            RUNTIME_OUTPUT_DIRECTORY_RELEASE "${OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR}"
            LIBRARY_OUTPUT_DIRECTORY_RELEASE "${OMEGA_EDIT_TRANSFORM_PLUGIN_OUTPUT_DIR}"
    )
    list(APPEND OMEGA_EDIT_TRANSFORM_PLUGIN_TARGETS ${plugin_target})
endforeach()

add_custom_target(omega_edit_transform_plugins DEPENDS ${OMEGA_EDIT_TRANSFORM_PLUGIN_TARGETS})

add_executable(omega-transform-plugin-harness tools/transform_plugin_harness.cpp)
target_link_libraries(omega-transform-plugin-harness PRIVATE omega_edit::omega_edit ${FILESYSTEM_LIB})
add_dependencies(omega-transform-plugin-harness omega_edit_transform_plugins)

if (BUILD_TESTS)
    enable_testing()
    if (NOT TARGET Catch2::Catch2WithMain)
        find_package(Catch2 3 CONFIG QUIET)
        if (NOT Catch2_FOUND)
            include(FetchContent)
            set(OMEGA_EDIT_PLUGINS_ORIGINAL_BUILD_SHARED_LIBS ${BUILD_SHARED_LIBS})
            set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
            FetchContent_Declare(
                    Catch2
                    GIT_SHALLOW TRUE
                    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
                    GIT_TAG 6ee0826dcae55ed1e06b2c5701981221e979e1e6 # v3.15.0
            )
            FetchContent_MakeAvailable(Catch2)
            set(BUILD_SHARED_LIBS ${OMEGA_EDIT_PLUGINS_ORIGINAL_BUILD_SHARED_LIBS} CACHE BOOL "" FORCE)
        endif()
    endif()

    include(CTest)

    set(OMEGA_EDIT_TRANSFORM_PLUGIN_TEST_BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR}/tests)
    file(MAKE_DIRECTORY "${OMEGA_EDIT_TRANSFORM_PLUGIN_TEST_BINARY_DIR}")
    configure_file(
            tests/test_util.hpp.in
            ${OMEGA_EDIT_TRANSFORM_PLUGIN_TEST_BINARY_DIR}/test_util.hpp
    )

    add_executable(omega_transform_plugin_tests tests/transform_plugin_tests.cpp)
    target_link_libraries(omega_transform_plugin_tests PRIVATE omega_edit::omega_edit Catch2::Catch2WithMain
            ${FILESYSTEM_LIB})
    target_include_directories(omega_transform_plugin_tests PRIVATE ${OMEGA_EDIT_TRANSFORM_PLUGIN_TEST_BINARY_DIR})
    set_target_properties(omega_transform_plugin_tests PROPERTIES
            RUNTIME_OUTPUT_DIRECTORY ${OMEGA_EDIT_TRANSFORM_PLUGIN_TEST_BINARY_DIR})
    add_dependencies(omega_transform_plugin_tests omega_edit_transform_plugins)

    if (WIN32 AND BUILD_SHARED_LIBS)
        set(OMEGA_EDIT_TRANSFORM_PLUGIN_RUNTIME_TARGET "")
        if (TARGET omega_edit)
            set(OMEGA_EDIT_TRANSFORM_PLUGIN_RUNTIME_TARGET omega_edit)
        elseif (TARGET omega_edit::omega_edit)
            set(OMEGA_EDIT_TRANSFORM_PLUGIN_RUNTIME_TARGET omega_edit::omega_edit)
        endif()
    endif()

    if (OMEGA_EDIT_TRANSFORM_PLUGIN_RUNTIME_TARGET)
        add_custom_target(
                omega_edit_transform_plugin_test_runtime
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                $<TARGET_FILE:${OMEGA_EDIT_TRANSFORM_PLUGIN_RUNTIME_TARGET}>
                ${OMEGA_EDIT_TRANSFORM_PLUGIN_TEST_BINARY_DIR}
                COMMENT "Copying omega_edit.dll to transform plugin test runtime directory"
                DEPENDS ${OMEGA_EDIT_TRANSFORM_PLUGIN_RUNTIME_TARGET}
        )
        add_dependencies(omega_transform_plugin_tests omega_edit_transform_plugin_test_runtime)
    endif()
    add_test(NAME omega_transform_plugin_tests COMMAND omega_transform_plugin_tests)
    set_tests_properties(omega_transform_plugin_tests PROPERTIES
            WORKING_DIRECTORY ${OMEGA_EDIT_TRANSFORM_PLUGIN_TEST_BINARY_DIR})
endif()

if (CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    install(TARGETS ${OMEGA_EDIT_TRANSFORM_PLUGIN_TARGETS}
            RUNTIME DESTINATION "${CMAKE_INSTALL_LIBDIR}/omega_edit/plugins"
            LIBRARY DESTINATION "${CMAKE_INSTALL_LIBDIR}/omega_edit/plugins")
    install(TARGETS omega-transform-plugin-harness RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}")

    set(_fmt "TGZ")
    if (WIN32)
        set(_fmt "ZIP")
    endif()
    set(CPACK_GENERATOR "${_fmt}")
    set(CPACK_PACKAGE_VENDOR "Concurrent Technologies Corporation")
    set(CPACK_PACKAGE_CONTACT "omega.edit@ctc.com")
    set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_CURRENT_SOURCE_DIR}/../LICENSE.txt")
    set(CPACK_RESOURCE_FILE_README "${CMAKE_CURRENT_SOURCE_DIR}/README.md")
    set(CPACK_OUTPUT_FILE_PREFIX "${CMAKE_CURRENT_BINARY_DIR}/package")
    string(TOLOWER "${CMAKE_SYSTEM_NAME}" _sys)
    string(TOLOWER "${PROJECT_NAME}" _project_lower)
    set(CPACK_PACKAGE_FILE_NAME "${_project_lower}-${_sys}")
    include(CPack)
endif()
