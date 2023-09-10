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

import org.apache.pekko
import pekko.NotUsed
import pekko.actor.{Actor, Props}
import pekko.stream.OverflowStrategy
import pekko.stream.scaladsl.Source
import io.grpc.Status
import com.ctc.omega_edit.grpc.Session._
import com.ctc.omega_edit.grpc.Editors._
import com.ctc.omega_edit.api
import com.ctc.omega_edit.api.{Change, SessionCallback, ViewportCallback}
import omega_edit._

import java.nio.file.Path
import scala.collection.immutable.ArraySeq
import scala.util.{Failure, Success}
import com.google.protobuf.ByteString

import scala.annotation.unused

object Session {
  type EventStream = Source[SessionEvent, NotUsed]
  trait Events {
    def stream: EventStream
  }

  trait Count {
    def count: Long
  }

  trait SavedTo {
    def path: Path
    def status: Int
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
          in.data.map(Session.Insert(_, in.offset))
        case ChangeKind.CHANGE_OVERWRITE =>
          in.data.map(Session.Overwrite(_, in.offset))
        case _ => None
      }

  }

  case class Save(to: Path, flags: Int, offset: Long, length: Long) extends Op

  case class View(
      offset: Long,
      capacity: Long,
      isFloating: Boolean,
      id: Option[String]
  ) extends Op

  case object Destroy extends Op

  case class Watch(eventInterest: Option[Int]) extends Op
  case object Unwatch extends Op

  case object GetSize extends Op
  case object GetNumCheckpoints extends Op
  case object GetNumChanges extends Op
  case object GetNumUndos extends Op
  case object GetNumChangeTransactions extends Op
  case object GetNumUndoTransactions extends Op
  case object GetNumViewports extends Op
  case object GetNumSearchContexts extends Op

  case class Delete(offset: Long, length: Long) extends Op
  case class Insert(data: ByteString, offset: Long) extends Op
  case class Overwrite(data: ByteString, offset: Long) extends Op

  case class LookupChange(id: Long) extends Op

  case class UndoLast() extends Op
  case class RedoUndo() extends Op
  case class ClearChanges() extends Op
  case class GetLastChange() extends Op
  case class GetLastUndo() extends Op

  case class Profile(request: SegmentRequest) extends Op
  case class CharCount(request: SegmentRequest) extends Op

  case class Search(request: SearchRequest) extends Op

  case class Segment(request: SegmentRequest) extends Op

  case class PauseSession() extends Op
  case class ResumeSession() extends Op

  case class PauseViewportEvents() extends Op
  case class ResumeViewportEvents() extends Op

  case class BeginTransaction() extends Op
  case class EndTransaction() extends Op

  case object NotifyChangedViewports extends Op

  trait Serial {
    def serial: Long
  }

  object Serial {
    def ok(sessionId: String, serial0: Long): Ok with Serial =
      new Ok(sessionId) with Serial {
        val serial: Long = serial0
      }
  }

  trait CheckpointDirectory {
    def checkpointDirectory: Path
    def fileSize: Long
    def bom: String
  }

  object CheckpointDirectory {
    def ok(sessionId: String, checkpointDirectory0: Path, size: Long, bom0: String): Ok with CheckpointDirectory =
      new Ok(sessionId) with CheckpointDirectory {
        val checkpointDirectory: Path = checkpointDirectory0
        val fileSize: Long = size
        val bom: String = bom0
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
        val change: Change = change0
      }
  }
}

