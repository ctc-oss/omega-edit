/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed under the License is            *
 * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                   *
 * implied.  See the License for the specific language governing permissions and limitations under the License.       *
 *                                                                                                                    *
 **********************************************************************************************************************/

#include "omega_edit.h"
#include "omega_edit/filesystem.h"
#include "omega_edit/stl_string_adaptor.hpp"
#include <test_util.hpp>

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_contains.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <filesystem>
#include <fstream>
#include <sys/stat.h>

using namespace std;
namespace fs = std::filesystem;

using Catch::Matchers::Contains;
using Catch::Matchers::EndsWith;
using Catch::Matchers::Equals;


TEST_CASE("File Compare", "[UtilTests]") {
    SECTION("Identity") {
        // Same file ought to yield identical contents
        REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.dat"), MAKE_PATH("test1.dat")));
    }
    SECTION("Difference") {
        // Different files with different contents
        REQUIRE(0 != omega_util_compare_files(MAKE_PATH("test1.dat"), MAKE_PATH("test2.dat")));
    }
}

TEST_CASE("File Copy", "[UtilTests]") {
    struct stat src_stat{};
    struct stat dst_stat{};
    omega_util_remove_file(MAKE_PATH("test1.copy.dat"));
#ifdef OMEGA_BUILD_WINDOWS
    // sleep for 1 second to ensure the file modification time is different,
    // needed for Windows because the file system only has 100 nanosecond resolution
    omega_util_sleep_(1);
#endif
    REQUIRE(0 == omega_util_file_copy(MAKE_PATH("test1.dat"), MAKE_PATH("test1.copy.dat"), 0));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.dat"), MAKE_PATH("test1.copy.dat")));

    REQUIRE(0 == omega_util_compare_modification_times(MAKE_PATH("test1.dat"), MAKE_PATH("test1.dat")));
    REQUIRE(1 == omega_util_compare_modification_times(MAKE_PATH("test1.copy.dat"), MAKE_PATH("test1.dat")));
    REQUIRE(-1 == omega_util_compare_modification_times(MAKE_PATH("test1.dat"), MAKE_PATH("test1.copy.dat")));
    REQUIRE(-2 == omega_util_compare_modification_times(MAKE_PATH("test1.dat"), "-invalid-"));

    REQUIRE(0 == stat(MAKE_PATH("test1.dat"), &src_stat));
    REQUIRE(0 == stat(MAKE_PATH("test1.copy.dat"), &dst_stat));

    // The mode includes the file type
    const int dst_mode = 0100600;// S_IFREG | S_IRUSR  regular file with owner read-only
    REQUIRE(dst_mode != src_stat.st_mode);
    REQUIRE(src_stat.st_mode == dst_stat.st_mode);

    REQUIRE(0 == omega_util_remove_file(MAKE_PATH("test1.copy.dat")));
    REQUIRE(0 == omega_util_file_copy(MAKE_PATH("test1.dat"), MAKE_PATH("test1.copy.dat"), dst_mode));

    REQUIRE(0 == stat((DATA_DIR / "test1.copy.dat").string().c_str(), &dst_stat));

#ifndef OMEGA_BUILD_WINDOWS
    // On Windows, the mode is not preserved as expected on non-Windows platforms
    REQUIRE(dst_mode == dst_stat.st_mode);
#endif

    REQUIRE(omega_util_directory_exists(DATA_DIR.string().c_str()));
    REQUIRE(!omega_util_file_exists(DATA_DIR.string().c_str()));
    REQUIRE(!omega_util_directory_exists((DATA_DIR / "test1.copy.dat").string().c_str()));
    REQUIRE(omega_util_file_exists((DATA_DIR / "test1.copy.dat").string().c_str()));
    REQUIRE(1 == omega_util_remove_all((DATA_DIR / "test1.copy.dat").string().c_str()));
    REQUIRE(0 == omega_util_remove_all((DATA_DIR / "test1.copy.dat").string().c_str()));
    REQUIRE(!omega_util_file_exists((DATA_DIR / "test1.copy.dat").string().c_str()));
}

TEST_CASE("End Of Line", "[EOLTests]") {
    omega_byte_t buffer[1024];
    FILE *in_fp = FOPEN(MAKE_PATH("test1.dat"), "rb");
    REQUIRE(in_fp);
    auto file_size = omega_util_file_size(MAKE_PATH("test1.dat"));
    REQUIRE(63 == file_size);
    REQUIRE(file_size < sizeof(buffer));
    REQUIRE(file_size == fread(buffer, sizeof(omega_byte_t), file_size, in_fp));
    REQUIRE(0 == FCLOSE(in_fp));
    FILE *out_fp = FOPEN(MAKE_PATH("test1.actual.eol.1.dat"), "wb");
    REQUIRE(out_fp);
    REQUIRE(file_size == fwrite(buffer, sizeof(omega_byte_t), file_size, out_fp));
    REQUIRE(file_size == FTELL(out_fp));
    REQUIRE(0 == FCLOSE(out_fp));
    REQUIRE(0 == omega_util_compare_files(MAKE_PATH("test1.dat"), MAKE_PATH("test1.actual.eol.1.dat")));
}

