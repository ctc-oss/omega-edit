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

import BuildSupport._
import play.api.libs.json._

lazy val packageData = Json.parse(
  scala.io.Source.fromFile("../../client/ts/package.json"
).mkString).as[JsObject]
lazy val omegaVersion = packageData("version").as[String]

name := "example-grpc-server"
scalaVersion := "2.13.6"

lazy val ghb_repo_owner = "ctc-oss"
lazy val ghb_repo = "omega-edit"
lazy val ghb_resolver = (
  s"GitHub ${ghb_repo_owner} Apache Maven Packages"
  at
  s"https://maven.pkg.github.com/${ghb_repo_owner}/${ghb_repo}"
)

credentials += Credentials(
  "GitHub Package Registry",
  "maven.pkg.github.com",
  ghb_repo_owner,
  System.getenv("GITHUB_TOKEN")
)

licenses := Seq(("Apache-2.0", apacheLicenseUrl))
organizationName := "Concurrent Technologies Corporation"
startYear := Some(2021)

lazy val altOs = arch.os match {
  case "linux"    => ("macos", "windows")
  case "macos"    => ("linux", "windows")
  case "windows"  => ("macos", "linux")
}

libraryDependencies ++= Seq(
  "com.ctc" %% "omega-edit" % omegaVersion,
  "com.ctc" %% "omega-edit-native" % omegaVersion classifier s"${arch.id}",
  "com.ctc" %% "omega-edit-native" % omegaVersion classifier s"${altOs._1}-${arch.arch}",
  "com.ctc" %% "omega-edit-native" % omegaVersion classifier s"${altOs._2}-${arch.arch}",
  "org.scalatest" %% "scalatest" % "3.2.11" % Test
)

externalResolvers += ghb_resolver

Compile / PB.protoSources += baseDirectory.value / "../../protos"

enablePlugins(AkkaGrpcPlugin, GitVersioning, JavaAppPackaging, UniversalPlugin)
