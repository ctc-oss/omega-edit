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
