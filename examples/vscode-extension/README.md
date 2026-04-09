# Ωedit™ Hex Editor - Reference VS Code Extension

A standalone reference VS Code extension that demonstrates how to use [Ωedit™](https://github.com/ctc-oss/omega-edit) as a fast, usable data/hex editor. It is still intentionally smaller than a marketplace-grade product, but it now covers the core editing, navigation, save, replay, and testing paths needed to evaluate a serious integration.

![Ωedit™ Hex Editor](./images/omega-hex.png)

## What This Demonstrates

| Integration Point                                         | Where                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Start Ωedit™ server on `activate()`                       | [extension.ts](src/extension.ts)                                                    |
| Stop server on `deactivate()`                             | [extension.ts](src/extension.ts)                                                    |
| `CustomReadonlyEditorProvider` wired to Ωedit™            | [hexEditorProvider.ts](src/hexEditorProvider.ts)                                    |
| Direct open from command palette / explorer               | [extension.ts](src/extension.ts)                                                    |
| Create session per opened file                            | [hexEditorProvider.ts](src/hexEditorProvider.ts)                                    |
| Viewport to webview data flow                             | [hexEditorProvider.ts](src/hexEditorProvider.ts)                                    |
| Insert / delete / overwrite / replace from UI             | [hexEditorProvider.ts](src/hexEditorProvider.ts) + [webview.ts](src/webview.ts)     |
| Search and replace with text/hex and direction controls   | [hexEditorProvider.ts](src/hexEditorProvider.ts) + [webview.ts](src/webview.ts)     |
| Undo / redo with stack counts                             | [hexEditorProvider.ts](src/hexEditorProvider.ts) + [webview.ts](src/webview.ts)     |
| Save / Save As / dirty tracking                           | [hexEditorProvider.ts](src/hexEditorProvider.ts) + [webview.ts](src/webview.ts)     |
| Export / replay JSON change scripts                       | [hexEditorProvider.ts](src/hexEditorProvider.ts) + [extension.ts](src/extension.ts) |
| Bytes-per-row and offset-radix controls                   | [webview.ts](src/webview.ts)                                                        |
| Status bar, binary inspector, and server health indicator | [webview.ts](src/webview.ts)                                                        |
| Extension settings                                        | [package.json](package.json)                                                        |

## Client Helpers Used Here

The example now leans on higher-level editor-facing helpers from `@omega-edit/client` instead of rolling its own integration glue:

| Helper                      | Role in the extension                                                               |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `ScopedEditorSessionHandle` | Opens a session, creates or recreates the active viewport, owns subscriptions, cleans up |
| `EditorSessionModel`        | Tracks computed file size, change count, viewport identity, and sync waiters        |
| `EditorHistoryController`   | Tracks local vs checkpoint-backed undo/redo and save-state semantics                |
| `EditorSearchController`    | Owns bounded vs large search mode and routes replace-all to bounded or checkpointed flows |

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [VS Code](https://code.visualstudio.com/) >= 1.110

The current VS Code floor is `1.110` because that is the oldest version exercised in CI and it matches the `@types/vscode` version used to compile the example. If the support range is widened later, the CI matrix should be widened with it.

This reference extension intentionally depends on the in-repo `@omega-edit/client` package through a local `file:` dependency. That keeps the example and CI aligned with the current Ωedit™ 2.x client implementation in this checkout instead of a separately published npm version.

If you rebuild `packages/client` while iterating on the extension, run `npm install` in `examples/vscode-extension` again so the local installed `file:` dependency picks up the refreshed `dist/` artifacts.

### Run With F5

```bash
cd examples/vscode-extension
npm install
npm test
```

Then open this folder in VS Code and press `F5`. A new Extension Development Host window will open.

In the new window:

- Run `Ωedit™: Open in Hex Editor` from the Command Palette to pick any file directly
- Or right-click a file in the Explorer and choose `Ωedit™: Open in Hex Editor`

## What Happens Under The Hood

Current implementation note:

- The example no longer hand-rolls session lifecycle and editor bookkeeping in the provider.
- `ScopedEditorSessionHandle` owns session creation, viewport recreation, subscriptions, and cleanup.
- `EditorSessionModel` owns live session metadata and sync waiters.
- `EditorHistoryController` and `EditorSearchController` own the reusable undo/save-state and large-search behavior.

1. `activate()` reads the `omegaEdit.serverPort` setting and starts the bundled native server through `@omega-edit/client`.
2. Opening a file creates an Ωedit™ session and viewport, then uses the client-managed heartbeat and subscription helpers for the steady-state connection wiring.
3. The native server now uses server-managed checkpoint directories under the host temp directory for auto-managed sessions, which keeps checkpoint artifacts out of the source file's folder and makes cleanup predictable.
4. The webview drives edits, navigation, search, replace, save, and replay through the provider, and the provider pushes back reactive state updates for the viewport, undo/redo counts, dirty state, replace counts, and server health.
5. `deactivate()` calls `stopServerGraceful()` so the server can shut down cleanly.

### Large Search Mode

The example extension uses a bounded search window of `1000` matches. It probes for `1001` matches so it can distinguish between:

- `bounded` mode, where the full match list is kept in memory because the result set fits in the window
- `large` mode, where match navigation switches to on-demand forward/backward search from the current cursor instead of storing every match offset

This mode decision is made only when the user runs an explicit search. If a replace operation changes the remaining match count across the `1000` threshold, the extension keeps the current mode until the next explicit search. For example, a search that starts in `large` mode with exactly `1001` matches stays in `large` mode after one single replacement leaves `1000` remaining matches.

## Extension Settings

| Setting                 | Default | Description                                                                |
| ----------------------- | ------- | -------------------------------------------------------------------------- |
| `omegaEdit.serverPort`  | `9000`  | gRPC server port                                                           |
| `omegaEdit.logLevel`    | `info`  | Client log level (`trace` / `debug` / `info` / `warn` / `error` / `fatal`) |
| `omegaEdit.bytesPerRow` | `16`    | Bytes displayed per row (8 / 16 / 32)                                      |

## Keyboard Shortcuts

| Key                      | Action                                                     |
| ------------------------ | ---------------------------------------------------------- |
| `Ctrl+Z`                 | Undo                                                       |
| `Ctrl+Y`                 | Redo                                                       |
| `Ctrl+S`                 | Save                                                       |
| `Ctrl+Shift+S`           | Save As                                                    |
| `Ctrl+F`                 | Focus search                                               |
| Arrow keys               | Move selection, or scroll by line when nothing is selected |
| `Page Up` / `Page Down`  | Scroll by 32 rows                                          |
| `Ctrl+Home` / `Ctrl+End` | Jump to start / end                                        |
| Mouse wheel              | Scroll by 4 rows                                           |

## Testing

The example is exercised in CI on Linux and Windows against both the declared VS Code floor and latest stable release.

Useful local commands:

```bash
npm run lint
npm run format:check
npm run compile
npm run test:unit
VSCODE_VERSION=1.110.0 npm run test:integration
VSCODE_VERSION=stable npm run test:integration
```

`npm run lint` now uses Biome for the extension's JavaScript, TypeScript, and JSON sources/config. Biome does not currently format Markdown, so `README.md` stays outside the automated formatter scope for this example.

## Packaging And Release

Build a local `.vsix` package with:

```bash
npm run package:vsix
```

That writes `omega-edit-hex-editor.vsix` in this folder after running the normal `vscode:prepublish` compile step.

The repository's tagged release workflow also builds this extension and uploads the packaged `.vsix` to the GitHub release assets alongside the other release artifacts.

## Architecture

```text
+--------------------------------------------------------------+
| VS Code Extension Host                                       |
|  extension.ts                                                |
|   -> startServer() / stopServerGraceful()                    |
|   -> command registration                                    |
|   -> custom editor registration                              |
|                                                              |
|  hexEditorProvider.ts                                        |
|   -> createSession() / createViewport()                      |
|   -> session + viewport subscriptions as primary state sync  |
|   -> search / replace / save / replay                        |
|   -> webview state sync                                      |
|   -> heartbeat as the only intentional poll                  |
|                                                              |
|  webview.ts                                                  |
|   -> hex + text rendering                                    |
|   -> virtual navigation controls                             |
|   -> toolbar / dialogs / status bar                          |
+-----------------------------+--------------------------------+
                              |
                              | gRPC
                              v
+--------------------------------------------------------------+
| Ωedit™ native server                                         |
|  - sessions, viewports, undo/redo                            |
|  - checkpoint handling                                       |
|  - save and replay support                                   |
|  - server info / heartbeat                                   |
+--------------------------------------------------------------+
```

Current implementation note:

- The architecture diagram above is still directionally correct, but the provider now reaches the lower-level session and subscription APIs through the client helpers listed above rather than wiring all of that behavior directly inside the example.

Subscription rule:

- This extension is intentionally subscription-first. Session state, computed file size, and viewport refreshes should come from event streams, not repeated snapshot polling.
- The extension uses the shared `@omega-edit/client` helpers for that wiring instead of hand-rolling raw stream setup in the example.
- Heartbeat is the only acceptable polling loop here, because the server uses it to detect dead clients and reap abandoned sessions.
- If you need any other poll to keep the extension correct, treat that as a design bug and fix the missing event-driven integration instead.

## Extending This Example

This reference implementation is intentionally compact. A few natural next steps are:

- Switch from `CustomReadonlyEditorProvider` to `CustomEditorProvider` for full VS Code dirty-document integration
- Add multiple coordinated viewports or overview panels
- Surface richer profiling / structure analysis views
- Add bookmarks and richer navigation helpers
- Share session IDs across instances for collaborative or multi-tool workflows

## Related

- [Ωedit™ TypeScript Examples](../typescript/) - Standalone Node.js examples using `@omega-edit/client`
- [@omega-edit/client on npm](https://www.npmjs.com/package/@omega-edit/client) - The client package used here
- [Apache Daffodil VS Code Extension](https://github.com/apache/daffodil-vscode) - Production extension using Ωedit™
