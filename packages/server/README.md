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

<h1>@omega-edit/server</h1>

[![npm](https://img.shields.io/npm/v/@omega-edit/server)](https://www.npmjs.com/package/@omega-edit/server)
[![Release](https://shields.io/github/v/release/ctc-oss/omega-edit?display_name=tag&include_prereleases&sort=semver)](https://github.com/ctc-oss/omega-edit/releases)
![Build Status](https://github.com/ctc-oss/omega-edit/workflows/Unit%20Tests/badge.svg)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_shield)

</div>

Native C++ gRPC server for [Ωedit™](https://github.com/ctc-oss/omega-edit), bundled as a Node.js package with a TypeScript launcher. This package provides the server binary that powers `@omega-edit/client`.

> **Most users should install `@omega-edit/client` instead** — it depends on this package and re-exports server lifecycle functions (`startServer`, `stopServerGraceful`, etc.). Install `@omega-edit/server` directly only if you need standalone server management.

## Install

```bash
npm install @omega-edit/server
# or
yarn add @omega-edit/server
```

## Usage

### From TypeScript/Node.js

The recommended way to use the server is through `@omega-edit/client`, which re-exports the server API:

```typescript
import { startServer, stopServerGraceful } from '@omega-edit/client'

const pid = await startServer(9000)
// ... use @omega-edit/client to interact with the server ...
await stopServerGraceful()
```

If you need lower-level control, import directly:

```typescript
import { runServer, runServerWithArgs, HeartbeatOptions } from '@omega-edit/server'

// Start on a specific host and port
const proc = await runServer(9000, '127.0.0.1', '/tmp/server.pid', {
  sessionTimeoutMs: 300000,
  cleanupIntervalMs: 60000,
  shutdownWhenNoSessions: true,
})

// Or pass raw CLI arguments
const proc2 = await runServerWithArgs([
  '--interface=0.0.0.0',
  '--port=9000',
  '--unix-socket=/tmp/omega.sock',
])
```

### Standalone Binary

The package includes a pre-built native binary. After install, locate it in `node_modules/@omega-edit/server/bin/` (or `out/bin/`):

```bash
# Run directly
./node_modules/@omega-edit/server/bin/omega-edit-grpc-server --port=9000

# Or override with an environment variable
CPP_SERVER_BINARY=/path/to/custom/server node your-app.js
```

## Server API

### `runServer(port, host?, pidfile?, heartbeat?)`

Start the server on a TCP port. Returns the spawned `ChildProcess`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | — | TCP port to listen on |
| `host` | `string` | `'127.0.0.1'` | Bind address |
| `pidfile` | `string` | — | Path to write the server PID |
| `heartbeat` | `HeartbeatOptions` | — | Session reaping options |

### `runServerWithArgs(args, heartbeat?)`

Start the server with arbitrary CLI arguments. Useful for Unix domain socket mode or custom flags.

### `HeartbeatOptions`

```typescript
interface HeartbeatOptions {
  sessionTimeoutMs?: number       // Idle timeout before reaping (0 = disabled)
  cleanupIntervalMs?: number      // Reaper sweep interval (0 = disabled)
  shutdownWhenNoSessions?: boolean // Exit when last session is reaped
}
```

## CLI Flags

The native binary supports:

| Flag | Description |
| --- | --- |
| `-i`, `--interface` | Bind address (default: `127.0.0.1`) |
| `-p`, `--port` | TCP port (default: `9000`) |
| `-f`, `--pidfile` | Write PID to this file |
| `-u`, `--unix-socket` | Path for Unix domain socket |
| `--unix-socket-only` | Listen only on Unix socket (no TCP) |
| `--session-timeout` | Idle session timeout in ms |
| `--cleanup-interval` | Reaper interval in ms |
| `--shutdown-when-no-sessions` | Exit after last session ends |

## Platform Support

The package ships pre-built binaries. Binary names follow the pattern `omega-edit-grpc-server-{platform}-{arch}`:

| Platform | Architecture | Binary |
| --- | --- | --- |
| Linux | x64 | `omega-edit-grpc-server-linux-x64` |
| Linux | arm64 | `omega-edit-grpc-server-linux-arm64` |
| macOS | x64 | `omega-edit-grpc-server-macos-x64` |
| macOS | arm64 | `omega-edit-grpc-server-macos-arm64` |
| Windows | x64 | `omega-edit-grpc-server-windows-x64.exe` |

Running on an unsupported platform? Set `CPP_SERVER_BINARY` to the path of a custom-built
server binary, or see [CONTRIBUTING.md](https://github.com/ctc-oss/omega-edit/blob/main/CONTRIBUTING.md) to build from source.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build, packaging, and contribution instructions.

## Documentation

Full documentation is published at <https://ctc-oss.github.io/omega-edit/>.

## Versioning

Ωedit™ follows [Semantic Versioning](http://semver.org/).

## License

Apache 2.0 — see [LICENSE.txt](https://github.com/ctc-oss/omega-edit/blob/main/LICENSE.txt).

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fctc-oss%2Fomega-edit?ref=badge_large)
