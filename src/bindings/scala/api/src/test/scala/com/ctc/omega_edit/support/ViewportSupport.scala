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

import com.ctc.omega_edit.api.{Change, Session, Viewport}

trait ViewportSupport {
  def view(offset: Long, capacity: Long, session: Session)(
      test: (Session, Viewport) => Unit): Unit =
    test(session, session.view(offset, capacity))

  trait WithCallback {
    def data: Option[String]
    def change: Option[Change]
  }

  def viewWithCallback(offset: Long, capacity: Long, session: Session)(
      test: (Session, WithCallback) => Unit): Unit = {
    var _data: Option[String] = None
    var _change: Option[Change] = None
    val cb = new WithCallback {
      def data: Option[String] = _data
      def change: Option[Change] = _change
    }
    session.viewCb(offset, capacity, (v, _, c) => {
      _data = Some(v.data)
      _change = c
    }, 0)
    test(session, cb)
  }
}
