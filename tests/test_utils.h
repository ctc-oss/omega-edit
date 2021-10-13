#ifndef OMEGA_EDIT_TEST_UTILS_H
#define OMEGA_EDIT_TEST_UTILS_H

#include <cstdio>
#include <cstring>

// define DEBUG for debugging
#define DEBUG

#ifdef DEBUG
#include <iostream>
#define DBG(x) do{x}while(0)
#else
#define DBG(x)
#endif

// Returns 0 if the content of the 2 file pointers are the same (from where the pointers are currently) and 1 if contents are not the same
inline int compare_file_pointers(FILE *f1, FILE *f2) {
    const size_t buff_size = 1024 * 8;
    uint8_t buf1[buff_size];
    uint8_t buf2[buff_size];

    do {
        size_t r1 = fread(buf1, 1, buff_size, f1);
        size_t r2 = fread(buf2, 1, buff_size, f2);

        if (r1 != r2 || memcmp(buf1, buf2, r1) != 0) {
            return 1;  // Files are not equal
        }
    } while (!feof(f1) && !feof(f2));

    return (feof(f1) && feof(f2)) ? 0 : 1;
}

inline int compare_files(const char * f1, const char * f2) {
    FILE * f1_ptr = fopen(f1, "r");
    FILE * f2_ptr = fopen(f2, "r");
    auto result = compare_file_pointers(f1_ptr, f2_ptr);
    fclose(f1_ptr);
    fclose(f2_ptr);
    return result;
}

inline FILE * fill_file(const char * f1, int64_t file_size, const char * fill, uint64_t fill_length) {
    FILE * f1_ptr = fopen(f1, "w+");
    while (file_size) {
        auto count = (fill_length > file_size) ? file_size : fill_length;
        fwrite(fill, 1, count, f1_ptr);
        file_size -= count;
    }
    fflush(f1_ptr);
    fseek(f1_ptr, 0, SEEK_SET);
    return f1_ptr;
}

#endif //OMEGA_EDIT_TEST_UTILS_H
