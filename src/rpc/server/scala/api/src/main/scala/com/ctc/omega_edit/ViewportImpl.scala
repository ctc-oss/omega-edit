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

import com.ctc.omega_edit.api.Viewport
import jnr.ffi.Pointer
import com.ctc.omega_edit.api.ViewportCallback

private[omega_edit] class ViewportImpl(p: Pointer, i: FFI) extends Viewport {
  require(p != null, "native viewport pointer was null")

  def data: Array[Byte] = {
    val data = i.omega_viewport_get_data(p)
    val out = Array.ofDim[Byte](length.toInt)
    data.get(0, out, 0, length.toInt)
    out
  }

  def callback: Option[ViewportCallback] =
    Option(i.omega_viewport_get_event_cbk(p))

  def eventInterest: Int =
    i.omega_viewport_get_event_interest(p)

  def eventInterest_=(eventInterest: Int): Unit =
    i.omega_viewport_set_event_interest(p, eventInterest)

  def length: Long =
    i.omega_viewport_get_length(p)

  def offset: Long =
    i.omega_viewport_get_offset(p)

  def capacity: Long =
    i.omega_viewport_get_capacity(p)

  def move(offset: Long): Boolean =
    update(offset, capacity)

  def resize(capacity: Long): Boolean =
    update(offset, capacity)

  def update(offset: Long, capacity: Long): Boolean =
    i.omega_viewport_modify(p, offset, capacity, 0) == 0

  override def toString: String = data.mkString // TODO: probably render instead as hex

  def isFloating: Boolean = 
    i.omega_viewport_is_floating(p)
}
