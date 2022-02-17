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

import com.ctc.omega_edit.{ChangeImpl, OmegaFFI, ViewportImpl}
import jnr.ffi.Pointer
import jnr.ffi.annotations.Delegate

trait ViewportCallback {
  @Delegate def invoke(p: Pointer, c: Pointer): Unit = {
    val change = c.address() match {
      case 0 | 1 | 2 => None
      case _         => Some(new ChangeImpl(c, OmegaFFI.i))
    }
    handle(new ViewportImpl(p, OmegaFFI.i), change)
  }

  def handle(v: Viewport, change: Option[Change]): Unit
}

object ViewportCallback {
  def apply(cb: (Viewport, Option[Change]) => Unit): ViewportCallback =
    (v: Viewport, change: Option[Change]) => cb(v, change)
}
