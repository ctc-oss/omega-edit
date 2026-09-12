# VS Code Data Editor Keyboard Shortcuts

The Ωedit™ reference VS Code extension supports keyboard editing and navigation in
its hex and text panes. Click a byte in either pane before using the grid-specific
shortcuts below.

## Editing and Navigation

| Key | Action |
| --- | --- |
| `Tab` | Switch between the hex and text panes. |
| Arrow keys | Move the active byte selection by one byte or one row. |
| `Shift` + Arrow keys | Extend the selection while moving. |
| `Home` / `End` | Jump to the beginning / end of the file. |
| `Page Up` / `Page Down` | Move by one visible page and scroll the viewport. |
| `Insert` | Toggle insert/overwrite editing mode. |
| `Backspace` | Delete the selection, or the byte before the active offset. |
| `Delete` | Delete the selection, or the byte at the active offset. |
| Hexadecimal character | Edit the active byte when the hex pane is active. |
| Text character | Edit the active byte using the selected text encoding when the text pane is active. |

Typing and deletion are disabled while the editor is read-only or a transform is
in progress.

## Standard VS Code Shortcuts

The custom editor participates in VS Code's native document commands:

| Windows / Linux | macOS | Action |
| --- | --- | --- |
| `Ctrl+Z` | `Cmd+Z` | Undo |
| `Ctrl+Y` | `Cmd+Shift+Z` | Redo |
| `Ctrl+S` | `Cmd+S` | Save |
| `Ctrl+Shift+S` | `Cmd+Shift+S` | Save as |
| `Ctrl+C` | `Cmd+C` | Copy the selected bytes |
| `Ctrl+X` | `Cmd+X` | Cut the selected bytes |
| `Ctrl+V` | `Cmd+V` | Paste bytes at the active offset |

## Search and Mouse Navigation

- `Ctrl/Cmd+F` opens search and focuses the search field.
- `Ctrl/Cmd+H` opens search and replace and focuses the replacement field.
- `F3` and `Shift+F3` move to the next and previous search match while focus is
  outside an editable input.
- `Ctrl/Cmd+G` and `Ctrl/Cmd+L` focus the offset jump field.
- The toolbar and command palette also expose the search actions.
- The mouse wheel scrolls the data viewport by four rows per step.

The current handlers are implemented in
[`PreviewGrid.svelte`](https://github.com/ctc-oss/omega-edit/blob/main/vscode-extension/webview-ui/src/components/PreviewGrid.svelte)
and
[`App.svelte`](https://github.com/ctc-oss/omega-edit/blob/main/vscode-extension/webview-ui/src/App.svelte).
