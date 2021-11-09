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
#include "omega_util.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

using namespace std;

/***********************************************************************************************************************
 * MACROS
 **********************************************************************************************************************/
#define SOURCE_FILENAME (strrchr(__FILE__, '/') ? strrchr(__FILE__, '/') + 1 : __FILE__)
#define LOCATION SOURCE_FILENAME << "@" << __LINE__ << "::" << __FUNCTION__ << ":"
#define CLOG clog
#define ABORT(x)                                                                                                       \
    do { x abort(); } while (0)

/***********************************************************************************************************************
 * DATA STRUCTURES
 **********************************************************************************************************************/
struct author_t {
    string name;             ///< Name of the author
    session_t *session_ptr{};///< Session associated with this author
};
typedef shared_ptr<author_t> author_ptr_t;

enum class change_kind_t { CHANGE_DELETE, CHANGE_INSERT, CHANGE_OVERWRITE };

struct change_t {
    const author_t *author_ptr = nullptr;///< Author of the change
    int64_t serial{};                    ///< Serial number of the change (increasing)
    int64_t offset{};                    ///< Offset at the time of the change
    int64_t length{};                    ///< Number of bytes at the time of the change
    uint8_t byte{};                      ///< Overwrite or insert fill byte value
};
typedef shared_ptr<change_t> change_ptr_t;

struct viewport_t {
    const author_t *author_ptr = nullptr;///< Author who owns this viewport instance
    int64_t capacity{};                  ///< Data capacity (in bytes) of this viewport
    int64_t length{};                    ///< Populated data length (in bytes) of this viewport
    int64_t computed_offset{};           ///< Viewport offset as changes have been made
    vector<uint8_t> data;                ///< Data in the viewport
    uint8_t bit_offset{};                ///< Bit offset between 0 and 7 (inclusive) for this viewport (bit-shift left)
    viewport_on_change_cbk on_change_cbk = nullptr;///< User callback when the viewport changes
    void *user_data_ptr = nullptr;                 ///< Pointer to user-provided data associated with this viewport
};
typedef shared_ptr<viewport_t> viewport_ptr_t;

enum class segment_kind_t { SEGMENT_READ, SEGMENT_INSERT, SEGMENT_OVERWRITE };

struct segment_t {
    segment_kind_t segment_kind = segment_kind_t::SEGMENT_READ;
    int64_t computed_offset{};///< computed offset can differ from the change because segments can be split
    int64_t computed_length{};///< computed length can differ from the change because segments can be split
    change_ptr_t change_ptr;
};
typedef shared_ptr<segment_t> segment_ptr_t;

struct model_t {
    vector<segment_ptr_t> segments;
};

typedef vector<author_ptr_t> author_vector_t;
typedef vector<viewport_ptr_t> viewport_vector_t;
typedef vector<change_ptr_t> change_vector_t;

struct session_t {
    FILE *file_ptr{};                             ///< File being edited (open for read)
    int64_t serial{};                             ///< Incremented for every change
    author_vector_t authors;                      ///< Collection of authors in this session
    viewport_vector_t viewports;                  ///< Collection of viewports in this session
    change_vector_t changes_by_time;              ///< Collection of changes for this session, ordered by time
    int64_t viewport_max_capacity{};              ///< Maximum capacity of a viewport for this session
    session_on_change_cbk on_change_cbk = nullptr;///< User defined callback called when the session gets a change
    void *user_data_ptr = nullptr;                ///< Pointer to user-provided data associated with this session
    model_t model;                                ///< Edit model
    int64_t offset;
    int64_t length;
};

/***********************************************************************************************************************
 * INTERNAL FUNCTION DECLARATIONS
 **********************************************************************************************************************/
static void viewport_callback_(viewport_t *viewport_ptr, const change_t *change_ptr);

static int populate_viewport_(viewport_t *viewport_ptr);

static void initialize_model_(session_t *session_ptr);

static int update_viewports_(session_t *session_ptr, const change_t *change_ptr);

static change_kind_t get_change_kind_(const change_t *change_ptr);

