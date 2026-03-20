# Ωedit™ Hex Editor — Reference VS Code Extension

A minimal, standalone reference VS Code extension that demonstrates how to use [Ωedit™](https://github.com/ctc-oss/omega-edit) as a data/hex editor. This is intended as a starting point for extension developers — not a production hex editor.

![Ωedit™ Hex Editor](../../images/omega-edit-logo.png)

## What This Demonstrates

| Integration Point | Where |
|---|---|
| Start Ωedit™ server on `activate()` | [extension.ts](src/extension.ts) |
| Stop server on `deactivate()` | [extension.ts](src/extension.ts) |
| `CustomReadonlyEditorProvider` wired to Ωedit™ | [hexEditorProvider.ts](src/hexEditorProvider.ts) |
| Create session per opened file | [hexEditorProvider.ts](src/hexEditorProvider.ts) |
| Viewport → webview data flow (reactive) | [hexEditorProvider.ts](src/hexEditorProvider.ts) |
| Subscribe to viewport & session events | [hexEditorProvider.ts](src/hexEditorProvider.ts) |
| Insert / delete / overwrite from UI | [hexEditorProvider.ts](src/hexEditorProvider.ts) + [webview.ts](src/webview.ts) |
| Search (text & hex, case-insensitive) | [hexEditorProvider.ts](src/hexEditorProvider.ts) + [webview.ts](src/webview.ts) |
| Undo / redo | [hexEditorProvider.ts](src/hexEditorProvider.ts) |
| Extension settings (port, log level, bytes/row) | [package.json](package.json) |
| Hex + ASCII webview rendering | [webview.ts](src/webview.ts) |

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [VS Code](https://code.visualstudio.com/) ≥ 1.80

### Run with F5

```bash
cd examples/vscode-extension
npm install
```

Then open this folder in VS Code and press **F5**. A new Extension Development Host window will open.

In the new window, right-click any file → **"Open With…"** → **"Ωedit™ Hex Editor"**.

### What Happens Under the Hood

1. **`activate()`** reads the `omegaEdit.serverPort` setting (default: `9000`) and calls `startServer(port)` from `@omega-edit/client`. The server binary is bundled inside the npm package — no separate install needed.

2. When you open a file with the hex editor, the provider:
   - Creates an **Ωedit™ session** for the file (`createSession(filePath)`)
   - Creates a **viewport** at offset 0 with 1 KiB capacity (`createViewport()`)
   - **Subscribes to viewport events** so edits anywhere (including from other sessions sharing the same file) push fresh data to the webview

3. Edits from the UI (Insert/Delete/Overwrite buttons or keyboard) are sent to the extension host, which calls the corresponding `@omega-edit/client` function (`insert()`, `del()`, `overwrite()`). The viewport event subscription automatically updates the webview.

4. **`deactivate()`** calls `stopServerGraceful()` — the server finishes in-flight work and exits.

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `omegaEdit.serverPort` | `9000` | gRPC server port |
| `omegaEdit.logLevel` | `info` | Client log level (`trace` / `debug` / `info` / `warn` / `error` / `fatal`) |
| `omegaEdit.bytesPerRow` | `16` | Bytes displayed per row (8 / 16 / 32) |

## Keyboard Shortcuts (in the hex view)

| Key | Action |
|---|---|
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl+S | Save |
| Ctrl+F | Focus search box |
| Page Up / Page Down | Scroll by 32 rows |
| Ctrl+Home / Ctrl+End | Jump to start / end |
| Mouse wheel | Scroll by 4 rows |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  VS Code Extension Host                                 │
│  ┌─────────────┐    ┌──────────────────────────┐        │
│  │ extension.ts │───▶│ hexEditorProvider.ts      │        │
│  │ activate()   │    │ - createSession()         │        │
│  │ deactivate() │    │ - createViewport()        │        │
│  └──────┬───────┘    │ - subscribe to events     │        │
│         │            │ - handle insert/del/...   │        │
│         │            └────────┬────────▲─────────┘        │
│         │                     │        │                  │
│  ┌──────▼───────┐    ┌────────▼────────┴─────────┐       │
│  │ startServer() │    │ Webview (webview.ts)       │       │
│  │ stopServer()  │    │ - hex + ASCII grid         │       │
│  └──────┬───────┘    │ - edit dialog               │       │
│         │            │ - search UI                  │       │
│         │            └──────────────────────────────┘       │
│  ┌──────▼───────────────────────────────────────────┐      │
│  │  @omega-edit/client  (npm package)               │      │
│  │  - TypeScript API wrappers                        │      │
│  │  - Bundled native gRPC server binary              │      │
│  └──────┬───────────────────────────────────────────┘      │
│         │ gRPC                                              │
│  ┌──────▼───────────────────────────────────────────┐      │
│  │  Ωedit™ C++ Server (child process)               │      │
│  │  - Session management                             │      │
│  │  - Change tracking with undo/redo                 │      │
│  │  - Viewport event streaming                       │      │
│  │  - Server-side save (replay changes)              │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Extending This Example

This reference implementation is intentionally minimal. Here are some ideas for extension:

- **Read-write custom editor**: Switch from `CustomReadonlyEditorProvider` to `CustomEditorProvider` to integrate with VS Code's dirty-document model (backup, revert, etc.)
- **Multiple viewports**: Create additional viewports for split-pane views or overview panels
- **Data profiling**: Call `profileSession()` to show byte frequency statistics
- **Replace**: Wire `replaceSession()` to the search UI
- **Transactions**: Use `beginSessionTransaction()` / `endSessionTransaction()` to group edits
- **Multi-author**: Share a session ID across extension instances for collaborative editing

## Related

- [Ωedit™ TypeScript Examples](../typescript/) — Standalone Node.js examples using `@omega-edit/client`
- [@omega-edit/client on npm](https://www.npmjs.com/package/@omega-edit/client) — The client package used here
- [Apache Daffodil™ VS Code Extension](https://github.com/apache/daffodil-vscode) — Production extension using Ωedit™
