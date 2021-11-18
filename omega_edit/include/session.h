//
// Created by Shearer, Davin on 11/17/21.
//

#ifndef OMEGA_EDIT_SESSION_H
#define OMEGA_EDIT_SESSION_H

#include "byte.h"
#include "config.h"
#include "fwd_defs.h"
#include <cstdint>
#include <cstdio>

/** On session change callback.  This under-defined function will be called when an associated session changes. */
typedef void (*session_on_change_cbk_t)(const session_t *, const change_t *);

/** Callback to implement for visiting changes in a session.
 * Return 0 to continue visiting changes and non-zero to stop.*/
typedef int (*visit_changes_cbk_t)(const change_t *, void *);

/** Callback to implement when pattern matches are found in a session.
 * Return 0 to continue matching and non-zero to stop.*/
typedef int (*pattern_match_found_cbk_t)(int64_t match_offset, int64_t match_length, void *user_data);

/**
 * Create a file editing session
 * @param file_ptr file, opened for read, to create an editing session with, or nullptr if we're starting from scratch
 * @param session_on_change_cbk user-defined callback function called whenever a content affecting change is made to this session
 * @param user_data_ptr pointer to user-defined data to associate with this session
 * @param viewport_max_capacity maximum allowed viewport capacity for this session
 * @param offset offset to start editing from, 0 (default) is the beginning of the file
 * @param length amount of the file from the offset to edit, 0 (default) is the length of the file
* @return pointer to the created session, nullptr on failure
 */
session_t *create_session(FILE *file_ptr, session_on_change_cbk_t cbk = nullptr, void *user_data_ptr = nullptr,
                          int64_t viewport_max_capacity = DEFAULT_VIEWPORT_MAX_CAPACITY, int64_t offset = 0,
                          int64_t length = 0);

/**
 * Given a session, return the maximum viewport capacity
 * @param session_ptr session to get the maximum viewport capacity from
 * @return maximum viewport capacity for the given session
 */
int64_t get_session_viewport_max_capacity(const session_t *session_ptr);

/**
 * Given a session, return the associated user data
 * @param session_ptr session to get the associated user data from
 * @return associated user data for the given session
 */
void *get_session_user_data(const session_t *session_ptr);

/**
 * Visit changes in the given session, if the callback returns an integer other than 0, visitation will stop and the
 * return value of the callback will be this function's return value
 * @param session_ptr session to visit changes
 * @param cbk user-provided function to call
 * @param user_data user-provided data to provide back to the callback
 * @return 0 if all changes were visited or the return value of the callback if visitation was stopped
 */
int visit_changes(const session_t *session_ptr, visit_changes_cbk_t cbk, void *user_data);

/**
 * Given a session, return the current number of active changes
 * @param session_ptr session to get number of active changes from
 * @return number of active changes
 */
size_t get_session_num_changes(const session_t *session_ptr);

/**
 * Given a session, return the current number of undone changes eligible for being redone
 * @param session_ptr session to get the number of undone changes for
 * @return number of undone changes eligible for being redone
 */
size_t get_session_num_undone_changes(const session_t *session_ptr);

/**
 * Given a session, return the offset
 * @param session_ptr session to get offset from
 * @return offset
 */
int64_t get_session_offset(const session_t *session_ptr);

/**
 * Given a session, return the length
 * @param session_ptr session to get length from
 * @return length
 */
int64_t get_session_length(const session_t *session_ptr);

/**
 * Given a session, return the number of active viewports
 * @param session_ptr session to get the number of active viewports for
 * @return number of active viewports
 */
size_t get_session_num_viewports(const session_t *session_ptr);

/**
 * Given a session, return the computed file size in bytes
 * @param session_ptr session to get the computed file size from
 * @return computed file size in bytes, or -1 on failure
 */
int64_t get_computed_file_size(const session_t *session_ptr);

/**
 * Given a session, get the last change (if any)
 * @param session_ptr session to get the last change from
 * @return last change, or nullptr if there are no changes
 */
const change_t *get_last_change(const session_t *session_ptr);

/**
 * Given a session, get the last undone change eligible for redo (if any)
 * @param session_ptr session to get the last undone change eligible for redo from
 * @return last undone change eligible for redo
 */
const change_t *get_last_undo(const session_t *session_ptr);

/**
 * Given a session, undo the last change
 * @param session_ptr session to undo the last change for
 * @return 0 on success, non-zero otherwise
 */
int undo_last_change(session_t *session_ptr);

/**
 * Redoes the last undo (if available)
 * @param session_ptr session to redo the last undo for
 * @return 0 if an undo is available to be redone and it does so successfully, non-zero otherwise
 */
int redo_last_undo(session_t *session_ptr);

/**
 * Save the given session to the given file
 * @param session_ptr session to save
 * @param file_ptr file (open for write) to save to
 * @return 0 on success, non-zero otherwise
 */
int save_to_file(const session_t *session_ptr, FILE *file_ptr);

/**
 * Given a session, find needles and call the match found callback as needles are found
 * @param session_ptr session to find the needles in
 * @param needle pointer to the needle to find
 * @param needle_length length of the needle
 * @param cbk the callback to call as needles are found in the session
 * @param user_data user data to send back into the callback
 * @param session_offset start searching at this offset within the session
 * @param session_length search from the starting offset within the session up to this many bytes
 * @return 0 if all needles have been found, or the non-zero return from the user callback
 */
int session_search(const session_t *session_ptr, const byte_t *needle, int64_t needle_length,
                   pattern_match_found_cbk_t cbk, void *user_data = nullptr, int64_t session_offset = 0,
                   int64_t session_length = 0);

/**
 * Checks the internal session model for errors
 * @param session_ptr session whose model to check for errors
 * @return 0 if the model is error free and non-zero otherwise
 */
int check_session_model(const session_t *session_ptr);

/**
 * Destroy the given session and all associated objects (authors, changes, and viewports)
 * @param session_ptr session to destroy
 */
void destroy_session(const session_t *session_ptr);

#endif//OMEGA_EDIT_SESSION_H
