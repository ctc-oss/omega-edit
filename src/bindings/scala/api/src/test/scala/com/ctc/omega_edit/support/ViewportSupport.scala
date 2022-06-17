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

package com.ctc.omega_edit.support

import com.ctc.omega_edit.api._

trait ViewportSupport {
  def view(offset: Long, capacity: Long, session: Session)(
      test: (Session, Viewport) => Unit
  ): Unit =
    test(session, session.view(offset, capacity))

  class WithCallback(
      var data: Option[String] = None,
      var event: Option[ViewportEvent] = None,
      var change: Option[Change] = None,
  ) {
    override def toString(): String = s"WithCallback($data, $event, $change)"
  }

  def viewWithCallback(offset: Long, capacity: Long, session: Session)(
      test: (Session, WithCallback) => Unit
  ): Unit = {
    val cb = new WithCallback()
    session.viewCb(
      offset,
      capacity,
      (v, e, c) => {
        cb.data = Some(v.data)
        cb.event = Some(e)
        cb.change = c
      },
      ViewportEvent.Interest.All
    )
    test(session, cb)
  }
}
