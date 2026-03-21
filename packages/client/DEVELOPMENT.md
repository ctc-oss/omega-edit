# @omega-edit/client — Development Guide

This document covers building, testing, and contributing to the `@omega-edit/client` package.

## Prerequisites

- Node.js 16+
- Yarn (v1 or compatible)
- The `@omega-edit/server` package must be built and packaged first (it provides the native gRPC server binary)

## Setup

From the repository root:

```bash
yarn install
```

## Building

### Prepare (generate protobuf stubs)

Before building for the first time, generate the TypeScript protobuf stubs from `proto/omega_edit.proto`:

```bash
yarn prepare
```

This runs `grpc_tools_node_protoc` to produce `omega_edit_pb.js`, `omega_edit_grpc_pb.js`, and their `.d.ts` type definitions under `src/`.

### Build the client

```bash
yarn build
```

This compiles TypeScript into both ESM (`dist/esm/`) and CommonJS (`dist/cjs/`) outputs with source maps and declaration files.

As the last build step, the repo also runs [`scripts/write-dist-package-jsons.js`](../../scripts/write-dist-package-jsons.js). That helper writes nested `package.json` files into `dist/esm` and `dist/cjs`, rewrites ESM-relative imports to include `.js`, and generates the client's protobuf ESM bridge files. We need that extra step because `tsc` alone does not produce a Node-ready dual-package layout for the published artifacts.

## Testing

Build and test commands rely on generated protobuf stubs and a prepackaged server artifact.

### Prepare (if not already done)

```bash
yarn prepare
```

### Run tests

```bash
yarn test
```

This runs the `pretest` hook (rebuilds the client and verifies the server is prepackaged) before executing the test suite.

> **Windows note:** End-to-end client tests do not currently validate emoji filenames on Windows. That path is covered in the native filesystem tests, but not in the Windows client integration suite.

## Linting

```bash
yarn lint        # check
yarn lint:fix    # auto-fix
```

## Generating API docs

```bash
yarn docgen
```

## Package Distribution Details

The package ships both ESM and CommonJS formats with full TypeScript source maps for debugging:

| Output | Path | Description |
| --- | --- | --- |
| ESM | `dist/esm/` | ES2020 modules |
| CommonJS | `dist/cjs/` | CommonJS modules |
| Source Maps | `dist/**/*.map` | Embedded TypeScript sources (`sourcesContent`) |
| Type Definitions | `dist/**/*.d.ts` | Declarations with `.d.ts.map` maps |

This allows downstream consumers (VS Code extensions, webviews, etc.) to set breakpoints in original TypeScript source, see readable names in stack traces, and step through the package code seamlessly.

### Why the postbuild packaging script exists

[`write-dist-package-jsons.js`](../../scripts/write-dist-package-jsons.js) exists to close the gap between "TypeScript compiled successfully" and "the published package actually works in Node".

- `dist/esm/package.json` marks the ESM output as `"type": "module"`.
- `dist/cjs/package.json` marks the CommonJS output as `"type": "commonjs"`.
- ESM-relative imports are rewritten from `./foo` to `./foo.js` because Node's ESM loader requires explicit extensions.
- The client package also generates ESM wrapper files for the protobuf surface so ESM consumers can import `@omega-edit/client` even though the generated protobuf runtime is still CommonJS-shaped underneath.

Without that script, consumer installs can pass type-checking but fail at runtime with module-resolution or module-format errors.

## Project Structure

```
packages/client/
├── src/
│   ├── index.ts          # Barrel export
│   ├── change.ts         # Insert, delete, overwrite, undo/redo
│   ├── client.ts         # gRPC client connection management
│   ├── logger.ts         # File-based logger
│   ├── server.ts         # Server lifecycle (start, stop, heartbeat)
│   ├── session.ts        # Session CRUD, save, transactions
│   ├── version.ts        # Client version constant
│   ├── viewport.ts       # Viewport CRUD and data access
│   ├── omega_edit_pb.*   # Generated protobuf stubs
│   └── omega_edit_grpc_pb.*
├── tests/                # Test suite
├── dist/                 # Build output (gitignored)
├── package.json
├── tsconfig.json
└── DEVELOPMENT.md        # This file
```
