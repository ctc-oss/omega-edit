# @omega-edit/client - Development Guide

This document covers building, testing, and contributing to the `@omega-edit/client` package.

## Prerequisites

- Node.js 16+
- Yarn (v1 or compatible)
- The `@omega-edit/server` package must be built and packaged first

## Setup

From the repository root:

```bash
yarn install
```

## Building

### Prepare (generate protobuf bindings)

Before building for the first time, generate the protobuf-ts bindings from `proto/omega_edit.proto`:

```bash
yarn compile-src
```

This runs `grpc-tools` with the `@protobuf-ts/plugin` generator and refreshes the ESM-friendly bindings under `src/protobuf_ts/generated/`.

### Build the client

```bash
yarn build
```

This compiles TypeScript into both ESM (`dist/esm/`) and CommonJS (`dist/cjs/`) outputs with source maps and declaration files. The published client surface is backed by protobuf-ts wrappers instead of the old `google-protobuf` / jspb runtime.

## Testing

Build and test commands rely on generated protobuf-ts bindings and a prepackaged server artifact.

### Prepare (if not already done)

```bash
yarn prepare
```

### Run tests

```bash
yarn test
```

This runs the `pretest` hook before executing the test suite.

> Windows note: end-to-end client tests still depend on the native server build environment.

## Linting

```bash
yarn lint
yarn lint:fix
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

## Project Structure

```text
packages/client/
|- src/
|  |- index.ts
|  |- change.ts
|  |- client.ts
|  |- logger.ts
|  |- omega_edit_grpc_pb.ts
|  |- omega_edit_pb.ts
|  |- protobuf_ts/
|  |- server.ts
|  |- session.ts
|  |- version.ts
|  `- viewport.ts
|- tests/
|- dist/
|- package.json
|- tsconfig.json
`- DEVELOPMENT.md
```
