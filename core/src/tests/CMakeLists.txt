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

foreach(test_src ${omega_test_srcs})
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

    catch_discover_tests(${testname} WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
endforeach()
