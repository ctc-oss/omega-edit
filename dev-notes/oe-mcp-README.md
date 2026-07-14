# OmegaEdit MCP Server — Wired into Hermes

OmegaEdit (`@omega-edit/ai`) ships an MCP (Model Context Protocol) server
(`packages/ai/dist/cjs/mcp.js`, bin `omega-edit-mcp`). It is a stdio
JSON-RPC 2.0 server that wraps `@omega-edit/client`, which talks gRPC to a
native C++ `omega-edit-grpc-server`. This doc records how to drive it from
Hermes (the agent runtime), which has **no native MCP client tool** — so we
use a small stdio client bridge (`dev-notes/oe-mcp-client.mjs`).

## Architecture

```
[Hermes / agent] --stdio JSON-RPC--> [ omega-edit-mcp (Node) ] --gRPC--> [ omega-edit-grpc-server (C++) ]
                                         ^                                  ^
                                packages/ai/dist/cjs/mcp.js      native binary (large-file-safe)
```

The MCP server is **bounded on purpose**: reads ≤ `OMEGA_EDIT_AI_MAX_READ_BYTES`
(256 KiB), patch payloads ≤ 256 KiB, search results ≤ 1000, preview context ≤ 64 B.
It is safe to point at multi-GB files. All heavy lifting (byte search, decoding,
change-log replay) happens in the native server; the MCP layer is routing/JSON only.

## Step 1 — Build (yarn is broken on this host; use tsc directly)

```bash
TS=/d/GitHub/omega-edit/node_modules/typescript/bin/tsc
cd /d/GitHub/omega-edit/packages/client
node scripts/generate-version.js
"$TS" -p tsconfig.esm.json && "$TS" -p tsconfig.cjs.json
node /d/GitHub/omega-edit/scripts/write-dist-package-jsons.js

cd /d/GitHub/omega-edit/packages/ai
"$TS" -p tsconfig.base.json && "$TS" -p tsconfig.esm.json && "$TS" -p tsconfig.cjs.json
```

This produces `packages/ai/dist/cjs/mcp.js` and `.../cli.js` (the `omega-edit-mcp`
and `oe` entry points).

## Step 2 — Start the native gRPC server

The server binary in `packages/server/out/bin` is a **Debug MSVC build**. On this
Windows/MSYS host it only loads reliably from an **interactive `bash`** (the debug
UCRT resolves through that shell's environment). The reliable launch is a
background terminal:

```
terminal(background=true):
  packages/server/out/bin/omega-edit-grpc-server.exe --port 9000 --host 127.0.0.1
```

Verify it is listening:

```bash
node -e "const n=require('net');const s=n.connect(9000,'127.0.0.1');s.on('connect',()=>{console.log('UP');s.end()});s.on('error',()=>console.log('DOWN'))"
```

Notes / gotchas:
- A bare `node child_process.spawn` of the Debug exe **fails** with
  `STATUS_ENTRYPOINT_NOT_FOUND` (0xC0000139): the debug UCRT is not on a
  non-interactive node spawn's PATH. Only the interactive `terminal(background=true)`
  launch has the right environment, and even then the child can be reaped when the
  wrapper shell exits — the very first launch (port 9000) happened to orphan
  successfully and persists.
- There is also a **Release** CI binary at
  `.codex-tmp/ci-universal-server-binaries/omega-edit-grpc-server-windows-x64.exe`
  (uses `-i/--interface` and `-p/--port`, NOT `--host/--port`; needs no debug CRT),
  but its `terminal(background=true)` launch is also reaped on this host.
- Sessions persist on the server for the life of the process; reuse the same
  `sessionId` across calls.

## Step 3 — Drive it with the client bridge

`dev-notes/oe-mcp-client.mjs` is a minimal MCP stdio client. Feed it
newline-delimited JSON requests on stdin; each line is
`{"tool":"<name>","arguments":{...}}`.

```bash
node dev-notes/oe-mcp-client.mjs --port 9000 --no-autostart < requests.jsonl
```

- `{{.sessionId}}` in any later request is substituted from the most recent
  `create_session` result (and is also remembered automatically once seen).
- Use **Windows-style paths** for `filePath` (e.g. `D:\GitHub\...`); the native
  server is a Windows exe and does not understand MSYS `/d/...` paths.

### Example `requests.jsonl`

```jsonl
{"tool":"omega_edit_create_session","arguments":{"filePath":"D:\\GitHub\\omega-edit\\dev-notes\\sample.bin"}}
{"tool":"omega_edit_read_range","arguments":{"sessionId":"{{.sessionId}}","offset":0,"length":16}}
{"tool":"omega_edit_search","arguments":{"sessionId":"{{.sessionId}}","text":"omega"}}
{"tool":"omega_edit_profile_range","arguments":{"sessionId":"{{.sessionId}}","offset":0,"length":67}}
{"tool":"omega_edit_apply_patch","arguments":{"sessionId":"{{.sessionId}}","offset":8,"operation":"overwrite","hex":"CAFEBABE"}}
{"tool":"omega_edit_undo","arguments":{"sessionId":"{{.sessionId}}"}}
{"tool":"omega_edit_destroy_session","arguments":{"sessionId":"{{.sessionId}}"}}
```

## Tool catalog (MCP server)

| Tool | Purpose |
|------|---------|
| `omega_edit_create_session` | Open a session against a file (or empty) |
| `omega_edit_destroy_session` | Close a session |
| `omega_edit_session_status` | Sizes, history counters, dirty state |
| `omega_edit_session_context` | Assistant-readable snapshot + command-surface map |
| `omega_edit_server_info` | Native server metadata (version, runtime) |
| `omega_edit_read_range` | Bounded read → hex/base64/utf8 |
| `omega_edit_profile_range` | Byte-frequency / ASCII% / top-bytes profile |
| `omega_edit_search` | Text/hex/base64 search (capped results) |
| `omega_edit_replace_session` | Whole-session replace |
| `omega_edit_apply_patch` / `omega_edit_preview_patch` | Reversible insert/overwrite/delete/replace |
| `omega_edit_undo` / `omega_edit_redo` | History navigation |
| `omega_edit_save_session` / `omega_edit_export_range` | Persist / slice |
| `omega_edit_create_checkpoint` / `omega_edit_rollback_checkpoint` | Checkpoints |
| `omega_edit_export_change_log` / `omega_edit_apply_change_log` | Portable edit logs |
| `omega_edit_list_transform_plugins` / `omega_edit_apply_transform_plugin` | Native codec/checksum plugins |

All results are JSON; `isError:true` carries an `error` field.

## Safety defaults (from the server)

- Reads ≤ 256 KiB, patches ≤ 256 KiB, search results ≤ 1000, preview ≤ 64 B.
- Auto-start refuses a non-Ωedit™ service on the port and keeps the server on
  loopback unless `--insecure-allow-non-loopback`.
- Always preview patches and prefer undo/redo for reversibility.
