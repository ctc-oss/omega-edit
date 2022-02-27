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

version := "0.7.1"

githubOwner := "Shanedell"
githubRepository := "omega-edit"
githubTokenSource := TokenSource.Environment("GITHUB_TOKEN")

/**
 * Commented out code is another way to connect to
 * the github repo holding the packages without using
 * the sbt-github-packages plugin.
 *
 * This plugin is not used for publish the API and native
 * code because it did not perform consistently for publishing
 * however seems to work well for downloading.
 */

// lazy val ghb_repo_owner = "Shanedell"
// lazy val ghb_repo = "omega-edit"
// lazy val ghb_resolver = (
//   s"GitHub ${ghb_repo_owner} Apache Maven Packages"
//   at
//   s"https://maven.pkg.github.com/${ghb_repo_owner}/${ghb_repo}"
// )

// publishTo := Some(ghb_resolver)
// publishMavenStyle := true
// credentials += Credentials(
//   "GitHub Package Registry",
//   "maven.pkg.github.com",
//   ghb_repo_owner,
//   System.getenv("GITHUB_TOKEN")
// )

// externalResolvers += ghb_resolver

licenses := Seq(("Apache-2.0", apacheLicenseUrl))
organizationName := "Concurrent Technologies Corporation"
startYear := Some(2021)

libraryDependencies ++= Seq(
  "com.ctc" %% "omega-edit" % version.value,
  "com.ctc" %% "omega-edit-native" % version.value classifier s"${arch.id}",
  "org.scalatest" %% "scalatest" % "3.2.11" % Test
)

resolvers ++= Seq(
  Resolver.mavenLocal,
  Resolver.githubPackages("Shanedell")
)

Compile / PB.protoSources += baseDirectory.value / "../../protos"

enablePlugins(AkkaGrpcPlugin, GitVersioning, JavaAppPackaging, UniversalPlugin)
