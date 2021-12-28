# Ωedit Library
<img alt="Omega Edit Logo" src="https://raw.githubusercontent.com/scholarsmate/omega-edit/main/images/OmegaEditLogo.png" width=64 style="float: left">

![Build Status](https://github.com/scholarsmate/omega-edit/workflows/Unit%20Tests/badge.svg)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fscholarsmate%2Fomega-edit.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fscholarsmate%2Fomega-edit?ref=badge_shield)
[![codecov](https://codecov.io/gh/scholarsmate/omega-edit/branch/main/graph/badge.svg)](https://codecov.io/gh/scholarsmate/omega-edit)

The goal of this project is to provide an open source library for building editors that can handle massive files, multiple authors, and multiple viewports.

## Requirements
This repo is built using CLion, if using CLion everything will work seamlessly, though Visual Studio Code also works well. (cmake)

If you are using just the command line you will need these things installed:
- C/C++ compiler (such as clang, gcc, or mingw)
- CMake (https://cmake.org/download/)
- make or ninja
- nvm or nodeenv

If developing the Ωedit API, you'll need SWIG installed as well.

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

The SWIG bindings are generated for Node v10, so we need to setup the environment accordingly.  There are several reasonable ways to do this.  Here are two options:

#### **OPTION 1:** Use nvm ([Node Version Manager](https://github.com/nvm-sh/nvm))

Using Node v10 in nvm looks like this:

```bash
nvm use 10
```

#### **OPTION 2:** Setup a Node v10 virtual environment using [nodeenv](https://pypi.org/project/nodeenv/)

```bash
nodeenv --node=10.24.1 venv
```

Activate the Node virtual environment:

```bash
source ./venv/bin/activate
```

#### Building and testing

Using Node v10 (by whatever method), build the bindings, and run an example:

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
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fscholarsmate%2Fomega-edit.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fscholarsmate%2Fomega-edit?ref=badge_large)