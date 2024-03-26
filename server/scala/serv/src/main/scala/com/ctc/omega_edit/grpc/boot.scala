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
import cats.implicits.catsSyntaxTuple3Semigroupal
import com.ctc.omega_edit.api.OmegaEdit
import com.ctc.omega_edit.grpc.EditorService.getServerPID
import com.monovore.decline._

import java.io.File
import java.io.FileOutputStream
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
          .withDefault(default_port.toInt)

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

        (interface_opt, port_opt, pidfile_opt).mapN { (interface, port, pidfile) =>
          new boot(interface, port, pidfile).run()
        }
      }
    )

class boot(iface: String, port: Int, pidfile: String) {
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
      for {
        binding <- EditorService.bind(iface = iface, port = port)
        _ = println(s"${servInfo} bound to ${binding.localAddress}: ready...")
        done <- binding.addToCoordinatedShutdown(1.second).whenTerminated
        _ = println(s"${servInfo} bound to ${binding.localAddress}: exiting...")
      } yield done

    Await.result(done, atMost = Duration.Inf)
    ()

    // delete the pidfile (if specified)
    if (pidfile != null) {
      val file = new File(pidfile)
      file.delete()
    }

  }
}
