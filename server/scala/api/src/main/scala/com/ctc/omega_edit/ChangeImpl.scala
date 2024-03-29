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

private[omega_edit] class ChangeImpl(p: Pointer, i: FFI) extends Change {
  require(p != null, "native change pointer was null")

  lazy val id: Long = i.omega_change_get_serial(p)

  lazy val offset: Long = i.omega_change_get_offset(p)

  lazy val length: Long = i.omega_change_get_length(p)

  lazy val data: Array[Byte] = {
    val dataPointer = Option(i.omega_change_get_bytes(p))
    dataPointer match {
      case Some(pointer) =>
        val dataArray = new Array[Byte](length.toInt)
        pointer.get(0, dataArray, 0, length.toInt) // Read the data into the byte array
        dataArray
      case None =>
        throw new IllegalStateException("Data pointer for change is null")
    }
  }

  lazy val operation: Change.Op = i.omega_change_get_kind_as_char(p).toChar match {
    case 'D' => Change.Delete
    case 'I' => Change.Insert
    case 'O' => Change.Overwrite
    case _   => Change.Undefined
  }
}
