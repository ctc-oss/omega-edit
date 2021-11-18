//
// Created by Shearer, Davin on 11/17/21.
//

#include "../include/viewport.h"
#include "../include/session.h"
#include "impl_/author_def.h"
#include "impl_/data_segment_def.h"
#include "impl_/internal_fun.h"
#include "impl_/session_def.h"
#include "impl_/viewport_def.h"

const author_t *get_viewport_author(const viewport_t *viewport_ptr) { return viewport_ptr->author_ptr; }

int64_t get_viewport_capacity(const viewport_t *viewport_ptr) { return viewport_ptr->data_segment.capacity; }

int64_t get_viewport_length(const viewport_t *viewport_ptr) { return viewport_ptr->data_segment.length; }

int64_t get_viewport_computed_offset(const viewport_t *viewport_ptr) { return viewport_ptr->data_segment.offset; }

void *get_viewport_user_data(const viewport_t *viewport_ptr) { return viewport_ptr->user_data_ptr; }

byte_t get_viewport_bit_offset(const viewport_t *viewport_ptr) { return viewport_ptr->bit_offset; }

viewport_t *create_viewport(const author_t *author_ptr, int64_t offset, int64_t capacity, viewport_on_change_cbk_t cbk,
                            void *user_data_ptr, byte_t bit_offset) {
    const auto session_ptr = author_ptr->session_ptr;
    if (capacity > 0 and capacity <= get_session_viewport_max_capacity(session_ptr)) {
        const auto viewport_ptr = std::shared_ptr<viewport_t>(new viewport_t);
        viewport_ptr->author_ptr = author_ptr;
        viewport_ptr->data_segment.offset = offset;
        viewport_ptr->data_segment.capacity = capacity;
        viewport_ptr->data_segment.length = 0;
        viewport_ptr->data_segment.data.bytes =
                (viewport_ptr->data_segment.capacity < 8) ? nullptr : std::make_unique<byte_t[]>(capacity);
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
        if (viewport_ptr->data_segment.offset != offset || viewport_ptr->data_segment.capacity != capacity ||
            viewport_ptr->bit_offset != bit_offset) {
            viewport_ptr->data_segment.offset = offset;
            viewport_ptr->data_segment.capacity = capacity;
            viewport_ptr->data_segment.data.bytes = (capacity < 8) ? nullptr : std::make_unique<byte_t[]>(capacity);
            viewport_ptr->bit_offset = bit_offset;

            // Update viewport and call the on change callback
            populate_viewport_(viewport_ptr);
            viewport_callback_(viewport_ptr, nullptr);
        }
        return 0;
    }
    return -1;
}

const byte_t *get_viewport_data(const viewport_t *viewport_ptr) {
    return get_data_segment_data_(const_cast<data_segment_t *>(&viewport_ptr->data_segment));
}
