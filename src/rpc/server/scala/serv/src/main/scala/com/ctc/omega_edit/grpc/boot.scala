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

import akka.actor.ActorSystem
import cats.implicits.catsSyntaxTuple2Semigroupal
import com.ctc.omega_edit.api.OmegaEdit
import com.monovore.decline._

import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}

object boot
    extends CommandApp(
      name = "omega-edit-grpc-server",
      header = "",
      main = {
        val default_interface = scala.util.Properties.envOrElse("OMEGA_EDIT_SERVER_HOST", "127.0.0.1")
        val interface_opt = Opts
          .option[String](
            "interface",
            short = "i",
            metavar = "interface_str",
            help = s"Set the gRPC interface to bind to. Default: $default_interface"
          )
          .withDefault(default_interface)

        val default_port = scala.util.Properties.envOrElse("OMEGA_EDIT_SERVER_PORT", "9000")
        val port_opt = Opts
          .option[Int](
            "port",
            short = "p",
            metavar = "port_num",
            help = s"Set the gRPC port to listen on. Default: $default_port"
          )
          .withDefault(default_port.toInt)

        (interface_opt, port_opt).mapN { (interface, port) =>
          new boot(interface, port).run()
        }
      }
    )

class boot(iface: String, port: Int) {
  implicit val sys: ActorSystem = ActorSystem("omega-grpc-server")
  implicit val ec: ExecutionContext = sys.dispatcher

  def run(): Unit = {
    val v = OmegaEdit.version()
    val done =
      for {
        binding <- EditorService.bind(iface = iface, port = port)

        _ = println(s"gRPC server (v${v.major}.${v.minor}.${v.patch}) bound to: ${binding.localAddress}")

        done <- binding.addToCoordinatedShutdown(1.second).whenTerminated

        _ = println(s"exiting...")
      } yield done

    Await.result(done, atMost = Duration.Inf)
    ()
  }
}
