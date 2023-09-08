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
lazy val omegaVersion = packageData("version").as[String]

lazy val ghb_repo_owner = "ctc-oss"
lazy val ghb_repo = "omega-edit"
lazy val ghb_resolver = (
  s"GitHub ${ghb_repo_owner} Apache Maven Packages"
    at
      s"https://maven.pkg.github.com/${ghb_repo_owner}/${ghb_repo}"
)

/** The script templates only need to know the version. The updating of the classpaths was moved to the template files
  * in serv/src/templates
  */
lazy val bashExtras = s"""declare omegaVersion="${omegaVersion}""""
lazy val batchExtras = s"""set "OMEGAVERSION=${omegaVersion}""""

lazy val isRelease =
  Try(sys.env.get("IS_RELEASE").getOrElse("").toBoolean).getOrElse(false)
lazy val serverRelease =
  Try(sys.env.get("SERVER_RELEASE").getOrElse("").toBoolean).getOrElse(false)

lazy val pekkoVersion = "1.0.1" // this needs updated in tandem with the pekko-grpc-sbt-plugin plugin
lazy val tikaVersion = "2.9.0"

lazy val commonSettings =
  Seq(
    organization := "com.ctc",
    scalaVersion := "2.13.10",
    version := omegaVersion,
    licenses += ("Apache-2.0", new URL(
      "https://www.apache.org/licenses/LICENSE-2.0.txt"
    )),
    organizationName := "Concurrent Technologies Corporation",
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
    )
  )

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

lazy val api = project
  .in(file("api"))
  /*
   * technically changing .dependsOn to this:
   *   .dependsOn(spi, native % "compile->publishM2;test->publishM2")
   * should be the same as the #region section but doesn't ever run native/publishM2
   */
  .dependsOn(spi)
  .settings(commonSettings)
  .settings(
    name := "omega-edit",
    libraryDependencies ++= {
      Seq(
        "com.beachape" %% "enumeratum" % "1.7.2",
        "com.ctc" %% s"omega-edit-native" % version.value,
        "com.github.jnr" % "jnr-ffi" % "2.2.13",
        "org.scalatest" %% "scalatest" % "3.2.15" % Test
      )
    },
    scalacOptions ~= adjustScalacOptionsForScalatest,
    buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion),
    buildInfoObject := "ApiBuildInfo",
    buildInfoPackage := organization.value + ".omega_edit",
    // trim the dep to the native project from the pom
    pomPostProcess := filterScopedDependenciesFromPom,
    // #region Needed for packaging to work without an extra command for native/publishM2
    Compile / Keys.compile :=
      (Compile / Keys.compile)
        .dependsOn(native / publishM2)
        .value,
    Test / Keys.test :=
      (Test / Keys.test)
        .dependsOn(native / publishM2)
        .value
    // #endregion
  )
  .enablePlugins(BuildInfoPlugin, GitVersioning)

lazy val native = project
  .in(file("native"))
  .dependsOn(spi)
  .settings(commonSettings)
  .settings(
    name := "omega-edit-native",
    // artifactClassifier := Some(platform.id),
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

    /** Not sure why these need added here since they are in common settings, but they are needed to not cause errors
      * with publishM2.
      */
    publishConfiguration := publishConfiguration.value.withOverwrite(true),
    publishLocalConfiguration := publishLocalConfiguration.value
      .withOverwrite(true)
  )
  .enablePlugins(BuildInfoPlugin, GitVersioning)

lazy val spi = project
  .in(file("spi"))
  .settings(commonSettings)
  .settings(
    name := "omega-edit-spi"
  )
  .enablePlugins(GitVersioning)

lazy val serv = project
  .in(file("serv"))
  // shouldn't dependOn spi since api does but need to have an else
  .dependsOn(api, if (!isRelease) native else spi)
  .settings(commonSettings)
  .settings(
    name := "omega-edit-grpc-server",
    if (isRelease)
      libraryDependencies ++= Seq(
        "com.ctc" %% "omega-edit" % omegaVersion,
        "com.ctc" %% "omega-edit-native" % omegaVersion,
        "com.monovore" %% "decline" % "2.4.1",
        "org.apache.pekko" %% "pekko-slf4j" % pekkoVersion,
        "org.apache.tika" % "tika-core" % tikaVersion,
        "org.apache.tika" % "tika-langdetect-optimaize" % tikaVersion,
        "ch.qos.logback" % "logback-classic" % "1.3.5", // latest version that supports Java 8
        "org.scalatest" %% "scalatest" % "3.2.15" % Test
      )
    else
      libraryDependencies ++= Seq(
        "com.monovore" %% "decline" % "2.4.1",
        "org.apache.pekko" %% "pekko-slf4j" % pekkoVersion,
        "org.apache.tika" % "tika-core" % tikaVersion,
        "org.apache.tika" % "tika-langdetect-optimaize" % tikaVersion,
        "ch.qos.logback" % "logback-classic" % "1.3.5", // latest version that supports Java 8
        "org.scalatest" %% "scalatest" % "3.2.15" % Test
      ),
    excludeDependencies ++= Seq(
      ExclusionRule("org.checkerframework", "checker-compat-qual")
    ),
    scalacOptions ~= adjustScalacOptionsForScalatest,
    Compile / PB.protoSources += baseDirectory.value / "../../../proto", // path relative to projects directory
    publishConfiguration := publishConfiguration.value.withOverwrite(true),
    publishLocalConfiguration := publishLocalConfiguration.value
      .withOverwrite(true),
    bashScriptExtraDefines += bashExtras,
    batScriptExtraDefines += batchExtras
  )
  .enablePlugins(
    PekkoGrpcPlugin,
    ClasspathJarPlugin,
    GitVersioning,
    JavaServerAppPackaging,
    UniversalPlugin,
    ClasspathJarPlugin
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
