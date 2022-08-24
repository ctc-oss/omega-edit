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
import akka.actor.{Actor, ActorLogging, Props}
import akka.stream.scaladsl.Source
import com.ctc.omega_edit.api
import com.ctc.omega_edit.api.{Change, ViewportCallback}
import com.ctc.omega_edit.grpc.Editors.{Data, Ok}
import com.ctc.omega_edit.grpc.Viewport.{EventStream, Events, Get, Watch}
import com.google.protobuf.ByteString
import omega_edit.ObjectId

import java.util.UUID

object Viewport {
  type EventStream = Source[Viewport.Updated, NotUsed]
  trait Events {
    def stream: EventStream
  }

  def props(view: api.Viewport, stream: EventStream, cb: ViewportCallback) =
    Props(new Viewport(view, stream, cb))

  case class Id(session: String, view: String)
  object Id {
    def unapply(oid: ObjectId): Option[(String, String)] =
      oid.id.split(":") match {
        case Array(s, v) => Some((s, v))
        case _           => None
      }

    def uuid(): String = UUID.randomUUID().toString
  }

  trait Op
  case object Get extends Op
  case object Watch extends Op
  case class Updated(id: String, data: String, offset: Long, change: Option[Change])
}

class Viewport(
    view: api.Viewport,
    events: EventStream,
    @deprecated("unused", "") cb: ViewportCallback
) extends Actor
    with ActorLogging {
  val viewportId: String = self.path.name

  def receive: Receive = {
    case Get =>
      sender() ! new Ok(viewportId) with Data {
        def data: ByteString = ByteString.copyFromUtf8(view.data)
        def offset: Long = view.offset
      }

    case Watch =>
      sender() ! new Ok(viewportId) with Events {
        def stream: EventStream = events
      }
  }
}
