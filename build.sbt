/** ********************************************************************************************************************
  * Copyright (c) 2021 Concurrent Technologies Corporation. * * Licensed under
  * the Apache License, Version 2.0 (the "License"); you may not use this file
  * except in compliance * with the License. You may obtain a copy of the
  * License at * * http://www.apache.org/licenses/LICENSE-2.0 * * Unless
  * required by applicable law or agreed to in writing, software is distributed
  * under the License is * distributed on an "AS IS" BASIS, WITHOUT WARRANTIES
  * OR CONDITIONS OF ANY KIND, either express or * implied. See the License for
  * the specific language governing permissions and limitations under the
  * License. * *
  */

import BuildSupport._
import play.api.libs.json._

lazy val packageData = Json
  .parse(scala.io.Source.fromFile("src/rpc/client/ts/package.json").mkString)
  .as[JsObject]
lazy val omegaVersion = packageData("version").as[String]

lazy val ghb_repo_owner = "ctc-oss"
lazy val ghb_repo = "omega-edit"
lazy val ghb_resolver = (
  s"GitHub ${ghb_repo_owner} Apache Maven Packages"
    at
      s"https://maven.pkg.github.com/${ghb_repo_owner}/${ghb_repo}"
)

lazy val commonSettings = {
  Seq(
    organization := "com.ctc",
    scalaVersion := "2.13.8",
    version := omegaVersion,
    licenses += ("Apache-2.0", new URL(
      "https://www.apache.org/licenses/LICENSE-2.0.txt"
    )),
    organizationName := "Concurrent Technologies Corporation",
    licenses := Seq(("Apache-2.0", apacheLicenseUrl)),
    startYear := Some(2021),
    publishTo := Some(ghb_resolver),
    publishMavenStyle := true,
    credentials += Credentials(
      "GitHub Package Registry",
      "maven.pkg.github.com",
      ghb_repo_owner,
      System.getenv("GITHUB_TOKEN")
    ),
    fork := true
  )
}

lazy val ratSettings = Seq(
  ratLicenses := Seq(
    ("HPP  ", Rat.HPP_LICENSE_NAME, Rat.HPP_LICENSE_TEXT)
  ),
  ratLicenseFamilies := Seq(
    Rat.HPP_LICENSE_NAME
  ),
  ratExcludes := Rat.excludes,
  ratFailBinaries := true
)

lazy val `omega-edit` = project
  .in(file("."))
  .settings(commonSettings, ratSettings)
  .settings(
    name := "omega-edit",
    publish / skip := true
  )
  .aggregate(api, spi, native)

lazy val api = project
  .in(file("src/bindings/scala/api"))
  .dependsOn(spi)
  .settings(commonSettings)
  .settings(
    name := "omega-edit",
    libraryDependencies ++= {
      Seq(
        "com.beachape" %% "enumeratum" % "1.7.0",
        "com.ctc" %% s"omega-edit-native" % version.value % Test classifier platform.id,
        "com.github.jnr" % "jnr-ffi" % "2.2.12",
        "org.scalatest" %% "scalatest" % "3.2.13" % Test
      )
    },
    scalacOptions ~= adjustScalacOptionsForScalatest,
    buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion),
    buildInfoObject := "ApiBuildInfo",
    buildInfoPackage := organization.value + ".omega_edit",
    // trim the dep to the native project from the pom
    pomPostProcess := filterScopedDependenciesFromPom,
    // ensure the native jar is published locally for tests
    resolvers += Resolver.mavenLocal,
    externalResolvers += ghb_resolver,
    Compile / Keys.compile :=
      (Compile / Keys.compile)
        .dependsOn(native / publishM2)
        .value,
    Test / Keys.test :=
      (Test / Keys.test)
        .dependsOn(native / publishM2)
        .value
  )
  .enablePlugins(BuildInfoPlugin, GitVersioning)

lazy val native = project
  .in(file("src/bindings/scala/native"))
  .dependsOn(spi)
  .settings(commonSettings)
  .settings(
    name := "omega-edit-native",
    artifactClassifier := Some(platform.id),
    Compile / packageBin / mappings += {
      baseDirectory
        .map(_ / s"$libdir/${mapping._1}")
        .value -> s"${version.value}/${mapping._2}"
    },
    Compile / packageDoc / publishArtifact := false,
    buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion),
    buildInfoPackage := organization.value + ".omega_edit.native",
    buildInfoKeys ++= Seq(
      "sharedLibraryName" -> mapping._1,
      "sharedLibraryOs" -> platform.os,
      "sharedLibraryArch" -> System.getProperty("os.arch"),
      "sharedLibraryPath" -> s"${version.value}/${mapping._2}"
    ),
    buildInfoOptions += BuildInfoOption.Traits(
      "com.ctc.omega_edit.spi.NativeBuildInfo"
    )
  )
  .enablePlugins(BuildInfoPlugin, GitVersioning)

lazy val spi = project
  .in(file("src/bindings/scala/spi"))
  .settings(commonSettings)
  .settings(
    name := "omega-edit-spi"
  )
  .enablePlugins(GitVersioning)

addCommandAlias(
  "installM2",
  "; clean; native/publishM2; test; api/publishM2; spi/publishM2"
)
addCommandAlias(
  "installLocal",
  "; clean; native/publishLocal; test; api/publishLocal; spi/publishLocal"
)
addCommandAlias("howMuchCoverage", "; clean; coverage; test; coverageAggregate")
addCommandAlias(
  "publishAll",
  "; clean; +native/publish; +api/publish; +spi/publish"
)
