<!--
  Copyright (c) 2021 Concurrent Technologies Corporation.

  Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at                                                    

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software is distributed under the License is       
  distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or              
  implied.  See the License for the specific language governing permissions and limitations under the License.  
-->

<div align="center">
<p>
    <img alt="Omega Edit Logo" src="https://raw.githubusercontent.com/ctc-oss/omega-edit/main/images/OmegaEditLogo.png" width=120>
</p>

<h1>Ωedit™ Library</h1>


[![Release](https://shields.io/github/v/release/ctc-oss/omega-edit?display_name=tag&include_prereleases&sort=semver)](https://github.com/ctc-oss/omega-edit/releases)
![Build Status](https://github.com/ctc-oss/omega-edit/workflows/Unit%20Tests/badge.svg)
![CodeQL](https://github.com/ctc-oss/omega-edit/workflows/CodeQL/badge.svg)
[![codecov](https://codecov.io/gh/ctc-oss/omega-edit/branch/main/graph/badge.svg)](https://codecov.io/gh/ctc-oss/omega-edit)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_shield)
[![Join the chat at https://gitter.im/ctc-oss/community](https://badges.gitter.im/ctc-oss/community.svg)](https://gitter.im/ctc-oss/community)

</div>

## Goal

The goal of this project is to provide an open source library for building editors that can handle massive files, and
multiple viewports.

## User documentation

User documentation is published to https://ctc-oss.github.io/omega-edit/.

## Requirements

### Command line tools


- **C/C++ compiler** (such as clang, gcc, mingw, or MSVC)
- **CMake** (https://cmake.org/download/)
- **conan** C/C++ package manager (https://conan.io)
- **git** for version control (https://git-scm.com)
- **make** or **ninja** for running the build scripts (https://www.gnu.org/software/make/ or https://ninja-build.org)
- **nvm** or **nodeenv** for using specific versions of node.js
- **doxygen** to generate API documentation (https://www.doxygen.nl)
- **graphviz** to generate API documentation (https://graphviz.org)
- **sphinx** to generate user documentation (https://www.sphinx-doc.org)
  - **sphinx RTD theme** (https://github.com/readthedocs/sphinx_rtd_theme)
  - **breathe** ReStructuredText and Sphinx bridge to Doxygen (https://github.com/michaeljones/breathe)
- **scala/sbt/java** for building and running the gRPC server (https://www.scala-lang.org)
- **yarn** for building, testing, and packaging the node artifacts (https://yarnpkg.com)

### IDE

The Ωedit™ project is built primarily using [CLion](https://www.jetbrains.com/clion/), though [Visual
Studio Code](https://code.visualstudio.com/) also works well.

## Build the core library (C/C++)

:exclamation: These commands should be executed at the root level of the repository :exclamation:

### Install conan:

Conan is the package manager used to install the C/C++ dependencies.  It can be installed via pip.

```bash
pip install conan
```

### Configure a build:

Depending on your linking needs, Ωedit™ can be built _either_ as a static (e.g., libomega_edit.a) or shared
(e.g., libomega_edit.so) library.  `Release` or `Debug` versions can be created.  Example programs and documentation can
also be built if desired.  The Scala server _requires_ a shared library.

Here is how to build a debug version of a shared library, with no documentation or example programs.

```bash
cmake -S . -B _build -DCMAKE_BUILD_TYPE=Debug -DBUILD_DOCS=NO -DBUILD_EXAMPLES=NO -DBUILD_SHARED_LIBS=YES
```

### Build the configured build:

This will build the core library, and any example programs or documentation if configured.  Note that the config type
(`Debug` or `Release`) must match the config type (`CMAKE_BUILD_TYPE`) used when configuring the build.

```bash
cmake --build _build --config Debug
```

### Run the test suite:

This will run the test suite for the core library.  Note that the build config (`Debug` or `Release`) must match the
config type (`CMAKE_BUILD_TYPE`) used when configuring the build.

```bash
ctest --build-config Debug --test-dir _build/core --output-on-failure
```

### Install the core library:

We're installing in a directory named `_install` in the root of the repository.  This is is where the Scala server will
look for the shared library by default or it can use the OE_LIB_DIR environment variable if different than the default
location.  If you just want to use the library itself, you can install it anywhere you like (e.g., `/usr/local`).

```bash
cmake --install _build --config Debug --prefix _install
```

## Packaging Ωedit™ gRPC Server and Node Client

:exclamation: These commands should be executed at the root level of the repository after building/installing the core
library :exclamation:

Build, test, and package the server and client node packages.  The server package will include the shared library built
in the previous step and packages a gRPC server that runs in a Java Virtual Machine (JVM).  The client package will
include the node client.

```bash
yarn install
yarn workspace @omega-edit/server package
yarn workspace @omega-edit/client test
```

Node packages will be in `.tgz` files located at:

```
/packages/server/omega-edit-node-server-${VERSION}.tgz
/packages/client/omega-edit-node-client-${VERSION}.tgz
```

## Release Binaries

[Binary releases](https://github.com/ctc-oss/omega-edit/releases) for macOS (Apple Silicon and x86), Windows (x86), and
Linux (ARM, and x86; glibc 2.31 or greater required) are built and published via GitHub CI workflows.

## Versioning

Ωedit™ follows [Semantic Versioning](http://semver.org/).

## &#9889;Powered by Ωedit™

- [Apache Daffodil™ Extension for Visual Studio Code](https://github.com/apache/daffodil-vscode) - The Data Editor
 component of this Visual Studio Code extension is powered by Ωedit™.

## License

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_large)
