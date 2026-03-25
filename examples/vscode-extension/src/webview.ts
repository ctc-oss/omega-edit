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
  const groupSize = 8
  const byteCellWidth = 22
  const byteGap = 6
  const groupGap = 4
  const groupSeparators = Math.floor((bytesPerRow - 1) / groupSize)
  const hexColumnWidth =
    bytesPerRow * byteCellWidth +
    (bytesPerRow - 1) * byteGap +
    groupSeparators * groupGap

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
    --highlight-fg: var(--vscode-editor-findMatchForeground, var(--fg));
    --selected: var(--vscode-editor-selectionBackground, rgba(38, 79, 120, 0.6));
    --selected-fg: var(--vscode-editor-selectionForeground, var(--fg));
    --toolbar-bg: var(--vscode-sideBar-background, #252526);
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --input-fg: var(--vscode-input-foreground, #ccc);
    --input-border: var(--vscode-input-border, #555);
    --button-bg: var(--vscode-button-background, #0e639c);
    --button-fg: var(--vscode-button-foreground, #fff);
    --button-hover: var(--vscode-button-hoverBackground, #1177bb);
    --offset-fg: var(--vscode-editorLineNumber-foreground, #858585);
    --offset-column-fg: var(--vscode-terminal-ansiCyan, #4fc1ff);
    --ascii-fg: var(--vscode-terminal-ansiGreen, #6a9955);
    --ascii-muted-fg: color-mix(in srgb, var(--ascii-fg) 45%, var(--fg) 55%);
    --mono: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
    --font-size: var(--vscode-editor-font-size, 13px);
    --contrast-border: var(--vscode-contrastActiveBorder, transparent);
    --offset-col-width: 80px;
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
  .toolbar label.disabled { opacity: 0.5; }
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
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:disabled:hover { background: inherit; }
  button.secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
  }
  button.secondary:hover { background: var(--input-bg); }

  /* ── Hex Grid ────────────────────────────────────── */
  .viewer-shell {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .viewer-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .hex-header {
    display: flex;
    align-items: center;
    padding: 4px 10px 6px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--toolbar-bg) 84%, var(--bg) 16%);
    line-height: 1.6;
  }
  .hex-header .offset-col {
    color: var(--offset-fg);
  }
  .offset-header-label {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .hex-column-header {
    width: ${hexColumnWidth}px;
    flex: 0 0 ${hexColumnWidth}px;
    display: flex;
    flex-wrap: wrap;
    gap: 0 6px;
  }
  .hex-column-label {
    width: 22px;
    text-align: center;
    color: var(--offset-column-fg);
    font-size: var(--font-size);
    line-height: 1.6;
  }
  .hex-column-label.group-sep {
    margin-left: 4px;
  }
  .hex-column-label.hover {
    color: var(--fg);
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
  }
  .ascii-header {
    color: var(--offset-fg);
    padding-left: 12px;
    border-left: 1px solid var(--border);
    min-width: calc(${bytesPerRow}ch + 12px);
    flex-shrink: 0;
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
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
    color: var(--offset-column-fg);
    width: var(--offset-col-width);
    min-width: var(--offset-col-width);
    flex: 0 0 var(--offset-col-width);
    text-align: right;
    padding-right: 12px;
  }
  .offset-col.hover {
    color: var(--fg);
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
  }
  .hex-col {
    width: ${hexColumnWidth}px;
    flex: 0 0 ${hexColumnWidth}px;
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
  .hex-byte:hover {
    background: var(--selected);
    color: var(--selected-fg);
    outline: 1px solid var(--contrast-border);
    outline-offset: -1px;
  }
  .hex-byte.selected {
    background: var(--selected);
    color: var(--selected-fg);
    outline: 1px solid var(--contrast-border);
    outline-offset: -1px;
  }
  .hex-byte.match {
    background: var(--highlight);
    color: var(--highlight-fg);
  }
  .hex-byte.group-sep { margin-left: 4px; }
  .ascii-col {
    color: var(--ascii-fg);
    display: inline-grid;
    grid-template-columns: repeat(${bytesPerRow}, 1ch);
    padding-left: 12px;
    border-left: 1px solid var(--border);
    min-width: calc(${bytesPerRow}ch + 12px);
    flex-shrink: 0;
  }
  .ascii-char {
    cursor: pointer;
    display: inline-block;
    width: 1ch;
    text-align: center;
    white-space: pre;
  }
  .ascii-char:hover {
    background: var(--selected);
    color: var(--selected-fg);
    outline: 1px solid var(--contrast-border);
    outline-offset: -1px;
  }
  .ascii-char.selected {
    background: var(--selected);
    color: var(--selected-fg);
    outline: 1px solid var(--contrast-border);
    outline-offset: -1px;
  }
  .ascii-char.match {
    background: var(--highlight);
    color: var(--highlight-fg);
  }
  .ascii-char.non-printable {
    color: var(--ascii-muted-fg);
  }
  .ascii-char.empty {
    color: transparent;
  }
  .scrollbar {
    width: 18px;
    padding: 4px 4px 4px 0;
    background: var(--bg);
    border-left: 1px solid var(--border);
    user-select: none;
  }
  .scrollbar.dragging {
    cursor: ns-resize;
  }
  .scrollbar-track {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--toolbar-bg);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .scrollbar-track.disabled {
    opacity: 0.45;
  }
  .scrollbar-thumb {
    position: absolute;
    left: 1px;
    right: 1px;
    top: 0;
    min-height: 24px;
    background: var(--button-bg);
    border-radius: 999px;
    cursor: pointer;
    touch-action: none;
    transform-origin: top center;
    will-change: transform;
  }
  .scrollbar-thumb:hover {
    background: var(--button-hover);
  }
  .interaction-blocker {
    position: fixed;
    inset: 0;
    z-index: 1000;
    cursor: ns-resize;
    background: transparent;
  }

  /* ── Status Bar ──────────────────────────────────── */
  .status-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    padding: 4px 10px;
    background: var(--toolbar-bg);
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--offset-fg);
  }
  .status-bar .highlight { color: var(--fg); }
  .status-fill {
    flex: 1 1 auto;
  }
  .status-inline-button {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 1px 6px;
    font-size: 11px;
    line-height: 1.2;
  }
  .status-inline-button:hover {
    background: var(--input-bg);
  }
  .status-action {
    color: var(--vscode-terminal-ansiYellow, #dcdcaa);
  }
  .server-health {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    cursor: default;
  }
  .server-health-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--vscode-descriptionForeground, #888);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  }
  .server-health-dot.ok {
    background: var(--vscode-testing-iconPassed, #73c991);
  }
  .server-health-dot.error {
    background: var(--vscode-testing-iconFailed, #f14c4c);
  }

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
    <label for="bytesPerRowSelect">Row:</label>
    <select id="bytesPerRowSelect" title="Bytes per row">
      <option value="8"${bytesPerRow === 8 ? ' selected' : ''}>8</option>
      <option value="16"${bytesPerRow === 16 ? ' selected' : ''}>16</option>
      <option value="32"${bytesPerRow === 32 ? ' selected' : ''}>32</option>
    </select>
  </div>
  <div class="toolbar-group">
    <label for="offsetRadixSelect">Offsets:</label>
    <select id="offsetRadixSelect" title="Offset display radix">
      <option value="hex" selected>Hex</option>
      <option value="dec">Dec</option>
    </select>
  </div>
  <div class="toolbar-group">
    <label>Search:</label>
    <input type="text" id="searchInput" placeholder="text or hex bytes" />
    <input type="text" id="replaceInput" placeholder="replace with" />
    <label><input type="checkbox" id="searchHex" /> Hex</label>
    <label id="searchCaseLabel"><input type="checkbox" id="searchCase" /> Aa</label>
    <label for="searchDirectionSelect">Dir:</label>
    <select id="searchDirectionSelect" title="Search direction">
      <option value="forward" selected>Top to Bottom</option>
      <option value="reverse">Bottom to Top</option>
    </select>
    <button class="secondary" id="searchBtn">Find</button>
    <button class="secondary" id="replaceBtn">Replace</button>
    <button class="secondary" id="replaceAllBtn">All</button>
    <span class="match-nav" id="matchNav"></span>
    <button class="secondary" id="prevMatch" title="Previous match">&#9650;</button>
    <button class="secondary" id="nextMatch" title="Next match">&#9660;</button>
  </div>
  <div class="toolbar-group">
    <button class="secondary" id="topBtn" title="Jump to top">Top</button>
    <button class="secondary" id="bottomBtn" title="Jump to bottom">Bottom</button>
  </div>
  <div class="toolbar-group">
    <button class="secondary" id="insertBtn" title="Insert bytes at selected offset">Ins</button>
    <button class="secondary" id="overwriteBtn" title="Overwrite bytes at selected offset">Ovr</button>
    <button class="secondary" id="deleteBtn" title="Delete bytes at selected offset">Del</button>
  </div>
  <div class="toolbar-group">
    <button class="secondary" id="undoBtn" title="Undo (Ctrl+Z)">Undo</button>
    <button class="secondary" id="redoBtn" title="Redo (Ctrl+Y)">Redo</button>
    <button class="secondary" id="saveBtn" title="Save (Ctrl+S)">Save</button>
    <button class="secondary" id="saveAsBtn" title="Save As (Ctrl+Shift+S)">Save As</button>
  </div>
</div>

<!-- ── Hex View ─────────────────────────────────────── -->
<div class="viewer-shell">
  <div class="viewer-main">
    <div class="hex-header" id="hexHeader">
      <span class="offset-col offset-header-label">Offset</span>
      <span class="hex-column-header" id="hexColumnHeader"></span>
      <span class="ascii-header">Text</span>
    </div>
    <div class="hex-container" id="hexContainer"></div>
  </div>
  <div class="scrollbar" id="scrollbar">
    <div class="scrollbar-track" id="scrollbarTrack" title="Navigate file">
      <div class="scrollbar-thumb" id="scrollbarThumb" title="Current viewport"></div>
    </div>
  </div>
</div>

<!-- ── Status Bar ───────────────────────────────────── -->
<div class="status-bar">
  <span>State: <span class="highlight" id="statusDirty">Saved</span></span>
  <span>Offset: <span class="highlight" id="statusOffset">0x00000000</span></span>
  <span>Selected: <span class="highlight" id="statusSelected">-</span></span>
  <span>Size: <span class="highlight" id="statusSize">0</span> bytes</span>
  <span>View: <span class="highlight" id="statusProgress">0.00%</span></span>
  <span id="statusMatches"></span>
  <span class="status-action" id="statusAction"></span>
  <span>
    Inspect
    <button class="status-inline-button" id="inspectorEndianBtn" title="Toggle inspector endianness">LE</button>:
    <span class="highlight" id="statusInspector">-</span>
  </span>
  <span class="status-fill"></span>
  <span class="server-health" id="serverHealth" title="Waiting for Î©editâ„¢ heartbeat...">
    <span class="server-health-dot" id="serverHealthDot"></span>
  </span>
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
  let bufferOffset = 0
  let visibleOffset = 0
  let pendingVisibleOffset = 0
  let viewportData = []      // number[]
  let viewportLength = 0
  let fileSize = 0
  let selectedOffset = -1    // absolute byte offset of selected byte
  let searchMatches = []     // number[] of match offsets
  let matchedByteOffsets = new Set()
  let searchMatchIndex = -1
  let searchPatternLength = 0
  let isDraggingScrollbar = false
  let scrollbarDragOffsetY = 0
  let accumulatedWheelPixels = 0
  let scrollbarInteractionBlocker = null
  let measuredRowHeight = 0
  let offsetRadix = 'hex'
  let offsetWidthMeasurer = null
  let inspectorLittleEndian = true
  let hoveredColumn = -1
  let hoveredRowIndex = -1

  // ── DOM Refs ────────────────────────────────────────
  const hexContainer = document.getElementById('hexContainer')
  const hexColumnHeader = document.getElementById('hexColumnHeader')
  const scrollbarTrack = document.getElementById('scrollbarTrack')
  const scrollbarThumb = document.getElementById('scrollbarThumb')
  const bytesPerRowSelect = document.getElementById('bytesPerRowSelect')
  const offsetRadixSelect = document.getElementById('offsetRadixSelect')
  const statusOffset = document.getElementById('statusOffset')
  const statusSelected = document.getElementById('statusSelected')
  const statusDirty = document.getElementById('statusDirty')
  const statusSize = document.getElementById('statusSize')
  const statusProgress = document.getElementById('statusProgress')
  const statusMatches = document.getElementById('statusMatches')
  const statusAction = document.getElementById('statusAction')
  const statusInspector = document.getElementById('statusInspector')
  const inspectorEndianBtn = document.getElementById('inspectorEndianBtn')
  const serverHealth = document.getElementById('serverHealth')
  const serverHealthDot = document.getElementById('serverHealthDot')
  const searchInput = document.getElementById('searchInput')
  const replaceInput = document.getElementById('replaceInput')
  const searchHex = document.getElementById('searchHex')
  const searchCase = document.getElementById('searchCase')
  const searchCaseLabel = document.getElementById('searchCaseLabel')
  const searchDirectionSelect = document.getElementById('searchDirectionSelect')
  const searchBtn = document.getElementById('searchBtn')
  const replaceBtn = document.getElementById('replaceBtn')
  const replaceAllBtn = document.getElementById('replaceAllBtn')
  const matchNav = document.getElementById('matchNav')
  const prevMatchBtn = document.getElementById('prevMatch')
  const nextMatchBtn = document.getElementById('nextMatch')
  const topBtn = document.getElementById('topBtn')
  const bottomBtn = document.getElementById('bottomBtn')
  const undoBtn = document.getElementById('undoBtn')
  const redoBtn = document.getElementById('redoBtn')
  const saveBtn = document.getElementById('saveBtn')
  const saveAsBtn = document.getElementById('saveAsBtn')
  const editDialog = document.getElementById('editDialog')
  const overlay = document.getElementById('overlay')
  const editTitle = document.getElementById('editTitle')
  const editOffset = document.getElementById('editOffset')
  const editLength = document.getElementById('editLength')
  const editData = document.getElementById('editData')
  const editLengthField = document.getElementById('editLengthField')
  const editDataField = document.getElementById('editDataField')

  function clamp(min, value, max) {
    return Math.max(min, Math.min(value, max))
  }

  // ── Render ──────────────────────────────────────────

  function toHex8(n) {
    return n.toString(16).toUpperCase().padStart(8, '0')
  }

  function toHex2(n) {
    return n.toString(16).toUpperCase().padStart(2, '0')
  }

  function formatRowOffset(offset) {
    return offsetRadix === 'dec'
      ? offset.toLocaleString()
      : toHex8(offset)
  }

  function formatOffsetDisplay(offset) {
    return '0x' + toHex8(offset) + ' (' + offset.toLocaleString() + ')'
  }

  function formatColumnOffset(offset) {
    if (offsetRadix === 'dec') {
      return offset.toString().padStart(2, '0')
    }
    return toHex2(offset)
  }

  function getOffsetWidthMeasurer() {
    if (offsetWidthMeasurer) {
      return offsetWidthMeasurer
    }

    offsetWidthMeasurer = document.createElement('span')
    offsetWidthMeasurer.style.position = 'absolute'
    offsetWidthMeasurer.style.visibility = 'hidden'
    offsetWidthMeasurer.style.whiteSpace = 'pre'
    offsetWidthMeasurer.style.pointerEvents = 'none'
    offsetWidthMeasurer.style.inset = '-9999px auto auto -9999px'
    document.body.appendChild(offsetWidthMeasurer)
    return offsetWidthMeasurer
  }

  function updateOffsetColumnWidth() {
    const measurer = getOffsetWidthMeasurer()
    const computed = window.getComputedStyle(document.body)
    const maxRowOffset = Math.max(0, Math.max(0, fileSize - 1) - (Math.max(0, fileSize - 1) % BYTES_PER_ROW))
    const widestLabel = formatRowOffset(maxRowOffset)
    const headerLabel = 'Offset'

    measurer.style.fontFamily = computed.fontFamily
    measurer.style.fontSize = computed.fontSize
    measurer.style.fontWeight = computed.fontWeight
    measurer.style.letterSpacing = 'normal'
    measurer.textContent = widestLabel.length >= headerLabel.length ? widestLabel : headerLabel

    const contentWidth = Math.ceil(measurer.getBoundingClientRect().width)
    const totalWidth = Math.max(80, contentWidth + 12)
    document.documentElement.style.setProperty('--offset-col-width', totalWidth + 'px')
  }

  function renderColumnHeader() {
    let html = ''
    for (let i = 0; i < BYTES_PER_ROW; i++) {
      const sep = (i > 0 && i % GROUP_SIZE === 0) ? ' group-sep' : ''
      const hover = i === hoveredColumn ? ' hover' : ''
      html += '<span class="hex-column-label' + sep + hover + '" data-col="' + i + '">' +
        formatColumnOffset(i) +
        '</span>'
    }
    hexColumnHeader.innerHTML = html
  }

  function updateHoverHighlights(nextRowIndex, nextColumn) {
    if (hoveredRowIndex === nextRowIndex && hoveredColumn === nextColumn) {
      return
    }

    if (hoveredRowIndex >= 0) {
      hexContainer
        .querySelector('.hex-row[data-row-index="' + hoveredRowIndex + '"] .offset-col')
        ?.classList.remove('hover')
    }

    if (hoveredColumn >= 0) {
      hexColumnHeader
        .querySelector('.hex-column-label[data-col="' + hoveredColumn + '"]')
        ?.classList.remove('hover')
    }

    hoveredRowIndex = nextRowIndex
    hoveredColumn = nextColumn

    if (hoveredRowIndex >= 0) {
      hexContainer
        .querySelector('.hex-row[data-row-index="' + hoveredRowIndex + '"] .offset-col')
        ?.classList.add('hover')
    }

    if (hoveredColumn >= 0) {
      hexColumnHeader
        .querySelector('.hex-column-label[data-col="' + hoveredColumn + '"]')
        ?.classList.add('hover')
    }
  }

  function isPrintable(b) {
    return b >= 0x20 && b <= 0x7e
  }

  function escapeHtml(text) {
    return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
  }

  function clearSearchResults(message = '') {
    searchMatches = []
    matchedByteOffsets = new Set()
    searchMatchIndex = -1
    searchPatternLength = 0
    matchNav.textContent = message
    statusMatches.textContent = ''
    updateSearchButtons()
    render()
  }

  function updateOffsetStatus() {
    statusOffset.textContent = formatOffsetDisplay(visibleOffset)
  }

  function updateSelectedStatus() {
    statusSelected.textContent = selectedOffset >= 0
      ? formatOffsetDisplay(selectedOffset)
      : '-'
    updateInspectorStatus()
  }

  function updateDirtyStatus(isDirty) {
    statusDirty.textContent = isDirty ? 'Dirty' : 'Saved'
    saveBtn.disabled = !isDirty
  }

  function updateActionStatus(message = '') {
    statusAction.textContent = message
  }

  function updateServerHealthStatus(message) {
    const ok = !!message?.ok
    serverHealth.title = message?.detail || 'Waiting for Ωedit™ heartbeat...'
    serverHealthDot.classList.toggle('ok', ok)
    serverHealthDot.classList.toggle('error', !!message && !ok)
  }

  function updateInspectorEndianLabel() {
    inspectorEndianBtn.textContent = inspectorLittleEndian ? 'LE' : 'BE'
    inspectorEndianBtn.title = inspectorLittleEndian
      ? 'Switch inspector to big-endian'
      : 'Switch inspector to little-endian'
  }

  function updateInspectorStatus() {
    if (selectedOffset < 0) {
      statusInspector.textContent = '-'
      return
    }

    const index = selectedOffset - bufferOffset
    if (index < 0 || index >= viewportLength) {
      statusInspector.textContent = 'move selection into view'
      return
    }

    const bytes = viewportData.slice(index, Math.min(index + 4, viewportLength))
    if (bytes.length === 0) {
      statusInspector.textContent = '-'
      return
    }

    const u8 = bytes[0]
    const ascii = isPrintable(u8) ? String.fromCharCode(u8) : '?'
    const endianLabel = inspectorLittleEndian ? 'le' : 'be'
    const u16 = bytes.length >= 2
      ? new DataView(Uint8Array.from(bytes.slice(0, 2)).buffer).getUint16(0, inspectorLittleEndian)
      : null
    const u32 = bytes.length >= 4
      ? new DataView(Uint8Array.from(bytes.slice(0, 4)).buffer).getUint32(0, inspectorLittleEndian)
      : null

    statusInspector.textContent =
      '0x' + toHex2(u8) +
      ' | ' + u8 +
      " | '" + ascii + "'" +
      ' | u16' + endianLabel + ' ' + (u16 === null ? '-' : u16.toLocaleString()) +
      ' | u32' + endianLabel + ' ' + (u32 === null ? '-' : u32.toLocaleString())
  }

  function updateProgressStatus() {
    if (fileSize <= 0) {
      statusProgress.textContent = '0.00%'
      return
    }

    const visibleByteCount = currentVisibleByteCount()
    const visibleEnd = Math.min(
      fileSize,
      visibleOffset + visibleByteCount
    )
    const progress = (visibleEnd / fileSize) * 100
    statusProgress.textContent = progress.toFixed(2) + '%'
  }

  function updateSearchButtons() {
    searchBtn.disabled = searchInput.value.trim().length === 0
    const hasMatches = searchMatches.length > 0
    prevMatchBtn.disabled = !hasMatches
    nextMatchBtn.disabled = !hasMatches
    replaceBtn.disabled = !hasMatches
    replaceAllBtn.disabled = !hasMatches
  }

  function updateEditButtons(canUndo, canRedo, undoCount = 0, redoCount = 0) {
    undoBtn.disabled = !canUndo
    redoBtn.disabled = !canRedo
    undoBtn.textContent = 'Undo (' + undoCount + ')'
    redoBtn.textContent = 'Redo (' + redoCount + ')'
    undoBtn.title = 'Undo ' + undoCount + ' change(s) (Ctrl+Z)'
    redoBtn.title = 'Redo ' + redoCount + ' change(s) (Ctrl+Y)'
  }

  function totalRows() {
    return Math.max(1, Math.ceil(fileSize / BYTES_PER_ROW))
  }

  function visibleRows() {
    if (measuredRowHeight > 0 && hexContainer.clientHeight > 0) {
      return Math.max(1, Math.floor(hexContainer.clientHeight / measuredRowHeight))
    }
    return Math.max(1, Math.ceil(Math.max(viewportLength, BYTES_PER_ROW) / BYTES_PER_ROW))
  }

  function currentVisibleByteCount() {
    return Math.min(
      Math.max(BYTES_PER_ROW, visibleRows() * BYTES_PER_ROW),
      Math.max(0, fileSize - visibleOffset),
      Math.max(viewportLength, BYTES_PER_ROW)
    )
  }

  function reportViewportMetrics() {
    vscode.postMessage({
      type: 'setViewportMetrics',
      visibleRows: visibleRows(),
    })
  }

  function maxStartRow() {
    return Math.max(0, totalRows() - visibleRows())
  }

  function currentStartRow() {
    return Math.floor(visibleOffset / BYTES_PER_ROW)
  }

  function clampOffset(offset) {
    if (fileSize <= 0) {
      return 0
    }
    return Math.max(0, Math.min(offset, fileSize - 1))
  }

  function updateScrollbar() {
    const trackHeight = scrollbarTrack.clientHeight
    if (!trackHeight) {
      return
    }

    const total = totalRows()
    const visible = visibleRows()
    const maxRow = maxStartRow()
    const trackDisabled = total <= visible || fileSize <= 0
    scrollbarTrack.classList.toggle('disabled', trackDisabled)
    scrollbarThumb.style.opacity = trackDisabled ? '0' : '1'
    scrollbarThumb.style.pointerEvents = trackDisabled ? 'none' : 'auto'

    const thumbHeight = trackDisabled
      ? trackHeight - 2
      : Math.max(24, Math.round((visible / total) * trackHeight))
    const travel = Math.max(0, trackHeight - thumbHeight)
    const thumbTop = trackDisabled || maxRow === 0
      ? 0
      : Math.round((currentStartRow() / maxRow) * travel)

    scrollbarThumb.style.height = trackHeight + 'px'
    scrollbarThumb.style.transform =
      'translateY(' + thumbTop + 'px) scaleY(' + (thumbHeight / trackHeight) + ')'
  }

  function scrollToViewportOffset(offset) {
    const clampedOffset = clampOffset(offset)
    const rowAlignedOffset = clampedOffset - (clampedOffset % BYTES_PER_ROW)
    const renderedByteCount = currentVisibleByteCount()
    const bufferEnd = bufferOffset + viewportLength
    const fitsInBuffer =
      rowAlignedOffset >= bufferOffset &&
      rowAlignedOffset + renderedByteCount <= bufferEnd

    if (fitsInBuffer) {
      visibleOffset = rowAlignedOffset
      pendingVisibleOffset = rowAlignedOffset
      render()
      return
    }

    pendingVisibleOffset = rowAlignedOffset
    vscode.postMessage({
      type: 'scrollTo',
      offset: rowAlignedOffset,
    })
  }

  function scrollToRow(row) {
    const clampedRow = Math.max(0, Math.min(row, maxStartRow()))
    scrollToViewportOffset(clampedRow * BYTES_PER_ROW)
  }

  function scrollFromTrackPosition(clientY, offsetWithinThumb) {
    const rect = scrollbarTrack.getBoundingClientRect()
    const trackHeight = rect.height
    const thumbHeight = scrollbarThumb.getBoundingClientRect().height
    const travel = Math.max(0, trackHeight - thumbHeight)
    const rawY = clientY - rect.top - offsetWithinThumb
    const thumbTop = clamp(0, rawY, travel)
    const ratio = travel === 0 ? 0 : thumbTop / travel
    scrollToRow(Math.round(ratio * maxStartRow()))
  }

  function setScrollbarDragging(isDragging) {
    isDraggingScrollbar = isDragging
    scrollbarTrack.classList.toggle('dragging', isDragging)
    scrollbarThumb.classList.toggle('dragging', isDragging)
    document.body.classList.toggle('scrollbar-dragging', isDragging)
    scrollbarTrack.parentElement.classList.toggle('dragging', isDragging)
  }

  function removeScrollbarInteractionBlocker() {
    if (!scrollbarInteractionBlocker) {
      return
    }
    scrollbarInteractionBlocker.remove()
    scrollbarInteractionBlocker = null
  }

  function ensureScrollbarInteractionBlocker() {
    if (scrollbarInteractionBlocker) {
      return
    }
    scrollbarInteractionBlocker = document.createElement('div')
    scrollbarInteractionBlocker.className = 'interaction-blocker'
    document.body.appendChild(scrollbarInteractionBlocker)
  }

  function startScrollbarDrag(clientY, offsetWithinThumb) {
    setScrollbarDragging(true)
    scrollbarDragOffsetY = offsetWithinThumb
    ensureScrollbarInteractionBlocker()
    scrollFromTrackPosition(clientY, scrollbarDragOffsetY)
  }

  function stopScrollbarDrag() {
    setScrollbarDragging(false)
    scrollbarDragOffsetY = 0
    removeScrollbarInteractionBlocker()
  }

  function offsetIsVisible(offset) {
    return (
      offset >= visibleOffset &&
      offset < visibleOffset + currentVisibleByteCount()
    )
  }

  function updateRenderedSelection(previousOffset, nextOffset) {
    if (!hexContainer) {
      return
    }

    if (previousOffset >= 0) {
      hexContainer
        .querySelectorAll('[data-offset="' + previousOffset + '"].selected')
        .forEach((el) => el.classList.remove('selected'))
    }

    if (nextOffset >= 0 && offsetIsVisible(nextOffset)) {
      hexContainer
        .querySelectorAll('[data-offset="' + nextOffset + '"]')
        .forEach((el) => el.classList.add('selected'))
    }
  }

  function selectOffset(offset) {
    const previousOffset = selectedOffset

    if (offset < 0 || fileSize <= 0) {
      selectedOffset = -1
      updateSelectedStatus()
      updateRenderedSelection(previousOffset, selectedOffset)
      return
    }

    selectedOffset = clampOffset(offset)
    updateSelectedStatus()
    updateRenderedSelection(previousOffset, selectedOffset)
  }

  function ensureSelectionVisible(direction) {
    if (selectedOffset < 0) {
      return
    }

    const visibleByteSpan = currentVisibleByteCount()
    const firstFullyVisibleOffset = visibleOffset
    const lastFullyVisibleRowStart = Math.max(
      visibleOffset,
      visibleOffset + Math.max(0, visibleByteSpan - BYTES_PER_ROW)
    )

    if (direction === 'up' && selectedOffset <= firstFullyVisibleOffset) {
      scrollToViewportOffset(selectedOffset)
      return
    }

    if (direction === 'down' && selectedOffset >= lastFullyVisibleRowStart) {
      scrollToViewportOffset(
        selectedOffset - Math.max(0, visibleByteSpan - BYTES_PER_ROW)
      )
      return
    }

    if (selectedOffset < visibleOffset) {
      scrollToViewportOffset(visibleOffset - BYTES_PER_ROW)
      return
    }

    if (selectedOffset >= visibleOffset + visibleByteSpan) {
      scrollToViewportOffset(visibleOffset + BYTES_PER_ROW)
    }
  }

  function isEditableTarget(target) {
    return target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
  }

  function moveSelection(direction) {
    if (fileSize <= 0) {
      return
    }

    if (selectedOffset < 0) {
      if (direction === 'up') {
        scrollToViewportOffset(visibleOffset - BYTES_PER_ROW)
      } else if (direction === 'down') {
        scrollToViewportOffset(visibleOffset + BYTES_PER_ROW)
      }
      return
    }

    const deltas = {
      left: -1,
      right: 1,
      up: -BYTES_PER_ROW,
      down: BYTES_PER_ROW,
    }
    const delta = deltas[direction]
    const nextOffset = clampOffset(selectedOffset + delta)

    if (nextOffset === selectedOffset) {
      return
    }

    selectOffset(nextOffset)
    ensureSelectionVisible(direction)
  }

  function syncSearchMode() {
    const hexMode = searchHex.checked
    searchCase.disabled = hexMode
    searchCaseLabel.classList.toggle('disabled', hexMode)
    if (hexMode) {
      searchCase.checked = false
    }
  }

  function updateMatchNav() {
    if (searchMatches.length === 0) {
      matchNav.textContent = 'No matches'
      statusMatches.textContent = ''
      updateSearchButtons()
      return
    }

    matchNav.innerHTML = '<span>' + (searchMatchIndex + 1) + '</span> / ' + searchMatches.length
    statusMatches.textContent = searchMatches.length + ' matches'
    updateSearchButtons()
  }

  function normalizedHexQuery(query) {
    const compact = query.replace(/\s/g, '')
    if (!compact) return ''
    return /^[0-9a-fA-F]+$/.test(compact) && compact.length % 2 === 0
      ? compact
      : null
  }

  function utf8ToHex(text) {
    return Array.from(new TextEncoder().encode(text))
      .map((value) => value.toString(16).toUpperCase().padStart(2, '0'))
      .join('')
  }

  function getReplacementHex() {
    const replacement = replaceInput.value
    if (!searchHex.checked) {
      return utf8ToHex(replacement)
    }
    return normalizedHexQuery(replacement)
  }

  function rebuildMatchedByteOffsets() {
    const offsets = new Set()
    if (searchPatternLength <= 0) {
      matchedByteOffsets = offsets
      return
    }

    for (const matchOffset of searchMatches) {
      for (let i = 0; i < searchPatternLength; i += 1) {
        offsets.add(matchOffset + i)
      }
    }

    matchedByteOffsets = offsets
  }

  function isMatchByte(absOffset) {
    return matchedByteOffsets.has(absOffset)
  }

  function render() {
    if (selectedOffset >= fileSize) {
      selectedOffset = fileSize > 0 ? fileSize - 1 : -1
      updateSelectedStatus()
    }

    updateOffsetColumnWidth()
    renderColumnHeader()
    const startIndex = Math.max(0, visibleOffset - bufferOffset)
    const visibleByteCount = currentVisibleByteCount()
    const rows = Math.max(1, Math.ceil(visibleByteCount / BYTES_PER_ROW))
    let html = ''

    for (let r = 0; r < rows; r++) {
      const rowOffset = visibleOffset + r * BYTES_PER_ROW
      let hexCells = ''
      let asciiCells = ''

      for (let c = 0; c < BYTES_PER_ROW; c++) {
        const idx = startIndex + r * BYTES_PER_ROW + c
        const absOff = rowOffset + c
        const sep = (c > 0 && c % GROUP_SIZE === 0) ? ' group-sep' : ''

        if (idx >= 0 && idx < viewportLength && absOff < fileSize) {
          const b = viewportData[idx]
          const sel = absOff === selectedOffset ? ' selected' : ''
          const mat = isMatchByte(absOff) ? ' match' : ''
          hexCells += '<span class="hex-byte' + sep + sel + mat +
            '" data-offset="' + absOff + '">' + toHex2(b) + '</span>'
          const printable = isPrintable(b)
          const asciiClass = printable ? 'ascii-char' : 'ascii-char non-printable'
          const ch = printable ? String.fromCharCode(b) : '?'
          asciiCells += '<span class="' + asciiClass + sel + mat +
            '" data-offset="' + absOff + '">' + escapeHtml(ch) + '</span>'
        } else {
          hexCells += '<span class="hex-byte' + sep + '">  </span>'
          asciiCells += '<span class="ascii-char empty">&nbsp;</span>'
        }
      }

      html += '<div class="hex-row" data-row-index="' + r + '">' +
        '<span class="offset-col">' + formatRowOffset(rowOffset) + '</span>' +
        '<span class="hex-col">' + hexCells + '</span>' +
        '<span class="ascii-col">' + asciiCells + '</span>' +
        '</div>'
    }

    hexContainer.innerHTML = html
    const firstRow = hexContainer.querySelector('.hex-row')
    if (firstRow) {
      measuredRowHeight = firstRow.getBoundingClientRect().height || measuredRowHeight
    }
    updateOffsetStatus()
    statusSize.textContent = fileSize.toLocaleString()
    updateProgressStatus()
    updateInspectorStatus()
    updateScrollbar()

    // Attach click handlers to hex bytes and ascii chars
    hexContainer.querySelectorAll('[data-offset]').forEach(el => {
      el.addEventListener('click', () => {
        selectOffset(parseInt(el.dataset.offset, 10))
      })
    })
  }

  // ── Message Handling ────────────────────────────────

  window.addEventListener('message', (event) => {
    const msg = event.data
    switch (msg.type) {
      case 'viewportData':
        bufferOffset = msg.offset
        visibleOffset =
          typeof msg.visibleOffset === 'number' ? msg.visibleOffset : pendingVisibleOffset
        pendingVisibleOffset = visibleOffset
        viewportData = msg.data
        viewportLength = msg.length
        fileSize = msg.fileSize
        render()
        break

      case 'fileSizeChanged':
        fileSize = msg.fileSize
        statusSize.textContent = fileSize.toLocaleString()
        updateProgressStatus()
        updateSelectedStatus()
        updateOffsetColumnWidth()
        updateScrollbar()
        break

      case 'searchResults':
        searchMatches = msg.matches
        searchPatternLength = msg.patternLength || searchPatternLength
        rebuildMatchedByteOffsets()
        searchMatchIndex = msg.matches.length > 0 ? 0 : -1
        if (searchMatches.length > 0) {
          selectOffset(searchMatches[0])
        }
        updateMatchNav()
        if (searchMatches.length === 0) {
          render()
        }
        break

      case 'editState':
        updateEditButtons(
          msg.canUndo,
          msg.canRedo,
          msg.undoCount ?? 0,
          msg.redoCount ?? 0
        )
        updateDirtyStatus(msg.isDirty ?? false)
        render()
        break

      case 'replaceComplete':
        updateActionStatus(
          (msg.replacedCount ?? 0) === 1
            ? 'Replaced 1 match'
            : 'Replaced ' + (msg.replacedCount ?? 0) + ' matches'
        )
        if (typeof msg.selectionOffset === 'number' && msg.selectionOffset >= 0) {
          selectOffset(msg.selectionOffset)
        }
        doSearch()
        break

      case 'serverHealth':
        updateServerHealthStatus(msg)
        break
    }
  })

  // ── Scrolling ───────────────────────────────────────

  hexContainer.addEventListener('wheel', (e) => {
    e.preventDefault()
    const rowHeight = Math.max(1, measuredRowHeight || 1)
    accumulatedWheelPixels += e.deltaY
    const deltaRows = accumulatedWheelPixels > 0
      ? Math.floor(accumulatedWheelPixels / rowHeight)
      : Math.ceil(accumulatedWheelPixels / rowHeight)

    if (deltaRows === 0) {
      return
    }

    accumulatedWheelPixels -= deltaRows * rowHeight
    scrollToViewportOffset(visibleOffset + deltaRows * BYTES_PER_ROW)
  }, { passive: false })

  hexContainer.addEventListener('pointermove', (e) => {
    const target = e.target.closest('[data-offset]')
    if (!target) {
      updateHoverHighlights(-1, -1)
      return
    }

    const offset = parseInt(target.dataset.offset, 10)
    if (Number.isNaN(offset)) {
      updateHoverHighlights(-1, -1)
      return
    }

    const row = target.closest('.hex-row')
    const rowIndex = row ? parseInt(row.dataset.rowIndex, 10) : -1
    updateHoverHighlights(
      Number.isNaN(rowIndex) ? -1 : rowIndex,
      offset % BYTES_PER_ROW
    )
  })

  hexContainer.addEventListener('pointerleave', () => {
    updateHoverHighlights(-1, -1)
  })

  scrollbarTrack.addEventListener('pointerdown', (e) => {
    if (e.target === scrollbarThumb || scrollbarTrack.classList.contains('disabled')) {
      return
    }
    e.preventDefault()
    const thumbHeight = scrollbarThumb.getBoundingClientRect().height
    startScrollbarDrag(e.clientY, thumbHeight / 2)
  })

  scrollbarThumb.addEventListener('pointerdown', (e) => {
    if (scrollbarTrack.classList.contains('disabled')) {
      return
    }
    e.preventDefault()
    const thumbRect = scrollbarThumb.getBoundingClientRect()
    startScrollbarDrag(e.clientY, clamp(0, e.clientY - thumbRect.top, thumbRect.height))
  })

  window.addEventListener('pointermove', (e) => {
    if (!isDraggingScrollbar) {
      return
    }
    if (e.buttons === 0) {
      stopScrollbarDrag()
      return
    }
    e.preventDefault()
    scrollFromTrackPosition(e.clientY, scrollbarDragOffsetY)
  })

  window.addEventListener('pointerup', () => {
    if (isDraggingScrollbar) {
      stopScrollbarDrag()
    }
  })

  window.addEventListener('pointercancel', () => {
    if (isDraggingScrollbar) {
      stopScrollbarDrag()
    }
  })
  window.addEventListener('resize', updateScrollbar)
  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => {
      measuredRowHeight = 0
      reportViewportMetrics()
      render()
    })
    resizeObserver.observe(hexContainer)
  }

  // ── Keyboard Shortcuts ──────────────────────────────

  document.addEventListener('keydown', (e) => {
    if (isEditableTarget(e.target)) {
      return
    }

    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault()
      if (!undoBtn.disabled) {
        vscode.postMessage({ type: 'undo' })
      }
    } else if (e.ctrlKey && e.key === 'y') {
      e.preventDefault()
      if (!redoBtn.disabled) {
        vscode.postMessage({ type: 'redo' })
      }
    } else if (e.ctrlKey && e.key === 's') {
      e.preventDefault()
      if (e.shiftKey) {
        vscode.postMessage({ type: 'saveAs' })
      } else if (!saveBtn.disabled) {
        vscode.postMessage({ type: 'save' })
      }
    } else if (e.ctrlKey && e.key === 'f') {
      e.preventDefault()
      searchInput.focus()
    } else if (e.ctrlKey && e.key === 'g') {
      e.preventDefault()
      // Go to offset — trigger via VS Code command instead
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moveSelection('left')
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      moveSelection('right')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveSelection('up')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveSelection('down')
    } else if (e.key === 'Delete') {
      if (selectedOffset >= 0 && fileSize > 0) {
        e.preventDefault()
        vscode.postMessage({ type: 'delete', offset: selectedOffset, length: 1 })
      }
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      scrollToViewportOffset(
        visibleOffset + Math.max(BYTES_PER_ROW, currentVisibleByteCount())
      )
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      scrollToViewportOffset(
        visibleOffset - Math.max(BYTES_PER_ROW, currentVisibleByteCount())
      )
    } else if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault()
      scrollToViewportOffset(0)
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault()
      scrollToViewportOffset(Math.max(0, fileSize - BYTES_PER_ROW))
    }
  })

  // ── Search ──────────────────────────────────────────

  function doSearch() {
    const query = searchInput.value.trim()
    if (!query) {
      clearSearchResults()
      return
    }
    const isHex = searchHex.checked
    const normalizedQuery = isHex ? normalizedHexQuery(query) : query
    if (normalizedQuery === null) {
      clearSearchResults('Invalid hex')
      return
    }
    searchPatternLength = isHex ? normalizedQuery.length / 2 : query.length
    vscode.postMessage({
      type: 'search',
      query: normalizedQuery,
      isHex: isHex,
      caseInsensitive: !isHex && searchCase.checked,
      isReverse: searchDirectionSelect.value === 'reverse',
    })
  }

  function replaceCurrentMatch() {
    if (searchMatches.length === 0 || searchMatchIndex < 0 || searchPatternLength <= 0) {
      return
    }
    const replacementHex = getReplacementHex()
    if (replacementHex === null) {
      matchNav.textContent = 'Invalid replacement hex'
      return
    }
    vscode.postMessage({
      type: 'replace',
      offset: searchMatches[searchMatchIndex],
      length: searchPatternLength,
      data: replacementHex,
    })
  }

  function replaceAllMatches() {
    if (searchMatches.length === 0 || searchPatternLength <= 0) {
      return
    }
    const replacementHex = getReplacementHex()
    if (replacementHex === null) {
      matchNav.textContent = 'Invalid replacement hex'
      return
    }
    vscode.postMessage({
      type: 'replaceAllMatches',
      offsets: searchMatches.slice(),
      length: searchPatternLength,
      data: replacementHex,
    })
  }

  searchBtn.addEventListener('click', doSearch)
  replaceBtn.addEventListener('click', replaceCurrentMatch)
  replaceAllBtn.addEventListener('click', replaceAllMatches)
  bytesPerRowSelect.addEventListener('change', () => {
    const nextBytesPerRow = parseInt(bytesPerRowSelect.value, 10)
    if ([8, 16, 32].includes(nextBytesPerRow)) {
      vscode.postMessage({
        type: 'setBytesPerRow',
        bytesPerRow: nextBytesPerRow,
      })
    }
  })
  offsetRadixSelect.addEventListener('change', () => {
    offsetRadix = offsetRadixSelect.value === 'dec' ? 'dec' : 'hex'
    render()
  })
  searchHex.addEventListener('change', syncSearchMode)
  searchInput.addEventListener('input', () => {
    updateSearchButtons()
  })
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !searchBtn.disabled) doSearch()
  })
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') replaceCurrentMatch()
  })
  inspectorEndianBtn.addEventListener('click', () => {
    inspectorLittleEndian = !inspectorLittleEndian
    updateInspectorEndianLabel()
    updateInspectorStatus()
  })

  nextMatchBtn.addEventListener('click', () => {
    if (searchMatches.length === 0) return
    searchMatchIndex = (searchMatchIndex + 1) % searchMatches.length
    selectedOffset = searchMatches[searchMatchIndex]
    updateSelectedStatus()
    updateMatchNav()
    render()
    vscode.postMessage({ type: 'goToMatch', offset: searchMatches[searchMatchIndex] })
  })

  prevMatchBtn.addEventListener('click', () => {
    if (searchMatches.length === 0) return
    searchMatchIndex = (searchMatchIndex - 1 + searchMatches.length) % searchMatches.length
    selectedOffset = searchMatches[searchMatchIndex]
    updateSelectedStatus()
    updateMatchNav()
    render()
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
  topBtn.addEventListener('click', () => {
    scrollToViewportOffset(0)
  })
  bottomBtn.addEventListener('click', () => {
    scrollToViewportOffset(Math.max(0, fileSize - BYTES_PER_ROW))
  })
  document.getElementById('editCancel').addEventListener('click', closeEditDialog)
  document.getElementById('editOk').addEventListener('click', submitEdit)
  overlay.addEventListener('click', closeEditDialog)

  // Submit on Enter inside the edit dialog
  editData.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEdit() })
  editLength.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEdit() })
  editOffset.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEdit() })

  // ── Undo / Redo / Save Buttons ──────────────────────

  undoBtn.addEventListener('click', () => {
    if (!undoBtn.disabled) {
      vscode.postMessage({ type: 'undo' })
    }
  })
  redoBtn.addEventListener('click', () => {
    if (!redoBtn.disabled) {
      vscode.postMessage({ type: 'redo' })
    }
  })
  saveBtn.addEventListener('click', () => {
    if (!saveBtn.disabled) {
      vscode.postMessage({ type: 'save' })
    }
  })
  saveAsBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'saveAs' })
  })

  updateSearchButtons()
  updateEditButtons(false, false)
  syncSearchMode()
  updateDirtyStatus(false)
  updateActionStatus('')
  updateInspectorEndianLabel()
  updateInspectorStatus()
  updateServerHealthStatus(null)
  updateOffsetStatus()
  updateSelectedStatus()
  updateProgressStatus()
  renderColumnHeader()
  reportViewportMetrics()
})()
</script>
</body>
</html>`
}
