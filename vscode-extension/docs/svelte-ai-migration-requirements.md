# Svelte Webview and Automation Requirements

This document captures the requirements for moving the reference hex editor
webview toward Svelte while preserving the extension architecture that makes the
example feel native in VS Code. It also records the requirements for making the
extension practical for AI and LLM-driven workflows.

## Goals

- Keep this extension's `CustomEditorProvider` integration as the canonical
  OmegaEdit VS Code integration path.
- Replace the monolithic generated webview with digestible Svelte components
  built with Vite.
- Preserve the compact, native VS Code editor feel by using VS Code theme
  variables, native command surfaces, and editor lifecycle APIs.
- Keep expensive work in the OmegaEdit server or extension host. The webview
  should remain presentation-focused.
- Support Apache Daffodil debugger integration through explicit protocol hooks,
  without making the generic editor depend on Daffodil.
- Make the editor usable by humans, Daffodil, tests, and AI/LLM tools through
  the same typed integration contracts.

## Non-Goals

- Do not adopt SvelteKit unless a concrete routing or static-site feature is
  needed. A VS Code webview should be a static Svelte/Vite bundle.
- Do not replace VS Code-native save, save-as, revert, backup, undo, redo, or
  command palette behavior with webview-only controls.
- Do not make the Svelte app responsible for whole-file scanning, large search,
  profiling, transforms, checkpointing, replay, or persistence.
- Do not couple the shared editor UI directly to Daffodil-specific state.
- Do not make AI tools drive the editor by scraping DOM state or clicking the
  webview.

## Existing Capabilities To Preserve

The migration must preserve these user-visible and integration features:

- Opening files through `vscode.openWith` and the registered custom editor.
- Local-file validation and non-file URI rejection.
- Session creation, viewport creation, event subscriptions, and cleanup through
  the client/editor helper APIs.
- VS Code dirty-document tracking through `onDidChangeCustomDocument`.
- VS Code save, save-as, revert, backup, undo, and redo integration.
- Bounded and large search behavior.
- Search navigation and replace flows.
- Insert, delete, overwrite, and replace editing.
- Clipboard copy, cut, and paste flows.
- Byte selection, keyboard navigation, mouse selection, wheel scrolling, and
  scrollbar behavior.
- Bytes-per-row and offset-radix controls.
- Native VS Code status-bar state, dirty state, action feedback, and
  color-coded server health.
- Binary inspector behavior.
- Profile and structure analysis panes.
- Transform plugin discovery, option help, JSON Schema validation, and apply
  flow.
- Change log export and application.
- Checkpoint creation, last-checkpoint rollback, and session rollback.
- Integration and unit test coverage for the custom editor lifecycle.

## Svelte/Vite Requirements

- The webview UI should be built as a static bundle with Vite and Svelte.
- The bundle should work under a strict webview CSP with nonced scripts.
- Build output should be deterministic and easy to package in the VSIX.
- Components should be organized by editor function, for example:
  - editor shell
  - toolbar controls
  - viewport/grid rendering
  - selection and navigation state
  - search/replace
  - edit dialog
  - clipboard popover
  - byte inspector
  - analysis/profile/structure panes
  - transform selector and options dialog
  - status/server health
- Svelte stores should hold UI state only. Persistent document state remains in
  VS Code and OmegaEdit.
- The Svelte implementation is now the active webview. Do not reintroduce a
  parallel legacy webview path when adding new editor features.
- The Svelte app must not require network access, remote assets, or a dev server
  at runtime.

## Native VS Code Feel

- Use VS Code theme tokens and editor font tokens for default styling.
- Prefer compact editor-like controls over product-dashboard or website-style
  layout.
- Preserve native command palette, menu, keybinding, and document lifecycle
  behavior.
- Avoid duplicating native commands in the webview as primary controls. The UI
  may expose state and contextual affordances, but VS Code remains the source of
  truth for save, save-as, undo, redo, and revert.
- Webview controls should follow VS Code density and interaction patterns.
- Accessibility states, focus handling, keyboard navigation, and ARIA labels must
  remain explicit and testable.

## Protocol Requirements

- Define a typed `HostToWebviewMessage` union.
- Define a typed `WebviewToHostMessage` union.
- Keep host-side runtime normalization and validation for every webview message.
- Bound every user-controlled payload by type, range, and maximum size.
- Keep large binary data range-based. Do not send entire large files to the
  webview.
- Include message types for extension features, not component internals.
- Version the protocol once it is shared with external integrations.
- Keep Daffodil and AI extension points additive so the base editor can ignore
  unknown optional capabilities safely.

## Daffodil Debugger Integration

Daffodil should integrate through adapter messages and commands, not a forked
editor architecture.

Required hooks:

- Open or reveal the data editor for the debug target file.
- Publish debugger byte-position updates to the active editor.
- Highlight the current Daffodil byte position and optional byte range.
- Clear debugger highlights when the debug session stops or changes target.
- Preserve normal editor selection independently from debugger highlights.
- Expose the current debug byte position in machine-readable editor state.

