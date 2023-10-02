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

#include <iostream>
#include <omega_edit/utility.h>

omega_bom_t string_to_BOM(const std::string_view &bom_str) {
    if (bom_str == "utf8") {
        return BOM_UTF8;
    } else if (bom_str == "utf16le") {
        return BOM_UTF16LE;
    } else if (bom_str == "utf16be") {
        return BOM_UTF16BE;
    } else if (bom_str == "utf32le") {
        return BOM_UTF32LE;
    } else if (bom_str == "utf32be") {
        return BOM_UTF32BE;
    } else {
        return BOM_NONE;
    }
}

int main(int argc, char **argv) {
    if (argc != 2) {
        std::cerr << "Usage: " << argv[0] << " <BOM_type>" << std::endl;
        std::cerr << std::endl;
        std::cerr << "Add a byte order mark (BOM) to the beginning of stdin and writes to stdout." << std::endl;
        std::cerr << "BOM_type can be one of: utf8, utf16le, utf16be, utf32le, utf32be, none" << std::endl;
        return 1;
    }
    omega_bom_t bom = string_to_BOM(argv[1]);

    // If BOM_NONE and BOM_type is not "none", then the BOM_type is invalid
    if (bom == BOM_NONE && std::string(argv[1]) != "none") {
        std::cerr << "ERROR: Invalid BOM type given: " << argv[1] << std::endl;
        std::cerr << "BOM_type can be one of: utf8, utf16le, utf16be, utf32le, utf32be, none" << std::endl;
        return 1;
    }

    // Set stdout to binary mode (important on some platforms like Windows)
    std::cout << std::ios::binary;

    if (const omega_byte_buffer_t *bom_buffer_ptr = omega_util_BOM_to_buffer(bom)) {
        std::cout.write((const char *) bom_buffer_ptr->data, bom_buffer_ptr->length);
    }

    // Copy from stdin to stdout
    char buffer[4096];
    while (std::cin.read(buffer, sizeof(buffer))) { std::cout.write(buffer, sizeof(buffer)); }
    std::cout.write(buffer, std::cin.gcount());

    return 0;
}
