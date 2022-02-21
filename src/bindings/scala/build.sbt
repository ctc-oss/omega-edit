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

lazy val commonSettings = {
  Seq(
    organization := "com.ctc",
    scalaVersion := "2.12.13",
    crossScalaVersions := Seq("2.12.13", "2.13.8"),
    organizationName := "Concurrent Technologies Corporation",
    git.useGitDescribe := true,
    git.gitUncommittedChanges := false,
    licenses := Seq(("Apache-2.0", apacheLicenseUrl)),
    startYear := Some(2021),
    publishMavenStyle := true
  )
}

lazy val omega_edit = project
  .in(file("."))
  .settings(commonSettings)
  .settings(
    publish / skip := true
  )
  .aggregate(api, native)

lazy val api = project
  .in(file("api"))
  .settings(commonSettings)
  .settings(
    name := "omega-edit",
    libraryDependencies ++= {
      Seq(
        "com.ctc" %% s"omega-edit-native" % version.value % Test classifier arch.id,
        "com.github.jnr" % "jnr-ffi" % "2.2.11",
        "org.scalatest" %% "scalatest" % "3.2.11" % Test
      )
    },
    scalacOptions ~= adjustScalacOptionsForScalatest,
    buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion),
    buildInfoPackage := organization.value + ".omega_edit",
    buildInfoKeys ++= Seq(
      "nativeSharedLibraryName" -> mapping._1,
      "nativeSharedLibraryPath" -> mapping._2
    ),
    // trim the dep to the native project from the pom
    pomPostProcess := filterScopedDependenciesFromPom,
    // ensure the native jar is published locally for tests
    resolvers += Resolver.mavenLocal,
    Test / Keys.test :=
      (Test / Keys.test)
        .dependsOn(native / publishM2)
        .value
  )
  .enablePlugins(BuildInfoPlugin, GitVersioning)

lazy val native = project
  .in(file("native"))
  .settings(commonSettings)
  .settings(
    name := "omega-edit-native",
    artifactClassifier := Some(arch.id),
    Compile / packageBin / mappings += {
      baseDirectory.map(_ / s"$libdir/${mapping._1}").value -> mapping._2
    }
  )
  .enablePlugins(GitVersioning)

addCommandAlias("install", "; clean; native/publishM2; test; api/publishM2")
addCommandAlias("howMuchCoverage", "; clean; coverage; test; coverageAggregate")
