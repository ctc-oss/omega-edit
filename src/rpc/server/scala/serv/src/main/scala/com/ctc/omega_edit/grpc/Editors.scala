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

import akka.actor.{Actor, ActorLogging, Props}
import akka.pattern.gracefulStop
import akka.stream.OverflowStrategy
import akka.stream.scaladsl.Source
import akka.util.Timeout
import com.ctc.omega_edit.api.{OmegaEdit, SessionCallback}
import com.google.protobuf.ByteString
import io.grpc.Status
import omega_edit._

import java.nio.file.Path
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.util.{Failure, Success}

/** The Editors actor manages the backend Sessions
  */
object Editors {
  def props(): Props = Props(new Editors)

  case class Find(id: String)
  case class Create(
      id: Option[String],
      path: Option[Path]
  )
  case class DestroyActor(id: String, timeout: Timeout)
  case class DestroyActors()
  case object SessionCount

  ///

  case class SessionOp(id: String, op: Session.Op)
  case class ViewportOp(sid: String, vid: String, op: Viewport.Op)

  case class LogOp(level: String, message: Throwable)

  sealed trait Result
  case class Ok(id: String) extends Result
  case class Err(reason: Status) extends Result

  trait ViewportData {
    def data: ByteString
    def offset: Long
    def followingByteCount: Long
  }

  trait BooleanResult {
    def result: Boolean
  }

  private def idFor(path: Option[Path]): String =
    path match {
      case None    => UUID.randomUUID().toString
      case Some(p) => Base64.getEncoder.encodeToString(p.toString.getBytes)
    }
}

class Editors extends Actor with ActorLogging {
  import Editors._
  implicit val timeout: Timeout = Timeout(5.seconds)

  def receive: Receive = {
    case Create(sid, path) =>
      val id = sid.getOrElse(idFor(path))
      context.child(id) match {
        case Some(_) =>
          sender() ! Err(Status.ALREADY_EXISTS)
        case None =>
          import context.system
          val (input, stream) = Source
            .queue[SessionEvent](8, OverflowStrategy.backpressure)
            .preMaterialize()
          val cb = SessionCallback { (session, event, change) =>
            input.queue.offer(
              SessionEvent.defaultInstance
                .copy(
                  sessionId = id,
                  sessionEventKind = SessionEventKind.fromValue(event.value),
                  serial = change.map(_.id),
                  computedFileSize = session.size,
                  changeCount = session.numChanges,
                  undoCount = session.numUndos
                )
            )
            ()
          }
          context.actorOf(
            Session.props(
              OmegaEdit.newSessionCb(path, cb),
              stream,
              cb
            ),
            id
          )
          sender() ! Ok(id)
      }

    case Find(id) =>
      sender() ! context.child(id)

    case DestroyActor(id, t) =>
      context.child(id) match {
        case None => sender() ! Err(Status.NOT_FOUND)
        case Some(s) =>
          val replyTo = sender()
          gracefulStop(s, t.duration).onComplete(_ => replyTo ! Ok(id))(
            context.dispatcher
          )
      }

    case DestroyActors() =>
      context.children.foreach(c => DestroyActor(c.toString, timeout.duration))

    case SessionCount =>
      sender() ! context.children.size

    case SessionOp(id, op) =>
      context.child(id) match {
        case None =>
          sender() ! Err(Status.NOT_FOUND.withDescription("session not found"))
        case Some(s) => s forward op
      }

    case ViewportOp(sid, vid, op) =>
      val replyTo = sender()
      context.child(sid) match {
        case None =>
        case Some(s) =>
          context
            .actorSelection(s.path / vid)
            .resolveOne()
            .onComplete {
              case Success(v) => v.tell(op, replyTo)
              case Failure(_) => replyTo ! Err(Status.NOT_FOUND)
            }(context.dispatcher)
      }

    case LogOp(logType, error) =>
      logType.toLowerCase match {
        case "debug"            => log.debug(error.toString)
        case "info"             => log.info(error.toString)
        case "warn" | "warning" => log.warning(error.toString)
        case "error"            => log.debug(error.toString)
        case _                  => ()
      }
  }
}
