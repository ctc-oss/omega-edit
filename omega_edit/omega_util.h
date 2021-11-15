/*
 * Copyright 2021 Concurrent Technologies Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef OMEGA_EDIT_OMEGA_UTIL_H
#define OMEGA_EDIT_OMEGA_UTIL_H

#include "omega_edit.h"
#include <cstdint>
#include <cstdio>

/**
 * Read a segment from a file into the given buffer
 * @param from_file_ptr file to read the segment from
 * @param offset offset from the file beginning to read from
 * @param buffer pointer to the buffer to write the bytes to
 * @param capacity capacity of the buffer
 * @return number of bytes read, -1 on failure
 */
int64_t read_segment_from_file(FILE *from_file_ptr, int64_t offset, byte_t *buffer, int64_t capacity);

/**
 * Write a segment from one file into another
 * @param from_file_ptr file to read the segment from
 * @param offset offset from the file beginning to read from
 * @param byte_count number of bytes, starting at the offset, to read and write
 * @param to_file_ptr file to write the segment to, at whatever position it is currently at
 * @return 0 on success, non-zero on failure
 */
int64_t write_segment_to_file(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr);

/**
 * Shift the bits of the given buffer by a given number of bits to the left
 * @param buffer pointer to the start of the buffer
 * @param len length of the buffer
 * @param shift_left number of bits (greater than 0 and less than 8) to shift to the left
 * @return 0 on success, non-zero on failure
 */
int left_shift_buffer(byte_t *buffer, int64_t len, byte_t shift_left);

/**
 * Shift the bits of the given buffer by a given number of bits to the right
 * @param buffer pointer to the start of the buffer
 * @param len length of the buffer
 * @param shift_right number of bits (greater than 0 and less than 8) to shift to the right
 * @return 0 on success, non-zero on failure
 */
int right_shift_buffer(byte_t *buffer, int64_t len, byte_t shift_right);

/**
 * Given a pointer to bytes, and a character pointer destination, write the hex values of the bytes to the destination
 * @param src pointer to bytes
 * @param dst destination, must be memory sufficient to hold (src_length * 2) + 1 bytes (will be null-terminated)
 * @param src_length src_length of the bytes
 * @return number of characters written to the destination, or 0 if unsuccessful
 */
size_t bin2hex(const byte_t *src, char *dst, size_t src_length);

/**
 * Given a pointer to hex characters, write the binary representation to dst
 * @param src pointer to hex characters
 * @param dst destination, must be memory sufficient to hold (src_length / 2) bytes
 * @param src_length src_length of the hex characters
 * @return number of bytes written to the destination, or 0 if unsuccessful
 */
size_t hex2bin(const char *src, byte_t *dst, size_t src_length);

#endif//OMEGA_EDIT_OMEGA_UTIL_H
