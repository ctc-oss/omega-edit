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
import scala.io.Source
import scala.util.Using

lazy val packageData = Json
  .parse(Using(Source.fromFile("../../client/ts/package.json"))(source => source.mkString).get)
  .as[JsObject]
lazy val omegaVersion = packageData("version").as[String]

lazy val ghb_repo_owner = "ctc-oss"
lazy val ghb_repo = "omega-edit"
lazy val ghb_resolver = (
  s"GitHub ${ghb_repo_owner} Apache Maven Packages"
    at
      s"https://maven.pkg.github.com/${ghb_repo_owner}/${ghb_repo}"
)

// Can be removed later and only be in .github/release.sbt -- mostly used for
// getting all 3 jars working inside of one package
lazy val bashExtras = s"""declare new_classpath=\"$$app_classpath\"
declare windows_jar_file="com.ctc.omega-edit-native_2.13-${omegaVersion}-windows-${arch.arch}.jar"
declare linux_jar_file="com.ctc.omega-edit-native_2.13-${omegaVersion}-linux-${arch.arch}.jar"
declare macos_jar_file="com.ctc.omega-edit-native_2.13-${omegaVersion}-macos-${arch.arch}.jar"
if [[ $$OSTYPE == "darwin"* ]]; then
  new_classpath=$$(echo $$new_classpath |\\
    sed -e "s/$${linux_jar_file}/$${macos_jar_file}/" | \\
    sed -e "s/$${windows_jar_file}/$${macos_jar_file}/"\\
  )
else
  new_classpath=$$(echo $$new_classpath |\\
    sed -e "s/$${macos_jar_file}/$${linux_jar_file}/" | \\
    sed -e "s/$${windows_jar_file}/$${linux_jar_file}/"\\
  )
fi"""

lazy val batchExtras = s"""
set "NEW_CLASSPATH=%APP_CLASSPATH%"
set "WINDOWS_JAR_FILE=com.ctc.omega-edit-native_2.13-${omegaVersion}-windows-${arch.arch}.jar"
set "NEW_CLASSPATH=%NEW_CLASSPATH:com.ctc.omega-edit-native_2.13-${omegaVersion}-linux-${arch.arch}.jar=!WINDOWS_JAR_FILE!%"
set "NEW_CLASSPATH=%NEW_CLASSPATH:com.ctc.omega-edit-native_2.13-${omegaVersion}-macos-${arch.arch}.jar=!WINDOWS_JAR_FILE!%""""

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
    publishConfiguration := publishConfiguration.value.withOverwrite(true),
    publishLocalConfiguration := publishLocalConfiguration.value.withOverwrite(true),
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
  .aggregate(api, spi, native, serv)

lazy val api = project
  .in(file("api"))
   /*
    * technically changing .dependsOn to this:
    *   .dependsOn(spi, native % "compile->publishM2;test->publishM2")
    * should be the same as the #region section but doesn't ever run native/publishM2
    */
  .dependsOn(spi, native % "test->compile")
  .settings(commonSettings)
  .settings(
    name := "omega-edit",
    libraryDependencies ++= {
      Seq(
        "com.beachape" %% "enumeratum" % "1.7.0",
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
    artifactClassifier := Some(platform.id),
    exportJars := true,
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
  .in(file("spi"))
  .settings(commonSettings)
  .settings(
    name := "omega-edit-spi"
  )
  .enablePlugins(GitVersioning)

lazy val serv = project
  .in(file("serv"))
  .dependsOn(api, native)
  .settings(commonSettings)
  .settings(
    name := "omega-edit-grpc-server",
    libraryDependencies ++= {
      Seq(
        "com.monovore" %% "decline" % "2.3.0",
        "org.scalatest" %% "scalatest" % "3.2.13" % Test
      )
    },
    excludeDependencies ++= Seq(
      ExclusionRule("org.checkerframework", "checker-compat-qual")
    ),
    scalacOptions ~= adjustScalacOptionsForScalatest,
    resolvers += Resolver.mavenLocal,
    externalResolvers += ghb_resolver,
    Compile / PB.protoSources += baseDirectory.value / "../../../protos", // path relative to projects directory
    publishConfiguration := publishConfiguration.value.withOverwrite(true),
    publishLocalConfiguration := publishLocalConfiguration.value.withOverwrite(true),
    bashScriptExtraDefines += bashExtras,
    batScriptExtraDefines += batchExtras
  )
  .enablePlugins(
    AkkaGrpcPlugin,
    GitVersioning,
    JavaServerAppPackaging,
    UniversalPlugin
  )

addCommandAlias(
  "installM2",
  "; clean; native/publishM2; test; api/publishM2; spi/publishM2"
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
