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
import sbt.URL

import scala.util.matching.Regex
import scala.xml.transform.{RewriteRule, RuleTransformer}
import scala.xml.{Node => XmlNode, NodeSeq => XmlNodeSeq, _}

object BuildSupport {
  case class Platform(os: String, bits: String) {
    def id: String = s"$os-$bits"
    def _id: String = s"${os}_$bits"
  }
  case class Arch(id: String, _id: String, os: String, arch: String)
  val libdir: String = new java.io.File(
    sys.env.getOrElse("OE_LIB_DIR", "../../_install")
  ).toPath.toAbsolutePath.normalize.toString // get full path as relative can cause issues
  val apacheLicenseUrl: URL = new URL(
    "https://www.apache.org/licenses/LICENSE-2.0.txt"
  )

  // regexes for platform parsing
  val Mac: Regex = """mac.+""".r
  val Win: Regex = """windows.+""".r

  // regexes for arch parsing
  val Amd: Regex = """amd(\d+)""".r
  val x86: Regex = """x86_(\d+)""".r
  val aarch: Regex = """aarch(\d+)""".r
  val arm: Regex = """arm(\d+)""".r

  // https://stackoverflow.com/a/51416386
  def filterScopedDependenciesFromPom(node: XmlNode): XmlNode =
    new RuleTransformer(new RewriteRule {
      override def transform(node: XmlNode): XmlNodeSeq =
        node match {
          case e: Elem
              if e.label == "dependency"
                && e.child.exists(child => child.label == "scope") =>
            def txt(label: String): String =
              "\"" + e.child
                .filter(_.label == label)
                .flatMap(_.text)
                .mkString + "\""
            Comment(
              s""" scoped dependency ${txt("groupId")} % ${txt(
                  "artifactId"
                )} % ${txt("version")} % ${txt("scope")} has been omitted """
            )
          case _ => node
        }
    }).transform(node).head

  lazy val platform: Platform = {
    val os = System.getProperty("os.name").toLowerCase match {
      case "linux" => "linux"
      case Mac()   => "macos"
      case Win()   => "windows"
      case os      => throw new IllegalStateException(s"unsupported OS: $os")
    }

    val arch =
      if (os == "macos" || os == "linux")
        System.getProperty("os.arch").toLowerCase
      else
        System.getProperty("os.arch").toLowerCase match {
          case Amd(bits)   => bits
          case x86(bits)   => bits
          case aarch(bits) => bits
          case arch        => throw new IllegalStateException(s"unknown arch: $arch")
        }

    Platform(os, arch)
  }

  lazy val arch: Arch = {
    val os = System.getProperty("os.name").toLowerCase match {
      case "linux" => "linux"
      case Mac()   => "macos"
      case Win()   => "windows"
    }

    val arch =
      if (os == "macos" || os == "linux")
        System.getProperty("os.arch").toLowerCase
      else
        System.getProperty("os.arch").toLowerCase match {
          case Amd(bits)   => bits
          case x86(bits)   => bits
          case aarch(bits) => bits
          case arch        => throw new IllegalStateException(s"unknown arch: $arch")
        }

    Arch(s"$os-$arch", s"${os}_$arch", s"$os", s"$arch")
  }

  lazy val supportedArches = List("amd64", "aarch64", "x86_64", "64") // "64" is used for windows

  /** NOTE: Some functionality below is needed to allow support for local artifacts as well as release artifacts. This
    * meaning we support a newly built lib file on its own, as well as handling having all needed lib files in the
    * folder
    */

  def pair(name: String, desiredName: String = ""): (String, String) =
    if (desiredName != "") name -> s"lib/$desiredName"
    else name -> s"lib/$name"

  def findPair(filename: String): (String, String) = {
    val filenameParts = filename.split("\\.")
    val fileOS = getOsFromSharedFileExtension(filenameParts(1))

    supportedArches.find(filename.contains(_)) match {
      case Some(fileArch) =>
        if (filename.contains(fileOS))
          pair(filename)
        else
          pair(filename, filename.replace(fileArch, s"${fileOS}_$fileArch"))
      // default to use host arch, unless windows since only 64 is allowed - allows for local development with a newly built file
      case _ =>
        val defaultArch = if (fileOS != "windows") arch.arch else "64"
        pair(filename, s"${filenameParts(0)}_${fileOS}_$defaultArch.${filenameParts(1)}")
    }
  }

  def getOsFromSharedFileExtension(sharedFileExtension: String): String =
    sharedFileExtension match {
      case "so"    => "linux"
      case "dylib" => "macos"
      case "dll"   => "windows"
      case _       => throw new IllegalStateException(s"bad shared library file extension $sharedFileExtension")
    }

  def getMappings(libFileList: List[java.io.File], multiple: Boolean): List[(String, String)] =
    if (multiple) {
      libFileList.map(f => findPair(f.getName))
    } else {
      List(findPair(libFileList(0).getName))
    }

  lazy val mapping: List[(String, String)] = {
    val libFileList =
      new java.io.File(libdir).listFiles
        .filter(_.isFile)
        // only want the lib files with a single period, for the filename like .dylib, .so, .dll.
        .filter(
          _.getName.filter(_ == '.').size == 1
        )
        .toList

    getMappings(
      libFileList,
      libFileList.length match {
        case single if single == 1 => false
        case mult if mult > 1      => true
        case _                     => throw new IllegalStateException(s"no lib files found in $libdir")
      }
    )
  }

  lazy val adjustScalacOptionsForScalatest: Seq[String] => Seq[String] = { (opts: Seq[String]) =>
    opts.filterNot(
      Set(
        "-Wvalue-discard",
        "-Ywarn-value-discard"
      )
    )
  }
}
