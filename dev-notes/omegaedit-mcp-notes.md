# OmegaEdit MCP — Wiring Notes & Quirks

Date: 2026-07-14
Repo: D:\GitHub\omega-edit  (branch agent/checkpoint-timeline-history)
Task: "OmegaEdit has an MCP server. Wire it into Hermes and teach it how to use it."

## What was wired

OmegaEdit ships an MCP server in `@omega-edit/ai` (source `packages/ai/src/mcp.ts`,
built to `packages/ai/dist/cjs/mcp.js`, bin `omega-edit-mcp`). It is a thin stdio
JSON-RPC 2.0 adapter over `@omega-edit/client`, which talks gRPC to the native
C++ `omega-edit-grpc-server`. Hermes has no native MCP client tool, so I wrote a
small stdio client bridge: `dev-notes/oe-mcp-client.mjs`.

Deliverables:
- `dev-notes/oe-mcp-client.mjs` — MCP stdio client bridge (initialize →
  notifications/initialized → tools/call). Reads newline-delimited
  `{"tool","arguments"}` requests from stdin. Supports `{{.field}}` templating of
  the previous result's `structuredContent`; `{{.sessionId}}` is also remembered
  once seen so it survives calls whose result omits it.
- `dev-notes/oe-mcp-README.md` — full build + launch + drive instructions.
- skill `omegaedit-mcp` (Hermes skills dir) — teaches usage to future sessions.
- `dev-notes/omegaedit-mcp-notes.md` — this file.

## Proof it works (end-to-end, live server on :9000)

create_session → read_range (hex `41424344…`) → apply_patch overwrite `CAFEBABE`
→ read_range (`cafebabe`) → undo → read_range (`494a4b4c`, reverted) → destroy.
All `isError:false`. Also search + profile_range verified.

## BUG / SHORTCOMING — server launch is fragile on this Windows/MSYS host

The server binary in `packages/server/out/bin` is a **Debug MSVC build** that
needs the debug UCRT (`ucrtbased.dll`, `vcruntime140d.dll`, `msvcp140d.dll`).
Findings:

1. A bare `node child_process.spawn` of the Debug exe fails with
   `STATUS_ENTRYPOINT_NOT_FOUND` (0xC0000139). Root cause: the debug UCRT is NOT
   on a non-interactive node spawn's PATH, and `C:\Windows\system32\ucrtbased.dll`
   is the *release* build (IsDebug:False), so the loader picks the wrong one.
   Co-locating the Kits debug `ucrtbased.dll` in the exe dir did NOT help (still
   0xC0000139 — version skew), and copying it actually broke an already-working
   launch.
2. Spawning via `bash -c`/`-lc` from node also fails (exit 127 — the MSYS path /
   debug-CRT env is not present in a non-interactive bash).
3. The ONLY reliable launch is `terminal(background=true)` from the interactive
   Hermes terminal. Even then, the child is usually reaped when the wrapper shell
   exits ("bash: no job control in this shell"); the very first launch (port 9000)
   happened to orphan successfully and persists.
4. There is a **Release** CI binary at
   `.codex-tmp/ci-universal-server-binaries/omega-edit-grpc-server-windows-x64.exe`
   — it uses `-i/--interface` and `-p/--port` (NOT `--host/--port`), needs no
   debug CRT, and printed "bound … ready". But its `terminal(background=true)`
   launch is also reaped on this host.

**Recommendation for the project:** ship/prefer a Release build of the gRPC
server for agent/MCP use (no debug-CRT dependency), or document the
`terminal(background=true)` launch dance. The MCP server itself and the client
bridge are fine; this is purely a native-binary deployment/launch issue on the
dev host.

## Other observations

- The MCP client returns results under `structuredContent`, but some tools
  (apply_patch/preview_patch) nest the payload differently. A generic client must
  read both `structuredContent` and the `content[].text` JSON blob.
- Sessions persist on the server for its lifetime; reuse `sessionId` across calls.
- Native server file paths must be Windows-style (`D:\…`); MSYS `/d/…` paths
  return gRPC `NOT_FOUND`.
- `yarn` is broken on this host (missing `D:\c\Program Files (x86)\Yarn\bin\yarn.js`);
  build with `node_modules/typescript/bin/tsc -p <tsconfig>` directly.
