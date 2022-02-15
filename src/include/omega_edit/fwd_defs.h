/**********************************************************************************************************************
 * Copyright (c) 2021-2022 Concurrent Technologies Corporation.                                                       *
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

#ifndef OMEGA_EDIT_FWD_DEFS_H
#define OMEGA_EDIT_FWD_DEFS_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Enumeration of session events
 */
typedef enum {
    SESSION_EVT_UNDEFINED = 0,
    SESSION_EVT_CREATE = 1,
    SESSION_EVT_EDIT = 2,
    SESSION_EVT_UNDO = 4,
    SESSION_EVT_CLEAR = 8,
    SESSION_EVT_TRANSFORM = 16,
    SESSION_EVT_CREATE_CHECKPOINT = 32,
    SESSION_EVT_DESTROY_CHECKPOINT = 64,
    SESSION_EVT_SAVE = 128
} omega_session_event_t;

/**
 * Enumeration of viewport events
 */
typedef enum {
    VIEWPORT_EVT_UNDEFINED = 0,
    VIEWPORT_EVT_CREATE = 1,
    VIEWPORT_EVT_EDIT = 2,
    VIEWPORT_EVT_UNDO = 4,
    VIEWPORT_EVT_CLEAR = 8,
    VIEWPORT_EVT_TRANSFORM = 16
} omega_viewport_event_t;

typedef struct omega_session_struct omega_session_t;
typedef struct omega_change_struct omega_change_t;
typedef struct omega_viewport_struct omega_viewport_t;

#ifdef __cplusplus
}
#endif

#endif  //OMEGA_EDIT_FWD_DEFS_H
