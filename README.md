# Ωedit Library
<img alt="Omega Edit Logo" src="https://raw.githubusercontent.com/scholarsmate/omega-edit/main/images/OmegaEditLogo.png" width=64 style="float: left">
The goal of this project is to provide an open source library for building editors that can handle massive files, multiple authors, and multiple viewports.

## Requirements
This repo is built using CLion, if using CLion everything will work seamlessly, though Visual Studio Code also works well. (cmake)

If you are using just the command line you will need these things installed:
- C/C++ compiler (such as clang, gcc, or mingw)
- CMake (https://cmake.org/download/)
- make or ninja
- NodeJS v10

If developing the Ωedit API, you'll need SWIG installed as well.

## Building

### Core Library C/C++

#### cmake commands
:exclamation: These commands should be executed at root level of the repository :exclamation:

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

#### Build Node bindings using npm

Setup Node virtual environment:

```bash
nodeenv --node=10.24.1 venv
```

Activate the Node virtual environment:

```bash
source ./venv/bin/activate
```

In the activated environment, build the bindings, and run an example:

```bash
node ci
node src/examples/omega_simple.js
```

## Development

#### Regenerate Node bindings using SWIG (as required)

If any header files have been added, removed, or changed, regenerate the API wrapper code using SWIG:

```bash
swig -javascript -node -v -c++ src/bindings/omega_edit.i
```
