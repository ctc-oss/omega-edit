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
import com.ctc.omega_edit.spi.{
  NativeInfoNotFound,
  PlatformInfoLoader,
  VersionMismatch
}
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

  def omega_edit_save(
      p: Pointer,
      path: String,
      overwrite: Boolean,
      opath: Pointer
  ): Long
  def omega_edit_create_session(
      path: String,
      cb: SessionCallback,
      userData: Pointer,
      eventInterest: Int
  ): Pointer
  def omega_edit_insert(p: Pointer, offset: Long, s: String, len: Long): Long
  def omega_edit_insert_bytes(
      p: Pointer,
      offset: Long,
      b: Array[Byte],
      len: Long
  ): Long
  def omega_edit_overwrite(p: Pointer, offset: Long, s: String, len: Long): Long
  def omega_edit_overwrite_bytes(
      p: Pointer,
      offset: Long,
      b: Array[Byte],
      len: Long
  ): Long
  def omega_edit_delete(p: Pointer, offset: Long, len: Long): Long
  def omega_edit_undo_last_change(p: Pointer): Long
  def omega_edit_redo_last_undo(p: Pointer): Long
  def omega_edit_create_viewport(
      p: Pointer,
      offset: Long,
      size: Long,
      isFloating: Boolean,
      cb: ViewportCallback,
      userData: Pointer,
      eventInterest: Int
  ): Pointer

  // session

  def omega_session_get_change(p: Pointer, serial: Long): Pointer
  def omega_session_get_computed_file_size(p: Pointer): Long
  def omega_session_get_event_cbk(p: Pointer): SessionCallback
  def omega_session_get_event_interest(p: Pointer): Int
  def omega_session_get_num_changes(p: Pointer): Long
  def omega_session_get_num_checkpoints(p: Pointer): Long
  def omega_session_get_num_undone_changes(p: Pointer): Long
  def omega_session_get_num_viewports(p: Pointer): Long
  def omega_session_get_segment(session: Pointer, segment: Pointer, offset: Long): Int
  def omega_session_get_segment_string(session: Pointer, offset: Long, length: Long): String
  def omega_session_set_event_interest(p: Pointer, eventInterest: Int): Int

  // viewport

  def omega_viewport_get_data(p: Pointer): String
  def omega_viewport_get_event_cbk(p: Pointer): ViewportCallback
  def omega_viewport_get_event_interest(p: Pointer): Int
  def omega_viewport_get_length(p: Pointer): Long
  def omega_viewport_get_offset(p: Pointer): Long
  def omega_viewport_get_capacity(p: Pointer): Long
  def omega_viewport_set_event_interest(p: Pointer, eventInterest: Int): Int
  def omega_viewport_update(
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
      caseInsensitive: Boolean
  ): Pointer

  /** @param p
    * @param pattern
    * @param patternLength
    *   if 0, the length is computed from `pattern`
    * @param offset
    * @param length
    *   if 0, computed from the offset and length of the session
    * @param caseInsensitive
    * @return
    */
  def omega_search_create_context(
      p: Pointer,
      pattern: String,
      patternLength: Long,
      offset: Long,
      length: Long,
      caseInsensitive: Boolean
  ): Pointer
  def omega_search_context_get_offset(p: Pointer): Long
  def omega_search_context_get_length(p: Pointer): Long
  def omega_search_next_match(p: Pointer, advanceContext: Long): Int
  def omega_search_destroy_context(p: Pointer): Unit

  // segment

  def omega_segment_create(capacity: Long): Pointer
  def omega_segment_get_capacity(p: Pointer): Long
  def omega_segment_get_length(p: Pointer): Long
  def omega_segment_get_offset(p: Pointer): Long
  def omega_segment_get_offset_adjustment(p: Pointer): Long
  def omega_segment_get_data(p: Pointer): String
  def omega_segment_destroy(p: Pointer): Unit

  // find

  def omega_find_create_skip_table(needle: String, needleLength: Long): Pointer
  def omega_find(
      haystack: String,
      length: Long,
      p: Pointer,
      needle: String,
      needleLength: Long
  ): String
  def omega_find_destroy_skip_table(p: Pointer): Unit
}

/** Provides the FFI, initialized from the native contract and the OmegaEdit
  * shared library
  */
private[omega_edit] object FFI {
  private val nativeLibraryName = "omega_edit"
  private[omega_edit] lazy val i: FFI = {
    val logger = Logger.getLogger("omega-edit-ffi")
    val native = PlatformInfoLoader
      .load()
      .getOrElse(throw NativeInfoNotFound(ApiBuildInfo.version))
    if (native.version != ApiBuildInfo.version)
      throw VersionMismatch(native.version, ApiBuildInfo.version)

    try {
      logger.fine(s"extracting ${native.sharedLibraryPath}")
      val bin = FFI.getClass.getClassLoader.getResourceAsStream(
        s"${native.sharedLibraryPath}"
      )

      val tmpdir = Files.createTempDirectory(nativeLibraryName).toFile
      val tmpfile = Paths.get(tmpdir.toString, native.sharedLibraryName).toFile
      tmpfile.deleteOnExit()
      tmpdir.deleteOnExit()

      Files.copy(bin, tmpfile.toPath)
      logger.fine(
        s"loading ${native.sharedLibraryName} from ${tmpfile.toString}"
      )

      val loader = LibraryLoader.create(classOf[FFI]).failImmediately()
      loader.search(tmpdir.getPath)
      loader.load(nativeLibraryName)
    } catch {
      case e: Exception =>
        throw new RuntimeException(
          s"Failed to load OmegaEdit native library from ${native.sharedLibraryPath}",
          e
        )
    }
  }
}