Optional hooks:

- Publish schema/source location metadata associated with a data byte position.
- Publish parser state or infoset context for explainability.
- Support multiple highlight categories, such as breakpoint, current position,
  parsed range, or error range.

The shared editor UI should implement generic external-highlight rendering. The
Daffodil extension should translate debugger events into that generic protocol.

## AI and LLM Usability Requirements

AI and LLM clients should use structured commands and OmegaEdit APIs. They must
not depend on DOM scraping or webview automation.

Required command/API surfaces:

- Open or reveal a file in the hex editor.
- Read a bounded byte range with selectable display formats.
- Get active editor state as compact JSON.
- Get current selection and visible range.
- Go to an offset or select a range.
- Search within bounded constraints.
- Replace or edit a bounded range.
- Export, validate, summarize, and apply a change log.
- Profile a bounded range.
- List available transforms and their schemas.
- Apply a transform to a bounded range.
- Get Daffodil debugger context when available.

Machine-readable editor state should include:

- file path or URI
- file size
- dirty state
- active selection
- visible range
- bytes per row
- offset radix
- content type
- language/encoding hints when available
- undo/redo counts
- change count
- current checkpoint/change-log status when available
- available transform summaries
- active debugger byte position and external highlights when available

Editing requirements for AI clients:

- Support dry-run validation before applying edits.
- Return a before/after preview for bounded edits.
- Return byte counts, offset ranges, and file-size delta.
- Prefer change logs as the durable edit artifact.
- Require explicit confirmation or caller intent for destructive or broad edits.
- Keep all applied AI edits auditable through command results and change-log
  export.

Safety requirements:

- Enforce maximum byte ranges and maximum payload sizes.
- Validate file paths and URI schemes.
- Respect workspace trust and VS Code security expectations.
- Avoid leaking full file contents by default.
- Avoid sending large binary payloads to AI tools unless explicitly requested.
- Report whether operations are reversible through undo, checkpoints, or replay.

## Server-Heavy Design

The OmegaEdit server or extension host should own:

- session lifecycle
- viewport lifecycle
- large search
- replace-all and checkpointed edits
- content type and language detection
- profiling and character counts
- transform discovery and execution
- save, save-as, backup, revert, checkpoint, rollback, and replay
- server health and heartbeat data

The Svelte webview should own:

- rendering
- focus and selection presentation
- lightweight local UI state
- local formatting of already-bounded payloads
- input collection and validation feedback before host validation
- visualizing server-provided summaries

## Migration Phases

1. Add typed protocol definitions and tests around the current webview messages.
2. Add a Svelte/Vite build that can render a static shell under the webview CSP.
3. Port toolbar, status, and server-health UI.
4. Port viewport rendering, scrolling, selection, and keyboard navigation.
5. Port editing, clipboard, and byte inspector flows.
6. Port search, replace, and large-search navigation.
7. Port profile and structure analysis panes.
8. Port transform plugin UI and option validation.
9. Add generic external-highlight support for Daffodil debugger integration.
10. Add AI/LLM command surfaces and change-log validation/summarization.
11. Keep the retired legacy webview out of the runtime and package once parity
    tests pass.

Each phase should keep `npm run compile`, `npm run test:unit`, and
`npm run test:integration` passing.

Current Svelte progress: the Svelte webview is the active editor UI. Profile
and structure analysis are represented by a right-side collapsible profiler
panel with persisted section ordering, and transform plugin discovery/apply
flows are wired through the Svelte toolbar. These UI surfaces keep presentation
local to Svelte while requesting capped byte profiles and transform execution
from the OmegaEdit host/server path.

## Current Implementation Notes

- `src/webviewProtocol.ts` now owns the typed host/webview protocol and inbound
  message normalization.
- The webview bundle builds to `out/svelte-webview` and is loaded through
  `src/svelteWebview.ts` with external assets and a webview CSP.
- `webview-ui/src/App.svelte` should stay focused on extension-host
  orchestration and message handling. Visible editor regions should be composed
  from smaller components such as `EditorWorkspace`, `PreviewGrid`,
  `ProfilerPanel`, `ByteInspector`, `SearchPanel`, and `Toolbar`. Native VS Code
  status-bar items should remain host-owned in `hexEditorProvider.ts`.
- The Svelte editor currently supports local byte selection, keyboard and wheel
  navigation, a lightweight selected-byte inspector, host-backed search, search
  navigation, command-routed Search Next/Previous, byte-column and text-column
  match highlighting, search replace/replace-all through the provider,
  focused-byte copy actions, and explicit selected-range copy actions.
- The editor slices buffered viewport payloads from the server-provided buffer
  offset to the requested visible offset, so displayed offsets match displayed
  bytes even when the provider preloads data before the visible row.
- The Svelte grid measures available editor height and reports visible-row
  capacity back to the provider so the editor fills the vertical pane.
- The Svelte editor uses host-backed absolute offsets for vertical scrolling,
  suppresses native grid scrolling, and ignores stale viewport confirmations
  while a newer scroll target is pending.
