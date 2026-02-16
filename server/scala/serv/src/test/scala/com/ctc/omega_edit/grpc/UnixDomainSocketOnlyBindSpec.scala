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
import org.apache.pekko.http.scaladsl.Http
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.net.{ProtocolFamily, SocketAddress}
import java.nio.channels.SocketChannel
import java.nio.file.Files
import scala.concurrent.Await
import scala.concurrent.duration._
import scala.util.control.NonFatal

class UnixDomainSocketOnlyBindSpec extends AnyWordSpec with Matchers {
  "UDS-only binding" should {
    "bind and accept a unix socket connection" in {
      implicit val system: ActorSystem = ActorSystem("UdsOnlyBindSpec")

      val tmpDir = Files.createTempDirectory("omega-uds-only")
      val socketPath = tmpDir.resolve("omega-edit.sock")

      try
        if (!UnixDomainSocketProxy.isSupportedByRuntime) {
          val ex = intercept[IllegalStateException] {
            Await.result(EditorService.bindUnixSocket(socketPath), 5.seconds)
          }
          ex.getMessage should include("Unix domain sockets are not supported")
        } else if (!supportsUdsBinding(system)) {
          val ex = intercept[IllegalStateException] {
            Await.result(EditorService.bindUnixSocket(socketPath), 5.seconds)
          }
          ex.getMessage should include("does not support binding to Unix domain sockets")
        } else {
          val binding = Await.result(EditorService.bindUnixSocket(socketPath), 5.seconds)

          val client = UdsClient.open(socketPath)
          try
            client.isConnected shouldBe true
          finally
            try client.close()
            catch { case NonFatal(_) => () }

          Await.result(binding.unbind(), 5.seconds)
        }
      finally {
        try Files.deleteIfExists(socketPath)
        catch { case NonFatal(_) => () }
        system.terminate()
      }
    }
  }

  private def supportsUdsBinding(system: ActorSystem): Boolean = {
    val http = Http()(system)
    http.getClass.getMethods
      .exists { m =>
        m.getName == "newServerAt" &&
        m.getParameterCount == 1 &&
        classOf[SocketAddress].isAssignableFrom(m.getParameterTypes.apply(0))
      }
  }

  private object UdsClient {
    def open(socketPath: java.nio.file.Path): SocketChannel = {
      val addr = UnixDomainSocketProxy.addressOf(socketPath)
      val openPf =
        try Some(classOf[SocketChannel].getMethod("open", classOf[ProtocolFamily]))
        catch { case _: NoSuchMethodException => None }

      openPf match {
        case Some(m) =>
          val pf = unixProtocolFamily().getOrElse(
            throw new IllegalStateException("StandardProtocolFamily.UNIX missing")
          )
          val ch = m.invoke(null, pf).asInstanceOf[SocketChannel]
          ch.connect(addr)
          ch
        case None =>
          // Best-effort fallback; may not work on all runtimes.
          SocketChannel.open(addr)
      }
    }

    private def unixProtocolFamily(): Option[ProtocolFamily] =
      try {
        val c = Class.forName("java.net.StandardProtocolFamily")
        val f = c.getField("UNIX")
        Option(f.get(null).asInstanceOf[ProtocolFamily])
      } catch {
        case NonFatal(_) => None
      }
  }
}
