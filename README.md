# Omega Edit Library
The goal of this project is to provide an open source library for building editors that can handle massive files.

## cmake
This repo is built heavly using CLion, if using CLion everything will work seamlessly.

If you are using just the command line you will need these things installed:
- C++ Compiler
- CMake (https://cmake.org/download/)

## cmake commands
:exclamation: These commands should be built at root level of the repo :exclamation:

Run Build
```bash
cmake -S . -B cmake-build-debug
```

Run Debug
```bash
cmake -S . -B cmake-build-debug \
  -DCMAKE_BUILD_TYPE=Debug -DCMAKE_DEPENDS_USE_COMPILER=FALSE \
  -G "CodeBlocks - Unix Makefiles" .
```

Build omega_test
```bash
cmake --build cmake-build-debug --target omega_test -- -j 6
```

Run tests
```bash
cd cmake-build-debug/tests/
./omega_test -d yes --order lex
cd ../../
```