- The Svelte grid and toolbar suppress top/bottom boundary scroll actions before
  they request viewport data from the provider.
- Search result highlighting is deferred until the revealed viewport arrives so
  the match and byte grid update together instead of highlight-then-scroll.
- Replace and replace-all refresh the active viewport from the provider after
  the OmegaEdit session syncs, keeping the Svelte grid presentation-only.
- The Svelte toolbar can request transform plugins, show plugin descriptions,
  advertised examples, and JSON options in a native-feeling dialog, validate
  options against the advertised JSON Schema, and apply the selected transform
  through the provider-backed `applyTransform` protocol message. Completion
  selects the affected output range, clears stale search results when content
  changes, and refreshes analysis data through the host/server path. Explicit
  transform-list refresh is exposed as `OmegaEdit: Refresh Transform List` in
  the command palette instead of as persistent toolbar chrome.
- The Svelte editor surface starts directly at the working controls and byte
  grid; the former preview header and toolbar Undo/Redo buttons were removed.
  Undo/Redo stay available through native VS Code Edit menu commands and
  keybindings, while Analysis > History exposes the current counts.
- The Svelte grid supports direct keyboard editing: clicking the byte side makes
  hex input active, clicking the text side makes printable ASCII input active,
  and the Insert key toggles editing mode. The extension uses VS Code's native
  status-bar behavior for overwrite mode: blank in insert mode and `OVR` in
  overwrite mode.
- Backspace and Delete use the provider-backed delete operation: selected ranges
  are deleted as ranges, Delete removes the current byte when no range is
  selected, and Backspace removes the previous byte when no range is selected.
- Home and End scroll the Svelte grid to the top and bottom of the file.
- Ctrl-C and Ctrl-X follow the active grid pane: the byte side copies hex bytes,
  and the text side copies printable ASCII text when possible, falling back to
  provider-backed clipboard handling when needed.
- Ctrl-V is always an insert operation at the selected offset. It accepts valid
  hex on the byte side and printable ASCII on the text side.
- The selected-byte inspector supports LE/BE contextual value editing for
  byte/ascii/UTF-8/UTF-16/binary/octal and signed/unsigned integer views while
  leaving float views read-only. Clicking an inspector value highlights the bytes
  it covers in both grid panes, including variable-length UTF-8 and UTF-16
  sequences. Inspector participation highlighting is visually distinct from the
  editor selection range so both can be visible at the same time. Validation
  stays in the Svelte UI and the provider/server still perform edits.
- The data inspector is collapsible and offsets can be displayed in either hex
  or decimal.
- Svelte-visible strings live in `webview-ui/src/i18n.ts`; VS Code contribution
  strings live in `package.nls.json`.
- New UI work should not add visible literals directly to Svelte components.
- Svelte components in the migrated webview use Svelte 5 runes (`$props`,
  `$state`, `$derived`, and `$effect`) as the standard reactivity model. New
  Svelte work should not add legacy `export let` props, `$:` reactive
  statements, or `on:` event directives.
- Revert remains integrated with VS Code through the custom editor
  `revertCustomDocument` lifecycle when VS Code invokes native file revert. The
  webview should not add a separate revert affordance, and the extension should
  not expose duplicate commands that differ only by name. `OmegaEdit: Roll Back
  Session` is the single explicit session rollback command for cases where Auto
  Save has already cleared VS Code's dirty flag. After either revert path, the
  Svelte UI clears transient selection/search/edit affordances so the refreshed
  state is visible.
- Generic external highlights are available through typed provider state and the
  `omegaEdit.setExternalHighlights` command surface. Highlight kinds are
  intentionally parser/debugger-neutral (`current`, `parsed`, `error`,
  `warning`, `breakpoint`, and `secondary`) so Daffodil, other DFDL tooling, and
  other byte-level parsers can map their own domain concepts into the shared
  editor without forking UI state.
- Generic debugger integrations should prefer the typed extension API exported
  from activation when both extensions are present. `OmegaEditExtensionApi`
  exposes `open`, `reveal`, `getEditorState`, `setExternalHighlights`,
  `clearExternalHighlights`, and `onDidChangeEditorState`. Commands remain
  available for loose coupling and AI/LLM automation.
- The Svelte webview posts compact `editorStateChanged` messages to the host.
  `omegaEdit.getEditorState` returns machine-readable state for the active or
  targeted editor, including URI, file size, dirty state, visible range,
  selection, radix, active pane, undo/redo counts, cached content/language hints
  when available, transform summaries, and external highlights.

## Acceptance Criteria

- The extension still behaves as a VS Code custom editor, not a standalone web
  app embedded in a panel.
- The Svelte UI reaches parity with the current feature checklist.
- The UI continues to look native under VS Code light, dark, and high-contrast
  themes.
- Large files remain range-based and responsive.
- Daffodil can integrate by posting typed debugger-context messages.
- AI/LLM tools can use structured commands and JSON results without scraping the
  webview.
- Security posture is no weaker than the current CSP and host-side validation.