static segment_kind_t get_segment_kind_(const segment_t *segment_ptr);

static change_ptr_t duplicate_change_(const change_ptr_t &change_ptr);

static segment_ptr_t duplicate_segment_(const segment_ptr_t &segment_ptr);

static int update_model_(session_t *session_ptr, const change_ptr_t &change_ptr);

static int update_(const change_ptr_t &change_ptr);

/***********************************************************************************************************************
 * AUTHOR FUNCTIONS
 **********************************************************************************************************************/
const char *get_author_name(const author_t *author_ptr) { return author_ptr->name.c_str(); }

session_t *get_author_session(const author_t *author_ptr) { return author_ptr->session_ptr; }

size_t get_author_num_changes(const author_t *author_ptr) {
    size_t count = 0;
    for (const auto &change : author_ptr->session_ptr->changes_by_time) {
        if (change->author_ptr->name == author_ptr->name) { ++count; }
    }
    return count;
}

const author_t *create_author(session_t *session_ptr, const char *author_name) {
    if (session_ptr) {
        for (const auto &author : session_ptr->authors) {
            if (author->name == author_name) { return author.get(); }
        }
        const auto author_ptr = shared_ptr<author_t>(new author_t);
        author_ptr->session_ptr = session_ptr;
        author_ptr->name.assign(author_name);
        session_ptr->authors.push_back(author_ptr);
        return author_ptr.get();
    }
    return nullptr;
}

/***********************************************************************************************************************
 * CHANGE FUNCTIONS
 **********************************************************************************************************************/
int64_t get_change_offset(const change_t *change_ptr) { return change_ptr->offset; }

int64_t get_change_length(const change_t *change_ptr) { return change_ptr->length; }

int64_t get_change_serial(const change_t *change_ptr) { return change_ptr->serial; }

uint8_t get_change_byte(const change_t *change_ptr) { return change_ptr->byte; }

char get_change_kind_as_char(const change_t *change_ptr) {
    switch (get_change_kind_(change_ptr)) {
        case change_kind_t::CHANGE_DELETE:
            return 'D';
        case change_kind_t::CHANGE_INSERT:
            return 'I';
        case change_kind_t::CHANGE_OVERWRITE:
            return 'O';
        default:
            ABORT(CLOG << LOCATION << " Unhandled change kind" << endl;);
    }
}

const author_t *get_change_author(const change_t *change_ptr) { return change_ptr->author_ptr; }

int ovr(const author_t *author_ptr, int64_t offset, uint8_t new_byte) {
    const auto change_ptr = shared_ptr<change_t>(new change_t);
    change_ptr->author_ptr = author_ptr;
    change_ptr->offset = offset;
    change_ptr->length = 0;
    change_ptr->byte = new_byte;
    change_ptr->serial = ++author_ptr->session_ptr->serial;
    return update_(change_ptr);
}

int del(const author_t *author_ptr, int64_t offset, int64_t length) {
    const auto change_ptr = shared_ptr<change_t>(new change_t);
    change_ptr->author_ptr = author_ptr;
    change_ptr->offset = offset;
    change_ptr->byte = 0;
    change_ptr->length = length * -1;// negative for delete
    change_ptr->serial = ++author_ptr->session_ptr->serial;
    return update_(change_ptr);
}

int ins(const author_t *author_ptr, int64_t offset, int64_t length, uint8_t fill) {
    const auto change_ptr = shared_ptr<change_t>(new change_t);
    change_ptr->author_ptr = author_ptr;
    change_ptr->offset = offset;
    change_ptr->byte = fill;
    change_ptr->length = length;// positive for insert
    change_ptr->serial = ++author_ptr->session_ptr->serial;
    return update_(change_ptr);
}

