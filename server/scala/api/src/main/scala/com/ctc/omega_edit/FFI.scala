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

package com.ctc.omega_edit

import com.ctc.omega_edit.api._
import com.ctc.omega_edit.spi.{NativeBuildInfo, NativeInfoNotFound, PlatformInfoLoader, VersionMismatch}
import jnr.ffi.{LibraryLoader, Pointer}

import java.nio.file.{Files, Paths}
import java.util.logging.Logger

/** Native contracts with the OmegaEdit shared library
  */
private[omega_edit] trait FFI {

  // version info

  def omega_version_major(): Int
  def omega_version_minor(): Int
  def omega_version_patch(): Int

  // editing

  def omega_edit_save_segment(
      p: Pointer,
      path: String,
      flags: Int,
      opath: Pointer,
      offset: Long,
      length: Long
  ): Int

  def omega_edit_create_session(
      path: String,
      cb: SessionCallback,
      userData: Pointer,
      eventInterest: Int,
      chkptDir: String
  ): Pointer

  def omega_edit_destroy_session(p: Pointer): Unit

  def omega_edit_insert_bytes(
      p: Pointer,
      offset: Long,
      b: Array[Byte],
      len: Long
  ): Long
  def omega_edit_overwrite_bytes(
      p: Pointer,
      offset: Long,
      b: Array[Byte],
      len: Long
  ): Long
  def omega_edit_delete(p: Pointer, offset: Long, len: Long): Long
  def omega_edit_undo_last_change(p: Pointer): Long
  def omega_edit_redo_last_undo(p: Pointer): Long
  def omega_edit_clear_changes(p: Pointer): Long

  def omega_edit_create_viewport(
      p: Pointer,
      offset: Long,
      size: Long,
      isFloating: Boolean,
      cb: ViewportCallback,
      userData: Pointer,
      eventInterest: Int
  ): Pointer

  def omega_edit_destroy_viewport(p: Pointer): Unit

  // session

  def omega_session_get_change(p: Pointer, serial: Long): Pointer
  def omega_session_get_computed_file_size(p: Pointer): Long
  def omega_session_get_event_cbk(p: Pointer): SessionCallback
  def omega_session_get_event_interest(p: Pointer): Int
  def omega_session_get_last_change(p: Pointer): Pointer
  def omega_session_get_last_undo(p: Pointer): Pointer
  def omega_session_get_num_changes(p: Pointer): Long
  def omega_session_get_checkpoint_directory(p: Pointer): String
  def omega_session_get_num_checkpoints(p: Pointer): Long
  def omega_session_get_num_undone_changes(p: Pointer): Long
  def omega_session_get_num_viewports(p: Pointer): Long
  def omega_session_get_num_search_contexts(p: Pointer): Long
  def omega_session_get_segment(
      session: Pointer,
      segment: Pointer,
      offset: Long
  ): Int
  def omega_session_set_event_interest(p: Pointer, eventInterest: Int): Int
  def omega_session_pause_changes(p: Pointer): Unit
  def omega_session_resume_changes(p: Pointer): Unit
  def omega_session_pause_viewport_event_callbacks(p: Pointer): Unit
  def omega_session_resume_viewport_event_callbacks(p: Pointer): Unit
  def omega_session_notify_changed_viewports(p: Pointer): Int
  def omega_session_begin_transaction(p: Pointer): Int
  def omega_session_end_transaction(p: Pointer): Int
  def omega_session_get_num_change_transactions(p: Pointer): Long
  def omega_session_get_num_undone_change_transactions(p: Pointer): Long
  def omega_session_detect_BOM(p: Pointer, offset: Long): Int
  def omega_util_BOM_to_string(bom: Int): String
  def omega_util_string_to_BOM(bom: String): Int
  def omega_util_BOM_size(bom: Int): Long

  def omega_session_byte_frequency_profile(
      p: Pointer,
      profile: Array[Long],
      offset: Long,
      length: Long
  ): Int
  def omega_character_counts_create(): Pointer
  def omega_character_counts_destroy(p: Pointer): Unit
  def omega_character_counts_set_BOM(p: Pointer, bom: Int): Pointer
  def omega_character_counts_get_BOM(p: Pointer): Int
  def omega_character_counts_bom_bytes(p: Pointer): Long
  def omega_character_counts_single_byte_chars(p: Pointer): Long
  def omega_character_counts_double_byte_chars(p: Pointer): Long
  def omega_character_counts_triple_byte_chars(p: Pointer): Long
  def omega_character_counts_quad_byte_chars(p: Pointer): Long
  def omega_character_counts_invalid_bytes(p: Pointer): Long
  def omega_session_character_counts(
      p: Pointer,
      counts: Pointer,
      offset: Long,
      length: Long,
      bom: Int
  ): Int

  // viewport

  def omega_viewport_has_changes(p: Pointer): Boolean
  def omega_viewport_get_data(p: Pointer): Pointer
  def omega_viewport_get_event_cbk(p: Pointer): ViewportCallback
  def omega_viewport_get_event_interest(p: Pointer): Int
  def omega_viewport_get_length(p: Pointer): Long
  def omega_viewport_get_offset(p: Pointer): Long
  def omega_viewport_get_capacity(p: Pointer): Long
  def omega_viewport_get_following_byte_count(p: Pointer): Long
  def omega_viewport_is_floating(p: Pointer): Boolean
  def omega_viewport_get_session(p: Pointer): Pointer
  def omega_viewport_set_event_interest(p: Pointer, eventInterest: Int): Int
  def omega_viewport_modify(
      p: Pointer,
      offset: Long,
      capacity: Long,
      floating: Int
  ): Int

  // changes

  def omega_change_get_serial(p: Pointer): Long
  def omega_change_get_offset(p: Pointer): Long
  def omega_change_get_length(p: Pointer): Long
  def omega_change_get_bytes(p: Pointer): String
  def omega_change_get_kind_as_char(p: Pointer): Byte

  // search

  def omega_search_create_context_bytes(
      p: Pointer,
      pattern: Array[Byte],
      patternLength: Long,
      offset: Long,
      length: Long,
      caseInsensitive: Boolean,
      reverseSearch: Boolean
  ): Pointer

  /** @param p
    * @param pattern
    * @param patternLength
    *   if 0, the length is computed from `pattern`
    * @param offset
    * @param length
    *   if 0, computed from the offset and length of the session
    * @param caseInsensitive
    * @param reverseSearch
    * @return
    */
  def omega_search_create_context(
      p: Pointer,
      pattern: String,
      patternLength: Long,
      offset: Long,
      length: Long,
      caseInsensitive: Boolean,
      reverseSearch: Boolean
  ): Pointer
  def omega_search_context_get_match_offset(p: Pointer): Long
  def omega_search_context_get_pattern_length(p: Pointer): Long
  def omega_search_next_match(p: Pointer, advanceContext: Long): Int
  def omega_search_destroy_context(p: Pointer): Unit

  // segment

  def omega_segment_create(capacity: Long): Pointer
  def omega_segment_get_capacity(p: Pointer): Long
  def omega_segment_get_length(p: Pointer): Long
  def omega_segment_get_offset(p: Pointer): Long
  def omega_segment_get_offset_adjustment(p: Pointer): Long
  def omega_segment_get_data(p: Pointer): Pointer
  def omega_segment_destroy(p: Pointer): Unit

  // find

  def omega_find_create_skip_table(needle: String, needleLength: Long, reverseSearch: Boolean): Pointer
  def omega_find(
      haystack: String,
      length: Long,
      p: Pointer,
      needle: String,
      needleLength: Long
  ): String
  def omega_find_destroy_skip_table(p: Pointer): Unit
}

