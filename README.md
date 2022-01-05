<div style="text-align: center">
<p>
    <img alt="Omega Edit Logo" src="https://raw.githubusercontent.com/ctc-oss/omega-edit/main/images/OmegaEditLogo.png" width=120>
</p>

<h1>Ωedit Library</h1>

</div>

<div style="text-align: center">

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

### Development requirements:

- **swig** to generate language bindings (http://www.swig.org/svn.html)

## Build the core library (C/C++)

### cmake commands

:exclamation: These commands should be executed at the root level of the repository :exclamation:

Configure debug build:

```bash
cmake -S . -B cmake-build-debug
```

Run debug build:

```bash
cmake --build cmake-build-debug
```

Run unit tests:

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

## Development

### Regenerate Node bindings using SWIG (as required)

If any header files have been added, removed, or changed, regenerate the API wrapper code using SWIG:

```bash
swig -javascript -node -v -c++ src/bindings/omega_edit.i
```

## License

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_large)