class Session(
    session: api.Session,
    events: EventStream,
    @unused cb: SessionCallback // need to keep a reference to the callback to prevent it from being GC'd
) extends Actor {
  val sessionId: String = self.path.name

  def receive: Receive = {

    case View(off, cap, isFloating, id) =>
      import context.system
      val vid = id.getOrElse(Viewport.Id.uuid())
      val fqid = s"$sessionId:$vid"

      context.child(fqid) match {
        case Some(_) =>
          sender() ! Err(Status.ALREADY_EXISTS)
        case None =>
          val (input, stream) = Source
            .queue[ViewportEvent](8, OverflowStrategy.backpressure)
            .preMaterialize() // preMaterialize the queue to obtain the input and stream objects
          val cb = ViewportCallback { (v, e, c) =>
            input.queue.offer(
              ViewportEvent(
                sessionId = fqid,
                viewportId = vid,
                serial = c.map(_.id),
                data = Option(ByteString.copyFrom(v.data)),
                length = Some(v.data.size.toLong),
                offset = Some(off),
                viewportEventKind = ViewportEventKind.fromValue(e.value)
              )
            )
            ()
          }
          context.actorOf(
            Viewport
              .props(session.viewCb(off, cap, isFloating, cb), stream, cb),
            vid
          )
          sender() ! Ok(fqid)
      }

    case Destroy =>
      session.destroy()
      sender() ! Ok(sessionId)

    case Insert(data, offset) =>
      session.insert(data.toByteArray, offset) match {
        case Change.Changed(serial) =>
          sender() ! Serial.ok(sessionId, serial)
      }

    case Overwrite(data, offset) =>
      session.overwrite(data.toByteArray, offset) match {
        case Change.Changed(serial) =>
          sender() ! Serial.ok(sessionId, serial)
      }

    case Delete(offset, length) =>
      session.delete(offset, length) match {
        case Change.Changed(serial) =>
          sender() ! Serial.ok(sessionId, serial)
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
      }

    case RedoUndo() =>
      session.redoUndo() match {
        case Change.Changed(serial) =>
          sender() ! Serial.ok(sessionId, serial)
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

    case BeginTransaction() =>
      session.beginTransaction
      sender() ! Ok(sessionId)

    case EndTransaction() =>
      session.endTransaction
      sender() ! Ok(sessionId)

    case NotifyChangedViewports =>
      sender() ! new Ok(sessionId) with Count {
        def count: Long = session.notifyChangedViewports.toLong
      }

    case Watch(eventInterest) =>
      session.eventInterest = eventInterest.getOrElse(api.SessionEvent.Interest.All)
      sender() ! new Ok(sessionId) with Events {
        def stream: EventStream = events
      }

    case Unwatch =>
      println(s"Unwatch sessionId $sessionId")
      session.eventInterest = 0
      sender() ! Ok(sessionId)

    case GetSize =>
      sender() ! new Ok(sessionId) with Count {
        def count: Long = session.size
      }

    case GetNumChanges =>
      sender() ! new Ok(sessionId) with Count {
        def count: Long = session.numChanges
      }

    case GetNumCheckpoints =>
      sender() ! new Ok(sessionId) with Count {
        def count: Long = session.numCheckpoints
      }

    case GetNumUndos =>
      sender() ! new Ok(sessionId) with Count {
        def count: Long = session.numUndos
      }

    case GetNumViewports =>
      sender() ! new Ok(sessionId) with Count {
        def count: Long = session.numViewports
      }

    case GetNumChangeTransactions =>
      sender() ! new Ok(sessionId) with Count {
        def count: Long = session.numChangeTransactions
      }

    case GetNumUndoTransactions =>
      sender() ! new Ok(sessionId) with Count {
        def count: Long = session.numUndoTransactions
      }

    case GetNumSearchContexts =>
      sender() ! new Ok(sessionId) with Count {
        def count: Long = session.numSearchContexts
      }

    case Save(to, flags, offset, length) =>
      session.save(to, flags, offset, length) match {
        case Success(actual) =>
          sender() ! new Ok(sessionId) with SavedTo {
            def path: Path = actual._1
            def status: Int = actual._2
          }
        case Failure(_) =>
          sender() ! Err(Status.UNKNOWN)
      }

    case Profile(request) =>
      val offset = request.offset
      val length = request.length
      session.profile(offset, length) match {
        case Right(profileArray) =>
          sender() ! ByteFrequencyProfileResponse.of(
            sessionId,
            offset,
            length,
            ArraySeq.unsafeWrapArray(profileArray)
          )
        case Left(errorCode) =>
          sender() ! Err(Status.UNKNOWN.withDescription(s"Profile function failed with error code: $errorCode"))
      }

    case CharCount(request) =>
      val offset = request.offset
      val length = request.length
      session.charCount(offset, length) match {
        case Right(charCounts) =>
          sender() ! CharacterCountResponse.of(
            sessionId,
            offset,
            length,
            charCounts.bom,
            charCounts.bomBytes,
            charCounts.singleByteChars,
            charCounts.doubleByteChars,
            charCounts.tripleByteChars,
            charCounts.quadByteChars,
            charCounts.invalidBytes
          )
        case Left(errorCode) =>
          sender() ! Err(Status.UNKNOWN.withDescription(s"CharCount function failed with error code: $errorCode"))
      }

    case Search(request) =>
      val isCaseInsensitive = request.isCaseInsensitive.getOrElse(false)
      val isReverse = request.isReverse.getOrElse(false)
      val offset = request.offset.getOrElse(0L)
      val length = request.length.getOrElse(0L)
      sender() ! SearchResponse.of(
        sessionId,
        request.pattern,
        isCaseInsensitive,
        isReverse,
        offset,
        length,
        session.search(
          request.pattern.toByteArray,
          offset,
          length,
          isCaseInsensitive,
          isReverse,
          request.limit
        )
      )

    case Segment(request) =>
      sender() ! session.getSegment(request.offset, request.length)
  }
}
