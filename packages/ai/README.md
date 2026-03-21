<!--
  Copyright (c) 2026 Concurrent Technologies Corporation.

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

# Inspect a bounded range
oe view --session <session-id> --offset 0 --length 64

# Search text or bytes
oe search --session <session-id> --text PNG --limit 10
oe search --session <session-id> --hex 89504E47 --limit 10

# Preview and apply a reversible patch
oe patch --session <session-id> --offset 8 --hex 0000000d --dry-run
oe patch --session <session-id> --offset 8 --hex 0000000d

# Save or export a slice
oe save-session --session <session-id> --output ./patched.bin --overwrite
oe export-range --session <session-id> --offset 0 --length 128 --output ./header.bin --overwrite

# Undo if needed
oe undo --session <session-id>
```

All CLI commands emit JSON to stdout and return non-zero exit codes on failure.

## MCP Quick Start

```bash
omega-edit-mcp
```

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
- `omega_edit_read_range`
- `omega_edit_search`
- `omega_edit_preview_patch`
- `omega_edit_apply_patch`
- `omega_edit_undo`
- `omega_edit_redo`
- `omega_edit_save_session`
- `omega_edit_export_range`
- `omega_edit_server_info`

## Safety Defaults

The AI surface is intentionally bounded:

- reads are capped by `OMEGA_EDIT_AI_MAX_READ_BYTES` (default `262144`)
- patch payloads are capped by `OMEGA_EDIT_AI_MAX_EDIT_BYTES` (default `262144`)
- search result counts are capped by `OMEGA_EDIT_AI_MAX_SEARCH_RESULTS` (default `1000`)
- preview context is capped by `OMEGA_EDIT_AI_PREVIEW_CONTEXT_BYTES` (default `64`)
- auto-start refuses to launch Ωedit™ if the target port is already occupied by a non-Ωedit™ service

## Notes

- The CLI and MCP server are both thin adapters over `@omega-edit/client`.
- `diff-session` currently reports session counters plus last-change metadata rather than a full multi-change diff stream.
- The protobuf performance audit mentioned in issue `#1332` should still be completed before wider rollout.
