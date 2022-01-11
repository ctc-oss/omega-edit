<!--
  Copyright (c) 2021-2022 Concurrent Technologies Corporation.                                                       

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


![Build Status](https://github.com/ctc-oss/omega-edit/workflows/Unit%20Tests/badge.svg)
![CodeQL](https://github.com/ctc-oss/omega-edit/workflows/CodeQL/badge.svg)
[![codecov](https://codecov.io/gh/ctc-oss/omega-edit/branch/main/graph/badge.svg)](https://codecov.io/gh/ctc-oss/omega-edit)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_shield)
[![Release](https://shields.io/github/v/release/ctc-oss/omega-edit?display_name=tag&include_prereleases&sort=semver)](https://github.com/ctc-oss/omega-edit/releases)

</div>

## Goal

The goal of this project is to provide an open source library for building editors that can handle massive files,
multiple authors, and multiple viewports.

## Requirements
### Development requirements:

- **swig** to generate language bindings (http://www.swig.org/svn.html)

### IDE

The Ωedit project is built primarily using CLion.  If using CLion everything should build seamlessly, though Visual
Studio Code also works well.

### Command line tools

- **C/C++ compiler** (such as clang, gcc, or mingw)
- **CMake** (https://cmake.org/download/)
- **make** or **ninja** for running the build scripts
- **nvm** or **nodeenv** for using specific versions of node.js
- **node-gyp** (to run `package.json` scripts)
  - `npm install -g node-gyp`
- **doxygen** to generate API documentation (https://www.doxygen.nl)
- **sphinx** to generate user documentation (https://www.sphinx-doc.org)
  - **sphinx RTD theme** (https://github.com/readthedocs/sphinx_rtd_theme)
  - **breathe** ReStructuredText and Sphinx bridge to Doxygen (https://github.com/michaeljones/breathe)
- **scala/sbt/java**

### Development requirements:

- **swig** to generate language bindings (http://www.swig.org/svn.html)

## Build the core library (C/C++)

:exclamation: These commands should be executed at the root level of the repository :exclamation:

### Pulling the submodules required to build:

```bash
git submodule init
git submodule update
```

### Configure debug build:

```bash
cmake -S . -B cmake-build-debug
```

### Run debug build:

```bash
cmake --build cmake-build-debug
```

### Run unit tests:

```bash
cd cmake-build-debug/src/tests/
./omega_test -d yes --order lex
cd ../../../
```

## Build Node bindings

The SWIG bindings are generated for Node v14, so we need to setup the environment accordingly.  There are several reasonable ways to do this.  Here are two options:

#### **OPTION 1:** Use nvm ([Node Version Manager](https://github.com/nvm-sh/nvm))

Using Node v14 in nvm looks like this:

```bash
nvm use 14
```

#### **OPTION 2:** Setup a Node v14 virtual environment using [nodeenv](https://pypi.org/project/nodeenv/)

```bash
nodeenv --node=14.16.0 venv
```

Activate the Node virtual environment:

```bash
source ./venv/bin/activate
```

#### Building and testing

Using Node v12 (by whatever method), build the bindings, and run an example:

```bash
node ci
node src/examples/omega_simple.js
```

## Creating Java Native/Shared Library - Manual

### Create C++ binary

```bash
cmake -S . -B cmake-build-debug
cmake --build cmake-build-debug
```

### Create wrapper binary

```bash
g++ -std=c++11 -c -fPIC -I${JAVA_HOME}/include -I${JAVA_HOME}/include/darwin src/bindings/java/omega_edit_wrap.cxx -o lib/omega_edit_wrap.o
```

### Create libray file

```bash
g++ -std=c++11 -dynamiclib -o lib/libomega_edit.dylib cmake-build-debug/libomega_edit.a lib/omega_edit_wrap.o -lc
```

## Running API

For the Scala code the `build.sbt` runs everything listed above automatically. This is to ensure the environment is setup so that the API can run without errors.

Command to start up API:

```
sbt run
```

If you navigate to `http://localhost:9000/no_params?methodName=omega_license_get` in the browser you get the license text.

## Packaging omega-edit

Package file follows naming pattern `omega_edit-$omegaEditVer`, eg `omega_edit-1.0.0-0.1.0-SNAPSHOT.zip`.
The `libomega_edit.*` files that are stored in `lib` are added the package when the command is ran.

```
sbt universal:packageBin
```

## Development

Currently, the repo holds bindings for both java and node.


### Regenerate Java bindings using SWIG (as required)

If any header files have been added, removed, or changed, regenerate the API wrapper code using SWIG:

```bash
swig -v -c++ -java -outdir src/bindings/java src/bindings/java/omega_edit.i
```

### Regenerate Node bindings using SWIG (as required)

If any header files have been added, removed, or changed, regenerate the API wrapper code using SWIG:

```bash
swig -javascript -node -v -c++ -outdir src/bindings/node src/bindings/node/omega_edit.i
```

## License

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_large)
