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

import enumeratum.values.IntEnumEntry
import enumeratum.values.IntEnum

/**
  * Defines the types of events emitted by a session
  */
sealed abstract class SessionEvent(val value: Int) extends IntEnumEntry
object SessionEvent extends IntEnum[SessionEvent] {
  case object Undefined extends SessionEvent(0)
  case object Create extends SessionEvent(1)
  case object Edit extends SessionEvent(2)
  case object Undo extends SessionEvent(4)
  case object Clear extends SessionEvent(8)
  case object Transform extends SessionEvent(16)
  case object CreateCheckpoint extends SessionEvent(32)
  case object DestroyCheckpoint extends SessionEvent(64)
  case object Save extends SessionEvent(128)

  val values = findValues

  object Interest {
    val None = 0
    val All = ~0
  }
}
