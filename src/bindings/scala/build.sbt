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

import OmegaEditBuild._

lazy val commonSettings = {
  Seq(
    git.useGitDescribe := true,
    organization := "com.ctc",
    scalaVersion := "2.12.13",
    crossScalaVersions := Seq("2.12.13", "2.13.8"),
    organizationName := "Concurrent Technologies Corporation",
    licenses := Seq(("Apache-2.0", new URL("https://www.apache.org/licenses/LICENSE-2.0.txt"))),
    startYear := Some(2021)
  )
}

lazy val omega_edit = project
  .in(file("."))
  .settings(commonSettings)
  .settings(publish / skip := true)
  .aggregate(native, api)

lazy val api = project
  .in(file("api"))
  .dependsOn(native)
  .settings(commonSettings)
  .settings(
    name := "omega-edit",
    libraryDependencies ++= {
      Seq(
        "com.ctc" %% "omega-edit-native" % version.value % "runtime" classifier arch.id,
        "com.github.jnr" % "jnr-ffi" % "2.2.11",
        "org.scijava" % "native-lib-loader" % "2.4.0",
        "org.scalatest" %% "scalatest" % "3.2.11" % Test
      )
    },
    Test / fork := true,
    Test / scalacOptions ~= adjustScalacOptionsForTesting,
    Test / javaOptions += s"-Djava.library.path=${baseDirectory.map(_ / "../../../../lib").value}"
  )
  .enablePlugins(GitVersioning)

lazy val native = project
  .in(file("native"))
  .settings(commonSettings)
  .settings(
    name := "omega-edit-native",
    artifactClassifier := Some(arch.id),
    Compile / packageBin / mappings += {
      baseDirectory.map(_ / s"../../../../lib/${mapping._1}").value -> mapping._2
    }
  )

lazy val arch: Arch = {
  val os = System.getProperty("os.name").toLowerCase
  val amd = """amd(\d+)""".r
  val arch = System.getProperty("os.arch").toLowerCase match {
    case amd(bits) => bits
    case _         => "unknown"
  }
  Arch(s"$os-$arch", s"${os}_$arch")
}

def pair(name: String): (String, String) = name -> s"${arch._id}/$name"
lazy val mapping = {
  System.getProperty("os.name").toLowerCase match {
    case "linux"   => pair("libomega_edit.so")
    case "mac"     => pair("libomega_edit.dyn")
    case "windows" => pair("libomega_edit.dll")
  }
}

lazy val adjustScalacOptionsForTesting = { opts: Seq[String] =>
  opts.filterNot(
    Set(
      "-Wvalue-discard",
      "-Ywarn-value-discard"
    )
  )
}
