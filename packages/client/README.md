<!--
  Copyright (c) 2021 Concurrent Technologies Corporation.

  Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software is distributed under the License is
  distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
  implied.  See the License for the specific language governing permissions and limitations under the License.
-->

<div align="center">
<p>
    <img alt="Ωedit™ Logo" src="https://raw.githubusercontent.com/ctc-oss/omega-edit/main/images/OmegaEditLogo.png" width=120>
</p>

<h1>@omega-edit/client</h1>

[![npm](https://img.shields.io/npm/v/@omega-edit/client)](https://www.npmjs.com/package/@omega-edit/client)
[![Release](https://shields.io/github/v/release/ctc-oss/omega-edit?display_name=tag&include_prereleases&sort=semver)](https://github.com/ctc-oss/omega-edit/releases)
![Build Status](https://github.com/ctc-oss/omega-edit/workflows/Unit%20Tests/badge.svg)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_shield)

</div>

TypeScript/Node.js client for [Ωedit™](https://github.com/ctc-oss/omega-edit) — a library for building editors that can handle massive files with multiple viewports, full undo/redo, and byte-level precision.

> **Batteries included** — this package bundles the native gRPC server via its dependency on `@omega-edit/server`. No separate server install is needed.

## Install

```bash
npm install @omega-edit/client
# or
yarn add @omega-edit/client
```

## Quick Start

```typescript
import {
  startServer,
  getClient,
  createSession,
  insert,
  saveSession,
  destroySession,
  stopServerGraceful,
  IOFlags,
} from '@omega-edit/client'

// 1. Start the bundled gRPC server
const pid = await startServer(9000)

// 2. Connect a client
const client = await getClient(9000)

// 3. Create a session (optionally backed by an existing file)
const sessionResp = await createSession()
const sessionId = sessionResp.getSessionId()

// 4. Make edits
await insert(sessionId, 0, new TextEncoder().encode('Hello, Ωedit™!'))

// 5. Save to disk
await saveSession(sessionId, '/tmp/hello.txt', IOFlags.IO_FLG_OVERWRITE)

// 6. Clean up
await destroySession(sessionId)
await stopServerGraceful()
```

## API Overview

### Server Lifecycle

| Function                                          | Description                               |
| ------------------------------------------------- | ----------------------------------------- |
| `startServer(port?, host?, pidFile?, heartbeat?)` | Start the bundled native gRPC server      |
| `startServerUnixSocket(socketPath, ...)`          | Start using a Unix domain socket          |
| `stopServerGraceful()`                            | Graceful shutdown                         |
| `stopServerImmediate()`                           | Immediate shutdown                        |
| `getServerInfo()`                                 | Runtime metadata for the native server    |
| `getServerHeartbeat(sessions, interval?)`         | Heartbeat and process health              |

### Server Health API Migration

`getServerInfo()` and `getServerHeartbeat()` now expose native-runtime metadata instead of JVM-shaped placeholders.

Current `getServerInfo()` fields:

- `serverHostname`
- `serverProcessId`
- `serverVersion`
- `runtimeKind`
- `runtimeName`
- `platform`
- `availableProcessors`
- `compiler`
- `buildType`
- `cppStandard`

Current `getServerHeartbeat()` fields:

- `latency`
- `sessionCount`
- `serverTimestamp`
- `serverUptime`
- `serverCpuCount`
- `serverCpuLoadAverage?`
- `serverResidentMemoryBytes?`
- `serverVirtualMemoryBytes?`
- `serverPeakResidentMemoryBytes?`

Migration notes:

- `jvmVersion`, `jvmVendor`, and `jvmPath` were removed. Use `runtimeKind`, `runtimeName`, `platform`, and `compiler` instead.
- `serverMaxMemory`, `serverCommittedMemory`, and `serverUsedMemory` were removed. They were JVM-heap concepts and are now replaced with process-memory metrics.
- Optional heartbeat fields may be `undefined` when the host platform cannot report them. Treat missing values as "unavailable", not zero.
- `serverVirtualMemoryBytes` is intentionally best-effort and may be omitted on platforms where the available process metric is not semantically comparable.

### Client Connection

| Function                          | Description                                     |
| --------------------------------- | ----------------------------------------------- |
| `getClient(port?, host?)`         | Get or create a gRPC client connection          |
| `waitForReady(client, deadline?)` | Block until the server is accepting connections |
| `resetClient()`                   | Tear down the current client connection         |

### Sessions

| Function                                                                  | Description                    |
| ------------------------------------------------------------------------- | ------------------------------ |
| `createSession(filePath?, sessionId?, checkpointDir?)`                    | Open an editing session        |
| `destroySession(sessionId)`                                               | Close and discard a session    |
| `saveSession(sessionId, path, flags?, offset?, length?)`                  | Save session content to a file |
| `getComputedFileSize(sessionId)`                                          | Logical file size after edits  |
| `getSegment(sessionId, offset, length)`                                   | Read a byte range              |
| `getSessionCount()`                                                       | Number of active sessions      |
| `pauseSessionChanges(sessionId)` / `resumeSessionChanges(sessionId)`      | Pause/resume change tracking   |
| `beginSessionTransaction(sessionId)` / `endSessionTransaction(sessionId)` | Group edits atomically         |

### Editing

| Function                                                | Description                       |
| ------------------------------------------------------- | --------------------------------- |
| `insert(sessionId, offset, data)`                       | Insert bytes at an offset         |
| `del(sessionId, offset, length)`                        | Delete a byte range               |
| `overwrite(sessionId, offset, data)`                    | Overwrite bytes at an offset      |
| `replace(sessionId, offset, removeLen, replacement)`    | Remove + insert in one operation  |
| `undo(sessionId)` / `redo(sessionId)`                   | Unlimited undo/redo               |
| `clear(sessionId)`                                      | Undo all changes                  |
| `getLastChange(sessionId)`                              | Details of the most recent change |
| `getChangeCount(sessionId)` / `getUndoCount(sessionId)` | Change and undo stack depth       |

### Viewports

| Function                                                                | Description                                  |
| ----------------------------------------------------------------------- | -------------------------------------------- |
| `createViewport(viewportId?, sessionId, offset, capacity, isFloating?)` | Create a window into the data                |
| `modifyViewport(viewportId, offset, capacity, isFloating?)`             | Move or resize a viewport                    |
| `destroyViewport(viewportId)`                                           | Remove a viewport                            |
| `getViewportData(viewportId)`                                           | Read the current viewport content            |
| `viewportHasChanges(viewportId)`                                        | Check if content has changed since last read |
| `getViewportCount(sessionId)`                                           | Number of active viewports                   |

### Search & Profile

Search and data profiling are accessed through the session module:

- `searchSession(...)` — forward and reverse byte-pattern search
- `replaceSession(...)` — search-and-replace across the session
- `profileSession(...)` — byte-frequency profiling and line-ending detection

### Logging

```typescript
import { createSimpleFileLogger, setLogger } from '@omega-edit/client'

setLogger(createSimpleFileLogger('/tmp/omega-edit.log', 'debug'))
```

## Package Format

Distributed as both **ESM** and **CommonJS** with full TypeScript source maps and declaration files. Internally, the package now uses protobuf-ts for native ESM-friendly generated bindings instead of the old jspb runtime bridge.

| Output      | Path              | Format                            |
| ----------- | ----------------- | --------------------------------- |
| ESM         | `dist/esm/`       | ES2020 module syntax (ES6 target) |
| CJS         | `dist/cjs/`       | CommonJS                          |
| Types       | `dist/esm/*.d.ts` | TypeScript declarations           |
| Source Maps | `dist/**/*.map`   | Embedded TypeScript sources       |

## Environment Variables

| Variable                      | Default     | Description           |
| ----------------------------- | ----------- | --------------------- |
| `OMEGA_EDIT_SERVER_HOST`      | `127.0.0.1` | Server bind address   |
| `OMEGA_EDIT_SERVER_PORT`      | `9000`      | Server port           |
| `OMEGA_EDIT_CLIENT_LOG_LEVEL` | —           | Client-side log level |

## Examples

See the [examples/typescript/](https://github.com/ctc-oss/omega-edit/tree/main/examples/typescript) directory for runnable TypeScript examples covering editing, search/replace, viewports, data profiling, and record/replay.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build, test, and contribution instructions.

## Documentation

Full documentation is published at <https://ctc-oss.github.io/omega-edit/>.

## Versioning

Ωedit™ follows [Semantic Versioning](http://semver.org/).

## License

Apache 2.0 — see [LICENSE.txt](https://github.com/ctc-oss/omega-edit/blob/main/LICENSE.txt).

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_large)
