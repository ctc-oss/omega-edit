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

import com.ctc.omega_edit.api.Change.{Changed, Result}
import com.ctc.omega_edit.api.Session.OverwriteStrategy
import com.ctc.omega_edit.api.Session.OverwriteStrategy.{
  GenerateFilename,
  OverwriteExisting
}
import com.ctc.omega_edit.api.{Change, Session, Viewport, ViewportCallback}
import jnr.ffi.Pointer

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.nio.file.{Path, Paths}
import scala.util.{Failure, Success, Try}

private[omega_edit] class SessionImpl(p: Pointer, i: FFI) extends Session {
  require(p != null, "native session pointer was null")

  def isEmpty: Boolean =
    size == 0

  def size: Long =
    i.omega_session_get_computed_file_size(p)

  def delete(offset: Long, len: Long): Result =
    Edit(i.omega_edit_delete(p, offset, len))

  def insert(b: Array[Byte], offset: Long): Result =
    Edit(i.omega_edit_insert_bytes(p, offset, b, 0))

  def insert(s: String, offset: Long): Result =
    Edit(i.omega_edit_insert(p, offset, s, 0))

  def overwrite(b: Array[Byte], offset: Long): Result =
    Edit(i.omega_edit_overwrite_bytes(p, offset, b, 0))

  def overwrite(s: String, offset: Long): Result =
    Edit(i.omega_edit_overwrite(p, offset, s, 0))

  def view(offset: Long, size: Long): Viewport = {
    val vp = i.omega_edit_create_viewport(p, offset, size, false, null, null, 0)
    new ViewportImpl(vp, i)
  }

  def viewCb(offset: Long, size: Long, cb: ViewportCallback): Viewport = {
    val vp = i.omega_edit_create_viewport(p, offset, size, false, cb, null, 0)
    new ViewportImpl(vp, i)
  }

  def findChange(id: Long): Option[Change] =
    i.omega_session_get_change(p, id) match {
      case null => None
      case ptr  => Some(new ChangeImpl(ptr, i))
    }

  def save(to: Path): Try[Path] =
    save(to, OverwriteExisting)

  def save(to: Path, onExists: OverwriteStrategy): Try[Path] = {
    // todo;; obtain an accurate and portable number here
    val buffer = ByteBuffer.allocate(4096)
    val overwrite = onExists match {
      case OverwriteExisting => true
      case GenerateFilename  => false
    }
    i.omega_edit_save(
      p,
      to.toString,
      overwrite,
      Pointer.wrap(p.getRuntime, buffer)
    ) match {
      case 0 =>
        val path = StandardCharsets.UTF_8.decode(buffer)
        Success(Paths.get(path.toString.trim))

      case ec =>
        Failure(new RuntimeException(s"Failed to save session to file, $ec"))
    }
  }
}

private object Edit {
  def apply(op: => Long): Change.Result =
    op match {
      case 0 => Change.Fail
      case v => Changed(v)
    }
}
