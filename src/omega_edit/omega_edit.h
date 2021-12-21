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

#ifndef OMEGA_OMEGA_EDIT_H
#define OMEGA_OMEGA_EDIT_H

/**
 * At the heart of Omega Edit, is the file editing session (session_t) which manages everything concerning the editing
 * of a given file.  Once a session is created, it needs to have one or more authors (author_t).  Each author can create
 * a series of changes (change_t) and can have a series of viewports (viewport_t).  Any changes that affect viewports in
 * the associated session will be kept up-to-date and when a viewport is changed, a user-defined callback function will
 * be called with the updated viewport and the change that triggered the update.
 */

#include "include/change.h"
#include "include/edit.h"
#include "include/license.h"
#include "include/match.h"
#include "include/session.h"
#include "include/viewport.h"
#include "include/visit.h"

#endif//OMEGA_OMEGA_EDIT_H
