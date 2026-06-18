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
- [ ] Audit the current Apache Daffodil Data Editor integration points and map
  each behavior to an OmegaEdit API call or an identified API gap.
- [ ] Add any missing debugger-facing hooks here while keeping concepts generic
  enough for Daffodil, DFDL tools, and other byte-level debuggers.
- [ ] Document the downstream dependency and activation pattern.
- [ ] Replace the Daffodil extension's embedded editor path with
  `extensionDependencies` plus activation/API calls.
- [ ] Validate the full flow with the OmegaEdit extension installed as a
  dependency of the Daffodil VS Code extension.

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

- Which Daffodil Data Editor features must be preserved before the embedded
  editor can be removed?
- Does Daffodil need editor-originated selection/cursor events beyond the
  current `onDidChangeEditorState` surface?
- Should parser/debugger annotations need grouping, lifetimes, priorities, or
  richer tooltip payloads beyond the current generic highlight model?
