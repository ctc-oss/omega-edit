cmake_minimum_required(VERSION 3.16)
project(omega_edit)

#option(BUILD_JAVASCRIPT "Build Javascript SWIG module" ON)
set(CMAKE_CXX_STANDARD 14)
set(CMAKE_VERBOSE_MAKEFILE on)

add_library(omega_edit STATIC
        src/omega_edit/include/config.h
        src/omega_edit/include/fwd_defs.h
        src/omega_edit/include/byte.h
        src/omega_edit/include/change.h src/omega_edit/src/change.cpp src/omega_edit/src/impl_/change_def.h
        src/omega_edit/include/edit.h src/omega_edit/src/edit.cpp
        src/omega_edit/include/session.h src/omega_edit/src/session.cpp src/omega_edit/src/impl_/session_def.h
        src/omega_edit/include/viewport.h src/omega_edit/src/viewport.cpp src/omega_edit/src/impl_/viewport_def.h
        src/omega_edit/include/license.h src/omega_edit/src/license.cpp src/omega_edit/src/impl_/license_def.h
        src/omega_edit/include/util.h src/omega_edit/src/util.cpp
        src/omega_edit/include/encodings.h src/omega_edit/src/encodings.cpp
        src/omega_edit/src/impl_/internal_fun.h src/omega_edit/src/impl_/internal_fun.cpp
        src/omega_edit/src/impl_/macros.h
        src/omega_edit/src/impl_/internal_fwd_defs.h
        src/omega_edit/src/impl_/data_def.h
        src/omega_edit/src/impl_/data_segment_def.h
        src/omega_edit/src/impl_/model_segment_def.h
        src/omega_edit/src/impl_/model_def.h)

add_subdirectory(src/bindings)
add_subdirectory(src/tests)
add_subdirectory(src/examples)
