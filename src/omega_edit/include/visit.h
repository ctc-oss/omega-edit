/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License");                                                    *
 * you may not use this file except in compliance with the License.                                                   *
 * You may obtain a copy of the License at                                                                            *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software                                                *
 * distributed under the License is distributed on an "AS IS" BASIS,                                                  *
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.                                           *
 * See the License for the specific language governing permissions and                                                *
 * limitations under the License.                                                                                     *
 **********************************************************************************************************************/

#ifndef OMEGA_EDIT_VISIT_H
#define OMEGA_EDIT_VISIT_H

#include "fwd_defs.h"

#ifdef __cplusplus
#include <cstddef>
#include <cstdint>
extern "C" {
#endif

/**
 * Opaque visit change context
 */
struct omega_visit_change_context_t;

/**
 * Create a change visitor context
 * @param session_ptr session to visit changes
 * @param reverse non-zero to reverse the visitation chronology (newest change to oldest change)
 * @return change visitor context
 */
omega_visit_change_context_t *omega_visit_change_create_context(const omega_session_t *session_ptr, int reverse = 0);

/**
 * Given a change visitor context, find the next change
 * @param change_context_ptr change visitor context to find the next change in
 * @return non-zero if a change is found, zero otherwise
 */
int omega_visit_change_next(omega_visit_change_context_t *change_context_ptr);

/**
 * Given a change visitor context, get a pointer to the change
 * @param change_context_ptr change visitor context to get the change from
 * @return pointer to the change, or nullptr if no change is found
 */
const omega_change_t *omega_visit_change_context_get_change(const omega_visit_change_context_t *change_context_ptr);

/**
 * Destroy the given change visitor context
 * @param change_context_ptr change visitor context to destroy
 */
void omega_visit_change_destroy_context(omega_visit_change_context_t *change_context_ptr);

#ifdef __cplusplus
}
#endif

#endif//OMEGA_EDIT_VISIT_H
