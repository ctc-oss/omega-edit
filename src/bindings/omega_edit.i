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

/* clang-format off */

%module omega_edit

%{
/* Includes the header in the wrapper code */
#include "../../include/omega_edit.h"
#include "../../include/omega_edit/check.h"
#include "../../include/omega_edit/stl_string_adaptor.hpp"
%}

%include <stdint.i>
%include <std_string.i>

/* Parse the header file to generate wrappers */
%include "../../include/omega_edit/change.h"
%include "../../include/omega_edit/check.h"
%include "../../include/omega_edit/config.h"
%include "../../include/omega_edit/edit.h"
%include "../../include/omega_edit/license.h"
%include "../../include/omega_edit/search.h"
%include "../../include/omega_edit/session.h"
%include "../../include/omega_edit/stl_string_adaptor.hpp"
%include "../../include/omega_edit/version.h"
%include "../../include/omega_edit/viewport.h"
%include "../../include/omega_edit/visit.h"