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
    --scrollbar-slider-bg: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
    --scrollbar-slider-hover: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7));
    --scrollbar-slider-active: var(--vscode-scrollbarSlider-activeBackground, rgba(191, 191, 191, 0.4));
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
    width: 14px;
    padding: 2px 2px 2px 0;
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
    background: transparent;
    border-radius: 999px;
    overflow: hidden;
  }
  .scrollbar-track.disabled {
    opacity: 0.45;
  }
  .scrollbar-thumb {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 24px;
    background: var(--scrollbar-slider-bg);
    border-radius: 999px;
    cursor: pointer;
    touch-action: none;
    transition: background 120ms ease;
  }
  .scrollbar-thumb:hover {
    background: var(--scrollbar-slider-hover);
  }
  .scrollbar.dragging .scrollbar-thumb,
  .scrollbar-thumb.dragging {
    background: var(--scrollbar-slider-active);
  }
  .interaction-blocker {
    position: fixed;
    inset: 0;
    z-index: 1000;
    cursor: ns-resize;
    background: transparent;
  }

  /* ── Analysis Pane ─────────────────────────────────── */
  .analysis-pane {
    width: clamp(260px, 28vw, 360px);
    flex: 0 0 clamp(260px, 28vw, 360px);
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
    background: color-mix(in srgb, var(--toolbar-bg) 74%, var(--bg) 26%);
    min-height: 0;
  }
  .analysis-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .analysis-title {
    font-size: 11px;
    color: var(--offset-fg);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .analysis-tabs {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .analysis-tab {
    background: transparent;
    color: var(--offset-fg);
    border: 0;
    border-radius: 0;
    padding: 3px 8px;
  }
  .analysis-tab.active {
    background: var(--button-bg);
    color: var(--button-fg);
  }
  .analysis-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 10px;
  }
  .analysis-panel {
    display: none;
  }
  .analysis-panel.active {
    display: block;
  }
  .analysis-section + .analysis-section {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .analysis-section-title {
    color: var(--fg);
    font-size: 12px;
    margin-bottom: 8px;
  }
  .analysis-metrics {
    display: grid;
    grid-template-columns: minmax(86px, auto) minmax(0, 1fr);
    gap: 6px 12px;
  }
  .analysis-label {
    color: var(--offset-fg);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .analysis-value {
    color: var(--fg);
    text-align: right;
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .analysis-bars {
    display: grid;
    gap: 7px;
  }
  .analysis-bar-row {
    display: grid;
    grid-template-columns: 78px minmax(56px, 1fr) 52px;
    gap: 8px;
    align-items: center;
  }
  .analysis-bar-track {
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--offset-fg) 18%, transparent);
    overflow: hidden;
  }
  .analysis-bar-fill {
    display: block;
    width: 0;
    height: 100%;
    min-width: 1px;
    border-radius: 999px;
    background: var(--offset-column-fg);
  }
  .analysis-bar-fill.control {
    background: var(--vscode-terminal-ansiBlue, #569cd6);
  }
  .analysis-bar-fill.printable {
    background: var(--ascii-fg);
  }
  .analysis-bar-fill.high-bit {
    background: var(--vscode-terminal-ansiMagenta, #c586c0);
  }
  .analysis-section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .analysis-section-heading .analysis-section-title {
    margin-bottom: 0;
  }
  .analysis-mini-button {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 2px 7px;
    font-size: 10px;
    line-height: 1.2;
  }
  .analysis-mini-button:hover {
    background: var(--input-bg);
  }
  .frequency-chart {
    position: relative;
    display: grid;
    grid-template-columns: repeat(256, minmax(0, 1fr));
    align-items: end;
    gap: 0;
    height: 150px;
    padding: 8px 4px 18px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--offset-fg) 14%, transparent) 0 12.5%,
        color-mix(in srgb, var(--ascii-fg) 16%, transparent) 12.5% 49.6%,
        color-mix(in srgb, var(--offset-fg) 14%, transparent) 49.6% 50%,
        transparent 50% 100%
      ),
      color-mix(in srgb, var(--bg) 72%, var(--toolbar-bg) 28%);
    overflow: hidden;
  }
  .frequency-chart::before,
  .frequency-chart::after {
    position: absolute;
    bottom: 3px;
    color: var(--offset-fg);
    font-size: 9px;
    pointer-events: none;
  }
  .frequency-chart::before {
    content: '00';
    left: 4px;
  }
  .frequency-chart::after {
    content: 'FF';
    right: 4px;
  }
  .frequency-bar {
    width: 100%;
    min-width: 0;
    height: var(--bar-height, 1px);
    border-radius: 1px 1px 0 0;
    background: var(--offset-column-fg);
    opacity: 0.86;
  }
  .frequency-bar.zero {
    height: 1px;
    opacity: 0.18;
  }
  .frequency-bar.control {
    background: var(--vscode-terminal-ansiBlue, #569cd6);
  }
  .frequency-bar.printable {
    background: var(--ascii-fg);
  }
  .frequency-bar.high-bit {
    background: var(--vscode-terminal-ansiMagenta, #c586c0);
  }
  .frequency-bar.hovered {
    opacity: 1;
    filter: brightness(1.4);
    outline: 1px solid rgba(255, 255, 255, 0.3);
    outline-offset: 0;
  }
  .frequency-tooltip {
    position: absolute;
    left: 0;
    top: 0;
    display: none;
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--toolbar-bg);
    color: var(--fg);
    font-size: 10px;
    line-height: 1.35;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
    pointer-events: none;
    z-index: 4;
    white-space: nowrap;
  }
  .frequency-tooltip.active {
    display: block;
  }
  .analysis-note {
    color: var(--offset-fg);
    font-size: 11px;
    line-height: 1.45;
  }

  @media (max-width: 900px) {
    .analysis-pane {
      display: none;
    }
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
    position: relative;
    cursor: help;
    color: var(--fg);
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
  .server-health-dot.warn {
    background: var(--vscode-testing-iconQueued, #cca700);
  }
  .server-health-dot.error {
    background: var(--vscode-testing-iconFailed, #f14c4c);
  }
  .server-health-dot.down {
    background: var(--vscode-descriptionForeground, #888);
  }
  .server-health-summary {
    color: var(--offset-fg);
  }
  .server-health-tooltip {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    display: none;
    min-width: 260px;
    max-width: 360px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02)),
      var(--toolbar-bg);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.25);
    z-index: 30;
    white-space: normal;
  }
  .server-health:hover .server-health-tooltip,
  .server-health:focus-within .server-health-tooltip {
    display: block;
  }
  .server-health-tooltip::after {
    content: '';
    position: absolute;
    right: 10px;
    top: 100%;
    border-width: 6px;
    border-style: solid;
    border-color: var(--toolbar-bg) transparent transparent transparent;
  }
  .server-health-tooltip-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .server-health-tooltip-title {
    color: var(--fg);
    font-size: 12px;
  }
  .server-health-badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid transparent;
  }
  .server-health-badge.ok {
    color: var(--vscode-testing-iconPassed, #73c991);
    background: color-mix(in srgb, var(--vscode-testing-iconPassed, #73c991) 16%, transparent);
    border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #73c991) 30%, transparent);
  }
  .server-health-badge.warn {
    color: var(--vscode-testing-iconQueued, #cca700);
    background: color-mix(in srgb, var(--vscode-testing-iconQueued, #cca700) 16%, transparent);
    border-color: color-mix(in srgb, var(--vscode-testing-iconQueued, #cca700) 30%, transparent);
  }
  .server-health-badge.error {
    color: var(--vscode-testing-iconFailed, #f14c4c);
    background: color-mix(in srgb, var(--vscode-testing-iconFailed, #f14c4c) 16%, transparent);
    border-color: color-mix(in srgb, var(--vscode-testing-iconFailed, #f14c4c) 30%, transparent);
  }
  .server-health-badge.down {
    color: var(--offset-fg);
    background: color-mix(in srgb, var(--offset-fg) 12%, transparent);
    border-color: color-mix(in srgb, var(--offset-fg) 24%, transparent);
  }
  .server-health-metrics {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 12px;
  }
  .server-health-metric-label {
    color: var(--offset-fg);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10px;
  }
  .server-health-metric-value {
    color: var(--fg);
    text-align: right;
    font-size: 11px;
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
  <aside class="analysis-pane" id="analysisPane">
    <div class="analysis-header">
      <span class="analysis-title">Analysis</span>
      <span class="analysis-tabs" role="tablist" aria-label="Analysis views">
        <button class="analysis-tab active" id="profileTab" role="tab" aria-selected="true">Profile</button>
        <button class="analysis-tab" id="structureTab" role="tab" aria-selected="false">Structure</button>
      </span>
    </div>
    <div class="analysis-body">
      <section class="analysis-panel active" id="profilePanel" role="tabpanel" aria-labelledby="profileTab">
        <div class="analysis-section">
          <div class="analysis-section-title">Viewport</div>
          <div class="analysis-metrics" id="profileViewportMetrics"></div>
        </div>
        <div class="analysis-section">
          <div class="analysis-section-title">Timing</div>
          <div class="analysis-metrics" id="profileTimingMetrics"></div>
        </div>
        <div class="analysis-section">
          <div class="analysis-section-title">Data Profile</div>
          <div class="analysis-metrics" id="profileDataMetrics"></div>
        </div>
        <div class="analysis-section">
          <div class="analysis-section-heading">
            <div class="analysis-section-title">Frequency</div>
            <button class="analysis-mini-button" id="profileScaleBtn" title="Toggle frequency scale">Linear</button>
          </div>
          <div class="frequency-chart" id="profileFrequencyChart"></div>
          <div class="analysis-note" id="profileLimitNote"></div>
          <div class="analysis-bars" id="profileByteBars"></div>
        </div>
      </section>
      <section class="analysis-panel" id="structurePanel" role="tabpanel" aria-labelledby="structureTab">
        <div class="analysis-section">
          <div class="analysis-section-title" id="structureScopeTitle">Visible Bytes</div>
          <div class="analysis-metrics" id="structureMetrics"></div>
        </div>
        <div class="analysis-section">
          <div class="analysis-section-title">Byte Classes</div>
          <div class="analysis-bars" id="structureClassBars"></div>
        </div>
        <div class="analysis-section">
          <div class="analysis-section-title">Top Bytes</div>
          <div class="analysis-bars" id="structureTopBytes"></div>
        </div>
      </section>
    </div>
  </aside>
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
  <span class="server-health" id="serverHealth" tabindex="0" aria-label="Server health">
    <span class="server-health-dot" id="serverHealthDot"></span>
    <span class="server-health-summary" id="serverHealthSummary">Ωedit™ pending</span>
    <span class="server-health-tooltip" id="serverHealthTooltip" role="tooltip">
      <span class="server-health-tooltip-header">
        <span class="server-health-tooltip-title">Ωedit™ Server</span>
        <span class="server-health-badge down" id="serverHealthBadge">Pending</span>
      </span>
      <span class="server-health-metrics" id="serverHealthMetrics"></span>
    </span>
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
  const INTERNAL_HEX_CLIPBOARD_FORMAT = 'application/x-omega-edit-hex'
  const MIN_SCROLLBAR_THUMB_HEIGHT = 20
  const MAX_PROFILE_BYTES = 64 * 1024

  // ── State ───────────────────────────────────────────
  let bufferOffset = 0
  let visibleOffset = 0
  let pendingVisibleOffset = 0
  let viewportData = []      // number[]
  let viewportLength = 0
  let fileSize = 0
  let selectedOffset = -1    // absolute byte offset of the active selection focus
  let selectionAnchor = -1   // absolute byte offset where the current range began
  let searchMode = 'none'
  let searchMatches = []     // number[] of match offsets
  let searchCurrentOffset = -1
  let searchWindowLimit = 1000
  let matchedByteOffsets = new Set()
  let searchMatchIndex = -1
  let searchPatternLength = 0
  let isDraggingScrollbar = false
  let isPointerSelecting = false
  let scrollbarDragOffsetY = 0
  let accumulatedWheelPixels = 0
  let scrollbarInteractionBlocker = null
  let measuredRowHeight = 0
  let offsetRadix = 'hex'
  let offsetWidthMeasurer = null
  let inspectorLittleEndian = true
  let activePane = 'hex'
  let hoveredColumn = -1
  let hoveredRowIndex = -1
  let replaceSummaryActive = false
  let analysisMode = 'profile'
  let hoveredFrequencyBar = null
  let viewportSequence = 0
  let lastRenderDurationMs = 0
  let lastRenderAt = 0
  let lastViewportMessageAt = 0
  let latestProfile = null
  let latestDataProfile = null
  let pendingAnalysisProfileKey = ''
  let analysisProfileRequestTimer = null
  let frequencyScale = 'linear'
  const renderSamples = []

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
  const serverHealthSummary = document.getElementById('serverHealthSummary')
  const serverHealthBadge = document.getElementById('serverHealthBadge')
  const serverHealthMetrics = document.getElementById('serverHealthMetrics')
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
  const profileTab = document.getElementById('profileTab')
  const structureTab = document.getElementById('structureTab')
  const profilePanel = document.getElementById('profilePanel')
  const structurePanel = document.getElementById('structurePanel')
  const profileViewportMetrics = document.getElementById('profileViewportMetrics')
  const profileTimingMetrics = document.getElementById('profileTimingMetrics')
  const profileDataMetrics = document.getElementById('profileDataMetrics')
  const profileScaleBtn = document.getElementById('profileScaleBtn')
  const profileFrequencyChart = document.getElementById('profileFrequencyChart')
  const profileLimitNote = document.getElementById('profileLimitNote')
  const profileByteBars = document.getElementById('profileByteBars')
  const structureScopeTitle = document.getElementById('structureScopeTitle')
  const structureMetrics = document.getElementById('structureMetrics')
  const structureClassBars = document.getElementById('structureClassBars')
  const structureTopBytes = document.getElementById('structureTopBytes')

  function clamp(min, value, max) {
    return Math.max(min, Math.min(value, max))
  }

  function formatByteSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B'
    }
    if (bytes < 1024) {
      return bytes.toLocaleString() + ' B'
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KiB'
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MiB'
  }

  function formatDuration(ms) {
    return typeof ms === 'number' && Number.isFinite(ms)
      ? ms.toFixed(ms < 10 ? 2 : 1) + ' ms'
      : '-'
  }

  function formatPercent(value) {
    return typeof value === 'number' && Number.isFinite(value)
      ? value.toFixed(1) + '%'
      : '-'
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

  function renderMetricRows(target, rows) {
    target.innerHTML = rows
      .map((row) =>
        '<span class="analysis-label">' + escapeHtml(row.label) + '</span>' +
        '<span class="analysis-value">' + escapeHtml(String(row.value)) + '</span>'
      )
      .join('')
  }

  function renderBarRows(target, rows) {
    if (rows.length === 0) {
      target.innerHTML = '<div class="analysis-note">No bytes in scope.</div>'
      return
    }

    target.innerHTML = rows
      .map((row) =>
        '<div class="analysis-bar-row">' +
          '<span class="analysis-label">' + escapeHtml(row.label) + '</span>' +
          '<span class="analysis-bar-track">' +
            '<span class="analysis-bar-fill' + (row.colorClass ? ' ' + row.colorClass : '') + '" style="width: ' +
              clamp(0, row.percent, 100).toFixed(1) +
              '%"></span>' +
          '</span>' +
          '<span class="analysis-value">' + escapeHtml(row.value) + '</span>' +
        '</div>'
      )
      .join('')
  }

  function frequencyBarClass(byte, count) {
    if (count === 0) {
      return ' zero'
    }
    if (byte < 0x20 || byte === 0x7f) {
      return ' control'
    }
    if (byte >= 0x20 && byte <= 0x7e) {
      return ' printable'
    }
    return ' high-bit'
  }

  function renderFrequencyChart(profile, total) {
    const counts = profile.slice(0, 256)
    const maxCount = Math.max(0, ...counts)
    if (total <= 0 || maxCount <= 0) {
      profileFrequencyChart.innerHTML =
        '<div class="analysis-note">No profile data in scope.</div>' +
        '<div class="frequency-tooltip" id="profileFrequencyTooltip"></div>'
      return
    }

    const maxLog = Math.log2(maxCount + 1)
    profileFrequencyChart.innerHTML = counts
      .map((count, byte) => {
        const ratio = frequencyScale === 'log'
          ? Math.log2(count + 1) / Math.max(1, maxLog)
          : count / maxCount
        const percent = count === 0 ? 0 : clamp(2, ratio * 100, 100)
        return '<span class="frequency-bar' +
          frequencyBarClass(byte, count) +
          '" style="--bar-height: ' +
          percent.toFixed(1) +
          '%" data-byte="' +
          byte +
          '" data-count="' +
          count +
          '" data-percent="' +
          formatPercent((count / total) * 100) +
          '"></span>'
      })
      .join('') +
      '<div class="frequency-tooltip" id="profileFrequencyTooltip"></div>'
  }

  function findFrequencyBarAtEvent(event) {
    const chartRect = profileFrequencyChart.getBoundingClientRect()
    const paddingLeft = 4
    const innerWidth = chartRect.width - 8
    if (innerWidth <= 0) return null
    const x = event.clientX - chartRect.left - paddingLeft
    const index = clamp(0, Math.floor((x / innerWidth) * 256), 255)
    const bar = profileFrequencyChart.children[index]
    return bar && bar.classList.contains('frequency-bar') ? bar : null
  }

  function updateFrequencyTooltip(event) {
    const tooltip = document.getElementById('profileFrequencyTooltip')
    if (!tooltip) {
      hideFrequencyTooltip()
      return
    }

    const target = findFrequencyBarAtEvent(event)

    if (hoveredFrequencyBar !== target) {
      if (hoveredFrequencyBar) hoveredFrequencyBar.classList.remove('hovered')
      hoveredFrequencyBar = target
      if (hoveredFrequencyBar) hoveredFrequencyBar.classList.add('hovered')
    }

    if (!target) {
      tooltip.classList.remove('active')
      return
    }

    const byte = parseInt(target.dataset.byte, 10)
    const count = parseInt(target.dataset.count, 10)
    const percent = target.dataset.percent || '0.0%'
    if (Number.isNaN(byte) || Number.isNaN(count)) {
      tooltip.classList.remove('active')
      return
    }

    const printable = isPrintable(byte)
      ? " | '" + escapeHtml(String.fromCharCode(byte)) + "'"
      : ''
    tooltip.innerHTML =
      'Byte 0x' +
      toHex2(byte) +
      ' (' +
      byte.toLocaleString() +
      ')' +
      printable +
      '<br>Count ' +
      count.toLocaleString() +
      ' | ' +
      escapeHtml(percent)

    tooltip.classList.add('active')
    const chartRect = profileFrequencyChart.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const x = clamp(
      4,
      event.clientX - chartRect.left + 10,
      Math.max(4, chartRect.width - tooltipRect.width - 4)
    )
    const y = clamp(
      4,
      event.clientY - chartRect.top - tooltipRect.height - 10,
      Math.max(4, chartRect.height - tooltipRect.height - 4)
    )
    tooltip.style.transform = 'translate(' + x + 'px, ' + y + 'px)'
  }

  function hideFrequencyTooltip() {
    const tooltip = document.getElementById('profileFrequencyTooltip')
    if (tooltip) {
      tooltip.classList.remove('active')
    }
    if (hoveredFrequencyBar) {
      hoveredFrequencyBar.classList.remove('hovered')
      hoveredFrequencyBar = null
    }
  }

  function updateAnalysisTabs() {
    const profileActive = analysisMode === 'profile'
    profileTab.classList.toggle('active', profileActive)
    structureTab.classList.toggle('active', !profileActive)
    profileTab.setAttribute('aria-selected', profileActive ? 'true' : 'false')
    structureTab.setAttribute('aria-selected', profileActive ? 'false' : 'true')
    profilePanel.classList.toggle('active', profileActive)
    structurePanel.classList.toggle('active', !profileActive)
  }

  function setAnalysisMode(mode) {
    analysisMode = mode === 'structure' ? 'structure' : 'profile'
    updateAnalysisTabs()
    updateAnalysisPanels()
    if (analysisMode === 'profile') {
      requestAnalysisProfile(true)
    } else if (analysisProfileRequestTimer) {
      clearTimeout(analysisProfileRequestTimer)
      analysisProfileRequestTimer = null
    }
  }

  function pushRenderSample(durationMs) {
    renderSamples.push(durationMs)
    if (renderSamples.length > 20) {
      renderSamples.shift()
    }
  }

  function averageRenderDuration() {
    if (renderSamples.length === 0) {
      return null
    }
    return renderSamples.reduce((sum, value) => sum + value, 0) / renderSamples.length
  }

  function byteClass(byte) {
    if (byte === 0x00) {
      return 'Null'
    }
    if (byte === 0xff) {
      return 'FF'
    }
    if (byte >= 0x20 && byte <= 0x7e) {
      return 'Printable'
    }
    if (byte < 0x20 || byte === 0x7f) {
      return 'Control'
    }
    return 'High-bit'
  }

  function analyzeBytes(bytes) {
    const counts = new Array(256).fill(0)
    const classes = {
      Printable: 0,
      Control: 0,
      'High-bit': 0,
      Null: 0,
      FF: 0,
    }
    let longestRunByte = null
    let longestRunLength = 0
    let currentRunByte = null
    let currentRunLength = 0

    for (const byte of bytes) {
      counts[byte] += 1
      classes[byteClass(byte)] += 1

      if (byte === currentRunByte) {
        currentRunLength += 1
      } else {
        currentRunByte = byte
        currentRunLength = 1
      }

      if (currentRunLength > longestRunLength) {
        longestRunLength = currentRunLength
        longestRunByte = byte
      }
    }

    let entropy = 0
    for (const count of counts) {
      if (count === 0) {
        continue
      }
      const probability = count / Math.max(1, bytes.length)
      entropy -= probability * Math.log2(probability)
    }

    const topBytes = counts
      .map((count, byte) => ({ byte, count }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.byte - b.byte)
      .slice(0, 5)

    return {
      count: bytes.length,
      unique: counts.filter((count) => count > 0).length,
      entropy,
      classes,
      longestRunByte,
      longestRunLength,
      topBytes,
    }
  }

  function getVisibleBytes() {
    const startIndex = Math.max(0, visibleOffset - bufferOffset)
    return viewportData.slice(
      startIndex,
      Math.min(startIndex + currentVisibleByteCount(), viewportLength)
    )
  }

  function getAnalysisProfileScope() {
    if (hasSelection() && getSelectionLength() > 1) {
      const selectedLength = getSelectionLength()
      return {
        label: 'Selection',
        offset: getSelectionStart(),
        length: Math.min(selectedLength, MAX_PROFILE_BYTES),
        requestedLength: selectedLength,
        isCapped: selectedLength > MAX_PROFILE_BYTES,
      }
    }

    const visibleLength = currentVisibleByteCount()
    return {
      label: 'Visible',
      offset: visibleOffset,
      length: Math.min(visibleLength, MAX_PROFILE_BYTES),
      requestedLength: visibleLength,
      isCapped: visibleLength > MAX_PROFILE_BYTES,
    }
  }

  function requestAnalysisProfile(force = false) {
    if (analysisMode !== 'profile') {
      return
    }

    const scope = getAnalysisProfileScope()
    if (scope.length <= 0 || fileSize <= 0) {
      return
    }

    const key =
      scope.offset +
      ':' +
      scope.length +
      ':' +
      fileSize +
      ':' +
      (latestProfile?.changeCount ?? 0)
    if (!force && key === pendingAnalysisProfileKey) {
      return
    }

    pendingAnalysisProfileKey = key
    const payload = {
      type: 'requestAnalysisProfile',
      offset: scope.offset,
      length: scope.length,
      requestKey: key,
      scopeLabel: scope.label,
      requestedLength: scope.requestedLength,
      isCapped: scope.isCapped,
    }

    if (analysisProfileRequestTimer) {
      clearTimeout(analysisProfileRequestTimer)
      analysisProfileRequestTimer = null
    }

    if (force) {
      vscode.postMessage(payload)
      return
    }

    analysisProfileRequestTimer = setTimeout(() => {
      analysisProfileRequestTimer = null
      vscode.postMessage(payload)
    }, 120)
  }

  function updateProfileAnalysis() {
    const averageRenderMs = averageRenderDuration()
    const profile = latestProfile ?? {}
    const visibleByteCount = currentVisibleByteCount()
    const bufferCoverage = fileSize > 0
      ? (viewportLength / fileSize) * 100
      : 0
    const visibleCoverage = fileSize > 0
      ? (visibleByteCount / fileSize) * 100
      : 0
    const hostToWebviewMs = typeof profile.hostToWebviewMs === 'number'
      ? profile.hostToWebviewMs
      : null

    renderMetricRows(profileViewportMetrics, [
      { label: 'Sequence', value: viewportSequence || '-' },
      { label: 'Offset', value: formatOffsetDisplay(visibleOffset) },
      { label: 'Buffered', value: formatByteSize(viewportLength) },
      { label: 'Visible', value: formatByteSize(visibleByteCount) },
      { label: 'Rows', value: visibleRows().toLocaleString() },
      { label: 'Capacity', value: formatByteSize(profile.capacity ?? 0) },
      {
        label: 'Coverage',
        value: formatPercent(bufferCoverage) + ' buffer / ' + formatPercent(visibleCoverage) + ' visible',
      },
      { label: 'Following', value: formatByteSize(profile.followingByteCount ?? 0) },
      { label: 'Changes', value: (profile.changeCount ?? 0).toLocaleString() },
      { label: 'Sync', value: profile.sessionSyncVersion ?? '-' },
    ])

    renderMetricRows(profileTimingMetrics, [
      { label: 'Fetch', value: formatDuration(profile.fetchDurationMs) },
      { label: 'Bridge', value: formatDuration(hostToWebviewMs) },
      { label: 'Render', value: formatDuration(lastRenderDurationMs) },
      { label: 'Avg Render', value: averageRenderMs === null ? '-' : formatDuration(averageRenderMs) },
      { label: 'Updated', value: lastRenderAt ? new Date(lastRenderAt).toLocaleTimeString() : '-' },
      { label: 'Message', value: lastViewportMessageAt ? new Date(lastViewportMessageAt).toLocaleTimeString() : '-' },
    ])

    if (!latestDataProfile) {
      renderMetricRows(profileDataMetrics, [
        { label: 'Scope', value: '-' },
        { label: 'Bytes', value: '-' },
        { label: 'ASCII', value: '-' },
        { label: 'Content', value: '-' },
        { label: 'Language', value: '-' },
        { label: 'BOM', value: '-' },
      ])
      profileLimitNote.textContent = ''
      profileFrequencyChart.innerHTML =
        '<div class="analysis-note">No profile data in scope.</div>'
      renderBarRows(profileByteBars, [])
      return
    }

    const byteTotal = latestDataProfile.byteProfile
      .slice(0, 256)
      .reduce((sum, value) => sum + value, 0)
    const asciiPercent = byteTotal > 0
      ? (latestDataProfile.numAscii / byteTotal) * 100
      : 0
    const characterCount = latestDataProfile.characterCount ?? {}
    const topProfileBytes = latestDataProfile.byteProfile
      .slice(0, 256)
      .map((count, byte) => ({ byte, count }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.byte - b.byte)
      .slice(0, 5)
    const topProfileMaxCount = Math.max(
      1,
      ...topProfileBytes.map((entry) => entry.count)
    )

    renderMetricRows(profileDataMetrics, [
      { label: 'Scope', value: latestDataProfile.scopeLabel },
      { label: 'Bytes', value: byteTotal.toLocaleString() },
      { label: 'ASCII', value: latestDataProfile.numAscii.toLocaleString() + ' / ' + formatPercent(asciiPercent) },
      { label: 'Content', value: latestDataProfile.contentType || '-' },
      { label: 'Language', value: latestDataProfile.language || '-' },
      { label: 'BOM', value: characterCount.byteOrderMark || '-' },
      { label: 'Invalid', value: (characterCount.invalidBytes ?? 0).toLocaleString() },
      { label: 'Profile', value: formatDuration(latestDataProfile.durationMs) },
    ])

    profileLimitNote.textContent = latestDataProfile.isCapped
      ? 'Profile capped at ' +
        formatByteSize(latestDataProfile.length) +
        ' of ' +
        formatByteSize(latestDataProfile.requestedLength) +
        '.'
      : ''
    profileScaleBtn.textContent = frequencyScale === 'log' ? 'Log' : 'Linear'
    profileScaleBtn.title = frequencyScale === 'log'
      ? 'Switch frequency chart to linear scale'
      : 'Switch frequency chart to log scale'
    renderFrequencyChart(latestDataProfile.byteProfile, byteTotal)

    renderBarRows(
      profileByteBars,
      topProfileBytes.map((entry) => ({
        label: '0x' + toHex2(entry.byte),
        percent: (entry.count / topProfileMaxCount) * 100,
        value:
          entry.count.toLocaleString() +
          ' | ' +
          formatPercent(byteTotal > 0 ? (entry.count / byteTotal) * 100 : 0),
        colorClass: frequencyBarClass(entry.byte, entry.count).trim(),
      }))
    )
  }

  function updateStructureAnalysis() {
    const selectedBytes = getSelectedBytes()
    const bytes = selectedBytes && selectedBytes.length > 1
      ? selectedBytes
      : getVisibleBytes()
    const scopeLabel = selectedBytes && selectedBytes.length > 1
      ? 'Selection'
      : 'Visible Bytes'
    const analysis = analyzeBytes(bytes)
    const printablePercent = analysis.count > 0
      ? (analysis.classes.Printable / analysis.count) * 100
      : 0
    const density = analysis.count > 0
      ? (analysis.unique / 256) * 100
      : 0

    structureScopeTitle.textContent = scopeLabel
    renderMetricRows(structureMetrics, [
      { label: 'Bytes', value: analysis.count.toLocaleString() },
      { label: 'Unique', value: analysis.unique.toLocaleString() + ' / 256' },
      { label: 'Density', value: formatPercent(density) },
      { label: 'Entropy', value: analysis.count === 0 ? '-' : analysis.entropy.toFixed(2) + ' bits' },
      { label: 'Printable', value: formatPercent(printablePercent) },
      {
        label: 'Longest Run',
        value: analysis.longestRunByte === null
          ? '-'
          : '0x' + toHex2(analysis.longestRunByte) + ' x ' + analysis.longestRunLength.toLocaleString(),
      },
    ])

    renderBarRows(
      structureClassBars,
      Object.entries(analysis.classes).map(([label, count]) => ({
        label,
        percent: analysis.count > 0 ? (count / analysis.count) * 100 : 0,
        value: count.toLocaleString(),
      }))
    )

    renderBarRows(
      structureTopBytes,
      analysis.topBytes.map((entry) => ({
        label: '0x' + toHex2(entry.byte),
        percent: analysis.count > 0 ? (entry.count / analysis.count) * 100 : 0,
        value: entry.count.toLocaleString(),
        colorClass: frequencyBarClass(entry.byte, entry.count).trim(),
      }))
    )
  }

  function updateAnalysisPanels() {
    if (analysisMode === 'profile') {
      updateProfileAnalysis()
    } else {
      updateStructureAnalysis()
    }
  }

  function clearSearchResults(message = '') {
    searchMode = 'none'
    searchMatches = []
    searchCurrentOffset = -1
    searchWindowLimit = 1000
    matchedByteOffsets = new Set()
    searchMatchIndex = -1
    searchPatternLength = 0
    matchNav.textContent = message
    statusMatches.textContent = ''
    updateSearchButtons()
    render()
  }

  function hasSearchResults() {
    return searchMode === 'large'
      ? searchCurrentOffset >= 0
      : searchMatches.length > 0
  }

  function getCurrentSearchOffset() {
    if (searchMode === 'large') {
      return searchCurrentOffset
    }
    if (searchMatches.length === 0 || searchMatchIndex < 0) {
      return -1
    }
    return searchMatches[searchMatchIndex]
  }

  function updateOffsetStatus() {
    statusOffset.textContent = formatOffsetDisplay(visibleOffset)
  }

  function hasSelection() {
    return selectedOffset >= 0 && selectionAnchor >= 0
  }

  function getSelectionStart() {
    return hasSelection() ? Math.min(selectionAnchor, selectedOffset) : -1
  }

  function getSelectionEnd() {
    return hasSelection() ? Math.max(selectionAnchor, selectedOffset) : -1
  }

  function getSelectionLength() {
    return hasSelection() ? getSelectionEnd() - getSelectionStart() + 1 : 0
  }

  function offsetIsSelected(offset) {
    return hasSelection() &&
      offset >= getSelectionStart() &&
      offset <= getSelectionEnd()
  }

  function updateSelectedStatus() {
    if (!hasSelection()) {
      statusSelected.textContent = '-'
      updateInspectorStatus()
      return
    }

    const selectionStart = getSelectionStart()
    const selectionEnd = getSelectionEnd()
    const selectionLength = getSelectionLength()

    statusSelected.textContent = selectionLength === 1
      ? formatOffsetDisplay(selectionStart)
      : formatOffsetDisplay(selectionStart) +
        ' -> ' +
        formatOffsetDisplay(selectionEnd) +
        ' (' +
        selectionLength.toLocaleString() +
        ' bytes)'
    updateInspectorStatus()
  }

  function updateDirtyStatus(isDirty) {
    statusDirty.textContent = isDirty ? 'Dirty' : 'Saved'
    saveBtn.disabled = !isDirty
  }

  function updateActionStatus(message = '', source = 'generic') {
    statusAction.textContent = message
    replaceSummaryActive = source === 'replace-summary' && message.length > 0
  }

  function clearReplaceSummaryActionStatus() {
    if (replaceSummaryActive) {
      updateActionStatus('')
    }
  }

  function formatServerHealthSeverity(severity) {
    switch (severity) {
      case 'ok':
        return 'Healthy'
      case 'warn':
        return 'Slow'
      case 'error':
        return 'Degraded'
      case 'down':
      default:
        return 'Offline'
    }
  }

  function updateServerHealthStatus(message) {
    const severity = message?.severity ?? 'down'
    const metrics = message?.metrics ?? [
      { label: 'Status', value: 'Waiting for heartbeat...' },
    ]

    serverHealthDot.classList.toggle('ok', severity === 'ok')
    serverHealthDot.classList.toggle('warn', severity === 'warn')
    serverHealthDot.classList.toggle('error', severity === 'error')
    serverHealthDot.classList.toggle('down', severity === 'down')

    serverHealthSummary.textContent = message?.summary ?? 'Ωedit™ pending'
    serverHealthBadge.textContent = formatServerHealthSeverity(severity)
    serverHealthBadge.className = 'server-health-badge ' + severity
    serverHealthMetrics.innerHTML = metrics
      .map((metric) =>
        '<span class="server-health-metric-label">' +
          escapeHtml(metric.label) +
        '</span>' +
        '<span class="server-health-metric-value">' +
          escapeHtml(metric.value) +
        '</span>'
      )
      .join('')
    serverHealth.setAttribute(
      'aria-label',
      (message?.summary ?? 'Ωedit™ pending') +
        '. ' +
        metrics
          .map((metric) => metric.label + ': ' + metric.value)
          .join('. ')
    )
  }

  function updateInspectorEndianLabel() {
    inspectorEndianBtn.textContent = inspectorLittleEndian ? 'LE' : 'BE'
    inspectorEndianBtn.title = inspectorLittleEndian
      ? 'Switch inspector to big-endian'
      : 'Switch inspector to little-endian'
  }

  function updateInspectorStatus() {
    if (!hasSelection()) {
      statusInspector.textContent = '-'
      return
    }

    const inspectOffset = getSelectionStart()
    const index = inspectOffset - bufferOffset
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

    const selectionPrefix = getSelectionLength() > 1
      ? getSelectionLength().toLocaleString() + ' bytes | '
      : ''

    statusInspector.textContent =
      selectionPrefix +
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
    const hasMatches = hasSearchResults()
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
      ? trackHeight
      : Math.max(
        MIN_SCROLLBAR_THUMB_HEIGHT,
        Math.round((visible / total) * trackHeight)
      )
    const travel = Math.max(0, trackHeight - thumbHeight)
    const thumbTop = trackDisabled || maxRow === 0
      ? 0
      : Math.round((currentStartRow() / maxRow) * travel)

    scrollbarThumb.style.top = thumbTop + 'px'
    scrollbarThumb.style.height = thumbHeight + 'px'
    scrollbarThumb.title = trackDisabled
      ? 'File fits in view'
      : 'Viewport ' + statusProgress.textContent
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

  function updateRenderedSelection() {
    if (!hexContainer) {
      return
    }

    hexContainer.querySelectorAll('[data-offset]').forEach((el) => {
      const offset = parseInt(el.dataset.offset, 10)
      el.classList.toggle('selected', !Number.isNaN(offset) && offsetIsSelected(offset))
    })
  }

  function selectOffset(offset, extendSelection = false) {
    if (offset < 0 || fileSize <= 0) {
      selectedOffset = -1
      selectionAnchor = -1
      updateSelectedStatus()
      updateRenderedSelection()
      updateAnalysisPanels()
      requestAnalysisProfile()
      return
    }

    const nextOffset = clampOffset(offset)
    if (extendSelection) {
      if (selectionAnchor < 0) {
        selectionAnchor = selectedOffset >= 0 ? selectedOffset : nextOffset
      }
      selectedOffset = nextOffset
    } else {
      selectionAnchor = nextOffset
      selectedOffset = nextOffset
    }

    updateSelectedStatus()
    updateRenderedSelection()
    updateAnalysisPanels()
    requestAnalysisProfile()
  }

  function getSelectedBytes() {
    const selectionStart = getSelectionStart()
    const selectionEnd = getSelectionEnd()
    if (selectionStart < 0 || selectionEnd < selectionStart) {
      return null
    }

    const startIndex = selectionStart - bufferOffset
    const endIndex = selectionEnd - bufferOffset
    if (startIndex < 0 || endIndex >= viewportLength) {
      return null
    }

    return viewportData.slice(startIndex, endIndex + 1)
  }

  function getClipboardSelectionHex() {
    const bytes = getSelectedBytes()
    return bytes === null
      ? null
      : bytes.map((byte) => toHex2(byte)).join(' ')
  }

  function parseClipboardTextAsHex(text) {
    if (text.length === 0) {
      return null
    }

    const normalizedHex = normalizedHexQuery(text)
    if (normalizedHex) {
      return normalizedHex.toUpperCase()
    }

    return utf8ToHex(text)
  }

  function bytesToDisplayText(bytes) {
    return bytes
      .map((byte) => (isPrintable(byte) ? String.fromCharCode(byte) : '?'))
      .join('')
  }

  function setActivePane(pane) {
    activePane = pane === 'ascii' ? 'ascii' : 'hex'
  }

  function getPasteTarget() {
    if (hasSelection() && getSelectionLength() > 1 && fileSize > 0) {
      return {
        type: 'replace',
        offset: getSelectionStart(),
        length: getSelectionLength(),
      }
    }

    return {
      type: 'insert',
      offset: hasSelection() ? getSelectionStart() : Math.max(0, visibleOffset),
    }
  }

  function handleCopyEvent(clipboardData) {
    const selectedBytes = getSelectedBytes()
    if (!selectedBytes || selectedBytes.length === 0) {
      updateActionStatus('Select one or more bytes to copy')
      return false
    }

    if (!clipboardData) {
      updateActionStatus('Clipboard is unavailable')
      return false
    }

    const selectionHex = selectedBytes.map((byte) => toHex2(byte)).join(' ')
    clipboardData.setData('text/plain',
      activePane === 'ascii'
        ? bytesToDisplayText(selectedBytes)
        : selectionHex
    )
    clipboardData.setData(
      INTERNAL_HEX_CLIPBOARD_FORMAT,
      selectedBytes.map((byte) => toHex2(byte)).join('')
    )
    updateActionStatus(
      'Copied ' +
      getSelectionLength().toLocaleString() +
      ' byte(s) as ' +
      (activePane === 'ascii' ? 'text' : 'hex')
    )
    return true
  }

  function handlePasteEvent(clipboardData) {
    const internalHex = clipboardData?.getData(INTERNAL_HEX_CLIPBOARD_FORMAT) ?? ''
    const plainText = clipboardData?.getData('text/plain') ?? ''
    const pasteHex = internalHex ||
      (activePane === 'ascii'
        ? (plainText ? utf8ToHex(plainText) : null)
        : parseClipboardTextAsHex(plainText))
    if (!pasteHex) {
      updateActionStatus('Clipboard is empty')
      return false
    }

    const target = getPasteTarget()
    if (target.type === 'replace') {
      clearReplaceSummaryActionStatus()
      vscode.postMessage({
        type: 'replace',
        offset: target.offset,
        length: target.length,
        data: pasteHex,
      })
    } else {
      clearReplaceSummaryActionStatus()
      vscode.postMessage({
        type: 'insert',
        offset: target.offset,
        data: pasteHex,
      })
    }

    updateActionStatus(
      'Pasted ' + (pasteHex.length / 2).toLocaleString() + ' byte(s)'
    )
    return true
  }

  function ensureSelectionVisible(direction) {
    if (!hasSelection()) {
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

  function moveSelection(direction, extendSelection = false) {
    if (fileSize <= 0) {
      return
    }

    if (!hasSelection()) {
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

    selectOffset(nextOffset, extendSelection)
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
    if (!hasSearchResults()) {
      matchNav.textContent = 'No matches'
      statusMatches.textContent = ''
      updateSearchButtons()
      return
    }

    if (searchMode === 'large') {
      matchNav.textContent = searchWindowLimit.toLocaleString() + '+ matches'
      statusMatches.textContent =
        searchWindowLimit.toLocaleString() +
        '+ matches | current ' +
        formatOffsetDisplay(searchCurrentOffset)
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

  function normalizeSearchQuery(query, isHex) {
    return isHex ? normalizedHexQuery(query) : query
  }

  function getSearchPatternByteLength(query, isHex) {
    return isHex
      ? query.length / 2
      : new TextEncoder().encode(query).length
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

  function navigateLargeSearch(direction) {
    const query = searchInput.value.trim()
    const isHex = searchHex.checked
    const normalizedQuery = normalizeSearchQuery(query, isHex)
    if (normalizedQuery === null) {
      matchNav.textContent = 'Invalid search hex'
      return
    }
    if (!normalizedQuery) {
      clearSearchResults()
      return
    }
    vscode.postMessage({
      type: 'findAdjacentMatch',
      query: normalizedQuery,
      isHex: isHex,
      caseInsensitive: !isHex && searchCase.checked,
      direction,
      offset: selectedOffset >= 0 ? selectedOffset : searchCurrentOffset,
    })
  }

  function rebuildMatchedByteOffsets() {
    const offsets = new Set()
    if (searchPatternLength <= 0) {
      matchedByteOffsets = offsets
      return
    }

    if (searchMode === 'large') {
      if (searchCurrentOffset >= 0) {
        for (let i = 0; i < searchPatternLength; i += 1) {
          offsets.add(searchCurrentOffset + i)
        }
      }
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

  function applySingleReplaceToSearchMatches(replacedOffset, offsetDelta) {
    if (searchMatches.length === 0 || searchMatchIndex < 0) {
      clearSearchResults()
      return null
    }

    searchMatches.splice(searchMatchIndex, 1)

    if (searchMatches.length === 0) {
      clearSearchResults()
      return null
    }

    if (searchMatchIndex >= searchMatches.length) {
      searchMatchIndex = searchMatches.length - 1
    }

    if (offsetDelta !== 0) {
      searchMatches = searchMatches.map((matchOffset) =>
        matchOffset > replacedOffset ? matchOffset + offsetDelta : matchOffset
      )
    }

    const nextMatchOffset = searchMatches[searchMatchIndex]
    selectOffset(nextMatchOffset)
    rebuildMatchedByteOffsets()
    updateMatchNav()
    render()
    vscode.postMessage({ type: 'goToMatch', offset: nextMatchOffset })
    return nextMatchOffset
  }

  function isMatchByte(absOffset) {
    return matchedByteOffsets.has(absOffset)
  }

  function render() {
    const renderStartedAt = performance.now()
    if (selectedOffset >= fileSize || selectionAnchor >= fileSize) {
      selectOffset(fileSize > 0 ? fileSize - 1 : -1)
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
          const sel = offsetIsSelected(absOff) ? ' selected' : ''
          const mat = isMatchByte(absOff) ? ' match' : ''
          hexCells += '<span class="hex-byte' + sep + sel + mat +
            '" data-offset="' + absOff + '" data-pane="hex">' + toHex2(b) + '</span>'
          const printable = isPrintable(b)
          const asciiClass = printable ? 'ascii-char' : 'ascii-char non-printable'
          const ch = printable ? String.fromCharCode(b) : '?'
          asciiCells += '<span class="' + asciiClass + sel + mat +
            '" data-offset="' + absOff + '" data-pane="ascii">' + escapeHtml(ch) + '</span>'
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
    lastRenderDurationMs = performance.now() - renderStartedAt
    lastRenderAt = Date.now()
    pushRenderSample(lastRenderDurationMs)
    updateAnalysisPanels()
    requestAnalysisProfile()
  }

  // ── Message Handling ────────────────────────────────

  window.addEventListener('message', (event) => {
    const msg = event.data
    switch (msg.type) {
      case 'viewportData':
        viewportSequence += 1
        lastViewportMessageAt = Date.now()
        bufferOffset = msg.offset
        visibleOffset =
          typeof msg.visibleOffset === 'number' ? msg.visibleOffset : pendingVisibleOffset
        pendingVisibleOffset = visibleOffset
        viewportData = msg.data
        viewportLength = msg.length
        fileSize = msg.fileSize
        latestProfile = {
          ...(msg.profile ?? {}),
          followingByteCount: msg.followingByteCount ?? 0,
          hostToWebviewMs:
            msg.profile && typeof msg.profile.sentAt === 'number'
              ? Math.max(0, lastViewportMessageAt - msg.profile.sentAt)
              : null,
        }
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
        searchPatternLength = msg.patternLength || searchPatternLength
        searchWindowLimit = msg.windowLimit || searchWindowLimit
        if (msg.mode === 'large' && typeof msg.currentOffset === 'number' && msg.currentOffset >= 0) {
          searchMode = 'large'
          searchMatches = []
          searchCurrentOffset = msg.currentOffset
          searchMatchIndex = -1
          rebuildMatchedByteOffsets()
          selectOffset(searchCurrentOffset)
          updateMatchNav()
          render()
          break
        }
        searchMode = 'bounded'
        searchCurrentOffset = -1
        searchMatches = msg.matches
        rebuildMatchedByteOffsets()
        searchMatchIndex = msg.matches.length > 0 ? 0 : -1
        if (searchMatches.length > 0) {
          selectOffset(searchMatches[0])
        }
        updateMatchNav()
        render()
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
            : 'Replaced ' + (msg.replacedCount ?? 0) + ' matches',
          'replace-summary'
        )
        let nextMatchOffset = null
        if (
          msg.scope === 'single' &&
          (msg.replacedCount ?? 0) > 0 &&
          typeof msg.replacedOffset === 'number'
        ) {
          if (searchMode === 'large') {
            // Stay in large mode until the user explicitly runs search again.
            // That keeps single-step replace/navigation on the on-demand path
            // even if the remaining matches fall back to the bounded window.
            searchCurrentOffset =
              typeof msg.selectionOffset === 'number' ? msg.selectionOffset : -1
            rebuildMatchedByteOffsets()
            updateMatchNav()
            render()
            navigateLargeSearch(
              searchDirectionSelect.value === 'reverse' ? 'backward' : 'forward'
            )
          } else {
            nextMatchOffset = applySingleReplaceToSearchMatches(
              msg.replacedOffset,
              typeof msg.offsetDelta === 'number' ? msg.offsetDelta : 0
            )
          }
        } else if (msg.scope === 'single' && (msg.replacedCount ?? 0) === 0) {
          updateMatchNav()
          render()
        } else {
          clearSearchResults()
        }
        if (
          nextMatchOffset === null &&
          typeof msg.selectionOffset === 'number' &&
          msg.selectionOffset >= 0
        ) {
          selectOffset(msg.selectionOffset)
        }
        break

      case 'searchNavigationResult':
        if (typeof msg.offset === 'number' && msg.offset >= 0) {
          searchMode = 'large'
          searchCurrentOffset = msg.offset
          searchPatternLength = msg.patternLength || searchPatternLength
          rebuildMatchedByteOffsets()
          selectOffset(msg.offset)
          updateMatchNav()
          render()
        }
        break

      case 'searchStateCleared':
        clearSearchResults()
        break

      case 'serverHealth':
        updateServerHealthStatus(msg)
        break

      case 'analysisProfile':
        if (msg.requestKey !== pendingAnalysisProfileKey) {
          break
        }
        latestDataProfile = {
          ...msg,
          scopeLabel: msg.scopeLabel || 'Visible',
        }
        updateAnalysisPanels()
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

    if (isPointerSelecting && (e.buttons & 1) === 1) {
      selectOffset(offset, true)
    }
  })

  hexContainer.addEventListener('pointerleave', () => {
    updateHoverHighlights(-1, -1)
  })

  hexContainer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) {
      return
    }

    const target = e.target.closest('[data-offset]')
    if (!target) {
      return
    }

    const offset = parseInt(target.dataset.offset, 10)
    if (Number.isNaN(offset)) {
      return
    }

    e.preventDefault()
    setActivePane(target.dataset.pane)
    selectOffset(offset, e.shiftKey)
    isPointerSelecting = true
  })

  hexContainer.addEventListener('contextmenu', (e) => {
    const target = e.target.closest('[data-offset]')
    if (!target) {
      return
    }

    setActivePane(target.dataset.pane)
    const offset = parseInt(target.dataset.offset, 10)
    if (!Number.isNaN(offset) && !offsetIsSelected(offset)) {
      selectOffset(offset)
    }
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
    isPointerSelecting = false
    if (isDraggingScrollbar) {
      stopScrollbarDrag()
    }
  })

  window.addEventListener('pointercancel', () => {
    isPointerSelecting = false
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
      moveSelection('left', e.shiftKey)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      moveSelection('right', e.shiftKey)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveSelection('up', e.shiftKey)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveSelection('down', e.shiftKey)
    } else if (e.key === 'Delete') {
      if (hasSelection() && fileSize > 0) {
        e.preventDefault()
        const selectionStart = getSelectionStart()
        clearReplaceSummaryActionStatus()
        vscode.postMessage({
          type: 'delete',
          offset: selectionStart,
          length: getSelectionLength(),
        })
        selectOffset(selectionStart)
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

  document.addEventListener('copy', (e) => {
    if (isEditableTarget(e.target)) {
      return
    }

    if (handleCopyEvent(e.clipboardData)) {
      e.preventDefault()
    }
  })

  document.addEventListener('cut', (e) => {
    if (isEditableTarget(e.target)) {
      return
    }

    if (!handleCopyEvent(e.clipboardData)) {
      return
    }

    if (!hasSelection() || fileSize <= 0) {
      return
    }

    e.preventDefault()
    const selectionStart = getSelectionStart()
    const selectionLength = getSelectionLength()
    clearReplaceSummaryActionStatus()
    vscode.postMessage({
      type: 'delete',
      offset: selectionStart,
      length: selectionLength,
    })
    updateActionStatus(
      'Cut ' + selectionLength.toLocaleString() + ' byte(s)'
    )
    selectOffset(selectionStart)
  })

  document.addEventListener('paste', (e) => {
    if (isEditableTarget(e.target)) {
      return
    }

    if (handlePasteEvent(e.clipboardData)) {
      e.preventDefault()
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
    const normalizedQuery = normalizeSearchQuery(query, isHex)
    if (normalizedQuery === null) {
      clearSearchResults('Invalid hex')
      return
    }
    searchPatternLength = getSearchPatternByteLength(normalizedQuery, isHex)
    vscode.postMessage({
      type: 'search',
      query: normalizedQuery,
      isHex: isHex,
      caseInsensitive: !isHex && searchCase.checked,
      isReverse: searchDirectionSelect.value === 'reverse',
    })
  }

  function replaceCurrentMatch() {
    const currentSearchOffset = getCurrentSearchOffset()
    if (currentSearchOffset < 0 || searchPatternLength <= 0) {
      return
    }
    const replacementHex = getReplacementHex()
    if (replacementHex === null) {
      matchNav.textContent = 'Invalid replacement hex'
      return
    }
    clearReplaceSummaryActionStatus()
    vscode.postMessage({
      type: 'replace',
      offset: currentSearchOffset,
      length: searchPatternLength,
      data: replacementHex,
    })
  }

  function replaceAllMatches() {
    if (!hasSearchResults() || searchPatternLength <= 0) {
      return
    }
    const query = searchInput.value.trim()
    const isHex = searchHex.checked
    const normalized = normalizeSearchQuery(query, isHex)
    if (normalized === null) {
      matchNav.textContent = 'Invalid search hex'
      return
    }
    const replacementHex = getReplacementHex()
    if (replacementHex === null) {
      matchNav.textContent = 'Invalid replacement hex'
      return
    }
    clearReplaceSummaryActionStatus()
    vscode.postMessage({
      type: 'replaceAllMatches',
      offsets: searchMode === 'large' ? undefined : searchMatches.slice(),
      query: normalized,
      isHex: isHex,
      caseInsensitive: !isHex && searchCase.checked,
      isReverse: searchDirectionSelect.value === 'reverse',
      length: searchPatternLength,
      data: replacementHex,
    })
  }

  searchBtn.addEventListener('click', doSearch)
  replaceBtn.addEventListener('click', replaceCurrentMatch)
  replaceAllBtn.addEventListener('click', replaceAllMatches)
  profileTab.addEventListener('click', () => setAnalysisMode('profile'))
  structureTab.addEventListener('click', () => setAnalysisMode('structure'))
  profileScaleBtn.addEventListener('click', () => {
    frequencyScale = frequencyScale === 'log' ? 'linear' : 'log'
    updateProfileAnalysis()
  })
  profileFrequencyChart.addEventListener('pointermove', updateFrequencyTooltip)
  profileFrequencyChart.addEventListener('pointerleave', hideFrequencyTooltip)
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
    if (!hasSearchResults()) return
    if (searchMode === 'large') {
      navigateLargeSearch('forward')
      return
    }
    searchMatchIndex = (searchMatchIndex + 1) % searchMatches.length
    selectOffset(searchMatches[searchMatchIndex])
    updateMatchNav()
    render()
    vscode.postMessage({ type: 'goToMatch', offset: searchMatches[searchMatchIndex] })
  })

  prevMatchBtn.addEventListener('click', () => {
    if (!hasSearchResults()) return
    if (searchMode === 'large') {
      navigateLargeSearch('backward')
      return
    }
    searchMatchIndex = (searchMatchIndex - 1 + searchMatches.length) % searchMatches.length
    selectOffset(searchMatches[searchMatchIndex])
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
    editOffset.value = hasSelection() ? toHex8(getSelectionStart()) : '00000000'
    editData.value = ''
    editLength.value = hasSelection() ? String(getSelectionLength()) : '1'
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
      clearReplaceSummaryActionStatus()
      vscode.postMessage({ type: 'delete', offset: offset, length: len })
    } else {
      const hex = editData.value.replace(/\\s/g, '')
      if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
        editData.style.borderColor = 'red'
        return
      }
      editData.style.borderColor = ''
      clearReplaceSummaryActionStatus()
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
      clearReplaceSummaryActionStatus()
      vscode.postMessage({ type: 'undo' })
    }
  })
  redoBtn.addEventListener('click', () => {
    if (!redoBtn.disabled) {
      clearReplaceSummaryActionStatus()
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
  updateAnalysisTabs()
  updateAnalysisPanels()
  renderColumnHeader()
  reportViewportMetrics()
})()
</script>
</body>
</html>`
}
