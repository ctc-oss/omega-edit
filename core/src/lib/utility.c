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

#include "../include/omega_edit/config.h"

#ifdef OMEGA_BUILD_WINDOWS

#include <fcntl.h>
#include <io.h>
#include <process.h>
#include <sys/stat.h>

#ifdef OPEN
#undef OPEN
#endif
#ifdef CLOSE
#undef CLOSE
#endif
#define OPEN _open
#define O_CREAT _O_CREAT
#define O_RDWR _O_RDWR
#define CLOSE _close
#define getpid _getpid
#else

#include <string.h>
#include <sys/stat.h>

#ifndef O_BINARY
#define O_BINARY (0)
#endif
#endif

#include "../include/omega_edit/utility.h"
#include "impl_/character_counts_def.h"
#include "impl_/macros.h"
#include <assert.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>


int omega_util_compute_mode(int mode) {
#ifdef OMEGA_BUILD_WINDOWS
    // Convert Unix-style mode bits to the equivalent Windows style
    int winMode = 0;
    if (mode & 0400) winMode |= _S_IREAD;// Owner read
    if (mode & 0200) winMode |= _S_IWRITE;// Owner write
    return winMode;
#else
    const mode_t umask_value = umask(0);
    umask(umask_value);
    return mode & ~umask_value;
#endif
}

int64_t omega_util_write_segment_to_file(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr) {
    assert(from_file_ptr);
    assert(to_file_ptr);
    if (0 != FSEEK(from_file_ptr, offset, SEEK_SET)) { return -1; }
    int64_t remaining = byte_count;
    omega_byte_t buff[BUFSIZ];
    while (remaining) {
        const int64_t count = (int64_t) sizeof(buff) > remaining ? remaining : (int64_t) sizeof(buff);
        if (count != (int64_t) fread(buff, sizeof(omega_byte_t), count, from_file_ptr) ||
            count != (int64_t) fwrite(buff, sizeof(omega_byte_t), count, to_file_ptr)) { break; }
        remaining -= count;
    }
    return byte_count - remaining;
}

int omega_util_right_shift_buffer(omega_byte_t *buffer, int64_t len, omega_byte_t shift_right, int fill_bit) {
    assert(buffer != NULL);
    if (shift_right <= 0 || shift_right >= 8) {
        return -1;// Invalid shift amount
    }

    if (fill_bit != 0 && fill_bit != 1) {
        return -2;// Invalid fill bit
    }

    // Now perform the right shift across the buffer
    for (int64_t i = len - 1; i >= 0; --i) {
        // Right shift current byte and include bits from the previous byte
        buffer[i] = (i > 0 ? buffer[i - 1] << (8 - shift_right) : 0) | (buffer[i] >> shift_right);
    }

    // Apply fill mask to the first byte
    buffer[0] |= (fill_bit ? 0xFF << (8 - shift_right) : 0x00);

    return 0;
}

int omega_util_left_shift_buffer(omega_byte_t *buffer, int64_t len, omega_byte_t shift_left, int fill_bit) {
    assert(buffer != NULL);
    if (shift_left <= 0 || shift_left >= 8) {
        return -1;// Invalid shift amount
    }

    if (fill_bit != 0 && fill_bit != 1) {
        return -2;// Invalid fill bit
    }

    // Now perform the left shift across the buffer
    for (int64_t i = 0; i < len; ++i) {
        // Left shift current byte and include bits from the next byte
        buffer[i] = (i < len - 1 ? buffer[i + 1] >> (8 - shift_left) : 0) | (buffer[i] << shift_left);
    }

    // Apply fill mask to the last byte
    buffer[len - 1] |= (fill_bit ? 0xFF >> (8 - shift_left) : 0x00);

    return 0;
}


void omega_util_apply_byte_transform(omega_byte_t *buffer, int64_t len, omega_util_byte_transform_t transform,
                                     void *user_data_ptr) {
    assert(buffer);
    for (int64_t i = 0; i < len; ++i) { buffer[i] = transform(buffer[i], user_data_ptr); }
}

