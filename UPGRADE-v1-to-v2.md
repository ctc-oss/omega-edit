# v1 to v2 Upgrade Guide

## Why upgrade

- v2 standardizes on the native C++ gRPC server, which simplifies deployment and removes the old Scala middleware path.
- `@omega-edit/client` now ships a cleaner dual ESM/CommonJS package while keeping the top-level compatibility surface in place for existing consumers.
- `@omega-edit/ai` adds a supported CLI and MCP server for bounded reads, reversible edits, and AI-assisted large-file workflows.
- The release, packaging, and docs flow is now more consistent across the core library, Node packages, and the reference VS Code extension.

## What changes

- The protobuf namespace remains `omega_edit/v1`; this is a platform and packaging major release, not a wire-format reset.
- Most TypeScript consumers can upgrade by bumping package versions and rerunning their normal regression tests.
- If you relied on the old Scala server scripts or deployment model, switch to the packaged C++ server (`@omega-edit/server` or `server/cpp`).
- Server info and heartbeat responses now expose native-runtime metadata, while legacy JVM-shaped compatibility fields remain deprecated in the schema.
- Caller-chosen `session_id_desired` values and caller-chosen `viewport_id_desired` values are now explicit uniqueness requests: duplicates are rejected with `ALREADY_EXISTS` instead of being remapped to a different ID.
- `@omega-edit/client` server shutdown helpers now return structured results. `stopServerGraceful()` and `stopServerImmediate()` return `{ responseCode, serverProcessId, status }` instead of a bare numeric response code.

## Quick path

1. Update your dependencies to the 2.x line: `@omega-edit/server`, `@omega-edit/client`, and optionally `@omega-edit/ai`.
2. Rebuild or repackage any bundled server artifacts so they pick up the native server and the new versioned assets.
3. If you generate stubs from the repo proto, keep importing `omega_edit/v1/omega_edit.proto`.
4. Run your existing client and integration tests, paying extra attention to server startup, packaging, and any code that inspects server info or heartbeat fields.
