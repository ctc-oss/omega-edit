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

private[omega_edit] class ViewportImpl(p: Pointer, i: FFI) extends Viewport {
  def data: String =
    i.omega_viewport_get_data(p)

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
    i.omega_viewport_update(p, offset, capacity, 0) == 0

  override def toString: String = data
}