int undo_last_change(const author_t *author_ptr) {
    const auto session_ptr = author_ptr->session_ptr;

    if (!session_ptr->changes_by_time.empty()) {
        // Grab the change that is about to be undone
        const auto change_ptr = session_ptr->changes_by_time.back();

        // Remove the last change from the changes by time vector
        session_ptr->changes_by_time.pop_back();

        // Initialize the model and replay the changes
        initialize_model_(session_ptr);

        for (auto iter = session_ptr->changes_by_time.begin(); iter != session_ptr->changes_by_time.end(); ++iter) {
            if (update_model_(session_ptr, *iter) != 0) { return -1; }
        }

        // Negate the undone change's serial number to indicate that the change has been undone
        change_ptr->serial *= -1;

        if (session_ptr->on_change_cbk) { session_ptr->on_change_cbk(session_ptr, change_ptr.get()); }
        return 0;
    }
    return -1;
}

/***********************************************************************************************************************
 * VIEWPORT FUNCTIONS
 **********************************************************************************************************************/
const author_t *get_viewport_author(const viewport_t *viewport_ptr) { return viewport_ptr->author_ptr; }

int64_t get_viewport_capacity(const viewport_t *viewport_ptr) { return viewport_ptr->capacity; }

int64_t get_viewport_length(const viewport_t *viewport_ptr) { return viewport_ptr->length; }

int64_t get_viewport_computed_offset(const viewport_t *viewport_ptr) { return viewport_ptr->computed_offset; }

const uint8_t *get_viewport_data(const viewport_t *viewport_ptr) { return viewport_ptr->data.data(); }

void *get_viewport_user_data(const viewport_t *viewport_ptr) { return viewport_ptr->user_data_ptr; }

uint8_t get_viewport_bit_offset(const viewport_t *viewport_ptr) { return viewport_ptr->bit_offset; }

viewport_t *create_viewport(const author_t *author_ptr, int64_t offset, int64_t capacity, viewport_on_change_cbk cbk,
                            void *user_data_ptr, uint8_t bit_offset) {
    const auto session_ptr = author_ptr->session_ptr;
    if (capacity > 0 and capacity <= get_session_viewport_max_capacity(session_ptr)) {
        const auto viewport_ptr = shared_ptr<viewport_t>(new viewport_t);
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
        populate_viewport_(viewport_ptr.get());
        viewport_callback_(viewport_ptr.get(), nullptr);

        return viewport_ptr.get();
    }
    return nullptr;
}

int destroy_viewport(const viewport_t *viewport_ptr) {
    const auto session_viewport_ptr = &viewport_ptr->author_ptr->session_ptr->viewports;
    for (auto iter = session_viewport_ptr->cbegin(); iter != session_viewport_ptr->cend(); ++iter) {
        if (viewport_ptr == iter->get()) {
            session_viewport_ptr->erase(iter);
            return 0;
        }
    }
    return -1;
}

int update_viewport(viewport_t *viewport_ptr, int64_t offset, int64_t capacity, uint8_t bit_offset) {
    const auto session_ptr = viewport_ptr->author_ptr->session_ptr;
    if (capacity > 0 && capacity <= get_session_viewport_max_capacity(session_ptr)) {
        // only change settings if they are different
        if (viewport_ptr->computed_offset != offset || viewport_ptr->capacity != capacity ||
            viewport_ptr->bit_offset != bit_offset) {
            viewport_ptr->computed_offset = offset;
            viewport_ptr->capacity = capacity;
            viewport_ptr->data.reserve(capacity);
            viewport_ptr->bit_offset = bit_offset;

            // Update viewport and call the on change callback
            populate_viewport_(viewport_ptr);
            viewport_callback_(viewport_ptr, nullptr);
        }
        return 0;
    }
    return -1;
}

/***********************************************************************************************************************
 * SESSION FUNCTIONS
 **********************************************************************************************************************/
int64_t get_computed_file_size(const session_t *session_ptr) {
    return (session_ptr->model.segments.empty()) ? 0
                                                 : session_ptr->model.segments.back()->computed_offset +
                                                           session_ptr->model.segments.back()->computed_length;
}

int64_t get_session_viewport_max_capacity(const session_t *session_ptr) { return session_ptr->viewport_max_capacity; }

void *get_session_user_data(const session_t *session_ptr) { return session_ptr->user_data_ptr; }

