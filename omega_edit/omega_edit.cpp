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

#include "omega_edit.h"
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

using namespace std;

// define DEBUG for debugging
#define DEBUG

#ifdef DEBUG

#include <cassert>
#include <iostream>

#define DBG(x) do{x}while(0)
#else
#define DBG(x)
#endif

//
// DATA STRUCTURES
//

struct author_t {
    session_t *session_ptr{};
    string name;
};

struct change_t {
    int64_t serial;
    int64_t computed_offset;
    int64_t num_bytes;
    uint8_t byte;
    const author_t *author_ptr;
};

int64_t get_change_computed_offset(const change_t *change_ptr) {
    return change_ptr->computed_offset;
}

int64_t get_change_num_bytes(const change_t *change_ptr) {
    return change_ptr->num_bytes;
}

int64_t get_change_serial(const change_t *change_ptr) {
    return change_ptr->serial;
}

const author_t *get_change_author(const change_t *change_ptr) {
    return change_ptr->author_ptr;
}

uint8_t get_change_byte(const change_t *change_ptr) {
    return change_ptr->byte;
}

struct viewport_t {
    const author_t *author_ptr{};
    int64_t capacity{};
    int64_t length{};
    int64_t computed_offset{};
    vector<uint8_t> data;
    uint8_t bit_offset{};
    viewport_on_change_cbk on_change_cbk = nullptr;
    void *user_data_ptr = nullptr;
};

const author_t *get_viewport_author(const viewport_t *viewport_ptr) {
    return viewport_ptr->author_ptr;
}

int64_t get_viewport_capacity(const viewport_t *viewport_ptr) {
    return viewport_ptr->capacity;
}

int64_t get_viewport_length(const viewport_t *viewport_ptr) {
    return viewport_ptr->length;
}

int64_t get_viewport_computed_offset(const viewport_t *viewport_ptr) {
    return viewport_ptr->computed_offset;
}

const uint8_t *get_viewport_data(const viewport_t *viewport_ptr) {
    return viewport_ptr->data.data();
}

void *get_viewport_user_data(const viewport_t *viewport_ptr) {
    return viewport_ptr->user_data_ptr;
}

uint8_t get_viewport_bit_offset(const viewport_t *viewport_ptr) {
    return viewport_ptr->bit_offset;
}

typedef vector<shared_ptr<author_t> > author_vector_t;
typedef vector<shared_ptr<viewport_t> > viewport_vector_t;
typedef vector<change_t> change_vector_t;

struct session_t {
    FILE *file_ptr{};
    int64_t serial{};
    int64_t computed_file_size{};
    author_vector_t authors;
    viewport_vector_t viewports;
    change_vector_t changes;
    vector<int64_t> changes_by_offset;
    int64_t viewport_max_capacity = DEFAULT_VIEWPORT_MAX_CAPACITY;
    session_on_change_cbk on_change_cbk = nullptr;
    void *user_data_ptr = nullptr;
};

//
// FUNCTIONS
//

int left_shift_buffer(uint8_t *buffer, int64_t len, uint8_t shift_left) {
    int rc = -1;
    if (shift_left > 0 && shift_left < 8) {
        uint8_t shift_right = 8 - shift_left;
        uint8_t mask = ((1 << shift_left) - 1) << shift_right;
        uint8_t bits1 = 0;
        for (auto i = len - 1; i >= 0; --i) {
            auto bits2 = buffer[i] & mask;
            buffer[i] <<= shift_left;
            buffer[i] |= bits1 >> shift_right;
            bits1 = bits2;
        }
        rc = 0;
    }
    return rc;
}

int right_shift_buffer(uint8_t *buffer, int64_t len, uint8_t shift_right) {
    int rc = -1;
    if (shift_right > 0 && shift_right < 8) {
        uint8_t shift_left = 8 - shift_right;
        uint8_t mask = (1 << shift_right) - 1;
        uint8_t bits1 = 0;
        for (auto i = len - 1; i >= 0; --i) {
            auto bits2 = buffer[i] & mask;
            buffer[i] >>= shift_right;
            buffer[i] |= bits1 << shift_left;
            bits1 = bits2;
        }
        rc = 0;
    }
    return rc;
}

