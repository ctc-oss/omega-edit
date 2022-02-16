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

import com.ctc.omega_edit.api.Change
import jnr.ffi.Pointer

private[omega_edit] class ChangeImpl(p: Pointer, i: OmegaFFI) extends Change {
  lazy val id: Long = i.omega_change_get_serial(p)

  lazy val offset: Long = i.omega_change_get_offset(p)

  lazy val length: Long = i.omega_viewport_get_length(p)

  def data(): Array[Byte] = i.omega_change_get_bytes(p).getBytes()

  lazy val operation: Change.Op = i.omega_change_get_kind_as_char(p) match {
    case "D" => Change.Delete
    case "I" => Change.Insert
    case "O" => Change.Overwrite
    case _   => Change.Undefined
  }
}
