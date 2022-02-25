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

name := "example-grpc-server"
scalaVersion := "2.13.6"

git.useGitDescribe := true
git.gitUncommittedChanges := false

licenses := Seq(("Apache-2.0", apacheLicenseUrl))
organizationName := "Concurrent Technologies Corporation"
startYear := Some(2021)

libraryDependencies ++= Seq(
  "com.ctc" %% "omega-edit" % version.value,
  "com.ctc" %% "omega-edit-native" % version.value classifier s"${arch.id}",
  "org.scalatest" %% "scalatest" % "3.2.11" % Test
)

resolvers += Resolver.mavenLocal
Compile / PB.protoSources += baseDirectory.value / "../../protos"

enablePlugins(AkkaGrpcPlugin, GitVersioning, JavaAppPackaging, UniversalPlugin)
