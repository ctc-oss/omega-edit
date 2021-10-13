// Source file (.cpp)
#include "omega_edit.h"
#include <cstdint>
#include <string>
#include <vector>
#include <cstdio>
#include <memory>

using namespace std;

// define DEBUG for debugging
#define DEBUG

#ifdef DEBUG

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
    int64_t computed_offset;
    int64_t num_bytes;
    int64_t serial;
    const author_t *author_ptr;
    uint8_t byte;
};

int64_t get_computed_offset(const change_t *change_ptr) {
    return change_ptr->computed_offset;
}

int64_t get_num_bytes(const change_t *change_ptr) {
    return change_ptr->num_bytes;
}

int64_t get_serial(const change_t *change_ptr) {
    return change_ptr->serial;
}

const author_t *get_author(const change_t *change_ptr) {
    return change_ptr->author_ptr;
}

uint8_t get_byte(const change_t *change_ptr) {
    return change_ptr->byte;
}

struct viewport_t {
    const author_t *author_ptr{};
    int32_t capacity{};
    int32_t length{};
    int64_t computed_offset{};
    on_change_cbk on_change_cbk{};
    void *user_data_ptr{};
    vector<uint8_t> data;
};

const author_t *get_viewport_author(const viewport_t *viewport_ptr) {
    return viewport_ptr->author_ptr;
}

int32_t get_viewport_capacity(const viewport_t *viewport_ptr) {
    return viewport_ptr->capacity;
}

