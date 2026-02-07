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

import org.apache.pekko
import pekko.actor.ActorSystem
import cats.syntax.all._
import com.ctc.omega_edit.api.OmegaEdit
import com.ctc.omega_edit.grpc.EditorService.getServerPID
import com.monovore.decline._

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Paths
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}

object boot
    extends CommandApp(
      name = "omega-edit-grpc-server",
      header = "Ωedit gRPC server",
      version = {
        val v = OmegaEdit.version()
        s"v${v.major}.${v.minor}.${v.patch}"
      },
      main = {
        val default_interface =
          scala.util.Properties.envOrElse("OMEGA_EDIT_SERVER_HOST", "127.0.0.1")
        val interface_opt = Opts
          .option[String](
            "interface",
            short = "i",
            metavar = "interface_str",
            help = s"Set the gRPC interface to bind to. Default: $default_interface"
          )
          .withDefault(default_interface)

        val default_port =
          scala.util.Properties.envOrElse("OMEGA_EDIT_SERVER_PORT", "9000")
        val port_opt = Opts
          .option[Int](
            "port",
            short = "p",
            metavar = "port_num",
            help = s"Set the gRPC port to listen on. Default: $default_port"
          )
          .orNone

        val default_unix_socket =
          scala.util.Properties.envOrNone("OMEGA_EDIT_SERVER_UNIX_SOCKET")
        val unix_socket_opt = Opts
          .option[String](
            "unix-socket",
            short = "u",
            metavar = "path",
            help =
              "Also expose the gRPC server via a Unix domain socket at the given path (opt-in; requires a runtime that supports Unix domain sockets)."
          )
          .orNone
          .map(_.filter(_.nonEmpty).orElse(default_unix_socket))

        val default_unix_socket_only =
          scala.util.Properties
            .envOrElse("OMEGA_EDIT_SERVER_UNIX_SOCKET_ONLY", "false")
            .toBooleanOption
            .getOrElse(false)
        val unix_socket_only_opt = Opts
          .flag(
            "unix-socket-only",
            help =
              "Bind only to the Unix domain socket (no TCP listener). Requires a runtime and Pekko HTTP version that support UDS binding."
          )
          .orFalse
          .map(flag => flag || default_unix_socket_only)

        val default_pidfile =
          scala.util.Properties.envOrElse("OMEGA_EDIT_SERVER_PIDFILE", null)
        val pidfile_opt = Opts
          .option[String](
            "pidfile",
            short = "f",
            metavar = "pidfile_str",
            help = s"Set the pidfile to write the PID to. Default: $default_pidfile"
          )
          .withDefault(default_pidfile)

        (interface_opt, port_opt, pidfile_opt, unix_socket_opt, unix_socket_only_opt)
          .mapN { (interface, portOpt, pidfile, unixSocketOpt, unixSocketOnly) =>
            val unixSocket = unixSocketOpt
            val effectiveInterface =
              if (unixSocket.isDefined) "127.0.0.1" else interface
            val effectivePort = portOpt.getOrElse(
              if (unixSocket.isDefined) 0 else default_port.toInt
            )

            new boot(
              iface = effectiveInterface,
              port = effectivePort,
              pidfile = pidfile,
              unixSocketPath = unixSocket,
              unixSocketOnly = unixSocketOnly
            ).run()
          }
      }
    )

class boot(
    iface: String,
    port: Int,
    pidfile: String,
    unixSocketPath: Option[String],
    unixSocketOnly: Boolean
) {
  implicit val sys: ActorSystem = ActorSystem("omega-edit-grpc-server")
  implicit val ec: ExecutionContext = sys.dispatcher

  def run(): Unit = {
    val v = OmegaEdit.version()
    val pid = getServerPID()
    val servInfo = s"Ωedit gRPC server (v${v.major}.${v.minor}.${v.patch}) with PID $pid"

    // write the PID to the pidfile (if specified)
    if (pidfile != null) {
      val file = new File(pidfile)
      val fos = new FileOutputStream(file)
      try
        fos.write(pid.toString.getBytes("UTF-8"))
      finally
        fos.close()
    }

    val done =
      if (unixSocketOnly) {
        val sockPath = unixSocketPath match {
          case Some(p) => Paths.get(p)
          case None =>
            throw new IllegalArgumentException(
              "--unix-socket-only requires --unix-socket (or OMEGA_EDIT_SERVER_UNIX_SOCKET)."
            )
        }

        for {
          binding <- EditorService.bindUnixSocket(sockPath)
          _ = println(
            s"${servInfo} bound to unix:${sockPath.toAbsolutePath.toString}: ready..."
          )
          done <- binding.addToCoordinatedShutdown(1.second).whenTerminated
          _ = println(
            s"${servInfo} bound to unix:${sockPath.toAbsolutePath.toString}: exiting..."
          )
        } yield done
      } else {
        for {
          binding <- EditorService.bind(iface = iface, port = port)
          proxy = unixSocketPath.map { p =>
            val sockPath = Paths.get(p)
            val targetPort = binding.localAddress.getPort
            val proxy = UnixDomainSocketProxy.start(
              sockPath,
              targetHost = "127.0.0.1",
              targetPort = targetPort
            )
            sys.registerOnTermination(() => proxy.close())
            println(
              s"${servInfo} additionally exposed via unix:${sockPath.toAbsolutePath.toString} -> 127.0.0.1:${targetPort}"
            )
            proxy
          }
          _ = println(s"${servInfo} bound to ${binding.localAddress}: ready...")
          done <- binding.addToCoordinatedShutdown(1.second).whenTerminated
          _ = proxy.foreach(_.close())
          _ = println(s"${servInfo} bound to ${binding.localAddress}: exiting...")
        } yield done
      }

    Await.result(done, atMost = Duration.Inf)
    ()

    // delete the pidfile (if specified)
    if (pidfile != null) {
      val file = new File(pidfile)
      file.delete()
    }

  }
}