session_t *create_session(FILE *file_ptr, int64_t viewport_max_capacity, session_on_change_cbk cbk, void *user_data_ptr) {
    session_t *pSession = nullptr;
    if (0 < viewport_max_capacity && 0 == fseek(file_ptr, 0L, SEEK_END)) {
        auto *session_ptr = new session_t;
        session_ptr->serial = 1;
        session_ptr->file_ptr = file_ptr;
        session_ptr->computed_file_size = ftell(file_ptr);
        session_ptr->viewport_max_capacity = viewport_max_capacity;
        session_ptr->on_change_cbk = cbk;
        session_ptr->user_data_ptr = user_data_ptr;
        pSession = session_ptr;
    }
    return pSession;
}

int64_t get_viewport_max_capacity(const session_t *session_ptr) {
    return session_ptr->viewport_max_capacity;
}

void * get_session_user_data(const session_t *session_ptr){
    return session_ptr->user_data_ptr;
}

const author_t *create_author(session_t *session_ptr, const char *author_name) {
    const author_t *pAuthor = nullptr;
    if (session_ptr) {
        auto author_ptr = shared_ptr<author_t>(new author_t);
        author_ptr->session_ptr = session_ptr;
        author_ptr->name.assign(author_name);
        session_ptr->authors.push_back(author_ptr);
        pAuthor = author_ptr.get();
    }
    return pAuthor;
}

const char *get_author_name(const author_t *author_ptr) {
    return author_ptr->name.c_str();
}

session_t *get_author_session(const author_t *author_ptr) {
    return author_ptr->session_ptr;
}

viewport_t *
add_viewport(const author_t *author_ptr, int64_t offset, int64_t capacity, viewport_on_change_cbk cbk, void *user_data_ptr,
             uint8_t bit_offset) {
    viewport_t *pViewport = nullptr;
    auto session_ptr = get_author_session(author_ptr);
    if (capacity > 0 and capacity <= get_viewport_max_capacity(session_ptr)) {
        auto viewport_ptr = shared_ptr<viewport_t>(new viewport_t);
        viewport_ptr->author_ptr = author_ptr;
        viewport_ptr->computed_offset = offset;
        viewport_ptr->capacity = capacity;
        viewport_ptr->length = 0;
        viewport_ptr->data.reserve(capacity);
        viewport_ptr->on_change_cbk = cbk;
        viewport_ptr->user_data_ptr = user_data_ptr;
        viewport_ptr->bit_offset = bit_offset;
        session_ptr->viewports.push_back(viewport_ptr);

        // Populate the viewport and call the on change callback
        read_segment_from_file(session_ptr->file_ptr, offset, viewport_ptr->data.data(),
                               viewport_ptr->capacity, &viewport_ptr->length);
        if (bit_offset > 0) {
            left_shift_buffer(viewport_ptr->data.data(), viewport_ptr->length, bit_offset);
        }
        (*viewport_ptr->on_change_cbk)(viewport_ptr.get(), nullptr);
        pViewport = viewport_ptr.get();
    }
    return pViewport;
}

int destroy_viewport(const viewport_t *viewport_ptr) {
    int rc = -1;
    viewport_vector_t *session_viewport_ptr = &viewport_ptr->author_ptr->session_ptr->viewports;
    for (auto iter = session_viewport_ptr->cbegin(); iter != session_viewport_ptr->cend(); ++iter) {
        if (viewport_ptr == iter->get()) {
            session_viewport_ptr->erase(iter);
            rc = 0;
            break;
        }
    }
    return rc;
}

int set_viewport(viewport_t *viewport_ptr, int64_t offset, int64_t capacity, uint8_t bit_offset) {
    int rc = 0;
    auto session_ptr = viewport_ptr->author_ptr->session_ptr;
    if (capacity > 0 && capacity <= get_viewport_max_capacity(session_ptr)) {
        // only change settings if they are different
        if (viewport_ptr->computed_offset != offset || viewport_ptr->capacity != capacity ||
            viewport_ptr->bit_offset != bit_offset) {
            viewport_ptr->computed_offset = offset;
            viewport_ptr->capacity = capacity;
            viewport_ptr->data.reserve(capacity);
            viewport_ptr->bit_offset = bit_offset;

            // Update viewport and call the on change callback
            read_segment_from_file(session_ptr->file_ptr, offset, viewport_ptr->data.data(),
                                   viewport_ptr->capacity, &viewport_ptr->length);
            if (bit_offset > 0) {
                left_shift_buffer(viewport_ptr->data.data(), viewport_ptr->length, bit_offset);
            }
            (*viewport_ptr->on_change_cbk)(viewport_ptr, nullptr);
        }
    } else {
        DBG(clog << "desired capacity less than 1 or greater than the viewport maximum capacity" << endl;);
        rc = -1;
    }
    return rc;
}

