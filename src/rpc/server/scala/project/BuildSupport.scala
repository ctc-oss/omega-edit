import sbt.URL

import scala.util.matching.Regex

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

import scala.xml.transform.{RewriteRule, RuleTransformer}
import scala.xml.{Node => XmlNode, NodeSeq => XmlNodeSeq, _}

object BuildSupport {
  case class Platform(os: String, bits: String) {
    def id: String = s"$os-$bits"
    def _id: String = s"${os}_$bits"
  }
  case class Arch(id: String, _id: String, os: String, arch: String)
  val libdir: String = "../../../../../lib" // path relative to the native projects directory
  val apacheLicenseUrl: URL = new URL(
    "https://www.apache.org/licenses/LICENSE-2.0.txt"
  )

  // some regexes for arch parsing
  val Mac: Regex = """mac.+""".r
  val Win: Regex = """windows.+""".r
  val Amd: Regex = """amd(\d+)""".r
  val x86: Regex = """x86_(\d+)""".r
  val aarch: Regex = """aarch(\d+)""".r

  // https://stackoverflow.com/a/51416386
  def filterScopedDependenciesFromPom(node: XmlNode): XmlNode =
    new RuleTransformer(new RewriteRule {
      override def transform(node: XmlNode): XmlNodeSeq = node match {
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
      case os      => throw new IllegalStateException(s"Unsupported OS: $os")
    }

    val arch =
      if (os == "macos") System.getProperty("os.arch").toLowerCase
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
      if (os == "macos") System.getProperty("os.arch").toLowerCase
      else
        System.getProperty("os.arch").toLowerCase match {
          case Amd(bits)   => bits
          case x86(bits)   => bits
          case aarch(bits) => bits
          case arch        => throw new IllegalStateException(s"unknown arch: $arch")
        }

    Arch(s"$os-$arch", s"${os}_$arch", s"$os", s"$arch")
  }

  def pair(name: String): (String, String) = name -> s"${platform._id}/$name"
  lazy val mapping: (String, String) = {
    val Mac = """mac.+""".r
    System.getProperty("os.name").toLowerCase match {
      case "linux" => pair("libomega_edit.so")
      case Mac()   => pair("libomega_edit.dylib")
      case Win()   => pair("omega_edit.dll")
    }
  }

  lazy val adjustScalacOptionsForScalatest: Seq[String] => Seq[String] = { opts: Seq[String] =>
    opts.filterNot(
      Set(
        "-Wvalue-discard",
        "-Ywarn-value-discard"
      )
    )
  }
}
