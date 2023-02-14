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
 * @file session.h
 * @brief Functions that operate on editing sessions (omega_session_t).
 */

#ifndef OMEGA_EDIT_SESSION_H
#define OMEGA_EDIT_SESSION_H

#include "byte.h"
#include "export.h"
#include "fwd_defs.h"

#ifdef __cplusplus
#include <cstddef>
#include <cstdint>
extern "C" {
#else
#include <stddef.h>
#include <stdint.h>
#endif

typedef int64_t omega_byte_frequency_profile_t[256];

/**
 * Given a session, return the file path being edited (if known)
 * @param session_ptr session to return the file path from
 * @return file path, or null if not known
 */
OMEGA_EDIT_EXPORT const char *omega_session_get_file_path(const omega_session_t *session_ptr);

/**
 * Given a session, return the session event callback
 * @param session_ptr session to return the event callback from
 * @return session event callback
 */
OMEGA_EDIT_EXPORT omega_session_event_cbk_t omega_session_get_event_cbk(const omega_session_t *session_ptr);

/**
 * Given a session, return the session event interest
 * @param session_ptr session to return the session event interest from
 * @return session event interest
 */
OMEGA_EDIT_EXPORT int32_t omega_session_get_event_interest(const omega_session_t *session_ptr);

/**
 * Set the session event interest to the given session event interest for the the given session
 * @param session_ptr session to set the session event interest for
 * @param event_interest desired session event interest
 * @return session event interest
 */
OMEGA_EDIT_EXPORT int32_t omega_session_set_event_interest(omega_session_t *session_ptr, int32_t event_interest);
/**
 * Given a session, return the associated user data
 * @param session_ptr session to get the associated user data from
 * @return associated user data for the given session
 */
OMEGA_EDIT_EXPORT void *omega_session_get_user_data_ptr(const omega_session_t *session_ptr);

/**
 * Given a session and offset, populate a data segment
 * @param session_ptr session to get a segment of data from
 * @param data_segment_ptr data segment to populate
 * @param offset session offset to begin getting data from
 * @return zero on success, non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_session_get_segment(const omega_session_t *session_ptr, omega_segment_t *data_segment_ptr,
                                                int64_t offset);

/**
 * Given a session, return the number of active viewports
 * @param session_ptr session to get the number of active viewports for
 * @return number of active viewports
 */
OMEGA_EDIT_EXPORT int64_t omega_session_get_num_viewports(const omega_session_t *session_ptr);

/**
 * Given a session, return the number of active search contexts
 * @param session_ptr session to get the number of active search contexts for
 * @return number of active search contexts
 */
OMEGA_EDIT_EXPORT int64_t omega_session_get_num_search_contexts(const omega_session_t *session_ptr);

/**
 * Given a session, return the current number of active changes
 * @param session_ptr session to get number of active changes from
 * @return number of active changes
 */
OMEGA_EDIT_EXPORT int64_t omega_session_get_num_changes(const omega_session_t *session_ptr);

/**
 * Given a session, return the current number of undone changes eligible for being redone
 * @param session_ptr session to get the number of undone changes for
 * @return number of undone changes eligible for being redone
 */
OMEGA_EDIT_EXPORT int64_t omega_session_get_num_undone_changes(const omega_session_t *session_ptr);

/**
 * Given a session, return the computed file size in bytes
 * @param session_ptr session to get the computed file size from
 * @return computed file size in bytes, or -1 on failure
 */
OMEGA_EDIT_EXPORT int64_t omega_session_get_computed_file_size(const omega_session_t *session_ptr);

/**
 * Given a session, get the last change (if any)
 * @param session_ptr session to get the last change from
 * @return last change, or nullptr if there are no changes
 */
OMEGA_EDIT_EXPORT const omega_change_t *omega_session_get_last_change(const omega_session_t *session_ptr);

/**
 * Given a session, get the last undone change eligible for redo (if any)
 * @param session_ptr session to get the last undone change eligible for redo from
 * @return last undone change eligible for redo, or nullptr if there are no eligible changes for redo
 */
OMEGA_EDIT_EXPORT const omega_change_t *omega_session_get_last_undo(const omega_session_t *session_ptr);

/**
 * Given a change serial, get the change
 * @param session_ptr session to which the change belongs
 * @param change_serial change serial of the change to get
 * @return change with the matching serial, or nullptr on failure
 */
OMEGA_EDIT_EXPORT const omega_change_t *omega_session_get_change(const omega_session_t *session_ptr,
                                                                 int64_t change_serial);

/**
 * Determine if the viewport on-change callbacks have been paused or not
 * @param session_ptr session to determine if viewport on-change callbacks are paused on
 * @return non-zero if viewport on-change callbacks are paused and zero if they are not
 */
OMEGA_EDIT_EXPORT int omega_session_viewport_event_callbacks_paused(const omega_session_t *session_ptr);

/**
 * Pause viewport on-change callbacks for the given session
 * @param session_ptr session to pause viewport on-change callbacks on
 */
OMEGA_EDIT_EXPORT void omega_session_pause_viewport_event_callbacks(omega_session_t *session_ptr);

/**
 * Resume viewport on-change callbacks for the given session
 * @param session_ptr session to resume viewport on-change callbacks on
 */
OMEGA_EDIT_EXPORT void omega_session_resume_viewport_event_callbacks(omega_session_t *session_ptr);

/**
 * Notify changed viewports in the given session with a VIEWPORT_EVT_CHANGES event
 * @param session_ptr session to notify viewports with changes
 * @return number of viewports that were notified, or -1 on failure
 */
OMEGA_EDIT_EXPORT int omega_session_notify_viewports_of_changes(const omega_session_t *session_ptr);

/**
 * Determine if the session is accepting changes or not
 * @param session_ptr session to determine if changes are accepted or not
 * @return non-zero if the session is accepting changes and zero if it is not
 */
OMEGA_EDIT_EXPORT int omega_session_changes_paused(const omega_session_t *session_ptr);

/**
 * Pause data changes to the session
 * @param session_ptr session to pause changes to
 */
OMEGA_EDIT_EXPORT void omega_session_pause_changes(omega_session_t *session_ptr);

/**
 * Resume data changes to the session
 * @param session_ptr session to resume changes to
 */
OMEGA_EDIT_EXPORT void omega_session_resume_changes(omega_session_t *session_ptr);

/**
 * Given a session, begin a transaction
 * @param session_ptr session to begin a transaction on
 * @return 0 on success, non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_session_begin_transaction(omega_session_t *session_ptr);

/**
 * Given a session, end a transaction
 * @param session_ptr session to end a transaction on
 * @return 0 on success, non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_session_end_transaction(omega_session_t *session_ptr);

/**
 * Given a session, return the current transaction state
 * @param session_ptr session to get the transaction state for
 * @return 0 for no transaction, 1 for transaction is opened, and 2 for transaction in progress, and -1 on failure
 */
OMEGA_EDIT_EXPORT int omega_session_get_transaction_state(const omega_session_t *session_ptr);

/**
 * Given a session, return the current number of session change transactions
 * @param session_ptr session to get the number of session change transactions for
 * @return number of session change transactions
 */
OMEGA_EDIT_EXPORT int64_t omega_session_get_num_change_transactions(const omega_session_t *session_ptr);

/**
 * Given a session, return the current number of session undone change transactions
 * @param session_ptr session to get the number of session undone change transactions for
 * @return number of session undone change transactions
 */
OMEGA_EDIT_EXPORT int64_t omega_session_get_num_undone_change_transactions(const omega_session_t *session_ptr);

/**
* Given a session, return the current number of session checkpoints
* @param session_ptr session to get the number of session checkpoints for
* @return number of session checkpoints
 */
OMEGA_EDIT_EXPORT int64_t omega_session_get_num_checkpoints(const omega_session_t *session_ptr);

/**
 * Call the registered session event handler
 * @param session_ptr session whose event handler to call
 * @param session_event session event
 * @param event_ptr pointer to the change
 */
OMEGA_EDIT_EXPORT void omega_session_notify(const omega_session_t *session_ptr, omega_session_event_t session_event,
                                            const void *event_ptr);

/**
 * Given a session, offset and length, populate a byte frequency profile
 * @param session_ptr session to profile
 * @param profile_ptr pointer to the byte frequency profile to populate
 * @param offset where in the session to begin profiling
 * @param length number of bytes from the offset to stop profiling (if 0, it will profile to the end of the session)
 * @return zero on success and non-zero otherwise
 */
OMEGA_EDIT_EXPORT int omega_session_profile(const omega_session_t *session_ptr,
                                            omega_byte_frequency_profile_t *profile_ptr, int64_t offset,
                                            int64_t length);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_SESSION_H