int omega_util_apply_byte_transform_to_file(char const *in_path, char const *out_path,
                                            omega_util_byte_transform_t transform, void *user_data_ptr, int64_t offset,
                                            int64_t length) {
    assert(in_path);
    assert(out_path);
    assert(transform);
    assert(0 <= offset);
    assert(0 <= length);
    FILE *in_fp = FOPEN(in_path, "rb");
    assert(in_fp);
    FSEEK(in_fp, 0, SEEK_END);
    int64_t in_file_length = FTELL(in_fp);
    if (0 == length) { length = in_file_length - offset; }
    do {
        if (length < 1 || in_file_length <= offset || in_file_length < offset + length) {
            LOG_ERROR("transform out of range");
            break;
        }
        FILE *out_fp = FOPEN(out_path, "wb");
        assert(out_fp);
        if (omega_util_write_segment_to_file(in_fp, 0, offset, out_fp) != offset ||
            0 != FSEEK(in_fp, offset, SEEK_SET)) {
            LOG_ERROR("failed to write first segment bytes to file");
            FCLOSE(out_fp);
            omega_util_remove_file(out_path);
            break;
        }
        int64_t remaining = length;
        omega_byte_t buff[BUFSIZ];
        while (remaining) {
            const int64_t count = ((int64_t) sizeof(buff) > remaining) ? remaining : (int64_t) sizeof(buff);
            const int64_t num_read = (int64_t) fread(buff, sizeof(omega_byte_t), count, in_fp);
            if (count != num_read) {
                LOG_ERROR("failed to read buffer");
                break;
            }
            omega_util_apply_byte_transform(buff, count, transform, user_data_ptr);
            const int64_t num_written = (int64_t) fwrite(buff, sizeof(omega_byte_t), count, out_fp);
            if (count != num_written) {
                LOG_ERROR("failed to write buffer");
                break;
            }
            remaining -= count;
        }
        if (remaining) {
            LOG_ERROR("there are remaining bytes");
            FCLOSE(out_fp);
            omega_util_remove_file(out_path);
            break;
        }
        offset += length;
        length = in_file_length - offset;
        if (offset < in_file_length && omega_util_write_segment_to_file(in_fp, offset, length, out_fp) != length) {
            LOG_ERROR("failed to write last segment");
            FCLOSE(out_fp);
            omega_util_remove_file(out_path);
            break;
        }
        FCLOSE(out_fp);
        FCLOSE(in_fp);
        return 0;
    } while (0);
    FCLOSE(in_fp);
    LOG_ERROR("transform failed");
    return -1;
}

omega_byte_t omega_util_mask_byte(omega_byte_t byte, omega_byte_t mask, omega_mask_kind_t mask_kind) {
    switch (mask_kind) {
        case MASK_AND:
            return byte & mask;
        case MASK_OR:
            return byte | mask;
        case MASK_XOR:
            return byte ^ mask;
        default:
            ABORT(LOG_ERROR("unhandled mask kind"););
    }
}

int omega_util_strncmp(const char *s1, const char *s2, uint64_t sz) {
    int rc = 0;
    for (uint64_t i = 0; i < sz; ++i) { if (0 != (rc = s1[i] - s2[i])) break; }
    return rc;
}

int omega_util_strnicmp(const char *s1, const char *s2, uint64_t sz) {
    int rc = 0;
    for (uint64_t i = 0; i < sz; ++i) { if (0 != (rc = tolower(s1[i]) - tolower(s2[i]))) break; }
    return rc;
}

char *omega_util_strndup(const char *s, size_t len) {
    char *result = (char *) malloc(len + 1);
    if (result != NULL) {
        memcpy(result, s, len);
        result[len] = '\0';
    }
    return result;
}

const void *omega_util_memrchr(const void *s, int c, size_t n) {
    if (n >= 1) {
        const unsigned char *cp = (const unsigned char *) s;
        for (const unsigned char *p = cp + n; p-- > cp;) { if (*p == c) { return p; } }
    }
    return NULL;
}

omega_bom_t omega_util_detect_BOM_from_memory(const unsigned char *data, size_t length) {
    if (length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF) { return BOM_UTF8; } else if (
        length >= 2 && data[0] == 0xFF && data[1] == 0xFE) {
        return (length >= 4 && data[2] == 0x00 && data[3] == 0x00) ? BOM_UTF32LE : BOM_UTF16LE;
    } else if (length >= 2 && data[0] == 0xFE && data[1] == 0xFF) { return BOM_UTF16BE; } else if (
        length >= 4 && data[0] == 0x00 && data[1] == 0x00 && data[2] == 0xFE && data[3] == 0xFF) { return BOM_UTF32BE; }
    return BOM_NONE;
}

omega_bom_t omega_util_detect_BOM_from_file(const char *filename) {
    FILE *file = FOPEN(filename, "rb");
    if (!file) {
        perror("Error opening file");
        return BOM_NONE;
    }

    unsigned char bom[4];
    const size_t bytesRead = fread(bom, 1, 4, file);
    FCLOSE(file);

    return omega_util_detect_BOM_from_memory(bom, bytesRead);
}

char const *omega_util_BOM_to_cstring(omega_bom_t bom) {
    switch (bom) {
        case BOM_NONE:
            return "none";
        case BOM_UTF8:
            return "UTF-8";
        case BOM_UTF16LE:
            return "UTF-16LE";
        case BOM_UTF16BE:
            return "UTF-16BE";
        case BOM_UTF32LE:
            return "UTF-32LE";
        case BOM_UTF32BE:
            return "UTF-32BE";
        case BOM_UNKNOWN: // fall through
        default:
            // Should never happen
            return "unknown";
    }
}

