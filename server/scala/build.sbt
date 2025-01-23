/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
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
import scala.io.Source
import scala.util.Using
import scala.util.Try
import scala.collection.mutable.ListBuffer

lazy val packageData = Json
  .parse(
    Using(Source.fromFile("../../package.json"))(source => source.mkString).get
  )
  .as[JsObject]
lazy val omegaEditVersion = packageData("version").as[String]

lazy val ghb_repo_owner = "ctc-oss"
lazy val ghb_repo = "omega-edit"
lazy val ghb_resolver = (
  s"GitHub ${ghb_repo_owner} Apache Maven Packages"
    at
      s"https://maven.pkg.github.com/${ghb_repo_owner}/${ghb_repo}"
)

lazy val bashExtras = s"""declare omegaEditVersion="${omegaEditVersion}""""
lazy val batchExtras = s"""set "OMEGAEditVERSION=${omegaEditVersion}""""

lazy val isRelease =
  Try(sys.env.get("IS_RELEASE").getOrElse("").toBoolean).getOrElse(false)
lazy val serverRelease =
  Try(sys.env.get("SERVER_RELEASE").getOrElse("").toBoolean).getOrElse(false)

lazy val pekkoVersion = "1.0.2"
lazy val tikaVersion = "2.9.2"
lazy val scalaTestVersion = "3.2.18"
lazy val logbackVersion = "1.3.5"
lazy val jnrFfiVersion = "2.2.16"
lazy val declineVersion = "2.4.1"
lazy val enumeratumVersion = "1.7.2"

lazy val commonSettings =
  Seq(
    organization := "com.ctc",
    scalaVersion := "2.13.12",
    version := omegaEditVersion,
    organizationName := "Concurrent Technologies Corporation",
    maintainer := "oss@ctc.com",
    licenses := Seq(("Apache-2.0", apacheLicenseUrl)),
    startYear := Some(2021),
    publishTo := Some(ghb_resolver),
    publishMavenStyle := true,
    publishConfiguration := publishConfiguration.value.withOverwrite(true),
    publishLocalConfiguration := publishLocalConfiguration.value.withOverwrite(
      true
    ),
    credentials += Credentials(
      "GitHub Package Registry",
      "maven.pkg.github.com",
      ghb_repo_owner,
      System.getenv("GITHUB_TOKEN")
    ),
    fork := (if (isRelease) false else true),
    externalResolvers ++= Seq(
      ghb_resolver,
      Resolver.mavenLocal
    ),
    scalacOptions ++=
      Seq(
        "-deprecation",
        "-feature",
        "-unchecked",
        "-encoding",
        "utf8",
        "-Xfatal-warnings",
        "-Ywarn-dead-code",
        "-Ywarn-unused"
      )
  )

Global / excludeLintKeys += maintainer

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
  .aggregate(api, spi, native, serv)

lazy val apiSettings = Seq(
  name := "omega-edit",
  libraryDependencies ++= Seq(
    "com.beachape" %% "enumeratum" % enumeratumVersion,
    "com.ctc" %% s"omega-edit-native" % version.value,
    "org.apache.tika" % "tika-core" % tikaVersion,
    "org.apache.tika" % "tika-langdetect-optimaize" % tikaVersion,
    "com.github.jnr" % "jnr-ffi" % jnrFfiVersion,
    "org.scalatest" %% "scalatest" % scalaTestVersion % Test
  ),
  scalacOptions ~= adjustScalacOptionsForScalatest,
  buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion),
  buildInfoObject := "ApiBuildInfo",
  buildInfoPackage := organization.value + ".omega_edit",
  publishConfiguration := publishConfiguration.value.withOverwrite(true),
  publishLocalConfiguration := publishLocalConfiguration.value
    .withOverwrite(true),
  pomPostProcess := filterScopedDependenciesFromPom,
  Compile / Keys.compile :=
    (Compile / Keys.compile)
      .dependsOn(native / publishM2)
      .value,
  Test / Keys.test :=
    (Test / Keys.test)
      .dependsOn(native / publishM2)
      .value
)

lazy val api = project
  .in(file("api"))
  .dependsOn(spi)
  .settings(commonSettings)
  .settings(apiSettings)
  .enablePlugins(BuildInfoPlugin, GitVersioning)

