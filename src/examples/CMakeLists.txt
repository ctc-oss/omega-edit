get_target_property(OMEGA_EDIT_PUBLIC_HEADER_DIR omega_edit INTERFACE_INCLUDE_DIRECTORIES)
include_directories(${OMEGA_EDIT_PUBLIC_HEADER_DIR})

add_executable(replace replace.cpp)
target_link_libraries(replace omega_edit)

add_executable(rotate rotate.cpp)
target_link_libraries(rotate omega_edit)

add_executable(slice slice.cpp)
target_link_libraries(slice omega_edit)

add_executable(peek peek.cpp)
target_link_libraries(peek omega_edit)

add_executable(simple simple.cpp)
target_link_libraries(simple omega_edit)

add_executable(simple_c simple_c.c)
target_link_libraries(simple_c omega_edit)
