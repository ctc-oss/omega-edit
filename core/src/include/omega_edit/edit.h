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

/**
 * @file edit.h
 * @brief Main editing functions.
 */

#ifndef OMEGA_EDIT_EDIT_H
#define OMEGA_EDIT_EDIT_H

#include "byte.h"
#include "fwd_defs.h"
#include "search.h"
#include "utility.h"

#ifdef __cplusplus

#include <cstddef>
#include <cstdint>

extern "C" {
#else

#include <stddef.h>
#include <stdint.h>

#endif

/**
 * Create a file editing session from a file path
 * @param file_path file path, will be opened for read, to create an editing session with, or nullptr if starting from
 * scratch
 * @param cbk user-defined callback function called whenever a content affecting change is made to this session
 * @param user_data_ptr pointer to user-defined data to associate with this session
 * @param event_interest oring together the session events of interest, or zero if all session events are desired
 * @param checkpoint_directory directory to store checkpoints in, if null, then it will try to use the same directory as
 * the file_path, and if that fails, then it will use the system temp directory, and if that fails, it will use the
 * current working directory
 * @return pointer to the created session, or NULL on failure
 */
omega_session_t *omega_edit_create_session(const char *file_path, omega_session_event_cbk_t cbk, void *user_data_ptr,
                                           int32_t event_interest, const char *checkpoint_directory);

/**
 * Create an editing session backed by an in-memory byte buffer.
 * @param data_ptr bytes to seed the session with, or nullptr if length is zero
 * @param length number of bytes in data_ptr
 * @param cbk user-defined callback function called whenever a content affecting change is made to this session
 * @param user_data_ptr pointer to user-defined data to associate with this session
 * @param event_interest oring together the session events of interest, or zero if all session events are desired
 * @param checkpoint_directory directory to store checkpoints in, if null, the system temp directory (or current working
 * directory as a last resort) will be used.  A checkpoint file is still created internally so the session can reuse
 * the standard file-backed model and checkpoint machinery.
 * @return pointer to the created session, or NULL on failure
 */
omega_session_t *omega_edit_create_session_from_bytes(const omega_byte_t *data_ptr, int64_t length,
                                                      omega_session_event_cbk_t cbk, void *user_data_ptr,
                                                      int32_t event_interest, const char *checkpoint_directory);

/**
 * Destroy the given session and all associated objects (changes, and viewports)
 * @param session_ptr session to destroy
 */
void omega_edit_destroy_session(omega_session_t *session_ptr);

/**
 * Options for creating a viewport with named fields.
 */
typedef struct {
    int64_t offset;
    int64_t capacity;
    omega_edit_bool_t is_floating;
    omega_viewport_event_cbk_t cbk;
    void *user_data_ptr;
    int32_t event_interest;
} omega_edit_viewport_options_t;

/**
 * Create a new viewport, returns a pointer to the new viewport
 * @param session_ptr session to create the new viewport in
 * @param offset offset for the new viewport
 * @param capacity desired capacity of the new viewport
 * @param is_floating 0 if the viewport is to remain fixed at the given offset, non-zero if the viewport is expected to
 * "float" as bytes are inserted or deleted before the start of this viewport
 * @param cbk user-defined callback function called whenever the viewport gets updated
 * @param user_data_ptr pointer to user-defined data to associate with this new viewport
 * @param event_interest oring together the viewport events of interest, or zero if all viewport events are desired
 * @return pointer to the new viewport, or NULL on failure
 */
omega_viewport_t *omega_edit_create_viewport(omega_session_t *session_ptr, int64_t offset, int64_t capacity,
                                             int is_floating, omega_viewport_event_cbk_t cbk, void *user_data_ptr,
                                             int32_t event_interest);

/**
 * Create a new viewport using a named options structure.
 * @param session_ptr session to create the new viewport in
 * @param options viewport creation options
 * @return pointer to the new viewport, or NULL on failure
 */
omega_viewport_t *omega_edit_create_viewport_with_options(omega_session_t *session_ptr,
                                                          const omega_edit_viewport_options_t *options);

/**
 * Destroy a given viewport
 * @param viewport_ptr viewport to destroy
 */
void omega_edit_destroy_viewport(omega_viewport_t *viewport_ptr);

/**
 * Given a session, clear all active changes
 * @param session_ptr session to clear all changes for
 * @return zero on success and non-zero otherwise
 */
int omega_edit_clear_changes(omega_session_t *session_ptr);

/**
 * Restore a session to a previous active change count and discard redo history.
 * The target count must be between the current model's available history base and the current active change count.
 * Checkpoint-backed transform models created after the target count are discarded.
 * @param session_ptr session to restore
 * @param change_count active change count to keep
 * @return zero on success and non-zero otherwise
 */
int omega_edit_restore_to_change_count(omega_session_t *session_ptr, int64_t change_count);

/**
 * Given a session, undo the last change
 * @param session_ptr session to undo the last change for
 * @return negative serial number of the undone change if successful, zero otherwise
 */
int64_t omega_edit_undo_last_change(omega_session_t *session_ptr);

/**
 * Redoes the last undo (if available)
 * @param session_ptr session to redo the last undo for
 * @return positive serial number of the redone change if successful, zero otherwise
 */
int64_t omega_edit_redo_last_undo(omega_session_t *session_ptr);

/**
 * Test a serial-returning edit result, such as omega_edit_insert or omega_edit_delete, for success.
 * @param result edit result value
 * @return non-zero when result is a positive change serial
 */
int omega_edit_serial_result_is_success(int64_t result);

/**
 * Test a status-returning edit result, such as omega_edit_clear_changes or omega_edit_apply_script, for success.
 * @param result edit status value
 * @return non-zero when result is zero
 */
int omega_edit_status_result_is_success(int result);

/**
 * Callback used to verify an overwrite target immediately before core publishes a saved file.
 *
 * The callback is invoked only when the target is the session's original file and core detects that it changed since
 * the last synchronization. Return zero to allow the overwrite or non-zero to preserve the target and report
 * ORIGINAL_MODIFIED. Core does not lock the target across this callback and the following atomic replacement, so the
 * callback detects conflicts but cannot provide transactional compare-and-swap semantics against concurrent writers.
 */
typedef int (*omega_edit_overwrite_guard_cbk_t)(const char *file_path, void *user_data_ptr);

/** Optional behavior for publishing a session save. */
typedef struct {
    omega_edit_overwrite_guard_cbk_t overwrite_guard;
    void *overwrite_guard_user_data;
} omega_edit_save_options_t;

/**
 * Save a segment with an optional native overwrite guard.
 *
 * This is equivalent to omega_edit_save_segment when options_ptr is null. A configured overwrite guard is evaluated
 * at the final publish boundary only when core's normal original-file modification check detects a conflict.
 */
int omega_edit_save_segment_with_options(omega_session_t *session_ptr, const char *file_path, int io_flags,
                                         char *saved_file_path, int64_t offset, int64_t length,
                                         const omega_edit_save_options_t *options_ptr);

/**
 * Save a segment of the the given session (the edited file) to the given file path.  If the save file already exists,
 * it can be overwritten if overwrite is non zero.  If the file exists and overwrite is zero, a new unique file name
 * will be used as determined by omega_util_available_filename.  If the file being edited is overwritten, the affected
 * editing session will be reset.
 * @param session_ptr session to save
 * @param file_path file path to save to
 * @param io_flags save IO flags (see omega_io_flags_t for details)
 * @param saved_file_path if overwrite is not set and the target file_path exists, a new file path will be created, and if
 * this parameter is non-null, the saved file path will be copied here (must be able to accommodate FILENAME_MAX bytes)
 * @param offset save starting at this offset in the session
 * @param length save this many bytes from the given start offset
 * @return 0 on success, non-zero otherwise
 */
int omega_edit_save_segment(omega_session_t *session_ptr, const char *file_path, int io_flags, char *saved_file_path,
                            int64_t offset, int64_t length);

/**
 * Save the given session (the edited file) to the given file path.  If the save file already exists, it can be overwritten
 * if overwrite is non zero.  If the file exists and overwrite is zero, a new unique file name will be used as determined
 * by omega_util_available_filename.  If the file being edited is overwritten, the affected editing session will be reset.
 * @param session_ptr session to save
 * @param file_path file path to save to
 * @param io_flags save IO flags (see omega_io_flags_t for details)
 * @param saved_file_path if overwrite is not set and the target file_path exists, a new file path will be created, and if
 * this parameter is non-null, the saved file path will be copied here (must be able to accommodate FILENAME_MAX bytes)
 * @return 0 on success, non-zero otherwise
 */
int omega_edit_save(omega_session_t *session_ptr, const char *file_path, int io_flags, char *saved_file_path);

/** Save a complete session with an optional native overwrite guard. */
int omega_edit_save_with_options(omega_session_t *session_ptr, const char *file_path, int io_flags,
                                 char *saved_file_path, const omega_edit_save_options_t *options_ptr);

/**
 * Write a session byte range to an already-open file without publishing a save event.
 *
 * The caller owns `file_ptr` and is responsible for closing it. The file is flushed before this function returns.
 * The session model is not modified.
 *
 * @param session_ptr session to copy from
 * @param file_ptr already-open output file
 * @param offset starting byte offset in the session
 * @param length number of bytes to copy, or zero to copy from offset to the end of the session
 * @return zero on success and non-zero otherwise
 */
int omega_edit_save_segment_to_file(const omega_session_t *session_ptr, FILE *file_ptr, int64_t offset, int64_t length);

/**
 * Options for writing a session byte range to an already-open file.
 */
typedef struct {
    /** Flush stdio buffers only; skip the OS-level disk sync for short-lived temporary snapshots. */
    omega_edit_bool_t skip_disk_sync;
} omega_edit_save_segment_to_file_options_t;

/**
 * Write a session byte range to an already-open file without publishing a save event.
 *
 * The caller owns `file_ptr` and is responsible for closing it. The file's stdio buffers are flushed before this
 * function returns. Unless options_ptr is non-null and skip_disk_sync is true, the file is also synced to disk.
 * The session model is not modified.
 *
 * @param session_ptr session to copy from
 * @param file_ptr already-open output file
 * @param offset starting byte offset in the session
 * @param length number of bytes to copy, or zero to copy from offset to the end of the session
 * @param options_ptr optional write behavior controls
 * @return zero on success and non-zero otherwise
 */
int omega_edit_save_segment_to_file_with_options(const omega_session_t *session_ptr, FILE *file_ptr, int64_t offset,
                                                 int64_t length,
                                                 const omega_edit_save_segment_to_file_options_t *options_ptr);

/**
 * Copy a bounded session byte range into a newly allocated memory buffer.
 * @param session_ptr session to copy from
 * @param data_ptr_out receives a malloc-allocated buffer containing the copied bytes (caller must free).  The buffer is
 * null-terminated for convenience, but length_out reports the logical byte count.
 * @param length_out receives the number of copied bytes
 * @param offset starting byte offset in the session
 * @param length number of bytes to copy, or zero to copy from offset to the end of the session
 * @return 0 on success, non-zero otherwise. Requests larger than OMEGA_MEMORY_BUFFER_LIMIT fail; use
 * omega_edit_save_segment for large streaming exports.
 */
int omega_edit_save_segment_to_bytes(const omega_session_t *session_ptr, omega_byte_t **data_ptr_out,
                                     int64_t *length_out, int64_t offset, int64_t length);

/**
 * Copy the full computed session content into a newly allocated memory buffer when it is bounded.
 * @param session_ptr session to copy from
 * @param data_ptr_out receives a malloc-allocated buffer containing the copied bytes (caller must free).  The buffer is
 * null-terminated for convenience, but length_out reports the logical byte count.
 * @param length_out receives the number of copied bytes
 * @return 0 on success, non-zero otherwise. Large sessions fail instead of attempting an unbounded allocation; use
 * omega_edit_save for large streaming exports.
 */
int omega_edit_save_to_bytes(const omega_session_t *session_ptr, omega_byte_t **data_ptr_out, int64_t *length_out);

/**
 * Batch script operation kinds for sequential edit replay.
 */
typedef enum {
    OMEGA_EDIT_SCRIPT_DELETE = 1,
    OMEGA_EDIT_SCRIPT_INSERT = 2,
    OMEGA_EDIT_SCRIPT_OVERWRITE = 3,
    OMEGA_EDIT_SCRIPT_REPLACE = 4
} omega_edit_script_op_kind_t;

/**
 * A single edit script operation.
 *
 * Semantics by kind:
 * - DELETE: remove `length` bytes at `offset`; `bytes` and `bytes_length` are ignored
 * - INSERT: insert `bytes_length` bytes from `bytes` at `offset`; `length` should be 0
 * - OVERWRITE: overwrite `length` bytes at `offset` with `bytes_length` bytes from `bytes`
 *   (`length` and `bytes_length` should match when both are non-zero)
 * - REPLACE: replace `length` bytes at `offset` with `bytes_length` bytes from `bytes`
 */
typedef struct {
    int64_t offset;
    int64_t length;
    omega_edit_script_op_kind_t kind;
    const omega_byte_t *bytes;
    int64_t bytes_length;
} omega_edit_script_op_t;

/**
 * Built-in byte transform kinds.
 */
typedef enum {
    OMEGA_EDIT_TRANSFORM_ASCII_TO_UPPER = 1,
    OMEGA_EDIT_TRANSFORM_ASCII_TO_LOWER = 2,
    OMEGA_EDIT_TRANSFORM_BITWISE_AND = 3,
    OMEGA_EDIT_TRANSFORM_BITWISE_OR = 4,
    OMEGA_EDIT_TRANSFORM_BITWISE_XOR = 5
} omega_edit_transform_kind_t;

/**
 * A built-in byte transform description.
 *
 * `operand` is used by bitwise transform kinds and ignored by ASCII case transform kinds.
 */
typedef struct {
    omega_edit_transform_kind_t kind;
    omega_byte_t operand;
} omega_edit_transform_t;

/**
 * Delete a number of bytes at the given offset
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param length number of bytes to delete
 * @return positive change serial number on success, 0 when the request is rejected without error, or -1 for invalid
 * arguments
 */
int64_t omega_edit_delete(omega_session_t *session_ptr, int64_t offset, int64_t length);

/**
 * Insert a number of bytes at the given offset
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param bytes bytes to insert at the given offset
 * @param length explicit number of bytes to insert
 * @return positive change serial number on success, 0 for a no-op when length is 0 or when the request is rejected
 * without error, or -1 for invalid arguments
 * @warning This byte-oriented API never infers a length from strlen. Use omega_edit_insert for null-terminated C
 * strings. Passing length 0 is treated as a no-op.
 */
int64_t omega_edit_insert_bytes(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes,
                                int64_t length);

/**
 * Insert a C string at the given offset
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param cstr C string to insert at the given offset
 * @param length length of the C string to insert (if 0, strlen will be used to calculate the length of null-terminated
 * bytes)
 * @return positive change serial number on success, 0 when the request is rejected without error, or -1 for invalid
 * arguments
 * @warning This helper is for null-terminated text inputs. For binary data or buffers that may contain embedded nulls,
 * use omega_edit_insert_bytes and pass an explicit byte length.
 */
int64_t omega_edit_insert(omega_session_t *session_ptr, int64_t offset, const char *cstr, int64_t length);

/**
 * Insert a null-terminated C string at the given offset.
 *
 * This is the explicit inferred-length text variant. Binary callers should use omega_edit_insert_bytes.
 */
int64_t omega_edit_insert_cstring(omega_session_t *session_ptr, int64_t offset, const char *cstr);

/**
 * Overwrite bytes at the given offset with the given new bytes
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param bytes new bytes to overwrite the old bytes with
 * @param length explicit number of new bytes
 * @return positive change serial number on success, 0 for a no-op when length is 0 or when the request is rejected
 * without error, or -1 for invalid arguments
 * @warning This byte-oriented API never infers a length from strlen. Use omega_edit_overwrite for null-terminated C
 * strings. Passing length 0 is treated as a no-op.
 */
int64_t omega_edit_overwrite_bytes(omega_session_t *session_ptr, int64_t offset, const omega_byte_t *bytes,
                                   int64_t length);

/**
 * Overwrite bytes at the given offset with the given new C string
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param cstr new C string to overwrite the old bytes with
 * @param length length of the new C string (if 0, strlen will be used to calculate the length of null-terminated bytes)
 * @return positive change serial number on success, 0 when the request is rejected without error, or -1 for invalid
 * arguments
 * @warning This helper is for null-terminated text inputs. For binary data or buffers that may contain embedded nulls,
 * use omega_edit_overwrite_bytes and pass an explicit byte length.
 */
int64_t omega_edit_overwrite(omega_session_t *session_ptr, int64_t offset, const char *cstr, int64_t length);

/**
 * Overwrite bytes at the given offset with a null-terminated C string.
 *
 * This is the explicit inferred-length text variant. Binary callers should use omega_edit_overwrite_bytes.
 */
int64_t omega_edit_overwrite_cstring(omega_session_t *session_ptr, int64_t offset, const char *cstr);

/**
 * Replace a span of bytes at the given offset with a new byte sequence.
 *
 * If the delete and insert lengths match, this is lowered to a single overwrite. Otherwise it is
 * applied as a delete followed by an insert in one logical transaction. If the insert step fails
 * after a successful delete, the helper attempts to undo the delete before returning failure.
 *
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param delete_length number of original bytes to remove
 * @param bytes replacement bytes, or null if `insert_length` is zero
 * @param insert_length explicit number of replacement bytes to insert
 * @return positive change serial number on success; 0 if the request is rejected without error or
 * results in no change; -1 if the arguments are invalid (for example, `session_ptr` is null or
 * `bytes` is null while `insert_length` is greater than zero)
 */
int64_t omega_edit_replace_bytes(omega_session_t *session_ptr, int64_t offset, int64_t delete_length,
                                 const omega_byte_t *bytes, int64_t insert_length);

/**
 * Replace a span of bytes by streaming the resulting session into a new checkpoint.
 *
 * This avoids storing replacement bytes in memory-backed change history and is intended for large generated
 * replacements. Like other checkpoint operations, it promotes the newly written checkpoint as the active model.
 *
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param delete_length number of original bytes to remove
 * @param bytes replacement bytes, or null if `insert_length` is zero
 * @param insert_length explicit number of replacement bytes to insert
 * @return zero on success and non-zero otherwise
 */
int omega_edit_replace_bytes_checkpointed(omega_session_t *session_ptr, int64_t offset, int64_t delete_length,
                                          const omega_byte_t *bytes, int64_t insert_length);

/**
 * Materialize a transform result through a checkpoint-backed model and record a lightweight transform change.
 *
 * The replacement bytes are written into the checkpoint and are not retained in the change log. The returned serial
 * identifies a transform entry with the transform id, options JSON, affected range, replacement length, and computed
 * file sizes.
 *
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param delete_length number of original bytes to remove
 * @param bytes replacement bytes, or null if `insert_length` is zero
 * @param insert_length explicit number of replacement bytes to insert
 * @param transform_id stable transform identifier
 * @param options_json optional transform options JSON
 * @return positive transform change serial if successful, non-positive otherwise
 */
int64_t omega_edit_replace_bytes_as_transform(omega_session_t *session_ptr, int64_t offset, int64_t delete_length,
                                              const omega_byte_t *bytes, int64_t insert_length,
                                              const char *transform_id, const char *options_json);

/**
 * Replace a span of bytes at the given offset with a new C string.
 * @param session_ptr session to make the change in
 * @param offset location offset to make the change
 * @param delete_length number of original bytes to remove
 * @param cstr replacement C string, or null if `insert_length` is zero
 * @param insert_length length of the replacement string (if 0, strlen will be used for null-terminated text)
 * @return positive change serial number on success; 0 if the request is rejected without error or
 * results in no change; -1 if the arguments are invalid (for example, `session_ptr` is null,
 * a length is negative, or `cstr` is null while `insert_length` is greater than zero)
 */
int64_t omega_edit_replace(omega_session_t *session_ptr, int64_t offset, int64_t delete_length, const char *cstr,
                           int64_t insert_length);

/**
 * Replace a span of bytes at the given offset with a null-terminated C string.
 *
 * This is the explicit inferred-length text variant. Binary callers should use omega_edit_replace_bytes.
 */
int64_t omega_edit_replace_cstring(omega_session_t *session_ptr, int64_t offset, int64_t delete_length,
                                   const char *cstr);

/**
 * Options for replacing matches with named fields.
 */
typedef struct {
    omega_search_case_folding_t case_folding;
    omega_edit_bool_t is_reverse;
    int64_t offset;
    int64_t length;
    int64_t limit;
    omega_edit_bool_t front_to_back;
    omega_edit_bool_t overwrite_only;
    int64_t *replacement_count_out;
    int64_t *delete_count_out;
    int64_t *insert_count_out;
    int64_t *overwrite_count_out;
} omega_edit_replace_matches_options_t;

/**
 * Replace matching byte patterns inside a session range using in-place transactional edits.
 *
 * Matches are located against the original session content and replaced in one logical transaction. Matching is
 * non-overlapping: after a match is found, searching resumes immediately after the matched pattern bytes in the
 * original content. When `front_to_back` is non-zero, replacements are applied from the start of the range toward the
 * end with offset adjustments for prior replacements. When `front_to_back` is zero, replacements are applied from the
 * end toward the start so no offset adjustment is required.
 *
 * Each individual match is lowered through the same optimized edit shape used by higher-level clients: unchanged
 * prefix/suffix bytes are trimmed so a match may become an insert, delete, overwrite, or replace op depending on the
 * actual delta. When `overwrite_only` is non-zero, each match is applied as a raw overwrite of the replacement bytes
 * at the match offset without deleting any extra bytes from the matched pattern.
 *
 * @param session_ptr session to edit
 * @param pattern pattern bytes to search for
 * @param pattern_length explicit number of bytes in pattern
 * @param replacement replacement bytes, or null if `replacement_length` is zero
 * @param replacement_length explicit number of bytes in replacement
 * @param case_folding case folding mode; use OMEGA_SEARCH_CASE_FOLDING_NONE for exact byte matching
 * @param is_reverse zero to search forward and non-zero to search backward before applying replacements
 * @param offset starting byte offset of the replace range
 * @param length number of bytes in the replace range, or zero to search from `offset` to end of session
 * @param limit maximum number of matches to replace, or zero for no caller-specified limit. The transactional
 * replace path still refuses to materialize more than OMEGA_REPLACE_MATCHES_LIMIT selected matches, further bounded by
 * OMEGA_MEMORY_BUFFER_LIMIT; use omega_edit_replace_all_bytes for streamed large replace-all work.
 * @param front_to_back non-zero to apply replacements from low offsets to high offsets, zero for high-to-low
 * @param overwrite_only non-zero to overwrite replacement bytes in place instead of replacing the full matched span
 * @param replacement_count_out optional out-parameter that receives the number of matches selected for replacement
 * @param delete_count_out optional out-parameter that receives the number of lowered delete operations
 * @param insert_count_out optional out-parameter that receives the number of lowered insert operations
 * @param overwrite_count_out optional out-parameter that receives the number of lowered overwrite operations
 * @return zero on success and non-zero otherwise
 */
int omega_edit_replace_matches_bytes(omega_session_t *session_ptr, const omega_byte_t *pattern, int64_t pattern_length,
                                     const omega_byte_t *replacement, int64_t replacement_length,
                                     omega_search_case_folding_t case_folding, int is_reverse, int64_t offset,
                                     int64_t length, int64_t limit, int front_to_back, int overwrite_only,
                                     int64_t *replacement_count_out, int64_t *delete_count_out,
                                     int64_t *insert_count_out, int64_t *overwrite_count_out);

/**
 * Replace matching byte patterns using named options.
 * @param session_ptr session to edit
 * @param pattern pattern bytes to search for
 * @param pattern_length explicit number of bytes in pattern
 * @param replacement replacement bytes, or null if `replacement_length` is zero
 * @param replacement_length explicit number of bytes in replacement
 * @param options named replace options
 * @return zero on success and non-zero otherwise
 */
int omega_edit_replace_matches_bytes_with_options(omega_session_t *session_ptr, const omega_byte_t *pattern,
                                                  int64_t pattern_length, const omega_byte_t *replacement,
                                                  int64_t replacement_length,
                                                  const omega_edit_replace_matches_options_t *options);

/**
 * Replace matching C-string patterns inside a session range using in-place transactional edits.
 * @param session_ptr session to edit
 * @param pattern pattern C string to search for
 * @param pattern_length explicit pattern length (if 0, strlen will be used)
 * @param replacement replacement C string, or null if `replacement_length` is zero
 * @param replacement_length explicit replacement length (if 0, strlen will be used)
 * @param case_folding case folding mode; use OMEGA_SEARCH_CASE_FOLDING_NONE for exact byte matching
 * @param is_reverse zero to search forward and non-zero to search backward before applying replacements
 * @param offset starting byte offset of the replace range
 * @param length number of bytes in the replace range, or zero to search from `offset` to end of session
 * @param limit maximum number of matches to replace, or zero for no caller-specified limit. The transactional
 * replace path still refuses to materialize more than OMEGA_REPLACE_MATCHES_LIMIT selected matches, further bounded by
 * OMEGA_MEMORY_BUFFER_LIMIT; use omega_edit_replace_all for streamed large replace-all work.
 * @param front_to_back non-zero to apply replacements from low offsets to high offsets, zero for high-to-low
 * @param overwrite_only non-zero to overwrite replacement bytes in place instead of replacing the full matched span
 * @param replacement_count_out optional out-parameter that receives the number of matches selected for replacement
 * @param delete_count_out optional out-parameter that receives the number of lowered delete operations
 * @param insert_count_out optional out-parameter that receives the number of lowered insert operations
 * @param overwrite_count_out optional out-parameter that receives the number of lowered overwrite operations
 * @return zero on success and non-zero otherwise
 */
int omega_edit_replace_matches(omega_session_t *session_ptr, const char *pattern, int64_t pattern_length,
                               const char *replacement, int64_t replacement_length,
                               omega_search_case_folding_t case_folding, int is_reverse, int64_t offset, int64_t length,
                               int64_t limit, int front_to_back, int overwrite_only, int64_t *replacement_count_out,
                               int64_t *delete_count_out, int64_t *insert_count_out, int64_t *overwrite_count_out);

/**
 * Replace matching C-string patterns using named options.
 */
int omega_edit_replace_matches_with_options(omega_session_t *session_ptr, const char *pattern, int64_t pattern_length,
                                            const char *replacement, int64_t replacement_length,
                                            const omega_edit_replace_matches_options_t *options);

/**
 * Options for streamed replace-all operations.
 */
typedef struct {
    omega_search_case_folding_t case_folding;
    omega_edit_bool_t is_reverse;
    int64_t offset;
    int64_t length;
    int64_t *replacement_count_out;
} omega_edit_replace_all_options_t;

/**
 * Replace all non-overlapping matches of a byte pattern within a session range using a streamed checkpoint rewrite.
 *
 * The current session content is read once in forward order and rewritten into a new checkpoint file. Bytes outside the
 * target range are copied through unchanged; bytes inside the range are copied unchanged except where they match the
 * pattern, in which case the replacement bytes are written instead. Matching is performed against the original session
 * bytes, not against already-written replacement output.
 *
 * If no matches are found, the session is left unchanged and `replacement_count_out` receives 0. If matches are found,
 * the newly written checkpoint becomes the active model and the session emits the same checkpoint/transform notifications
 * used by omega_edit_apply_transform.
 *
 * @param session_ptr session to edit
 * @param pattern pattern bytes to search for
 * @param pattern_length explicit number of bytes in pattern
 * @param replacement replacement bytes, or null if `replacement_length` is zero
 * @param replacement_length explicit number of bytes in replacement
 * @param case_folding case folding mode; use OMEGA_SEARCH_CASE_FOLDING_NONE for exact byte matching
 * @param offset starting byte offset of the replace-all range
 * @param length number of bytes in the replace-all range, or zero to search from `offset` to end of session
 * @param replacement_count_out optional out-parameter that receives the number of replacements performed
 * @return zero on success and non-zero otherwise
 * @warning Matches are replaced in forward order and are non-overlapping. After a match is consumed, searching resumes
 * immediately after the matched bytes in the original session content.
 * @warning This byte-oriented API never infers a length from strlen. Use omega_edit_replace_all for null-terminated C
 * strings.
 */
int omega_edit_replace_all_bytes(omega_session_t *session_ptr, const omega_byte_t *pattern, int64_t pattern_length,
                                 const omega_byte_t *replacement, int64_t replacement_length,
                                 omega_search_case_folding_t case_folding, int64_t offset, int64_t length,
                                 int64_t *replacement_count_out);

/**
 * Replace all non-overlapping matches of a byte pattern using a streamed checkpoint rewrite and explicit search
 * direction.
 *
 * Forward replacement selects matches greedily from low offsets to high offsets. Reverse replacement selects matches
 * greedily from high offsets to low offsets, preserving reverse-search overlap semantics without materializing every
 * match offset.
 *
 * @param session_ptr session to edit
 * @param pattern pattern bytes to search for
 * @param pattern_length explicit number of bytes in pattern
 * @param replacement replacement bytes, or null if `replacement_length` is zero
 * @param replacement_length explicit number of bytes in replacement
 * @param case_folding case folding mode; use OMEGA_SEARCH_CASE_FOLDING_NONE for exact byte matching
 * @param is_reverse zero to select matches forward and non-zero to select matches backward
 * @param offset starting byte offset of the replace range
 * @param length number of bytes in the replace range, or zero to search from `offset` to end of session
 * @param replacement_count_out optional out-parameter that receives the number of replacements performed
 * @return zero on success and non-zero otherwise
 */
int omega_edit_replace_all_bytes_directional(omega_session_t *session_ptr, const omega_byte_t *pattern,
                                             int64_t pattern_length, const omega_byte_t *replacement,
                                             int64_t replacement_length, omega_search_case_folding_t case_folding,
                                             int is_reverse, int64_t offset, int64_t length,
                                             int64_t *replacement_count_out);

/**
 * Replace all non-overlapping matches of a byte pattern using named options.
 */
int omega_edit_replace_all_bytes_with_options(omega_session_t *session_ptr, const omega_byte_t *pattern,
                                              int64_t pattern_length, const omega_byte_t *replacement,
                                              int64_t replacement_length,
                                              const omega_edit_replace_all_options_t *options);

/**
 * Replace all non-overlapping matches of a C-string pattern within a session range using a streamed checkpoint rewrite.
 * @param session_ptr session to edit
 * @param pattern pattern C string to search for
 * @param pattern_length length of the pattern string (if 0, strlen will be used for null-terminated text)
 * @param replacement replacement C string, or null if `replacement_length` is zero
 * @param replacement_length length of the replacement string (if 0, strlen will be used for null-terminated text)
 * @param case_folding case folding mode; use OMEGA_SEARCH_CASE_FOLDING_NONE for exact byte matching
 * @param offset starting byte offset of the replace-all range
 * @param length number of bytes in the replace-all range, or zero to search from `offset` to end of session
 * @param replacement_count_out optional out-parameter that receives the number of replacements performed
 * @return zero on success and non-zero otherwise
 * @warning This helper is for null-terminated text inputs. For binary data or buffers that may contain embedded nulls,
 * use omega_edit_replace_all_bytes and pass explicit byte lengths.
 */
int omega_edit_replace_all(omega_session_t *session_ptr, const char *pattern, int64_t pattern_length,
                           const char *replacement, int64_t replacement_length,
                           omega_search_case_folding_t case_folding, int64_t offset, int64_t length,
                           int64_t *replacement_count_out);

/**
 * Replace all non-overlapping C-string matches using named options.
 */
int omega_edit_replace_all_with_options(omega_session_t *session_ptr, const char *pattern, int64_t pattern_length,
                                        const char *replacement, int64_t replacement_length,
                                        const omega_edit_replace_all_options_t *options);

/**
 * Replace all non-overlapping matches of a null-terminated C-string pattern with a null-terminated C string.
 *
 * This is the explicit inferred-length text variant. Binary callers should use omega_edit_replace_all_bytes.
 */
int omega_edit_replace_all_cstring(omega_session_t *session_ptr, const char *pattern, const char *replacement,
                                   omega_search_case_folding_t case_folding, int64_t offset, int64_t length,
                                   int64_t *replacement_count_out);

/**
 * Apply an array of edit script operations sequentially to the given session.
 *
 * Operations are applied in the order given. The function does not roll back already-applied
 * operations if a later operation fails; it simply stops and returns non-zero.
 *
 * @param session_ptr session to edit
 * @param ops array of edit operations
 * @param op_count number of operations in the array
 * @return zero on success and non-zero otherwise
 */
int omega_edit_apply_script(omega_session_t *session_ptr, const omega_edit_script_op_t *ops, size_t op_count);

/**
 * Checkpoint and apply a built-in transform to bytes starting at the given offset up to the given length.
 *
 * This is a stable C API layer for common transform operations that higher-level clients and services can expose
 * without requiring process-local callback functions. Use omega_edit_apply_transform for custom callback transforms.
 *
 * @param session_ptr session to transform
 * @param transform built-in transform descriptor
 * @param offset location offset to begin transforming bytes
 * @param length number of bytes from the given offset to transform, or zero to transform through the end of session
 * @return zero on success, non-zero otherwise
 */
int omega_edit_apply_builtin_transform(omega_session_t *session_ptr, omega_edit_transform_t transform, int64_t offset,
                                       int64_t length);

/**
 * Checkpoint and apply the given mask of the given mask type to the bytes starting at the given offset up to the given
 * length
 * @param session_ptr session to make the change in
 * @param transform byte transform to apply
 * @param user_data_ptr pointer to user data that will be sent through to the given transform
 * @param offset location offset to make the change
 * @param length the number of bytes from the given offset to apply the mask to
 * @return zero on success, non-zero otherwise
 */
int omega_edit_apply_transform(omega_session_t *session_ptr, omega_util_byte_transform_t transform, void *user_data_ptr,
                               int64_t offset, int64_t length);

/**
 * Creates a session checkpoint.
 * @param session_ptr session to checkpoint
 * @return zero on success, non-zero otherwise
 */
int omega_edit_create_checkpoint(omega_session_t *session_ptr);

/**
 * Destroys the last checkpoint created on the given session
 * @param session_ptr session to remove the checkpoint
 * @return zero on success, non-zero otherwise
 */
int omega_edit_destroy_last_checkpoint(omega_session_t *session_ptr);

/**
 * Moves the session to a checkpoint boundary without destroying later checkpoint models.
 *
 * Checkpoint zero is the original session snapshot. Later checkpoints remain available for a subsequent checkout
 * until a successful edit creates a new branch or omega_edit_discard_checkpoint_future is called.
 * @param session_ptr session to navigate
 * @param checkpoint_count checkpoint boundary to make active, from zero through the active plus future checkpoint count
 * @return zero on success, non-zero otherwise
 */
int omega_edit_checkout_checkpoint(omega_session_t *session_ptr, int64_t checkpoint_count);

/**
 * Permanently destroys all checkpoint models after the active checkpoint boundary.
 * @param session_ptr session whose future checkpoint branch should be discarded
 * @return number of discarded future checkpoints, or a negative value on error
 */
int64_t omega_edit_discard_checkpoint_future(omega_session_t *session_ptr);

/**
 * Restores the current session content to the most recent checkpoint snapshot.
 *
 * Unlike omega_edit_destroy_last_checkpoint, this keeps the checkpoint model in
 * place and discards only the edits made after that checkpoint snapshot.
 * @param session_ptr session to restore
 * @return zero on success, non-zero otherwise
 */
int omega_edit_restore_last_checkpoint(omega_session_t *session_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_EDIT_H
