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

#include <cassert>
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
#define ABORT(x) do { x abort(); } while (0)

#ifndef CLOG
#define CLOG clog
#endif //CLOG

/***********************************************************************************************************************
 * DATA STRUCTURES
 **********************************************************************************************************************/

struct author_t {
    string name;             ///< Name of the author
    session_t *session_ptr{};///< Session associated with this author
};
typedef shared_ptr<author_t> author_ptr_t;

enum class change_kind_t {
    CHANGE_DELETE, CHANGE_INSERT, CHANGE_OVERWRITE
};
typedef unique_ptr<byte_t[]> data_ptr_t;

struct change_t {
    const author_t *author_ptr{};///< Author of the change
    int64_t serial{};            ///< Serial number of the change (increasing)
    change_kind_t kind{};        ///< Change kind
    int64_t offset{};            ///< Offset at the time of the change
    int64_t length{};            ///< Number of bytes at the time of the change
    data_ptr_t bytes{};          ///< Bytes to insert or overwrite
};
typedef shared_ptr<change_t> change_ptr_t;

struct viewport_t {
    const author_t *author_ptr{};///< Author who owns this viewport instance
    int64_t capacity{};          ///< Data capacity (in bytes) of this viewport
    int64_t length{};            ///< Populated data length (in bytes) of this viewport
    int64_t computed_offset{};   ///< Viewport offset as changes have been made
    data_ptr_t data_ptr{};       ///< Data in the viewport
    byte_t bit_offset{};         ///< Bit offset between 0 and 7 (inclusive) for this viewport (bit-shift left)
    viewport_on_change_cbk on_change_cbk{};///< User callback when the viewport changes
    void *user_data_ptr{};                 ///< Pointer to user-provided data associated with this viewport
};
typedef shared_ptr<viewport_t> viewport_ptr_t;

enum class segment_kind_t {
    SEGMENT_READ, SEGMENT_INSERT
};

struct segment_t {
    segment_kind_t segment_kind = segment_kind_t::SEGMENT_READ;
    int64_t computed_offset{};///< computed offset can differ from the change because segments can moved and be split
    int64_t computed_length{};///< computed length can differ from the change because changes can be split
    int64_t change_offset{};  ///< change offset is the offset in the change due to a split
    change_ptr_t change_ptr;
};
typedef shared_ptr<segment_t> segment_ptr_t;

typedef vector<author_ptr_t> authors_t;
typedef vector<viewport_ptr_t> viewports_t;
typedef vector<change_ptr_t> changes_t;

struct model_t {
    vector<segment_ptr_t> segments;
};

struct session_t {
    FILE *file_ptr{};                     ///< File being edited (open for read)
    int64_t serial{};                     ///< Incremented for every change
    int64_t viewport_max_capacity{};      ///< Maximum capacity of a viewport for this session
    session_on_change_cbk on_change_cbk{};///< User defined callback called when the session gets a change
    void *user_data_ptr{};                ///< Pointer to user-provided data associated with this session
    int64_t offset{};                     ///< Edit offset into the file being edited
    int64_t length{};                     ///< Edit length into the file being edited
    authors_t authors;                    ///< Collection of authors in this session
    viewports_t viewports;                ///< Collection of viewports in this session
    changes_t changes;                    ///< Collection of changes for this session, ordered by time
    model_t model_;                       ///< Edit model (internal)
};

/***********************************************************************************************************************
 * INTERNAL FUNCTION DECLARATIONS
 **********************************************************************************************************************/

static void print_segments_(const session_t *session_ptr, ostream &out_stream);

static void viewport_callback_(viewport_t *viewport_ptr, const change_t *change_ptr);

static int populate_viewport_(viewport_t *viewport_ptr);

static void initialize_model_(session_t *session_ptr);

static bool change_affects_viewport_(const viewport_t *viewport_ptr, const change_t *change_ptr);

static int update_viewports_(session_t *session_ptr, const change_t *change_ptr);

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
    for (const auto &change: author_ptr->session_ptr->changes) {
        if (change->author_ptr->name == author_ptr->name) { ++count; }
    }
    return count;
}

