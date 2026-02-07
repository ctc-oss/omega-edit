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

import java.io.IOException
import java.net.{InetAddress, InetSocketAddress, ProtocolFamily, SocketAddress}
import java.nio.ByteBuffer
import java.nio.channels.{ServerSocketChannel, SocketChannel}
import java.nio.file.{Files, Path}
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}

import scala.util.control.NonFatal

/** A small Unix domain socket -> TCP proxy.
  *
  * This allows clients that support `unix:` addresses (e.g. grpc-js) to talk to the existing Pekko HTTP gRPC server
  * without requiring Pekko HTTP to bind directly to a domain socket.
  *
  * Implementation uses JDK Unix Domain Socket APIs when available (Java 16+). On older runtimes,
  * [[UnixDomainSocketProxy.start]] will throw.
  */
final class UnixDomainSocketProxy private (
    val socketPath: Path,
    private val serverChannel: ServerSocketChannel,
    private val acceptThread: Thread,
    private val running: AtomicBoolean
) extends AutoCloseable {

  override def close(): Unit =
    if (running.compareAndSet(true, false)) {
      try serverChannel.close()
      catch { case NonFatal(_) => () }

      // Best-effort cleanup; domain socket path is a filesystem entry.
      try Files.deleteIfExists(socketPath)
      catch { case NonFatal(_) => () }
    }
}

object UnixDomainSocketProxy {
  private def isWindows: Boolean =
    Option(System.getProperty("os.name"))
      .getOrElse("")
      .toLowerCase(java.util.Locale.ROOT)
      .contains("win")

  def isSupportedByRuntime: Boolean = UnixDomainSockets.supported && !isWindows

  def addressOf(path: Path): SocketAddress = UnixDomainSockets.addressOf(path)

  /** Starts a domain socket listener at `socketPath` that forwards to `targetHost:targetPort`.
    *
    * @throws java.lang.IllegalStateException
    *   if the runtime does not support Unix domain sockets.
    */
  def start(
      socketPath: Path,
      targetHost: String,
      targetPort: Int
  ): UnixDomainSocketProxy = {
    if (!UnixDomainSockets.supported)
      throw new IllegalStateException(
        "Unix domain sockets are not supported by this runtime (requires Java 16+ and a Unix-like OS)."
      )

    val os = Option(System.getProperty("os.name"))
      .getOrElse("")
      .toLowerCase(java.util.Locale.ROOT)
    if (os.contains("win"))
      throw new IllegalStateException("Unix domain sockets are not supported on Windows")

    // Ensure parent directories exist.
    val parent = socketPath.getParent
    if (parent != null) Files.createDirectories(parent)

    // If a previous socket file exists, remove it (best-effort).
    try Files.deleteIfExists(socketPath)
    catch {
      case NonFatal(e) =>
        throw new IOException(s"Unable to remove existing unix socket at $socketPath", e)
    }

    val address = UnixDomainSockets.addressOf(socketPath)
    val server = UnixDomainSockets.openServerChannel()
    server.bind(address)

    val running = new AtomicBoolean(true)

    val acceptThread = new Thread(
      () =>
        while (running.get()) {
          var client: SocketChannel = null
          var upstream: SocketChannel = null
          try {
            client = server.accept()
            if (client != null) {
              upstream = SocketChannel.open()
              upstream.connect(
                new InetSocketAddress(InetAddress.getByName(targetHost), targetPort)
              )

              val pipe = new PipeState(client = client, upstream = upstream)

              // One thread per direction; simple and reliable for local IPC.
              val t1 = new Thread(
                () => pump(pipe, in = client, out = upstream),
                "omega-edit-uds-proxy-c2t"
              )
              val t2 = new Thread(
                () => pump(pipe, in = upstream, out = client),
                "omega-edit-uds-proxy-t2c"
              )
              t1.setDaemon(true)
              t2.setDaemon(true)
              t1.start()
              t2.start()
            }
          } catch {
            case _: java.nio.channels.AsynchronousCloseException =>
              // expected during shutdown
              ()
            case NonFatal(_) if !running.get() =>
              ()
            case NonFatal(_) =>
              // best-effort: close client if we failed mid-accept/handshake
              try if (client != null) client.close()
              catch { case NonFatal(_) => () }
              try if (upstream != null) upstream.close()
              catch { case NonFatal(_) => () }
              // avoid hot loop on repeated failure
              try Thread.sleep(25)
              catch { case _: InterruptedException => () }
              ()
          }
        },
      "omega-edit-uds-proxy-accept"
    )

    acceptThread.setDaemon(true)
    acceptThread.start()

    new UnixDomainSocketProxy(socketPath, server, acceptThread, running)
  }

  private final class PipeState(client: SocketChannel, upstream: SocketChannel) {
    private val done = new AtomicInteger(0)

    def markDone(): Unit =
      if (done.incrementAndGet() == 2) {
        try client.close()
        catch { case NonFatal(_) => () }
        try upstream.close()
        catch { case NonFatal(_) => () }
      }
  }

  private def pump(
      pipe: PipeState,
      in: SocketChannel,
      out: SocketChannel
  ): Unit = {
    val buf = ByteBuffer.allocateDirect(64 * 1024)
    try {
      var read = in.read(buf)
      while (read >= 0) {
        buf.flip()
        while (buf.hasRemaining) out.write(buf)
        buf.clear()
        read = in.read(buf)
      }
    } catch {
      case NonFatal(_) =>
        ()
    } finally {
      // Half-close the output to propagate EOF without killing the opposite direction.
      try out.shutdownOutput()
      catch { case NonFatal(_) => () }
      pipe.markDone()
    }
  }

  private object UnixDomainSockets {
    private lazy val unixDomainSocketAddressClass: Option[Class[_]] =
      try Some(Class.forName("java.net.UnixDomainSocketAddress"))
      catch { case _: ClassNotFoundException => None }

    private lazy val standardProtocolFamilyClass: Option[Class[_]] =
      try Some(Class.forName("java.net.StandardProtocolFamily"))
      catch { case _: ClassNotFoundException => None }

    private lazy val unixProtocolFamily: Option[ProtocolFamily] =
      try
        standardProtocolFamilyClass.flatMap { c =>
          val f = c.getField("UNIX")
          Option(f.get(null).asInstanceOf[ProtocolFamily])
        }
      catch {
        case NonFatal(_) => None
      }

    private lazy val serverOpenMethod =
      try Some(classOf[ServerSocketChannel].getMethod("open", classOf[ProtocolFamily]))
      catch { case _: NoSuchMethodException => None }

    lazy val supported: Boolean =
      unixDomainSocketAddressClass.isDefined && unixProtocolFamily.isDefined && serverOpenMethod.isDefined

    def addressOf(path: Path): SocketAddress = {
      val cls = unixDomainSocketAddressClass.getOrElse(
        throw new IllegalStateException("UnixDomainSocketAddress class missing")
      )

      // UnixDomainSocketAddress.of(Path)
      val ofMethod = cls.getMethod("of", classOf[Path])
      ofMethod.invoke(null, path).asInstanceOf[SocketAddress]
    }

    def openServerChannel(): ServerSocketChannel = {
      val pf = unixProtocolFamily.getOrElse(
        throw new IllegalStateException("StandardProtocolFamily.UNIX missing")
      )
      val m = serverOpenMethod.getOrElse(
        throw new IllegalStateException("ServerSocketChannel.open(ProtocolFamily) missing")
      )
      m.invoke(null, pf).asInstanceOf[ServerSocketChannel]
    }
  }
}
