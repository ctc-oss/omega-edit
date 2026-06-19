# Apache Daffodil VS Code Integration Plan

Tracking issue: https://github.com/ctc-oss/omega-edit/issues/1452

## Goal

Productize the OmegaEdit VS Code data editor extension so the Apache Daffodil
VS Code extension can depend on it instead of carrying a tightly integrated Data
Editor implementation.

The intended ownership split is:

- OmegaEdit owns generic byte-level editor behavior: open/reveal, viewport
  state, editing, save/undo, byte navigation, and external byte-range
  annotations.
- Apache Daffodil owns DFDL/debugger behavior: launch and debug session state,
  parser events, schema-aware mapping, diagnostics, breakpoints, and domain
  terminology.
- Daffodil integrates by declaring this extension as a VS Code dependency,
  activating it, and driving it through the typed API exported by this package.

## Work Plan

- [x] Productize the extension identity and packaging surface so downstream
  extensions can depend on a stable extension id.
- [x] Treat the activation return value as a versioned API contract for parser
  and debugger integrations.
- [x] Audit the current Apache Daffodil Data Editor integration points and map
  each behavior to an OmegaEdit API call or an identified API gap.
- [x] Confirm the current debugger-facing hooks are generic enough for Daffodil,
  DFDL tools, and other byte-level debuggers.
- [x] Document the downstream dependency and activation pattern.
- [x] Replace the Daffodil extension's embedded editor path with
  `extensionDependencies` plus activation/API calls in
  apache/daffodil-vscode#1726.
- [ ] Validate the full flow with the OmegaEdit extension installed as a
  dependency of the Daffodil VS Code extension.

## Audit Results

Audit date: 2026-06-19

Audit scope:

- Apache Daffodil upstream `main` at `6d65313`
- Apache Daffodil dependency branch
  `codex/omega-edit-data-editor-dependency` at `a8e2315`
- Daffodil pull request apache/daffodil-vscode#1726

The audit found that the current Daffodil replacement path is covered by the
existing OmegaEdit activation API. No new OmegaEdit-side debugger hook is needed
for the current handoff. Future Daffodil features may still need richer
annotation semantics once Daffodil emits stable byte ranges for them.

### Audit Mapping

**Extension dependency**

Daffodil source: `package.json` declares
`extensionDependencies: ["ctc-oss.omega-edit-data-editor"]`.

OmegaEdit mapping: stable id constants and activation return contract.

Gap or follow-up: the OmegaEdit extension must be packaged and published or
otherwise installed under that id.

**Manual and debug-start file opening**

Daffodil source: `extension.data.edit` resolves a file path or URI, and
`openDataEditor` still controls whether debug start opens the configured
`data` file.

OmegaEdit mapping: `omegaEdit.open(uri, { offset? })` opens the editor and may
reveal an initial offset.

Gap or follow-up: covered.

**Current parser byte**

Daffodil source: Daffodil listens for `daffodil.data` events carrying
`bytePos1b`, converts to a zero-based offset, and builds a one-byte
current-data highlight.

OmegaEdit mapping: `omegaEdit.getEditorState(uri)` provides `fileSize`, and
`omegaEdit.setExternalHighlights({ uri, reveal: true, highlights })` applies
and reveals the current byte.

Gap or follow-up: covered for the current parser-position marker.

**Parser annotation cleanup**

Daffodil source: Daffodil clears known editor highlights when a `dfdl` debug
session terminates.

OmegaEdit mapping: `omegaEdit.clearExternalHighlights(uri)` removes
Daffodil-owned highlights.

Gap or follow-up: covered.

**Parse errors and leftover data**

Daffodil source: Daffodil handles `daffodil.parseError` and
`daffodil.dataLeftOver` through its existing modal/error surfaces.

OmegaEdit mapping: the current API can represent future byte-ranged errors or
warnings with `error` or `warning` highlights if Daffodil supplies offsets and
lengths.

Gap or follow-up: no current replacement gap; future enhancement if Daffodil
wants inline byte annotations for these events.

**Infoset and infoset diffs**

Daffodil source: Daffodil owns `daffodil.infoset`, `infoset.display`, and
`infoset.diff`.

OmegaEdit mapping: none.

Gap or follow-up: intentionally Daffodil-owned.

**Embedded editor/server behavior**

Daffodil source: upstream Daffodil embedded data editor server, viewport,
search, replace, profiling, save, and content-type behavior in its
`src/dataEditor` and Svelte data editor tree. PR #1726 removes that embedded
tree.

OmegaEdit mapping: OmegaEdit owns these behaviors internally; downstream
extensions should not call the lower-level server/client APIs.

Gap or follow-up: covered by the extension dependency boundary.

**Dependency-path tests**

Daffodil source: PR #1726 installs a lightweight
`ctc-oss.omega-edit-data-editor` fixture for integration tests and asserts
dependency id, API shape, path resolution, highlight creation, and
command-based open.

OmegaEdit mapping: OmegaEdit has unit/integration coverage for the activation
API constants and returned API object.

Gap or follow-up: full validation with the packaged OmegaEdit extension
installed as the actual dependency remains open.

## Validation Status

Current coverage:

- OmegaEdit validates the stable extension id, API version, activation return
  value, and external highlight API in this PR.
- Daffodil PR #1726 validates its dependency path with a lightweight
  `ctc-oss.omega-edit-data-editor` fixture installed into the VS Code test
  extensions directory.
- Daffodil PR #1726 CI is passing for formatting, tests, packaging, and
  license checks.

Remaining validation:

- Package the real OmegaEdit Data Editor extension as a VSIX.
- Install that VSIX alongside the Daffodil extension.
- Run a Daffodil debug session with `openDataEditor` enabled and confirm the
  configured data file opens, `daffodil.data` steps reveal the current byte, and
  debug termination clears Daffodil-owned highlights.

## Expected Daffodil Consumption Pattern

The Daffodil extension should declare a VS Code extension dependency on the
published OmegaEdit editor extension and activate the editor before opening or
annotating data files.

```json
{
  "extensionDependencies": ["ctc-oss.omega-edit-data-editor"]
}
```

```ts
import type { OmegaEditExtensionApi } from 'omega-edit-data-editor'

const extension = vscode.extensions.getExtension<OmegaEditExtensionApi>(
  'ctc-oss.omega-edit-data-editor'
)
const omegaEdit = await extension?.activate()

if (omegaEdit?.version !== 1) {
  throw new Error('Unsupported OmegaEdit Data Editor API version')
}

await omegaEdit?.open(document.uri, { offset: parserOffset })
await omegaEdit?.setExternalHighlights({
  uri: document.uri,
  reveal: true,
  highlights: [
    {
      id: 'daffodil.parser.current',
      offset: parserOffset,
      length: parserLength,
      kind: 'current',
      label: 'Current parse point',
      source: 'Apache Daffodil',
    },
  ],
})
```

## Open Questions

- Does Daffodil need editor-originated selection/cursor events beyond the
  current `onDidChangeEditorState` surface?
- Should parse-error or leftover-data events become inline byte annotations if
  Daffodil can provide stable offsets and lengths for those conditions?
- Should parser/debugger annotations need grouping, lifetimes, priorities, or
  richer tooltip payloads beyond the current generic highlight model?