const author_t *create_author(session_t *session_ptr, const char *author_name) {
    if (session_ptr) {
        for (const auto &author: session_ptr->authors) {
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

int64_t get_change_bytes(const change_t *change_ptr, const byte_t **bytes) {
    *bytes = (change_ptr->kind != change_kind_t::CHANGE_DELETE) ? change_ptr->bytes.get() : nullptr;
    return change_ptr->length;
}

char get_change_kind_as_char(const change_t *change_ptr) {
    switch (change_ptr->kind) {
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

change_ptr_t del_(const author_t *author_ptr, int64_t offset, int64_t length) {
    auto change_ptr = shared_ptr<change_t>(new change_t);
    change_ptr->author_ptr = author_ptr;
    change_ptr->serial = 0;// When modeling an OVERWRITE, we want an "off the books" serial number
    change_ptr->kind = change_kind_t::CHANGE_DELETE;
    change_ptr->offset = offset;
    change_ptr->length = length;
    change_ptr->bytes = nullptr;
    return change_ptr;
}

int del(const author_t *author_ptr, int64_t offset, int64_t length) {
    auto change_ptr = del_(author_ptr, offset, length);
    change_ptr->serial = ++author_ptr->session_ptr->serial;
    return update_(change_ptr);
}

change_ptr_t ins_(const author_t *author_ptr, int64_t offset, const byte_t *bytes, int64_t length) {
    auto change_ptr = shared_ptr<change_t>(new change_t);
    change_ptr->author_ptr = author_ptr;
    change_ptr->serial = ++author_ptr->session_ptr->serial;
    change_ptr->kind = change_kind_t::CHANGE_INSERT;
    change_ptr->offset = offset;
    change_ptr->length = (length) ? length : strlen((const char *) bytes);
    change_ptr->bytes = make_unique<byte_t[]>(change_ptr->length + 1);
    memcpy(change_ptr->bytes.get(), bytes, change_ptr->length);
    change_ptr->bytes.get()[change_ptr->length] = '\0';
    return change_ptr;
}

int ins(const author_t *author_ptr, int64_t offset, const byte_t *bytes, int64_t length) {
    return update_(ins_(author_ptr, offset, bytes, length));
}

change_ptr_t ovr_(const author_t *author_ptr, int64_t offset, const byte_t *bytes, int64_t length) {
    auto change_ptr = shared_ptr<change_t>(new change_t);
    change_ptr->author_ptr = author_ptr;
    change_ptr->serial = ++author_ptr->session_ptr->serial;
    change_ptr->kind = change_kind_t::CHANGE_OVERWRITE;
    change_ptr->offset = offset;
    change_ptr->length = (length) ? length : strlen((const char *) bytes);
    change_ptr->bytes = make_unique<byte_t[]>(change_ptr->length + 1);
    memcpy(change_ptr->bytes.get(), bytes, change_ptr->length);
    change_ptr->bytes.get()[change_ptr->length] = '\0';
    return change_ptr;
}

int ovr(const author_t *author_ptr, int64_t offset, const byte_t *bytes, int64_t length) {
    return update_(ovr_(author_ptr, offset, bytes, length));
}

int visit_changes(const session_t *session_ptr, visit_changes_cbk cbk, void *user_data) {
    int rc = 0;
    for (const auto &iter: session_ptr->changes) {
        if ((rc = cbk(iter.get(), user_data)) != 0) { break; }
    }
    return rc;
}

int undo_last_change(const author_t *author_ptr) {
    const auto session_ptr = author_ptr->session_ptr;

    if (!session_ptr->changes.empty()) {
        const auto change_ptr = session_ptr->changes.back();

        session_ptr->changes.pop_back();
        initialize_model_(session_ptr);
        for (auto iter = session_ptr->changes.begin(); iter != session_ptr->changes.end(); ++iter) {
            if (update_model_(session_ptr, *iter) != 0) { return -1; }
        }

        // Negate the undone change's serial number to indicate that the change has been undone
        change_ptr->serial *= -1;

        update_viewports_(session_ptr, change_ptr.get());
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

const byte_t *get_viewport_data(const viewport_t *viewport_ptr) { return viewport_ptr->data_ptr.get(); }

void *get_viewport_user_data(const viewport_t *viewport_ptr) { return viewport_ptr->user_data_ptr; }

byte_t get_viewport_bit_offset(const viewport_t *viewport_ptr) { return viewport_ptr->bit_offset; }

viewport_t *create_viewport(const author_t *author_ptr, int64_t offset, int64_t capacity, viewport_on_change_cbk cbk,
                            void *user_data_ptr, byte_t bit_offset) {
    const auto session_ptr = author_ptr->session_ptr;
    if (capacity > 0 and capacity <= get_session_viewport_max_capacity(session_ptr)) {
        const auto viewport_ptr = shared_ptr<viewport_t>(new viewport_t);
        viewport_ptr->author_ptr = author_ptr;
        viewport_ptr->computed_offset = offset;
        viewport_ptr->capacity = capacity;
        viewport_ptr->length = 0;
        viewport_ptr->data_ptr = make_unique<byte_t[]>(capacity);
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

int update_viewport(viewport_t *viewport_ptr, int64_t offset, int64_t capacity, byte_t bit_offset) {
    const auto session_ptr = viewport_ptr->author_ptr->session_ptr;
    if (capacity > 0 && capacity <= get_session_viewport_max_capacity(session_ptr)) {
        // only change settings if they are different
        if (viewport_ptr->computed_offset != offset || viewport_ptr->capacity != capacity ||
            viewport_ptr->bit_offset != bit_offset) {
            viewport_ptr->computed_offset = offset;
            viewport_ptr->capacity = capacity;
            viewport_ptr->data_ptr = make_unique<byte_t[]>(capacity);
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
    const auto last_segment = session_ptr->model_.segments.back();
    return (session_ptr->model_.segments.empty()) ? 0 : last_segment->computed_offset + last_segment->computed_length;
}

int64_t get_session_viewport_max_capacity(const session_t *session_ptr) { return session_ptr->viewport_max_capacity; }

void *get_session_user_data(const session_t *session_ptr) { return session_ptr->user_data_ptr; }

size_t get_session_num_viewports(const session_t *session_ptr) { return session_ptr->viewports.size(); }

size_t get_session_num_changes(const session_t *session_ptr) { return session_ptr->changes.size(); }

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

    for (const auto &segment: session_ptr->model_.segments) {
        if (write_offset != segment->computed_offset) {
            ABORT(CLOG << LOCATION << " break in continuity, expected: " << write_offset
                       << ", got: " << segment->computed_offset << endl;);
        }
        switch (segment->segment_kind) {
            case segment_kind_t::SEGMENT_READ: {
                if (write_segment_to_file(session_ptr->file_ptr, segment->change_offset, segment->computed_length,
                                          write_fptr) != segment->computed_length) {
                    return -1;
                }
                break;
            }
            case segment_kind_t::SEGMENT_INSERT: {
                if (fwrite(segment->change_ptr->bytes.get() + segment->change_offset, 1, segment->computed_length,
                           write_fptr) != segment->computed_length) {
                    return -1;
                }
                break;
            }
            default:
                ABORT(CLOG << LOCATION << " Unhandled segment kind" << endl;);
        }
        write_offset += segment->computed_length;
    }
    return 0;
}

/***********************************************************************************************************************
 * INTERNAL FUNCTIONS
 **********************************************************************************************************************/

static char segment_kind_as_char_(segment_kind_t segment_kind) {
    switch (segment_kind) {
        case segment_kind_t::SEGMENT_READ:
            return 'R';
        case segment_kind_t::SEGMENT_INSERT:
            return 'I';
    }
    return '?';
}

static void print_change_(const change_ptr_t change_ptr, ostream &out_stream) {
    out_stream << R"({"serial": )" << change_ptr->serial
               << R"(, "kind": ")" << get_change_kind_as_char(change_ptr.get())
               << R"(", "offset": )" << change_ptr->offset
               << R"(, "length": )" << change_ptr->length;
    if (change_ptr->bytes) {
        out_stream << R"(, "bytes": ")" << string((char const *) change_ptr->bytes.get(), change_ptr->length) << R"(")";
    }
    out_stream << "}";
}

static void print_segment_(const segment_ptr_t &segment_ptr, ostream &out_stream) {
    out_stream << R"({"kind": ")" << segment_kind_as_char_(segment_ptr->segment_kind)
               << R"(", "computed_offset": )" << segment_ptr->computed_offset
               << R"(, "computed_length": )" << segment_ptr->computed_length
               << R"(, "change_offset": )" << segment_ptr->change_offset
               << R"(, "change": )";
    print_change_(segment_ptr->change_ptr, out_stream);
    out_stream << "}" << endl;
}

static void print_segments_(const session_t *session_ptr, ostream &out_stream) {
    for (const auto &segment: session_ptr->model_.segments) { print_segment_(segment, out_stream); }
}

int check_segment_continuity(const session_t *session_ptr) {
    int64_t expected_offset = 0;
    for (const auto &segment: session_ptr->model_.segments) {
        if (expected_offset != segment->computed_offset ||
            (segment->change_offset + segment->computed_length) > segment->change_ptr->length) {
            print_segments_(session_ptr, CLOG);
            return -1;
        }
        expected_offset += segment->computed_length;
    }
    return 0;
}

static void viewport_callback_(viewport_t *viewport_ptr, const change_t *change_ptr) {
    if (viewport_ptr->on_change_cbk) {
        if (viewport_ptr->bit_offset > 0) {
            left_shift_buffer(viewport_ptr->data_ptr.get(), viewport_ptr->length, viewport_ptr->bit_offset);
        }
        (*viewport_ptr->on_change_cbk)(viewport_ptr, change_ptr);
    }
}

static bool change_affects_viewport_(const viewport_t *viewport_ptr, const change_t *change_ptr) {
    switch (change_ptr->kind) {
        case change_kind_t::CHANGE_DELETE:// deliberate fall-through
        case change_kind_t::CHANGE_INSERT:
            // INSERT and DELETE changes that happen before the viewport end offset affect the viewport
            return (change_ptr->offset <= (viewport_ptr->computed_offset + viewport_ptr->capacity));
        case change_kind_t::CHANGE_OVERWRITE:
            return ((change_ptr->offset + change_ptr->length) >= viewport_ptr->computed_offset) &&
                   (change_ptr->offset <= (viewport_ptr->computed_offset + viewport_ptr->capacity));
        default:
            ABORT(CLOG << LOCATION << " Unhandled change kind" << endl;);
    }
}

static int update_viewports_(session_t *session_ptr, const change_t *change_ptr) {
    for (const auto &viewport: session_ptr->viewports) {
        if (change_affects_viewport_(viewport.get(), change_ptr)) {
            if (populate_viewport_(viewport.get()) != 0) {
                return -1;
            }
            viewport_callback_(viewport.get(), change_ptr);
        }
    }
    return 0;
}

static int populate_viewport_(viewport_t *viewport_ptr) {
    viewport_ptr->length = 0;
    const auto model_ptr = &viewport_ptr->author_ptr->session_ptr->model_;
    if (model_ptr->segments.empty()) { return 0; }

    const auto viewport_offset = viewport_ptr->computed_offset;
    const auto session_ptr = viewport_ptr->author_ptr->session_ptr;
    int64_t read_offset = 0;

    for (auto iter = model_ptr->segments.cbegin(); iter != model_ptr->segments.cend(); ++iter) {
        if (read_offset != (*iter)->computed_offset) {
            print_segments_(session_ptr, CLOG);
            ABORT(CLOG << LOCATION << " break in continuity, expected: " << read_offset
                       << ", got: " << (*iter)->computed_offset << endl;);
        }
        if (read_offset <= viewport_offset && viewport_offset <= read_offset + (*iter)->computed_length) {
            // We're at the first segment that intersects with the viewport, but the segment and the viewport's offsets
            // are likely not aligned, so we need to compute how much of the segment to move past (delta)
            auto delta = viewport_offset - (*iter)->computed_offset;
            do {
                // This is how much of the viewport remains to be filled
                const auto remaining_capacity = viewport_ptr->capacity - viewport_ptr->length;
                auto amount = (*iter)->computed_length - delta;
                amount = (amount > remaining_capacity) ? remaining_capacity : amount;
                switch ((*iter)->segment_kind) {
                    case segment_kind_t::SEGMENT_READ: {
                        // For read segments, we're reading a segment, or portion thereof, from the input file and
                        // writing it into the viewport
                        if (read_segment_from_file(session_ptr->file_ptr, (*iter)->change_offset + delta,
                                                   viewport_ptr->data_ptr.get() + viewport_ptr->length,
                                                   amount) != amount) {
                            return -1;
                        }
                        break;
                    }
                    case segment_kind_t::SEGMENT_INSERT: {
                        // For insert segments, we're writing the change byte buffer, or portion thereof, into the
                        // viewport
                        memcpy(viewport_ptr->data_ptr.get() + viewport_ptr->length,
                               (*iter)->change_ptr->bytes.get() + (*iter)->change_offset + delta, amount);
                        break;
                    }
                    default:
                        ABORT(CLOG << LOCATION << " Unhandled segment kind" << endl;);
                }
                // Add the amount written to the viewport length
                viewport_ptr->length += amount;
                // After the first segment is written, the dela should be zero from that point on
                delta = 0;
                // Keep writing segments until we run out of viewport capacity or run out of segments
            } while (viewport_ptr->length < viewport_ptr->capacity && ++iter != model_ptr->segments.end());
            return 0;
        }
        read_offset += (*iter)->computed_length;
    }
    return -1;
}

static void initialize_model_(session_t *session_ptr) {
    // Model begins with a single READ segment spanning the original file
    auto read_segment_ptr = shared_ptr<segment_t>(new segment_t);

    read_segment_ptr->segment_kind = segment_kind_t::SEGMENT_READ;
    read_segment_ptr->change_ptr = shared_ptr<change_t>(new change_t);
    read_segment_ptr->change_ptr->serial = 0;
    read_segment_ptr->computed_offset = 0;
    read_segment_ptr->change_ptr->kind = change_kind_t::CHANGE_INSERT;
    read_segment_ptr->change_offset = read_segment_ptr->change_ptr->offset = session_ptr->offset;
    read_segment_ptr->computed_length = read_segment_ptr->change_ptr->length = session_ptr->length;

    session_ptr->model_.segments.clear();
    session_ptr->model_.segments.push_back(read_segment_ptr);
}

static segment_ptr_t duplicate_segment_(const segment_ptr_t &segment_ptr) {
    auto result = shared_ptr<segment_t>(new segment_t);
    result->segment_kind = segment_ptr->segment_kind;
    result->computed_offset = segment_ptr->computed_offset;
    result->computed_length = segment_ptr->computed_length;
    result->change_offset = segment_ptr->change_offset;
    result->change_ptr = segment_ptr->change_ptr;
    return result;
}

/* --------------------------------------------------------------------------------------------------------------------
 The objective here is to model the edits using segments.  Essentially creating a contiguous model of the file by
 keeping track of what to do.  The verbs here are READ, INSERT, and OVERWRITE.  We don't need to model DELETE because
 that is covered by adjusting, or removing, the READ, INSERT, and OVERWRITE segments accordingly.  The model expects to
 take in changes with original offsets and lengths and the model will calculate computed offsets and lengths.
 -------------------------------------------------------------------------------------------------------------------- */
static int update_model_helper_(session_t *session_ptr, const change_ptr_t &change_ptr) {
    int64_t read_offset = 0;

    for (auto iter = session_ptr->model_.segments.begin(); iter != session_ptr->model_.segments.end(); ++iter) {
        if (read_offset != (*iter)->computed_offset) {
            ABORT(CLOG << LOCATION << " break in continuity, expected: " << read_offset
                       << ", got: " << (*iter)->computed_offset << endl;);
        }
        if (change_ptr->offset >= read_offset && change_ptr->offset <= read_offset + (*iter)->computed_length) {
            if (change_ptr->offset != read_offset) {
                const auto delta = change_ptr->offset - (*iter)->computed_offset;
                if (delta == (*iter)->computed_length) {
                    // The update happens right at the end of the existing segment
                    ++iter;
                } else {
                    // The update site falls in the middle of an existing segment, so we need to split the segment at
                    // the update site.  iter points to the segment on the left of the split and split_segment_ptr
                    // points to a new duplicate segment on the right of the split.
                    const auto split_segment_ptr = duplicate_segment_(*iter);
                    split_segment_ptr->computed_offset += delta;
                    split_segment_ptr->computed_length -= delta;
                    split_segment_ptr->change_offset = delta;
                    (*iter)->computed_length = delta;
                    // iter will now point to the new split segment inserted into the model and who's offset falls on
                    // the update site
                    iter = session_ptr->model_.segments.insert(iter + 1, split_segment_ptr);
                }
            }
            switch (change_ptr->kind) {
                case change_kind_t::CHANGE_DELETE: {
                    auto delete_length = change_ptr->length;
                    while (delete_length && iter != session_ptr->model_.segments.end()) {
                        if ((*iter)->computed_length <= delete_length) {
                            // DELETE change spans the entire segment
                            delete_length -= (*iter)->computed_length;
                            iter = session_ptr->model_.segments.erase(iter);
                        } else {
                            // DELETE removes a portion of the beginning of the segment
                            (*iter)->computed_length -= delete_length;
                            (*iter)->computed_offset += delete_length - change_ptr->length;
                            (*iter)->change_offset += delete_length;
                            assert((*iter)->change_offset < (*iter)->change_ptr->length);
                            delete_length = 0;
                            ++iter; // move to the next segment for adjusting
                        }
                    }
                    // adjust the computed offsets for segments beyond the DELETE site
                    for (; iter != session_ptr->model_.segments.end(); ++iter) {
                        (*iter)->computed_offset -= change_ptr->length;
                    }
                    break;
                }
                case change_kind_t::CHANGE_OVERWRITE:// deliberate fall-through
                case change_kind_t::CHANGE_INSERT: {
                    const auto insert_segment_ptr = shared_ptr<segment_t>(new segment_t);
                    insert_segment_ptr->segment_kind = segment_kind_t::SEGMENT_INSERT;
                    insert_segment_ptr->computed_offset = change_ptr->offset;
                    insert_segment_ptr->computed_length = change_ptr->length;
                    insert_segment_ptr->change_offset = 0;
                    insert_segment_ptr->change_ptr = change_ptr;
                    iter = session_ptr->model_.segments.insert(iter, insert_segment_ptr);
                    for (++iter; iter != session_ptr->model_.segments.end(); ++iter) {
                        (*iter)->computed_offset += change_ptr->length;
                    }
                    break;
                }
                default:
                    ABORT(CLOG << LOCATION << " Unhandled change kind" << endl;);
            }
            return 0;
        }
        read_offset += (*iter)->computed_length;
    }
    return -1;
}

static int update_model_(session_t *session_ptr, const change_ptr_t &change_ptr) {
    int rc;
    if (change_ptr->kind == change_kind_t::CHANGE_OVERWRITE) {
        // Overwrite will model just like a DELETE, followed by an INSERT
        auto delete_change_ptr = del_(change_ptr->author_ptr, change_ptr->offset, change_ptr->length);
        if ((rc = update_model_helper_(session_ptr, delete_change_ptr)) != 0) { return rc; }
    }
    if ((rc = update_model_helper_(session_ptr, change_ptr)) == 0) {
        rc = update_viewports_(session_ptr, change_ptr.get());
    }
    return rc;
}

static int update_(const change_ptr_t &change_ptr) {
    const auto session_ptr = change_ptr->author_ptr->session_ptr;
    const auto computed_file_size = get_computed_file_size(session_ptr);

    if (change_ptr->offset <= computed_file_size) {
        session_ptr->changes.push_back(change_ptr);
        if (update_model_(session_ptr, change_ptr) != 0) { return -1; }
        if (session_ptr->on_change_cbk) { session_ptr->on_change_cbk(session_ptr, change_ptr.get()); }
        return 0;
    }
    return -1;
}
