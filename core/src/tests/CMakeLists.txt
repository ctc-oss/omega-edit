file(GLOB omega_test_srcs ./*.cpp)

include(CTest)
include(Catch)

set(OMEGA_EDIT_TEST_BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR})
set(OMEGA_EDIT_TEST_DATA_DIR ${OMEGA_EDIT_TEST_BINARY_DIR}/data)

file(COPY ./data DESTINATION ${CMAKE_CURRENT_BINARY_DIR} USE_SOURCE_PERMISSIONS)
configure_file(
        test_util.hpp.in
        ${CMAKE_CURRENT_BINARY_DIR}/test_util.hpp
)

find_program(VALGRIND "valgrind")

foreach (test_src ${omega_test_srcs})
    get_filename_component(testname ${test_src} NAME_WE)

    add_executable(
            ${testname}
            ${test_src}
    )
    target_link_libraries(
            ${testname}
            PRIVATE omega_edit::omega_edit Catch2::Catch2WithMain ${FILESYSTEM_LIB}
    )
    set_target_properties(
            ${testname} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    )
    target_include_directories(
            ${testname}
            PUBLIC ${OMEGA_EDIT_TEST_BINARY_DIR}
    )

    if (VALGRIND)
        add_custom_target(
                "valgrind-${testname}"
                COMMAND ${VALGRIND}
                --leak-check=full
                --show-leak-kinds=all
                --track-origins=yes
                --verbose
                --log-file=${testname}_valgrind-out.txt
                $<TARGET_FILE:${testname}>
                COMMENT "[${testname}]: Running tests under valgrind"
                DEPENDS ${testname})
    endif ()

    # On Windows with shared libraries, we need to ensure the DLL is available
    # for test discovery. Since catch_discover_tests runs immediately after build,
    # we use a different approach for Windows shared builds.
    message(STATUS "Test ${testname}: WIN32=${WIN32}, BUILD_SHARED_LIBS=${BUILD_SHARED_LIBS}")
    if (WIN32 AND BUILD_SHARED_LIBS)
        message(STATUS "Using manual test registration for ${testname}")
        add_dependencies(${testname} omega_edit)
        add_custom_command(TARGET ${testname} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:omega_edit>
            $<TARGET_FILE_DIR:${testname}>
            COMMENT "Copying omega_edit.dll to test directory for ${testname}")
        
        # For Windows shared builds, add the test manually to avoid discovery issues
        add_test(NAME ${testname} COMMAND ${testname})
        set_tests_properties(${testname} PROPERTIES 
            WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
    else()
        message(STATUS "Using catch_discover_tests for ${testname}")
        catch_discover_tests(${testname} WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
    endif()
endforeach ()
