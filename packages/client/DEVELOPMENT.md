# @omega-edit/client - Development Guide

This document covers building, testing, and contributing to the `@omega-edit/client` package.

## Design Rule: Subscriptions Over Polling

OmegaEdit is designed around server-pushed session and viewport subscriptions.

- `SubscribeToSessionEvents` is the normal way to keep computed file size and other session-derived state current.
- `SubscribeToViewportEvents` is the normal way to keep rendered viewport state current.
- `subscribeSessionEvents(...)` and `subscribeViewportEvents(...)` are the preferred client helpers for consuming those streams correctly.
- Heartbeat is the only polling loop that should exist in a well-designed client, because the server needs positive liveness signals to reap abandoned sessions safely.

If you find yourself adding any other recurring poll against session or viewport state, treat that as a design insufficiency to be fixed rather than an acceptable integration pattern.

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

Before building for the first time, generate the protobuf-ts bindings from the
canonical schema at `proto/omega_edit/v1/omega_edit.proto`:

```bash
yarn compile-src
```

This runs `@protobuf-ts/plugin` (using the `protoc` binary from `grpc-tools`) and refreshes the ESM-friendly bindings under `src/protobuf_ts/generated/`.

The generated code lives under `src/protobuf_ts/generated/omega_edit/v1/`.

### Build the client

```bash
yarn build
```

This compiles TypeScript into both ESM (`dist/esm/`) and CommonJS (`dist/cjs/`) outputs with source maps and declaration files. The published client surface uses protobuf-ts for message serialization while `@grpc/grpc-js` remains the gRPC transport layer.

## Why `src/protobuf_ts/` Exists

The code under `src/protobuf_ts/` is the new protobuf-ts-based implementation layer for the client package.

Its purpose is to:

- hold the generated protobuf-ts message and gRPC client artifacts in `src/protobuf_ts/generated/`
- implement the real RPC calls against the protobuf-ts runtime in `client.ts`, `session.ts`, `change.ts`, and `viewport.ts`
- keep small shared helpers in `utils.ts` for error wrapping (`makeWrappedError`), response validation (`requireResponse`), ID extraction (`getSingleId`), and configurable unsubscribe timeouts

This layer exists because the old `grpc-tools` + `google-protobuf` path generated CommonJS/jspb code, which made the dual ESM/CommonJS package layout awkward and required postbuild compatibility hacks. `protobuf-ts` gives us TypeScript-native, ESM-friendly generated code, which makes the build and published package much cleaner.

The top-level files in `src/` such as `session.ts`, `change.ts`, `omega_edit_pb.ts`, `omega_edit_grpc_pb.ts`, and `proto.ts` now act as the public compatibility surface:

- `omega_edit_grpc_pb.ts` defines the `EditorClient` class (backed by `@grpc/grpc-js` and the protobuf-ts service definition) and wraps subscription streams so `data` events emit legacy-compatible wrapper objects
- `omega_edit_pb.ts` provides jspb-style wrapper classes with getter/setter APIs over protobuf-ts plain objects
- `proto.ts` re-exports enums with backward-compatible aliases across all naming conventions
- `session.ts`, `change.ts`, `viewport.ts`, and `client.ts` delegate actual RPC behavior to `src/protobuf_ts/`

This split is intentional and should remain in place:

- the top-level `src/` modules are the stable package facade and the right place for long-lived API design
- `src/protobuf_ts/` is an internal implementation detail and can evolve as generators, transport code, or runtime choices change
- the jspb-style compatibility wrappers are the part we may eventually retire in a future major release, not the top-level facade itself

In other words, the goal is not to expose `src/protobuf_ts/` directly. The goal is to keep generated-code and transport details behind a stable client API so future implementation changes do not leak into downstream consumers.

When making changes:

- update `src/protobuf_ts/` if the underlying RPC behavior or protobuf-ts usage is changing
- update the top-level `src/` wrappers if the public API contract or compatibility behavior is changing
- regenerate `src/protobuf_ts/generated/` via `yarn compile-src` when the `.proto` schema changes
- prefer exposing or consuming subscription data over adding snapshot polling loops; snapshot RPCs are for point-in-time reads, not steady-state synchronization

As the last build step, the repo also runs [`scripts/write-dist-package-jsons.js`](../../scripts/write-dist-package-jsons.js). That helper writes nested `package.json` files into `dist/esm` and `dist/cjs`, rewrites ESM-relative imports to include `.js`, and generates the client's protobuf ESM bridge files. We need that extra step because `tsc` alone does not produce a Node-ready dual-package layout for the published artifacts.

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

| Output           | Path             | Description                                    |
| ---------------- | ---------------- | ---------------------------------------------- |
| ESM              | `dist/esm/`      | ES2020 module syntax (ES6 target)              |
| CommonJS         | `dist/cjs/`      | CommonJS modules                               |
| Source Maps      | `dist/**/*.map`  | Embedded TypeScript sources (`sourcesContent`) |
| Type Definitions | `dist/**/*.d.ts` | Declarations with `.d.ts.map` maps             |

### Why the postbuild packaging script exists

[`write-dist-package-jsons.js`](../../scripts/write-dist-package-jsons.js) exists to close the gap between "TypeScript compiled successfully" and "the published package actually works in Node".

- `dist/esm/package.json` marks the ESM output as `"type": "module"`.
- `dist/cjs/package.json` marks the CommonJS output as `"type": "commonjs"`.
- ESM-relative imports are rewritten from `./foo` to `./foo.js` because Node's ESM loader requires explicit extensions.
- The client package also generates ESM wrapper files for the protobuf surface so ESM consumers can import `@omega-edit/client` even though the generated protobuf runtime is still CommonJS-shaped underneath.

Without that script, consumer installs can pass type-checking but fail at runtime with module-resolution or module-format errors.

## Project Structure

```text
packages/client/
|- src/
|  |- index.ts
|  |- change.ts
|  |- client.ts
|  |- client_version.ts
|  |- logger.ts
|  |- omega_edit_grpc_pb.ts
|  |- omega_edit_pb.ts
|  |- proto.ts
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
