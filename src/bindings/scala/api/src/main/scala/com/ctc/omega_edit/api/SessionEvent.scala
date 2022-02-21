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

/**
  * Defines the types of events emitted by a session
  */
sealed trait SessionEvent
object SessionEvent {
  case object Undefined extends SessionEvent
  case object Create extends SessionEvent
  case object Edit extends SessionEvent
  case object Undo extends SessionEvent
  case object Clear extends SessionEvent
  case object Transform extends SessionEvent
  case object CreateCheckpoint extends SessionEvent
  case object DestroyCheckpoint extends SessionEvent
  case object Save extends SessionEvent

  private[api] def fromNative(v: Int): SessionEvent =
    v match {
      case 1   => Create
      case 2   => Edit
      case 4   => Undo
      case 8   => Clear
      case 16  => Transform
      case 32  => CreateCheckpoint
      case 64  => DestroyCheckpoint
      case 128 => Save
      case _   => Undefined
    }
}
