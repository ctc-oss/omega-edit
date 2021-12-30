/**********************************************************************************************************************
 * Copyright (c) 2021-2022 Concurrent Technologies Corporation.                                                       *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"): you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed under the License is            *
 * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                   *
 * implied.  See the License for the specific language governing permissions and limitations under the License.       *
 *                                                                                                                    *
 **********************************************************************************************************************/

package org.ctc.omegaedit

import jnr.ffi.LibraryLoader

trait omega_edit {
  def omega_license_get(): String
  def omega_change_get_offset(jarg1: Long): Long
  def omega_change_get_length(jarg1: Long): Long
  def omega_change_get_serial(jarg1: Long): Long
  def omega_change_get_kind_as_char(jarg1: Long): String
  def omega_change_get_bytes(jarg1: Long): Long
  def omega_change_is_undone(jarg1: Long): Int
  def omega_check_model(jarg1: Long): Int
  def OMEGA_VIEWPORT_CAPACITY_LIMIT_get(): Int
  def OMEGA_SEARCH_PATTERN_LENGTH_LIMIT_get(): Int
  def omega_edit_create_session(jarg1: String, jarg2: Long, jarg3: Long): Long
  def omega_edit_destroy_session(jarg1: Long): Unit
  def omega_edit_create_viewport(jarg1: Long, jarg2: Long, jarg3: Long, jarg4: Long, jarg5: Long): Unit
  def omega_edit_destroy_viewport(jarg1: Long): Unit
  def omega_edit_clear_changes(jarg1: Long): Int
  def omega_edit_undo_last_change(jarg1: Long): Long
  def omega_edit_redo_last_undo(jarg1: Long): Long
  def omega_edit_save(jarg1: Long, jarg2: String): Int
  def omega_edit_delete(jarg1: Long, jarg2: Long, jarg3: Long): Long
  def omega_edit_insert_bytes(jarg1: Long, jarg2: Long, jarg3: Long, jarg4: Long): Long
  def omega_edit_insert(jarg1: Long, jarg2: Long, jarg3: String, jarg4: Long): Long
  def omega_edit_overwrite_bytes(jarg1: Long, jarg2: Long, jarg3: Long, jarg4: Long): Long
  def omega_edit_overwrite(jarg1: Long, jarg2: Long, jarg3: String, jarg4: Long): Long
  def omega_search_create_context_bytes(jarg1: Long, jarg2: Long, jarg3: Long, jarg4: Long, jarg5: Long, jarg6: Int): Long
  def omega_search_create_context(jarg1: Long, jarg2: String, jarg3: Long, jarg4: Long, jarg5: Long, jarg6: Int): Long
  def omega_search_context_get_offset(jarg1: Long): Long
  def omega_search_context_get_length(jarg1: Long): Long
  def omega_search_next_match(jarg1: Long, jarg2: Long): Int
  def omega_search_destroy_context(jarg1: Long): Unit
  def omega_session_get_file_path(jarg1: Long): String
  def omega_session_get_user_data(jarg1: Long): Long
  def omega_session_get_num_viewports(jarg1: Long): Long
  def omega_session_get_num_changes(jarg1: Long): Long
  def omega_session_get_num_undone_changes(jarg1: Long): Long
  def omega_session_get_computed_file_size(jarg1: Long): Long
  def omega_session_get_last_change(jarg1: Long): Long
  def omega_session_get_last_undo(jarg1: Long): Long
  def omega_session_get_change(jarg1: Long, jarg2: Long): Long
  def omega_session_viewport_on_change_callbacks_paused(jarg1: Long): Int
  def omega_session_pause_viewport_on_change_callbacks(jarg1: Long): Unit
  def omega_session_resume_viewport_on_change_callbacks(jarg1: Long): Unit
  def omega_change_get_string(jarg1: Long): String
  def omega_viewport_get_string(jarg1: Long): String
  def omega_edit_insert_string(jarg1: Long, jarg2: Long, jarg3: String): Long
  def omega_edit_overwrite_string(jarg1: Long, jarg2: Long, jarg3: String): Long
  def omega_version_major(): Int
  def omega_version_minor(): Int
  def omega_version_patch(): Int
  def omega_version(): Int
  def omega_viewport_get_session(jarg1: Long): Long
  def omega_viewport_get_capacity(jarg1: Long): Long
  def omega_viewport_get_length(jarg1: Long): Long
  def omega_viewport_get_data(jarg1: Long): Long
  def omega_viewport_has_changes(jarg1: Long): Int
  def omega_viewport_get_offset(jarg1: Long): Long
  def omega_viewport_get_user_data(jarg1: Long): Long
  def omega_viewport_update(jarg1: Long, jarg2: Long, jarg3: Long): Int
  def omega_viewport_execute_on_change(jarg1: Long, jarg2: Long): Unit
  def omega_visit_changes(jarg1: Long, jarg2: Long, jarg3: Long): Int
  def omega_visit_changes_reverse(jarg1: Long, jarg2: Long, jarg3: Long): Int
  def omega_visit_change_create_context(jarg1: Long, jarg2: Int): Long
  def omega_visit_change_next(jarg1: Long): Int
  def omega_visit_change_context_get_change(jarg1: Long): Long
  def omega_visit_change_destroy_context(jarg1: Long): Unit
  def delete_SessionOnChangeDirector(jarg1: Long): Unit
  def new_SessionOnChangeDirector(): Long
  def delete_OmegaViewportOnChangeDirector(jarg1: Long): Unit
  def new_OmegaViewportOnChangeDirector(): Long
}

object OmegaEdit {
  lazy val omega_edit = LibraryLoader.create(classOf[omega_edit]).load("omega_edit")
}