size_t get_session_num_viewports(const session_t *session_ptr) { return session_ptr->viewports.size(); }

size_t get_session_num_changes(const session_t *session_ptr) { return session_ptr->changes_by_time.size(); }

int64_t get_session_offset(const session_t *session_ptr) { return session_ptr->offset; }

int64_t get_session_length(const session_t *session_ptr) { return session_ptr->length; }

session_t *create_session(FILE *file_ptr, session_on_change_cbk cbk, void *user_data_ptr, int64_t viewport_max_capacity,
                          int64_t offset, int64_t length) {
    if (0 < viewport_max_capacity && 0 == fseeko(file_ptr, 0L, SEEK_END)) {
        const auto file_size = ftello(file_ptr);
        if (0 <= file_size && offset + length <= file_size) {
            const auto session_ptr = new session_t;

            session_ptr->serial = 0;
            session_ptr->file_ptr = file_ptr;
            session_ptr->viewport_max_capacity = viewport_max_capacity;
            session_ptr->on_change_cbk = cbk;
            session_ptr->user_data_ptr = user_data_ptr;
            session_ptr->offset = offset;
            session_ptr->length = (length) ? length : file_size;

            initialize_model_(session_ptr);

            return session_ptr;
        }
    }
    return nullptr;
}

// Destroy the given session
void destroy_session(const session_t *session_ptr) { delete session_ptr; }

int save_to_file(const session_t *session_ptr, FILE *write_fptr) {
    int64_t write_offset = 0;

    for (const auto &segment : session_ptr->model.segments) {
        if (write_offset != segment->computed_offset) {
            ABORT(CLOG << LOCATION << " break in continuity, expected: " << write_offset
                       << ", got: " << segment->computed_offset << endl;);
        }
        switch (get_segment_kind_(segment.get())) {
            case segment_kind_t::SEGMENT_READ: {
                if (write_segment_to_file(session_ptr->file_ptr, segment->change_ptr->offset,
                                          segment->change_ptr->length, write_fptr) != 0) {
                    return -1;
                }
                write_offset += segment->change_ptr->length;
                break;
            }
            case segment_kind_t::SEGMENT_INSERT: {
                auto count = segment->computed_length;
                const auto byte = segment->change_ptr->byte;
                while (count--) {
                    if (fputc(byte, write_fptr) != byte) { return -1; }
                }
                write_offset += segment->computed_length;
                break;
            }
            case segment_kind_t::SEGMENT_OVERWRITE: {
                const auto byte = segment->change_ptr->byte;
                if (fputc(byte, write_fptr) != byte) { return -1; }
                ++write_offset;
                break;
            }
            default:
                ABORT(CLOG << LOCATION << " Unhandled segment kind" << endl;);
        }
    }
    return 0;
}

/***********************************************************************************************************************
 * INTERNAL FUNCTIONS
 **********************************************************************************************************************/
static void viewport_callback_(viewport_t *viewport_ptr, const change_t *change_ptr) {
    if (viewport_ptr->on_change_cbk) {
        if (viewport_ptr->bit_offset > 0) {
            left_shift_buffer(viewport_ptr->data.data(), viewport_ptr->length, viewport_ptr->bit_offset);
        }
        (*viewport_ptr->on_change_cbk)(viewport_ptr, change_ptr);
    }
}

