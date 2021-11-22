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

#include "../include/session.h"
#include "../include/change.h"
#include "../include/util.h"
#include "impl_/change_def.h"
#include "impl_/data_segment_def.h"
#include "impl_/internal_fun.h"
#include "impl_/macros.h"
#include "impl_/model_segment_def.h"
#include "impl_/session_def.h"
#include <algorithm>

int64_t get_computed_file_size(const session_t *session_ptr) {
    return (session_ptr->model_.model_segments.empty())
                   ? 0
                   : session_ptr->model_.model_segments.back()->computed_offset +
                             session_ptr->model_.model_segments.back()->computed_length;
}

int64_t get_session_viewport_max_capacity(const session_t *session_ptr) { return session_ptr->viewport_max_capacity; }

void *get_session_user_data(const session_t *session_ptr) { return session_ptr->user_data_ptr; }

size_t get_session_num_viewports(const session_t *session_ptr) { return session_ptr->viewports.size(); }

size_t get_session_num_changes(const session_t *session_ptr) { return session_ptr->changes.size(); }

size_t get_session_num_undone_changes(const session_t *session_ptr) { return session_ptr->changes_undone.size(); }

int64_t get_session_offset(const session_t *session_ptr) { return session_ptr->offset; }

int64_t get_session_length(const session_t *session_ptr) { return session_ptr->length; }

static void initialize_model_(session_t *session_ptr) {
    session_ptr->model_.model_segments.clear();
    if (0 < session_ptr->length) {
        // Model begins with a single READ segment spanning the original file
        auto change_ptr = std::shared_ptr<change_t>(new change_t);
        change_ptr->serial = 0;
        change_ptr->kind = change_kind_t::CHANGE_INSERT;
        change_ptr->offset = session_ptr->offset;
        change_ptr->length = session_ptr->length;
        auto read_segment_ptr = std::shared_ptr<model_segment_t>(new model_segment_t);
        read_segment_ptr->segment_kind = model_segment_kind_t::SEGMENT_READ;
        read_segment_ptr->change_ptr = change_ptr;
        read_segment_ptr->computed_offset = 0;
        read_segment_ptr->change_offset = read_segment_ptr->change_ptr->offset;
        read_segment_ptr->computed_length = read_segment_ptr->change_ptr->length;
        session_ptr->model_.model_segments.push_back(read_segment_ptr);
    }
}

session_t *create_session_fptr(FILE *file_ptr, session_on_change_cbk_t cbk, void *user_data_ptr,
                               int64_t viewport_max_capacity, int64_t offset, int64_t length) {
    if (0 < viewport_max_capacity) {
        off_t file_size = 0;
        if (file_ptr) {
            if (0 != fseeko(file_ptr, 0L, SEEK_END)) { return nullptr; }
            file_size = ftello(file_ptr);
        }
        if (0 <= file_size && offset + length <= file_size) {
            const auto session_ptr = new session_t;

            session_ptr->serial = 0;
            session_ptr->file_ptr = file_ptr;
            session_ptr->viewport_max_capacity =
                    (viewport_max_capacity) ? viewport_max_capacity : DEFAULT_VIEWPORT_MAX_CAPACITY;
            session_ptr->on_change_cbk = cbk;
            session_ptr->user_data_ptr = user_data_ptr;
            session_ptr->offset = offset;
            session_ptr->length = (length) ? std::min(length, (file_size - offset)) : (file_size - offset);

            initialize_model_(session_ptr);

            return session_ptr;
        }
    }
    return nullptr;
}

session_t *create_session(const char *file_path, session_on_change_cbk_t cbk, void *user_data_ptr,
                          int64_t viewport_max_capacity, int64_t offset, int64_t length) {
    FILE *file_ptr = nullptr;
    if (file_path) {
        file_ptr = fopen(file_path, "r");
        if (!file_ptr) { return nullptr; }
    }
    viewport_max_capacity = (viewport_max_capacity) ? viewport_max_capacity : DEFAULT_VIEWPORT_MAX_CAPACITY;
    auto session_ptr = create_session_fptr(file_ptr, cbk, user_data_ptr, viewport_max_capacity, offset, length);
    if (file_path && session_ptr) { session_ptr->file_path = file_path; }
    return session_ptr;
}

const char *get_session_file_path(const session_t *session_ptr) {
    return (session_ptr->file_path.empty()) ? nullptr : session_ptr->file_path.c_str();
}

void destroy_session(const session_t *session_ptr) {
    if (!session_ptr->file_path.empty()) { fclose(session_ptr->file_ptr); }
    delete session_ptr;
}

