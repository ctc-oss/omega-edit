add_executable(omega_test omega_test.cpp test_utils.h)
target_link_libraries(omega_test omega_edit)
add_custom_command(TARGET omega_test POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/tests/data/ $<TARGET_FILE_DIR:omega_test>/data)
