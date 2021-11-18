//
// Created by Shearer, Davin on 11/17/21.
//

#ifndef OMEGA_EDIT_VIEWPORT_H
#define OMEGA_EDIT_VIEWPORT_H

#include "byte.h"
#include "fwd_defs.h"
#include <cstdint>

/** On viewport change callback.  This under-defined function will be called when an associated viewport changes. */
typedef void (*viewport_on_change_cbk_t)(const viewport_t *, const change_t *);

/**
 * Create a new viewport for the given author, returns a pointer to the new viewport
 * @param author_ptr author wanting the new viewport
 * @param offset offset for the new viewport
 * @param capacity desired capacity of the new viewport
 * @param cbk user-defined callback function called whenever the viewport gets updated
 * @param user_data_ptr pointer to user-defined data to associate with this new viewport
 * @param bit_offset bit offset for this viewport (0 - 7)
 * @return pointer to the new viewport, nullptr on failure
 */
viewport_t *create_viewport(const author_t *author_ptr, int64_t offset, int64_t capacity, viewport_on_change_cbk_t cbk,
                            void *user_data_ptr, byte_t bit_offset = 0);

/**
 * Given a viewport, return the author
 * @param viewport_ptr viewport to get the author from
 * @return viewport author
 */
const author_t *get_viewport_author(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport capacity
 * @param viewport_ptr viewport to get the capacity from
 * @return viewport capacity
 */
int64_t get_viewport_capacity(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport data length
 * @param viewport_ptr viewport to get the viewport data length from
 * @return viewport data length
 */
int64_t get_viewport_length(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport data
 * @param viewport_ptr viewport to get the viewport data from
 * @return viewport data
 */
const byte_t *get_viewport_data(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport computed offset
 * @param viewport_ptr viewport to get the viewport computed offset from
 * @return viewport computed offset
 */
int64_t get_viewport_computed_offset(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport user data
 * @param viewport_ptr viewport to get the user data from
 * @return viewport user data
 */
void *get_viewport_user_data(const viewport_t *viewport_ptr);

/**
 * Given a viewport, return the viewport bit offset
 * @param viewport_ptr viewport to get the bit offset from
 * @return viewport bit offset
 */
byte_t get_viewport_bit_offset(const viewport_t *viewport_ptr);

/**
 * Change viewport settings
 * @param viewport_ptr viewport to change settings on
 * @param offset offset for the viewport
 * @param capacity capacity of the viewport
 * @param bit_offset bit offset of the viewport
 * @return 0 on success, non-zero otherwise
 */
int update_viewport(viewport_t *viewport_ptr, int64_t offset, int64_t capacity, byte_t bit_offset = 0);

/**
 * Destroy a given viewport
 * @param viewport_ptr viewport to destroy
 * @return 0 of the viewport was successfully destroyed, and non-zero otherwise
 */
int destroy_viewport(const viewport_t *viewport_ptr);

#endif//OMEGA_EDIT_VIEWPORT_H
