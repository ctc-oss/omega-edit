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
import jnr.ffi.{LibraryLoader, Pointer}
import org.scijava.nativelib.NativeLoader

private[omega_edit] trait OmegaFFI extends OmegaEdit {
  def omega_version_major(): Int
  def omega_version_minor(): Int
  def omega_version_patch(): Int

  def omega_edit_create_session(path: String, cb: SessionCallback, userData: Pointer): Pointer
  def omega_session_get_computed_file_size(p: Pointer): Long
  def omega_edit_insert(p: Pointer, offset: Long, s: String, len: Long): Long
  def omega_edit_insert_bytes(p: Pointer, offset: Long, b: Array[Byte], len: Long): Long
  def omega_edit_overwrite(p: Pointer, offset: Long, s: String, len: Long): Long
  def omega_edit_overwrite_bytes(p: Pointer, offset: Long, b: Array[Byte], len: Long): Long
  def omega_edit_delete(p: Pointer, offset: Long, len: Long): Long
  def omega_edit_create_viewport(p: Pointer, offset: Long, size: Long, cb: ViewportCallback, userData: Pointer): Pointer

  def omega_viewport_get_data(p: Pointer): String
  def omega_viewport_get_length(p: Pointer): Long
  def omega_viewport_get_offset(p: Pointer): Long
  def omega_viewport_get_capacity(p: Pointer): Long
  def omega_viewport_update(p: Pointer, offset: Long, capacity: Long): Int

  def omega_change_get_serial(p: Pointer): Long
  def omega_change_get_offset(p: Pointer): Long
  def omega_change_get_length(p: Pointer): Long
  def omega_change_get_bytes(p: Pointer): String
  def omega_change_get_kind_as_char(p: Pointer): String
  def omega_session_get_change(p: Pointer, serial: Long): Pointer
}

object OmegaFFI {
  private val nativeLibraryName = "omega_edit"
  private[omega_edit] val i: OmegaFFI =
    try {
      NativeLoader.loadLibrary(nativeLibraryName)
      LibraryLoader.create(classOf[OmegaFFI]).failImmediately().load(nativeLibraryName)
    } catch {
      case e: Exception =>
        throw new RuntimeException("Failed to load Omega Edit native library", e)
    }
}
