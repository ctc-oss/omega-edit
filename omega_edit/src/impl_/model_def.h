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

#ifndef OMEGA_EDIT_MODEL_DEF_H
#define OMEGA_EDIT_MODEL_DEF_H

#include "internal_defs.h"
#include "model_segment_def.h"
#include <vector>

typedef std::shared_ptr<model_segment_t> model_segment_ptr_t;
typedef std::vector<model_segment_ptr_t> model_segments_t;

struct model_t {
    model_segments_t model_segments;
};

#endif//OMEGA_EDIT_MODEL_DEF_H
