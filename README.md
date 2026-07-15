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

<h1>Ωedit™ Library</h1>


[![Release](https://img.shields.io/github/v/release/ctc-oss/omega-edit?display_name=tag&include_prereleases&sort=semver)](https://github.com/ctc-oss/omega-edit/releases)
[![Unit Tests](https://github.com/ctc-oss/omega-edit/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/ctc-oss/omega-edit/actions/workflows/tests.yml?query=branch%3Amain)
[![CodeQL](https://github.com/ctc-oss/omega-edit/actions/workflows/codeql-analysis.yml/badge.svg?branch=main)](https://github.com/ctc-oss/omega-edit/actions/workflows/codeql-analysis.yml?query=branch%3Amain)
[![Coverage](https://img.shields.io/badge/coverage-report-blue)](https://app.codecov.io/github/ctc-oss/omega-edit/tree/main)
[![License](https://img.shields.io/github/license/ctc-oss/omega-edit)](LICENSE.txt)
[![Join the chat at https://gitter.im/ctc-oss/community](https://badges.gitter.im/ctc-oss/community.svg)](https://gitter.im/ctc-oss/community)

</div>

## Goal

The goal of this project is to provide an open source library for building editors that can handle massive files, and
multiple viewports.

## Quick Start

| I want to… | Install | Time |
|---|---|---|
| **Use Ωedit™ from TypeScript / Node.js** | `npm install @omega-edit/client` | 2 min |
| **Build a VS Code extension** | See [`vscode-extension/`](vscode-extension/) | 5 min |
| **Use the C/C++ library** | [Pre-built binaries](https://github.com/ctc-oss/omega-edit/releases) or build from source (see below) | 5 min |

**TypeScript — first edit in 15 lines:**

```typescript
import { startServer, getClient, createSession, destroySession,
         saveSession, insert, stopServerGraceful, IOFlags } from '@omega-edit/client'

const main = async () => {
  await startServer(9000)              // start bundled native server
  await getClient(9000)                // connect
  const s = await createSession()      // empty session
  const id = s.getSessionId()
  await insert(id, 0, Buffer.from('Hello, Ωedit™!'))
  await saveSession(id, 'output.dat', IOFlags.OVERWRITE)
  await destroySession(id)
  await stopServerGraceful()
}
main().catch(console.error)
```

See the [Quick Start guide in the wiki](https://github.com/ctc-oss/omega-edit/wiki#quick-start) for C/C++ and VS Code extension paths, plus links to all examples.

## Naming Conventions

Use these naming rules in user-facing documentation:

- **`Ωedit™`** is the project and product name in prose, headings, release notes, and other user-facing text.
- **`omega-edit`** is the repository name, URL slug, release-asset stem, and Docker image stem.
- **`@omega-edit/...`** is the npm package scope.
- **`omega_edit`** is the C/C++ and protobuf identifier form used in symbols, include paths, and proto namespaces.

Examples:

- say "Build a VS Code extension powered by Ωedit™"
- use `https://github.com/ctc-oss/omega-edit`
- import `@omega-edit/client`
- include `omega_edit/edit.h`

## AI Tooling

Use `@omega-edit/ai` for a JSON-first `oe` CLI and a stdio MCP server that expose bounded reads, reversible edits, and binary-safe large-file operations.

```bash
npm install @omega-edit/ai
npx omega-edit-mcp

# or use the CLI directly
npx oe create-session --file ./sample.bin
npx oe view --session <session-id> --offset 0 --length 64
```

MCP clients can also use `omega_edit_run_file` for a bounded read, search,
profile, transform, or edit pipeline without managing a persistent session.
Ephemeral sessions are destroyed on success and failure; mutating pipelines
require an explicit output path or explicit discard, and save only after every
operation succeeds.

For an installed package, the portable MCP command is:

```json
{
  "command": "npx",
  "args": ["-y", "-p", "@omega-edit/ai", "omega-edit-mcp"]
}
```

To use the MCP server from Codex in this checkout, the repo now includes a project-scoped `.codex/config.toml`:

```toml
[mcp_servers.omega-edit]
command = "node"
args = ["./packages/ai/dist/cjs/mcp.js"]
```

For an installed package instead of a source checkout, use the Codex MCP format documented by OpenAI and point it at `npx -y -p @omega-edit/ai omega-edit-mcp`.

### Why Use Ωedit™ for AI Tooling

Ωedit™ gives AI agents a safer editing contract than whole-file rewrites or ad hoc scripts:

- bounded reads let an agent inspect only the region it needs instead of loading an entire large file
- binary-safe edits make it practical to work with headers, metadata blocks, mixed-format files, and other offset-sensitive artifacts
- transactional changes plus undo/redo make agent actions reversible
- preview-first patching helps an agent inspect the exact byte range before applying a change
- machine-readable CLI and MCP responses are easier for agents to consume than terminal scraping
- the same primitives work for both human-operated scripts and agent-hosted tool calls

### Server Trust Boundary

The bundled gRPC server is an unauthenticated local editing service. By default it binds to `127.0.0.1`; keep it on
loopback or a Unix domain socket unless the surrounding environment supplies its own access control. Non-loopback TCP
binds, such as `0.0.0.0`, require the explicit `--insecure-allow-non-loopback` opt-in because any client that can reach
the server can read, edit, save, and invoke registered transform plugins with the server process's privileges.

## Transform Plugins

OmegaEdit can discover native transform plugins from `.so`, `.dylib`, and `.dll` files. Plugins can replace a selected range, expand or shrink content, or inspect a range and return a result such as a checksum or hash. The separately packaged examples include bitwise transforms, ASCII case changes, binary/text codecs, zlib compression, character transcoding, decimal field helpers, record/text escaping, TLV/varint inspectors, and MD5/SHA/BLAKE/CRC/checksum-style inspection. See the [Transform Plugins guide](https://github.com/ctc-oss/omega-edit/wiki/Transform-Plugins) for the ABI, SDK helpers, plugin package layout, server registration options, and exemplar plugins.

## User documentation

User documentation is published to https://ctc-oss.github.io/omega-edit/.

## Source Development Prerequisites

Install these tools before building Ωedit™ from a source checkout:

| Tool | Version | Purpose |
| --- | --- | --- |
| C/C++ compiler and platform SDK | C++17-capable | Builds the native core library and C++ gRPC server |
| CMake | 3.16+ | Configures native builds |
| Conan | 2.x | Fetches C++ server dependencies |
| Ninja or Make | Current stable | Runs CMake builds |
| Python | 3.10+ | Installs/runs Conan and supporting build tools |
| Node.js | 20.x recommended, 18+ minimum for the VS Code extension | Builds and tests TypeScript packages |
| Yarn | 1.x | Builds root workspaces |
| npm | Bundled with Node.js | Builds the standalone VS Code extension example |
| git | Current stable | Source control |

Optional documentation tools:

- **doxygen** to generate API documentation (https://www.doxygen.nl)
- **graphviz** to generate API documentation (https://graphviz.org)
- **sphinx** to generate user documentation (https://www.sphinx-doc.org)
  - **sphinx RTD theme** (https://github.com/readthedocs/sphinx_rtd_theme)
  - **breathe** ReStructuredText and Sphinx bridge to Doxygen (https://github.com/michaeljones/breathe)

### macOS And Apple Silicon

On macOS, install Apple's Command Line Tools or full Xcode before configuring CMake:

```bash
xcode-select --install
xcode-select -p
xcrun --find clang++
xcrun --show-sdk-path
```

If full Xcode is installed instead of only the Command Line Tools, finish first-run setup and make sure the active developer directory points at Xcode:

```bash
sudo xcodebuild -runFirstLaunch
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

The native build must be able to find standard C++ headers through the selected Apple SDK. If you see an error like `fatal error: 'cstdint' file not found`, the compiler toolchain or SDK is not selected correctly. Re-run the commands above, then start from a fresh CMake build directory for the generator you want to use.

Apple Silicon users should use a native arm64 terminal and native package manager installation where possible. Homebrew installs to `/opt/homebrew` on Apple Silicon; make sure that path is on `PATH` before installing CMake, Conan, Ninja, Node.js, or Yarn through Homebrew.

For a Homebrew-based Apple Silicon setup:

```bash
brew install cmake conan ninja node yarn
```

If `xcrun --show-sdk-path` succeeds but the build still cannot find `<cstdint>`, clear stale compiler include or SDK overrides and reconfigure from a fresh build directory:

```bash
unset SDKROOT CPATH CPLUS_INCLUDE_PATH C_INCLUDE_PATH
yarn dev:doctor
```

If `yarn dev:doctor` reports that Apple C++17 standard headers are missing, reinstall the Command Line Tools or switch to a complete Xcode install. A broken Command Line Tools install can still provide `clang++` and an SDK path while missing most files under `/Library/Developer/CommandLineTools/usr/include/c++/v1`.

### Quick Tool Check

These commands should all succeed before running `yarn native` or `yarn vscode:setup`:

```bash
cmake --version
conan --version
python3 --version
node --version
yarn --version
npm --version
```

Or run the bundled prerequisite check:

```bash
yarn dev:doctor
```

On macOS, `yarn dev:doctor` also checks `xcode-select`, `xcrun --find clang++`, and `xcrun --show-sdk-path`.

### IDE

The Ωedit™ project is built primarily using [CLion](https://www.jetbrains.com/clion/), though [Visual
Studio Code](https://code.visualstudio.com/) also works well.

#### Visual Studio Code with CMake Presets

To use CMake presets in Visual Studio Code, install the [CMake Tools extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cmake-tools) and configure it to use presets:

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Run "Preferences: Open Settings (JSON)"
3. Add the following setting:
   ```json
   {
     "cmake.useCMakePresets": "always"
   }
   ```
4. When you run "CMake: Configure", you'll be prompted to select a preset from the available options

## Build From Source

:exclamation: These commands should be executed at the root level of the repository :exclamation:

### Developer Build Commands

The easiest local path is to use the root Yarn scripts. They wrap the CMake, Conan, Yarn, and npm commands used by CI and keep the VS Code extension setup in one place.

```bash
yarn dev:setup          # install root Yarn deps and VS Code extension npm deps
yarn native             # configure, build, test, and install core; configure/build the C++ gRPC server
yarn packages:build     # package @omega-edit/server, @omega-edit/client, and @omega-edit/ai
yarn packages:test      # run client and AI package tests
```

For the reference VS Code extension:

```bash
yarn vscode:setup              # full one-time setup for extension development
yarn vscode:build              # compile vscode-extension
yarn vscode:test:unit          # lint, compile, and run fast unit tests
yarn vscode:test:integration   # run VS Code integration tests
yarn vscode:test               # run the extension's full npm test script
yarn vscode:package            # create vscode-extension/omega-edit-hex-editor.vsix
```

`yarn vscode:setup` is the recommended first command for extension work. It builds the native pieces, packages the local server/client/AI artifacts, refreshes the extension dependencies, and installs the freshly built local server/client tarballs into the extension without rewriting its lockfile.

Use these environment variables when you need to override defaults:

```bash
OMEGA_EDIT_BUILD_TYPE=Debug yarn native
OMEGA_EDIT_CMAKE_GENERATOR="Unix Makefiles" yarn native
VSCODE_VERSION=1.110.0 yarn vscode:test:integration
```

The helper also accepts the legacy `generator` environment variable used by `build.sh`, so `export generator="Unix Makefiles"` works too.

Run `yarn dev:help` to list every wrapped command.

### Build the core library (C/C++)

#### Install conan:

Conan is the package manager used to install the C/C++ dependencies.  It can be installed via pip.

```bash
pip install conan
```

#### Configure a build:

Depending on your linking needs, Ωedit™ can be built _either_ as a static (e.g., libomega_edit.a) or shared
(e.g., libomega_edit.so) library.  `Release` or `Debug` versions can be created.  Example programs and documentation can
also be built if desired.

##### Using CMake Presets (Recommended):

The project includes a `CMakePresets.json` file with predefined build configurations. To list available presets:

```bash
cmake --list-presets
```

To configure and build using a preset:

```bash
cmake --preset ninja-debug-minimal
cmake --build --preset ninja-debug-minimal
```

Available presets include combinations of:
- Generators: `ninja-*` or `make-*`
- Build types: `*-debug` or `*-release`
- Options: `*-minimal` (no docs/examples), default (all options), or `*-static` (static libraries)
- CI presets: `ci` (for automated builds) and `ci-docs` (for documentation generation)

##### Using Manual Configuration:

Here is how to build a debug version of a shared library, with no documentation or example programs.

```bash
cmake -S . -B _build -DCMAKE_BUILD_TYPE=Debug -DBUILD_DOCS=NO -DBUILD_EXAMPLES=NO -DBUILD_SHARED_LIBS=YES
```

##### Embedding the core library in another CMake project:

If you want to consume Ωedit™ as a subproject, enable embed mode to automatically disable tests,
documentation, examples, coverage instrumentation, and packaging:

```bash
cmake -S . -B _build -DOMEGA_EDIT_EMBED_MODE=ON
```

#### Build the configured build:

This will build the core library, and any example programs or documentation if configured.  Note that the config type
(`Debug` or `Release`) must match the config type (`CMAKE_BUILD_TYPE`) used when configuring the build.

```bash
cmake --build _build --config Debug
```

#### Run the test suite:

This will run the test suite for the core library.  Note that the build config (`Debug` or `Release`) must match the
config type (`CMAKE_BUILD_TYPE`) used when configuring the build.

```bash
ctest --build-config Debug --test-dir _build/core --output-on-failure
```

#### Install the core library:

We're installing in a directory named `_install` in the root of the repository. This directory can be used as the default
shared-library location, or you can set OE_LIB_DIR to a custom path. If you just want to use the library itself, you can
install it anywhere you like (e.g., `/usr/local`).

```bash
cmake --install _build/packages/core --config Debug --prefix _install
```

## Packaging Ωedit™ gRPC Server and Node Client

:exclamation: These commands should be executed at the root level of the repository after building/installing the core
library :exclamation:

Build, test, and package the server, client, and AI tooling node packages. The server package will include the shared
library built in the previous step and package a native C++ gRPC server binary. The client package will include the
node client, and the AI tooling package will include the `oe` CLI and stdio MCP server.

```bash
yarn dev:setup
yarn native
yarn packages:build
yarn packages:test
```

Node packages will be in `.tgz` files located at:

```
/packages/server/omega-edit-node-server-${VERSION}.tgz
/packages/client/omega-edit-node-client-${VERSION}.tgz
/packages/ai/omega-edit-node-ai-${VERSION}.tgz
```

Tagged releases also attach the VS Code extension example as:

```
omega-edit-data-editor-v${VERSION}.vsix
```

More information about the node packages can be found in the [packages](packages/README.md) folder.

## Release Binaries

[Binary releases](https://github.com/ctc-oss/omega-edit/releases) for macOS (Apple Silicon and x86), Windows (x86), and
Linux (ARM, and x86; glibc 2.31 or greater required) are built and published via GitHub CI workflows. Tagged releases
also attach the reference VS Code extension as a `.vsix` asset.

Known limitation: Windows client integration tests do not currently cover emoji filenames end-to-end, even though native filesystem coverage exists for those paths.

## Versioning

Ωedit™ follows [Semantic Versioning](http://semver.org/). Version information is managed through a single source of truth in the `VERSION` file at the repository root. See [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md) for details on updating versions across all components.

Planning a move from the 1.x line to the 2.x release candidate? Start with the short [v1 to v2 upgrade guide](UPGRADE-v1-to-v2.md).

## &#9889;Powered by Ωedit™

- [Apache Daffodil™ Extension for Visual Studio Code](https://github.com/apache/daffodil-vscode) - The Data Editor
 component of this Visual Studio Code extension is powered by Ωedit™.

## License

Ωedit™ is licensed under the [Apache License 2.0](LICENSE.txt).
