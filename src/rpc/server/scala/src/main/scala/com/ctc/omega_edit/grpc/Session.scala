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

package com.ctc.omega_edit.grpc

import akka.NotUsed
import akka.actor.{Actor, PoisonPill, Props}
import akka.stream.OverflowStrategy
import akka.stream.scaladsl.Source
import io.grpc.Status
import com.ctc.omega_edit.grpc.Session._
import com.ctc.omega_edit.grpc.Editors.{Err, Ok}
import com.ctc.omega_edit.api
import com.ctc.omega_edit.api.{Change, SessionCallback, ViewportCallback}

import java.nio.file.Path

object Session {
  type EventStream = Source[Session.Updated, NotUsed]
  trait Events {
    def stream: EventStream
  }

  trait Size {
    def computedSize: Long
  }

  def props(session: api.Session, events: EventStream, cb: SessionCallback): Props =
    Props(new Session(session, events, cb))

  trait Op
  case class Save(to: Path) extends Op
  case class View(offset: Long, capacity: Long, id: Option[String]) extends Op
  case class DestroyView(id: String) extends Op
  case object Watch extends Op
  case object GetSize extends Op

  case class Push(data: String) extends Op
  case class Delete(offset: Long, length: Long) extends Op
  case class Insert(data: String, offset: Long) extends Op
  case class Overwrite(data: String, offset: Long) extends Op

  case class Updated(id: String)

  case class LookupChange(id: Long) extends Op
  trait ChangeDetails {
    def change: Change
  }
}

class Session(session: api.Session, events: EventStream, cb: SessionCallback) extends Actor {
  val sessionId: String = self.path.name

  def receive: Receive = {
    case View(off, cap, id) =>
      import context.system
      val vid = id.getOrElse(Viewport.Id.uuid())
      val fqid = s"$sessionId-$vid"

      context.child(fqid) match {
        case Some(_) => sender() ! Err(Status.ALREADY_EXISTS)
        case None =>
          val (input, stream) = Source.queue[Viewport.Updated](1, OverflowStrategy.dropHead).preMaterialize()
          val cb = ViewportCallback((v, e, c) => input.queue.offer(Viewport.Updated(fqid, v.data, c)))
          context.actorOf(Viewport.props(session.viewCb(off, cap, cb), stream, cb), vid)
          sender() ! Ok(fqid)
      }

    case DestroyView(vid) =>
      context.child(vid) match {
        case None => sender() ! Err(Status.NOT_FOUND)
        case Some(s) =>
          s ! PoisonPill
          sender() ! Ok(vid)
      }

    case Push(data) =>
      session.insert(data, 0)
      sender() ! Ok(sessionId)

    case Insert(data, offset) =>
      session.insert(data, offset)
      sender() ! Ok(sessionId)

    case Overwrite(data, offset) =>
      session.overwrite(data, offset)
      sender() ! Ok(sessionId)

    case Delete(offset, length) =>
      session.delete(offset, length)
      sender() ! Ok(sessionId)

    case LookupChange(id) =>
      session.findChange(id) match {
        case Some(c) =>
          new Ok(s"$id") with ChangeDetails {
            def change: Change = c
          }
        case None => sender() ! Err(Status.NOT_FOUND)
      }

    case Watch =>
      sender() ! new Ok(sessionId) with Events {
        def stream: EventStream = events
      }

    case GetSize =>
      sender() ! new Ok(sessionId) with Size {
        def computedSize: Long = session.size
      }
  }
}
