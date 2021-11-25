# Ωmega Edit Library
The goal of this project is to provide an open source library for building editors that can handle massive files, multiple authors, and multiple viewports_.

## Requirements
This repo is built using CLion, if using CLion everything will work seamlessly, though Visual Studio Code also works well. (cmake)

If you are using just the command line you will need these things installed:
- C++ Compiler
- CMake (https://cmake.org/download/)
- NodeJS v10
- Swig
- emscripten

## Building

### Core Library C/C++

#### cmake commands
:exclamation: These commands should be built at root level of the repo :exclamation:

Run Build:

```bash
cmake -S . -B cmake-build-debug
```

Run Debug:

```bash
cmake -S . -B cmake-build-debug \
  -DCMAKE_BUILD_TYPE=Debug -DCMAKE_DEPENDS_USE_COMPILER=FALSE \
  -G "CodeBlocks - Unix Makefiles" .
```

Build omega_test:

```bash
cmake --build cmake-build-debug --target omega_test -- -j 6
```

Run tests:

```bash
cd cmake-build-debug/src/tests/
./omega_test -d yes --order lex
cd ../../../
```

#### Emscripten transpile
:exclamation: Install [emscripten](https://emscripten.org) on your system :exclamation:

From the top level of the repo:

```bash
mkdir build-em
cd build-em
emcmake cmake ..
make
```

#### Node bindings using SWIG

Generate the API wrapper source code

```bash
swig -javascript -node -v -c++ src/bindings/omega_edit.i
```

#### Build the bindings using node-gyp

Prepare
```bash
yarn install
```

Configure
```bash
yarn run gyp-configure
```

Build
```bash
yarn run gyp-build
```

## Convenience run script

The run scripts allow for easy execution of the commands stated above.

cmake build
```bash
./run cmake-build
```

cmake debug
```bash
./run cmake-debug
```

cmake test
```bash
./run cmake-test
```

swig compile
```bash
./run swig-compile
```

gyp configure
```bash
./run gyp-configure
```

gyp build
```bash
./run gyp-build
```

emscripten transpile
```bash
./run transpile
```