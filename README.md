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

<h1>Ωedit Library</h1>


[![Release](https://shields.io/github/v/release/ctc-oss/omega-edit?display_name=tag&include_prereleases&sort=semver)](https://github.com/ctc-oss/omega-edit/releases)
![Build Status](https://github.com/ctc-oss/omega-edit/workflows/Unit%20Tests/badge.svg)
![CodeQL](https://github.com/ctc-oss/omega-edit/workflows/CodeQL/badge.svg)
[![codecov](https://codecov.io/gh/ctc-oss/omega-edit/branch/main/graph/badge.svg)](https://codecov.io/gh/ctc-oss/omega-edit)
[![Total alerts](https://img.shields.io/lgtm/alerts/g/ctc-oss/omega-edit.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/ctc-oss/omega-edit/alerts/)
[![Language grade: C/C++](https://img.shields.io/lgtm/grade/cpp/g/ctc-oss/omega-edit.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/ctc-oss/omega-edit/context:cpp)
[![Language grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/ctc-oss/omega-edit.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/ctc-oss/omega-edit/context:javascript)
[![Language grade: Python](https://img.shields.io/lgtm/grade/python/g/ctc-oss/omega-edit.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/ctc-oss/omega-edit/context:python)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_shield)
[![Join the chat at https://gitter.im/ctc-oss/community](https://badges.gitter.im/ctc-oss/community.svg)](https://gitter.im/ctc-oss/community)

</div>

## Goal

The goal of this project is to provide an open source library for building editors that can handle massive files, and multiple viewports.

## User documentation

User documentation is published to https://ctc-oss.github.io/omega-edit/.

## Requirements

### IDE

The Ωedit project is built primarily using CLion.  If using CLion everything should build seamlessly, though Visual
Studio Code also works well.

### Command line tools

- **C/C++ compiler** (such as clang, gcc, mingw, or MSVC)
- **CMake** (https://cmake.org/download/)
- **conan** C/C++ package manager
- **make** or **ninja** for running the build scripts
- **nvm** or **nodeenv** for using specific versions of node.js
- **doxygen** to generate API documentation (https://www.doxygen.nl)
- **sphinx** to generate user documentation (https://www.sphinx-doc.org)
  - **sphinx RTD theme** (https://github.com/readthedocs/sphinx_rtd_theme)
  - **breathe** ReStructuredText and Sphinx bridge to Doxygen (https://github.com/michaeljones/breathe)
- **scala/sbt/java**

## Build the core library (C/C++)

:exclamation: These commands should be executed at the root level of the repository :exclamation:

### Install conan:

```bash
pip install conan
```

### Configure a debug build:

Depending on your linking needs, Ωedit can be built as either as a static (e.g., libomega_edit.a) or shared (e.g., libomega_edit.so) library.

- #### Static:

```bash
cmake -S . -B cmake-build-debug -DCMAKE_BUILD_TYPE=Debug
```

- #### Shared:

```bash
cmake -S . -B cmake-build-debug -DCMAKE_BUILD_TYPE=Debug -DBUILD_SHARED_LIBS=YES
```

### Build the configured build:

```bash
cmake --build cmake-build-debug
```

### Run the test suite:

```bash
cmake -S src/tests -B cmake-build-tests -DCMAKE_BUILD_TYPE=Debug
pushd cmake-build-tests && ctest -C Debug --output-on-failure && popd
```

## Packaging Ωedit

### TypeScript Client

This package is normally uploaded to npmjs.com

:exclamation: Node needs to be installed but shouldn't matter what version you use. :exclamation:

- Create local `.tgz` file

  ```bash
  cd src/rpc/client/ts
  yarn install # if not ran before
  yarn package
  ```

  - File will be at

    ```bash
    src/rpc/client/ts/omega-edit-v${VERSION}.tgz
    ```

- Publish `.tgz` file to npmjs -- requires auth

  ```bash
  yarn publish omega-edit-v${VERSION}.tgz
  ```

### Scala API and Native

This publishes for Scala version 2.13 to GitHub packages.

- Requires the `GITHUB_TOKEN` environment variable to be set

```bash
sbt publishAll
```

### Scala Reference Server

This packages the reference Scala server to a local zip folder

```bash
cd src/rpc/server/scala
sbt universial:packageBin
```

Zip file will be located at

```bash
src/rpc/server/scala/target/universal/omega-edit-grpc-server-${VERSION}.zip
```

## Development

Currently, the repo holds bindings for both Scala and node.

## Release Binaries

[Binary releases](https://github.com/ctc-oss/omega-edit/releases) for macOS (x86), Windows (x86), and Linux (ARM, and x86; glibc 2.31 or greater required) are built and published via GitHub CI workflows.

## Versioning

Ωedit follows [Semantic Versioning](http://semver.org/).

## License

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_large)
