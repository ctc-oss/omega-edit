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
 * @file fwd_defs.h
 * @brief Forward definitions.
 */

#ifndef OMEGA_EDIT_FWD_DEFS_H
#define OMEGA_EDIT_FWD_DEFS_H


#ifdef __cplusplus
extern "C" {
#endif

/** Enumeration of session events */
typedef enum {
    SESSION_EVT_UNDEFINED = 0,              //< No session event interest is defined
    SESSION_EVT_CREATE = 1,                 //< Occurs when the session has been successfully created
    SESSION_EVT_EDIT = 1 << 1,              //< Occurs when the session has successfully processed an edit
    SESSION_EVT_UNDO = 1 << 2,              //< Occurs when the session has successfully processed an undo
    SESSION_EVT_CLEAR = 1 << 3,             //< Occurs when the session has successfully processed a clear
    SESSION_EVT_TRANSFORM = 1 << 4,         //< Occurs when the session has successfully processed a transform
    SESSION_EVT_CREATE_CHECKPOINT = 1 << 5, //< Occurs when the session has successfully created a checkpoint
    SESSION_EVT_DESTROY_CHECKPOINT = 1 << 6,//< Occurs when the session has successfully destroyed a checkpoint
    SESSION_EVT_SAVE = 1 << 7,              //< Occurs when the session has been successfully saved to file
    SESSION_EVT_CHANGES_PAUSED = 1 << 8,    //< Occurs when session changes have been paused
    SESSION_EVT_CHANGES_RESUMED = 1 << 9,   //< Occurs when session changes have been resumed
    SESSION_EVT_CREATE_VIEWPORT = 1 << 10,  //< Occurs when the session has successfully created a viewport
    SESSION_EVT_DESTROY_VIEWPORT = 1 << 11  //< Occurs when the session has successfully destroyed a viewport
} omega_session_event_t;

/** Enumeration of viewport events */
typedef enum {
    VIEWPORT_EVT_UNDEFINED = 0,     //< No viewport event interest is defined
    VIEWPORT_EVT_CREATE = 1,        //< Occurs when the viewport has been successfully created
    VIEWPORT_EVT_EDIT = 1 << 1,     //< Occurs when an edit affects the viewport
    VIEWPORT_EVT_UNDO = 1 << 2,     //< Occurs when an undo affects the viewport
    VIEWPORT_EVT_CLEAR = 1 << 3,    //< Occurs when a clear affects the viewport
    VIEWPORT_EVT_TRANSFORM = 1 << 4,//< Occurs when a transform affects the viewport
    VIEWPORT_EVT_MODIFY = 1 << 5,   //< Occurs when the viewport itself has been modified
    VIEWPORT_EVT_CHANGES = 1 << 6   //< Occurs when the viewport has changes to its data from some other activity
} omega_viewport_event_t;

/** Subscribe to all events */
#define ALL_EVENTS (~0)

/** Subscribe to no events */
#define NO_EVENTS (0)

/** Enumeration of IO flags */
typedef enum {
    IO_FLG_NONE = 0,               //< No IO flags are defined
    IO_FLG_OVERWRITE = 1,          //< Overwrite original file, unless modified outside the session
    IO_FLG_FORCE_OVERWRITE = 1 << 1//< Force overwrite of original file, even if modified outside the session
} omega_io_flags_t;

/** Error code to indicate that the original session file has been modified since the session was created */
#define ORIGINAL_MODIFIED (-100)

/** Mask types */
typedef enum {
    MASK_AND, MASK_OR, MASK_XOR
} omega_mask_kind_t;

/** Byte order mark (BOM) types */
typedef enum {
    BOM_UNKNOWN = 0, BOM_NONE, BOM_UTF8, BOM_UTF16LE, BOM_UTF16BE, BOM_UTF32LE, BOM_UTF32BE
} omega_bom_t;

/** Opaque character counts */
typedef struct omega_character_counts_struct omega_character_counts_t;

/** Opaque change */
typedef struct omega_change_struct omega_change_t;

/** Opaque search context */
typedef struct omega_search_context_struct omega_search_context_t;

/** Opaque segment */
typedef struct omega_segment_struct omega_segment_t;

/** Opaque session */
typedef struct omega_session_struct omega_session_t;

/** Opaque viewport */
typedef struct omega_viewport_struct omega_viewport_t;

/** On session change callback.  This under-defined function will be called when a session event occurs. */
typedef void (*omega_session_event_cbk_t)(const omega_session_t *, omega_session_event_t, const void *);

/** On viewport change callback.  This under-defined function will be called when an associated viewport event occurs. */
typedef void (*omega_viewport_event_cbk_t)(const omega_viewport_t *, omega_viewport_event_t, const void *);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_FWD_DEFS_H
