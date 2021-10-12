#define CATCH_CONFIG_MAIN

#include "catch.hpp"
#include "test_utils.h"
#include <cstdio>
#include <cstring>
#include <iostream>
#include "../omega_edit/omega_edit.h"


TEST_CASE("File Compare", "[UtilTests]") {
    SECTION("Identity") {
        // Same file ought to yield identical contents
        REQUIRE(compare_files("data/test1.dat", "data/test1.dat") == 0);
    }
    SECTION("Difference") {
        // Different files with different contents
        REQUIRE(compare_files("data/test1.dat", "data/test2.dat") == 1);
    }
}

TEST_CASE("Write Segment", "[WriteSegmentTests]") {
    FILE *test_outfile_ptr = fopen("data/test1.dat.seg", "w");
    FILE *read_file_ptr = fopen("data/test1.dat", "r");
    auto rc = write_segment(read_file_ptr, 10, 26, test_outfile_ptr);
    REQUIRE(rc == 0);
    rc = write_segment(read_file_ptr, 0, 10, test_outfile_ptr);
    REQUIRE(rc == 0);
    rc = write_segment(read_file_ptr, 36, 27, test_outfile_ptr);
    REQUIRE(rc == 0);
}

TEST_CASE("Check initialization", "[InitTests]") {
    FILE *test_infile_ptr = nullptr;
    session_t *session_ptr = nullptr;
    const author_t *author_ptr = nullptr;

    SECTION("Open data file") {
        test_infile_ptr = fopen("data/test1.dat", "r");
        FILE *test_outfile_ptr = fopen("data/test1.dat.out", "w+");
        REQUIRE(test_infile_ptr != 0);
        SECTION("Create Session") {
            session_ptr = create_session(test_infile_ptr);
            REQUIRE(session_ptr != 0);
            REQUIRE(get_computed_file_size(session_ptr) == 63);
            SECTION("Add Author") {
                const char *author_name = "Test Author";
                author_ptr = add_author(session_ptr, author_name);
                REQUIRE(strcmp(author_name, get_author_name(author_ptr)) == 0);
                SECTION("Add bytes") {
                    ins(session_ptr, 10, 4, '+', author_ptr);
                    REQUIRE(get_computed_file_size(session_ptr) == 67);
                    ovr(session_ptr, 12, '.', author_ptr);
                    REQUIRE(get_computed_file_size(session_ptr) == 67);
                    ins(session_ptr, 0, 3, '+', author_ptr);
                    REQUIRE(get_computed_file_size(session_ptr) == 70);
                    ovr(session_ptr, 1, '.', author_ptr);
                    REQUIRE(get_computed_file_size(session_ptr) == 70);
                    ovr(session_ptr, 15, '*', author_ptr);
                    REQUIRE(get_computed_file_size(session_ptr) == 70);
                    ins(session_ptr, 15, 1, '+', author_ptr);
                    REQUIRE(get_computed_file_size(session_ptr) == 71);
                    del(session_ptr, 9, 5, author_ptr);
                    REQUIRE(get_computed_file_size(session_ptr) == 66);
                    auto orig_offset = computed_offset_to_offset(session_ptr, 15);
                    DBG(std::clog << "OFFSET: " << orig_offset << std::endl;);
                    save(session_ptr, test_outfile_ptr);
                    fclose(test_infile_ptr);
                    fclose(test_outfile_ptr);
                }
            }
            destroy_session(session_ptr);
        }
    }
}
