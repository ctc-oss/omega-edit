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

package com.ctc.omega_edit.api

import enumeratum.values._

/** Defines the types of events emitted by a viewport
  */
sealed abstract class ViewportEvent(val value: Int) extends IntEnumEntry
object ViewportEvent extends IntEnum[ViewportEvent] {
  case object Undefined extends ViewportEvent(0)
  case object Create extends ViewportEvent(1)
  case object Edit extends ViewportEvent(2)
  case object Undo extends ViewportEvent(4)
  case object Clear extends ViewportEvent(8)
  case object Transform extends ViewportEvent(16)
  case object Modify extends ViewportEvent(32)

  val values = findValues

  object Interest {
    val None = 0
    val All = ~0
  }
}
