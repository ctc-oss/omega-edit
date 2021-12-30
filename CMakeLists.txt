cmake_minimum_required(VERSION 3.16)

# Project information
project(omega_edit
        VERSION 0.6.2
        DESCRIPTION "Apache open source library for building editors"
        HOMEPAGE_URL https://github.com/scholarsmate/omega-edit
        LANGUAGES C CXX)

# Use C++14
set(CMAKE_CXX_STANDARD 14)

# Parse version information
string(TOUPPER ${PROJECT_NAME} PREFIX)
string(REGEX REPLACE "^([0-9]+)\\.[0-9]+\\.[0-9]+.*" "\\1" ${PROJECT_NAME}_VERSION_MAJOR "${PROJECT_VERSION}")
string(REGEX REPLACE "^[0-9]+\\.([0-9]+)\\.[0-9]+.*" "\\1" ${PROJECT_NAME}_VERSION_MINOR "${PROJECT_VERSION}")
string(REGEX REPLACE "^[0-9]+\\.[0-9]+\\.([0-9]+).*" "\\1" ${PROJECT_NAME}_VERSION_PATCH "${PROJECT_VERSION}")
foreach(level MAJOR MINOR PATCH)
    set(PROJECT_VERSION_${level} ${${PROJECT_NAME}_VERSION_${level}})
endforeach()

# Define the library source files
set(SOURCE_FILES
        src/include/omega_edit.h
        src/include/omega_edit/config.h
        src/include/omega_edit/fwd_defs.h
        src/include/omega_edit/byte.h
        src/include/omega_edit/version.h
        src/include/omega_edit/scoped_ptr.hpp
        src/include/omega_edit/stl_string_adaptor.hpp
        src/include/omega_edit/change.h src/lib/change.cpp src/lib/impl_/change_def.hpp
        src/include/omega_edit/check.h src/lib/check.cpp
        src/include/omega_edit/edit.h src/lib/edit.cpp
        src/include/omega_edit/search.h src/lib/search.cpp
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
        src/lib/impl_/macros.hpp
        src/lib/impl_/internal_fwd_defs.hpp)

include_directories(src/include)

# Generate version header file
configure_file(config/version.c.in src/lib/version.c)

# Create the library archive for static linking
add_library(omega_edit STATIC ${SOURCE_FILES} src/lib/version.c)

# Generate documentation using Doxygen
find_package(Doxygen OPTIONAL_COMPONENTS dot dia mscgen)
if(DOXYGEN_FOUND)
    set(DOXYGEN_OPTIMIZE_OUTPUT_FOR_C YES)
    set(DOXYGEN_EXTRACT_ALL YES)
    set(DOXYGEN_OUTPUT_DIRECTORY docs)
    doxygen_add_docs(docs src/omega_edit)
endif(DOXYGEN_FOUND)

# Add additional subdirectories with CMakeLists.txt to the build
add_subdirectory(src/tests)
add_subdirectory(src/examples)
