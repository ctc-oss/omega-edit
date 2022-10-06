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

import com.ctc.omega_edit.api
import com.ctc.omega_edit.api.{Change, OmegaEdit, Session, SessionEvent}

import java.nio.file.Path
import scala.io.Source
import scala.util.Using

trait SessionSupport {
  def emptySession(test: api.Session => Unit): Unit =
    test(OmegaEdit.newSession(None))

  def session(bytes: Array[Byte])(test: api.Session => Unit): Unit = {
    val s = OmegaEdit.newSession(None)
    s.insert(bytes, 0)
    test(s)
  }

  def session(string: String)(test: api.Session => Unit): Unit =
    session(string.getBytes())(test)

  trait WithCallback {
    def event: Option[SessionEvent]
    def change: Option[Option[Change]]
  }

  def emptySessionWithCallback(test: (Session, WithCallback) => Unit): Unit = {
    var _event: Option[SessionEvent] = None
    var _change: Option[Option[Change]] = None

    val cb = new WithCallback {
      def event: Option[SessionEvent] = _event
      def change: Option[Option[Change]] = _change
    }
    val session = OmegaEdit.newSessionCb(
      None,
      (_, e, c) => {
        _event = Some(e)
        _change = Some(c)
      }
    )
    session.eventInterest = SessionEvent.Interest.All
    test(session, cb)
  }

  def fileContents(at: Path): String = Using(Source.fromFile(at.toFile))(source => source.mkString).get
}