int save_session_fptr(const session_t *session_ptr, FILE *file_ptr) {
    int64_t write_offset = 0;

    for (const auto &segment : session_ptr->model_.model_segments) {
        if (write_offset != segment->computed_offset) {
            ABORT(CLOG << LOCATION << " break in model continuity, expected: " << write_offset
                       << ", got: " << segment->computed_offset << std::endl;);
        }
        switch (segment->segment_kind) {
            case model_segment_kind_t::SEGMENT_READ: {
                if (write_segment_to_file(session_ptr->file_ptr, segment->change_offset, segment->computed_length,
                                          file_ptr) != segment->computed_length) {
                    return -1;
                }
                break;
            }
            case model_segment_kind_t::SEGMENT_INSERT: {
                const byte_t *change_bytes;
                get_change_bytes(segment->change_ptr.get(), &change_bytes);
                if (fwrite(change_bytes + segment->change_offset, 1, segment->computed_length, file_ptr) !=
                    segment->computed_length) {
                    return -1;
                }
                break;
            }
            default:
                ABORT(CLOG << LOCATION << " Unhandled segment kind" << std::endl;);
        }
        write_offset += segment->computed_length;
    }
    return 0;
}

int save_session(const session_t *session_ptr, const char *file_path) {
    int rc = -1;
    auto file_ptr = fopen(file_path, "w");
    if (file_ptr) {
        rc = save_session_fptr(session_ptr, file_ptr);
        fclose(file_ptr);
    }
    return rc;
}

int visit_changes(const session_t *session_ptr, visit_changes_cbk_t cbk, void *user_data) {
    int rc = 0;
    for (const auto &iter : session_ptr->changes) {
        if ((rc = cbk(iter.get(), user_data)) != 0) { break; }
    }
    return rc;
}

/*
 * The idea here is to search using tiled windows.  The window should be at least twice the size of the needle, and then
 * it skips to 1 + window_capacity - needle_length, as far as we can skip, with just enough backward coverage to catch
 * needles that were on the window boundary.
 */
int session_search(const session_t *session_ptr, const byte_t *needle, int64_t needle_length,
                   pattern_match_found_cbk_t cbk, void *user_data, int64_t session_offset, int64_t session_length) {
    int rc = -1;
    if (needle_length < NEEDLE_LENGTH_LIMIT) {
        rc = 0;
        session_length = (session_length) ? session_length : session_ptr->length;
        if (needle_length <= session_length) {
            data_segment_t data_segment;
            data_segment.offset = session_offset;
            data_segment.capacity = NEEDLE_LENGTH_LIMIT << 1;
            data_segment.data.bytes =
                    (data_segment.capacity < 8) ? nullptr : std::make_unique<byte_t[]>(data_segment.capacity);
            const auto skip_size = 1 + data_segment.capacity - needle_length;
            int64_t skip = 0;
            do {
                data_segment.offset += skip;
                populate_data_segment_(session_ptr, &data_segment);
                auto haystack = get_data_segment_data_(&data_segment);
                auto haystack_length = data_segment.length;
                void *found;
                int64_t delta = 0;
                while ((found = memmem(haystack + delta, haystack_length - delta, needle, needle_length))) {
                    delta = static_cast<byte_t *>(found) - static_cast<byte_t *>(haystack);
                    if ((rc = cbk(data_segment.offset + delta, needle_length, user_data)) != 0) { return rc; }
                    ++delta;
                }
                skip = skip_size;
            } while (data_segment.length == data_segment.capacity);
        }
    }
    return rc;
}

const change_t *get_last_change(const session_t *session_ptr) {
    return (session_ptr->changes.empty()) ? nullptr : session_ptr->changes.back().get();
}

const change_t *get_last_undo(const session_t *session_ptr) {
    return (session_ptr->changes_undone.empty()) ? nullptr : session_ptr->changes_undone.back().get();
}

int undo_last_change(session_t *session_ptr) {
    if (!session_ptr->changes.empty()) {
        const auto change_ptr = session_ptr->changes.back();

        session_ptr->changes.pop_back();
        initialize_model_(session_ptr);
        for (auto iter = session_ptr->changes.begin(); iter != session_ptr->changes.end(); ++iter) {
            if (update_model_(session_ptr, *iter) != 0) { return -1; }
        }

        // Negate the undone change's serial number to indicate that the change has been undone
        const auto undone_change_ptr = const_cast<change_t *>(change_ptr.get());
        undone_change_ptr->serial *= -1;

        session_ptr->changes_undone.push_back(change_ptr);
        update_viewports_(session_ptr, undone_change_ptr);
        if (session_ptr->on_change_cbk) { session_ptr->on_change_cbk(session_ptr, undone_change_ptr); }
        return 0;
    }
    return -1;
}

int redo_last_undo(session_t *session_ptr) {
    int rc = -1;
    if (!session_ptr->changes_undone.empty()) {
        rc = update_(session_ptr->changes_undone.back());
        session_ptr->changes_undone.pop_back();
    }
    return rc;
}


int check_session_model(const session_t *session_ptr) {
    int64_t expected_offset = 0;
    for (const auto &segment : session_ptr->model_.model_segments) {
        if (expected_offset != segment->computed_offset ||
            (segment->change_offset + segment->computed_length) > segment->change_ptr->length) {
            print_model_segments_(session_ptr, CLOG);
            return -1;
        }
        expected_offset += segment->computed_length;
    }
    return 0;
}
