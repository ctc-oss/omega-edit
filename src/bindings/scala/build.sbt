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

lazy val commonSettings = {
  Seq(
    git.useGitDescribe := true,
    organization := "com.ctc",
    scalaVersion := "2.12.13",
    startYear := Some(2021),
    licenses := Seq(("Apache-2.0", new URL("https://www.apache.org/licenses/LICENSE-2.0.txt"))),
    organizationName := "Concurrent Technologies Corporation"
  )
}

lazy val omega_edit = project
  .in(file("."))
  .settings(commonSettings)
  .settings(publish / skip := true)
  .aggregate(api, native)

lazy val api = project
  .in(file("api"))
  .settings(commonSettings)
  .settings(
    name := "omega-edit-api",
    libraryDependencies ++= {
      Seq(
        "com.ctc" %% s"omega-edit-native-$arch" % version.value,
        "com.github.jnr" % "jnr-ffi" % "2.2.11",
        "org.scijava" % "native-lib-loader" % "2.4.0",
        "org.scalatest" %% "scalatest" % "3.2.11" % Test
      )
    },
    Test / fork := true,
    Test / scalacOptions -= "-Ywarn-value-discard",
    Test / javaOptions += s"-Djava.library.path=${baseDirectory.map(_ / "../../../../lib").value}"
  )
  .enablePlugins(GitVersioning)

lazy val native = project
  .in(file("native"))
  .settings(commonSettings)
  .settings(
    name := s"omega-edit-native-$arch",
    Compile / packageBin / mappings += {
      baseDirectory.map(_ / s"../../../../lib/${mapping._1}").value -> mapping._2
    }
  )

lazy val arch = {
  val os = System.getProperty("os.name").toLowerCase
  val amd = """amd(\d+)""".r
  val arch = System.getProperty("os.arch").toLowerCase match {
    case amd(bits) => bits
    case _         => "unknown"
  }
  s"$os-$arch"
}

def pair(name: String): (String, String) = name -> s"${arch.replace("-", "_")}/$name"
lazy val mapping = {
  System.getProperty("os.name").toLowerCase match {
    case "linux"   => pair("libomega_edit.so")
    case "mac"     => pair("libomega_edit.dyn")
    case "windows" => pair("libomega_edit.dll")
  }
}
