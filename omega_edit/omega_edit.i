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

/* clang-format off */

%module omega_edit
%{
/* Includes the header in the wrapper code */
#include "omega_edit.h"int64_t get_change_bytes(const change_t *change_ptr, const byte_t **bytes)

%}
/* Parse the header file to generate wrappers */
%include "omega_edit.h"
