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
    // ignore files
    file("packaging/.cpack_ignore"),
    // json files
    file("src/rpc/client/ts/package.json"),
    file("src/rpc/client/ts/package-lock.json"),
    file("src/rpc/client/ts/typedoc.json"),
    file("src/rpc/client/ts/tests/package.json"),
    file("src/rpc/client/ts/tests/package-lock.json"),
    file("src/rpc/client/ts/tests/tsconfig.json"),
    file("src/rpc/client/ts/.prettierrc"),
    // compiled files
    file(".devcontainer/devcontainer.json"),
    file("src/rpc/client/ts/src/client_version.ts"),
    file("src/rpc/client/ts/src/omega_edit_pb.js"),
    file("src/rpc/client/ts/out/settings.js.map"),
    file("src/rpc/client/ts/out/omega_edit_pb.js"),
    file("src/rpc/client/ts/out/change.js.map"),
    file("src/rpc/client/ts/out/viewport.js.map"),
    file("src/rpc/client/ts/out/version.js.map"),
    file("src/rpc/client/ts/src/omega_edit_pb.d.ts"),
    file("src/rpc/client/ts/out/session.js.map"),
    file("src/rpc/client/ts/src/omega_edit_grpc_pb.d.ts"),
    // cmake build folder
    file("cmake-build-debug"),
    file("cmake-build-release"),
    // cmake plugins
    file("cmake/"),
    file("src/rpc/cmake/"),
    file("src/tests/integration/cmake/"),
    // ide folders
    file(".idea"),
    file(".run"),
    file(".vscode"),
    // target and build dirs
    file("target"),
    file("build"),
    // data files for tests
    file("src/examples/data/"),
    file("src/tests/integration/data/"),
    file("src/rpc/client/ts/tests/data/"),
    // ignore lib files
    file("lib"),
    // ignore generated files
    file("server/core/src/main/java/org.ctc.omegaedit"),
    // omega-edit logo picture
    file("images/OmegaEditLogo.png"),
    // node generated files
    file("src/rpc/client/ts/node_modules"),
    file("src/rpc/client/ts/omega_edit_grpc_pb.d.ts"),
    file("src/rpc/client/ts/omega_edit_grpc_pb.js"),
    file("src/rpc/client/ts/omega_edit_pb.d.ts"),
    file("src/rpc/client/ts/omega_edit_pb.js"),
    file("src/rpc/client/ts/yarn.lock")
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
