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
  * Defines the types of events emitted by a viewport
  */
sealed trait ViewportEvent
object ViewportEvent {
  case object Undefined extends ViewportEvent
  case object Create extends ViewportEvent
  case object Edit extends ViewportEvent
  case object Undo extends ViewportEvent
  case object Clear extends ViewportEvent
  case object Transform extends ViewportEvent
  case object Updated extends ViewportEvent

  private[api] def fromNative(v: Int): ViewportEvent =
    v match {
      case 1 => Create
      case 2 => Edit
      case 4 => Undo
      case 8 => Clear
      case 16 => Transform
      case 32 => Updated
      case _ => Undefined
    }
}
