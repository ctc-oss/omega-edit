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
import com.ctc.omega_edit.api.{Change, Session, Viewport, ViewportCallback}
import jnr.ffi.Pointer

private[omega_edit] class SessionImpl(p: Pointer, i: OmegaFFI) extends Session {
  def isEmpty: Boolean =
    size == 0

  def size: Long =
    i.omega_session_get_computed_file_size(p)

  def push(s: Array[Byte]): Result =
    Edit(i.omega_edit_insert_bytes(p, 0, s, 0))

  def push(s: String): Result =
    Edit(i.omega_edit_insert(p, 0, s, 0))

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
    val vp = i.omega_edit_create_viewport(p, offset, size, null, null)
    new ViewportImpl(vp, i)
  }

  def viewCb(offset: Long, size: Long, cb: ViewportCallback): Viewport = {
    val vp = i.omega_edit_create_viewport(p, offset, size, cb, null)
    new ViewportImpl(vp, i)
  }

  def findChange(id: Long): Option[Change] = i.omega_session_get_change(p, id) match {
    case null => None
    case ptr  => Some(new ChangeImpl(ptr, i))
  }
}

private object Edit {
  def apply(op: => Long): Change.Result =
    op match {
      case 0 => Change.Fail
      case v => Changed(v)
    }
}
