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

package com.ctc.omega_edit.spi

trait NativeBuildInfo {
  def name: String
  def version: String
  def scalaVersion: String
  def sbtVersion: String
  def sharedLibraryOs: String
  def sharedLibraryArch: String
  def sharedLibraryName: String
  def sharedLibraryPath: String
}

object NativeBuildInfo {
  private val Mac = """mac.+""".r
  private val Win = """windows.+""".r

  def matches(info: NativeBuildInfo): Boolean = {
    val thisOs = System.getProperty("os.name").toLowerCase match {
      case "linux" => Some("linux")
      case Mac()   => Some("macos")
      case Win()   => Some("windows")
      case _       => None
    }

    val libOs = info.sharedLibraryOs
    val libArch = info.sharedLibraryArch
    (thisOs, System.getProperty("os.arch")) match {
      case (Some(`libOs`), `libArch`) => true
      case _                          => false
    }
  }
}
