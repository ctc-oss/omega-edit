cmake_minimum_required(VERSION 3.20)
project(omega_edit)

set(CMAKE_CXX_STANDARD 14)

add_library(omega_edit SHARED omega_edit/omega_edit.cpp omega_edit/omega_util.h omega_edit/omega_util.cpp)
add_subdirectory(tests)
