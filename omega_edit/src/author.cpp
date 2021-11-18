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

#include "../include/author.h"
#include "../include/session.h"
#include "impl_/author_def.h"
#include "impl_/change_def.h"
#include "impl_/internal_fun.h"
#include "impl_/model_segment_def.h"
#include "impl_/session_def.h"
#include <cstring>

const author_t *create_author(session_t *session_ptr, const char *author_name) {
    if (session_ptr) {
        for (const auto &author : session_ptr->authors) {
            if (author->name == author_name) { return author.get(); }
        }
        const auto author_ptr = std::shared_ptr<author_t>(new author_t);
        author_ptr->session_ptr = session_ptr;
        author_ptr->name.assign(author_name);
        session_ptr->authors.push_back(author_ptr);
        return author_ptr.get();
    }
    return nullptr;
}

const char *get_author_name(const author_t *author_ptr) { return author_ptr->name.c_str(); }

session_t *get_author_session(const author_t *author_ptr) { return author_ptr->session_ptr; }

size_t get_author_num_changes(const author_t *author_ptr) {
    size_t count = 0;
    for (const auto &change : author_ptr->session_ptr->changes) {
        if (change->author_ptr->name == author_ptr->name) { ++count; }
    }
    return count;
}

int del(const author_t *author_ptr, int64_t offset, int64_t length) {
    if (offset < get_computed_file_size(author_ptr->session_ptr)) {
        auto change_ptr = del_(author_ptr, offset, length);
        change_ptr->serial = ++author_ptr->session_ptr->serial;
        const_change_ptr_t const_change_ptr = change_ptr;
        return update_(const_change_ptr);
    }
    return -1;
}

static change_ptr_t ins_(const author_t *author_ptr, int64_t offset, const byte_t *bytes, int64_t length) {
    auto change_ptr = std::shared_ptr<change_t>(new change_t);
    change_ptr->author_ptr = author_ptr;
    change_ptr->serial = ++author_ptr->session_ptr->serial;
    change_ptr->kind = change_kind_t::CHANGE_INSERT;
    change_ptr->offset = offset;
    change_ptr->length = (length) ? length : static_cast<int64_t>(strlen((const char *) bytes));
    if (change_ptr->length < 8) {
        // small bytes optimization
        memcpy(change_ptr->data.sm_bytes, bytes, change_ptr->length);
        change_ptr->data.sm_bytes[change_ptr->length] = '\0';
    } else {
        change_ptr->data.bytes = std::make_unique<byte_t[]>(change_ptr->length + 1);
        memcpy(change_ptr->data.bytes.get(), bytes, change_ptr->length);
        change_ptr->data.bytes.get()[change_ptr->length] = '\0';
    }
    return change_ptr;
}

int ins(const author_t *author_ptr, int64_t offset, const byte_t *bytes, int64_t length) {
    if (offset <= get_computed_file_size(author_ptr->session_ptr)) {
        const_change_ptr_t const_change_ptr = ins_(author_ptr, offset, bytes, length);
        return update_(const_change_ptr);
    }
    return -1;
}

static change_ptr_t ovr_(const author_t *author_ptr, int64_t offset, const byte_t *bytes, int64_t length) {
    auto change_ptr = std::shared_ptr<change_t>(new change_t);
    change_ptr->author_ptr = author_ptr;
    change_ptr->serial = ++author_ptr->session_ptr->serial;
    change_ptr->kind = change_kind_t::CHANGE_OVERWRITE;
    change_ptr->offset = offset;
    change_ptr->length = (length) ? length : static_cast<int64_t>(strlen((const char *) bytes));
    if (change_ptr->length < 8) {
        // small bytes optimization
        memcpy(change_ptr->data.sm_bytes, bytes, change_ptr->length);
        change_ptr->data.sm_bytes[change_ptr->length] = '\0';
    } else {
        change_ptr->data.bytes = std::make_unique<byte_t[]>(change_ptr->length + 1);
        memcpy(change_ptr->data.bytes.get(), bytes, change_ptr->length);
        change_ptr->data.bytes.get()[change_ptr->length] = '\0';
    }
    return change_ptr;
}

int ovr(const author_t *author_ptr, int64_t offset, const byte_t *bytes, int64_t length) {
    if (offset < get_computed_file_size(author_ptr->session_ptr)) {
        const_change_ptr_t const_change_ptr = ovr_(author_ptr, offset, bytes, length);
        return update_(const_change_ptr);
    }
    return -1;
}
