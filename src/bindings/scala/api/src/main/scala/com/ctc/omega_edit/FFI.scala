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
import com.ctc.omega_edit.spi.{NativeInfoNotFound, PlatformInfoLoader, VersionMismatch}
import jnr.ffi.{LibraryLoader, Pointer}

import java.nio.file.{Files, Paths}
import java.util.logging.Logger

/**
  * Native contracts with the OmegaEdit shared library
  */
private[omega_edit] trait FFI {
  def omega_version_major(): Int
  def omega_version_minor(): Int
  def omega_version_patch(): Int

  def omega_edit_save(p: Pointer, path: String, overwrite: Boolean, opath: Pointer): Long
  def omega_edit_create_session(path: String, cb: SessionCallback, userData: Pointer): Pointer
  def omega_edit_insert(p: Pointer, offset: Long, s: String, len: Long): Long
  def omega_edit_insert_bytes(p: Pointer, offset: Long, b: Array[Byte], len: Long): Long
  def omega_edit_overwrite(p: Pointer, offset: Long, s: String, len: Long): Long
  def omega_edit_overwrite_bytes(p: Pointer, offset: Long, b: Array[Byte], len: Long): Long
  def omega_edit_delete(p: Pointer, offset: Long, len: Long): Long
  def omega_edit_create_viewport(
    p: Pointer,
    offset: Long,
    size: Long,
    cb: ViewportCallback,
    userData: Pointer,
    float: Int
    ): Pointer
    
  def omega_session_get_computed_file_size(p: Pointer): Long
  def omega_session_get_num_changes(p: Pointer): Long
  def omega_session_get_num_checkpoints(p: Pointer): Long
  def omega_session_get_num_undone_changes(p: Pointer): Long
  def omega_session_get_num_viewports(p: Pointer): Long

  def omega_viewport_get_data(p: Pointer): String
  def omega_viewport_get_length(p: Pointer): Long
  def omega_viewport_get_offset(p: Pointer): Long
  def omega_viewport_get_capacity(p: Pointer): Long
  def omega_viewport_update(p: Pointer, offset: Long, capacity: Long, floating: Int): Int

  def omega_change_get_serial(p: Pointer): Long
  def omega_change_get_offset(p: Pointer): Long
  def omega_change_get_length(p: Pointer): Long
  def omega_change_get_bytes(p: Pointer): String
  def omega_change_get_kind_as_char(p: Pointer): Byte
  def omega_session_get_change(p: Pointer, serial: Long): Pointer
}

/**
  * Provides the FFI, initialized from the native contract and the OmegaEdit shared library
  */
private[omega_edit] object FFI {
  private val nativeLibraryName = "omega_edit"
  private[omega_edit] lazy val i: FFI = {
    val logger = Logger.getLogger("omega-edit-ffi")
    val native = PlatformInfoLoader.load().getOrElse(throw NativeInfoNotFound(ApiBuildInfo.version))
    if (native.version != ApiBuildInfo.version) throw VersionMismatch(native.version, ApiBuildInfo.version)

    try {
      logger.fine(s"extracting ${native.sharedLibraryPath}")
      val bin = FFI.getClass.getClassLoader.getResourceAsStream(s"${native.sharedLibraryPath}")

      val tmpdir = Files.createTempDirectory(nativeLibraryName).toFile
      val tmpfile = Paths.get(tmpdir.toString, native.sharedLibraryName).toFile
      tmpfile.deleteOnExit()
      tmpdir.deleteOnExit()

      Files.copy(bin, tmpfile.toPath)
      logger.fine(s"loading ${native.sharedLibraryName} from ${tmpfile.toString}")

      val loader = LibraryLoader.create(classOf[FFI]).failImmediately()
      loader.search(tmpdir.getPath)
      loader.load(nativeLibraryName)
    } catch {
      case e: Exception =>
        throw new RuntimeException(s"Failed to load OmegaEdit native library from ${native.sharedLibraryPath}", e)
    }
  }
}
