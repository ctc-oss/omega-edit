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
 *   │  Toolbar: [Search] [Insert/Delete/Overwrite] [Transforms]      │
 *   ├────────────┬─────────────────────────┬──────────────────┤
 *   │  Offset    │  Hex                    │  ASCII           │
 *   │  00000000  │  48 65 6C 6C 6F ...     │  Hello...        │
 *   │  00000010  │  ...                    │  ...             │
 *   └────────────┴─────────────────────────┴──────────────────┘
 *   │  Status: offset 0x0000 | size 1234 bytes | 5 matches    │
 *   └─────────────────────────────────────────────────────────┘
 */

import * as crypto from 'node:crypto'

const VALID_BYTES_PER_ROW = new Set([8, 16, 32])

function normalizeBytesPerRow(bytesPerRow: number): number {
  return VALID_BYTES_PER_ROW.has(bytesPerRow) ? bytesPerRow : 16
}

function createNonce(): string {
  return crypto.randomBytes(16).toString('base64')
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function getWebviewContent(
  requestedBytesPerRow: number,
  cspSource = "'self'",
  nonce = createNonce()
): string {
  const bytesPerRow = normalizeBytesPerRow(requestedBytesPerRow)
  const groupSize = 8
  const byteCellWidth = 22
  const byteGap = 6
  const groupGap = 4
  const escapedCspSource = escapeHtmlAttribute(cspSource)
  const escapedNonce = escapeHtmlAttribute(nonce)
  const groupSeparators = Math.floor((bytesPerRow - 1) / groupSize)
  const hexColumnWidth =
    bytesPerRow * byteCellWidth +
    (bytesPerRow - 1) * byteGap +
    groupSeparators * groupGap

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escapedCspSource} data:; style-src ${escapedCspSource} 'unsafe-inline'; script-src 'nonce-${escapedNonce}';">
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
    --accent-frame: var(--vscode-contrastActiveBorder, #cca700);
    --accent-frame-bg: color-mix(in srgb, var(--accent-frame) 16%, transparent);
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
  .toolbar select.transform-select { width: 180px; }
  .icon-button {
    width: 24px;
    height: 24px;
    padding: 0;
    display: inline-grid;
    place-items: center;
    line-height: 1;
  }
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
    position: relative;
  }
  .find-widget {
    position: absolute;
    top: 0;
    right: 28px;
    display: none;
    width: min(520px, calc(100% - 36px));
    padding: 4px;
    border: 1px solid var(--accent-frame);
    background: var(--vscode-editorWidget-background, var(--toolbar-bg));
    color: var(--vscode-editorWidget-foreground, var(--fg));
    box-shadow: 0 0 8px 2px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.3));
    z-index: 20;
    transform: translateY(-110%);
    transition: transform 160ms ease;
  }
  .find-widget.visible {
    display: block;
    transform: translateY(0);
  }
  .find-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .find-row + .find-row {
    margin-top: 4px;
  }
  .find-widget input[type="text"] {
    min-width: 80px;
    flex: 1 1 auto;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    padding: 3px 6px;
    font-family: var(--mono);
    font-size: 12px;
    border-radius: 2px;
  }
  .find-widget input[type="text"]:focus {
    outline: 1px solid var(--accent-frame);
  }
  .find-widget label {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--offset-fg);
    font-size: 11px;
    white-space: nowrap;
  }
  .find-widget .match-nav {
    min-width: 64px;
    text-align: center;
  }
  .find-toggle {
    align-self: stretch;
  }
  .find-replace-row {
    display: none;
    padding-left: 28px;
  }
  .find-widget.replace-visible .find-replace-row {
    display: flex;
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
    outline: 1px solid var(--accent-frame);
    outline-offset: -1px;
  }
  .hex-byte.selected {
    background: var(--selected);
    color: var(--selected-fg);
    outline: 1px solid var(--accent-frame);
    outline-offset: -1px;
  }
  .hex-byte.inspector-anchor {
    background: var(--accent-frame-bg);
    color: var(--fg);
    outline: 1px solid var(--accent-frame);
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
    outline: 1px solid var(--accent-frame);
    outline-offset: -1px;
  }
  .ascii-char.selected {
    background: var(--selected);
    color: var(--selected-fg);
    outline: 1px solid var(--accent-frame);
    outline-offset: -1px;
  }
  .ascii-char.inspector-anchor {
    background: var(--accent-frame-bg);
    color: var(--fg);
    outline: 1px solid var(--accent-frame);
    outline-offset: -1px;
  }
  .ascii-char.match {
    background: var(--highlight);
    color: var(--highlight-fg);
  }
  .ascii-char.non-printable {
    color: var(--ascii-muted-fg);
  }
  .ascii-char.non-printable.ascii-control {
    color: var(--vscode-terminal-ansiBlue, #569cd6);
    background: color-mix(in srgb, var(--vscode-terminal-ansiBlue, #569cd6) 18%, transparent);
    font-weight: 600;
    text-decoration: underline dotted;
    text-underline-offset: 2px;
  }
  .ascii-char.non-printable.high-bit {
    color: var(--vscode-terminal-ansiMagenta, #c586c0);
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
    opacity: 0.68;
  }
  .analysis-tab.active {
    background: color-mix(in srgb, var(--button-bg) 34%, transparent);
    color: var(--fg);
    box-shadow:
      inset 0 0 0 1px var(--button-bg),
      inset 0 -3px 0 var(--button-bg);
    font-weight: 600;
    opacity: 1;
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
  .analysis-section {
    position: relative;
  }
  .analysis-section + .analysis-section {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .analysis-section.dragging {
    opacity: 0.62;
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
  .analysis-section-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
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
  .analysis-drag-handle {
    width: 22px;
    height: 22px;
    padding: 0;
    display: inline-grid;
    place-items: center;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--offset-fg);
    cursor: grab;
  }
  .analysis-drag-handle:hover,
  .analysis-drag-handle:focus {
    background: var(--input-bg);
    color: var(--fg);
    outline: none;
  }
  .analysis-drag-handle:focus-visible {
    outline: 1px solid var(--accent-frame);
    outline-offset: 1px;
  }
  .analysis-drag-handle.dragging {
    border-color: var(--accent-frame);
    background: var(--accent-frame-bg);
    color: var(--fg);
    cursor: grabbing;
  }
  .analysis-drag-handle::before {
    content: '';
    width: 11px;
    height: 14px;
    background-image: radial-gradient(currentColor 1px, transparent 1.5px);
    background-size: 5px 5px;
    background-position: 0 0;
    opacity: 0.82;
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
  .status-inline-button.active {
    border-color: var(--accent-frame);
    background: var(--accent-frame-bg);
    color: var(--fg);
  }
  .status-action {
    color: var(--vscode-terminal-ansiYellow, #dcdcaa);
  }
  .status-action.flash {
    animation: status-action-flash 1200ms ease-out;
  }
  @keyframes status-action-flash {
    0% {
      color: var(--vscode-editorWarning-foreground, #ffcc66);
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #ffcc66) 26%, transparent);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-editorWarning-foreground, #ffcc66) 48%, transparent);
    }
    35% {
      color: var(--vscode-editorWarning-foreground, #ffcc66);
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #ffcc66) 18%, transparent);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--vscode-editorWarning-foreground, #ffcc66) 0%, transparent);
    }
    100% {
      color: var(--vscode-terminal-ansiYellow, #dcdcaa);
      background: transparent;
      box-shadow: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .status-action.flash {
      animation-duration: 1ms;
    }
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

  /* Inspector Pane */
  .byte-inspector-popover {
    position: fixed;
    left: 0;
    top: 0;
    display: none;
    min-width: 340px;
    max-width: min(560px, calc(100vw - 24px));
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
      var(--toolbar-bg);
    color: var(--fg);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.34);
    z-index: 40;
    white-space: normal;
    user-select: text;
  }
  .byte-inspector-popover.active {
    display: block;
  }
  .byte-inspector-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    cursor: grab;
    user-select: none;
  }
  .byte-inspector-header.dragging {
    cursor: grabbing;
  }
  .byte-inspector-title {
    color: var(--fg);
    font-size: 12px;
    font-weight: 600;
  }
  .byte-inspector-meta {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 4px;
    border: 1px solid var(--accent-frame);
    border-radius: 2px;
    background: var(--accent-frame-bg);
    color: var(--fg);
    font-size: 10px;
  }
  .byte-inspector-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
  }
  .byte-inspector-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(136px, 1fr));
    gap: 4px 14px;
  }
  .byte-inspector-row {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    gap: 7px;
    min-height: 22px;
  }
  .byte-inspector-label {
    color: var(--offset-fg);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .byte-inspector-value {
    min-width: 0;
    color: var(--fg);
    font-family: var(--mono);
    font-size: 11px;
    text-align: left;
    overflow-wrap: anywhere;
  }
  button.byte-inspector-value {
    width: 100%;
    padding: 2px 4px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    cursor: text;
  }
  button.byte-inspector-value:hover,
  button.byte-inspector-value:focus {
    border-color: var(--accent-frame);
    background: var(--accent-frame-bg);
    outline: none;
  }
  .byte-inspector-value.readonly {
    opacity: 0.82;
  }
  .byte-inspector-edit {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .byte-inspector-edit input {
    min-width: 0;
    width: 100%;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    border-radius: 3px;
    padding: 2px 5px;
    font-family: var(--mono);
    font-size: 11px;
  }
  .byte-inspector-edit input.invalid {
    border-color: var(--vscode-inputValidation-errorBorder, #f14c4c);
  }
  .byte-inspector-edit input:focus {
    outline: 1px solid var(--accent-frame);
  }
  .byte-inspector-edit button {
    flex: 0 0 auto;
    padding: 2px 6px;
    font-size: 10px;
  }
  .byte-inspector-error {
    grid-column: 1 / -1;
    color: var(--vscode-inputValidation-errorForeground, #f14c4c);
    font-size: 10px;
    min-height: 12px;
  }
  .paste-popover {
    position: fixed;
    left: 0;
    top: 0;
    display: none;
    min-width: 260px;
    max-width: min(340px, calc(100vw - 24px));
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
      var(--toolbar-bg);
    color: var(--fg);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.34);
    z-index: 45;
  }
  .paste-popover.active {
    display: block;
  }
  .paste-popover-title {
    color: var(--fg);
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .paste-popover-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0;
  }
  .paste-popover-label {
    width: 64px;
    color: var(--offset-fg);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .paste-popover-options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
  }
  .paste-popover-options label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
  }
  .paste-popover-options label.disabled {
    opacity: 0.5;
  }
  .paste-popover-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 10px;
  }
  .paste-popover-error {
    color: var(--vscode-inputValidation-errorForeground, #f14c4c);
    font-size: 10px;
    min-height: 12px;
  }
  @media (max-width: 720px) {
    .byte-inspector-popover {
      min-width: 280px;
    }
    .byte-inspector-grid {
      grid-template-columns: minmax(0, 1fr);
    }
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
  .edit-dialog .help-body {
    color: var(--fg);
    font-size: 12px;
    line-height: 1.45;
    max-width: 460px;
  }
  .edit-dialog .help-muted {
    color: var(--offset-fg);
    margin-bottom: 10px;
  }
  .edit-dialog .help-section-title {
    color: var(--offset-fg);
    font-size: 11px;
    margin: 10px 0 4px;
    text-transform: uppercase;
  }
  .edit-dialog .help-example {
    display: block;
    width: 100%;
    background: var(--input-bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 6px 8px;
    margin-top: 4px;
    font-family: var(--mono);
    font-size: 12px;
    text-align: left;
    white-space: pre-wrap;
    cursor: pointer;
    user-select: text;
  }
  .edit-dialog .help-example:hover,
  .edit-dialog .help-example:focus {
    background: color-mix(in srgb, var(--button-bg) 22%, var(--input-bg));
    outline: 1px solid var(--button-bg);
  }
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
    <label for="transformSelect">Transform:</label>
    <select class="transform-select" id="transformSelect" title="Byte range transform">
      <option value="">Loading transforms...</option>
    </select>
  </div>
</div>

<!-- ── Hex View ─────────────────────────────────────── -->
<div class="viewer-shell">
  <div class="viewer-main">
    <div class="find-widget" id="findWidget" aria-hidden="true">
      <div class="find-row">
        <button class="secondary icon-button find-toggle" id="findReplaceToggle" title="Toggle replace">&#8250;</button>
        <input type="text" id="searchInput" placeholder="Find text or hex bytes" />
        <label><input type="checkbox" id="searchHex" /> Hex</label>
        <label id="searchCaseLabel"><input type="checkbox" id="searchCase" /> Aa</label>
        <select id="searchDirectionSelect" title="Search direction">
          <option value="forward" selected>Top to Bottom</option>
          <option value="reverse">Bottom to Top</option>
        </select>
        <span class="match-nav" id="matchNav"></span>
        <button class="secondary icon-button" id="searchBtn" title="Find">&#9166;</button>
        <button class="secondary icon-button" id="prevMatch" title="Previous match">&#9650;</button>
        <button class="secondary icon-button" id="nextMatch" title="Next match">&#9660;</button>
        <button class="secondary icon-button" id="findCloseBtn" title="Close find">x</button>
      </div>
      <div class="find-row find-replace-row">
        <input type="text" id="replaceInput" placeholder="Replace with" />
        <button class="secondary" id="replaceBtn">Replace</button>
        <button class="secondary" id="replaceAllBtn">All</button>
      </div>
    </div>
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
        <button class="analysis-tab active" id="profileTab" role="tab" aria-selected="true" aria-controls="profilePanel">Profile</button>
        <button class="analysis-tab" id="structureTab" role="tab" aria-selected="false" aria-controls="structurePanel">Structure</button>
      </span>
    </div>
    <div class="analysis-body">
      <section class="analysis-panel active" id="profilePanel" role="tabpanel" aria-labelledby="profileTab" data-analysis-panel="profile">
        <div class="analysis-section" data-analysis-section="viewport">
          <div class="analysis-section-heading">
            <div class="analysis-section-title">Viewport</div>
            <button class="analysis-drag-handle" type="button" data-analysis-drag="true" title="Drag to reorder. Arrow keys move while focused." aria-label="Move Viewport analysis section"></button>
          </div>
          <div class="analysis-metrics" id="profileViewportMetrics"></div>
        </div>
        <div class="analysis-section" data-analysis-section="classes">
          <div class="analysis-section-heading">
            <div class="analysis-section-title">Byte Classes</div>
            <button class="analysis-drag-handle" type="button" data-analysis-drag="true" title="Drag to reorder. Arrow keys move while focused." aria-label="Move Byte Classes analysis section"></button>
          </div>
          <div class="analysis-bars" id="profileClassBars"></div>
        </div>
        <div class="analysis-section" data-analysis-section="data">
          <div class="analysis-section-heading">
            <div class="analysis-section-title">Data Profile</div>
            <button class="analysis-drag-handle" type="button" data-analysis-drag="true" title="Drag to reorder. Arrow keys move while focused." aria-label="Move Data Profile analysis section"></button>
          </div>
          <div class="analysis-metrics" id="profileDataMetrics"></div>
        </div>
        <div class="analysis-section" data-analysis-section="frequency">
          <div class="analysis-section-heading">
            <div class="analysis-section-title">Frequency</div>
            <div class="analysis-section-actions">
              <button class="analysis-mini-button" id="profileScaleBtn" title="Toggle frequency scale">Linear</button>
              <button class="analysis-drag-handle" type="button" data-analysis-drag="true" title="Drag to reorder. Arrow keys move while focused." aria-label="Move Frequency analysis section"></button>
            </div>
          </div>
          <div class="frequency-chart" id="profileFrequencyChart"></div>
          <div class="analysis-note" id="profileLimitNote"></div>
          <div class="analysis-bars" id="profileByteBars"></div>
        </div>
      </section>
      <section class="analysis-panel" id="structurePanel" role="tabpanel" aria-labelledby="structureTab" data-analysis-panel="structure">
        <div class="analysis-section" data-analysis-section="visible">
          <div class="analysis-section-heading">
            <div class="analysis-section-title" id="structureScopeTitle">Visible Bytes</div>
            <button class="analysis-drag-handle" type="button" data-analysis-drag="true" title="Drag to reorder. Arrow keys move while focused." aria-label="Move Visible Bytes analysis section"></button>
          </div>
          <div class="analysis-metrics" id="structureMetrics"></div>
        </div>
        <div class="analysis-section" data-analysis-section="history">
          <div class="analysis-section-heading">
            <div class="analysis-section-title">History</div>
            <button class="analysis-drag-handle" type="button" data-analysis-drag="true" title="Drag to reorder. Arrow keys move while focused." aria-label="Move History analysis section"></button>
          </div>
          <div class="analysis-metrics" id="structureHistoryMetrics"></div>
        </div>
        <div class="analysis-section" data-analysis-section="timing">
          <div class="analysis-section-heading">
            <div class="analysis-section-title">Timing</div>
            <button class="analysis-drag-handle" type="button" data-analysis-drag="true" title="Drag to reorder. Arrow keys move while focused." aria-label="Move Timing analysis section"></button>
          </div>
          <div class="analysis-metrics" id="profileTimingMetrics"></div>
        </div>
      </section>
    </div>
  </aside>
</div>

<!-- ── Status Bar ───────────────────────────────────── -->
<div class="byte-inspector-popover" id="byteInspector" role="tooltip"></div>
<div class="paste-popover" id="pastePopover" role="dialog" aria-label="Paste bytes"></div>

<div class="status-bar">
  <span>State: <span class="highlight" id="statusDirty">Saved</span></span>
  <span>Offset: <span class="highlight" id="statusOffset">0x00000000</span></span>
  <span>Selected: <span class="highlight" id="statusSelected">-</span></span>
  <span>Mode: <button class="status-inline-button" id="editModeBtn" title="Toggle insert/overwrite mode">Insert</button></span>
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

<div class="edit-dialog" id="transformOptionsDialog">
  <h3 id="transformOptionsTitle">Transform Options</h3>
  <div class="help-body" id="transformOptionsBody"></div>
  <div class="field" id="transformOptionsField">
    <label for="transformOptions">Options JSON:</label>
    <input type="text" id="transformOptions" placeholder="options JSON" />
  </div>
  <div class="actions">
    <button class="secondary" id="transformOptionsCancel">Cancel</button>
    <button id="transformOptionsApply">Apply</button>
  </div>
</div>

<script nonce="${escapedNonce}">
(function () {
  // VS Code webview API
  const vscode = acquireVsCodeApi()

  // ── Configuration ───────────────────────────────────
  const BYTES_PER_ROW = ${bytesPerRow}
  const GROUP_SIZE = 8 // visual separator every N bytes
  const INTERNAL_HEX_CLIPBOARD_FORMAT = 'application/x-omega-edit-hex'
  const MIN_SCROLLBAR_THUMB_HEIGHT = 20
  const MAX_PROFILE_BYTES = 64 * 1024
  const INSPECTOR_LOOKAHEAD_BYTES = 8
  const DEFAULT_ANALYSIS_SECTION_ORDER = {
    profile: ['viewport', 'classes', 'data', 'frequency'],
    structure: ['visible', 'history', 'timing'],
  }

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
  let searchDebounceTimer = null
  let findWidgetVisible = false
  let findReplaceVisible = false
  let byteEditMode = 'insert'
  let pendingHexNibble = null
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
  let analysisSectionOrder = normalizeAnalysisSectionOrder(
    vscode.getState?.()?.analysisSectionOrder
  )
  let analysisDragState = null
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
  let historyCanUndo = false
  let historyCanRedo = false
  let historyUndoCount = 0
  let historyRedoCount = 0
  let transformPlugins = []
  let transformPluginsRequested = false
  let byteInspectorOffset = -1
  let byteInspectorAnchor = null
  let byteInspectorCandidateOffset = -1
  let byteInspectorCandidateAnchor = null
  let byteInspectorEditKey = ''
  let byteInspectorEditValue = ''
  let byteInspectorEditError = ''
  let byteInspectorDragging = false
  let byteInspectorDragOffsetX = 0
  let byteInspectorDragOffsetY = 0
  let byteInspectorManuallyPositioned = false
  let pasteContext = null
  const transformOptionsByPluginId = new Map()
  const renderSamples = []

  // ── DOM Refs ────────────────────────────────────────
  const hexContainer = document.getElementById('hexContainer')
  const hexColumnHeader = document.getElementById('hexColumnHeader')
  const scrollbarTrack = document.getElementById('scrollbarTrack')
  const scrollbarThumb = document.getElementById('scrollbarThumb')
  const byteInspector = document.getElementById('byteInspector')
  const pastePopover = document.getElementById('pastePopover')
  const bytesPerRowSelect = document.getElementById('bytesPerRowSelect')
  const offsetRadixSelect = document.getElementById('offsetRadixSelect')
  const statusOffset = document.getElementById('statusOffset')
  const statusSelected = document.getElementById('statusSelected')
  const statusDirty = document.getElementById('statusDirty')
  const statusSize = document.getElementById('statusSize')
  const statusProgress = document.getElementById('statusProgress')
  const statusMatches = document.getElementById('statusMatches')
  const statusAction = document.getElementById('statusAction')
  const editModeBtn = document.getElementById('editModeBtn')
  const statusInspector = document.getElementById('statusInspector')
  const inspectorEndianBtn = document.getElementById('inspectorEndianBtn')
  const serverHealth = document.getElementById('serverHealth')
  const serverHealthDot = document.getElementById('serverHealthDot')
  const serverHealthSummary = document.getElementById('serverHealthSummary')
  const serverHealthBadge = document.getElementById('serverHealthBadge')
  const serverHealthMetrics = document.getElementById('serverHealthMetrics')
  const findWidget = document.getElementById('findWidget')
  const findReplaceToggle = document.getElementById('findReplaceToggle')
  const findCloseBtn = document.getElementById('findCloseBtn')
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
  const transformSelect = document.getElementById('transformSelect')
  const transformOptions = document.getElementById('transformOptions')
  const editDialog = document.getElementById('editDialog')
  const overlay = document.getElementById('overlay')
  const editTitle = document.getElementById('editTitle')
  const editOffset = document.getElementById('editOffset')
  const editLength = document.getElementById('editLength')
  const editData = document.getElementById('editData')
  const editLengthField = document.getElementById('editLengthField')
  const editDataField = document.getElementById('editDataField')
  const transformOptionsDialog = document.getElementById('transformOptionsDialog')
  const transformOptionsTitle = document.getElementById('transformOptionsTitle')
  const transformOptionsBody = document.getElementById('transformOptionsBody')
  const transformOptionsField = document.getElementById('transformOptionsField')
  const transformOptionsApply = document.getElementById('transformOptionsApply')
  const transformOptionsCancel = document.getElementById('transformOptionsCancel')
  const analysisPane = document.getElementById('analysisPane')
  const profileTab = document.getElementById('profileTab')
  const structureTab = document.getElementById('structureTab')
  const profilePanel = document.getElementById('profilePanel')
  const structurePanel = document.getElementById('structurePanel')
  const profileViewportMetrics = document.getElementById('profileViewportMetrics')
  const profileTimingMetrics = document.getElementById('profileTimingMetrics')
  const profileClassBars = document.getElementById('profileClassBars')
  const profileDataMetrics = document.getElementById('profileDataMetrics')
  const profileScaleBtn = document.getElementById('profileScaleBtn')
  const profileFrequencyChart = document.getElementById('profileFrequencyChart')
  const profileLimitNote = document.getElementById('profileLimitNote')
  const profileByteBars = document.getElementById('profileByteBars')
  const structureScopeTitle = document.getElementById('structureScopeTitle')
  const structureMetrics = document.getElementById('structureMetrics')
  const structureHistoryMetrics = document.getElementById('structureHistoryMetrics')

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

  function escapeAttribute(text) {
    return escapeHtml(String(text))
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }

  function bytesToHex(bytes) {
    return bytes.map((byte) => toHex2(byte)).join('')
  }

  function bytesToSpacedHex(bytes) {
    return bytes.map((byte) => toHex2(byte)).join(' ')
  }

  function makeDataView(bytes) {
    return new DataView(Uint8Array.from(bytes).buffer)
  }

  function getInspectorBytes(offset, length = INSPECTOR_LOOKAHEAD_BYTES) {
    const index = offset - bufferOffset
    if (index < 0 || index >= viewportLength || offset < 0 || offset >= fileSize) {
      return []
    }
    return viewportData.slice(index, Math.min(index + length, viewportLength, fileSize - bufferOffset))
  }

  function byteElementForOffset(offset, pane = activePane) {
    if (offset < 0) {
      return null
    }

    return hexContainer.querySelector('[data-offset="' + offset + '"][data-pane="' + pane + '"]') ??
      hexContainer.querySelector('[data-offset="' + offset + '"]')
  }

  function resolveByteInspectorAnchor(offset, preferredAnchor = null) {
    if (
      preferredAnchor?.isConnected &&
      parseInt(preferredAnchor.dataset.offset, 10) === offset
    ) {
      return preferredAnchor
    }

    return byteElementForOffset(offset, preferredAnchor?.dataset?.pane ?? activePane)
  }

  function parseBigIntInput(raw) {
    const text = String(raw).trim().replaceAll('_', '')
    if (!text) {
      throw new Error('empty value')
    }

    let sign = 1n
    let body = text
    if (body[0] === '-') {
      sign = -1n
      body = body.slice(1)
    } else if (body[0] === '+') {
      body = body.slice(1)
    }

    if (/^0x[0-9a-f]+$/i.test(body) || /^0b[01]+$/i.test(body) || /^0o[0-7]+$/i.test(body) || /^[0-9]+$/.test(body)) {
      return sign * BigInt(body)
    }

    throw new Error('invalid integer')
  }

  function parseIntegerInRange(raw, min, max) {
    const value = parseBigIntInput(raw)
    if (value < min || value > max) {
      throw new Error('out of range')
    }
    return value
  }

  function writeIntegerBytes(value, byteLength, signed, littleEndian) {
    const buffer = new ArrayBuffer(byteLength)
    const view = new DataView(buffer)
    if (byteLength === 1) {
      signed ? view.setInt8(0, Number(value)) : view.setUint8(0, Number(value))
    } else if (byteLength === 2) {
      signed ? view.setInt16(0, Number(value), littleEndian) : view.setUint16(0, Number(value), littleEndian)
    } else if (byteLength === 3) {
      const mask = 0xffffffn
      const unsigned = signed && value < 0 ? (1n << 24n) + value : value
      const v = Number(unsigned & mask)
      const bytes = littleEndian
        ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]
        : [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
      return bytesToHex(bytes)
    } else if (byteLength === 4) {
      signed ? view.setInt32(0, Number(value), littleEndian) : view.setUint32(0, Number(value), littleEndian)
    } else if (byteLength === 8) {
      signed ? view.setBigInt64(0, value, littleEndian) : view.setBigUint64(0, value, littleEndian)
    }
    return bytesToHex(Array.from(new Uint8Array(buffer)))
  }

  function getUint24FromBytes(bytes, littleEndian) {
    return littleEndian
      ? bytes[0] | (bytes[1] << 8) | (bytes[2] << 16)
      : (bytes[0] << 16) | (bytes[1] << 8) | bytes[2]
  }

  function getInt24FromBytes(bytes, littleEndian) {
    const value = getUint24FromBytes(bytes, littleEndian)
    return (value & 0x800000) ? value - 0x1000000 : value
  }

  function readFloat16(bytes, exponentWidth, significandPrecision, littleEndian) {
    const uint16 = littleEndian
      ? bytes[0] | (bytes[1] << 8)
      : (bytes[0] << 8) | bytes[1]
    const exponentMask = (2 ** exponentWidth - 1) << significandPrecision
    const fractionMask = 2 ** significandPrecision - 1
    const exponentBias = 2 ** (exponentWidth - 1) - 1
    const exponentMin = 1 - exponentBias
    const exponent = (uint16 & exponentMask) >> significandPrecision
    const fraction = uint16 & fractionMask
    const sign = uint16 >> 15 ? -1 : 1

    if (exponent === 0) {
      return String(sign * 2 ** exponentMin * (fraction / 2 ** significandPrecision))
    }
    if (exponent === 2 ** exponentWidth - 1) {
      return String(fraction ? NaN : sign * Infinity)
    }
    return String(sign * 2 ** (exponent - exponentBias) * (1 + fraction / 2 ** significandPrecision))
  }

  function firstUnicodeCharacter(raw) {
    const chars = Array.from(String(raw))
    if (chars.length !== 1) {
      throw new Error('enter one character')
    }
    return chars[0]
  }

  function formatTextInspectorValue(value) {
    if (!value) {
      return '?'
    }
    const codePoint = value.codePointAt(0)
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return 'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0')
    }
    return "'" + value + "'"
  }

  function decodeFirstUtf8(bytes) {
    const maxLength = Math.min(4, bytes.length)
    for (let length = 1; length <= maxLength; length++) {
      try {
        const text = new TextDecoder('utf-8', { fatal: true })
          .decode(Uint8Array.from(bytes.slice(0, length)))
        const chars = Array.from(text)
        if (chars.length === 1) {
          return chars[0]
        }
      } catch {
        // Keep extending the prefix until a complete UTF-8 scalar is available.
      }
    }
    return ''
  }

  function readUtf16CodeUnit(bytes, index, littleEndian) {
    return littleEndian
      ? bytes[index] | (bytes[index + 1] << 8)
      : (bytes[index] << 8) | bytes[index + 1]
  }

  function decodeFirstUtf16(bytes, littleEndian) {
    if (bytes.length < 2) {
      return ''
    }

    const first = readUtf16CodeUnit(bytes, 0, littleEndian)
    if (first >= 0xd800 && first <= 0xdbff) {
      if (bytes.length < 4) {
        return ''
      }
      const second = readUtf16CodeUnit(bytes, 2, littleEndian)
      if (second < 0xdc00 || second > 0xdfff) {
        return ''
      }
      return String.fromCodePoint(
        0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00)
      )
    }
    if (first >= 0xdc00 && first <= 0xdfff) {
      return ''
    }
    return String.fromCharCode(first)
  }

  function encodeUtf16Character(value, littleEndian) {
    const char = firstUnicodeCharacter(value)
    const codePoint = char.codePointAt(0)
    const codeUnits = codePoint > 0xffff
      ? [
          0xd800 + ((codePoint - 0x10000) >> 10),
          0xdc00 + ((codePoint - 0x10000) & 0x3ff),
        ]
      : [codePoint]
    const bytes = []

    for (const codeUnit of codeUnits) {
      if (littleEndian) {
        bytes.push(codeUnit & 0xff, (codeUnit >> 8) & 0xff)
      } else {
        bytes.push((codeUnit >> 8) & 0xff, codeUnit & 0xff)
      }
    }

    return bytesToHex(bytes)
  }

  function integerField(key, label, byteLength, signed) {
    const bits = BigInt(byteLength * 8)
    const min = signed ? -(1n << (bits - 1n)) : 0n
    const max = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n
    return {
      key,
      label,
      minBytes: byteLength,
      editable: true,
      read: (bytes, le) => {
        const view = makeDataView(bytes)
        if (byteLength === 1) {
          return signed ? view.getInt8(0).toString() : view.getUint8(0).toString()
        }
        if (byteLength === 2) {
          return signed ? view.getInt16(0, le).toString() : view.getUint16(0, le).toString()
        }
        if (byteLength === 3) {
          return signed ? getInt24FromBytes(bytes, le).toString() : getUint24FromBytes(bytes, le).toString()
        }
        if (byteLength === 4) {
          return signed ? view.getInt32(0, le).toString() : view.getUint32(0, le).toString()
        }
        return signed ? view.getBigInt64(0, le).toString() : view.getBigUint64(0, le).toString()
      },
      write: (raw, le) => writeIntegerBytes(parseIntegerInRange(raw, min, max), byteLength, signed, le),
    }
  }

  const inspectorFields = [
    {
      key: 'hex8',
      label: 'byte',
      minBytes: 1,
      editable: true,
      read: (bytes) => '0x' + toHex2(bytes[0]),
      editValue: (bytes) => '0x' + toHex2(bytes[0]),
      write: (raw) => {
        const text = String(raw).trim().replace(/^0x/i, '')
        if (!/^[0-9a-f]{1,2}$/i.test(text)) {
          throw new Error('invalid byte')
        }
        return toHex2(parseInt(text, 16))
      },
    },
    {
      key: 'ascii',
      label: 'ascii',
      minBytes: 1,
      editable: true,
      read: (bytes) => isPrintable(bytes[0]) ? "'" + String.fromCharCode(bytes[0]) + "'" : '?',
      editValue: (bytes) => isPrintable(bytes[0]) ? String.fromCharCode(bytes[0]) : '',
      write: (raw) => {
        const value = String(raw)
        if (value.length !== 1 || value.charCodeAt(0) > 0x7f) {
          throw new Error('enter one ASCII character')
        }
        return toHex2(value.charCodeAt(0))
      },
    },
    {
      key: 'utf8',
      label: 'utf-8',
      minBytes: 1,
      editable: true,
      read: (bytes) => formatTextInspectorValue(decodeFirstUtf8(bytes)),
      editValue: (bytes) => decodeFirstUtf8(bytes),
      write: (raw) => bytesToHex(Array.from(new TextEncoder().encode(firstUnicodeCharacter(raw)))),
    },
    {
      key: 'utf16',
      label: 'utf-16',
      minBytes: 2,
      editable: true,
      read: (bytes, le) => formatTextInspectorValue(decodeFirstUtf16(bytes, le)),
      editValue: (bytes, le) => decodeFirstUtf16(bytes, le),
      write: (raw, le) => encodeUtf16Character(raw, le),
    },
    {
      key: 'binary',
      label: 'binary',
      minBytes: 1,
      editable: true,
      read: (bytes) => bytes[0].toString(2).padStart(8, '0'),
      write: (raw) => {
        const text = String(raw).trim().replace(/^0b/i, '')
        if (!/^[01]{1,8}$/.test(text)) {
          throw new Error('invalid binary byte')
        }
        return toHex2(parseInt(text, 2))
      },
    },
    {
      key: 'octal',
      label: 'octal',
      minBytes: 1,
      editable: true,
      read: (bytes) => bytes[0].toString(8).padStart(3, '0'),
      write: (raw) => {
        const text = String(raw).trim().replace(/^0o/i, '')
        if (!/^[0-7]{1,3}$/.test(text)) {
          throw new Error('invalid octal byte')
        }
        const value = parseInt(text, 8)
        if (value > 0xff) {
          throw new Error('out of range')
        }
        return toHex2(value)
      },
    },
    integerField('uint8', 'uint8', 1, false),
    integerField('int8', 'int8', 1, true),
    integerField('uint16', 'uint16', 2, false),
    integerField('int16', 'int16', 2, true),
    integerField('uint24', 'uint24', 3, false),
    integerField('int24', 'int24', 3, true),
    integerField('uint32', 'uint32', 4, false),
    integerField('int32', 'int32', 4, true),
    integerField('uint64', 'uint64', 8, false),
    integerField('int64', 'int64', 8, true),
    {
      key: 'float16',
      label: 'float16',
      minBytes: 2,
      editable: false,
      read: (bytes, le) => readFloat16(bytes, 5, 10, le),
    },
    {
      key: 'bfloat16',
      label: 'bfloat16',
      minBytes: 2,
      editable: false,
      read: (bytes, le) => readFloat16(bytes, 8, 7, le),
    },
    {
      key: 'float32',
      label: 'float32',
      minBytes: 4,
      editable: false,
      read: (bytes, le) => makeDataView(bytes).getFloat32(0, le).toString(),
    },
    {
      key: 'float64',
      label: 'float64',
      minBytes: 8,
      editable: false,
      read: (bytes, le) => makeDataView(bytes).getFloat64(0, le).toString(),
    },
  ]

  function normalizeAnalysisSectionOrder(rawOrder) {
    const order = {}
    Object.entries(DEFAULT_ANALYSIS_SECTION_ORDER).forEach(([panelName, defaults]) => {
      const saved = Array.isArray(rawOrder?.[panelName]) ? rawOrder[panelName] : []
      const next = []
      saved.forEach((sectionId) => {
        if (defaults.includes(sectionId) && !next.includes(sectionId)) {
          next.push(sectionId)
        }
      })
      defaults.forEach((sectionId) => {
        if (!next.includes(sectionId)) {
          next.push(sectionId)
        }
      })
      order[panelName] = next
    })
    return order
  }

  function analysisPanelElement(panelName) {
    return panelName === 'structure' ? structurePanel : profilePanel
  }

  function getAnalysisSection(panelName, sectionId) {
    return analysisPanelElement(panelName)?.querySelector(
      '[data-analysis-section="' + sectionId + '"]'
    ) ?? null
  }

  function analysisSectionOrderSnapshot() {
    return {
      profile: analysisSectionOrder.profile.slice(),
      structure: analysisSectionOrder.structure.slice(),
    }
  }

  function saveAnalysisSectionOrder() {
    vscode.setState?.({
      ...(vscode.getState?.() ?? {}),
      analysisSectionOrder: analysisSectionOrderSnapshot(),
    })
  }

  function applyAnalysisSectionOrder(panelName) {
    const panel = analysisPanelElement(panelName)
    if (!panel) {
      return
    }

    analysisSectionOrder[panelName].forEach((sectionId) => {
      const section = getAnalysisSection(panelName, sectionId)
      if (section) {
        panel.appendChild(section)
      }
    })
  }

  function applyAnalysisSectionOrders() {
    Object.keys(DEFAULT_ANALYSIS_SECTION_ORDER).forEach(applyAnalysisSectionOrder)
  }

  function moveAnalysisSection(panelName, sectionId, targetId, placeAfter) {
    if (!sectionId || !targetId || sectionId === targetId) {
      return false
    }

    const order = analysisSectionOrder[panelName]
    const fromIndex = order.indexOf(sectionId)
    if (fromIndex < 0 || !order.includes(targetId)) {
      return false
    }

    order.splice(fromIndex, 1)
    const targetIndex = order.indexOf(targetId)
    order.splice(targetIndex + (placeAfter ? 1 : 0), 0, sectionId)
    applyAnalysisSectionOrder(panelName)
    saveAnalysisSectionOrder()
    return true
  }

  function moveAnalysisSectionByDelta(panelName, sectionId, delta) {
    const order = analysisSectionOrder[panelName]
    const fromIndex = order.indexOf(sectionId)
    if (fromIndex < 0) {
      return false
    }

    const toIndex = clamp(0, fromIndex + delta, order.length - 1)
    if (toIndex === fromIndex) {
      return false
    }

    order.splice(fromIndex, 1)
    order.splice(toIndex, 0, sectionId)
    applyAnalysisSectionOrder(panelName)
    saveAnalysisSectionOrder()
    getAnalysisSection(panelName, sectionId)
      ?.querySelector('[data-analysis-drag]')
      ?.focus()
    return true
  }

  function stopAnalysisSectionDrag(pointerId) {
    if (!analysisDragState) {
      return
    }

    analysisDragState.section.classList.remove('dragging')
    analysisDragState.handle.classList.remove('dragging')
    if (
      typeof pointerId === 'number' &&
      analysisDragState.handle.hasPointerCapture?.(pointerId)
    ) {
      analysisDragState.handle.releasePointerCapture(pointerId)
    }
    analysisDragState = null
  }

  function scrollAnalysisPaneDuringDrag(event) {
    const body = analysisDragState?.section.closest('.analysis-body')
    if (!body) {
      return
    }

    const rect = body.getBoundingClientRect()
    const edgeSize = 28
    if (event.clientY < rect.top + edgeSize) {
      body.scrollTop -= 14
    } else if (event.clientY > rect.bottom - edgeSize) {
      body.scrollTop += 14
    }
  }

  function handleAnalysisSectionDragMove(event) {
    if (!analysisDragState) {
      return
    }

    event.preventDefault()
    scrollAnalysisPaneDuringDrag(event)
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-analysis-section]')
    if (!target || target === analysisDragState.section) {
      return
    }

    const targetPanelName = target.closest('[data-analysis-panel]')
      ?.dataset.analysisPanel
    if (targetPanelName !== analysisDragState.panelName) {
      return
    }

    const targetId = target.dataset.analysisSection
    const rect = target.getBoundingClientRect()
    moveAnalysisSection(
      analysisDragState.panelName,
      analysisDragState.sectionId,
      targetId,
      event.clientY > rect.top + rect.height / 2
    )
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
          '<span class="analysis-value">' + escapeHtml(String(row.value)) + '</span>' +
        '</div>'
      )
      .join('')
  }

  function renderTimingMetrics() {
    const profile = latestProfile ?? {}
    const averageRenderMs = averageRenderDuration()
    const hostToWebviewMs = typeof profile.hostToWebviewMs === 'number'
      ? profile.hostToWebviewMs
      : null

    renderMetricRows(profileTimingMetrics, [
      { label: 'Fetch', value: formatDuration(profile.fetchDurationMs) },
      { label: 'Bridge', value: formatDuration(hostToWebviewMs) },
      { label: 'Render', value: formatDuration(lastRenderDurationMs) },
      { label: 'Avg Render', value: averageRenderMs === null ? '-' : formatDuration(averageRenderMs) },
      { label: 'Updated', value: lastRenderAt ? new Date(lastRenderAt).toLocaleTimeString() : '-' },
      { label: 'Message', value: lastViewportMessageAt ? new Date(lastViewportMessageAt).toLocaleTimeString() : '-' },
    ])
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

  function byteTextClass(byte) {
    if (isPrintable(byte)) {
      return 'ascii-char'
    }
    if (byte < 0x80) {
      return 'ascii-char non-printable ascii-control'
    }
    return 'ascii-char non-printable high-bit'
  }

  function formatByteLabel(byte) {
    if (!isPrintable(byte)) {
      return '0x' + toHex2(byte)
    }
    if (byte === 0x20) {
      return '0x20 SP'
    }
    return "0x" + toHex2(byte) + " '" + String.fromCharCode(byte) + "'"
  }

  function formatModeByte(entry, total) {
    if (!entry || total <= 0) {
      return '-'
    }
    return formatByteLabel(entry.byte) +
      ' x ' +
      entry.count.toLocaleString() +
      ' (' +
      formatPercent((entry.count / total) * 100) +
      ')'
  }

  function computeFrequencySpread(counts, total) {
    if (total <= 0) {
      return 0
    }
    const expected = 1 / 256
    const variance = counts.reduce((sum, count) => {
      const probability = count / total
      const delta = probability - expected
      return sum + delta * delta
    }, 0) / 256
    return Math.sqrt(variance) * 100
  }

  function formatFrequencySpread(value, total) {
    if (total <= 0) {
      return '-'
    }
    return value.toFixed(value >= 10 ? 1 : 2) + ' pp'
  }

  function classColorClass(label) {
    if (label === 'Printable') {
      return 'printable'
    }
    if (label === 'Control' || label === 'Null') {
      return 'control'
    }
    if (label === 'High-bit' || label === 'FF') {
      return 'high-bit'
    }
    return ''
  }

  function classRowsFromCounts(counts, total) {
    if (total <= 0) {
      return []
    }

    const classes = {
      Printable: 0,
      Control: 0,
      'High-bit': 0,
      Null: 0,
      FF: 0,
    }

    counts.slice(0, 256).forEach((count, byte) => {
      classes[byteClass(byte)] += count
    })

    return Object.entries(classes).map(([label, count]) => ({
      label,
      percent: (count / total) * 100,
      value: count.toLocaleString() + ' | ' + formatPercent((count / total) * 100),
      colorClass: classColorClass(label),
    }))
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

    const modeByte = counts
      .map((count, byte) => ({ byte, count }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.byte - b.byte)[0] ?? null

    return {
      count: bytes.length,
      unique: counts.filter((count) => count > 0).length,
      entropy,
      frequencySpread: computeFrequencySpread(counts, bytes.length),
      modeByte,
      classes,
      longestRunByte,
      longestRunLength,
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
    const profile = latestProfile ?? {}
    const visibleByteCount = currentVisibleByteCount()
    const bufferCoverage = fileSize > 0
      ? (viewportLength / fileSize) * 100
      : 0
    const visibleCoverage = fileSize > 0
      ? (visibleByteCount / fileSize) * 100
      : 0
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
    renderTimingMetrics()

    if (!latestDataProfile) {
      renderMetricRows(profileDataMetrics, [
        { label: 'Scope', value: '-' },
        { label: 'Bytes', value: '-' },
        { label: 'DOS EOL', value: '-' },
        { label: 'Mode', value: '-' },
        { label: 'ASCII', value: '-' },
        { label: 'Content', value: '-' },
        { label: 'Language', value: '-' },
        { label: 'BOM', value: '-' },
        { label: 'BOM Bytes', value: '-' },
        { label: '1B Chars', value: '-' },
        { label: '2B Chars', value: '-' },
        { label: '3B Chars', value: '-' },
        { label: '4B Chars', value: '-' },
        { label: 'Invalid', value: '-' },
        { label: 'Profile', value: '-' },
      ])
      profileLimitNote.textContent = ''
      profileFrequencyChart.innerHTML =
        '<div class="analysis-note">No profile data in scope.</div>'
      renderBarRows(profileByteBars, [])
      renderBarRows(profileClassBars, [])
      return
    }

    const byteTotal = latestDataProfile.byteProfile
      .slice(0, 256)
      .reduce((sum, value) => sum + value, 0)
    const asciiPercent = byteTotal > 0
      ? (latestDataProfile.numAscii / byteTotal) * 100
      : 0
    const characterCount = latestDataProfile.characterCount ?? {}
    const dosEolCount = latestDataProfile.byteProfile[256] ?? 0
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
    const modeByte = topProfileBytes[0] ?? null

    renderMetricRows(profileDataMetrics, [
      { label: 'Scope', value: latestDataProfile.scopeLabel },
      { label: 'Bytes', value: byteTotal.toLocaleString() },
      { label: 'DOS EOL', value: dosEolCount.toLocaleString() },
      { label: 'Mode', value: formatModeByte(modeByte, byteTotal) },
      { label: 'ASCII', value: latestDataProfile.numAscii.toLocaleString() + ' / ' + formatPercent(asciiPercent) },
      { label: 'Content', value: latestDataProfile.contentType || '-' },
      { label: 'Language', value: latestDataProfile.language || '-' },
      { label: 'BOM', value: characterCount.byteOrderMark || '-' },
      { label: 'BOM Bytes', value: (characterCount.byteOrderMarkBytes ?? 0).toLocaleString() },
      { label: '1B Chars', value: (characterCount.singleByteCount ?? 0).toLocaleString() },
      { label: '2B Chars', value: (characterCount.doubleByteCount ?? 0).toLocaleString() },
      { label: '3B Chars', value: (characterCount.tripleByteCount ?? 0).toLocaleString() },
      { label: '4B Chars', value: (characterCount.quadByteCount ?? 0).toLocaleString() },
      { label: 'Invalid', value: (characterCount.invalidBytes ?? 0).toLocaleString() },
      { label: 'Profile', value: formatDuration(latestDataProfile.durationMs) },
    ])
    renderBarRows(
      profileClassBars,
      classRowsFromCounts(latestDataProfile.byteProfile, byteTotal)
    )

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
        label: formatByteLabel(entry.byte),
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
      { label: 'Mode', value: formatModeByte(analysis.modeByte, analysis.count) },
      { label: 'Freq Spread', value: formatFrequencySpread(analysis.frequencySpread, analysis.count) },
      { label: 'Printable', value: formatPercent(printablePercent) },
      {
        label: 'Longest Run',
        value: analysis.longestRunByte === null
          ? '-'
          : '0x' + toHex2(analysis.longestRunByte) + ' x ' + analysis.longestRunLength.toLocaleString(),
      },
    ])

    renderHistoryMetrics()
    renderTimingMetrics()
  }

  function renderHistoryMetrics() {
    renderMetricRows(structureHistoryMetrics, [
      { label: 'Undo', value: historyUndoCount.toLocaleString() },
      { label: 'Redo', value: historyRedoCount.toLocaleString() },
      { label: 'Can Undo', value: historyCanUndo ? 'Yes' : 'No' },
      { label: 'Can Redo', value: historyCanRedo ? 'Yes' : 'No' },
    ])
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
  }

  function updateActionStatus(message = '', source = 'generic') {
    statusAction.textContent = message
    replaceSummaryActive = source === 'replace-summary' && message.length > 0
  }

  function flashActionStatus() {
    statusAction.classList.remove('flash')
    void statusAction.offsetWidth
    statusAction.classList.add('flash')
  }

  function clearReplaceSummaryActionStatus() {
    if (replaceSummaryActive) {
      updateActionStatus('')
    }
  }

  function transformOperationLabel(operation) {
    switch (operation) {
      case 1:
        return 'replace'
      case 2:
        return 'inspect'
      case 3:
        return 'replace + inspect'
      default:
        return 'transform'
    }
  }

  function selectedTransformPlugin() {
    return transformPlugins.find((plugin) => plugin.id === transformSelect.value) ?? null
  }

  function advertisedTransformExamples(plugin) {
    const examples = []
    const addExample = (value) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      if (text && !examples.includes(text)) {
        examples.push(text)
      }
    }
    if (plugin?.example) {
      try {
        const parsed = JSON.parse(plugin.example)
        if (Array.isArray(parsed)) {
          for (const example of parsed) {
            addExample(example)
          }
        } else {
          addExample(plugin.example)
        }
      } catch {
        addExample(plugin.example)
      }
    }
    if (plugin?.defaultArgs) {
      addExample(plugin.defaultArgs)
    }
    return examples
  }

  function getTransformOptionHelp(plugin) {
    const description = plugin?.description || plugin?.name || plugin?.id || ''
    const examples = advertisedTransformExamples(plugin)
    return {
      description: description || 'This transform did not advertise a description.',
      help: plugin?.help || '',
      examples,
      defaultArgs: plugin?.defaultArgs || '',
      argsSchema: plugin?.argsSchema || '',
    }
  }

  function validateJsonSchemaValue(value, schema, path) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return null
    }
    if (Array.isArray(schema.oneOf)) {
      const matches = schema.oneOf.filter((candidate) => validateJsonSchemaValue(value, candidate, path) === null)
      return matches.length === 1 ? null : path + ' must match exactly one allowed shape'
    }
    if (schema.not && validateJsonSchemaValue(value, schema.not, path) === null) {
      return path + ' uses a disallowed option combination'
    }
    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return path + ' must be an object'
      }
      const keys = Object.keys(value)
      if (Array.isArray(schema.required)) {
        const missing = schema.required.find((key) => !Object.prototype.hasOwnProperty.call(value, key))
        if (missing) {
          return path + ' is missing "' + missing + '"'
        }
      }
      if (Number.isInteger(schema.maxProperties) && keys.length > schema.maxProperties) {
        return path + ' has too many properties'
      }
      const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
      if (schema.additionalProperties === false) {
        const unknown = keys.find((key) => !Object.prototype.hasOwnProperty.call(properties, key))
        if (unknown) {
          return path + ' has unknown option "' + unknown + '"'
        }
      }
      for (const key of keys) {
        if (properties[key]) {
          const error = validateJsonSchemaValue(value[key], properties[key], path + '.' + key)
          if (error) {
            return error
          }
        }
      }
    }
    if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        return path + ' must be an array'
      }
      if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
        return path + ' must contain at least ' + schema.minItems + ' item'
      }
      if (schema.items) {
        for (let i = 0; i < value.length; i += 1) {
          const error = validateJsonSchemaValue(value[i], schema.items, path + '[' + i + ']')
          if (error) {
            return error
          }
        }
      }
    }
    if (schema.type === 'string') {
      if (typeof value !== 'string') {
        return path + ' must be a string'
      }
      if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
        return path + ' does not match the expected format'
      }
    }
    if (schema.type === 'integer') {
      if (!Number.isInteger(value)) {
        return path + ' must be an integer'
      }
      if (typeof schema.minimum === 'number' && value < schema.minimum) {
        return path + ' must be at least ' + schema.minimum
      }
      if (typeof schema.maximum === 'number' && value > schema.maximum) {
        return path + ' must be at most ' + schema.maximum
      }
    }
    return null
  }

  function validateTransformOptions(plugin, optionsJson) {
    if (optionsJson.length === 0) {
      return null
    }

    let parsedOptions
    try {
      parsedOptions = JSON.parse(optionsJson)
    } catch {
      return 'Invalid transform options JSON'
    }

    if (!plugin?.argsSchema) {
      return 'Selected transform did not advertise an options schema'
    }

    let schema
    try {
      schema = JSON.parse(plugin.argsSchema)
    } catch {
      return 'Selected transform advertised an invalid options schema'
    }
    return validateJsonSchemaValue(parsedOptions, schema, 'options')
  }

  function updateTransformControls() {
    const hasRange = hasSelection() && getSelectionLength() > 0
    transformSelect.disabled = !hasRange
    transformSelect.title = !hasRange
      ? 'Select one or more bytes to transform'
      : transformPlugins.length === 0
        ? 'No transform plugin is available'
        : 'Choose a transform to apply to the selected bytes'
  }

  function requestTransformPlugins() {
    if (transformPluginsRequested) {
      return
    }
    transformPluginsRequested = true
    vscode.postMessage({ type: 'requestTransformPlugins' })
  }

  function renderTransformOptionsDialog() {
    const plugin = selectedTransformPlugin()
    if (!plugin) {
      updateActionStatus('No transform selected')
      return
    }

    const help = getTransformOptionHelp(plugin)
    const savedOptions = transformOptionsByPluginId.get(plugin.id)
    const hasOptionsSchema = !!help.argsSchema
    const selectionStart = getSelectionStart()
    const selectionEnd = getSelectionEnd()
    const selectionLength = getSelectionLength()
    transformOptions.value = hasOptionsSchema ? (savedOptions ?? plugin.defaultArgs ?? '') : ''
    transformOptions.placeholder = help.examples[0]
      ? 'e.g. ' + help.examples[0]
      : 'options JSON'
    transformOptionsField.style.display = hasOptionsSchema ? 'block' : 'none'
    transformOptionsTitle.textContent = plugin.name || plugin.id
    const examplesHtml = help.examples.length > 0
      ? '<div class="help-section-title">Examples</div>' +
        help.examples
          .map((example, index) =>
            '<button type="button" class="help-example" data-example-index="' +
            index +
            '" title="Use this example">' +
            escapeHtml(example) +
            '</button>'
          )
          .join('')
      : ''
    transformOptionsBody.innerHTML =
      '<div class="help-muted">' +
      escapeHtml(plugin.id) +
      ' | ' +
      escapeHtml(transformOperationLabel(plugin.operation)) +
      '</div>' +
      '<div>' +
      escapeHtml(help.description) +
      '</div>' +
      '<div class="help-section-title">Selected Range</div>' +
      '<div class="analysis-metrics">' +
      '<span class="analysis-label">Start</span>' +
      '<span class="analysis-value">' +
      escapeHtml(formatOffsetDisplay(selectionStart)) +
      '</span>' +
      '<span class="analysis-label">End</span>' +
      '<span class="analysis-value">' +
      escapeHtml(formatOffsetDisplay(selectionEnd)) +
      '</span>' +
      '<span class="analysis-label">Length</span>' +
      '<span class="analysis-value">' +
      selectionLength.toLocaleString() +
      ' byte(s)</span>' +
      '</div>' +
      (help.help
        ? '<div class="help-section-title">' +
          (hasOptionsSchema ? 'Options JSON' : 'Help') +
          '</div>' +
          '<div>' +
          escapeHtml(help.help) +
          '</div>'
        : '') +
      examplesHtml
    overlay.classList.add('active')
    transformOptionsDialog.classList.add('active')
    if (hasOptionsSchema) {
      transformOptions.focus()
    } else {
      transformOptionsApply.focus()
    }
  }

  function closeTransformOptionsDialog() {
    if (transformOptionsDialog.contains(document.activeElement)) {
      document.activeElement.blur()
    }
    transformOptionsDialog.classList.remove('active')
    overlay.classList.remove('active')
    transformSelect.value = ''
    updateTransformControls()
  }

  function useTransformOptionExample(index) {
    const help = getTransformOptionHelp(selectedTransformPlugin())
    if (index < 0 || index >= help.examples.length) {
      return
    }
    transformOptions.value = help.examples[index]
    transformOptions.focus()
  }

  function setTransformPlugins(plugins) {
    const previousPluginId = transformSelect.value
    transformPlugins = Array.isArray(plugins) ? plugins : []
    transformPluginsRequested = false

    if (transformPlugins.length === 0) {
      transformSelect.innerHTML = '<option value="">No transforms found</option>'
      updateTransformControls()
      return
    }

    transformSelect.innerHTML =
      '<option value="">Select transform...</option>' +
      transformPlugins
      .map((plugin) => {
        const label = escapeHtml(plugin.name || plugin.id)
        const title = escapeAttribute(
          (plugin.description || plugin.id) +
          ' (' + transformOperationLabel(plugin.operation) + ')'
        )
        return '<option value="' + escapeAttribute(plugin.id) + '" title="' + title + '">' + label + '</option>'
      })
      .join('')

    if (transformPlugins.some((plugin) => plugin.id === previousPluginId)) {
      transformSelect.value = previousPluginId
    }
    updateTransformControls()
  }

  function applySelectedTransform() {
    const plugin = selectedTransformPlugin()
    if (!plugin) {
      updateActionStatus('No transform selected')
      return
    }
    if (!hasSelection()) {
      updateActionStatus('Select one or more bytes to transform')
      return
    }

    const optionsJson = transformOptions.value.trim()
    const validationError = validateTransformOptions(plugin, optionsJson)
    if (validationError) {
      updateActionStatus(validationError)
      return
    }

    const offset = getSelectionStart()
    const length = getSelectionLength()
    if (optionsJson) {
      transformOptionsByPluginId.set(plugin.id, optionsJson)
    } else {
      transformOptionsByPluginId.delete(plugin.id)
    }
    closeTransformOptionsDialog()
    clearReplaceSummaryActionStatus()
    updateActionStatus('Applying ' + (plugin.name || plugin.id) + '...')
    vscode.postMessage({
      type: 'applyTransform',
      pluginId: plugin.id,
      offset,
      length,
      optionsJson: optionsJson || undefined,
    })
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

  function hideByteInspector() {
    byteInspector.classList.remove('active')
    byteInspector.innerHTML = ''
    byteInspectorOffset = -1
    byteInspectorAnchor = null
    byteInspectorEditKey = ''
    byteInspectorEditValue = ''
    byteInspectorEditError = ''
    byteInspectorManuallyPositioned = false
    updateRenderedInspectorAnchor()
  }

  function positionByteInspector(anchor) {
    if (!anchor || !byteInspector.classList.contains('active')) {
      return
    }
    if (byteInspectorManuallyPositioned) {
      return
    }

    const anchorRect = anchor.getBoundingClientRect()
    const popoverRect = byteInspector.getBoundingClientRect()
    const gap = 8
    let left = anchorRect.left
    let top = anchorRect.bottom + gap

    if (left + popoverRect.width > window.innerWidth - 8) {
      left = window.innerWidth - popoverRect.width - 8
    }
    if (top + popoverRect.height > window.innerHeight - 8) {
      top = anchorRect.top - popoverRect.height - gap
    }

    byteInspector.style.left = Math.max(8, left) + 'px'
    byteInspector.style.top = Math.max(8, top) + 'px'
  }

  function renderByteInspector() {
    if (byteInspectorOffset < 0) {
      hideByteInspector()
      return
    }

    const bytes = getInspectorBytes(byteInspectorOffset)
    if (bytes.length === 0) {
      hideByteInspector()
      return
    }

    const le = inspectorLittleEndian
    const endianLabel = le ? 'LE' : 'BE'
    let rows = ''

    for (const field of inspectorFields) {
      const available = bytes.length >= field.minBytes
      const value = available ? field.read(bytes, le) : 'End of file'
      const editable = available && field.editable
      rows += '<div class="byte-inspector-row" data-field-row="' + escapeAttribute(field.key) + '">' +
        '<span class="byte-inspector-label">' + escapeHtml(field.label) + '</span>'

      if (byteInspectorEditKey === field.key && editable) {
        const editValue = byteInspectorEditValue || (field.editValue ? field.editValue(bytes, le) : value)
        rows += '<span class="byte-inspector-edit">' +
          '<input id="byteInspectorInput" value="' + escapeAttribute(editValue) + '"' +
            (byteInspectorEditError ? ' class="invalid"' : '') +
            ' data-field="' + escapeAttribute(field.key) + '" />' +
          '<button class="secondary" data-inspector-commit="' + escapeAttribute(field.key) + '">OK</button>' +
          '<button class="secondary" data-inspector-cancel="true">x</button>' +
        '</span>'
      } else if (editable) {
        rows += '<button class="byte-inspector-value" data-inspector-edit="' +
          escapeAttribute(field.key) +
          '">' +
          escapeHtml(value) +
        '</button>'
      } else {
        rows += '<span class="byte-inspector-value readonly">' + escapeHtml(value) + '</span>'
      }

      rows += '</div>'
    }

    byteInspector.innerHTML =
      '<div class="byte-inspector-header">' +
        '<span>' +
          '<span class="byte-inspector-title">' + escapeHtml(formatOffsetDisplay(byteInspectorOffset)) + '</span>' +
          '<span class="byte-inspector-meta">' + escapeHtml(bytesToSpacedHex(bytes)) + '</span>' +
        '</span>' +
        '<span class="byte-inspector-actions">' +
          '<button class="status-inline-button" data-inspector-endian="true" title="Toggle inspector endianness">' + endianLabel + '</button>' +
        '</span>' +
      '</div>' +
      '<div class="byte-inspector-grid">' + rows + '</div>' +
      '<div class="byte-inspector-error">' + escapeHtml(byteInspectorEditError) + '</div>'

    byteInspector.classList.add('active')
    byteInspectorAnchor = resolveByteInspectorAnchor(
      byteInspectorOffset,
      byteInspectorAnchor
    )
    updateRenderedInspectorAnchor()
    positionByteInspector(byteInspectorAnchor)

    const input = document.getElementById('byteInspectorInput')
    if (input) {
      input.focus()
      input.select()
    }
  }

  function showByteInspector(offset, anchor) {
    const resolvedAnchor = resolveByteInspectorAnchor(offset, anchor)
    if (!resolvedAnchor) {
      return false
    }
    byteInspectorOffset = offset
    byteInspectorAnchor = resolvedAnchor
    byteInspectorEditKey = ''
    byteInspectorEditValue = ''
    byteInspectorEditError = ''
    byteInspectorManuallyPositioned = false
    renderByteInspector()
    return true
  }

  function setByteInspectorCandidate(offset, anchor) {
    byteInspectorCandidateOffset = offset
    byteInspectorCandidateAnchor = anchor
  }

  function clearByteInspectorCandidate() {
    byteInspectorCandidateOffset = -1
    byteInspectorCandidateAnchor = null
  }

  function byteInspectorLaunchTarget() {
    const activeInspector = byteInspector.classList.contains('active')
    const offset = activeInspector && byteInspectorOffset >= 0
      ? byteInspectorOffset
      : byteInspectorCandidateOffset >= 0
        ? byteInspectorCandidateOffset
        : selectedOffset

    if (offset < 0 || getInspectorBytes(offset).length === 0) {
      return null
    }

    const preferredAnchor = activeInspector && offset === byteInspectorOffset
      ? byteInspectorAnchor
      : byteInspectorCandidateOffset === offset
        ? byteInspectorCandidateAnchor
        : null
    const anchor = resolveByteInspectorAnchor(offset, preferredAnchor)
    return anchor ? { offset, anchor } : null
  }

  function commitByteInspectorEdit(fieldKey) {
    const field = inspectorFields.find((candidate) => candidate.key === fieldKey)
    const input = document.getElementById('byteInspectorInput')
    if (!field || !input || byteInspectorOffset < 0) {
      return
    }

    try {
      const data = field.write(input.value, inspectorLittleEndian)
      clearReplaceSummaryActionStatus()
      vscode.postMessage({
        type: 'overwrite',
        offset: byteInspectorOffset,
        data: data,
      })
      selectRange(byteInspectorOffset, data.length / 2)
      updateActionStatus('Wrote ' + (data.length / 2).toLocaleString() + ' byte(s)')
      byteInspectorEditKey = ''
      byteInspectorEditValue = ''
      byteInspectorEditError = ''
      renderByteInspector()
    } catch (error) {
      byteInspectorEditValue = input.value
      byteInspectorEditError = error instanceof Error ? error.message : String(error)
      renderByteInspector()
    }
  }

  function toggleByteInspector() {
    if (byteInspector.classList.contains('active')) {
      hideByteInspector()
      return true
    }
    const target = byteInspectorLaunchTarget()
    if (!target) {
      return false
    }
    return showByteInspector(target.offset, target.anchor)
  }

  function stopByteInspectorDrag(pointerId) {
    if (!byteInspectorDragging) {
      return
    }
    byteInspectorDragging = false
    byteInspector
      .querySelector('.byte-inspector-header')
      ?.classList.remove('dragging')
    if (
      typeof pointerId === 'number' &&
      byteInspector.hasPointerCapture?.(pointerId)
    ) {
      byteInspector.releasePointerCapture(pointerId)
    }
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

  function updateFindWidgetVisibility() {
    findWidget.classList.toggle('visible', findWidgetVisible)
    findWidget.classList.toggle('replace-visible', findReplaceVisible)
    findWidget.setAttribute('aria-hidden', findWidgetVisible ? 'false' : 'true')
    findReplaceToggle.innerHTML = findReplaceVisible ? '&#8964;' : '&#8250;'
    findReplaceToggle.title = findReplaceVisible ? 'Hide replace' : 'Show replace'
  }

  function openFindWidget(showReplace = false) {
    findWidgetVisible = true
    findReplaceVisible = findReplaceVisible || showReplace
    updateFindWidgetVisibility()
    window.setTimeout(() => {
      ;(showReplace ? replaceInput : searchInput).focus()
      ;(showReplace ? replaceInput : searchInput).select()
    }, 0)
  }

  function closeFindWidget() {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }
    findWidgetVisible = false
    updateFindWidgetVisibility()
    hexContainer.focus()
  }

  function toggleFindReplace() {
    findReplaceVisible = !findReplaceVisible
    updateFindWidgetVisibility()
    if (findReplaceVisible) {
      replaceInput.focus()
    }
  }

  function updateEditModeStatus() {
    editModeBtn.textContent = byteEditMode === 'insert' ? 'Insert' : 'Overwrite'
    editModeBtn.title = byteEditMode === 'insert'
      ? 'Switch to overwrite mode'
      : 'Switch to insert mode'
  }

  function toggleByteEditMode() {
    byteEditMode = byteEditMode === 'insert' ? 'overwrite' : 'insert'
    pendingHexNibble = null
    updateEditModeStatus()
    updateActionStatus('Edit mode: ' + editModeBtn.textContent)
  }

  function updateHistoryState(canUndo, canRedo, undoCount = 0, redoCount = 0) {
    historyCanUndo = !!canUndo
    historyCanRedo = !!canRedo
    historyUndoCount = undoCount
    historyRedoCount = redoCount
    renderHistoryMetrics()
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
    hideByteInspector()
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

  function updateRenderedInspectorAnchor() {
    if (!hexContainer) {
      return
    }

    hexContainer
      .querySelectorAll('.inspector-anchor')
      .forEach((el) => el.classList.remove('inspector-anchor'))

    const hasActiveInspector =
      byteInspectorOffset >= 0 && byteInspector.classList.contains('active')
    if (!hasActiveInspector) {
      return
    }

    hexContainer
      .querySelectorAll('[data-offset="' + byteInspectorOffset + '"]')
      .forEach((el) => el.classList.add('inspector-anchor'))
  }

  function selectOffset(offset, extendSelection = false) {
    if (offset < 0 || fileSize <= 0) {
      selectedOffset = -1
      selectionAnchor = -1
      updateSelectedStatus()
      updateRenderedSelection()
      updateAnalysisPanels()
      updateTransformControls()
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
    updateTransformControls()
    requestAnalysisProfile()
  }

  function selectRange(offset, length) {
    if (offset < 0 || fileSize <= 0) {
      selectOffset(-1)
      return
    }

    if (length <= 1) {
      selectOffset(offset)
      return
    }

    const selectionStart = clampOffset(offset)
    const selectionEnd = clampOffset(offset + length - 1)
    selectionAnchor = selectionStart
    selectedOffset = Math.max(selectionStart, selectionEnd)
    updateSelectedStatus()
    updateRenderedSelection()
    updateAnalysisPanels()
    updateTransformControls()
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

  function parseClipboardTextAsBase64(text) {
    const compact = text.trim().replace(/\s/g, '')
    if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
      return null
    }
    try {
      const binary = atob(compact)
      return Array.from(binary, (char) =>
        char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
      ).join('')
    } catch {
      return null
    }
  }

  function bytesToDisplayText(bytes) {
    return bytes
      .map((byte) => (isPrintable(byte) ? String.fromCharCode(byte) : '?'))
      .join('')
  }

  function setActivePane(pane) {
    activePane = pane === 'ascii' ? 'ascii' : 'hex'
  }

  function getClipboardFormat() {
    return activePane === 'ascii' ? 'utf8' : 'hex'
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

  function writeVisibleSelectionClipboard(clipboardData, selectedBytes) {
    if (!clipboardData) {
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
    return true
  }

  function postSelectionClipboard(action) {
    if (!hasSelection() || getSelectionLength() <= 0) {
      updateActionStatus('Select one or more bytes to ' + action)
      return false
    }

    vscode.postMessage({
      type: action === 'cut' ? 'cutSelection' : 'copySelection',
      offset: getSelectionStart(),
      length: getSelectionLength(),
      format: getClipboardFormat(),
    })
    updateActionStatus(
      (action === 'cut' ? 'Cutting ' : 'Copying ') +
      getSelectionLength().toLocaleString() +
      ' byte(s)'
    )
    return true
  }

  function handleCopyEvent(clipboardData) {
    const selectedBytes = getSelectedBytes()
    if (selectedBytes && selectedBytes.length > 0) {
      if (!writeVisibleSelectionClipboard(clipboardData, selectedBytes)) {
        return postSelectionClipboard('copy')
      }
      updateActionStatus(
        'Copied ' +
        getSelectionLength().toLocaleString() +
        ' byte(s) as ' +
        (activePane === 'ascii' ? 'text' : 'hex')
      )
      return true
    }

    return postSelectionClipboard('copy')
  }

  function getPasteAnchorElement(target) {
    return target?.closest?.('[data-offset]') ??
      hexContainer.querySelector('[data-offset="' + selectedOffset + '"]') ??
      hexContainer
  }

  function pasteEncodingOptions(context) {
    return {
      utf8: context.plainText.length > 0,
      hex:
        !!context.internalHex ||
        (context.plainText.length > 0 &&
          normalizedHexQuery(context.plainText) !== null),
      base64: parseClipboardTextAsBase64(context.plainText) !== null,
    }
  }

  function decodePasteContext(context) {
    if (!context) {
      return null
    }

    if (context.encoding === 'hex') {
      return context.internalHex || normalizedHexQuery(context.plainText)
    }
    if (context.encoding === 'base64') {
      return parseClipboardTextAsBase64(context.plainText)
    }
    return context.plainText ? utf8ToHex(context.plainText) : null
  }

  function pasteReplaceLength(context, pasteHex) {
    if (context.target.type === 'replace') {
      return context.target.length
    }
    return Math.min(pasteHex.length / 2, Math.max(0, fileSize - context.target.offset))
  }

  function positionPastePopover(anchor) {
    const rect = anchor.getBoundingClientRect()
    pastePopover.style.left = '0px'
    pastePopover.style.top = '0px'
    pastePopover.classList.add('active')
    const popoverRect = pastePopover.getBoundingClientRect()
    const left = clamp(8, rect.left, window.innerWidth - popoverRect.width - 8)
    const below = rect.bottom + 8
    const top = below + popoverRect.height <= window.innerHeight - 8
      ? below
      : clamp(8, rect.top - popoverRect.height - 8, window.innerHeight - popoverRect.height - 8)
    pastePopover.style.left = left + 'px'
    pastePopover.style.top = top + 'px'
  }

  function renderPastePopover() {
    if (!pasteContext) {
      pastePopover.classList.remove('active')
      pastePopover.innerHTML = ''
      return
    }

    const options = pasteEncodingOptions(pasteContext)
    const pasteHex = decodePasteContext(pasteContext)
    const byteCount = pasteHex ? pasteHex.length / 2 : 0
    const encodingRadio = (value, label) =>
      '<label' + (options[value] ? '' : ' class="disabled"') + '>' +
      '<input type="radio" name="pasteEncoding" value="' + value + '"' +
      (pasteContext.encoding === value ? ' checked' : '') +
      (options[value] ? '' : ' disabled') +
      ' />' +
      label +
      '</label>'
    const modeRadio = (value, label) =>
      '<label>' +
      '<input type="radio" name="pasteMode" value="' + value + '"' +
      (pasteContext.mode === value ? ' checked' : '') +
      ' />' +
      label +
      '</label>'

    pastePopover.innerHTML =
      '<div class="paste-popover-title">Paste</div>' +
      '<div class="paste-popover-row">' +
        '<div class="paste-popover-label">As</div>' +
        '<div class="paste-popover-options">' +
          encodingRadio('utf8', 'UTF-8') +
          encodingRadio('hex', 'Hex') +
          encodingRadio('base64', 'Base64') +
        '</div>' +
      '</div>' +
      '<div class="paste-popover-row">' +
        '<div class="paste-popover-label">Mode</div>' +
        '<div class="paste-popover-options">' +
          modeRadio('replace', pasteContext.target.type === 'replace' ? 'Replace selection' : 'Replace') +
          modeRadio('insert', 'Insert') +
        '</div>' +
      '</div>' +
      '<div class="paste-popover-error">' +
        (pasteHex ? '' : 'Choose a valid encoding') +
      '</div>' +
      '<div class="paste-popover-actions">' +
        '<button class="secondary" data-paste-action="cancel">Cancel</button>' +
        '<button data-paste-action="apply"' + (pasteHex ? '' : ' disabled') + '>' +
          (pasteContext.mode === 'replace' ? 'Replace ' : 'Insert ') +
          byteCount.toLocaleString() +
          ' byte(s)' +
        '</button>' +
      '</div>'

    positionPastePopover(pasteContext.anchor)
  }

  function hidePastePopover() {
    pasteContext = null
    renderPastePopover()
  }

  function showPastePopover(clipboardData, anchorTarget) {
    const internalHex = clipboardData?.getData(INTERNAL_HEX_CLIPBOARD_FORMAT) ?? ''
    const plainText =
      clipboardData?.getData('text/plain') ||
      clipboardData?.getData('text') ||
      ''
    const target = getPasteTarget()
    const options = {
      internalHex,
      plainText,
    }
    const available = pasteEncodingOptions(options)
    const preferredEncoding =
      internalHex || (activePane === 'hex' && available.hex)
        ? 'hex'
        : available.utf8
          ? 'utf8'
          : available.base64
            ? 'base64'
            : 'utf8'
    pasteContext = {
      ...options,
      target,
      anchor: getPasteAnchorElement(anchorTarget),
      encoding: preferredEncoding,
      mode: target.type === 'replace' || byteEditMode === 'overwrite' ? 'replace' : 'insert',
    }
    renderPastePopover()
    return true
  }

  function applyPasteContext() {
    const pasteHex = decodePasteContext(pasteContext)
    if (!pasteHex) {
      updateActionStatus('Clipboard is empty')
      return false
    }

    if (pasteContext.mode === 'replace') {
      const length = pasteReplaceLength(pasteContext, pasteHex)
      if (length <= 0 && fileSize > 0) {
        updateActionStatus('No bytes available to replace')
        return false
      }
      clearReplaceSummaryActionStatus()
      vscode.postMessage({
        type: 'replace',
        offset: pasteContext.target.offset,
        length,
        data: pasteHex,
      })
    } else {
      clearReplaceSummaryActionStatus()
      vscode.postMessage({
        type: 'insert',
        offset: pasteContext.target.offset,
        data: pasteHex,
      })
    }

    updateActionStatus(
      'Pasted ' + (pasteHex.length / 2).toLocaleString() + ' byte(s)'
    )
    hidePastePopover()
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

  function selectedEditOffset() {
    if (hasSelection()) {
      return getSelectionStart()
    }
    return fileSize > 0 ? clampOffset(visibleOffset) : 0
  }

  function postDeleteRange(offset, length) {
    if (length <= 0 || fileSize <= 0) {
      return
    }
    clearReplaceSummaryActionStatus()
    vscode.postMessage({
      type: 'delete',
      offset: offset,
      length: length,
    })
    selectOffset(Math.min(offset, Math.max(0, fileSize - length - 1)))
  }

  function deleteFromKeyboard(backward = false) {
    if (fileSize <= 0) {
      return
    }

    if (hasSelection() && getSelectionLength() > 1) {
      postDeleteRange(getSelectionStart(), getSelectionLength())
      return
    }

    const offset = selectedEditOffset()
    if (backward) {
      if (offset <= 0) {
        return
      }
      postDeleteRange(offset - 1, 1)
      return
    }

    postDeleteRange(offset, 1)
  }

  function applyTypedByte(byte) {
    const offset = selectedEditOffset()
    const data = toHex2(byte)
    clearReplaceSummaryActionStatus()

    if (byteEditMode === 'insert' || fileSize <= 0 || offset >= fileSize) {
      vscode.postMessage({
        type: 'insert',
        offset: offset,
        data: data,
      })
      updateActionStatus('Inserted 1 byte')
    } else {
      vscode.postMessage({
        type: 'overwrite',
        offset: offset,
        data: data,
      })
      updateActionStatus('Overwrote 1 byte')
    }

    pendingHexNibble = null
    selectOffset(Math.min(offset + 1, Math.max(0, fileSize - 1)))
  }

  function handleTypedByteKey(e) {
    if (!hasSelection() && fileSize > 0) {
      return false
    }

    if (activePane === 'ascii') {
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) {
        return false
      }
      const byte = e.key.charCodeAt(0)
      if (byte > 0xff) {
        updateActionStatus('Text pane edits support one-byte characters')
        return true
      }
      applyTypedByte(byte)
      return true
    }

    const hexDigit = /^[0-9a-f]$/i.test(e.key) ? parseInt(e.key, 16) : null
    if (hexDigit === null) {
      return false
    }

    if (pendingHexNibble === null) {
      pendingHexNibble = hexDigit
      updateActionStatus('Hex edit: ' + e.key.toUpperCase() + '_')
      return true
    }

    applyTypedByte((pendingHexNibble << 4) | hexDigit)
    return true
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
          const asciiClass = byteTextClass(b)
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
    if (byteInspector.classList.contains('active')) {
      renderByteInspector()
    }
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
        updateHistoryState(
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

      case 'transformPlugins':
        setTransformPlugins(msg.plugins ?? [])
        if (msg.error) {
          updateActionStatus('Transform plugins unavailable: ' + msg.error)
        }
        break

      case 'transformComplete':
        if (msg.contentChanged) {
          clearSearchResults()
        }
        if (typeof msg.offset === 'number' && msg.offset >= 0) {
          const transformedLength = msg.contentChanged
            ? (msg.replacementLength ?? msg.length ?? 1)
            : (msg.length ?? 1)
          selectRange(msg.offset, transformedLength)
        }
        if (msg.resultText) {
          updateActionStatus(
            (msg.resultLabel || 'Result') + ': ' + msg.resultText
          )
          flashActionStatus()
        } else if (msg.contentChanged) {
          updateActionStatus(
            'Transformed ' +
            (msg.length ?? 0).toLocaleString() +
            ' byte(s) into ' +
            (msg.replacementLength ?? 0).toLocaleString() +
            ' byte(s)'
          )
        } else {
          updateActionStatus('Transform completed')
        }
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

      case 'clipboardComplete':
        updateActionStatus(
          (msg.action === 'cut' ? 'Cut ' : 'Copied ') +
          (msg.byteCount ?? 0).toLocaleString() +
          ' byte(s) as ' +
          (msg.format === 'utf8' ? 'text' : 'hex')
        )
        break

      case 'cutComplete':
        selectOffset(msg.offset ?? -1)
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
      clearByteInspectorCandidate()
      updateHoverHighlights(-1, -1)
      return
    }

    const offset = parseInt(target.dataset.offset, 10)
    if (Number.isNaN(offset)) {
      clearByteInspectorCandidate()
      updateHoverHighlights(-1, -1)
      return
    }

    setByteInspectorCandidate(offset, target)
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
    clearByteInspectorCandidate()
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
    setByteInspectorCandidate(offset, target)
    hideByteInspector()
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
    if (e.key === 'Escape' && transformOptionsDialog.classList.contains('active')) {
      e.preventDefault()
      closeTransformOptionsDialog()
      return
    }

    if (isEditableTarget(e.target)) {
      return
    }

    if (e.key === 'Escape' && pastePopover.classList.contains('active')) {
      e.preventDefault()
      hidePastePopover()
    } else if (e.shiftKey && e.key === ' ') {
      if (toggleByteInspector()) {
        e.preventDefault()
      }
    } else if (e.key === 'Escape' && byteInspector.classList.contains('active')) {
      e.preventDefault()
      hideByteInspector()
    } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      openFindWidget(false)
    } else if (e.ctrlKey && e.key.toLowerCase() === 'h') {
      e.preventDefault()
      openFindWidget(true)
    } else if (e.ctrlKey && e.key === 'g') {
      e.preventDefault()
      // Go to offset — trigger via VS Code command instead
    } else if (e.key === 'Insert') {
      e.preventDefault()
      toggleByteEditMode()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      pendingHexNibble = null
      moveSelection('left', e.shiftKey)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      pendingHexNibble = null
      moveSelection('right', e.shiftKey)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      pendingHexNibble = null
      moveSelection('up', e.shiftKey)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      pendingHexNibble = null
      moveSelection('down', e.shiftKey)
    } else if (e.key === 'Delete') {
      e.preventDefault()
      pendingHexNibble = null
      deleteFromKeyboard(false)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      pendingHexNibble = null
      deleteFromKeyboard(true)
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      pendingHexNibble = null
      scrollToViewportOffset(
        visibleOffset + Math.max(BYTES_PER_ROW, currentVisibleByteCount())
      )
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      pendingHexNibble = null
      scrollToViewportOffset(
        visibleOffset - Math.max(BYTES_PER_ROW, currentVisibleByteCount())
      )
    } else if (e.key === 'Home') {
      e.preventDefault()
      pendingHexNibble = null
      scrollToViewportOffset(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      pendingHexNibble = null
      scrollToViewportOffset(Math.max(0, fileSize - BYTES_PER_ROW))
    } else if (handleTypedByteKey(e)) {
      e.preventDefault()
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

    if (!hasSelection() || getSelectionLength() <= 0 || fileSize <= 0) {
      updateActionStatus('Select one or more bytes to cut')
      return
    }

    e.preventDefault()
    const selectedBytes = getSelectedBytes()
    if (selectedBytes && selectedBytes.length > 0) {
      writeVisibleSelectionClipboard(e.clipboardData, selectedBytes)
    }
    postSelectionClipboard('cut')
  })

  document.addEventListener('paste', (e) => {
    if (isEditableTarget(e.target)) {
      return
    }

    if (showPastePopover(e.clipboardData, e.target)) {
      e.preventDefault()
    }
  })

  pastePopover.addEventListener('change', (e) => {
    if (!pasteContext || !(e.target instanceof HTMLInputElement)) {
      return
    }
    if (e.target.name === 'pasteEncoding') {
      pasteContext.encoding = e.target.value
      renderPastePopover()
    } else if (e.target.name === 'pasteMode') {
      pasteContext.mode = e.target.value
      renderPastePopover()
    }
  })

  pastePopover.addEventListener('click', (e) => {
    const action = e.target?.dataset?.pasteAction
    if (action === 'cancel') {
      hidePastePopover()
    } else if (action === 'apply') {
      applyPasteContext()
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

  function scheduleSearch() {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }

    if (!findWidgetVisible) {
      return
    }

    if (searchInput.value.trim().length === 0) {
      clearSearchResults()
      return
    }

    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null
      doSearch()
    }, 200)
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
  findReplaceToggle.addEventListener('click', toggleFindReplace)
  findCloseBtn.addEventListener('click', closeFindWidget)
  editModeBtn.addEventListener('click', toggleByteEditMode)
  profileTab.addEventListener('click', () => setAnalysisMode('profile'))
  structureTab.addEventListener('click', () => setAnalysisMode('structure'))
  profileScaleBtn.addEventListener('click', () => {
    frequencyScale = frequencyScale === 'log' ? 'linear' : 'log'
    updateProfileAnalysis()
  })
  analysisPane.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-analysis-drag]')
    if (!handle || e.button !== 0) {
      return
    }

    const section = handle.closest('[data-analysis-section]')
    const panel = section?.closest('[data-analysis-panel]')
    const panelName = panel?.dataset.analysisPanel
    const sectionId = section?.dataset.analysisSection
    if (!section || !panelName || !sectionId) {
      return
    }

    e.preventDefault()
    analysisDragState = {
      handle,
      panelName,
      section,
      sectionId,
    }
    section.classList.add('dragging')
    handle.classList.add('dragging')
    handle.setPointerCapture(e.pointerId)
  })
  analysisPane.addEventListener('pointermove', handleAnalysisSectionDragMove)
  analysisPane.addEventListener('pointerup', (e) => {
    stopAnalysisSectionDrag(e.pointerId)
  })
  analysisPane.addEventListener('pointercancel', (e) => {
    stopAnalysisSectionDrag(e.pointerId)
  })
  analysisPane.addEventListener('keydown', (e) => {
    const handle = e.target.closest('[data-analysis-drag]')
    if (!handle) {
      return
    }

    const section = handle.closest('[data-analysis-section]')
    const panelName = section?.closest('[data-analysis-panel]')?.dataset.analysisPanel
    const sectionId = section?.dataset.analysisSection
    if (!panelName || !sectionId) {
      return
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (moveAnalysisSectionByDelta(panelName, sectionId, e.key === 'ArrowUp' ? -1 : 1)) {
        e.preventDefault()
      }
    }
  })
  profileFrequencyChart.addEventListener('pointermove', updateFrequencyTooltip)
  profileFrequencyChart.addEventListener('pointerleave', hideFrequencyTooltip)
  byteInspector.addEventListener('click', (e) => {
    const endianToggle = e.target.closest('[data-inspector-endian]')
    if (endianToggle) {
      inspectorLittleEndian = !inspectorLittleEndian
      updateInspectorEndianLabel()
      updateInspectorStatus()
      byteInspectorEditKey = ''
      byteInspectorEditValue = ''
      byteInspectorEditError = ''
      renderByteInspector()
      return
    }

    const editButton = e.target.closest('[data-inspector-edit]')
    if (editButton) {
      byteInspectorEditKey = editButton.dataset.inspectorEdit
      const field = inspectorFields.find((candidate) => candidate.key === byteInspectorEditKey)
      const bytes = getInspectorBytes(byteInspectorOffset)
      byteInspectorEditValue = field && bytes.length >= field.minBytes
        ? (field.editValue ? field.editValue(bytes, inspectorLittleEndian) : field.read(bytes, inspectorLittleEndian))
        : ''
      byteInspectorEditError = ''
      renderByteInspector()
      return
    }

    const commitButton = e.target.closest('[data-inspector-commit]')
    if (commitButton) {
      commitByteInspectorEdit(commitButton.dataset.inspectorCommit)
      return
    }

    if (e.target.closest('[data-inspector-cancel]')) {
      byteInspectorEditKey = ''
      byteInspectorEditValue = ''
      byteInspectorEditError = ''
      renderByteInspector()
    }
  })
  byteInspector.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'byteInspectorInput') {
      e.preventDefault()
      commitByteInspectorEdit(e.target.dataset.field)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (byteInspectorEditKey) {
        byteInspectorEditKey = ''
        byteInspectorEditValue = ''
        byteInspectorEditError = ''
        renderByteInspector()
      } else {
        hideByteInspector()
      }
    } else if (e.shiftKey && e.key === ' ' && e.target.id !== 'byteInspectorInput') {
      e.preventDefault()
      toggleByteInspector()
    }
  })
  byteInspector.addEventListener('pointerdown', (e) => {
    const header = e.target.closest('.byte-inspector-header')
    if (!header || e.button !== 0) {
      return
    }
    e.preventDefault()
    byteInspectorDragging = true
    byteInspectorDragOffsetX = e.clientX - parseFloat(byteInspector.style.left || '0')
    byteInspectorDragOffsetY = e.clientY - parseFloat(byteInspector.style.top || '0')
    header.classList.add('dragging')
    byteInspector.setPointerCapture(e.pointerId)
  })
  byteInspector.addEventListener('pointermove', (e) => {
    if (!byteInspectorDragging) {
      return
    }
    const newLeft = clamp(0, e.clientX - byteInspectorDragOffsetX, window.innerWidth - byteInspector.offsetWidth)
    const newTop = clamp(0, e.clientY - byteInspectorDragOffsetY, window.innerHeight - byteInspector.offsetHeight)
    byteInspector.style.left = newLeft + 'px'
    byteInspector.style.top = newTop + 'px'
    byteInspectorManuallyPositioned = true
  })
  byteInspector.addEventListener('pointerup', (e) => {
    stopByteInspectorDrag(e.pointerId)
  })
  byteInspector.addEventListener('pointercancel', (e) => {
    stopByteInspectorDrag(e.pointerId)
  })
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
    scheduleSearch()
  })
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeFindWidget()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey && !prevMatchBtn.disabled) {
        prevMatchBtn.click()
      } else if (!hasSearchResults() && !searchBtn.disabled) {
        doSearch()
      } else if (!nextMatchBtn.disabled) {
        nextMatchBtn.click()
      }
    }
  })
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeFindWidget()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      replaceCurrentMatch()
    }
  })
  inspectorEndianBtn.addEventListener('click', () => {
    inspectorLittleEndian = !inspectorLittleEndian
    updateInspectorEndianLabel()
    updateInspectorStatus()
    if (byteInspector.classList.contains('active')) {
      byteInspectorEditKey = ''
      byteInspectorEditValue = ''
      byteInspectorEditError = ''
      renderByteInspector()
    }
  })
  transformSelect.addEventListener('pointerdown', () => {
    if (!transformSelect.disabled) {
      requestTransformPlugins()
    }
  })
  transformSelect.addEventListener('focus', () => {
    if (!transformSelect.disabled && !transformPluginsRequested) {
      requestTransformPlugins()
    }
  })
  transformSelect.addEventListener('change', () => {
    updateTransformControls()
    if (selectedTransformPlugin()) {
      renderTransformOptionsDialog()
    }
  })
  transformOptions.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !transformOptionsApply.disabled) {
      applySelectedTransform()
    }
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

  function closeDialogs() {
    closeEditDialog()
    closeTransformOptionsDialog()
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

  document.getElementById('editCancel').addEventListener('click', closeEditDialog)
  document.getElementById('editOk').addEventListener('click', submitEdit)
  overlay.addEventListener('click', closeDialogs)
  transformOptionsCancel.addEventListener('click', closeTransformOptionsDialog)
  transformOptionsApply.addEventListener('click', applySelectedTransform)
  transformOptionsBody.addEventListener('click', (e) => {
    const exampleButton = e.target.closest('.help-example[data-example-index]')
    if (!exampleButton) {
      return
    }
    const index = parseInt(exampleButton.dataset.exampleIndex, 10)
    if (!Number.isNaN(index)) {
      useTransformOptionExample(index)
    }
  })

  // Submit on Enter inside the edit dialog
  editData.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEdit() })
  editLength.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEdit() })
  editOffset.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEdit() })

  updateSearchButtons()
  updateFindWidgetVisibility()
  updateEditModeStatus()
  updateHistoryState(false, false)
  syncSearchMode()
  updateDirtyStatus(false)
  updateActionStatus('')
  updateInspectorEndianLabel()
  updateInspectorStatus()
  updateTransformControls()
  updateServerHealthStatus(null)
  updateOffsetStatus()
  updateSelectedStatus()
  updateProgressStatus()
  applyAnalysisSectionOrders()
  updateAnalysisTabs()
  updateAnalysisPanels()
  renderColumnHeader()
  reportViewportMetrics()
  requestTransformPlugins()
})()
</script>
</body>
</html>`
}