lazy val nativeSettings = Seq(
  name := "omega-edit-native",
  exportJars := (if (isRelease) false else true),
  Compile / packageBin / mappings ++=
    mapping
      .map(mp =>
        (if (libdir.startsWith("/") || libdir.charAt(1) == ':')
           new java.io.File(s"${libdir}/${mp._1}")
         else baseDirectory.value / s"${libdir}/${mp._1}") -> s"${version.value}/${mp._2}"
      ),
  Compile / packageDoc / publishArtifact := false,
  buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion),
  buildInfoPackage := organization.value + ".omega_edit.native",
  buildInfoKeys ++= Seq(
    "sharedLibraryBasePath" -> s"${version.value}/lib"
  ),
  buildInfoOptions += BuildInfoOption.Traits(
    "com.ctc.omega_edit.spi.NativeBuildInfo"
  ),
  publishConfiguration := publishConfiguration.value.withOverwrite(true),
  publishLocalConfiguration := publishLocalConfiguration.value
    .withOverwrite(true)
)

lazy val native = project
  .in(file("native"))
  .dependsOn(spi)
  .settings(commonSettings)
  .settings(nativeSettings)
  .enablePlugins(BuildInfoPlugin, GitVersioning)

lazy val spi = project
  .in(file("spi"))
  .settings(commonSettings)
  .settings(
    name := "omega-edit-spi",
    publishConfiguration := publishConfiguration.value.withOverwrite(true),
    publishLocalConfiguration := publishLocalConfiguration.value
      .withOverwrite(true)
  )
  .enablePlugins(GitVersioning)

lazy val servSettings = Seq(
  name := "omega-edit-grpc-server",
  libraryDependencies ++= {
    if (isRelease)
      Seq(
        "com.ctc" %% "omega-edit" % omegaEditVersion,
        "com.ctc" %% "omega-edit-native" % omegaEditVersion,
        "com.monovore" %% "decline" % declineVersion,
        "org.apache.pekko" %% "pekko-slf4j" % pekkoVersion,
        "org.apache.pekko" %% "pekko-protobuf-v3" % pekkoVersion,
        "org.apache.pekko" %% "pekko-discovery" % pekkoVersion,
        "org.apache.pekko" %% "pekko-stream" % pekkoVersion,
        "org.apache.pekko" %% "pekko-actor" % pekkoVersion,
        "ch.qos.logback" % "logback-classic" % logbackVersion,
        "org.scalatest" %% "scalatest" % scalaTestVersion % Test
      )
    else
      Seq(
        "com.monovore" %% "decline" % declineVersion,
        "org.apache.pekko" %% "pekko-slf4j" % pekkoVersion,
        "org.apache.pekko" %% "pekko-protobuf-v3" % pekkoVersion,
        "org.apache.pekko" %% "pekko-discovery" % pekkoVersion,
        "org.apache.pekko" %% "pekko-stream" % pekkoVersion,
        "org.apache.pekko" %% "pekko-actor" % pekkoVersion,
        "ch.qos.logback" % "logback-classic" % logbackVersion,
        "org.scalatest" %% "scalatest" % scalaTestVersion % Test
      )
  },
  excludeDependencies ++= Seq(
    ExclusionRule("org.checkerframework", "checker-compat-qual")
  ),
  scalacOptions ~= adjustScalacOptionsForScalatest,
  Compile / PB.protoSources += baseDirectory.value / "../../../proto",
  publishConfiguration := publishConfiguration.value.withOverwrite(true),
  publishLocalConfiguration := publishLocalConfiguration.value
    .withOverwrite(true),
  bashScriptExtraDefines += bashExtras,
  batScriptExtraDefines += batchExtras
)

lazy val serv = project
  .in(file("serv"))
  .dependsOn(api, if (!isRelease) native else spi)
  .settings(commonSettings)
  .settings(servSettings)
  .enablePlugins(
    PekkoGrpcPlugin,
    ClasspathJarPlugin,
    GitVersioning,
    JavaServerAppPackaging,
    UniversalPlugin
  )

addCommandAlias(
  "installM2",
  "; clean; native/publishM2; test; api/publishM2; spi/publishM2"
)
addCommandAlias(
  "installM2NoTest",
  "; clean; native/publishM2; api/publishM2; spi/publishM2"
)
addCommandAlias("howMuchCoverage", "; clean; coverage; test; coverageAggregate")
addCommandAlias(
  "publishAll",
  "; clean; +native/publish; +api/publish; +spi/publish"
)
addCommandAlias(
  "runServer",
  "; clean; serv/run"
)
addCommandAlias(
  "pkgServer",
  "; clean; serv/Universal/packageBin"
)
