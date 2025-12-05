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

import org.apache.pekko.actor.ActorSystem
import com.google.protobuf.empty.Empty
import omega_edit._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AsyncWordSpecLike

import scala.concurrent.Future

class HeartbeatIntegrationSpec
    extends AsyncWordSpecLike
    with Matchers
    with EditorServiceSupport {

  "EditorService with HeartbeatRegistry" should useService { implicit service =>
    "accept heartbeat requests and register clients" in {
      val heartbeatRequest = HeartbeatRequest(
        hostname = "test-client",
        processId = 12345,
        heartbeatInterval = 5000,
        sessionIds = Seq.empty
      )

      service.getHeartbeat(heartbeatRequest).map { response =>
        response.timestamp should be > 0L
        response.uptime should be > 0L
        response.sessionCount shouldBe 0
        response.availableProcessors should be > 0
      }
    }

    "track sessions in heartbeat requests" in {
      for {
        session1 <- service.createSession(CreateSessionRequest.defaultInstance)
        session2 <- service.createSession(CreateSessionRequest.defaultInstance)
        heartbeatRequest = HeartbeatRequest(
          hostname = "test-client",
          processId = 12345,
          heartbeatInterval = 5000,
          sessionIds = Seq(session1.sessionId, session2.sessionId)
        )
        heartbeatResponse <- service.getHeartbeat(heartbeatRequest)
      } yield {
        heartbeatResponse.sessionCount shouldBe 2
        heartbeatResponse.timestamp should be > 0L
      }
    }

    "handle multiple clients with different sessions" in {
      for {
        session1 <- service.createSession(CreateSessionRequest.defaultInstance)
        session2 <- service.createSession(CreateSessionRequest.defaultInstance)
        session3 <- service.createSession(CreateSessionRequest.defaultInstance)
        heartbeat1 = HeartbeatRequest(
          hostname = "client1",
          processId = 111,
          heartbeatInterval = 5000,
          sessionIds = Seq(session1.sessionId)
        )
        heartbeat2 = HeartbeatRequest(
          hostname = "client2",
          processId = 222,
          heartbeatInterval = 5000,
          sessionIds = Seq(session2.sessionId, session3.sessionId)
        )
        response1 <- service.getHeartbeat(heartbeat1)
        response2 <- service.getHeartbeat(heartbeat2)
        sessionCount <- service.getSessionCount(Empty())
      } yield {
        response1.timestamp should be > 0L
        response2.timestamp should be > 0L
        sessionCount.count shouldBe 3L
      }
    }

    "allow client to update session list via heartbeat" in {
      for {
        session1 <- service.createSession(CreateSessionRequest.defaultInstance)
        heartbeat1 = HeartbeatRequest(
          hostname = "test-client",
          processId = 12345,
          heartbeatInterval = 5000,
          sessionIds = Seq(session1.sessionId)
        )
        _ <- service.getHeartbeat(heartbeat1)
        session2 <- service.createSession(CreateSessionRequest.defaultInstance)
        heartbeat2 = HeartbeatRequest(
          hostname = "test-client",
          processId = 12345,
          heartbeatInterval = 5000,
          sessionIds = Seq(session1.sessionId, session2.sessionId)
        )
        response <- service.getHeartbeat(heartbeat2)
        sessionCount <- service.getSessionCount(Empty())
      } yield {
        response.sessionCount shouldBe 2
        sessionCount.count shouldBe 2L
      }
    }
  }
}