size_t num_viewports(const session_t *session_ptr) {
    return session_ptr->viewports.size();
}

// Internal function to add a change to the given session
int update_(const change_t *change_ptr) {
    int rc = 0;
    auto session_ptr = get_author_session(get_change_author(change_ptr));

    // Push this change onto the time-ordered vector of changes for the associated session
    session_ptr->changes.push_back(*change_ptr);
    
    // Determine where the change needs to go in the changes by offset vector
    auto insert_pos = session_ptr->changes_by_offset.cbegin();
    if (change_ptr->num_bytes != 0) {
        // If we're inserting bytes, bytes from the current offset on need to be adjusted
        while (insert_pos != session_ptr->changes_by_offset.cend() &&
               change_ptr->computed_offset > session_ptr->changes[*insert_pos].computed_offset) {
            ++insert_pos;
        }
        insert_pos = session_ptr->changes_by_offset.insert(insert_pos, change_ptr->serial);
        if (change_ptr->num_bytes > 0 && insert_pos != session_ptr->changes_by_offset.cend()) ++insert_pos;
    } else {
        // Overwrite
        while (insert_pos != session_ptr->changes_by_offset.cend() &&
               change_ptr->computed_offset >= session_ptr->changes[*insert_pos].computed_offset) {
            ++insert_pos;
        }
        insert_pos = session_ptr->changes_by_offset.insert(insert_pos, change_ptr->serial);
    }

    if (change_ptr->num_bytes != 0) {
        // Adjust the offsets by the number of bytes for all change offsets on and after this change for inserts and deletes
        for (; insert_pos != session_ptr->changes_by_offset.cend(); ++insert_pos) {
            session_ptr->changes[*insert_pos].computed_offset += change_ptr->num_bytes;
        }
        session_ptr->computed_file_size += change_ptr->num_bytes;
    }
    // TODO: update affected viewports and call their on change callbacks

    if (session_ptr->on_change_cbk) {
        session_ptr->on_change_cbk(session_ptr, change_ptr);
    }
    return rc;
}

// Add overwrite change
int ovr(const author_t *author_ptr, int64_t offset, uint8_t new_byte) {
    change_t change{};
    change.author_ptr = author_ptr;
    change.computed_offset = offset;
    change.byte = new_byte;
    change.num_bytes = 0;
    change.serial = author_ptr->session_ptr->serial++;

    DBG(clog << "'" << get_author_name(author_ptr) << "' overwriting with byte '" << new_byte << "' at offset "
             << offset << " serial " << change.serial << endl;);

    return update_(&change);
}

// Add delete change
int del(const author_t *author_ptr, int64_t offset, int64_t num_bytes) {
    change_t change{};
    change.author_ptr = author_ptr;
    change.computed_offset = offset;
    change.byte = 0;
    change.num_bytes = num_bytes * -1;  // negative for delete
    change.serial = author_ptr->session_ptr->serial++;

    DBG(clog << "'" << get_author_name(author_ptr) << "' deleting " << num_bytes << " bytes at offset " << offset
             << " serial " << change.serial << endl;);

    return update_(&change);
}

// Add insert change
int ins(const author_t *author_ptr, int64_t offset, int64_t num_bytes, uint8_t fill) {
    change_t change{};
    change.author_ptr = author_ptr;
    change.computed_offset = offset;
    change.byte = fill;
    change.num_bytes = num_bytes;  // positive for insert
    change.serial = author_ptr->session_ptr->serial++;

    DBG(clog << "'" << get_author_name(author_ptr) << "' inserting " << num_bytes << " of '" << fill
             << "' at offset " << offset << " serial " << change.serial << endl;);

    return update_(&change);
}

// Determine the computed offset given an original offset
int64_t offset_to_computed_offset(const session_t *session_ptr, int64_t offset) {
    for (auto iter(session_ptr->changes_by_offset.cbegin()); iter != session_ptr->changes_by_offset.cend(); ++iter) {
        offset += session_ptr->changes[*iter].num_bytes;
        if (session_ptr->changes[*iter].computed_offset <= offset) break;
    }
    return offset;
}

// Determine thr original offset given a computed offset
int64_t computed_offset_to_offset(const session_t *session_ptr, int64_t computed_offset) {
    for (auto iter(session_ptr->changes_by_offset.cbegin()); iter != session_ptr->changes_by_offset.cend(); ++iter) {
        if (session_ptr->changes[*iter].computed_offset <= computed_offset) break;
        computed_offset -= session_ptr->changes[*iter].num_bytes;
    }
    return computed_offset;
}