int32_t get_viewport_length(const viewport_t *viewport_ptr) {
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

struct session_t {
    FILE *file_ptr{};
    int64_t serial{};
    int64_t computed_file_size{};
    vector<shared_ptr<author_t> > authors;
    vector<shared_ptr<viewport_t> > viewports;
    vector<change_t> changes;
    vector<int64_t> changes_by_offset;
};

//
// FUNCTIONS
//

session_t *create_session(FILE *file_ptr) {
    fseek(file_ptr, 0L, SEEK_END);
    auto *session_ptr = new session_t;
    session_ptr->serial = 0;
    session_ptr->file_ptr = file_ptr;
    session_ptr->computed_file_size = ftell(file_ptr);
    return session_ptr;
}

const author_t *add_author(session_t *session_ptr, const char *author_name) {
    auto author_ptr = shared_ptr<author_t>(new author_t);
    author_ptr->session_ptr = session_ptr;
    author_ptr->name.assign(author_name);
    session_ptr->authors.push_back(author_ptr);
    return author_ptr.get();
}

const char *get_author_name(const author_t *author_ptr) {
    return author_ptr->name.c_str();
}

session_t *get_author_session(const author_t *author_ptr) {
    return author_ptr->session_ptr;
}

viewport_t *
add_viewport(const author_t *author_ptr, int64_t offset, int32_t capacity, on_change_cbk cbk, void *user_data_ptr) {
    auto viewport_ptr = shared_ptr<viewport_t>(new viewport_t);
    viewport_ptr->author_ptr = author_ptr;
    viewport_ptr->computed_offset = offset;
    viewport_ptr->capacity = capacity;
    viewport_ptr->length = 0;
    viewport_ptr->data.reserve(capacity);
    viewport_ptr->on_change_cbk = cbk;
    viewport_ptr->user_data_ptr = user_data_ptr;
    author_ptr->session_ptr->viewports.push_back(viewport_ptr);
    // TODO: populate the viewport and call the on change callback

    return viewport_ptr.get();
}

int set_viewport(viewport_t *viewport_ptr, int64_t offset, int32_t capacity) {
    // only change settings if they are different
    if (viewport_ptr->computed_offset != offset || viewport_ptr->capacity != capacity) {
        viewport_ptr->computed_offset = offset;
        viewport_ptr->capacity = capacity;
        viewport_ptr->data.reserve(capacity);
        // TODO: update viewport and call the on change callback
    }
    return 0;
}

// Internal function to add a change to the given session
int add_change_(const change_t *change_ptr) {
    auto session_ptr = change_ptr->author_ptr->session_ptr;
    session_ptr->changes.push_back(*change_ptr);
    auto insert_pos = session_ptr->changes_by_offset.begin();

    if (change_ptr->num_bytes != 0) {
        // If we're inserting bytes, bytes from the current offset on need to be adjusted
        while (insert_pos != session_ptr->changes_by_offset.end() &&
               change_ptr->computed_offset > session_ptr->changes[*insert_pos].computed_offset) {
            ++insert_pos;
        }
        insert_pos = session_ptr->changes_by_offset.insert(insert_pos, change_ptr->serial);
        if (change_ptr->num_bytes > 0 && insert_pos != session_ptr->changes_by_offset.end()) ++insert_pos;
    } else {
        while (insert_pos != session_ptr->changes_by_offset.end() &&
               change_ptr->computed_offset >= session_ptr->changes[*insert_pos].computed_offset) {
            ++insert_pos;
        }
        insert_pos = session_ptr->changes_by_offset.insert(insert_pos, change_ptr->serial);
    }
    if (change_ptr->num_bytes != 0) {
        // Adjust the offsets by the number of bytes for all change offsets on and after this change
        for (; insert_pos != session_ptr->changes_by_offset.end(); ++insert_pos) {
            session_ptr->changes[*insert_pos].computed_offset += change_ptr->num_bytes;
        }
        session_ptr->computed_file_size += change_ptr->num_bytes;
    }
    // TODO: update affected viewports and call their on change callbacks

    return 0;
}

// Add overwrite change
int ovr(const author_t *author_ptr, int64_t offset, uint8_t byte) {
    change_t change{};
    change.author_ptr = author_ptr;
    change.computed_offset = offset;
    change.byte = byte;
    change.num_bytes = 0;
    change.serial = author_ptr->session_ptr->serial++;
    DBG(clog << "'" << get_author_name(author_ptr) << "' overwriting with byte '" << byte << "' at offset " << offset
             << " serial " << change.serial << endl;);
    return add_change_(&change);
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
    return add_change_(&change);
}

// Add insert change
int ins(const author_t *author_ptr, int64_t offset, int64_t num_bytes, uint8_t fill) {
    change_t change{};
    change.author_ptr = author_ptr;
    change.computed_offset = offset;
    change.byte = fill;
    change.num_bytes = num_bytes;  // positive for insert
    change.serial = author_ptr->session_ptr->serial++;
    DBG(clog << "'" << get_author_name(author_ptr) << "' inserting " << num_bytes << " of '" << fill << "' at offset "
             << offset << " serial " << change.serial << endl;);
    return add_change_(&change);
}

// Determine the computed offset given an original offset
int64_t offset_to_computed_offset(const session_t *session_ptr, int64_t offset) {
    for (auto iter(session_ptr->changes_by_offset.begin()); iter != session_ptr->changes_by_offset.end(); ++iter) {
        offset += session_ptr->changes[*iter].num_bytes;
        if (session_ptr->changes[*iter].computed_offset <= offset) break;
    }
    return offset;
}

// Determine thr original offset given a computed offset
int64_t computed_offset_to_offset(const session_t *session_ptr, int64_t offset) {
    for (auto iter(session_ptr->changes_by_offset.begin()); iter != session_ptr->changes_by_offset.end(); ++iter) {
        if (session_ptr->changes[*iter].computed_offset <= offset) break;
        offset -= session_ptr->changes[*iter].num_bytes;
    }
    return offset;
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

// Write a segment of one file into another
int write_segment(FILE *from_file_ptr, int64_t offset, int64_t byte_count, FILE *to_file_ptr) {
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
    return 0;
}

// Save changes in the given session to the given file pointer
int save(const author_t *author_ptr, FILE *file_ptr) {
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
    for (auto iter(session_ptr->changes_by_offset.begin()); iter != session_ptr->changes_by_offset.end(); ++iter) {
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
    return 0;
}

viewport_t *add_viewport(const author_t *author_ptr, int32_t capacity, on_change_cbk cbk, void *user_data_ptr) {
    // TODO: Implement
    return nullptr;
}

// returns 1 if a change was found and undone and 0 if no change was found
int undo(const author_t *author_ptr) {
    int rc = 0;
    session_t *session_ptr = author_ptr->session_ptr;
    for (auto riter = session_ptr->changes.rbegin(); riter != session_ptr->changes.rend(); ++riter) {
        if (riter->author_ptr == author_ptr) {
            DBG(clog << "Undoing most recent change by '" << author_ptr->name << "'" << endl;);
            auto changes_by_pos_iter = find(session_ptr->changes_by_offset.begin(),
                                            session_ptr->changes_by_offset.end(), riter->serial);
            assert(changes_by_pos_iter != session_ptr->changes_by_offset.end());
            if (riter->num_bytes != 0) {
                // Change is an insert or delete, so adjust computed offsets to the changes following this one
                for (auto iter(changes_by_pos_iter + 1); iter != session_ptr->changes_by_offset.end(); ++iter) {
                    session_ptr->changes[*iter].computed_offset -= riter->num_bytes;
                }
            }
            session_ptr->computed_file_size -= riter->num_bytes;
            session_ptr->changes_by_offset.erase(changes_by_pos_iter);
            session_ptr->changes.erase(std::next(riter).base());
            rc = 1;
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
