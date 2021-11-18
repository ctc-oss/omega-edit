cmake_minimum_required(VERSION 3.16)
project(omega_edit)

set(CMAKE_CXX_STANDARD 14)

add_library(omega_edit SHARED omega_edit/include/util.h omega_edit/src/util.cpp omega_edit/src/impl_/macros.h omega_edit/include/config.h omega_edit/include/byte.h omega_edit/src/author.cpp omega_edit/include/author.h omega_edit/src/impl_/author_def.h omega_edit/src/impl_/change_def.h omega_edit/src/impl_/data_def.h omega_edit/src/impl_/data_segment_def.h omega_edit/src/impl_/viewport_def.h omega_edit/src/impl_/model_segment_def.h omega_edit/src/impl_/model_def.h omega_edit/src/impl_/session_def.h omega_edit/src/impl_/internal_fun.cpp omega_edit/src/impl_/internal_fun.cpp omega_edit/src/impl_/internal_fun.h omega_edit/src/session.cpp omega_edit/include/session.h omega_edit/include/fwd_defs.h omega_edit/src/viewport.cpp omega_edit/include/viewport.h omega_edit/src/change.cpp omega_edit/src/change.cpp omega_edit/include/change.h omega_edit/src/encodings.cpp omega_edit/include/encodings.h omega_edit/src/impl_/internal_defs.h)
add_subdirectory(tests)
add_subdirectory(examples)