omega_bom_t omega_util_cstring_to_BOM(char const *str) {
    if (0 == omega_util_strnicmp(str, "none", 4)) { return BOM_NONE; } else if (
        0 == omega_util_strnicmp(str, "UTF-8", 5)) { return BOM_UTF8; } else if (
        0 == omega_util_strnicmp(str, "UTF-16LE", 8)) { return BOM_UTF16LE; } else if (
        0 == omega_util_strnicmp(str, "UTF-16BE", 8)) { return BOM_UTF16BE; } else if (
        0 == omega_util_strnicmp(str, "UTF-32LE", 8)) { return BOM_UTF32LE; } else if (
        0 == omega_util_strnicmp(str, "UTF-32BE", 8)) { return BOM_UTF32BE; }
    return BOM_UNKNOWN;
}

static inline int is_lead_surrogate_UTF16_(uint16_t word) {
    // https://en.wikipedia.org/wiki/UTF-16#Code_points_from_U+010000_to_U+10FFFF
    return word >= 0xD800 && word <= 0xDBFF ? 1 : 0;
}

static inline int is_low_surrogate_UTF16_(uint16_t word) {
    // https://en.wikipedia.org/wiki/UTF-16#Code_points_from_U+010000_to_U+10FFFF
    return word >= 0xDC00 && word <= 0xDFFF ? 1 : 0;
}


void omega_util_count_characters(const unsigned char *data, size_t length, omega_character_counts_t *counts_ptr) {
    assert(data);
    assert(counts_ptr);

    // Skip the BOM if present (the BOM is metadata, not part of the text)
    const size_t bomSize = omega_util_BOM_size(counts_ptr->bom);
    switch (counts_ptr->bom) {
        case BOM_UTF8:
            if (length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF) {
                data += bomSize;
                length -= bomSize;
                counts_ptr->bomBytes = bomSize;
            }
            break;
        case BOM_UTF16LE:
            if (length >= 2 && data[0] == 0xFF && data[1] == 0xFE) {
                data += bomSize;
                length -= bomSize;
                counts_ptr->bomBytes = bomSize;
            }
            break;
        case BOM_UTF16BE:
            if (length >= 2 && data[0] == 0xFE && data[1] == 0xFF) {
                data += bomSize;
                length -= bomSize;
                counts_ptr->bomBytes = bomSize;
            }
            break;
        case BOM_UTF32LE:
            if (length >= 4 && data[0] == 0xFF && data[1] == 0xFE && data[2] == 0x00 && data[3] == 0x00) {
                data += bomSize;
                length -= bomSize;
                counts_ptr->bomBytes = bomSize;
            }
            break;
        case BOM_UTF32BE:
            if (length >= 4 && data[0] == 0x00 && data[1] == 0x00 && data[2] == 0xFE && data[3] == 0xFF) {
                data += bomSize;
                length -= bomSize;
                counts_ptr->bomBytes = bomSize;
            }
            break;
        default:
            // No actual BOM specified, do nothing
            break;
    }
    size_t i = 0;
    switch (counts_ptr->bom) {
        case BOM_UNKNOWN:// fall through, assume UTF-8 if the BOM is unknown
        case BOM_NONE:// fall through, assume UTF-8 if the BOM is none
        case BOM_UTF8:
            while (i < length) {
                if ((data[i] & 0x80) == 0) {
                    ++counts_ptr->singleByteChars;// ASCII character
                    ++i;
                } else if ((data[i] & 0xE0) == 0xC0) {
                    // check for 2-byte UTF-8 character
                    if (i + 1 < length && (data[i + 1] & 0xC0) == 0x80) {
                        ++counts_ptr->doubleByteChars;// 2-byte UTF-8 character (e.g. é)
                        i += 2;
                    } else {
                        ++counts_ptr->invalidBytes;// invalid UTF-8 sequence
                        ++i;
                    }
                } else if ((data[i] & 0xF0) == 0xE0) {
                    // check for 3-byte UTF-8 character
                    if (i + 2 < length && (data[i + 1] & 0xC0) == 0x80 && (data[i + 2] & 0xC0) == 0x80) {
                        ++counts_ptr->tripleByteChars;// 3-byte UTF-8 character (e.g. €)
                        i += 3;
                    } else {
                        ++counts_ptr->invalidBytes;// invalid UTF-8 sequence
                        ++i;
                    }
                } else {
                    // check for 4-byte UTF-8 character
                    if (i + 3 < length && (data[i + 1] & 0xC0) == 0x80 && (data[i + 2] & 0xC0) == 0x80 &&
                        (data[i + 3] & 0xC0) == 0x80) {
                        ++counts_ptr->quadByteChars;// 4-byte UTF-8 character (e.g. 🌍)
                        i += 4;
                    } else {
                        ++counts_ptr->invalidBytes;// invalid UTF-8 sequence
                        ++i;
                    }
                }
            }
            break;

        case BOM_UTF16LE:// fall through
        case BOM_UTF16BE:
            while (i + 1 < length) {
                // Swap the bytes if the BOM is little endian
                const uint16_t char16 = counts_ptr->bom == BOM_UTF16LE
                                            ? (uint16_t) (data[i]) | (uint16_t) (data[i + 1]) << 8
                                            : (uint16_t) (data[i]) << 8 | (uint16_t) (data[i + 1]);

                if (is_lead_surrogate_UTF16_(char16)) {
                    if (i + 3 < length) {
                        const uint16_t next_char16 = counts_ptr->bom == BOM_UTF16LE
                                                         ? (uint16_t) (data[i + 2]) | (uint16_t) (data[i + 3]) << 8
                                                         : (uint16_t) (data[i + 2]) << 8 | (uint16_t) (data[i + 3]);
                        if (is_low_surrogate_UTF16_(next_char16)) {
                            ++counts_ptr->doubleByteChars;
                            i += 4;// skip the low surrogate as well
                        } else {
                            ++counts_ptr->invalidBytes;// incomplete surrogate pair
                            ++i;
                        }
                    } else {
                        ++counts_ptr->invalidBytes;// incomplete surrogate pair at end of data
                        break;// exit loop
                    }
                } else if (is_low_surrogate_UTF16_(char16)) {
                    ++counts_ptr->invalidBytes;// low surrogate without preceding high surrogate
                    ++i;
                } else if (char16 <= 0x7F) {
                    ++counts_ptr->singleByteChars;// ASCII characters
                    i += 2;
                } else {
                    ++counts_ptr->doubleByteChars;// all other characters
                    i += 2;
                }
            }
            break;

        case BOM_UTF32LE:// fall through
        case BOM_UTF32BE:
            while (i + 3 < length) {
                // Swap the bytes if the BOM is little endian
                const uint32_t char32 =
                        counts_ptr->bom == BOM_UTF32LE
                            ? (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24))
                            : ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]);

                if ((char32 >= 0xD800 && char32 <= 0xDFFF) || char32 > 0x10FFFF) {
                    ++counts_ptr->invalidBytes;// surrogate pairs and characters above 0x10FFFF are invalid in UTF-32
                    ++i;
                } else if (char32 <= 0x7F) {
                    ++counts_ptr->singleByteChars;// ASCII characters
                    i += 4;
                } else {
                    ++counts_ptr->quadByteChars;// all other characters
                    i += 4;
                }
            }
            break;

        default:
            ABORT(LOG_ERROR("unhandled BOM"););
    }
    // Handle trailing invalid bytes
    counts_ptr->invalidBytes += length - i;
}

