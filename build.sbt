/**********************************************************************************************************************
 * Copyright (c) 2021 Concurrent Technologies Corporation.                                                                 *
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

lazy val commonSettings = {
  Seq(
    licenses += ("Apache-2.0", new URL("https://www.apache.org/licenses/LICENSE-2.0.txt")),
    organization := "org.apache",
    scalaVersion := "2.12.13",
    scalacOptions ++= Seq("-Ypartial-unification"),
    startYear := Some(2021),
  )
}

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
  .settings(
    name := "omega-edit",
    publish / skip := true
  )
  .enablePlugins(commonPlugins: _*)
