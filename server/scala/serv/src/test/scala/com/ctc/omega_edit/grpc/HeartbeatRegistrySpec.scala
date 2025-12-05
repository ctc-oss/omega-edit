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

import org.apache.pekko.actor.{ActorRef, ActorSystem}
import org.apache.pekko.pattern.ask
import org.apache.pekko.testkit.{ImplicitSender, TestKit, TestProbe}
import org.apache.pekko.util.Timeout
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpecLike

import scala.concurrent.Await
import scala.concurrent.duration._

class HeartbeatRegistrySpec
    extends TestKit(ActorSystem("HeartbeatRegistrySpec"))
    with ImplicitSender
    with AnyWordSpecLike
    with Matchers
    with BeforeAndAfterAll {

  implicit val timeout: Timeout = Timeout(5.seconds)

  override def afterAll(): Unit = {
    TestKit.shutdownActorSystem(system)
  }

  "HeartbeatRegistry" should {
    "register new clients" in {
      val editorsProbe = TestProbe()
      val registry = system.actorOf(
        HeartbeatRegistry.props(editorsProbe.ref, timeoutMillis = 10000)(system.dispatcher)
      )

      registry ! HeartbeatRegistry.RegisterClient("client1", Seq("session1", "session2"))

      val count = Await.result(
        (registry ? HeartbeatRegistry.GetClientCount).mapTo[HeartbeatRegistry.ClientCount],
        1.second
      )
      count.count shouldBe 1
    }

    "update existing clients on heartbeat" in {
      val editorsProbe = TestProbe()
      val registry = system.actorOf(
        HeartbeatRegistry.props(editorsProbe.ref, timeoutMillis = 10000)(system.dispatcher)
      )

      registry ! HeartbeatRegistry.RegisterClient("client1", Seq("session1"))
      // Allow time for first registration to process
      editorsProbe.expectNoMessage(100.millis)
      registry ! HeartbeatRegistry.RegisterClient("client1", Seq("session1", "session2"))

      val count = Await.result(
        (registry ? HeartbeatRegistry.GetClientCount).mapTo[HeartbeatRegistry.ClientCount],
        1.second
      )
      count.count shouldBe 1
    }

    "unregister clients and cleanup sessions" in {
      val editorsProbe = TestProbe()
      val registry = system.actorOf(
        HeartbeatRegistry.props(editorsProbe.ref, timeoutMillis = 10000)(system.dispatcher)
      )

      registry ! HeartbeatRegistry.RegisterClient("client1", Seq("session1", "session2"))
      registry ! HeartbeatRegistry.UnregisterClient("client1")

      // Verify session cleanup messages were sent
      editorsProbe.expectMsg(Editors.SessionOp("session1", Session.Destroy))
      editorsProbe.expectMsg(Editors.SessionOp("session2", Session.Destroy))

      val count = Await.result(
        (registry ? HeartbeatRegistry.GetClientCount).mapTo[HeartbeatRegistry.ClientCount],
        1.second
      )
      count.count shouldBe 0
    }

    "detect and cleanup timed-out clients" in {
      val editorsProbe = TestProbe()
      // Use a very short timeout for testing
      val registry = system.actorOf(
        HeartbeatRegistry.props(editorsProbe.ref, timeoutMillis = 500)(system.dispatcher)
      )

      registry ! HeartbeatRegistry.RegisterClient("client1", Seq("session1"))

      // Directly trigger the timeout check after registering the client
      registry ! HeartbeatRegistry.CheckTimeouts

      // Verify session cleanup happened
      editorsProbe.expectMsg(2.seconds, Editors.SessionOp("session1", Session.Destroy))

      val count = Await.result(
        (registry ? HeartbeatRegistry.GetClientCount).mapTo[HeartbeatRegistry.ClientCount],
        1.second
      )
      count.count shouldBe 0
    }

    "handle multiple clients independently" in {
      val editorsProbe = TestProbe()
      val registry = system.actorOf(
        HeartbeatRegistry.props(editorsProbe.ref, timeoutMillis = 10000)(system.dispatcher)
      )

      registry ! HeartbeatRegistry.RegisterClient("client1", Seq("session1"))
      registry ! HeartbeatRegistry.RegisterClient("client2", Seq("session2"))
      registry ! HeartbeatRegistry.RegisterClient("client3", Seq("session3"))

      val count1 = Await.result(
        (registry ? HeartbeatRegistry.GetClientCount).mapTo[HeartbeatRegistry.ClientCount],
        1.second
      )
      count1.count shouldBe 3

      registry ! HeartbeatRegistry.UnregisterClient("client2")
      editorsProbe.expectMsg(Editors.SessionOp("session2", Session.Destroy))

      val count2 = Await.result(
        (registry ? HeartbeatRegistry.GetClientCount).mapTo[HeartbeatRegistry.ClientCount],
        1.second
      )
      count2.count shouldBe 2
    }

    "refresh heartbeat for active clients" in {
      val editorsProbe = TestProbe()
      // Use a very short timeout for testing
      val registry = system.actorOf(
        HeartbeatRegistry.props(editorsProbe.ref, timeoutMillis = 100)(system.dispatcher)
      )

      // Register client and immediately refresh heartbeat
      registry ! HeartbeatRegistry.RegisterClient("client1", Seq("session1"))
      registry ! HeartbeatRegistry.RegisterClient("client1", Seq("session1"))

      // Manually trigger timeout check
      registry ! HeartbeatRegistry.CheckTimeouts
      // Client should still be active due to refreshed heartbeat
      val count = Await.result(
        (registry ? HeartbeatRegistry.GetClientCount).mapTo[HeartbeatRegistry.ClientCount],
        1.second
      )
      count.count shouldBe 1
    }

    "register clients with no sessions" in {
      val editorsProbe = TestProbe()
      val registry = system.actorOf(
        HeartbeatRegistry.props(editorsProbe.ref, timeoutMillis = 10000)(system.dispatcher)
      )

      registry ! HeartbeatRegistry.RegisterClient("client1", Seq.empty)

      val count = Await.result(
        (registry ? HeartbeatRegistry.GetClientCount).mapTo[HeartbeatRegistry.ClientCount],
        1.second
      )
      count.count shouldBe 1

      // Verify no cleanup messages sent when unregistering
      registry ! HeartbeatRegistry.UnregisterClient("client1")
      editorsProbe.expectNoMessage(500.millis)
    }

    "not immediately shutdown when registry becomes empty" in {
      val editorsProbe = TestProbe()
      val registry = system.actorOf(
        HeartbeatRegistry.props(editorsProbe.ref, timeoutMillis = 10000)(system.dispatcher)
      )

      // Use a watch to detect if registry stops
      watch(registry)

      registry ! HeartbeatRegistry.RegisterClient("client1", Seq("session1"))
      registry ! HeartbeatRegistry.UnregisterClient("client1")

      // Verify session cleanup message
      editorsProbe.expectMsg(Editors.SessionOp("session1", Session.Destroy))

      // Should not receive termination signal immediately (within grace period)
      expectNoMessage(2.seconds)

      // Registry should still be alive
      val count = Await.result(
        (registry ? HeartbeatRegistry.GetClientCount).mapTo[HeartbeatRegistry.ClientCount],
        1.second
      )
      count.count shouldBe 0
    }
  }
}