/** Provides the FFI, initialized from the native contract and the OmegaEdit shared library
  */
private[omega_edit] object FFI {
  private[omega_edit] lazy val i: FFI = {
    val logger = Logger.getLogger("omega-edit-ffi")
    val native = PlatformInfoLoader
      .load()
      .getOrElse(throw NativeInfoNotFound(ApiBuildInfo.version))
    if (native.version != ApiBuildInfo.version)
      throw VersionMismatch(native.version, ApiBuildInfo.version)

    lazy val sharedLibraryPath = NativeBuildInfo.getSharedLibraryPath(native)
    lazy val sharedLibraryName = NativeBuildInfo.sharedLibraryName

    try {
      logger.fine(s"extracting ${sharedLibraryPath}")
      val bin = FFI.getClass.getClassLoader.getResourceAsStream(
        s"${sharedLibraryPath}"
      )

      val tmpdir = Files.createTempDirectory(nativeLibraryName).toFile
      val tmpfile = Paths.get(tmpdir.toString, sharedLibraryName).toFile
      tmpfile.deleteOnExit()
      tmpdir.deleteOnExit()

      Files.copy(bin, tmpfile.toPath)
      logger.fine(
        s"loading ${sharedLibraryName} from ${tmpfile.toString}"
      )

      val loader = LibraryLoader.create(classOf[FFI]).failImmediately()
      loader.search(tmpdir.getPath)
      loader.load(nativeLibraryName)
    } catch {
      case e: Exception =>
        throw new RuntimeException(
          s"Failed to load OmegaEdit native library from ${sharedLibraryPath}",
          e
        )
    }
  }
  private val nativeLibraryName = "omega_edit"
}