size_t num_changes(const session_t *session_ptr) {
    return session_ptr->changes.size();
}

size_t num_changes_by_author(const author_t *author_ptr) {
    size_t count = 0;
    for (const auto &change: author_ptr->session_ptr->changes) {
        if (change.author_ptr == author_ptr) {
            ++count;
        }
    }
    return count;
}

int read_segment_from_file(FILE *from_file_ptr, int64_t offset, uint8_t *buffer, int64_t capacity, int64_t *length) {
    int rc = -1;
    if (0 == fseek(from_file_ptr, 0, SEEK_END)) {
        auto len = ftell(from_file_ptr) - offset;
        // make sure the offset does not exceed the file size
        if (len > 0) {
            // the length is going to be equal to what's left of the file, or the buffer capacity, whichever is less
            *length = (len < capacity) ? len : capacity;
            if (0 == fseek(from_file_ptr, offset, SEEK_SET)) {
                if (0 == fread(buffer, 1, *length, from_file_ptr)) {
                    rc = 0; // successful read
                }
            }
        }
    }
    return rc;
}

// Write a segment of one file into another
int write_segment_to_file(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr) {
    int rc = 0;
    fseek(from_file_ptr, offset, SEEK_SET);
    const int64_t buff_size = 1024 * 8;
    uint8_t buff[buff_size];
    while (byte_count) {
        auto count = (buff_size > byte_count) ? byte_count : buff_size;
        fread(buff, 1, count, from_file_ptr);
        fwrite(buff, 1, count, to_file_ptr);
        byte_count -= count;
    }
    fflush(to_file_ptr);
    return rc;
}

// Save changes in the given session to the given file pointer
int save_to_file(const author_t *author_ptr, FILE *file_ptr) {
    int rc = 0;
    session_t *session_ptr = author_ptr->session_ptr;
    const int64_t write_file_start = ftell(file_ptr);
    // tip of the file we're writing to
    int64_t write_offset = 0;
    fseek(file_ptr, write_file_start + write_offset, SEEK_SET);

    // offset to read from original file
    auto read_offset = computed_offset_to_offset(session_ptr, write_offset);
    DBG(clog << "C-Off: " << read_offset << endl;);
    DBG(clog << "CFS: " << session_ptr->computed_file_size << endl;);

    //auto computed_file_size = session_ptr->computed_file_size;

    //write_segment(session_ptr->file_ptr, read_offset, computed_file_size, file_ptr);

    // TODO: Implement changeset playback
    for (auto iter(session_ptr->changes_by_offset.cbegin()); iter != session_ptr->changes_by_offset.cend(); ++iter) {
        // DEBUG - log the change information
        DBG(
                auto type = "OVR";
                if (session_ptr->changes[*iter].num_bytes > 0) type = "INS";
                else if (session_ptr->changes[*iter].num_bytes < 0) type = "DEL";
                DBG(clog << type << " offset: " << session_ptr->changes[*iter].computed_offset
                         << ", count: " << session_ptr->changes[*iter].num_bytes << ", byte: '"
                         << session_ptr->changes[*iter].byte << "', serial: " << *iter << endl;);
        );

        if (write_offset == session_ptr->changes[*iter].computed_offset) {
            if (session_ptr->changes[*iter].num_bytes < 0) {
                // delete writes nothing and sets the read offset up the number of bytes deleted
                // NOTE: num_bytes is negative, so subtracting moves the read offset up that number of bytes
                read_offset -= session_ptr->changes[*iter].num_bytes;
            } else if (session_ptr->changes[*iter].num_bytes > 0) {
                // insert writes out a number of bytes, but does not change the read offset
                for (int64_t i(0); i < session_ptr->changes[*iter].num_bytes; ++i) {
                    putc(session_ptr->changes[*iter].byte, file_ptr);
                }
                write_offset += session_ptr->changes[*iter].num_bytes;
            } else {
                // overwrite writes a single byte and moves the read offset up one byte
                putc(session_ptr->changes[*iter].byte, file_ptr);
                ++write_offset;
                ++read_offset;
            }
        }

        auto read_offset_start = read_offset;
        auto read_offset_end = session_ptr->changes[*iter].computed_offset;
        auto bytes_to_read_from_original = read_offset_end - read_offset_start;
        DBG(clog << "Bytes to read from original: " << bytes_to_read_from_original << endl;);
    }
    fflush(file_ptr);
    return rc;
}

