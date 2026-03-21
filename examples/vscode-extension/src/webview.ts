// Copyright 2024 Concurrent Technologies Corporation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Ωedit™ Hex Editor — Webview HTML
 *
 * Generates the HTML/CSS/JS for the hex editor webview panel. The webview
 * communicates with the extension host (and thus Ωedit™) via postMessage.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  Toolbar: [Search] [Insert/Delete/Overwrite] [Undo/Redo/Save]  │
 *   ├────────────┬─────────────────────────┬──────────────────┤
 *   │  Offset    │  Hex                    │  ASCII           │
 *   │  00000000  │  48 65 6C 6C 6F ...     │  Hello...        │
 *   │  00000010  │  ...                    │  ...             │
 *   └────────────┴─────────────────────────┴──────────────────┘
 *   │  Status: offset 0x0000 | size 1234 bytes | 5 matches    │
 *   └─────────────────────────────────────────────────────────┘
 */

export function getWebviewContent(bytesPerRow: number): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ωedit™ Hex Editor</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, #444);
    --highlight: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 192, 0, 0.3));
    --selected: var(--vscode-editor-selectionBackground, rgba(38, 79, 120, 0.6));
    --toolbar-bg: var(--vscode-sideBar-background, #252526);
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --input-fg: var(--vscode-input-foreground, #ccc);
    --input-border: var(--vscode-input-border, #555);
    --button-bg: var(--vscode-button-background, #0e639c);
    --button-fg: var(--vscode-button-foreground, #fff);
    --button-hover: var(--vscode-button-hoverBackground, #1177bb);
    --offset-fg: var(--vscode-editorLineNumber-foreground, #858585);
    --ascii-fg: var(--vscode-terminal-ansiGreen, #6a9955);
    --mono: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
    --font-size: var(--vscode-editor-font-size, 13px);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--mono);
    font-size: var(--font-size);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    user-select: none;
  }

  /* ── Toolbar ─────────────────────────────────────── */
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
    background: var(--toolbar-bg);
    border-bottom: 1px solid var(--border);
    align-items: center;
  }
  .toolbar-group {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .toolbar-group + .toolbar-group {
    margin-left: 8px;
    padding-left: 8px;
    border-left: 1px solid var(--border);
  }
  .toolbar label { font-size: 11px; color: var(--offset-fg); margin-right: 2px; }
  .toolbar input, .toolbar select {
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    padding: 3px 6px;
    font-family: var(--mono);
    font-size: 12px;
    border-radius: 2px;
  }
  .toolbar input:focus, .toolbar select:focus { outline: 1px solid var(--button-bg); }
  .toolbar input[type="text"] { width: 160px; }
  .toolbar input.narrow { width: 80px; }
  button {
    background: var(--button-bg);
    color: var(--button-fg);
    border: none;
    padding: 3px 10px;
    font-size: 12px;
    border-radius: 2px;
    cursor: pointer;
    font-family: var(--mono);
  }
  button:hover { background: var(--button-hover); }
  button:active { opacity: 0.8; }
  button.secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
  }
  button.secondary:hover { background: var(--input-bg); }

  /* ── Hex Grid ────────────────────────────────────── */
  .hex-container {
    flex: 1;
    overflow: hidden;
    padding: 4px 0;
  }
  .hex-row {
    display: flex;
    line-height: 1.6;
    padding: 0 10px;
  }
  .hex-row:hover { background: rgba(255, 255, 255, 0.03); }
  .offset-col {
    color: var(--offset-fg);
    min-width: 80px;
    text-align: right;
    padding-right: 12px;
    flex-shrink: 0;
  }
  .hex-col {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 0 6px;
  }
  .hex-byte {
    width: 22px;
    text-align: center;
    cursor: pointer;
    border-radius: 2px;
  }
  .hex-byte:hover { background: var(--selected); }
  .hex-byte.selected { background: var(--selected); }
  .hex-byte.match { background: var(--highlight); }
  .hex-byte.group-sep { margin-left: 4px; }
  .ascii-col {
    color: var(--ascii-fg);
    padding-left: 12px;
    border-left: 1px solid var(--border);
    min-width: calc(${bytesPerRow}ch + 12px);
    letter-spacing: 1px;
    flex-shrink: 0;
  }
  .ascii-char { cursor: pointer; }
  .ascii-char:hover { background: var(--selected); }
  .ascii-char.selected { background: var(--selected); }
  .ascii-char.match { background: var(--highlight); }

  /* ── Status Bar ──────────────────────────────────── */
  .status-bar {
    display: flex;
    gap: 16px;
    padding: 4px 10px;
    background: var(--toolbar-bg);
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--offset-fg);
  }
  .status-bar .highlight { color: var(--fg); }

  /* ── Edit Dialog ─────────────────────────────────── */
  .edit-dialog {
    display: none;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--toolbar-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 16px;
    z-index: 100;
    min-width: 320px;
  }
  .edit-dialog.active { display: block; }
  .edit-dialog h3 { margin-bottom: 10px; font-size: 13px; }
  .edit-dialog .field { margin-bottom: 8px; }
  .edit-dialog .field label { display: block; margin-bottom: 2px; font-size: 11px; }
  .edit-dialog .field input { width: 100%; }
  .edit-dialog .actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 12px; }
  .overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 99;
  }
  .overlay.active { display: block; }

  /* ── Search Results ──────────────────────────────── */
  .match-nav { font-size: 11px; color: var(--offset-fg); }
  .match-nav span { color: var(--fg); }
</style>
</head>
<body>

<!-- ── Toolbar ──────────────────────────────────────── -->
<div class="toolbar">
  <div class="toolbar-group">
    <label>Search:</label>
    <input type="text" id="searchInput" placeholder="text or hex bytes" />
    <label><input type="checkbox" id="searchHex" /> Hex</label>
    <label><input type="checkbox" id="searchCase" /> Aa</label>
    <button id="searchBtn">Find</button>
    <span class="match-nav" id="matchNav"></span>
    <button class="secondary" id="prevMatch" title="Previous match">&#9650;</button>
    <button class="secondary" id="nextMatch" title="Next match">&#9660;</button>
  </div>
  <div class="toolbar-group">
    <button class="secondary" id="insertBtn" title="Insert bytes at selected offset">Ins</button>
    <button class="secondary" id="overwriteBtn" title="Overwrite bytes at selected offset">Ovr</button>
    <button class="secondary" id="deleteBtn" title="Delete bytes at selected offset">Del</button>
  </div>
  <div class="toolbar-group">
    <button class="secondary" id="undoBtn" title="Undo (Ctrl+Z)">Undo</button>
    <button class="secondary" id="redoBtn" title="Redo (Ctrl+Y)">Redo</button>
    <button id="saveBtn" title="Save (Ctrl+S)">Save</button>
  </div>
</div>

<!-- ── Hex View ─────────────────────────────────────── -->
<div class="hex-container" id="hexContainer"></div>

<!-- ── Status Bar ───────────────────────────────────── -->
<div class="status-bar">
  <span>Offset: <span class="highlight" id="statusOffset">0x00000000</span></span>
  <span>Selected: <span class="highlight" id="statusSelected">-</span></span>
  <span>Size: <span class="highlight" id="statusSize">0</span> bytes</span>
  <span id="statusMatches"></span>
</div>

<!-- ── Edit Dialog ──────────────────────────────────── -->
<div class="overlay" id="overlay"></div>
<div class="edit-dialog" id="editDialog">
  <h3 id="editTitle">Insert</h3>
  <div class="field">
    <label>Offset (hex):</label>
    <input type="text" id="editOffset" class="narrow" />
  </div>
  <div class="field" id="editLengthField">
    <label>Length:</label>
    <input type="text" id="editLength" class="narrow" value="1" />
  </div>
  <div class="field" id="editDataField">
    <label>Data (hex bytes, e.g. 48 65 6C):</label>
    <input type="text" id="editData" />
  </div>
  <div class="actions">
    <button class="secondary" id="editCancel">Cancel</button>
    <button id="editOk">OK</button>
  </div>
</div>

<script>
(function () {
  // VS Code webview API
  const vscode = acquireVsCodeApi()

  // ── Configuration ───────────────────────────────────
  const BYTES_PER_ROW = ${bytesPerRow}
  const GROUP_SIZE = 8 // visual separator every N bytes

  // ── State ───────────────────────────────────────────
  let viewportOffset = 0
  let viewportData = []      // number[]
  let viewportLength = 0
  let fileSize = 0
  let selectedOffset = -1    // absolute byte offset of selected byte
  let searchMatches = []     // number[] of match offsets
  let searchMatchIndex = -1
  let searchPatternLength = 0

  // ── DOM Refs ────────────────────────────────────────
  const hexContainer = document.getElementById('hexContainer')
  const statusOffset = document.getElementById('statusOffset')
  const statusSelected = document.getElementById('statusSelected')
  const statusSize = document.getElementById('statusSize')
  const statusMatches = document.getElementById('statusMatches')
  const searchInput = document.getElementById('searchInput')
  const searchHex = document.getElementById('searchHex')
  const searchCase = document.getElementById('searchCase')
  const matchNav = document.getElementById('matchNav')
  const editDialog = document.getElementById('editDialog')
  const overlay = document.getElementById('overlay')
  const editTitle = document.getElementById('editTitle')
  const editOffset = document.getElementById('editOffset')
  const editLength = document.getElementById('editLength')
  const editData = document.getElementById('editData')
  const editLengthField = document.getElementById('editLengthField')
  const editDataField = document.getElementById('editDataField')

  // ── Render ──────────────────────────────────────────

  function toHex8(n) {
    return n.toString(16).toUpperCase().padStart(8, '0')
  }

  function toHex2(n) {
    return n.toString(16).toUpperCase().padStart(2, '0')
  }

  function isPrintable(b) {
    return b >= 0x20 && b <= 0x7e
  }

  function isMatchByte(absOffset) {
    for (const m of searchMatches) {
      if (absOffset >= m && absOffset < m + searchPatternLength) return true
    }
    return false
  }

  function render() {
    const rows = Math.ceil(viewportLength / BYTES_PER_ROW)
    let html = ''

    for (let r = 0; r < rows; r++) {
      const rowOffset = viewportOffset + r * BYTES_PER_ROW
      let hexCells = ''
      let asciiCells = ''

      for (let c = 0; c < BYTES_PER_ROW; c++) {
        const idx = r * BYTES_PER_ROW + c
        const absOff = viewportOffset + idx
        const sep = (c > 0 && c % GROUP_SIZE === 0) ? ' group-sep' : ''

        if (idx < viewportLength) {
          const b = viewportData[idx]
          const sel = absOff === selectedOffset ? ' selected' : ''
          const mat = isMatchByte(absOff) ? ' match' : ''
          hexCells += '<span class="hex-byte' + sep + sel + mat +
            '" data-offset="' + absOff + '">' + toHex2(b) + '</span>'
          const ch = isPrintable(b) ? String.fromCharCode(b) : '.'
          asciiCells += '<span class="ascii-char' + sel + mat +
            '" data-offset="' + absOff + '">' +
            (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch) +
            '</span>'
        } else {
          hexCells += '<span class="hex-byte' + sep + '">  </span>'
          asciiCells += '<span class="ascii-char"> </span>'
        }
      }

      html += '<div class="hex-row">' +
        '<span class="offset-col">' + toHex8(rowOffset) + '</span>' +
        '<span class="hex-col">' + hexCells + '</span>' +
        '<span class="ascii-col">' + asciiCells + '</span>' +
        '</div>'
    }

    hexContainer.innerHTML = html
    statusOffset.textContent = '0x' + toHex8(viewportOffset)
    statusSize.textContent = fileSize.toLocaleString()

    // Attach click handlers to hex bytes and ascii chars
    hexContainer.querySelectorAll('[data-offset]').forEach(el => {
      el.addEventListener('click', () => {
        selectedOffset = parseInt(el.dataset.offset, 10)
        statusSelected.textContent = '0x' + toHex8(selectedOffset)
        render()
      })
    })
  }

  // ── Message Handling ────────────────────────────────

  window.addEventListener('message', (event) => {
    const msg = event.data
    switch (msg.type) {
      case 'viewportData':
        viewportOffset = msg.offset
        viewportData = msg.data
        viewportLength = msg.length
        fileSize = msg.fileSize
        render()
        break

      case 'fileSizeChanged':
        fileSize = msg.fileSize
        statusSize.textContent = fileSize.toLocaleString()
        break

      case 'searchResults':
        searchMatches = msg.matches
        searchMatchIndex = msg.matches.length > 0 ? 0 : -1
        matchNav.innerHTML = msg.matches.length > 0
          ? '<span>' + (searchMatchIndex + 1) + '</span> / ' + msg.matches.length
          : 'No matches'
        statusMatches.textContent = msg.matches.length + ' matches'
        render()
        break
    }
  })

  // ── Scrolling ───────────────────────────────────────

  hexContainer.addEventListener('wheel', (e) => {
    e.preventDefault()
    vscode.postMessage({
      type: 'scroll',
      direction: e.deltaY < 0 ? 'up' : 'down',
    })
  }, { passive: false })

  // ── Keyboard Shortcuts ──────────────────────────────

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault()
      vscode.postMessage({ type: 'undo' })
    } else if (e.ctrlKey && e.key === 'y') {
      e.preventDefault()
      vscode.postMessage({ type: 'redo' })
    } else if (e.ctrlKey && e.key === 's') {
      e.preventDefault()
      vscode.postMessage({ type: 'save' })
    } else if (e.ctrlKey && e.key === 'f') {
      e.preventDefault()
      searchInput.focus()
    } else if (e.ctrlKey && e.key === 'g') {
      e.preventDefault()
      // Go to offset — trigger via VS Code command instead
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      vscode.postMessage({ type: 'scrollTo', offset: viewportOffset + BYTES_PER_ROW * 32 })
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      const newOffset = Math.max(0, viewportOffset - BYTES_PER_ROW * 32)
      vscode.postMessage({ type: 'scrollTo', offset: newOffset })
    } else if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault()
      vscode.postMessage({ type: 'scrollTo', offset: 0 })
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault()
      vscode.postMessage({ type: 'scrollTo', offset: Math.max(0, fileSize - BYTES_PER_ROW) })
    }
  })

  // ── Search ──────────────────────────────────────────

  function doSearch() {
    const query = searchInput.value.trim()
    if (!query) return
    const isHex = searchHex.checked
    searchPatternLength = isHex ? query.replace(/\\s/g, '').length / 2 : query.length
    vscode.postMessage({
      type: 'search',
      query: isHex ? query.replace(/\\s/g, '') : query,
      isHex: isHex,
      caseInsensitive: searchCase.checked,
    })
  }

  document.getElementById('searchBtn').addEventListener('click', doSearch)
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch()
  })

  document.getElementById('nextMatch').addEventListener('click', () => {
    if (searchMatches.length === 0) return
    searchMatchIndex = (searchMatchIndex + 1) % searchMatches.length
    matchNav.innerHTML = '<span>' + (searchMatchIndex + 1) + '</span> / ' + searchMatches.length
    vscode.postMessage({ type: 'goToMatch', offset: searchMatches[searchMatchIndex] })
  })

  document.getElementById('prevMatch').addEventListener('click', () => {
    if (searchMatches.length === 0) return
    searchMatchIndex = (searchMatchIndex - 1 + searchMatches.length) % searchMatches.length
    matchNav.innerHTML = '<span>' + (searchMatchIndex + 1) + '</span> / ' + searchMatches.length
    vscode.postMessage({ type: 'goToMatch', offset: searchMatches[searchMatchIndex] })
  })

  // ── Edit Dialog ─────────────────────────────────────

  let editMode = 'insert'

  function openEditDialog(mode) {
    editMode = mode
    editTitle.textContent = mode === 'insert' ? 'Insert Bytes'
      : mode === 'overwrite' ? 'Overwrite Bytes'
      : 'Delete Bytes'
    editOffset.value = selectedOffset >= 0 ? toHex8(selectedOffset) : '00000000'
    editData.value = ''
    editLength.value = '1'
    editLengthField.style.display = mode === 'delete' ? 'block' : 'none'
    editDataField.style.display = mode !== 'delete' ? 'block' : 'none'
    editDialog.classList.add('active')
    overlay.classList.add('active')
    if (mode === 'delete') {
      editLength.focus()
    } else {
      editData.focus()
    }
  }

  function closeEditDialog() {
    editDialog.classList.remove('active')
    overlay.classList.remove('active')
  }

  function submitEdit() {
    const offset = parseInt(editOffset.value, 16)
    if (isNaN(offset) || offset < 0) return

    if (editMode === 'delete') {
      const len = parseInt(editLength.value, 10)
      if (isNaN(len) || len < 1) return
      vscode.postMessage({ type: 'delete', offset: offset, length: len })
    } else {
      const hex = editData.value.replace(/\\s/g, '')
      if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
        editData.style.borderColor = 'red'
        return
      }
      editData.style.borderColor = ''
      vscode.postMessage({ type: editMode, offset: offset, data: hex })
    }
    closeEditDialog()
  }

  document.getElementById('insertBtn').addEventListener('click', () => openEditDialog('insert'))
  document.getElementById('overwriteBtn').addEventListener('click', () => openEditDialog('overwrite'))
  document.getElementById('deleteBtn').addEventListener('click', () => openEditDialog('delete'))
  document.getElementById('editCancel').addEventListener('click', closeEditDialog)
  document.getElementById('editOk').addEventListener('click', submitEdit)
  overlay.addEventListener('click', closeEditDialog)

  // Submit on Enter inside the edit dialog
  editData.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEdit() })
  editLength.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEdit() })
  editOffset.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEdit() })

  // ── Undo / Redo / Save Buttons ──────────────────────

  document.getElementById('undoBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'undo' })
  })
  document.getElementById('redoBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'redo' })
  })
  document.getElementById('saveBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'save' })
  })
})()
</script>
</body>
</html>`
}
