# Ωedit™ TypeScript Examples

These examples demonstrate how to use the Ωedit™ TypeScript client (`@omega-edit/client`) to perform common editing, searching, profiling, and patching operations programmatically.

## Prerequisites

Install the Ωedit™ client (which bundles the gRPC server):

```bash
npm install @omega-edit/client
```

You will also need `ts-node` to run the examples directly:

```bash
npm install -D ts-node typescript @types/node
```

## Examples

| Example | Description | C/C++ Equivalent |
|---------|-------------|------------------|
| [basic-edit.ts](basic-edit.ts) | Connect, create session, insert/overwrite/delete, undo/redo, save | `core/src/examples/simple.cpp` |
| [search-replace.ts](search-replace.ts) | Forward/reverse search, case-insensitive search, search-and-replace | `core/src/examples/replace.cpp` |
| [viewports.ts](viewports.ts) | Multiple viewports, floating viewports, viewport modification | `core/src/examples/play.cpp` (viewport portion) |
| [profile.ts](profile.ts) | Byte frequency profiling, ASCII analysis, BOM detection | `core/src/examples/profile.c` |
| [record-replay.ts](record-replay.ts) | Record edits to a change log, replay against another session | `core/src/examples/play.cpp` + `replay.cpp` |

## Running the Examples

Each example starts the Ωedit™ server automatically, so no separate server setup is needed.

```bash
# Basic editing (empty session)
npx ts-node basic-edit.ts

# Basic editing (from an existing file)
npx ts-node basic-edit.ts input.txt output.txt

# Search and replace
npx ts-node search-replace.ts input.txt output.txt "search" "replace"

# Viewports (empty session with generated content)
npx ts-node viewports.ts

# Viewports (from an existing file)
npx ts-node viewports.ts input.txt

# Byte frequency profiling
npx ts-node profile.ts input.txt

# Record edits and replay them
npx ts-node record-replay.ts input.txt
```

## Key Concepts

### Server Lifecycle
Each example calls `startServer(port)` to launch the native C++ gRPC server (bundled inside `@omega-edit/client`) and `stopServerGraceful()` to shut it down. In a production application (e.g., a VS Code extension), you would typically start the server once during activation and stop it during deactivation.

### Sessions
A session represents an editing context for a file or byte buffer. Create one with `createSession(filePath)` for file-backed input, `createSessionFromBytes(data)` for in-memory input, or omit the path for an empty session. All edits, viewports, and searches happen within a session. Destroy it with `destroySession(sessionId)` when done.

### Viewports
Viewports are windows into the session data at a given offset and capacity. They are a core Ωedit™ primitive — not an afterthought. Floating viewports automatically adjust their offset when inserts or deletes shift data before them.

### Change Tracking
Every edit (insert, delete, overwrite) is recorded in the session's change stack with a unique serial number. Changes can be undone, redone, grouped into transactions, and inspected — enabling audit trails, record/replay, and patching workflows.
