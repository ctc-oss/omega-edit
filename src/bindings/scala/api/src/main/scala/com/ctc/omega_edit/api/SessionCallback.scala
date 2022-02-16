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

import com.ctc.omega_edit.{lib, OmegaFFI, SessionImpl}
import jnr.ffi.Pointer
import jnr.ffi.annotations.Delegate

import scala.annotation.nowarn

trait SessionCallback {
  @Delegate def invoke(p: Pointer, @nowarn e: Pointer, @nowarn c: Pointer): Unit =
    handle(new SessionImpl(p, lib.omega.asInstanceOf[OmegaFFI]))

  def handle(v: Session): Unit
}

object SessionCallback {
  def apply(cb: (Session) => Unit): SessionCallback =
    (v: Session) => cb(v)
}
