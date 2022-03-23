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

import akka.actor.{Actor, ActorLogging, PoisonPill, Props}
import akka.stream.OverflowStrategy
import akka.stream.scaladsl.Source
import akka.util.Timeout
import com.google.protobuf.ByteString
import io.grpc.Status
import com.ctc.omega_edit.api
import com.ctc.omega_edit.api.{OmegaEdit, SessionCallback}

import java.nio.file.Path
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.util.{Failure, Success}

/** The Editors actor manages the backend Sessions
  */
object Editors {
  def props() = Props(new Editors)

  case class Find(id: String)
  case class Create(id: Option[String], path: Option[Path])
  case class Destroy(id: String)

  ///

  case class SessionOp(id: String, op: Session.Op)
  case class ViewportOp(sid: String, vid: String, op: Viewport.Op)

  sealed trait Result
  case class Ok(id: String) extends Result
  case class Err(reason: Status) extends Result

  trait Data {
    def data: ByteString
  }

  private def idFor(path: Option[Path]): String = path match {
    case None    => UUID.randomUUID().toString.take(8)
    case Some(p) => Base64.getEncoder.encodeToString(p.toString.getBytes)
  }

  private def sessionFor(path: Option[Path], cb: SessionCallback): api.Session =
    OmegaEdit.newSessionCb(path, cb)
}

class Editors extends Actor with ActorLogging {
  import Editors._
  implicit val timeout = Timeout(1.second)

  def receive: Receive = {
    case Create(sid, path) =>
      val id = sid.getOrElse(idFor(path))
      context.child(id) match {
        case Some(_) =>
          sender() ! Err(Status.ALREADY_EXISTS)
        case None =>
          import context.system
          val (input, stream) = Source
            .queue[Session.Updated](1, OverflowStrategy.dropHead)
            .preMaterialize()
          val cb = SessionCallback { (_, _, _) =>
            input.queue.offer(Session.Updated(id))
            ()
          }
          context.actorOf(Session.props(sessionFor(path, cb), stream, cb), id)
          sender() ! Ok(id)
      }

    case Find(id) =>
      sender() ! context.child(id)

    case Destroy(id) =>
      context.child(id) match {
        case None => sender() ! Err(Status.NOT_FOUND)
        case Some(s) =>
          s ! PoisonPill
          sender() ! Ok(id)
      }

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
  }
}
