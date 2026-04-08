# v1 to v2 Upgrade Guide

## Why upgrade

- v2 standardizes on the native C++ gRPC server, which simplifies deployment and removes the old Scala middleware path.
- `@omega-edit/client` now ships a cleaner dual ESM/CommonJS package while keeping the top-level compatibility surface in place for existing consumers.
- `@omega-edit/ai` adds a supported CLI and MCP server for bounded reads, reversible edits, and AI-assisted large-file workflows.
- The release, packaging, and docs flow is now more consistent across the core library, Node packages, and the reference VS Code extension.

## What changes

- The protobuf import path remains `omega_edit/v1`; OmegaEdit 2.0 still includes intentional schema breaks where they materially simplify the API, and those breaks are documented here instead of through a package rename.
- Most TypeScript consumers can upgrade by bumping package versions and rerunning their normal regression tests.
- If you relied on the old Scala server scripts or deployment model, switch to the packaged C++ server (`@omega-edit/server` or `server/cpp`).
- Server info and heartbeat responses now expose native-runtime metadata, while legacy JVM-shaped compatibility fields remain deprecated in the schema.
- The heartbeat request contract is now session-centric. `GetHeartbeatRequest` only carries `session_ids`, the old hostname / PID / interval request fields are removed, and `@omega-edit/client` now exposes `getServerHeartbeat(sessionIds)`.
- Caller-chosen `session_id_desired` values and caller-chosen `viewport_id_desired` values are now explicit uniqueness requests: duplicates are rejected with `ALREADY_EXISTS` instead of being remapped to a different ID.
- `@omega-edit/client` server shutdown helpers now return structured results. `stopServerGraceful()` and `stopServerImmediate()` return `{ responseCode, serverProcessId, status }` instead of a bare numeric response code.
- Byte-oriented core edit/search APIs now require explicit lengths. `omega_edit_insert_bytes`, `omega_edit_overwrite_bytes`, and `omega_search_create_context_bytes` no longer treat `0` as `strlen(...)`; keep that convenience by using the C-string helpers instead.

## Quick path

1. Update your dependencies to the 2.x line: `@omega-edit/server`, `@omega-edit/client`, and optionally `@omega-edit/ai`.
2. Rebuild or repackage any bundled server artifacts so they pick up the native server and the new versioned assets.
3. If you generate stubs from the repo proto, keep importing `omega_edit/v1/omega_edit.proto`.
4. Run your existing client and integration tests, paying extra attention to server startup, packaging, and any code that inspects server info or heartbeat fields.
