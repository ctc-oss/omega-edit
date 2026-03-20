# @omega-edit/server — Development Guide

This document covers building, packaging, and contributing to the `@omega-edit/server` package.

## Prerequisites

- Node.js 16+
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
├── tsconfig.json
├── webpack.config.js      # Webpack config for production build
└── DEVELOPMENT.md         # This file
```

## Adding a New Platform

1. Cross-compile the C++ server for the target platform
2. Name the binary `omega-edit-grpc-server-{platform}-{arch}[.exe]`
3. Place it in the `bin/` directory
4. The `getPlatformBinaryName()` function in `src/index.ts` automatically resolves `os.platform()` and `os.arch()` to the correct filename