TEST_CASE("File Exists", "[UtilTests]") {
    REQUIRE(fs::exists(MAKE_PATH("test1.dat")));
    omega_util_remove_file(MAKE_PATH("IDonTExist.DaT"));
    REQUIRE(!fs::exists(MAKE_PATH("IDonTExist.DaT")));
    REQUIRE(0 != omega_util_file_exists(MAKE_PATH("test1.dat")));
    REQUIRE(0 == omega_util_file_exists(MAKE_PATH("IDonTExist.DaT")));
}

TEST_CASE("File Touch", "[UtilTests]") {
    const char dir_sep = omega_util_directory_separator();
    const auto exists = std::string(MAKE_PATH("test1.dat"));
    const auto dont_exist = std::string(MAKE_PATH("IDonTExistYeT.DaT"));
    omega_util_remove_file(MAKE_PATH("IDonTExistYeT.DaT"));
    REQUIRE(omega_util_file_exists(exists.c_str()));
    REQUIRE(!omega_util_file_exists(dont_exist.c_str()));
    auto expected = std::string(MAKE_PATH("test1-1.dat"));
    REQUIRE_THAT(omega_util_available_filename(exists.c_str(), nullptr), Equals(expected));
    expected = dont_exist;
    REQUIRE_THAT(omega_util_available_filename(dont_exist.c_str(), nullptr), Equals(expected));
    omega_util_touch(dont_exist.c_str(),
                     0);// logs an error as expected because create is false and the file does not exist
    REQUIRE(!omega_util_file_exists(dont_exist.c_str()));
#ifdef OMEGA_BUILD_WINDOWS
    // sleep for 1 second to ensure the file modification time is different,
    // needed for Windows because the file system only has 100 nanosecond resolution
    omega_util_sleep_(1);
#endif
    omega_util_touch(dont_exist.c_str(), 1);
    REQUIRE(omega_util_file_exists(dont_exist.c_str()));
    REQUIRE(-1 == omega_util_compare_modification_times(exists.c_str(), dont_exist.c_str()));
    REQUIRE(1 == omega_util_compare_modification_times(dont_exist.c_str(), exists.c_str()));
    expected = std::string(MAKE_PATH("IDonTExistYeT-1.DaT"));
    REQUIRE_THAT(omega_util_available_filename(dont_exist.c_str(), nullptr), Equals(expected));
    REQUIRE(0 == omega_util_remove_file(dont_exist.c_str()));
    REQUIRE(!omega_util_file_exists(dont_exist.c_str()));
    expected = dont_exist;
    REQUIRE_THAT(omega_util_available_filename(dont_exist.c_str(), nullptr), Equals(expected));
}

TEST_CASE("Current Directory", "[UtilTests]") {
    const auto current_directory = omega_util_get_current_dir(nullptr);
    REQUIRE(current_directory);
    REQUIRE(omega_util_directory_exists(current_directory));
}

TEST_CASE("Directory Name", "[UtilTests]") {
    // Unix-style paths
    auto test_1 = "/this/is/a/directory/filename.extension";
    char buffer[FILENAME_MAX];
    auto result = omega_util_dirname(test_1, nullptr);
    REQUIRE(result);
    REQUIRE_THAT(result, Equals("/this/is/a/directory"));
    // DOS/Windows-style paths
    auto test_2 = R"(C:\this\is\a\directory\filename.extension)";
    result = omega_util_dirname(test_2, buffer);
    REQUIRE(result);
#ifdef OMEGA_BUILD_WINDOWS
    REQUIRE_THAT(buffer, Equals(R"(C:\this\is\a\directory)"));
#else
    REQUIRE_THAT(buffer, Equals(""));
#endif
    // Missing directory test
    auto test_3 = "filename.extension";
    result = omega_util_dirname(test_3, buffer);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals(""));
    // relative path
    auto test_4 = "relative/filename.extension";
    result = omega_util_dirname(test_4, buffer);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals("relative"));
}