size_t omega_util_BOM_size(omega_bom_t bom) {
    switch (bom) {
        case BOM_UTF8:
            return 3;
        case BOM_UTF16LE:// fall through
        case BOM_UTF16BE:
            return 2;
        case BOM_UTF32LE:// fall through
        case BOM_UTF32BE:
            return 4;
        case BOM_NONE: // fall through
        default:
            return 0;
    }
}

const omega_byte_buffer_t *omega_util_BOM_to_buffer(omega_bom_t bom) {
    static const omega_byte_buffer_t utf8_bom = {.data = (omega_byte_t *) "\xEF\xBB\xBF", .length = 3};
    static const omega_byte_buffer_t utf16le_bom = {.data = (omega_byte_t *) "\xFF\xFE", .length = 2};
    static const omega_byte_buffer_t utf16be_bom = {.data = (omega_byte_t *) "\xFE\xFF", .length = 2};
    static const omega_byte_buffer_t utf32le_bom = {.data = (omega_byte_t *) "\xFF\xFE\x00\x00", .length = 4};
    static const omega_byte_buffer_t utf32be_bom = {.data = (omega_byte_t *) "\x00\x00\xFE\xFF", .length = 4};

    switch (bom) {
        case BOM_UTF8:
            return &utf8_bom;
        case BOM_UTF16LE:
            return &utf16le_bom;
        case BOM_UTF16BE:
            return &utf16be_bom;
        case BOM_UTF32LE:
            return &utf32le_bom;
        case BOM_UTF32BE:
            return &utf32be_bom;
        case BOM_NONE:// fall through
        case BOM_UNKNOWN: // fall through
        default:
            return NULL;
    }
}