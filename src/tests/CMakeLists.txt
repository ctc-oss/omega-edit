add_executable(omega_test omega_test.cpp test_util.h)
target_link_libraries(omega_test omega_edit)
add_custom_command(TARGET omega_test POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/src/tests/data/ $<TARGET_FILE_DIR:omega_test>/data)

add_executable(play play.cpp)
target_link_libraries(play omega_edit)

add_executable(replay replay.cpp)
target_link_libraries(replay omega_edit)
