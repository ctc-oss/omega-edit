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

import sbt._

object Rat {

  lazy val excludes = Seq(

    // git files
    file(".git"),

    // json files
    file("package.json"),
    file("package-lock.json"),
    file(".devcontainer/devcontainer.json"),

    // cmake build folder
    file("cmake-build-debug"),

    // ide folders
    file(".idea"),
    file(".run"),
    file(".vscode"),

    // target and build dirs
    file("target"),
    file("build"),

    // data files for tests
    file("src/tests/data/"),

    // ignore lib files
    file("lib"),

    // ignore generated files
    file("server/core/src/main/java/org.ctc.omegaedit"),
    file("src/bindings/java/omega_edit_wrap.cxx"),
    file("src/bindings/java/omega_edit_wrap.h"),
    file("src/bindings/node/omega_edit_wrap.cxx"),
    file("src/bindings/node/omega_edit_wrap.h"),

    // omega-edit logo picture
    file("images/OmegaEditLogo.png"),

    // node generated files
    file("node_modules"),
    file("module/omega_edit/omega_edit_mac.node"),
    file("module/omega_edit/omega_edit_darwin.node"),
    file("module/omega_edit/omega_edit_linux.node")
    
  )

  lazy val HPP_LICENSE_NAME = "HPP License"

  lazy val HPP_LICENSE_TEXT =
"""
This file has been merged from multiple headers. Please don't edit it directly
Copyright (c) 2021-2022 Two Blue Cubes Ltd. All rights reserved.

Distributed under the Boost Software License, Version 1.0. (See accompanying
file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
"""
}