TEST_CASE("Base File Name", "[UtilTests]") {
    // Unix-style paths
    auto test_1 = "/this/is/a/directory/filename.extension";
    char buffer[FILENAME_MAX];
    auto result = omega_util_basename(test_1, nullptr, 0);
    REQUIRE(result);
    REQUIRE_THAT(result, Equals("filename.extension"));
    // DOS/Windows-style paths
    auto test_2 = R"(C:\this\is\a\directory\filename.extension)";
    result = omega_util_basename(test_2, buffer, 0);
    REQUIRE(result);
#ifdef OMEGA_BUILD_WINDOWS
    REQUIRE_THAT(buffer, Equals("filename.extension"));
#else
    REQUIRE_THAT(buffer, Equals("C:\\this\\is\\a\\directory\\filename.extension"));
#endif
    auto test_3 = "filename.extension";
    result = omega_util_basename(test_3, buffer, 0);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals("filename.extension"));
    result = omega_util_basename(test_3, buffer, 1);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals("filename"));
    auto test_4 = "/this/is/a/directory/";
    result = omega_util_basename(test_4, buffer, 0);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals(""));
}

TEST_CASE("File Extension", "[UtilTests]") {
    // Unix-style paths
    const auto test_1 = "/this/is/a/directory/filename.extension";
    char buffer[FILENAME_MAX];
    auto result = omega_util_file_extension(test_1, nullptr);
    REQUIRE(result);
    REQUIRE_THAT(result, Equals(".extension"));
    // DOS/Windows-style paths
    const auto test_2 = R"(C:\this\is\a\directory\filename.extension)";
    result = omega_util_file_extension(test_2, buffer);
    REQUIRE(result);
    REQUIRE_THAT(buffer, Equals(".extension"));
    const auto test_3 = "filename_no_extension";
    result = omega_util_file_extension(test_3, buffer);
    REQUIRE_THAT(result, Equals(""));
    const auto test_4 = "filename_empty_extension.";
    result = omega_util_file_extension(test_4, buffer);
    REQUIRE(result);
    REQUIRE_THAT(result, Equals("."));
    const auto test_5 = "/..";
    result = omega_util_file_extension(test_5, buffer);
    REQUIRE(result);
    REQUIRE_THAT(result, Equals(""));
    const auto test_6 = "/this.is.a.directory/filename_no_extension";
    result = omega_util_file_extension(test_6, buffer);
    REQUIRE_THAT(result, Equals(""));
}


TEST_CASE("Emoji Filename Handling", "[FilesystemTests]") {
    const char* emoji_filenames[] = {
        "test_😀.dat",
        "test_👍.dat",
        "test_🔥.dat",
        "test 💩.dat", // Space in filename as well
        "test_🚀.dat",
        "test_👨‍👩‍👧‍👦.dat"  // Family emoji with zero-width joiners
    };
    
    char buffer[FILENAME_MAX];
    
    // Test filesystem operations with emoji filenames
    for (const auto& emoji_filename : emoji_filenames) {
        const char dir_sep = omega_util_directory_separator();
        std::string base_path = std::string(DATA_DIR.string().c_str()) + dir_sep;
        std::string full_path = base_path + emoji_filename;
        
        // Create a file with emoji in filename
        std::ofstream file(full_path);
        file << "Test content" << std::endl;
        file.close();
        
        // Test file_exists
        REQUIRE(omega_util_file_exists(full_path.c_str()));
        
        // Test available_filename - since the file exists, we expect a path with -1 suffix
        char* available_name = omega_util_available_filename(full_path.c_str(), buffer);
        REQUIRE(available_name != nullptr);
        // The file exists so available_name should append -1 to the filename
        std::string expected_path = full_path;
        size_t dot_pos = expected_path.rfind('.');
        expected_path.insert(dot_pos, "-1");
        REQUIRE(std::string(available_name) == expected_path);
        
        // Test basename, dirname and extension
        char* basename_result = omega_util_basename(full_path.c_str(), nullptr, 0);
        REQUIRE(basename_result != nullptr);
        REQUIRE(std::string(basename_result) == emoji_filename);
        
        char* dirname_result = omega_util_dirname(full_path.c_str(), nullptr);
        REQUIRE(dirname_result != nullptr);
        REQUIRE(std::string(dirname_result) == base_path.substr(0, base_path.length() - 1));
        
        char* ext_result = omega_util_file_extension(full_path.c_str(), nullptr);
        REQUIRE(ext_result != nullptr);
        REQUIRE(std::string(ext_result) == ".dat");
        
        // Create a second file for copy operations
        std::string copy_path = base_path + "copy_" + emoji_filename;
        
        // Test file_copy
        REQUIRE(0 == omega_util_file_copy(full_path.c_str(), copy_path.c_str(), 0));
        REQUIRE(omega_util_file_exists(copy_path.c_str()));
        REQUIRE(0 == omega_util_compare_files(full_path.c_str(), copy_path.c_str()));
        
        // Test remove_file
        REQUIRE(0 == omega_util_remove_file(full_path.c_str()));
        REQUIRE(!omega_util_file_exists(full_path.c_str()));
        
        REQUIRE(0 == omega_util_remove_file(copy_path.c_str()));
        REQUIRE(!omega_util_file_exists(copy_path.c_str()));
    }
}