static int populate_viewport_(viewport_t *viewport_ptr) {
    const auto viewport_offset = get_viewport_computed_offset(viewport_ptr);
    int64_t read_offset = 0;
    const auto session_ptr = viewport_ptr->author_ptr->session_ptr;
    const auto model_ptr = &viewport_ptr->author_ptr->session_ptr->model;

    for (auto iter = model_ptr->segments.cbegin(); iter != model_ptr->segments.cend(); ++iter) {
        if (read_offset != (*iter)->computed_offset) {
            ABORT(CLOG << LOCATION << " break in continuity, expected: " << read_offset
                       << ", got: " << (*iter)->computed_offset << endl;);
        }
        if (read_offset <= viewport_offset && viewport_offset <= read_offset + (*iter)->computed_length) {
            viewport_ptr->data.clear();
            viewport_ptr->length = 0;
            auto delta = viewport_offset - (*iter)->computed_offset;
            do {
                switch (get_segment_kind_(iter->get())) {
                    case segment_kind_t::SEGMENT_READ: {
                        auto amount = (*iter)->computed_length - delta;
                        int64_t length = 0;
                        amount = (amount > viewport_ptr->capacity) ? viewport_ptr->capacity : amount;
                        read_segment_from_file(session_ptr->file_ptr, (*iter)->computed_offset + delta,
                                               viewport_ptr->data.data() + viewport_ptr->length, amount, &length);
                        viewport_ptr->length += amount;
                        break;
                    }
                    case segment_kind_t::SEGMENT_INSERT: {
                        auto remaining_capacity = viewport_ptr->capacity - viewport_ptr->length;
                        auto amount = (*iter)->computed_length - delta;
                        amount = (amount > remaining_capacity) ? remaining_capacity : amount;
                        memset(viewport_ptr->data.data() + viewport_ptr->length, (*iter)->change_ptr->byte, amount);
                        viewport_ptr->length += amount;
                        break;
                    }
                    case segment_kind_t::SEGMENT_OVERWRITE: {
                        viewport_ptr->data[viewport_ptr->length++] = (*iter)->change_ptr->byte;
                        break;
                    }
                    default:
                        ABORT(CLOG << LOCATION << " Unhandled segment kind" << endl;);
                }
                delta = 0;
            } while (viewport_ptr->length < viewport_ptr->capacity && ++iter != model_ptr->segments.end());
            return 0;
        }
        switch (get_segment_kind_(iter->get())) {
            case segment_kind_t::SEGMENT_READ:// deliberate fall through
            case segment_kind_t::SEGMENT_INSERT: {
                read_offset += (*iter)->computed_length;
                break;
            }
            case segment_kind_t::SEGMENT_OVERWRITE: {
                ++read_offset;
                break;
            }
            default:
                ABORT(CLOG << LOCATION << " Unhandled segment kind" << endl;);
        }
    }
    return -1;
}

static void initialize_model_(session_t *session_ptr) {
    // Model begins with a single READ segment spanning the original file
    const auto read_segment_ptr = shared_ptr<segment_t>(new segment_t);

    read_segment_ptr->segment_kind = segment_kind_t::SEGMENT_READ;
    read_segment_ptr->change_ptr = shared_ptr<change_t>(new change_t);
    read_segment_ptr->change_ptr->serial = 0;
    read_segment_ptr->computed_offset = read_segment_ptr->change_ptr->offset = session_ptr->offset;
    read_segment_ptr->computed_length = read_segment_ptr->change_ptr->length = session_ptr->length;

    session_ptr->model.segments.clear();
    session_ptr->model.segments.push_back(read_segment_ptr);
}

static int update_viewports_(session_t *session_ptr, const change_t *change_ptr) {
    for (const auto &viewport : session_ptr->viewports) {
        if (viewport->computed_offset >= change_ptr->offset) {
            if (get_change_kind_(change_ptr) != change_kind_t::CHANGE_OVERWRITE ||
                change_ptr->offset < viewport->computed_offset + viewport->capacity) {
                if (populate_viewport_(viewport.get()) != 0) { return -1; }
                viewport_callback_(viewport.get(), change_ptr);
            }
        }
    }
    return 0;
}

static change_kind_t get_change_kind_(const change_t *change_ptr) {
    auto change_kind = change_kind_t::CHANGE_OVERWRITE;
    if (change_ptr->length != 0) {
        if (0 < change_ptr->length) {
            change_kind = change_kind_t::CHANGE_INSERT;
        } else {
            change_kind = change_kind_t::CHANGE_DELETE;
        }
    }
    return change_kind;
}

static segment_kind_t get_segment_kind_(const segment_t *segment_ptr) { return segment_ptr->segment_kind; }

