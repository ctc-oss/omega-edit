cmake_minimum_required(VERSION 3.16)

# Project information
project(omega_edit
        VERSION 0.6.0
        DESCRIPTION "Apache open source library for building editors"
        HOMEPAGE_URL https://github.com/scholarsmate/omega-edit
        LANGUAGES C CXX)

# Use C++14
set(CMAKE_CXX_STANDARD 14)

# Get verbose output from the makefile (useful for debugging the build)
set(CMAKE_VERBOSE_MAKEFILE ON)

# Define the library source files
set(SOURCE_FILES
        src/omega_edit/include/config.h
        src/omega_edit/include/fwd_defs.h
        src/omega_edit/include/byte.h
        src/omega_edit/include/scoped_ptr.hpp
        src/omega_edit/include/stl_string_adaptor.hpp
        src/omega_edit/include/change.h src/omega_edit/src/change.cpp src/omega_edit/src/impl_/change_def.hpp
        src/omega_edit/include/check.h src/omega_edit/src/check.cpp
        src/omega_edit/include/edit.h src/omega_edit/src/edit.cpp
        src/omega_edit/include/match.h src/omega_edit/src/match.cpp
        src/omega_edit/include/visit.h src/omega_edit/src/visit.cpp
        src/omega_edit/include/session.h src/omega_edit/src/session.cpp src/omega_edit/src/impl_/session_def.hpp
        src/omega_edit/include/viewport.h src/omega_edit/src/viewport.cpp src/omega_edit/src/impl_/viewport_def.hpp
        src/omega_edit/include/license.h src/omega_edit/src/license.c
        src/omega_edit/include/utility.h src/omega_edit/src/utility.c
        src/omega_edit/include/encodings.h src/omega_edit/src/encodings.c
        src/omega_edit/src/impl_/internal_fun.hpp src/omega_edit/src/impl_/internal_fun.cpp
        src/omega_edit/src/impl_/search.h src/omega_edit/src/impl_/search.cpp
        src/omega_edit/src/impl_/data_def.hpp src/omega_edit/src/impl_/data_segment_def.hpp
        src/omega_edit/src/impl_/model_def.hpp src/omega_edit/src/impl_/model_segment_def.hpp
        src/omega_edit/src/impl_/macros.hpp
        src/omega_edit/src/impl_/internal_fwd_defs.hpp)

# Create the library archive for static linking
add_library(omega_edit STATIC ${SOURCE_FILES})

# Generate documentation using Doxygen
find_package(Doxygen OPTIONAL_COMPONENTS dot dia mscgen)
if(DOXYGEN_FOUND)
    set(DOXYGEN_OPTIMIZE_OUTPUT_FOR_C YES)
    set(DOXYGEN_EXTRACT_ALL YES)
    set(DOXYGEN_OUTPUT_DIRECTORY docs)
    doxygen_add_docs(docs src/omega_edit)
endif(DOXYGEN_FOUND)

# Add additional subdirectories with CMakeLists.txt to the build
add_subdirectory(src/bindings)
add_subdirectory(src/tests)
add_subdirectory(src/examples)
