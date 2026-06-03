const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const packageJson = require('../package.json')
const {
  OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND,
  OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
  OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
  OMEGA_EDIT_REDO_COMMAND,
  OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND,
  OMEGA_EDIT_ROLLBACK_SESSION_COMMAND,
  OMEGA_EDIT_UNDO_COMMAND,
  OMEGA_EDIT_VIEW_TYPE,
} = require('../out/constants.js')
const { getWebviewContent } = require('../out/webview.js')

test('package.json matches shared extension constants', () => {
  assert.equal(packageJson.main, './out/extension.js')
  assert.deepEqual(packageJson.activationEvents, [
    `onCustomEditor:${OMEGA_EDIT_VIEW_TYPE}`,
    `onCommand:${OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND}`,
    `onCommand:${OMEGA_EDIT_GO_TO_OFFSET_COMMAND}`,
    `onCommand:${OMEGA_EDIT_UNDO_COMMAND}`,
    `onCommand:${OMEGA_EDIT_REDO_COMMAND}`,
    `onCommand:${OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND}`,
    `onCommand:${OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND}`,
    `onCommand:${OMEGA_EDIT_ROLLBACK_SESSION_COMMAND}`,
    `onCommand:${OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND}`,
    `onCommand:${OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND}`,
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
    OMEGA_EDIT_UNDO_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[2].enablement,
    'omegaEdit.hexEditorActive && omegaEdit.canUndo'
  )
  assert.equal(
    packageJson.contributes.commands[3].command,
    OMEGA_EDIT_REDO_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[3].enablement,
    'omegaEdit.hexEditorActive && omegaEdit.canRedo'
  )
  assert.equal(
    packageJson.contributes.commands[4].command,
    OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[4].enablement,
    'omegaEdit.hexEditorActive && omegaEdit.hasPendingChanges'
  )
  assert.equal(
    packageJson.contributes.commands[5].command,
    OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[6].command,
    OMEGA_EDIT_ROLLBACK_SESSION_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[6].enablement,
    'omegaEdit.hexEditorActive'
  )
  assert.equal(
    packageJson.contributes.commands[7].command,
    OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[7].enablement,
    'omegaEdit.hexEditorActive'
  )
  assert.equal(
    packageJson.contributes.commands[8].command,
    OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[8].enablement,
    'omegaEdit.hexEditorActive'
  )
  assert.deepEqual(
    packageJson.contributes.configuration.properties[
      'omegaEdit.transformPluginDirectories'
    ].default,
    []
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
  assert.match(providerJs, /profileSession/)
  assert.match(providerJs, /countCharacters/)
  assert.match(providerJs, /listTransformPlugins/)
  assert.match(providerJs, /applyTransformPlugin/)
  assert.match(providerJs, /omegaEdit\.hexEditorActive/)
  assert.match(providerJs, /omegaEdit\.canUndo/)
  assert.match(providerJs, /omegaEdit\.canRedo/)
  assert.match(providerJs, /setContext/)
  assert.match(providerJs, /revertCustomDocument/)
  assert.match(providerJs, /createCheckpoint/)
  assert.match(providerJs, /destroyLastCheckpoint/)
  assert.match(providerJs, /clear/)
  assert.match(providerJs, /rollbackSession/)
  assert.match(providerJs, /rollbackCheckpoint/)
  assert.match(providerJs, /createSessionCheckpoint/)
  assert.match(providerJs, /postClipboardSelection/)
  assert.match(providerJs, /case\s+['"]copySelection['"]/)
  assert.match(providerJs, /case\s+['"]cutSelection['"]/)
  assert.match(providerJs, /type:\s*['"]clipboardComplete['"]/)
  assert.match(providerJs, /workbench\.action\.files\.revert/)
  assert.match(providerJs, /type:\s*['"]transformPlugins['"]/)
  assert.match(providerJs, /help:\s*plugin\.help/)
  assert.match(providerJs, /example:\s*plugin\.example/)
  assert.match(providerJs, /defaultArgs:\s*plugin\.defaultArgs/)
  assert.match(providerJs, /argsSchema:\s*plugin\.argsSchema/)
  assert.match(providerJs, /case\s+['"]applyTransform['"]/)
  assert.match(providerJs, /kind:\s*['"]REPLACE['"]/)
  assert.match(providerJs, /getContentType/)
  assert.match(providerJs, /getLanguage/)
  assert.match(providerJs, /enqueueAnalysisProfile/)
  assert.match(providerJs, /processAnalysisProfileQueue/)
  assert.match(providerJs, /clampedLength <= 0/)
  assert.match(providerJs, /const contentTypeSampleLength = Math\.min/)
  assert.match(
    providerJs,
    /getContentType\)\(session\.sessionId,\s*0,\s*contentTypeSampleLength\)/
  )

  const extensionJs = fs.readFileSync(
    path.resolve(__dirname, '../out/extension.js'),
    'utf8'
  )
  assert.match(extensionJs, /transformPluginDirectories/)
  assert.match(extensionJs, /OMEGA_EDIT_UNDO_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_REDO_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_ROLLBACK_SESSION_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND/)
  assert.match(extensionJs, /undoActive/)
  assert.match(extensionJs, /redoActive/)
  assert.match(extensionJs, /rollbackActiveSession/)
  assert.match(extensionJs, /rollbackActiveCheckpoint/)
  assert.match(extensionJs, /createActiveCheckpoint/)
  assert.match(extensionJs, /getDefaultTransformPluginDirectories/)
  assert.match(extensionJs, /_build_core['"],\s*['"]plugins['"],\s*['"]plugins/)
  assert.match(extensionJs, /directoryHasTransformPlugin/)
  assert.match(
    extensionJs,
    /startServer\)\(port,\s*undefined,\s*undefined,\s*\{\s*transformPluginDirectories/
  )
})

test('webview HTML includes core controls and configured row width', () => {
  const html = getWebviewContent(32)

  assert.match(html, /http-equiv="Content-Security-Policy"/)
  assert.match(html, /default-src 'none'/)
  assert.match(html, /img-src 'self' data:/)
  assert.match(html, /style-src 'self' 'unsafe-inline'/)
  assert.doesNotMatch(html, /&#39;self&#39;/)
  assert.match(html, /script-src 'nonce-[^']+'/)
  assert.match(html, /<script nonce="[^"]+">/)
  assert.match(
    html,
    /--accent-frame: var\(--vscode-contrastActiveBorder, #cca700\);/
  )
  assert.match(html, /\.byte-inspector-header \{[\s\S]*cursor: grab;/)
  assert.doesNotMatch(html, /data-inspector-pin/)
  assert.match(
    html,
    /\.status-inline-button\.active \{[\s\S]*border-color: var\(--accent-frame\);/
  )
  assert.match(
    html,
    /button\.byte-inspector-value:hover,[\s\S]*border-color: var\(--accent-frame\);/
  )
  assert.match(
    html,
    /\.byte-inspector-meta \{[\s\S]*border: 1px solid var\(--accent-frame\);/
  )
  assert.match(
    html,
    /\.hex-byte\.inspector-anchor \{[\s\S]*background: var\(--accent-frame-bg\);/
  )
  assert.match(
    html,
    /\.ascii-char\.inspector-anchor \{[\s\S]*background: var\(--accent-frame-bg\);/
  )
  assert.match(html, /const BYTES_PER_ROW = 32/)
  assert.match(html, /id="hexContainer"/)
  assert.match(html, /id="hexHeader"/)
  assert.match(html, /id="hexColumnHeader"/)
  assert.match(html, /id="bytesPerRowSelect"/)
  assert.match(html, /id="offsetRadixSelect"/)
  assert.match(html, /id="findWidget"/)
  assert.match(html, /id="searchDirectionSelect"/)
  assert.match(html, /id="searchBtn"/)
  assert.match(html, /id="replaceInput"/)
  assert.match(html, /id="replaceBtn"/)
  assert.match(html, /id="replaceAllBtn"/)
  assert.match(html, /id="editModeBtn"/)
  assert.doesNotMatch(html, /id="topBtn"/)
  assert.doesNotMatch(html, /id="bottomBtn"/)
  assert.match(html, /id="scrollbarTrack"/)
  assert.match(html, /id="scrollbarThumb"/)
  assert.doesNotMatch(html, /id="saveBtn"/)
  assert.doesNotMatch(html, /id="saveAsBtn"/)
  assert.match(html, /id="transformSelect"/)
  assert.match(html, /id="transformOptions"/)
  assert.match(html, /id="transformOptionsDialog"/)
  assert.match(html, /id="transformOptionsApply"/)
  assert.match(html, /id="transformOptionsCancel"/)
  assert.match(html, /data-example-index/)
  assert.doesNotMatch(html, /id="transformApplyBtn"/)
  assert.doesNotMatch(html, /id="transformRefreshBtn"/)
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
  assert.match(html, /id="analysisPane"/)
  assert.match(html, /data-analysis-panel="profile"/)
  assert.match(html, /data-analysis-panel="structure"/)
  assert.match(html, /data-analysis-section="viewport"/)
  assert.match(html, /data-analysis-section="frequency"/)
  assert.match(html, /data-analysis-section="timing"/)
  assert.match(html, /data-analysis-drag="true"/)
  assert.match(html, /\.analysis-drag-handle \{[\s\S]*cursor: grab;/)
  assert.match(html, /id="profileTab"/)
  assert.match(html, /id="structureTab"/)
  assert.match(html, /aria-controls="profilePanel"/)
  assert.match(html, /aria-controls="structurePanel"/)
  assert.match(html, /id="profileViewportMetrics"/)
  assert.match(html, /id="profileTimingMetrics"/)
  assert.match(html, /id="profileDataMetrics"/)
  assert.match(html, /id="profileScaleBtn"/)
  assert.match(html, /id="profileFrequencyChart"/)
  assert.match(html, /id="profileFrequencyTooltip"/)
  assert.match(html, /id="profileLimitNote"/)
  assert.match(html, /id="profileByteBars"/)
  assert.match(html, /id="profileClassBars"/)
  assert.match(html, /grid-template-columns: repeat\(256, minmax\(0, 1fr\)\);/)
  assert.match(html, /\.frequency-bar \{[\s\S]*min-width: 0;/)
  assert.match(html, /\.analysis-tab \{[\s\S]*opacity: 0\.68;/)
  assert.match(html, /\.analysis-tab\.active \{[\s\S]*box-shadow:/)
  assert.match(html, /\.ascii-char\.non-printable\.ascii-control/)
  assert.match(
    html,
    /\.ascii-char\.non-printable\.ascii-control \{[\s\S]*ansiBlue/
  )
  assert.match(html, /\.ascii-char\.non-printable\.high-bit/)
  assert.match(html, /id="structureMetrics"/)
  assert.match(html, /id="structureHistoryMetrics"/)
  assert.doesNotMatch(html, /id="structureTopBytes"/)
  assert.match(html, /id="statusProgress"/)
  assert.match(html, /\.analysis-bar-fill \{[\s\S]*display: block;/)
  assert.doesNotMatch(html, /id="undoBtn"/)
  assert.doesNotMatch(html, /id="redoBtn"/)
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
  assert.match(html, /function selectRange\(offset, length\)/)
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
  assert.match(html, /type: 'requestTransformPlugins'/)
  assert.match(html, /type: 'applyTransform'/)
  assert.match(html, /case 'transformPlugins'/)
  assert.match(html, /case 'transformComplete'/)
  assert.match(html, /const transformedLength = msg\.contentChanged/)
  assert.match(html, /selectRange\(msg\.offset, transformedLength\)/)
  assert.match(html, /function applySelectedTransform\(\)/)
  assert.match(html, /function getTransformOptionHelp\(plugin\)/)
  assert.match(html, /function validateTransformOptions\(plugin, optionsJson\)/)
  assert.match(html, /function validateJsonSchemaValue\(value, schema, path\)/)
  assert.match(html, /function renderTransformOptionsDialog\(\)/)
  assert.match(html, /transformSelect\.addEventListener\('pointerdown'/)
  assert.match(html, /transformSelect\.addEventListener\('change'/)
  assert.match(
    html,
    /e\.key === 'Escape' && transformOptionsDialog\.classList\.contains\('active'\)[\s\S]*closeTransformOptionsDialog\(\)/
  )
  assert.match(
    html,
    /e\.shiftKey && e\.key === ' '\) \{[\s\S]*if \(toggleByteInspector\(\)\)/
  )
  assert.doesNotMatch(html, /Toggle pinned inspector/)
  assert.match(html, /function useTransformOptionExample\(index\)/)
  assert.match(html, /function advertisedTransformExamples\(plugin\)/)
  assert.match(
    html,
    /transformOptionsDialog\.contains\(document\.activeElement\)/
  )
  assert.match(html, /Selected Range/)
  assert.match(html, /formatOffsetDisplay\(selectionStart\)/)
  assert.match(html, /formatOffsetDisplay\(selectionEnd\)/)
  assert.doesNotMatch(
    html,
    /These options are advertised by the selected transform/
  )
  assert.doesNotMatch(html, /does not advertise JSON options/)
  assert.match(html, /argsSchema/)
  assert.doesNotMatch(html, /class="help-schema"/)
  assert.match(html, /did not advertise an options schema/)
  assert.match(html, /Selected transform advertised an invalid options schema/)
  assert.doesNotMatch(html, /omega\.example\.xor/)
  assert.doesNotMatch(html, /bytes\/mask/)
  assert.match(html, /function flashActionStatus\(\)/)
  assert.match(html, /\.status-action\.flash/)
  assert.match(html, /@keyframes status-action-flash/)
  assert.match(html, /prefers-reduced-motion: reduce/)
  assert.match(html, /flashActionStatus\(\)/)
  assert.match(html, /JSON\.parse\(optionsJson\)/)
  assert.match(html, /function updateTransformControls\(\)/)
  assert.match(html, /No transforms found/)
  assert.match(
    html,
    /searchBtn\.disabled = searchInput\.value\.trim\(\)\.length === 0/
  )
  assert.doesNotMatch(html, /saveBtn\.disabled = !isDirty/)
  assert.doesNotMatch(html, /type: 'saveAs'/)
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
  assert.match(
    html,
    /offsets: searchMode === 'large' \? undefined : searchMatches\.slice\(\)/
  )
  assert.doesNotMatch(html, /normalizedQuery\(query\)/)
  assert.match(html, /document\.addEventListener\('copy'/)
  assert.match(html, /document\.addEventListener\('cut'/)
  assert.match(html, /document\.addEventListener\('paste'/)
  assert.match(html, /id="pastePopover"/)
  assert.match(html, /\.paste-popover/)
  assert.match(html, /function handleCopyEvent\(clipboardData\)/)
  assert.match(html, /function getClipboardSelectionHex\(\)/)
  assert.match(html, /function postSelectionClipboard\(action\)/)
  assert.match(
    html,
    /type: action === 'cut' \? 'cutSelection' : 'copySelection'/
  )
  assert.match(html, /function bytesToDisplayText\(bytes\)/)
  assert.match(html, /function setActivePane\(pane\)/)
  assert.match(
    html,
    /clipboardData\.setData\(\s*INTERNAL_HEX_CLIPBOARD_FORMAT,/
  )
  assert.match(html, /function showPastePopover\(clipboardData, anchorTarget\)/)
  assert.match(html, /function applyPasteContext\(\)/)
  assert.match(html, /pasteEncoding/)
  assert.match(html, /pasteMode/)
  assert.match(html, /case 'clipboardComplete'/)
  assert.match(html, /case 'cutComplete'/)
  assert.match(
    html,
    /hasSelection\(\)\s*&&\s*getSelectionLength\(\)\s*>\s*1\s*&&\s*fileSize\s*>\s*0/
  )
  assert.match(
    html,
    /offset: hasSelection\(\) \? getSelectionStart\(\) : Math\.max\(0, visibleOffset\),/
  )
  assert.match(html, /function updateHistoryState\(canUndo, canRedo/)
  assert.match(html, /historyUndoCount = undoCount/)
  assert.match(html, /historyRedoCount = redoCount/)
  assert.match(html, /function renderHistoryMetrics\(\)/)
  assert.match(html, /label: 'Undo', value: historyUndoCount/)
  assert.match(html, /label: 'Redo', value: historyRedoCount/)
  assert.match(html, /function updateDirtyStatus\(isDirty\)/)
  assert.match(html, /function updateInspectorEndianLabel\(\)/)
  assert.match(html, /function updateInspectorStatus\(\)/)
  assert.match(html, /function updateRenderedInspectorAnchor\(\)/)
  assert.match(html, /querySelectorAll\('\.inspector-anchor'\)/)
  assert.match(
    html,
    /querySelectorAll\('\[data-offset="' \+ byteInspectorOffset/
  )
  assert.match(html, /function byteInspectorLaunchTarget\(\)/)
  assert.match(html, /function stopByteInspectorDrag\(pointerId\)/)
  assert.match(
    html,
    /byteInspector\.addEventListener\('pointercancel'[\s\S]*stopByteInspectorDrag\(e\.pointerId\)/
  )
  assert.match(html, /inspectorEndianBtn\.addEventListener\('click'/)
  assert.match(html, /inspectorLittleEndian = !inspectorLittleEndian/)
  assert.match(html, /u16' \+ endianLabel/)
  assert.match(html, /u32' \+ endianLabel/)
  assert.match(html, /function updateServerHealthStatus\(message\)/)
  assert.match(html, /function updateProfileAnalysis\(\)/)
  assert.match(html, /function updateStructureAnalysis\(\)/)
  assert.match(html, /function analyzeBytes\(bytes\)/)
  assert.match(html, /function renderFrequencyChart\(profile, total\)/)
  assert.match(html, /function byteTextClass\(byte\)/)
  assert.match(html, /function formatByteLabel\(byte\)/)
  assert.match(html, /function formatModeByte\(entry, total\)/)
  assert.match(html, /function computeFrequencySpread\(counts, total\)/)
  assert.match(html, /function formatFrequencySpread\(value, total\)/)
  assert.match(html, /escapeHtml\(String\(row\.value\)\)/)
  assert.match(html, /function updateFrequencyTooltip\(event\)/)
  assert.match(html, /function hideFrequencyTooltip\(\)/)
  assert.match(html, /const topProfileMaxCount = Math\.max/)
  assert.match(html, /entry\.count \/ topProfileMaxCount/)
  assert.match(html, /label: formatByteLabel\(entry\.byte\)/)
  assert.match(html, /label: 'Mode', value: formatModeByte/)
  assert.match(html, /label: 'Freq Spread'/)
  assert.match(html, /frequencySpread: computeFrequencySpread/)
  assert.match(html, /byteTextClass\(b\)/)
  assert.match(html, /const MAX_PROFILE_BYTES = 64 \* 1024/)
  assert.match(html, /function requestAnalysisProfile\(force = false\)/)
  assert.match(html, /if \(analysisMode !== 'profile'\)/)
  assert.match(html, /type: 'requestAnalysisProfile'/)
  assert.match(html, /requestKey: key/)
  assert.match(html, /scopeLabel: scope\.label/)
  assert.match(html, /analysisProfileRequestTimer/)
  assert.match(html, /setTimeout\(\(\) => \{/)
  assert.match(html, /msg\.requestKey !== pendingAnalysisProfileKey/)
  assert.match(html, /case 'analysisProfile'/)
  assert.match(html, /byteProfile/)
  assert.match(html, /characterCount/)
  assert.match(html, /label: 'DOS EOL', value: dosEolCount\.toLocaleString\(\)/)
  assert.match(
    html,
    /const dosEolCount = latestDataProfile\.byteProfile\[256\] \?\? 0/
  )
  assert.match(
    html,
    /label: 'BOM Bytes', value: \(characterCount\.byteOrderMarkBytes \?\? 0\)\.toLocaleString\(\)/
  )
  assert.match(
    html,
    /label: '1B Chars', value: \(characterCount\.singleByteCount \?\? 0\)\.toLocaleString\(\)/
  )
  assert.match(
    html,
    /label: '2B Chars', value: \(characterCount\.doubleByteCount \?\? 0\)\.toLocaleString\(\)/
  )
  assert.match(
    html,
    /label: '3B Chars', value: \(characterCount\.tripleByteCount \?\? 0\)\.toLocaleString\(\)/
  )
  assert.match(
    html,
    /label: '4B Chars', value: \(characterCount\.quadByteCount \?\? 0\)\.toLocaleString\(\)/
  )
  assert.match(html, /DEFAULT_ANALYSIS_SECTION_ORDER/)
  assert.match(html, /function normalizeAnalysisSectionOrder\(rawOrder\)/)
  assert.match(
    html,
    /function moveAnalysisSection\(panelName, sectionId, targetId, placeAfter\)/
  )
  assert.match(
    html,
    /function moveAnalysisSectionByDelta\(panelName, sectionId, delta\)/
  )
  assert.match(html, /function handleAnalysisSectionDragMove\(event\)/)
  assert.match(html, /analysisPane\.addEventListener\('pointerdown'/)
  assert.match(html, /analysisPane\.addEventListener\('pointercancel'/)
  assert.match(html, /analysisPane\.addEventListener\('keydown'/)
  assert.match(html, /vscode\.setState\?\.\(/)
  assert.match(html, /profileTab\.addEventListener\('click'/)
  assert.match(html, /structureTab\.addEventListener\('click'/)
  assert.match(html, /profileScaleBtn\.addEventListener\('click'/)
  assert.match(
    html,
    /profileFrequencyChart\.addEventListener\('pointermove', updateFrequencyTooltip\)/
  )
  assert.match(
    html,
    /profileFrequencyChart\.addEventListener\('pointerleave', hideFrequencyTooltip\)/
  )
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
  assert.doesNotMatch(html, /undoBtn\.addEventListener/)
})
