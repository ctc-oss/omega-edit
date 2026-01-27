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

import com.google.protobuf.empty.Empty
import com.typesafe.config.ConfigFactory
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.pattern.{after => pekkoAfter}
import omega_edit._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AsyncWordSpecLike

import scala.concurrent.Future
import scala.concurrent.duration._

class HeartbeatTimeoutSpec extends AsyncWordSpecLike with Matchers {
  private def withService[T](test: EditorService => Future[T]): Future[T] = {
    val cfg = ConfigFactory
      .parseString(
        """
          |omega-edit.grpc.heartbeat.session-timeout = 1s
          |omega-edit.grpc.heartbeat.cleanup-interval = 100ms
          |omega-edit.grpc.heartbeat.shutdown-when-no-sessions = false
          |""".stripMargin
      )
      .withFallback(ConfigFactory.load())

    implicit val system: ActorSystem = ActorSystem("HeartbeatTimeoutSpec", cfg)
    val service = new EditorService()

    test(service).andThen { case _ =>
      system.terminate()
      ()
    }(system.dispatcher)
  }

  "heartbeat reaper" should {
    "destroy sessions that stop being heartbeated" in withService { service =>
      import service.system.dispatcher

      for {
        _ <- service.createSession(CreateSessionRequest.defaultInstance)
        _ <- pekkoAfter(2.seconds, service.system.scheduler)(Future.successful(()))
        count1 <- service.getSessionCount(Empty())
        _ = count1.count shouldBe 0L
      } yield succeed
    }

    "keep sessions alive when heartbeats arrive" in withService { service =>
      import service.system.dispatcher

      for {
        created <- service.createSession(CreateSessionRequest.defaultInstance)
        sid = created.sessionId
        _ <- pekkoAfter(500.millis, service.system.scheduler)(Future.successful(()))
        _ <- service.getHeartbeat(
          HeartbeatRequest(
            hostname = "test",
            processId = 123,
            heartbeatInterval = 100,
            sessionIds = Seq(sid)
          )
        )
        _ <- pekkoAfter(500.millis, service.system.scheduler)(Future.successful(()))
        count1 <- service.getSessionCount(Empty())
        _ = count1.count shouldBe 1L
        _ <- pekkoAfter(2.seconds, service.system.scheduler)(Future.successful(()))
        count2 <- service.getSessionCount(Empty())
        _ = count2.count shouldBe 0L
      } yield succeed
    }
  }
}