static change_ptr_t duplicate_change_(const change_ptr_t &change_ptr) {
    auto result = shared_ptr<change_t>(new change_t);
    result->serial = change_ptr->serial;
    result->offset = change_ptr->offset;
    result->length = change_ptr->length;
    result->byte = change_ptr->byte;
    result->author_ptr = change_ptr->author_ptr;
    return result;
}

static segment_ptr_t duplicate_segment_(const segment_ptr_t &segment_ptr) {
    auto result = shared_ptr<segment_t>(new segment_t);
    result->segment_kind = segment_ptr->segment_kind;
    result->computed_offset = segment_ptr->computed_offset;
    result->computed_length = segment_ptr->computed_length;
    result->change_ptr = segment_ptr->change_ptr;
    return result;
}

/* --------------------------------------------------------------------------------------------------------------------
 The objective here is to model the edits using segments.  Essentially creating a contiguous model of the file by
 keeping track of what to do.  The verbs here are READ, INSERT, and OVERWRITE.  We don't need to model DELETE because
 that is covered by adjusting, or removing, the READ, INSERT, and OVERWRITE segments accordingly.  The model expects to
 take in changes with original offsets and lengths and the model will calculate computed offsets and lengths.
 -------------------------------------------------------------------------------------------------------------------- */
static int update_model_(session_t *session_ptr, const change_ptr_t &change_ptr) {
    const auto update_offset = change_ptr->offset;
    const auto update_length = change_ptr->length;
    const auto change_kind = get_change_kind_(change_ptr.get());
    int64_t read_offset = 0;

    for (auto iter = session_ptr->model.segments.begin(); iter != session_ptr->model.segments.end(); ++iter) {
        if (read_offset != (*iter)->computed_offset) {
            ABORT(CLOG << LOCATION << " break in continuity, expected: " << read_offset
                       << ", got: " << (*iter)->computed_offset << endl;);
        }
        if (update_offset >= read_offset && update_offset <= read_offset + (*iter)->computed_length) {
            if (update_offset != read_offset) {
                const auto delta = update_offset - abs((*iter)->computed_offset);
                if (delta == (*iter)->computed_length) {
                    ++iter;
                } else {
                    const auto split_segment_ptr = duplicate_segment_(*iter);
                    switch (get_segment_kind_(iter->get())) {
                        case segment_kind_t::SEGMENT_READ: {
                            split_segment_ptr->change_ptr = duplicate_change_((*iter)->change_ptr);
                            (*iter)->change_ptr->length = delta;
                            split_segment_ptr->change_ptr->offset += delta;
                            split_segment_ptr->change_ptr->length -= delta;
                            // deliberate fall-through
                        }
                        case segment_kind_t::SEGMENT_INSERT: {
                            (*iter)->computed_length = delta;
                            split_segment_ptr->computed_offset += delta;
                            split_segment_ptr->computed_length -= delta;
                            iter = session_ptr->model.segments.insert(iter + 1, split_segment_ptr);
                            break;
                        }
                        case segment_kind_t::SEGMENT_OVERWRITE:// deliberate fall-through
                            ABORT(CLOG << LOCATION << " logic error" << endl;);
                        default:
                            ABORT(CLOG << LOCATION << " Unhandled segment kind" << endl;);
                    }
                }
            }
            switch (change_kind) {
                case change_kind_t::CHANGE_DELETE: {
                    auto delete_length = abs(update_length);
                    while (delete_length && iter != session_ptr->model.segments.end()) {
                        switch (get_segment_kind_(iter->get())) {
                            case segment_kind_t::SEGMENT_READ: {
                                if ((*iter)->computed_length < delete_length) {
                                    delete_length -= (*iter)->computed_length;
                                    iter = session_ptr->model.segments.erase(iter);
                                } else {
                                    (*iter)->change_ptr->offset += delete_length;
                                    (*iter)->change_ptr->length -= delete_length;
                                    (*iter)->computed_offset += update_length + delete_length;
                                    (*iter)->computed_length -= delete_length;
                                    delete_length = 0;
                                    ++iter;
                                }
                                break;
                            }
                            case segment_kind_t::SEGMENT_INSERT: {
                                if ((*iter)->computed_length < delete_length) {
                                    delete_length -= (*iter)->computed_length;
                                    iter = session_ptr->model.segments.erase(iter);
                                } else {
                                    (*iter)->computed_offset += update_length + delete_length;
                                    (*iter)->computed_length -= delete_length;
                                    delete_length = 0;
                                    ++iter;
                                }
                                break;
                            }
                            case segment_kind_t::SEGMENT_OVERWRITE: {
                                --delete_length;
                                iter = session_ptr->model.segments.erase(iter);
                                break;
                            }
                            default:
                                ABORT(CLOG << LOCATION << " Unhandled segment kind" << endl;);
                        }
                    }
                    for (; iter != session_ptr->model.segments.end(); ++iter) {
                        (*iter)->computed_offset += update_length;
                    }
                    break;
                }
                case change_kind_t::CHANGE_INSERT: {
                    const auto insert_segment_ptr = shared_ptr<segment_t>(new segment_t);
                    insert_segment_ptr->segment_kind = segment_kind_t::SEGMENT_INSERT;
                    insert_segment_ptr->computed_offset = update_offset;
                    insert_segment_ptr->computed_length = update_length;
                    insert_segment_ptr->change_ptr = change_ptr;
                    iter = session_ptr->model.segments.insert(iter, insert_segment_ptr);
                    for (++iter; iter != session_ptr->model.segments.end(); ++iter) {
                        (*iter)->computed_offset += update_length;
                    }
                    break;
                }
                case change_kind_t::CHANGE_OVERWRITE: {
                    const auto overwrite_segment_ptr = shared_ptr<segment_t>(new segment_t);
                    overwrite_segment_ptr->segment_kind = segment_kind_t::SEGMENT_OVERWRITE;
                    overwrite_segment_ptr->computed_offset = update_offset;
                    overwrite_segment_ptr->computed_length = 1;
                    overwrite_segment_ptr->change_ptr = change_ptr;
                    switch (get_segment_kind_(iter->get())) {
                        case segment_kind_t::SEGMENT_READ: {
                            iter = session_ptr->model.segments.insert(iter, overwrite_segment_ptr);
                            ++iter;
                            if ((*iter)->computed_length == 1) {
                                session_ptr->model.segments.erase(iter);
                            } else {
                                ++(*iter)->computed_offset;
                                --(*iter)->computed_length;
                                ++(*iter)->change_ptr->offset;
                                --(*iter)->change_ptr->length;
                            }
                            break;
                        }
                        case segment_kind_t::SEGMENT_INSERT: {
                            iter = session_ptr->model.segments.insert(iter, overwrite_segment_ptr);
                            ++iter;
                            if ((*iter)->computed_length == 1) {
                                session_ptr->model.segments.erase(iter);
                            } else {
                                --(*iter)->computed_length;
                                ++(*iter)->computed_offset;
                            }
                            break;
                        }
                        case segment_kind_t::SEGMENT_OVERWRITE: {
                            *iter = overwrite_segment_ptr;
                            break;
                        }
                        default:
                            ABORT(CLOG << LOCATION << " Unhandled segment kind" << endl;);
                    }
                    break;
                }
                default:
                    ABORT(CLOG << LOCATION << " Unhandled change kind" << endl;);
            }
            return update_viewports_(session_ptr, change_ptr.get());
        }
        read_offset += (*iter)->computed_length;
    }
    return -1;
}

static int update_(const change_ptr_t &change_ptr) {
    const auto session_ptr = change_ptr->author_ptr->session_ptr;
    const auto computed_file_size = get_computed_file_size(session_ptr);

    if (change_ptr->offset <= computed_file_size) {
        session_ptr->changes_by_time.push_back(change_ptr);
        if (update_model_(session_ptr, change_ptr) != 0) { return -1; }
        if (session_ptr->on_change_cbk) { session_ptr->on_change_cbk(session_ptr, change_ptr.get()); }
        return 0;
    }
    return -1;
}
