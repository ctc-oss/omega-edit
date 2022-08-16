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
import com.ctc.omega_edit.grpc.Editors._
import com.ctc.omega_edit.api
import com.ctc.omega_edit.api.Session.OverwriteStrategy
import com.ctc.omega_edit.api.{Change, SessionCallback, ViewportCallback}
import omega_edit._

import java.nio.file.Path
import scala.util.{Failure, Success}
import com.google.protobuf.ByteString

object Session {
  type EventStream = Source[Session.Updated, NotUsed]
  trait Events {
    def stream: EventStream
  }

  trait Size {
    def computedSize: Long
  }

  trait SavedTo {
    def path: Path
  }

  def props(
      session: api.Session,
      events: EventStream,
      cb: SessionCallback
  ): Props =
    Props(new Session(session, events, cb))

  sealed trait Op
  object Op {
    def unapply(in: ChangeRequest): Option[Session.Op] =
      in.kind match {
        case ChangeKind.CHANGE_DELETE =>
          Some(Session.Delete(in.offset, in.length))
        case ChangeKind.CHANGE_INSERT =>
          Some(Session.Insert(EditorService.getData(in), in.offset))
        case ChangeKind.CHANGE_OVERWRITE =>
          Some(Session.Overwrite(EditorService.getData(in), in.offset))
        case _ => None
      }

  }
  case class Save(to: Path, overwrite: OverwriteStrategy) extends Op
  case class View(
      offset: Long,
      capacity: Long,
      id: Option[String],
      eventInterest: Option[Int]
  ) extends Op
  case class DestroyView(id: String) extends Op
  case object Watch extends Op
  case object GetSize extends Op
  case object GetNumCheckpoints extends Op
  case object GetNumChanges extends Op
  case object GetNumUndos extends Op
  case object GetNumViewports extends Op
  case object GetNumSearchContexts extends Op

  case class Delete(offset: Long, length: Long) extends Op
  case class Insert(data: String, offset: Long) extends Op
  case class Overwrite(data: String, offset: Long) extends Op

  case class LookupChange(id: Long) extends Op

  case class UndoLast() extends Op
  case class RedoUndo() extends Op
  case class ClearChanges() extends Op
  case class GetLastChange() extends Op
  case class GetLastUndo() extends Op

  case class Search(request: SearchRequest) extends Op

  case class Segment(request: SegmentRequest) extends Op

  case class PauseSession() extends Op
  case class ResumeSession() extends Op

  case class PauseViewportEvents() extends Op
  case class ResumeViewportEvents() extends Op

  case class Updated(id: String)

  trait Serial {
    def serial: Long
  }

  object Serial {
    def ok(sessionId: String, serial0: Long): Ok with Serial =
      new Ok(sessionId) with Serial {
        val serial = serial0
      }

    def paused(sessionId: String): Ok with Serial =
      new Ok(sessionId) with Serial {
        val serial: Long = 0L
      }
  }

  trait ChangeDetails {
    def change: Change

    def toChangeResponse(sessionId: String): ChangeDetailsResponse =
      ChangeDetailsResponse(
        sessionId,
        serial = change.id,
        kind = change.operation match {
          case api.Change.Delete    => ChangeKind.CHANGE_DELETE
          case api.Change.Insert    => ChangeKind.CHANGE_INSERT
          case api.Change.Overwrite => ChangeKind.CHANGE_OVERWRITE
          case api.Change.Undefined => ChangeKind.UNDEFINED_CHANGE
        },
        offset = change.offset,
        length = change.length,
        data = Option(ByteString.copyFrom(change.data))
      )

  }

  object ChangeDetails {
    def ok(sessionId: String, change0: Change): Ok with ChangeDetails =
      new Ok(sessionId) with ChangeDetails {
        val change = change0
      }
  }
}

