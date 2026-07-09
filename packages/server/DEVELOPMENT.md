# @omega-edit/server — Development Guide

This document covers building, packaging, and contributing to the `@omega-edit/server` package.

## Prerequisites

- Node.js 22 or newer; Node.js 24 is used by the primary CI lane and `.nvmrc`
- Yarn (v1 or compatible)
- CMake 3.16+ and a C++17 compiler (for building the native gRPC server)
- gRPC and Protobuf libraries (fetched automatically by CMake)

## Building

### Build the native gRPC server

From the repository root:

```bash
cmake --build server/cpp/build --target omega-edit-grpc-server
```

This compiles the C++ gRPC server binary into `server/cpp/build/`.

### Build native core and server on Windows with Conan

When building from a fresh or stale workspace on Windows, use the repository
virtual environment's Conan executable and run CMake inside the Visual Studio
developer environment. From the repository root:

```powershell
$repo = (Get-Location).Path
$repoCmake = $repo -replace '\\', '/'

.\.venv\Scripts\conan.exe profile detect --force

.\.venv\Scripts\conan.exe install plugins --output-folder=_build_core\plugin-conan `
  --build=missing `
  -s build_type=Release `
  -c tools.cmake.cmaketoolchain:generator=Ninja

$vcvars = 'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat'
$configureCore = '"' + $vcvars + '" && cmake -G Ninja -S . -B _build_core -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_DOCS=OFF -DBUILD_EXAMPLES=ON -DBUILD_TESTS=OFF -DCMAKE_TOOLCHAIN_FILE="' + $repoCmake + '/_build_core/plugin-conan/conan_toolchain.cmake"'
cmd.exe /d /s /c $configureCore

$buildCore = '"' + $vcvars + '" && cmake --build _build_core --config Release'
cmd.exe /d /s /c $buildCore

$installCore = '"' + $vcvars + '" && cmake --install _build_core/packages/core --prefix "' + $repoCmake + '/_install_core" --config Release'
cmd.exe /d /s /c $installCore

Push-Location server\cpp
..\..\.venv\Scripts\conan.exe install . --output-folder=build `
  --build=missing `
  -s build_type=Release `
  -s compiler.cppstd=17 `
  -c tools.cmake.cmaketoolchain:generator=Ninja

$configureServer = '"' + $vcvars + '" && cmake --preset conan-release -DCMAKE_PREFIX_PATH="' + $repoCmake + '/_install_core"'
cmd.exe /d /s /c $configureServer

$buildServer = '"' + $vcvars + '" && cmake --build build --config Release --target omega-edit-grpc-server'
cmd.exe /d /s /c $buildServer
Pop-Location
```

The server executable is written to
`server/cpp/build/omega-edit-grpc-server.exe`. If `server/cpp/build` already
contains a stale CMake cache, remove `server/cpp/build/CMakeCache.txt` and
`server/cpp/build/CMakeFiles/` before reconfiguring.

### Build the Node.js wrapper

```bash
yarn build
```

`yarn build` validates that the native server executable under `server/cpp/build` is up to date before copying it into `packages/server/out/bin`.

## Packaging

Create a distributable tarball containing the native binary and Node.js launcher:

```bash
yarn package
```

This refreshes the native server executable, builds the Node.js wrapper, and produces a tarball named `omega-edit-node-server-v${version}.tgz`.

## Transform Plugin Development

The native server can register transform plugins from one or more directories using
`--transform-plugin-dir`, `OMEGA_EDIT_TRANSFORM_PLUGIN_DIRS`, or the TypeScript
`transformPluginDirectories` launcher option.

Developer-facing ABI, SDK, layout, and exemplar plugin documentation lives in the
[Transform Plugins wiki page](../../wiki/Transform-Plugins.md). Keep that page,
`packages/server/README.md`, and the exemplar sources under `plugins/src/`
in sync when changing plugin loading or adding release plugins.

## How the Binary is Bundled

The server package locates its native binary through a search algorithm:

1. Check the `CPP_SERVER_BINARY` environment variable (dev override)
2. Look for a platform-specific binary (e.g., `omega-edit-grpc-server-linux-x64`) in the `bin/` directory
3. Fall back to a plain-named binary (`omega-edit-grpc-server`) for single-platform or dev builds

Binary discovery starts from `__dirname` and walks up the directory tree looking for `node_modules/@omega-edit/server/bin/` or `out/bin/`.

## Project Structure

```
packages/server/
├── src/
│   └── index.ts          # Server launcher (runServer, runServerWithArgs)
├── bin/                   # Platform-specific native binaries (after packaging)
├── out/
│   ├── index.js           # Compiled launcher
│   └── bin/               # Native binary (dev builds)
├── package.json
├── scripts/
│   ├── build-package.js   # TypeScript compile and artifact staging
│   └── ensure-native-server-built.js
├── tsconfig.json
└── DEVELOPMENT.md         # This file
```

## Adding a New Platform

1. Cross-compile the C++ server for the target platform
2. Name the binary `omega-edit-grpc-server-{platform}-{arch}[.exe]`
3. Place it in the `bin/` directory
4. The `getPlatformBinaryName()` function in `src/index.ts` automatically resolves `os.platform()` and `os.arch()` to the correct filename