int undo_last_change(const author_t *author_ptr) {
    int rc = -1;
    session_t *session_ptr = author_ptr->session_ptr;
    for (auto r_iter = session_ptr->changes.rbegin(); r_iter != session_ptr->changes.rend(); ++r_iter) {
        if (r_iter->author_ptr == author_ptr) {
            DBG(clog << "Undoing most recent change by '" << author_ptr->name << "'" << endl;);
            auto changes_by_pos_iter = find(session_ptr->changes_by_offset.begin(),
                                            session_ptr->changes_by_offset.end(), r_iter->serial);
            DBG(assert(changes_by_pos_iter != session_ptr->changes_by_offset.end()););
            if (r_iter->num_bytes != 0) {
                // Change is an insert or delete, so adjust computed offsets to the changes following this one
                for (auto iter(changes_by_pos_iter + 1); iter != session_ptr->changes_by_offset.end(); ++iter) {
                    session_ptr->changes[*iter].computed_offset -= r_iter->num_bytes;
                }
            }
            session_ptr->computed_file_size -= r_iter->num_bytes;
            session_ptr->changes_by_offset.erase(changes_by_pos_iter);
            if (session_ptr->on_change_cbk) {
                auto undone_change = *r_iter;
                session_ptr->changes.erase(std::next(r_iter).base());
                session_ptr->on_change_cbk(session_ptr, &undone_change);
            } else {
                session_ptr->changes.erase(std::next(r_iter).base());
            }
            rc = 0;
            break;
        }
    }
    return rc;
}

// Destroy the given session
void destroy_session(session_t *session_ptr) {
    delete session_ptr;
}

// Return the computed file size for the given session
int64_t get_computed_file_size(const session_t *session_ptr) {
    return session_ptr->computed_file_size;
}

////////// BEGIN EXPERIMENTAL
/*
 The objective here is to model the edits using segments.  Essentially creating a contiguous model of the file by
 keeping track of what to do.  The verbs here are READ, INSERT, and OVERWRITE.  We don't need to model DELETE because
 that is covered by adjusting, or removing, the READ, INSERT, and OVERWRITE segments accordingly.

 The model expects to take in changes with a current computed offset.  At this time it will also maintain it's own
 computed offsets, though it is likely that this can change in the future once we have a greater understanding of
 all the book keeping and where we can best centralize the offset computations.

 The model does not attempt to handle undo/redo at this time due to the complexity of the book keeping required.
 */

typedef enum {READ, INSERT, OVERWRITE} segment_kind_t;

// 8 bytes
union data_t {
    int64_t read_offset;
    const change_t * change_ptr;
};

struct segment_t {
    segment_kind_t segment_kind;
    int64_t serial;
    int64_t computed_offset;
    int64_t computed_length;
    data_t data;
};

struct model_t {
    FILE * read_fptr;
    vector<segment_t> segments;
};

void init_model_(model_t * model_ptr) {
    segment_t read_segment;

    // Model begins with a single READ segment spanning the original file
    read_segment.segment_kind = segment_kind_t::READ;
    read_segment.serial = 0;
    read_segment.computed_offset = 0;
    read_segment.data.read_offset = 0;
    fseek(model_ptr->read_fptr, 0, SEEK_END);
    read_segment.computed_length = ftell(model_ptr->read_fptr);

    model_ptr->segments.push_back(read_segment);
}

model_t * create_model(FILE * read_fptr) {
    auto model_ptr = new model_t;

    model_ptr->read_fptr = read_fptr;
    init_model_(model_ptr);
    return model_ptr;
}

// WIP
int update_model(model_t * model_ptr, const change_t * change_ptr) {
    int rc = -1;
    int64_t update_offset = change_ptr->computed_offset;
    int64_t read_offset = 0;

    for(auto iter = model_ptr->segments.begin(); iter != model_ptr->segments.end(); ++iter) {
        if (read_offset != iter->computed_offset) {
            DBG(clog << "break in continuity, expected: " << read_offset << ", got: " << iter->computed_offset << endl;);
            break;
        }
        if (read_offset >= update_offset) {
            if (read_offset != update_offset) {
                --iter;
                // This iter is going to be a read or insert
            } else {
                // This iter is going to be an overwrite
            }
            // Here we have the location to insert an updated segment
            if (0 == change_ptr->num_bytes) {
                // OVERWRITE
                segment_t overwrite_segment;
                overwrite_segment.segment_kind = segment_kind_t::OVERWRITE;
                overwrite_segment.serial = change_ptr->serial;
                overwrite_segment.computed_offset = change_ptr->computed_offset;
                overwrite_segment.data.change_ptr = change_ptr;
                // TODO: Finish this
            } else if (0 < change_ptr->num_bytes) {
                // INSERT
            } else {
                // DELETE
            }
            rc = 0;
            break;
        }
        switch(iter->segment_kind) {
            case segment_kind_t::READ: {
                read_offset += iter->computed_length;
                break;
            }
            case segment_kind_t::INSERT: {
                read_offset += iter->data.change_ptr->num_bytes;
                break;
            }
            case segment_kind_t::OVERWRITE: {
                ++read_offset;
                break;
            }
            default: abort();
        }
    }
    return rc;
}

