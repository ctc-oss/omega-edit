const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const packageJson = require('../package.json')
const {
  OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
  OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
  OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_VIEW_TYPE,
} = require('../out/constants.js')
const { getWebviewContent } = require('../out/webview.js')

test('package.json matches shared extension constants', () => {
  assert.equal(packageJson.main, './out/extension.js')
  assert.deepEqual(packageJson.activationEvents, [
    `onCustomEditor:${OMEGA_EDIT_VIEW_TYPE}`,
    `onCommand:${OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND}`,
    `onCommand:${OMEGA_EDIT_GO_TO_OFFSET_COMMAND}`,
    `onCommand:${OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND}`,
    `onCommand:${OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND}`,
  ])
  assert.equal(
    packageJson.contributes.customEditors[0].viewType,
    OMEGA_EDIT_VIEW_TYPE
  )
  assert.equal(
    packageJson.contributes.commands[0].command,
    OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[1].command,
    OMEGA_EDIT_GO_TO_OFFSET_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[2].command,
    OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[3].command,
    OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND
  )
})

test('compiled extension entrypoints exist after build', () => {
  assert.equal(
    fs.existsSync(path.resolve(__dirname, '../out/extension.js')),
    true
  )
  assert.equal(
    fs.existsSync(path.resolve(__dirname, '../out/hexEditorProvider.js')),
    true
  )
  assert.equal(
    fs.existsSync(path.resolve(__dirname, '../out/webview.js')),
    true
  )

  const providerJs = fs.readFileSync(
    path.resolve(__dirname, '../out/hexEditorProvider.js'),
    'utf8'
  )
  assert.match(providerJs, /editSimple/)
  assert.match(providerJs, /getSegment/)
  assert.match(providerJs, /kind:\s*['"]REPLACE['"]/)
  assert.match(providerJs, /startServerHeartbeatLoop/)
  assert.match(providerJs, /getServerInfo/)
})

test('webview HTML includes core controls and configured row width', () => {
  const html = getWebviewContent(32)

  assert.match(html, /const BYTES_PER_ROW = 32/)
  assert.match(html, /id="hexContainer"/)
  assert.match(html, /id="hexHeader"/)
  assert.match(html, /id="hexColumnHeader"/)
  assert.match(html, /id="bytesPerRowSelect"/)
  assert.match(html, /id="offsetRadixSelect"/)
  assert.match(html, /id="searchDirectionSelect"/)
  assert.match(html, /class="secondary" id="searchBtn"/)
  assert.match(html, /id="replaceInput"/)
  assert.match(html, /id="replaceBtn"/)
  assert.match(html, /id="replaceAllBtn"/)
  assert.match(html, /id="topBtn"/)
  assert.match(html, /id="bottomBtn"/)
  assert.match(html, /id="scrollbarTrack"/)
  assert.match(html, /id="scrollbarThumb"/)
  assert.match(html, /class="secondary" id="saveBtn"/)
  assert.match(html, /id="saveAsBtn"/)
  assert.match(html, /id="editDialog"/)
  assert.match(html, /id="searchCaseLabel"/)
  assert.match(html, /id="statusDirty"/)
  assert.match(html, /id="statusAction"/)
  assert.match(html, /id="statusInspector"/)
  assert.match(html, /id="inspectorEndianBtn"/)
  assert.match(html, /id="serverHealthDot"/)
  assert.match(html, /id="serverHealthSummary"/)
  assert.match(html, /id="serverHealthBadge"/)
  assert.match(html, /id="serverHealthMetrics"/)
  assert.match(html, /id="statusProgress"/)
  assert.match(html, /title="Undo \(Ctrl\+Z\)">Undo<\/button>/)
  assert.match(html, /title="Redo \(Ctrl\+Y\)">Redo<\/button>/)
  assert.match(html, /grid-template-columns: repeat\(32, 1ch\);/)
  assert.match(html, /min-width: calc\(32ch \+ 12px\);/)
  assert.match(
    html,
    /--selected-fg: var\(--vscode-editor-selectionForeground, var\(--fg\)\);/
  )
  assert.match(
    html,
    /--offset-column-fg: var\(--vscode-terminal-ansiCyan, #4fc1ff\);/
  )
  assert.match(
    html,
    /--scrollbar-slider-bg: var\(--vscode-scrollbarSlider-background, rgba\(121, 121, 121, 0.4\)\);/
  )
  assert.match(html, /\.toolbar label\.disabled/)
  assert.match(html, /\.scrollbar-thumb/)
  assert.match(html, /\.server-health-dot\.warn/)
  assert.match(html, /\.server-health-badge\.down/)
  assert.match(html, /searchCase\.disabled = hexMode/)
  assert.match(html, /function formatOffsetDisplay\(offset\)/)
  assert.match(html, /function formatRowOffset\(offset\)/)
  assert.match(html, /function formatColumnOffset\(offset\)/)
  assert.match(html, /let selectionAnchor = -1/)
  assert.match(html, /function getSelectionStart\(\)/)
  assert.match(html, /function getSelectionEnd\(\)/)
  assert.match(html, /function getSelectionLength\(\)/)
  assert.match(html, /function offsetIsSelected\(offset\)/)
  assert.match(
    html,
    /const INTERNAL_HEX_CLIPBOARD_FORMAT = 'application\/x-omega-edit-hex'/
  )
  assert.match(html, /let activePane = 'hex'/)
  assert.match(html, /function renderColumnHeader\(\)/)
  assert.match(html, /let matchedByteOffsets = new Set\(\)/)
  assert.match(html, /function rebuildMatchedByteOffsets\(\)/)
  assert.match(html, /progress\.toFixed\(2\) \+ '%'/)
  assert.match(html, /function scrollToViewportOffset\(offset\)/)
  assert.match(html, /rowAlignedOffset >= bufferOffset/)
  assert.match(html, /type: 'setViewportMetrics'/)
  assert.match(html, /function reportViewportMetrics\(\)/)
  assert.match(html, /visibleOffset =/)
  assert.match(html, /bufferOffset = msg\.offset/)
  assert.match(html, /measuredRowHeight/)
  assert.match(html, /const MIN_SCROLLBAR_THUMB_HEIGHT = 20/)
  assert.match(html, /hexContainer\.clientHeight \/ measuredRowHeight/)
  assert.match(html, /ResizeObserver/)
  assert.match(html, /moveSelection\('left', e\.shiftKey\)/)
  assert.match(html, /moveSelection\('right', e\.shiftKey\)/)
  assert.match(html, /moveSelection\('up', e\.shiftKey\)/)
  assert.match(html, /moveSelection\('down', e\.shiftKey\)/)
  assert.match(html, /hexContainer\.addEventListener\('pointerdown'/)
  assert.match(html, /isPointerSelecting = true/)
  assert.match(html, /selectOffset\(offset, true\)/)
  assert.match(html, /hexContainer\.addEventListener\('contextmenu'/)
  assert.match(html, /scrollToViewportOffset\(0\)/)
  assert.match(
    html,
    /scrollToViewportOffset\(Math\.max\(0, fileSize - BYTES_PER_ROW\)\)/
  )
  assert.match(html, /type: 'setBytesPerRow'/)
  assert.match(html, /type: 'search'/)
  assert.match(html, /type: 'replace'/)
  assert.match(html, /type: 'replaceAllMatches'/)
  assert.match(
    html,
    /searchBtn\.disabled = searchInput\.value\.trim\(\)\.length === 0/
  )
  assert.match(html, /saveBtn\.disabled = !isDirty/)
  assert.match(
    html,
    /if \(e\.shiftKey\) {\s*vscode\.postMessage\({ type: 'saveAs' }\)\s*} else if \(!saveBtn\.disabled\) {\s*vscode\.postMessage\({ type: 'save' }\)/
  )
  assert.match(html, /type: 'saveAs'/)
  assert.match(html, /function replaceCurrentMatch\(\)/)
  assert.match(html, /function replaceAllMatches\(\)/)
  assert.match(
    html,
    /function applySingleReplaceToSearchMatches\(replacedOffset, offsetDelta\)/
  )
  assert.match(
    html,
    /matchOffset > replacedOffset \? matchOffset \+ offsetDelta : matchOffset/
  )
  assert.match(
    html,
    /const nextMatchOffset = searchMatches\[searchMatchIndex\]/
  )
  assert.match(
    html,
    /vscode\.postMessage\({ type: 'goToMatch', offset: nextMatchOffset }\)/
  )
  assert.match(html, /function normalizeSearchQuery\(query, isHex\)/)
  assert.match(html, /function getSearchPatternByteLength\(query, isHex\)/)
  assert.match(
    html,
    /const normalizedQuery = normalizeSearchQuery\(query, isHex\)/
  )
  assert.match(
    html,
    /searchPatternLength = getSearchPatternByteLength\(normalizedQuery, isHex\)/
  )
  assert.match(html, /const normalized = normalizeSearchQuery\(query, isHex\)/)
  assert.match(html, /const offsets = searchMatches\.slice\(\)/)
  assert.match(
    html,
    /const offsets = searchMatches\.slice\(\)[\s\S]*clearSearchResults\(\)[\s\S]*type: 'replaceAllMatches'[\s\S]*offsets,/
  )
  assert.doesNotMatch(html, /normalizedQuery\(query\)/)
  assert.match(html, /document\.addEventListener\('copy'/)
  assert.match(html, /document\.addEventListener\('cut'/)
  assert.match(html, /document\.addEventListener\('paste'/)
  assert.match(html, /function handleCopyEvent\(clipboardData\)/)
  assert.match(html, /function getClipboardSelectionHex\(\)/)
  assert.match(html, /function bytesToDisplayText\(bytes\)/)
  assert.match(html, /function setActivePane\(pane\)/)
  assert.match(
    html,
    /clipboardData\.setData\(\s*INTERNAL_HEX_CLIPBOARD_FORMAT,/
  )
  assert.match(html, /function handlePasteEvent\(clipboardData\)/)
  assert.match(
    html,
    /hasSelection\(\)\s*&&\s*getSelectionLength\(\)\s*>\s*1\s*&&\s*fileSize\s*>\s*0/
  )
  assert.match(
    html,
    /offset: hasSelection\(\) \? getSelectionStart\(\) : Math\.max\(0, visibleOffset\),/
  )
  assert.match(html, /undoBtn\.textContent = 'Undo \(' \+ undoCount \+ '\)'/)
  assert.match(html, /redoBtn\.textContent = 'Redo \(' \+ redoCount \+ '\)'/)
  assert.match(
    html,
    /undoBtn\.title = 'Undo ' \+ undoCount \+ ' change\(s\) \(Ctrl\+Z\)'/
  )
  assert.match(
    html,
    /redoBtn\.title = 'Redo ' \+ redoCount \+ ' change\(s\) \(Ctrl\+Y\)'/
  )
  assert.match(html, /function updateDirtyStatus\(isDirty\)/)
  assert.match(html, /function updateInspectorEndianLabel\(\)/)
  assert.match(html, /function updateInspectorStatus\(\)/)
  assert.match(html, /inspectorEndianBtn\.addEventListener\('click'/)
  assert.match(html, /inspectorLittleEndian = !inspectorLittleEndian/)
  assert.match(html, /u16' \+ endianLabel/)
  assert.match(html, /u32' \+ endianLabel/)
  assert.match(html, /function updateServerHealthStatus\(message\)/)
  assert.match(html, /function formatServerHealthSeverity\(severity\)/)
  assert.match(
    html,
    /serverHealthSummary\.textContent = message\?\.summary \?\? 'Ωedit™ pending'/
  )
  assert.match(
    html,
    /serverHealthBadge\.className = 'server-health-badge ' \+ severity/
  )
  assert.match(html, /serverHealthMetrics\.innerHTML = metrics/)
  assert.match(html, /case 'serverHealth'/)
  assert.match(html, /msg\.isDirty \?\? false/)
  assert.match(html, /msg\.replacedCount \?\? 0/)
  assert.match(html, /isReverse: searchDirectionSelect\.value === 'reverse'/)
  assert.match(html, /case 'editState'/)
  assert.match(html, /msg\.undoCount \?\? 0/)
  assert.match(html, /msg\.redoCount \?\? 0/)
  assert.match(html, /case 'replaceComplete'/)
  assert.match(html, /replaceSummaryActive/)
  assert.match(html, /function clearReplaceSummaryActionStatus\(\)/)
  assert.match(
    html,
    /case 'replaceComplete'[\s\S]*'replace-summary'[\s\S]*let nextMatchOffset = null[\s\S]*applySingleReplaceToSearchMatches\([\s\S]*nextMatchOffset === null[\s\S]*msg\.selectionOffset/
  )
  assert.match(
    html,
    /undoBtn\.addEventListener\('click', \(\) => \{[\s\S]*clearReplaceSummaryActionStatus\(\)[\s\S]*type: 'undo'/
  )
})
