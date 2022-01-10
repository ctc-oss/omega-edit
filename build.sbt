/**********************************************************************************************************************
 * Copyright (c) 2021-2022 Concurrent Technologies Corporation.                                                            *
 *                                                                                                                    *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance     *
 * with the License.  You may obtain a copy of the License at                                                         *
 *                                                                                                                    *
 *     http://www.apache.org/licenses/LICENSE-2.0                                                                     *
 *                                                                                                                    *
 * Unless required by applicable law or agreed to in writing, software is distributed under the License is            *
 * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or                   *
 * implied.  See the License for the specific language governing permissions and limitations under the License.       *
 *                                                                                                                    *
 **********************************************************************************************************************/

lazy val libPath = file("lib/")

// Run compile script -- ensures libomega_edit file is in the lib folder
lazy val javaCompile = taskKey[Unit]("Compile java library")
javaCompile := {
  import sys.process._
  val s: TaskStreams = streams.value
  val compileCmd = {
    System.getProperty("os.name").toLowerCase match {
      case mac if mac.contains("mac") => "./compile.sh compile-lib mac"
      case win if win.contains("win") => "./compile.sh compile-lib win"
      case linux if linux.contains("linux") => "./compile.sh compile-lib linux"
      case osName => throw new RuntimeException(s"Unkown operations system $osName")
    }
  }

  val result = (compileCmd #|| "echo 1").!!

  if (result != "1") {
      s.log.success("compile successful!")
  } else {
      throw new IllegalStateException("compile failed!")
  }
}
(Compile / run) := (Compile / run).dependsOn(javaCompile).evaluated

lazy val commonSettings = {
  Seq(
    version := {
      val versionRegex = raw"""  "version": "(.*)",""".r
      val packageJsonStr = scala.io.Source.fromFile("package.json").mkString
      versionRegex.findFirstMatchIn(packageJsonStr) match {
        case Some(m) => m.group(1)
        case None => sys.error("Missing version specifier in package.json")
      }
    },
    licenses += ("Apache-2.0", new URL("https://www.apache.org/licenses/LICENSE-2.0.txt")),
    organization := "org.apache",
    scalaVersion := "2.12.13",
    scalacOptions ++= Seq("-Ypartial-unification"),
    startYear := Some(2021),
    Compile / run / unmanagedJars += file("lib/omega_edit.jar"),
    Compile / mainClass := Some("org.ctc.omegaedit.Example"),
    Compile / run / javaOptions += s"-Djava.library.path=$libPath",
    Compile / run / fork := true,
  )
}

lazy val commonPlugins = Seq(UnpackPlugin)

lazy val ratSettings = Seq(
  ratLicenses := Seq(
    ("HPP  ", Rat.HPP_LICENSE_NAME, Rat.HPP_LICENSE_TEXT),
  ),
  ratLicenseFamilies := Seq(
    Rat.HPP_LICENSE_NAME,
  ),
  ratExcludes := Rat.excludes,
  ratFailBinaries := true,
)

lazy val `omega-edit` = project
  .in(file("."))
  .settings(commonSettings, ratSettings)
  .settings(publish / skip := true)
  .dependsOn(core)
  .aggregate(core)

lazy val core = project
  .in(file("server/core"))
  .settings(commonSettings)
  .settings(
    name := "omega-edit",
    libraryDependencies ++= {
      Seq(
        "ch.qos.logback"  %  "logback-classic"    % "1.2.9",
        "com.github.jnr"  % "jnr-ffi"             % "2.2.10",
        "org.scijava"     % "native-lib-loader"   % "2.4.0",
      )
    }
  )
  .enablePlugins(commonPlugins: _*)