// This function is done, but needs testing, documentation, and error handing
int populate_viewport(const model_t * model_ptr, viewport_t * viewport_ptr) {
    int rc = -1;
    int64_t viewport_offset = get_viewport_computed_offset(viewport_ptr);
    int64_t read_offset = 0;

    for(auto iter = model_ptr->segments.cbegin(); iter != model_ptr->segments.cend(); ++iter) {
        if (read_offset != iter->computed_offset) {
            DBG(clog << "break in continuity, expected: " << read_offset << ", got: " << iter->computed_offset << endl;);
            break;
        }
        if (read_offset >= viewport_offset) {
            viewport_ptr->data.clear();
            viewport_ptr->length = 0;
            int64_t delta = 0;
            if (read_offset != viewport_offset) {
                --iter;
                delta = viewport_ptr->computed_offset - iter->computed_offset;
            }
            do {
                switch(iter->segment_kind) {
                    case segment_kind_t::READ: {
                        auto amount = iter->computed_length - delta;
                        amount = (amount > viewport_ptr->capacity)?viewport_ptr->capacity:amount;
                        fread(viewport_ptr->data.data(), amount, 1, model_ptr->read_fptr);
                        viewport_ptr->length = amount;
                        break;
                    }
                    case segment_kind_t::INSERT: {
                        auto amount = iter->data.change_ptr->num_bytes - delta;
                        amount = (amount > viewport_ptr->capacity)?viewport_ptr->capacity:amount;
                        while(viewport_ptr->length < amount) {
                            viewport_ptr->data.data()[viewport_ptr->length++] = iter->data.change_ptr->byte;
                        }
                        break;
                    }
                    case segment_kind_t::OVERWRITE: {
                        viewport_ptr->data.data()[viewport_ptr->length++] = iter->data.change_ptr->byte;
                        break;
                    }
                    default: abort();
                }
            } while (viewport_ptr->length < viewport_ptr->capacity && ++iter != model_ptr->segments.end());
            rc = 0;
            break;
        }
        switch(iter->segment_kind) {
            case segment_kind_t::READ: {
                read_offset += iter->computed_length;
                break;
            }
            case segment_kind_t::INSERT: {
                read_offset += iter->data.change_ptr->num_bytes;
                break;
            }
            case segment_kind_t::OVERWRITE: {
                ++read_offset;
                break;
            }
            default: abort();
        }
    }

    return rc;
}

// This function is done, but needs testing, documentation, and error handing
int save_model_to_file(const model_t * model_ptr, FILE * write_fptr) {
    int rc = -1;
    int64_t write_offset = 0;
    for(auto iter = model_ptr->segments.cbegin(); iter != model_ptr->segments.cend(); ++iter) {
        if (write_offset != iter->computed_offset) {
            DBG(clog << "break in continuity, expected: " << write_offset << ", got: " << iter->computed_offset << endl;);
            break;
        }
        // TODO: Error handling
        switch(iter->segment_kind) {
            case segment_kind_t::READ: {
                write_segment_to_file(model_ptr->read_fptr, iter->data.read_offset, iter->computed_length, write_fptr);
                write_offset += iter->computed_length;
                break;
            }
            case segment_kind_t::INSERT: {
                auto count = iter->data.change_ptr->num_bytes;
                while(count--) {
                    fputc(iter->data.change_ptr->byte, write_fptr);
                }
                write_offset += iter->data.change_ptr->num_bytes;
                break;
            }
            case segment_kind_t::OVERWRITE: {
                fputc(iter->data.change_ptr->byte, write_fptr);
                ++write_offset;
                break;
            }
            default: abort();
        }
    }
    return rc;
}

////////// END EXPERIMENTAL
