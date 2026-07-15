<!--
  Copyright (c) 2021 Concurrent Technologies Corporation.

  Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software is distributed on an "AS IS" BASIS, WITHOUT
  WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the License for the specific language
  governing permissions and limitations under the License.
-->

<div align="center">
<p>
    <img alt="Ωedit™ Logo" src="https://raw.githubusercontent.com/ctc-oss/omega-edit/main/images/OmegaEditLogo.png" width=120>
</p>

<h1>@omega-edit/ai</h1>

</div>

AI-facing tooling for [Ωedit™](https://github.com/ctc-oss/omega-edit): a scriptable `oe` CLI plus a stdio MCP server for bounded reads, reversible edits, and large-file-safe binary workflows.

## Install

```bash
npm install @omega-edit/ai
# or
yarn add @omega-edit/ai
```

## CLI Quick Start

```bash
# Create a session against a file
oe create-session --file ./sample.bin

# Ask what this session is and which command surfaces are available
oe session-context --session <session-id> --file ./sample.bin

# Inspect a bounded range
oe view --session <session-id> --offset 0 --length 64

# Profile a bounded range
oe profile-range --session <session-id> --offset 0 --length 4096

# Search text or bytes
oe search --session <session-id> --text PNG --limit 10
oe search --session <session-id> --hex 89504E47 --limit 10

# Preview and apply a reversible patch
oe patch --session <session-id> --offset 8 --hex 0000000d --dry-run
oe patch --session <session-id> --offset 8 --hex 0000000d

# Discover and run native transform plugins
oe list-transform-plugins
oe apply-transform-plugin --session <session-id> --plugin omega.example.common_checksums --offset 0 --length 128 --options-json '{"algorithm":"sum8"}'
oe apply-transform-plugin --session <session-id> --plugin omega.example.openssl_digests --offset 0 --length 128 --options-json '{"algorithm":"sha256"}'
oe apply-transform-plugin --session <session-id> --plugin omega.example.base64 --offset 0 --length 128 --options-json '{"direction":"encode"}'
oe apply-transform-plugin --session <session-id> --plugin omega.example.zlib --offset 0 --length 128 --options-json '{"action":"compress","level":9}'

# Save or export a slice
oe save-session --session <session-id> --output ./patched.bin --overwrite
oe export-range --session <session-id> --offset 0 --length 128 --output ./header.bin --overwrite

# Create checkpoints and broadcast/apply change logs
oe create-checkpoint --session <session-id>
oe restore-checkpoint --session <session-id>
oe rollback-checkpoint --session <session-id>
oe export-change-log --session <session-id> --output ./changes.json --overwrite
oe preview-change-log --session <session-id> --input ./changes.json
oe apply-change-log --session <session-id> --input ./changes.json

# Undo if needed
oe undo --session <session-id>
```

Transform plugins are registered when the native server starts. See the
[Transform Plugins guide](https://github.com/ctc-oss/omega-edit/wiki/Transform-Plugins)
for the ABI, SDK helpers, plugin directory layout, and exemplar plugin IDs for
codecs, transcodes, record/message helpers, and digest/checksum inspectors.

All CLI commands emit JSON to stdout and return non-zero exit codes on failure.
`oe session-context` returns the compact assistant-readable session snapshot:
session id, optional file path, computed/original sizes, dirty/history state,
viewport availability, transform availability, change-log status, and the
command/API equivalents for major editor actions. The MCP server exposes the
same payload through `omega_edit_session_context`, so chat assistants can
operate from structured JSON instead of scraping the VS Code webview.
Exported change logs are portable `omega-edit.change-log` documents containing
the byte operations needed to apply the same edits to another session, another
file, or a fleet of compatible files. Change-log integer fields are decimal
int64 values in JSON, so counts, offsets, lengths, serials, and fingerprint
sizes do not depend on JavaScript number precision. File-backed exports stream
entries to a temporary file and rename only after the log is complete; the
returned tool result is a summary rather than another in-memory copy of the
entry array. Export fails instead of writing an incomplete replay log when any
change details are unavailable. Change-log preview reports primitive counts,
expected fingerprints and size delta, transform descriptors from first-class
`data`, required and missing plugins, unavailable primitive serials, and
rollback protection before replay.

## MCP Quick Start

```bash
omega-edit-mcp
```

The MCP process starts the packaged native Ωedit™ server on loopback when it is
needed. No custom stdio bridge is required. To use an already-running server
instead, pass `--no-autostart --host <host> --port <port>`.

## MCP Client Configuration

Most MCP clients accept a command plus an argument array. For an installed
package, configure the equivalent of:

```json
{
  "mcpServers": {
    "omega-edit": {
      "command": "npx",
      "args": ["-y", "-p", "@omega-edit/ai", "omega-edit-mcp"]
    }
  }
}
```

Client configuration keys vary, but the command and arguments are portable.
The server uses stdout only for MCP messages and writes diagnostics to stderr.

### Source Checkout

If you are working from this repository, Codex can use the checked-out MCP server with the project-scoped config in `.codex/config.toml`:

```toml
[mcp_servers.omega-edit]
command = "node"
args = ["./packages/ai/dist/cjs/mcp.js"]
```

The source checkout must also have a native server staged in
`node_modules/@omega-edit/server/out/bin`, or set `CPP_SERVER_BINARY` in the
MCP server's `env` table to a native server you built locally. Relative file
and output paths are resolved from the MCP process working directory before
they are sent to the native server.

The equivalent installed-package configuration is:

```toml
[mcp_servers.omega-edit]
command = "npx"
args = ["-y", "-p", "@omega-edit/ai", "omega-edit-mcp"]
```

## One-Shot File Operations

Use `omega_edit_run_file` when an MCP client needs to inspect or modify a file
without managing a visible session. It creates one ephemeral session, runs up
to 16 existing MCP operations in order, and destroys the session in `finally`
whether the pipeline succeeds or fails.

Read-only pipelines need only `filePath`:

```json
{
  "filePath": "./sample.bin",
  "tool": "omega_edit_read_range",
  "arguments": { "offset": 0, "length": 64 }
}
```

Use `operations` when several actions should share the same ephemeral session:

```json
{
  "filePath": "./sample.bin",
  "operations": [
    {
      "tool": "omega_edit_read_range",
      "arguments": { "offset": 0, "length": 64 }
    },
    {
      "tool": "omega_edit_search",
      "arguments": { "hex": "89504E47", "limit": 10 }
    }
  ]
}
```

If any operation changes content, the request must provide `outputPath`.
Ωedit™ saves once, after every operation succeeds; otherwise the ephemeral
changes are not silently discarded. Set `overwriteExisting` explicitly when
replacing an existing destination, including guarded write-back to the original
file. For an intentionally temporary transform/edit-and-inspect pipeline, set
`discardChanges: true` instead of `outputPath`.

```json
{
  "filePath": "./sample.bin",
  "outputPath": "./patched.bin",
  "operations": [
    {
      "tool": "omega_edit_apply_patch",
      "arguments": {
        "offset": 8,
        "operation": "overwrite",
        "hex": "0000000D"
      }
    },
    {
      "tool": "omega_edit_read_range",
      "arguments": { "offset": 0, "length": 16 }
    }
  ]
}
```

Results are marked `ephemeral: true` and omit the destroyed session id.

The server speaks newline-delimited JSON-RPC over stdio, following the MCP lifecycle documented by the Model Context Protocol:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`
- `ping`

Available tools:

- `omega_edit_create_session`
- `omega_edit_destroy_session`
- `omega_edit_session_status`
- `omega_edit_session_context`
- `omega_edit_create_checkpoint`
- `omega_edit_rollback_checkpoint`
- `omega_edit_restore_checkpoint`
- `omega_edit_export_change_log`
- `omega_edit_preview_change_log`
- `omega_edit_apply_change_log`
- `omega_edit_read_range`
- `omega_edit_profile_range`
- `omega_edit_search`
- `omega_edit_replace_session`
- `omega_edit_list_transform_plugins`
- `omega_edit_apply_transform_plugin`
- `omega_edit_preview_patch`
- `omega_edit_apply_patch`
- `omega_edit_undo`
- `omega_edit_redo`
- `omega_edit_save_session`
- `omega_edit_export_range`
- `omega_edit_server_info`
- `omega_edit_run_file`

## Safety Defaults

The AI surface is intentionally bounded:

- reads are capped by `OMEGA_EDIT_AI_MAX_READ_BYTES` (default `262144`)
- patch payloads are capped by `OMEGA_EDIT_AI_MAX_EDIT_BYTES` (default `262144`)
- search result counts are capped by `OMEGA_EDIT_AI_MAX_SEARCH_RESULTS` (default `1000`)
- preview context is capped by `OMEGA_EDIT_AI_PREVIEW_CONTEXT_BYTES` (default `64`)
- auto-start refuses to launch Ωedit™ if the target port is already occupied by a non-Ωedit™ service
- auto-start keeps the unauthenticated native server on loopback unless `--insecure-allow-non-loopback` is supplied

## Notes

- The CLI and MCP server are both thin adapters over `@omega-edit/client`.
- `diff-session` currently reports session counters plus last-change metadata rather than a full multi-change diff stream.
- Codex MCP configuration follows the current OpenAI Codex MCP docs: <https://developers.openai.com/codex/mcp>.
- The protobuf performance audit mentioned in issue `#1332` should still be completed before wider rollout.
