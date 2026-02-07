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

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.net.{InetAddress, InetSocketAddress, ProtocolFamily, SocketAddress}
import java.nio.ByteBuffer
import java.nio.channels.{ServerSocketChannel, SocketChannel}
import java.nio.file.Files
import scala.util.control.NonFatal

class UnixDomainSocketProxySpec extends AnyWordSpec with Matchers {

  "UnixDomainSocketProxy" should {
    "proxy bytes between unix socket and TCP" in {
      if (!UnixDomainSocketProxy.isSupportedByRuntime) {
        cancel("Unix domain sockets not supported by this runtime")
      }

      val tcpServer = ServerSocketChannel.open()
      tcpServer.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
      val tcpPort = tcpServer.socket().getLocalPort

      @volatile var running = true
      val tcpThread = new Thread(
        () =>
          while (running) {
            var ch: SocketChannel = null
            try {
              ch = tcpServer.accept()
              if (ch != null) {
                val buf = ByteBuffer.allocate(16 * 1024)
                var n = ch.read(buf)
                while (n >= 0) {
                  buf.flip()
                  while (buf.hasRemaining) ch.write(buf)
                  buf.clear()
                  n = ch.read(buf)
                }
              }
            } catch {
              case _: java.nio.channels.AsynchronousCloseException => ()
              case NonFatal(_)                                     => ()
            } finally
              try if (ch != null) ch.close()
              catch { case NonFatal(_) => () }
          },
        "omega-edit-uds-proxy-test-echo"
      )
      tcpThread.setDaemon(true)
      tcpThread.start()

      val tmpDir = Files.createTempDirectory("omega-uds")
      val socketPath = tmpDir.resolve("omega-edit.sock")
      val proxy = UnixDomainSocketProxy.start(
        socketPath,
        targetHost = "127.0.0.1",
        targetPort = tcpPort
      )

      val client = UdsClient.open(socketPath)
      try {
        val payload = "hello-omega-edit".getBytes("UTF-8")
        client.write(ByteBuffer.wrap(payload))
        client.shutdownOutput()

        val recv = ByteBuffer.allocate(payload.length)
        while (recv.hasRemaining && client.read(recv) >= 0) {}
        new String(recv.array(), "UTF-8") shouldBe "hello-omega-edit"
      } finally {
        try client.close()
        catch { case NonFatal(_) => () }

        proxy.close()
        running = false
        try tcpServer.close()
        catch { case NonFatal(_) => () }
      }
    }
  }

  private object UdsClient {
    def open(socketPath: java.nio.file.Path): SocketChannel = {
      val addr = unixAddressOf(socketPath)
      val pf = unixProtocolFamily().getOrElse(
        throw new IllegalStateException("StandardProtocolFamily.UNIX missing")
      )

      val openPf =
        try Some(classOf[SocketChannel].getMethod("open", classOf[ProtocolFamily]))
        catch { case _: NoSuchMethodException => None }

      openPf match {
        case Some(m) =>
          val ch = m.invoke(null, pf).asInstanceOf[SocketChannel]
          ch.connect(addr)
          ch
        case None =>
          // Best-effort fallback; may not work on all runtimes.
          SocketChannel.open(addr)
      }
    }

    private def unixAddressOf(path: java.nio.file.Path): SocketAddress = {
      val cls = Class.forName("java.net.UnixDomainSocketAddress")
      val ofMethod = cls.getMethod("of", classOf[java.nio.file.Path])
      ofMethod.invoke(null, path).asInstanceOf[SocketAddress]
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
