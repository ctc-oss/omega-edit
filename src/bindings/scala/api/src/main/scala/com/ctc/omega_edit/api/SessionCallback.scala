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

import com.ctc.omega_edit.{ChangeImpl, FFI, SessionImpl}
import jnr.ffi.Pointer
import jnr.ffi.annotations.Delegate

/**
  * Provides callbacks on session changes.
  */
trait SessionCallback {
  @Delegate private[api] final def invoke(s: Pointer, e: Int, c: Pointer): Unit = {
    val change = c match {
      case null => None
      case _    => Some(new ChangeImpl(c, FFI.i))
    }
    handle(new SessionImpl(s, FFI.i), SessionEvent.fromNative(e), change)
  }

  /**
    * Called on a Session change
    * @param v SessionCallback
    * @param e SessionEvent
    * @param change Option[Change]
    */
  def handle(v: Session, e: SessionEvent, change: Option[Change]): Unit
}

object SessionCallback {

  /**
    * Create a new callback with the provided function.
    * @param cb The callback function
    * @return SessionCallback
    */
  def apply(cb: (Session, SessionEvent, Option[Change]) => Unit): SessionCallback =
    (v: Session, e: SessionEvent, c: Option[Change]) => cb(v, e, c)
}
