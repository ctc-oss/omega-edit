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

import org.apache.pekko.actor.{Actor, ActorLogging, ActorRef, Cancellable, Props}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

object HeartbeatRegistry {
  def props(
      editors: ActorRef,
      timeoutMillis: Long = 30000
  )(implicit ec: ExecutionContext): Props =
    Props(new HeartbeatRegistry(editors, timeoutMillis))

  case class RegisterClient(clientId: String, sessionIds: Seq[String])
  case class UnregisterClient(clientId: String)
  case object CheckTimeouts
  case object GetClientCount
  case class ClientCount(count: Int)

  private case class ClientInfo(
      clientId: String,
      sessionIds: Seq[String],
      lastHeartbeat: Long
  )
}

class HeartbeatRegistry(editors: ActorRef, timeoutMillis: Long)(implicit
    ec: ExecutionContext
) extends Actor
    with ActorLogging {
  import HeartbeatRegistry._

  private var clients = Map.empty[String, ClientInfo]
  private var checkTimeoutsScheduler: Option[Cancellable] = None
  private var emptyRegistrySince: Option[Long] = None
  private val emptyRegistryGracePeriod: Long = 60000 // 1 minute grace period

  override def preStart(): Unit = {
    super.preStart()
    // Check for timeouts every 5 seconds
    checkTimeoutsScheduler = Some(
      context.system.scheduler.scheduleWithFixedDelay(
        5.seconds,
        5.seconds,
        self,
        CheckTimeouts
      )
    )
    log.info(s"HeartbeatRegistry started with timeout ${timeoutMillis}ms")
  }

  override def postStop(): Unit = {
    checkTimeoutsScheduler.foreach(_.cancel())
    super.postStop()
  }

  def receive: Receive = {
    case RegisterClient(clientId, sessionIds) =>
      val now = System.currentTimeMillis()
      clients.get(clientId) match {
        case Some(existing) =>
          val sessionChanges =
            if (existing.sessionIds != sessionIds)
              s" (sessions changed from [${existing.sessionIds.mkString(", ")}] to [${sessionIds.mkString(", ")}])"
            else ""
          log.debug(s"Updating heartbeat for client $clientId with ${sessionIds.size} session(s)$sessionChanges")
          clients = clients.updated(clientId, existing.copy(lastHeartbeat = now, sessionIds = sessionIds))
        case None =>
          log.info(s"Registering new client $clientId with sessions: $sessionIds")
          clients = clients + (clientId -> ClientInfo(clientId, sessionIds, now))
      }

    case UnregisterClient(clientId) =>
      clients.get(clientId) match {
        case Some(info) =>
          log.info(s"Unregistering client $clientId")
          cleanupClientSessions(info)
          clients = clients - clientId
          checkAndShutdown()
        case None =>
          log.debug(s"Attempted to unregister unknown client $clientId")
      }

    case CheckTimeouts =>
      val now = System.currentTimeMillis()
      val timedOut = clients.filter { case (_, info) =>
        now - info.lastHeartbeat > timeoutMillis
      }

      if (timedOut.nonEmpty) {
        log.warning(s"Detected ${timedOut.size} timed out client(s)")
        timedOut.foreach { case (clientId, info) =>
          log.warning(
            s"Client $clientId timed out (last heartbeat: ${info.lastHeartbeat}, timeout: ${timeoutMillis}ms)"
          )
          cleanupClientSessions(info)
          clients = clients - clientId
        }
        checkAndShutdown()
      } else {
        log.debug(s"Timeout check completed. ${clients.size} active client(s), no timeouts detected.")
      }

    case GetClientCount =>
      sender() ! ClientCount(clients.size)
  }

  private def cleanupClientSessions(info: ClientInfo): Unit = {
    log.info(s"Cleaning up ${info.sessionIds.size} session(s) for client ${info.clientId}")
    info.sessionIds.foreach { sessionId =>
      log.debug(s"Destroying session $sessionId for timed-out client ${info.clientId}")
      editors ! Editors.SessionOp(sessionId, Session.Destroy)
    }
  }

  private def checkAndShutdown(): Unit = {
    if (clients.isEmpty) {
      emptyRegistrySince match {
        case None =>
          emptyRegistrySince = Some(System.currentTimeMillis())
          log.info("Registry is empty. Will shutdown if no clients connect within grace period.")
        case Some(since) if System.currentTimeMillis() - since > emptyRegistryGracePeriod =>
          log.warning("All clients have timed out or disconnected. Initiating server shutdown.")
          context.system.terminate()
        case _ => // Still within grace period
      }
    } else {
      emptyRegistrySince = None
    }
  }
}