class Session(
    session: api.Session,
    events: EventStream,
    @deprecated("unused", "") cb: SessionCallback
) extends Actor {
  val sessionId: String = self.path.name

  def receive: Receive = {
    case View(off, cap, id, eventInterest) =>
      import context.system
      val vid = id.getOrElse(Viewport.Id.uuid())
      val fqid = s"$sessionId:$vid"

      context.child(fqid) match {
        case Some(_) => sender() ! Err(Status.ALREADY_EXISTS)
        case None =>
          val (input, stream) = Source
            .queue[Viewport.Updated](1, OverflowStrategy.dropHead)
            .preMaterialize()
          val cb = ViewportCallback { (v, _, c) =>
            input.queue.offer(Viewport.Updated(fqid, v.data, c))
            ()
          }
          context.actorOf(
            Viewport.props(
              session.viewCb(off, cap, cb, eventInterest.getOrElse(0)),
              stream,
              cb
            ),
            vid
          )
          sender() ! Ok(fqid)
      }

    case DestroyView(vid) =>
      context.child(vid) match {
        case None => sender() ! Err(Status.NOT_FOUND)
        case Some(s) =>
          s ! PoisonPill
          sender() ! Ok(vid)
      }

    case Insert(data, offset) =>
      session.insert(data, offset) match {
        case Change.Changed(serial) =>
          sender() ! Serial.ok(sessionId, serial)
        case Change.Paused => sender() ! Serial.paused(sessionId)
        case Change.Fail   => sender() ! Err(Status.NOT_FOUND)
      }

    case Overwrite(data, offset) =>
      session.overwrite(data, offset) match {
        case Change.Changed(serial) =>
          sender() ! Serial.ok(sessionId, serial)
        case Change.Paused => sender() ! Serial.paused(sessionId)
        case Change.Fail   => sender() ! Err(Status.NOT_FOUND)
      }

    case Delete(offset, length) =>
      session.delete(offset, length) match {
        case Change.Changed(serial) =>
          sender() ! Serial.ok(sessionId, serial)
        case Change.Paused => sender() ! Serial.paused(sessionId)
        case Change.Fail   => sender() ! Err(Status.NOT_FOUND)
      }

    case LookupChange(id) =>
      session.findChange(id) match {
        case Some(c) =>
          sender() ! new Ok(s"$id") with ChangeDetails {
            def change: Change = c
          }
        case None => sender() ! Err(Status.NOT_FOUND)
      }

    case UndoLast() =>
      session.undoLast() match {
        case Change.Changed(serial) =>
          sender() ! Serial.ok(sessionId, serial)
        case Change.Paused => sender() ! Serial.paused(sessionId)
        case Change.Fail   => sender() ! Err(Status.NOT_FOUND)
      }

    case RedoUndo() =>
      session.redoUndo() match {
        case Change.Changed(serial) =>
          sender() ! Serial.ok(sessionId, serial)
        case Change.Paused => sender() ! Serial.paused(sessionId)
        case Change.Fail   => sender() ! Err(Status.NOT_FOUND)
      }

    case ClearChanges() =>
      session.clearChanges()
      sender() ! Ok(sessionId)

    case GetLastChange() =>
      session.getLastChange().fold(sender() ! Err(Status.NOT_FOUND)) { change =>
        sender() ! ChangeDetails.ok(sessionId, change)
      }

    case GetLastUndo() =>
      session.getLastUndo().fold(sender() ! Err(Status.NOT_FOUND)) { change =>
        sender() ! ChangeDetails.ok(sessionId, change)
      }

    case PauseSession() =>
      session.pauseSessionChanges()
      sender() ! Ok(sessionId)

    case ResumeSession() =>
      session.resumeSessionChanges()
      sender() ! Ok(sessionId)

    case PauseViewportEvents() =>
      session.pauseViewportEvents()
      sender() ! Ok(sessionId)

    case ResumeViewportEvents() =>
      session.resumeViewportEvents()
      sender() ! Ok(sessionId)

    case Watch =>
      sender() ! new Ok(sessionId) with Events {
        def stream: EventStream = events
      }

    case GetSize =>
      sender() ! new Ok(sessionId) with Size {
        def computedSize: Long = session.size
      }

    case GetNumChanges =>
      sender() ! new Ok(sessionId) with Size {
        def computedSize: Long = session.numChanges
      }

    case GetNumCheckpoints =>
      sender() ! new Ok(sessionId) with Size {
        def computedSize: Long = session.numCheckpoints
      }

    case GetNumUndos =>
      sender() ! new Ok(sessionId) with Size {
        def computedSize: Long = session.numUndos
      }

    case GetNumViewports =>
      sender() ! new Ok(sessionId) with Size {
        def computedSize: Long = session.numViewports
      }

    case GetNumSearchContexts =>
      sender() ! new Ok(sessionId) with Size {
        def computedSize: Long = session.numSearchContexts
      }

    case Save(to, overwrite) =>
      session.save(to, overwrite) match {
        case Success(actual) =>
          sender() ! new Ok(sessionId) with SavedTo {
            def path: Path = actual
          }
        case Failure(_) =>
          sender() ! Err(Status.UNKNOWN)
      }

    case Search(request) =>
      val isCaseInsensitive = request.isCaseInsensitive.getOrElse(false)
      val offset = request.offset.getOrElse(0L)

      sender() ! SearchResponse.of(
        sessionId,
        request.pattern,
        isCaseInsensitive,
        offset,
        request.length.getOrElse(0),
        session.search(
          request.pattern.toString,
          offset,
          request.length,
          isCaseInsensitive,
          request.limit
        )
      )

    case Segment(request) =>
      sender() ! session.getSegment(request.offset, request.length)
  }
}
