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

import com.ctc.omega_edit.{ChangeImpl, FFI, ViewportImpl}
import jnr.ffi.Pointer
import jnr.ffi.annotations.Delegate

/** Provides callbacks on viewport changes.
  *
  * @see
  *   https://github.com/ctc-oss/omega-edit/wiki/What-is-%CE%A9edit#event-callbacks for how to interpret the data passed
  *   to callbacks.
  */
trait ViewportCallback {
  @Delegate private[api] final def invoke(
      v: Pointer,
      e: Int,
      c: Pointer
  ): Unit = {
    // Only VIEWPORT_EVT_EDIT and VIEWPORT_EVT_UNDO have change pointers.
    val change = e match {
      case ViewportEvent.Edit.value | ViewportEvent.Undo.value =>
        Some(new ChangeImpl(c, FFI.i))
      case _ => None
    }
    handle(new ViewportImpl(v, FFI.i), ViewportEvent.withValue(e), change)
  }

  /** Called on a Viewport change
    *
    * @param v
    *   Viewport
    * @param e
    *   ViewportEvent
    * @param change
    *   Option[Change]
    */
  def handle(v: Viewport, e: ViewportEvent, change: Option[Change]): Unit
}

object ViewportCallback {

  /** Create a new callback with the provided function.
    * @param cb
    *   The callback function
    * @return
    *   ViewportCallback
    */
  def apply(
      cb: (Viewport, ViewportEvent, Option[Change]) => Unit
  ): ViewportCallback =
    (v: Viewport, e: ViewportEvent, change: Option[Change]) => cb(v, e, change)
}
