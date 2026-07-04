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

set(OMEGA_EDIT_TEST_TRANSFORM_PLUGIN_OUTPUT_DIR "${CMAKE_CURRENT_BINARY_DIR}/test_plugins")

file(REMOVE "${CMAKE_CURRENT_BINARY_DIR}/plugins/omega_transform_process_isolation_test${CMAKE_SHARED_MODULE_SUFFIX}")

add_library(omega_test_process_isolation_plugin MODULE process_isolation_plugin.c)
target_include_directories(omega_test_process_isolation_plugin PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../include")
set_target_properties(
        omega_test_process_isolation_plugin PROPERTIES
        PREFIX ""
        RUNTIME_OUTPUT_DIRECTORY "${OMEGA_EDIT_TEST_TRANSFORM_PLUGIN_OUTPUT_DIR}"
        LIBRARY_OUTPUT_DIRECTORY "${OMEGA_EDIT_TEST_TRANSFORM_PLUGIN_OUTPUT_DIR}"
        RUNTIME_OUTPUT_DIRECTORY_DEBUG "${OMEGA_EDIT_TEST_TRANSFORM_PLUGIN_OUTPUT_DIR}"
        LIBRARY_OUTPUT_DIRECTORY_DEBUG "${OMEGA_EDIT_TEST_TRANSFORM_PLUGIN_OUTPUT_DIR}"
        RUNTIME_OUTPUT_DIRECTORY_RELEASE "${OMEGA_EDIT_TEST_TRANSFORM_PLUGIN_OUTPUT_DIR}"
        LIBRARY_OUTPUT_DIRECTORY_RELEASE "${OMEGA_EDIT_TEST_TRANSFORM_PLUGIN_OUTPUT_DIR}"
)

if (WIN32 AND BUILD_SHARED_LIBS)
    # Multiple test targets share the same runtime directory, so stage the DLL
    # once up front instead of racing on per-target POST_BUILD copies.
    add_custom_target(
            omega_edit_test_runtime
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:omega_edit>
            ${CMAKE_CURRENT_BINARY_DIR}
            COMMENT "Copying omega_edit.dll to shared test runtime directory"
            DEPENDS omega_edit
    )
endif ()

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
    if (TARGET omega-transform-plugin-host)
        add_dependencies(${testname} omega-transform-plugin-host)
    endif()

    if (testname STREQUAL "process_isolation_tests")
        add_dependencies(${testname} omega_test_process_isolation_plugin)
        target_compile_definitions(
                ${testname}
                PRIVATE
                OMEGA_EDIT_PLUGIN_HOST_EXECUTABLE="$<TARGET_FILE:omega-transform-plugin-host>"
                OMEGA_EDIT_PROCESS_ISOLATION_PLUGIN="$<TARGET_FILE:omega_test_process_isolation_plugin>"
        )
    endif()

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

    if (testname STREQUAL "undo_benchmark")
        message(STATUS "Skipping default CTest registration for benchmark target ${testname}")
        continue()
    endif ()

    # On Windows with shared libraries, we need to ensure the DLL is available
    # for test discovery. Since catch_discover_tests runs immediately after build,
    # we use a different approach for Windows shared builds.
    message(STATUS "Test ${testname}: WIN32=${WIN32}, BUILD_SHARED_LIBS=${BUILD_SHARED_LIBS}")
    if (WIN32 AND BUILD_SHARED_LIBS)
        message(STATUS "Using manual test registration for ${testname}")
        add_dependencies(${testname} omega_edit_test_runtime)
        
        # For Windows shared builds, add the test manually to avoid discovery issues
        add_test(NAME ${testname} COMMAND ${testname})
        set_tests_properties(${testname} PROPERTIES 
            WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
    else()
        message(STATUS "Using catch_discover_tests for ${testname}")
        catch_discover_tests(${testname} WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
    endif()
endforeach ()
