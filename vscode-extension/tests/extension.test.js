const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const packageJson = require('../package.json')
const packageNls = require('../package.nls.json')
const {
  OMEGA_EDIT_EXTENSION_API_VERSION,
  OMEGA_EDIT_EXTENSION_ID,
  OMEGA_EDIT_EXTENSION_NAME,
  OMEGA_EDIT_EXTENSION_PUBLISHER,
} = require('../out/api.js')
const {
  OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND,
  OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
  OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
  OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
  OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
  OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND,
  OMEGA_EDIT_REDO_COMMAND,
  OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND,
  OMEGA_EDIT_ROLLBACK_SESSION_COMMAND,
  OMEGA_EDIT_SEARCH_NEXT_COMMAND,
  OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND,
  OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
  OMEGA_EDIT_TOGGLE_INSERT_DIRECTION_COMMAND,
  OMEGA_EDIT_UNDO_COMMAND,
  OMEGA_EDIT_VIEW_TYPE,
} = require('../out/constants.js')
const {
  MAX_ANALYSIS_PROFILE_BYTES,
  normalizeExternalHighlights,
  normalizeBytesPerRow,
  normalizeWebviewMessage,
} = require('../out/webviewProtocol.js')

test('package.json matches shared extension constants', () => {
  assert.equal(packageJson.main, './out/extension.js')
  assert.equal(packageJson.types, './out/api.d.ts')
  assert.equal(OMEGA_EDIT_EXTENSION_API_VERSION, 1)
  assert.equal(packageJson.name, OMEGA_EDIT_EXTENSION_NAME)
  assert.equal(packageJson.publisher, OMEGA_EDIT_EXTENSION_PUBLISHER)
  assert.equal(
    `${packageJson.publisher}.${packageJson.name}`,
    OMEGA_EDIT_EXTENSION_ID
  )
  assert.equal(
    packageJson.scripts['package:vsix'],
    'vsce package --out omega-edit-data-editor.vsix'
  )
  assert.equal(packageJson.displayName, '%omegaEdit.displayName%')
  assert.equal(packageNls['omegaEdit.displayName'], 'Ωedit™ Data Editor')
  assert.deepEqual(packageJson.activationEvents, [
    `onCustomEditor:${OMEGA_EDIT_VIEW_TYPE}`,
    `onCommand:${OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND}`,
    `onCommand:${OMEGA_EDIT_GO_TO_OFFSET_COMMAND}`,
    `onCommand:${OMEGA_EDIT_SEARCH_NEXT_COMMAND}`,
    `onCommand:${OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND}`,
    `onCommand:${OMEGA_EDIT_UNDO_COMMAND}`,
    `onCommand:${OMEGA_EDIT_REDO_COMMAND}`,
    `onCommand:${OMEGA_EDIT_TOGGLE_INSERT_DIRECTION_COMMAND}`,
    `onCommand:${OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND}`,
    `onCommand:${OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND}`,
    `onCommand:${OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND}`,
    `onCommand:${OMEGA_EDIT_ROLLBACK_SESSION_COMMAND}`,
    `onCommand:${OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND}`,
    `onCommand:${OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND}`,
    `onCommand:${OMEGA_EDIT_GET_EDITOR_STATE_COMMAND}`,
    `onCommand:${OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND}`,
    `onCommand:${OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND}`,
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
    OMEGA_EDIT_SEARCH_NEXT_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[2].enablement,
    'omegaEdit.hexEditorActive'
  )
  assert.equal(
    packageJson.contributes.commands[3].command,
    OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[3].enablement,
    'omegaEdit.hexEditorActive'
  )
  assert.equal(
    packageJson.contributes.commands[4].command,
    OMEGA_EDIT_UNDO_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[4].enablement,
    'omegaEdit.hexEditorActive && omegaEdit.canUndo'
  )
  assert.equal(
    packageJson.contributes.commands[5].command,
    OMEGA_EDIT_REDO_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[5].enablement,
    'omegaEdit.hexEditorActive && omegaEdit.canRedo'
  )
  assert.equal(
    packageJson.contributes.commands[6].command,
    OMEGA_EDIT_TOGGLE_INSERT_DIRECTION_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[6].enablement,
    'omegaEdit.hexEditorActive'
  )
  assert.equal(
    packageJson.contributes.commands[7].command,
    OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[7].enablement,
    'omegaEdit.hexEditorActive'
  )
  assert.equal(
    packageJson.contributes.commands[8].command,
    OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[8].enablement,
    'omegaEdit.hexEditorActive && omegaEdit.hasPendingChanges'
  )
  assert.equal(
    packageJson.contributes.commands[9].command,
    OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[10].command,
    OMEGA_EDIT_ROLLBACK_SESSION_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[10].enablement,
    'omegaEdit.hexEditorActive && omegaEdit.hasPendingChanges'
  )
  assert.equal(
    packageJson.contributes.commands[11].command,
    OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[11].enablement,
    'omegaEdit.hexEditorActive'
  )
  assert.equal(
    packageJson.contributes.commands[12].command,
    OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND
  )
  assert.equal(
    packageJson.contributes.commands[12].enablement,
    'omegaEdit.hexEditorActive'
  )
  assert.deepEqual(
    packageJson.contributes.commands.slice(13).map((entry) => entry.command),
    [
      OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
      OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
      OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
    ]
  )
  assert.equal(
    packageNls['omegaEdit.command.toggleInsertDirection.title'],
    'OmegaEdit: Toggle Insert Direction'
  )
  assert.equal(
    packageNls['omegaEdit.command.getEditorState.title'],
    'OmegaEdit: Get Editor State'
  )
  assert.equal(
    packageNls['omegaEdit.command.setExternalHighlights.title'],
    'OmegaEdit: Set External Highlights'
  )
  assert.equal(
    packageNls['omegaEdit.command.clearExternalHighlights.title'],
    'OmegaEdit: Clear External Highlights'
  )
  assert.deepEqual(
    packageJson.contributes.configuration.properties[
      'omegaEdit.transformPluginDirectories'
    ].default,
    []
  )
  assert.equal(
    Object.hasOwn(
      packageJson.contributes.configuration.properties,
      'omegaEdit.experimentalSvelteWebview'
    ),
    false
  )
  assert.equal(
    packageJson.contributes.commands.some(
      (entry) => entry.command === 'omegaEdit.revertFile'
    ),
    false
  )
  assert.equal(
    packageJson.contributes.menus.commandPalette.some(
      (entry) => entry.command === 'omegaEdit.revertFile'
    ),
    false
  )
  assert.deepEqual(
    packageJson.contributes.menus['editor/title'].find(
      (entry) => entry.command === OMEGA_EDIT_ROLLBACK_SESSION_COMMAND
    ),
    {
      command: OMEGA_EDIT_ROLLBACK_SESSION_COMMAND,
      when: 'omegaEdit.hexEditorActive && omegaEdit.hasPendingChanges',
      group: 'navigation@9',
    }
  )
  assert.deepEqual(
    packageJson.contributes.menus.commandPalette.find(
      (entry) => entry.command === OMEGA_EDIT_TOGGLE_INSERT_DIRECTION_COMMAND
    ),
    {
      command: OMEGA_EDIT_TOGGLE_INSERT_DIRECTION_COMMAND,
      when: 'omegaEdit.hexEditorActive',
    }
  )
  assert.deepEqual(
    packageJson.contributes.menus.commandPalette.find(
      (entry) => entry.command === OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND
    ),
    {
      command: OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND,
      when: 'omegaEdit.hexEditorActive',
    }
  )
  assert.deepEqual(
    packageJson.contributes.menus.commandPalette.find(
      (entry) => entry.command === OMEGA_EDIT_ROLLBACK_SESSION_COMMAND
    ),
    {
      command: OMEGA_EDIT_ROLLBACK_SESSION_COMMAND,
      when: 'omegaEdit.hexEditorActive && omegaEdit.hasPendingChanges',
    }
  )
  assert.deepEqual(
    [
      OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
      OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
      OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
    ].map((command) =>
      packageJson.contributes.menus.commandPalette.find(
        (entry) => entry.command === command
      )
    ),
    [
      { command: OMEGA_EDIT_GET_EDITOR_STATE_COMMAND, when: 'false' },
      { command: OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND, when: 'false' },
      { command: OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND, when: 'false' },
    ]
  )
})

test('root build stages transform plugins before packaging the VSIX', () => {
  const rootBuildScript = fs.readFileSync(
    path.resolve(__dirname, '../../build.sh'),
    'utf8'
  )
  assert.match(rootBuildScript, /detect_vscode_transform_platform/)
  assert.match(rootBuildScript, /stage_vscode_transform_plugins/)
  assert.match(
    rootBuildScript,
    /build-shared-\$\{type\}\/core\/src\/tests\/plugins/
  )
  assert.match(
    rootBuildScript,
    /npm run stage:transform-plugins -- "\$transform_plugins_stage" --platform "\$transform_plugin_platform"/
  )
  assert.match(
    rootBuildScript,
    /npm run stage:transform-plugins[\s\S]*npm run package:vsix/
  )

  const stageTransformPluginsScript = fs.readFileSync(
    path.resolve(__dirname, '../scripts/stage-transform-plugins.cjs'),
    'utf8'
  )
  assert.match(stageTransformPluginsScript, /platformFilter/)
  assert.match(stageTransformPluginsScript, /--platform=/)
  assert.match(
    stageTransformPluginsScript,
    /platforms = platformFilter[\s\S]*: supportedPlatforms/
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
    fs.existsSync(path.resolve(__dirname, '../out/webviewProtocol.js')),
    true
  )
  assert.equal(fs.existsSync(path.resolve(__dirname, '../out/api.d.ts')), true)
  assert.equal(
    fs.existsSync(path.resolve(__dirname, '../out/svelteWebview.js')),
    true
  )
  assert.equal(
    fs.existsSync(path.resolve(__dirname, '../out/svelte-webview/webview.js')),
    true
  )
  assert.equal(
    fs.existsSync(path.resolve(__dirname, '../out/svelte-webview/webview.css')),
    true
  )

  const providerJs = fs.readFileSync(
    path.resolve(__dirname, '../out/hexEditorProvider.js'),
    'utf8'
  )
  const protocolJs = fs.readFileSync(
    path.resolve(__dirname, '../out/webviewProtocol.js'),
    'utf8'
  )
  const protocolSource = fs.readFileSync(
    path.resolve(__dirname, '../src/webviewProtocol.ts'),
    'utf8'
  )
  const apiDts = fs.readFileSync(
    path.resolve(__dirname, '../out/api.d.ts'),
    'utf8'
  )
  const svelteHostJs = fs.readFileSync(
    path.resolve(__dirname, '../out/svelteWebview.js'),
    'utf8'
  )
  const svelteBundleJs = fs.readFileSync(
    path.resolve(__dirname, '../out/svelte-webview/webview.js'),
    'utf8'
  )
  const svelteBundleCss = fs.readFileSync(
    path.resolve(__dirname, '../out/svelte-webview/webview.css'),
    'utf8'
  )
  const viteConfigSource = fs.readFileSync(
    path.resolve(__dirname, '../vite.config.mts'),
    'utf8'
  )
  const svelteAppSource = fs.readFileSync(
    path.resolve(__dirname, '../webview-ui/src/App.svelte'),
    'utf8'
  )
  const i18nSource = fs.readFileSync(
    path.resolve(__dirname, '../webview-ui/src/i18n.ts'),
    'utf8'
  )
  const previewGridSource = fs.readFileSync(
    path.resolve(__dirname, '../webview-ui/src/components/PreviewGrid.svelte'),
    'utf8'
  )
  const fileScrollbarSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../webview-ui/src/components/FileScrollbar.svelte'
    ),
    'utf8'
  )
  const toolbarSource = fs.readFileSync(
    path.resolve(__dirname, '../webview-ui/src/components/Toolbar.svelte'),
    'utf8'
  )
  const offsetJumpSource = fs.readFileSync(
    path.resolve(__dirname, '../webview-ui/src/components/OffsetJump.svelte'),
    'utf8'
  )
  const transformPanelSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../webview-ui/src/components/TransformPanel.svelte'
    ),
    'utf8'
  )
  const transformResultPanelSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../webview-ui/src/components/TransformResultPanel.svelte'
    ),
    'utf8'
  )
  const searchPanelSource = fs.readFileSync(
    path.resolve(__dirname, '../webview-ui/src/components/SearchPanel.svelte'),
    'utf8'
  )
  const byteInspectorSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../webview-ui/src/components/ByteInspector.svelte'
    ),
    'utf8'
  )
  const editorWorkspaceSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../webview-ui/src/components/EditorWorkspace.svelte'
    ),
    'utf8'
  )
  const profilerPanelSource = fs.readFileSync(
    path.resolve(
      __dirname,
      '../webview-ui/src/components/ProfilerPanel.svelte'
    ),
    'utf8'
  )
  const svelteComponentSources = [
    ['App.svelte', svelteAppSource],
    ['PreviewGrid.svelte', previewGridSource],
    ['FileScrollbar.svelte', fileScrollbarSource],
    ['Toolbar.svelte', toolbarSource],
    ['OffsetJump.svelte', offsetJumpSource],
    ['TransformPanel.svelte', transformPanelSource],
    ['TransformResultPanel.svelte', transformResultPanelSource],
    ['SearchPanel.svelte', searchPanelSource],
    ['ByteInspector.svelte', byteInspectorSource],
    ['EditorWorkspace.svelte', editorWorkspaceSource],
    ['ProfilerPanel.svelte', profilerPanelSource],
  ]
  for (const [name, source] of svelteComponentSources) {
    assert.doesNotMatch(
      source,
      /style=\{/,
      `${name} should avoid inline styles`
    )
    assert.doesNotMatch(
      source,
      /\bnode\.style\b|\.style\.|\.style\s*=|setProperty\(/,
      `${name} should avoid runtime inline style mutation`
    )
  }
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
  assert.match(providerJs, /searchNextActive/)
  assert.match(providerJs, /searchPreviousActive/)
  assert.match(providerJs, /searchNavigationCommand/)
  assert.match(providerJs, /await this\.sendViewportData\(session\)/)
  assert.match(
    providerJs,
    /baseOffset = session\.pendingScrollOffset \?\? session\.offset/
  )
  assert.match(providerJs, /bufferOffset === session\.bufferOffset/)
  assert.match(providerJs, /visibleRows !== session\.visibleRows/)
  assert.match(providerJs, /const replacementLength = Buffer\.from/)
  assert.match(providerJs, /offsetDelta: replacementLength - msg\.length/)
  assert.match(providerJs, /revertCustomDocument/)
  assert.match(providerJs, /createCheckpoint/)
  assert.match(providerJs, /destroyLastCheckpoint/)
  assert.match(providerJs, /clear/)
  assert.match(providerJs, /rollbackSession/)
  assert.match(providerJs, /revertSessionChanges/)
  assert.match(providerJs, /rollbackCheckpoint/)
  assert.match(providerJs, /createSessionCheckpoint/)
  assert.match(providerJs, /postClipboardSelection/)
  assert.match(providerJs, /case\s+['"]copySelection['"]/)
  assert.match(providerJs, /case\s+['"]cutSelection['"]/)
  assert.match(providerJs, /type:\s*['"]clipboardComplete['"]/)
  assert.match(providerJs, /workbench\.action\.files\.revert/)
  assert.match(providerJs, /type:\s*['"]documentReverted['"]/)
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
  assert.match(providerJs, /getEditorState/)
  assert.match(providerJs, /setExternalHighlights/)
  assert.match(providerJs, /clearExternalHighlights/)
  assert.match(providerJs, /createStatusBarItem/)
  assert.match(providerJs, /updateStatusBar/)
  assert.match(providerJs, /buildServerHealthTooltip/)
  assert.match(providerJs, /new vscode\.MarkdownString/)
  assert.match(providerJs, /Ωedit™ Server/)
  assert.match(providerJs, /formatServerHealthLatencyBand/)
  assert.match(providerJs, /serverTooltip\.value/)
  assert.match(providerJs, /appendServerHealthTooltipSection/)
  assert.match(providerJs, /Live Status/)
  assert.match(providerJs, /Current Instance/)
  assert.match(providerJs, /Host and Build/)
  assert.match(providerJs, /Logical CPUs/)
  assert.match(providerJs, /SERVER_HEALTH_VOLATILE_METRIC_IDS/)
  assert.match(providerJs, /serverHealthMetric\(\s*['"]latency['"]/)
  assert.match(
    providerJs,
    /collectServerHealthTooltipMetrics\(metricById,\s*\[['"]pid['"]\]/
  )
  assert.doesNotMatch(providerJs, /latencyMetric/)
  assert.doesNotMatch(providerJs, /vscode\.l10n\.t\('CPU'\)/)
  assert.doesNotMatch(providerJs, /vscode\.l10n\.t\('Processors'\)/)
  assert.match(providerJs, /serverHealthColorId/)
  assert.match(providerJs, /charts\.green/)
  assert.match(providerJs, /charts\.yellow/)
  assert.match(providerJs, /charts\.red/)
  assert.match(providerJs, /debug-disconnect/)
  assert.match(providerJs, /new vscode\.ThemeColor\(serverColorId\)/)
  assert.doesNotMatch(providerJs, /statusItems\.mode/)
  assert.doesNotMatch(providerJs, /Ωedit Edit Mode/)
  assert.doesNotMatch(providerJs, /vscode\.l10n\.t\('INS'\)/)
  assert.doesNotMatch(providerJs, /vscode\.l10n\.t\('OVR'\)/)
  assert.doesNotMatch(providerJs, /editor\.action\.toggleOvertypeInsertMode/)
  assert.match(providerJs, /normalizeExternalHighlights/)
  assert.match(providerJs, /type:\s*['"]externalHighlights['"]/)
  assert.match(providerJs, /case\s+['"]editorStateChanged['"]/)
  assert.match(providerJs, /buildEditorState/)
  assert.match(providerJs, /clampedLength <= 0/)
  assert.match(providerJs, /const contentTypeSampleLength = Math\.min/)
  assert.match(
    providerJs,
    /getContentType\)\(session\.sessionId,\s*0,\s*contentTypeSampleLength\)/
  )
  assert.doesNotMatch(providerJs, /experimentalSvelteWebview/)
  assert.match(providerJs, /getSvelteWebviewContent/)
  assert.match(protocolJs, /normalizeWebviewMessage/)
  assert.match(protocolJs, /normalizeExternalHighlights/)
  assert.match(protocolJs, /editorStateChanged/)
  assert.match(protocolSource, /externalHighlights/)
  assert.match(protocolSource, /WebviewEditorState/)
  assert.match(protocolJs, /MAX_ANALYSIS_PROFILE_BYTES/)
  assert.match(protocolSource, /documentReverted/)
  assert.match(protocolJs, /case\s+['"]requestAnalysisProfile['"]/)
  assert.match(protocolJs, /case\s+['"]applyTransform['"]/)
  assert.match(apiDts, /OmegaEditExtensionApi/)
  assert.match(apiDts, /OMEGA_EDIT_EXTENSION_ID/)
  assert.match(apiDts, /extensionId/)
  assert.match(apiDts, /onDidChangeEditorState/)
  assert.match(apiDts, /setExternalHighlights/)
  assert.match(apiDts, /OmegaEditExternalHighlightKind/)
  assert.match(svelteHostJs, /svelte-webview/)
  assert.match(svelteHostJs, /Content-Security-Policy/)
  assert.doesNotMatch(svelteHostJs, /unsafe-inline/)
  assert.match(svelteHostJs, /webview\.js/)
  assert.match(svelteHostJs, /webview\.css/)
  assert.match(svelteHostJs, /vscode\.l10n\.t/)
  assert.match(svelteHostJs, /escapeHtmlText/)
  assert.match(svelteHostJs, /Loading OmegaEdit Data Editor/)
  assert.match(viteConfigSource, /cssCodeSplit:\s*false/)
  assert.doesNotMatch(svelteHostJs, /Svelte Preview/)
  assert.doesNotMatch(svelteBundleJs, /OmegaEdit Svelte Preview/)
  assert.match(svelteBundleJs, /Failed to start editor webview/)
  assert.match(svelteBundleJs, /setBytesPerRow/)
  assert.match(svelteBundleJs, /scrollTo/)
  assert.match(svelteBundleJs, /Find text or hex/)
  assert.match(svelteBundleJs, /Replace All/)
  assert.doesNotMatch(svelteBundleJs, /<StatusStrip/)
  assert.match(svelteBundleJs, /requestTransformPlugins/)
  assert.doesNotMatch(svelteBundleJs, /new App/)
  assert.match(svelteBundleCss, /--vscode-editor-background/)
  assert.match(svelteBundleCss, /--bytes-per-row/)
  assert.match(svelteBundleCss, /html,body,#app/)
  assert.match(svelteBundleCss, /width:\s*100%/)
  assert.match(svelteBundleCss, /height:\s*100%/)
  assert.match(svelteBundleCss, /overflow:\s*hidden/)
  assert.match(svelteBundleCss, /overscroll-behavior:\s*none/)
  assert.match(svelteBundleCss, /overscroll-behavior:\s*contain/)
  assert.match(svelteBundleCss, /bootstrap-status/)
  assert.doesNotMatch(svelteBundleCss, /\.app-header/)
  assert.doesNotMatch(svelteBundleCss, /\.badge/)
  assert.match(svelteBundleCss, /\.search-panel/)
  assert.match(svelteBundleCss, /\.transform-panel/)
  assert.doesNotMatch(svelteBundleCss, /\.transform-refresh/)
  assert.match(svelteBundleCss, /\.transform-dialog/)
  assert.match(svelteBundleCss, /\.transform-range-grid/)
  assert.match(svelteBundleCss, /\.transform-result-panel/)
  assert.match(svelteBundleCss, /\.transform-result-value/)
  assert.match(svelteBundleCss, /\.dialog-backdrop/)
  assert.match(svelteBundleCss, /\.help-example/)
  assert.match(svelteBundleCss, /\.byte\.searchHit/)
  assert.match(svelteBundleCss, /\.byte\.inspectorRange/)
  assert.match(svelteBundleCss, /\.byte\.externalHighlight:before/)
  assert.match(svelteBundleCss, /\.byte\.externalCurrent/)
  assert.match(svelteBundleCss, /\.byte\.externalParsed/)
  assert.match(svelteBundleCss, /\.byte\.externalError/)
  assert.match(svelteBundleCss, /\.byte\.externalBreakpoint/)
  assert.match(svelteBundleCss, /\.byte\.inspectorRange:not\(\.selected\)/)
  assert.match(svelteBundleCss, /\.byte\.inspectorRange:after/)
  assert.match(svelteBundleCss, /\.byte\.selected/)
  assert.match(svelteBundleCss, /\.byte-inspector-panel/)
  assert.match(svelteBundleCss, /\.inspector-toggle/)
  assert.match(svelteBundleCss, /\.inspector-byte-order/)
  assert.match(svelteBundleCss, /\.inspector-byte-order-toggle/)
  assert.match(svelteBundleCss, /\.inspector-edit-row/)
  assert.match(svelteBundleCss, /\.inspector-value-button/)
  assert.doesNotMatch(svelteBundleCss, /\.inspector-feedback:empty/)
  assert.match(svelteBundleCss, /\.editor-main/)
  assert.match(svelteBundleCss, /\.editor-grid-shell/)
  assert.match(svelteBundleCss, /\.file-scrollbar/)
  assert.match(svelteBundleCss, /\.file-scrollbar-track/)
  assert.match(svelteBundleCss, /\.file-scrollbar-thumb/)
  assert.match(svelteBundleCss, /\.offset-jump/)
  assert.match(svelteBundleCss, /\.offset-jump-input/)
  assert.match(svelteBundleCss, /\.offset-jump-status/)
  assert.match(svelteBundleCss, /--segmented-button-width/)
  assert.match(
    svelteBundleCss,
    /inline-size:\s*var\(--segmented-button-width\)/
  )
  assert.match(svelteBundleCss, /\.profiler-panel/)
  assert.match(svelteBundleCss, /\.profiler-panel\.collapsed/)
  assert.match(svelteBundleCss, /\.profiler-collapsed-label/)
  assert.match(svelteBundleCss, /\.profiler-collapsed-toggle/)
  assert.match(svelteBundleCss, /rotate\(90deg\)/)
  assert.match(svelteBundleCss, /\.analysis-tab\.active/)
  assert.match(svelteBundleCss, /\.analysis-section\.dragging/)
  assert.match(svelteBundleCss, /\.analysis-section-actions/)
  assert.match(svelteBundleCss, /\.analysis-drag-handle/)
  assert.match(svelteBundleCss, /\.hex-heading span/)
  assert.match(svelteBundleCss, /\.frequency-chart/)
  assert.match(svelteBundleCss, /\.hex-heading span\.hover/)
  assert.match(svelteBundleCss, /\.offset\.hover/)
  assert.match(svelteBundleCss, /\.byte\.columnHover/)
  assert.match(svelteBundleCss, /\.preview-grid\.overwrite \.byte\.activePane/)
  assert.match(
    svelteBundleCss,
    /\.preview-grid\.overwrite \.text-byte\.activePane/
  )
  assert.doesNotMatch(svelteBundleCss, /\.status-strip/)
  assert.doesNotMatch(svelteBundleCss, /\.server-health-tooltip/)
  assert.doesNotMatch(svelteBundleCss, /\.status-item\.mode/)
  for (const [name, source] of svelteComponentSources) {
    assert.match(source, /\$(props|state|derived|effect)\(/, name)
    assert.doesNotMatch(source, /(^|\n)\s*export\s+let\s/, name)
    assert.doesNotMatch(source, /(^|\n)\s*\$:/, name)
    assert.doesNotMatch(source, /on:[a-z]/, name)
  }
  assert.match(svelteAppSource, /selectionAnchor/)
  assert.match(svelteAppSource, /selectedOffset/)
  assert.match(svelteAppSource, /const DEFAULT_VISIBLE_ROWS = 16/)
  assert.match(svelteAppSource, /pendingVisibleOffset/)
  assert.match(svelteAppSource, /pendingSearchReveal/)
  assert.match(svelteAppSource, /externalHighlights = \$state/)
  assert.match(svelteAppSource, /function currentEditorUiState/)
  assert.match(svelteAppSource, /type: 'editorStateChanged'/)
  assert.match(svelteAppSource, /type: 'toggleEditMode'/)
  assert.match(svelteAppSource, /case 'editMode'/)
  assert.match(svelteAppSource, /type GridEditPane = 'hex' \| 'ascii'/)
  assert.match(
    svelteAppSource,
    /type InspectorEditMode = 'insert' \| 'overwrite'/
  )
  assert.match(svelteAppSource, /function requestVisibleOffset/)
  assert.match(svelteAppSource, /function canRenderVisibleOffset/)
  assert.match(svelteAppSource, /function computeMaxVisibleOffset/)
  assert.match(
    svelteAppSource,
    /maxScrollableOffset = \$derived\(computeMaxVisibleOffset/
  )
  assert.match(svelteAppSource, /function canScroll/)
  assert.match(svelteAppSource, /if \(!canScroll\(direction\)\)/)
  assert.match(
    svelteAppSource,
    /canScrollUp = \$derived\(\(pendingVisibleOffset \?\? visibleOffset\) > 0\)/
  )
  assert.match(svelteAppSource, /canScrollDown =/)
  assert.match(svelteAppSource, /currentTarget < maxScrollableOffset/)
  assert.match(
    svelteAppSource,
    /navigationOffset = \$derived\(pendingVisibleOffset \?\? visibleOffset\)/
  )
  assert.match(svelteAppSource, /function applyPendingSearchReveal/)
  assert.match(svelteAppSource, /function applyDocumentReverted/)
  assert.match(svelteAppSource, /case 'documentReverted'/)
  assert.match(svelteAppSource, /DEFAULT_ANALYSIS_SECTION_ORDER/)
  assert.match(svelteAppSource, /analysisSectionOrder = \$state/)
  assert.match(svelteAppSource, /function normalizeAnalysisSectionOrder/)
  assert.match(svelteAppSource, /function moveAnalysisSectionByDelta/)
  assert.match(svelteAppSource, /function reorderAnalysisSection/)
  assert.match(svelteAppSource, /savePreviewState/)
  assert.match(svelteAppSource, /function handleSearchNavigationResult/)
  assert.match(svelteAppSource, /kind: 'bounded'/)
  assert.match(
    svelteAppSource,
    /currentTarget = pendingVisibleOffset \?\? visibleOffset/
  )
  assert.match(svelteAppSource, /message\.visibleOffset !== requestedOffset/)
  assert.match(svelteAppSource, /viewportOffset/)
  assert.match(svelteAppSource, /visibleViewportData/)
  assert.match(svelteAppSource, /viewportOffset = message\.offset/)
  assert.match(svelteAppSource, /pendingVisibleOffset = undefined/)
  assert.match(svelteAppSource, /function selectRange/)
  assert.match(svelteAppSource, /selectRange\(offset, searchPatternLength\)/)
  assert.match(svelteAppSource, /onScroll=\{scrollPreview\}/)
  assert.match(svelteAppSource, /onJumpToBoundary=\{jumpToBoundary\}/)
  assert.doesNotMatch(svelteAppSource, /app-header/)
  assert.doesNotMatch(svelteAppSource, /strings\.app\.title/)
  assert.match(svelteAppSource, /SearchPanel/)
  assert.match(svelteAppSource, /normalizeSearchQuery/)
  assert.match(svelteAppSource, /getSearchPatternByteLength/)
  assert.match(svelteAppSource, /type: 'search'/)
  assert.match(svelteAppSource, /type: 'replace'/)
  assert.match(svelteAppSource, /type: 'replaceAllMatches'/)
  assert.match(svelteAppSource, /transformPlugins = \$state/)
  assert.match(svelteAppSource, /transformPluginsLoaded = \$state/)
  assert.match(svelteAppSource, /transformPluginsLoading = \$state/)
  assert.match(svelteAppSource, /transformPluginError = \$state/)
  assert.match(svelteAppSource, /transformFeedback = \$state/)
  assert.match(svelteAppSource, /transformResult = \$state/)
  assert.match(svelteAppSource, /transformResultHistory = \$state/)
  assert.match(svelteAppSource, /TRANSFORM_RESULT_HISTORY_LIMIT = 8/)
  assert.match(svelteAppSource, /TransformResultPanel/)
  assert.match(svelteAppSource, /function requestTransformPlugins/)
  assert.match(svelteAppSource, /if \(transformPluginsLoading\)/)
  assert.match(svelteAppSource, /function applyTransform/)
  assert.match(svelteAppSource, /type: 'applyTransform'/)
  assert.match(svelteAppSource, /offsetRadix: 'hex' \| 'dec'/)
  assert.match(
    svelteAppSource,
    /normalizeOffsetRadix\(restoredState\?\.offsetRadix\)/
  )
  assert.match(svelteAppSource, /savePreviewState\(\{ offsetRadix: radix \}\)/)
  assert.match(svelteAppSource, /case 'transformPlugins'/)
  assert.match(svelteAppSource, /transformPlugins = message\.plugins/)
  assert.match(svelteAppSource, /transformPluginsLoaded = true/)
  assert.match(svelteAppSource, /transformPluginsLoading = false/)
  assert.match(svelteAppSource, /case 'transformComplete'/)
  assert.match(svelteAppSource, /describeTransformComplete/)
  assert.match(svelteAppSource, /createTransformResult\(message\)/)
  assert.match(svelteAppSource, /rememberTransformResult/)
  assert.match(svelteAppSource, /openTransformResult/)
  assert.match(
    svelteAppSource,
    /selectRange\(message\.offset, transformedLength\)/
  )
  assert.match(svelteAppSource, /clearSearchResults\(\)/)
  assert.match(svelteAppSource, /type: 'findAdjacentMatch'/)
  assert.match(svelteAppSource, /type: 'goToMatch'/)
  assert.match(svelteAppSource, /case 'searchNavigationCommand'/)
  assert.match(svelteAppSource, /case 'replaceComplete'/)
  assert.match(svelteAppSource, /normalizeReplacementHex/)
  assert.match(svelteAppSource, /applySingleReplaceToSearchMatches/)
  assert.match(svelteAppSource, /hasActiveSearchResult/)
  assert.match(svelteAppSource, /runSearch\(direction\)/)
  assert.match(svelteAppSource, /copySelection/)
  assert.match(svelteAppSource, /INTERNAL_HEX_CLIPBOARD_FORMAT/)
  assert.match(svelteAppSource, /function handleClipboardCopy/)
  assert.match(svelteAppSource, /function handleClipboardPaste/)
  assert.match(svelteAppSource, /function decodeClipboardPaste/)
  assert.match(svelteAppSource, /function pasteClipboardHex/)
  assert.match(svelteAppSource, /cutSelection/)
  assert.match(svelteAppSource, /type: 'delete'/)
  assert.match(svelteAppSource, /function handleGridType/)
  assert.match(svelteAppSource, /function commitByteEdit/)
  assert.match(svelteAppSource, /function postDeleteRange/)
  assert.match(svelteAppSource, /function deleteFromKeyboard/)
  assert.match(svelteAppSource, /deletedBytes/)
  assert.match(svelteAppSource, /function toggleInspectorEditMode/)
  assert.match(svelteAppSource, /function isEditableTarget/)
  assert.match(svelteAppSource, /event\.key !== 'Insert'/)
  assert.match(
    svelteAppSource,
    /window\.addEventListener\('keydown', keyListener\)/
  )
  assert.match(svelteAppSource, /function commitInspectorValue/)
  assert.match(svelteAppSource, /function inspectRange/)
  assert.match(svelteAppSource, /function jumpToBoundary/)
  assert.match(svelteAppSource, /boundary === 'top' \? 0 : maxScrollableOffset/)
  assert.match(svelteAppSource, /function goToOffset/)
  assert.match(svelteAppSource, /offset < 0 \|\| offset >= fileSize/)
  assert.match(svelteAppSource, /onGoToOffset=\{goToOffset\}/)
  assert.match(svelteAppSource, /scrollOffset=\{navigationOffset\}/)
  assert.match(svelteAppSource, /onScrollTo=\{requestVisibleOffset\}/)
  assert.match(svelteAppSource, /function toggleInspectorEndian/)
  assert.match(svelteAppSource, /function toggleInspectorExpanded/)
  assert.match(svelteAppSource, /function setOffsetRadix/)
  assert.match(svelteAppSource, /offsetRadix = \$state<'hex' \| 'dec'>/)
  assert.match(svelteAppSource, /function formatSearchOffset/)
  assert.match(
    svelteAppSource,
    /strings\.search\.largeMatchSummary\(\s*searchWindowLimit,\s*formatSearchOffset\(searchCurrentOffset\)/
  )
  assert.match(
    svelteAppSource,
    /strings\.search\.boundedMatchSummary\([\s\S]*formatSearchOffset\(searchMatches\[searchMatchIndex\]\)/
  )
  assert.match(
    svelteAppSource,
    /inspectorBytes = \$derived\(visibleBytesAt\([\s\S]*viewportData[\s\S]*viewportOffset[\s\S]*fileSize/
  )
  assert.match(svelteAppSource, /type: 'insert'/)
  assert.match(svelteAppSource, /type: 'overwrite'/)
  assert.match(svelteAppSource, /invalidAsciiByte/)
  assert.match(svelteAppSource, /pendingHexLabel/)
  assert.match(
    svelteAppSource,
    /document\.addEventListener\('copy', copyListener\)/
  )
  assert.match(
    svelteAppSource,
    /document\.addEventListener\('paste', pasteListener\)/
  )
  assert.match(svelteAppSource, /clipboardComplete/)
  assert.match(svelteAppSource, /ByteInspector/)
  assert.match(svelteAppSource, /EditorWorkspace/)
  assert.match(svelteAppSource, /MAX_ANALYSIS_PROFILE_BYTES/)
  assert.match(svelteAppSource, /latestDataProfile/)
  assert.match(svelteAppSource, /latestViewportProfile/)
  assert.match(svelteAppSource, /serverHealth = \$state/)
  assert.match(svelteAppSource, /function requestAnalysisProfile/)
  assert.match(svelteAppSource, /postToHost\(message\)/)
  assert.match(svelteAppSource, /case 'analysisProfile'/)
  assert.match(svelteAppSource, /case 'serverHealth'/)
  assert.match(svelteAppSource, /serverHealth = message/)
  assert.match(svelteAppSource, /case 'externalHighlights'/)
  assert.match(svelteAppSource, /dataProfile=\{latestDataProfile\}/)
  assert.match(svelteAppSource, /viewportProfile=\{latestViewportProfile\}/)
  assert.match(svelteAppSource, /\{serverHealth\}/)
  assert.match(svelteAppSource, /visibleByteCount=\{visibleByteCount\(\)\}/)
  assert.match(editorWorkspaceSource, /PreviewGrid/)
  assert.match(editorWorkspaceSource, /FileScrollbar/)
  assert.match(editorWorkspaceSource, /editor-grid-shell/)
  assert.match(editorWorkspaceSource, /scrollOffset/)
  assert.match(editorWorkspaceSource, /onScrollTo/)
  assert.match(editorWorkspaceSource, /ProfilerPanel/)
  assert.match(editorWorkspaceSource, /onToggleProfilerExpanded/)
  assert.match(editorWorkspaceSource, /onProfilerModeChange/)
  assert.match(editorWorkspaceSource, /analysisSectionOrder/)
  assert.match(editorWorkspaceSource, /onMoveAnalysisSection/)
  assert.match(editorWorkspaceSource, /onReorderAnalysisSection/)
  assert.match(editorWorkspaceSource, /externalHighlights/)
  assert.match(editorWorkspaceSource, /dataProfile/)
  assert.match(editorWorkspaceSource, /viewportProfile/)
  assert.match(editorWorkspaceSource, /serverHealth/)
  assert.match(profilerPanelSource, /SERVER_LIVE_STATUS_METRIC_IDS/)
  assert.match(profilerPanelSource, /SERVER_CURRENT_INSTANCE_METRIC_IDS/)
  assert.match(profilerPanelSource, /SERVER_HOST_BUILD_METRIC_IDS/)
  assert.doesNotMatch(profilerPanelSource, /SERVER_LIVE_STATUS_LABELS/)
  assert.doesNotMatch(profilerPanelSource, /SERVER_CURRENT_INSTANCE_LABELS/)
  assert.doesNotMatch(profilerPanelSource, /SERVER_HOST_BUILD_LABELS/)
  assert.match(previewGridSource, /id="previewGrid"/)
  assert.match(previewGridSource, /onkeydown/)
  assert.match(previewGridSource, /onpointerdown/)
  assert.match(previewGridSource, /onpointermove/)
  assert.match(previewGridSource, /onpointerup/)
  assert.match(previewGridSource, /onpointercancel/)
  assert.match(previewGridSource, /onwheel/)
  assert.match(previewGridSource, /onMoveSelection/)
  assert.match(previewGridSource, /canScrollUp/)
  assert.match(previewGridSource, /canScrollDown/)
  assert.match(previewGridSource, /event\.stopPropagation\(\)/)
  assert.match(previewGridSource, /event\.deltaY === 0/)
  assert.match(previewGridSource, /case 'Insert'/)
  assert.match(previewGridSource, /case 'Backspace'/)
  assert.match(previewGridSource, /case 'Delete'/)
  assert.match(previewGridSource, /case 'Home'/)
  assert.match(previewGridSource, /onJumpToBoundary\('top'\)/)
  assert.match(previewGridSource, /case 'End'/)
  assert.match(previewGridSource, /onJumpToBoundary\('bottom'\)/)
  assert.match(previewGridSource, /onToggleEditMode/)
  assert.match(previewGridSource, /onTypeByte\(activePane, event\.key\)/)
  assert.match(previewGridSource, /onDeleteByte/)
  assert.doesNotMatch(previewGridSource, /onJumpSelection/)
  assert.match(previewGridSource, /handlePointerDown\('hex'/)
  assert.match(previewGridSource, /handlePointerDown\('ascii'/)
  assert.match(previewGridSource, /isDraggingSelection/)
  assert.match(previewGridSource, /dragPointerId/)
  assert.match(previewGridSource, /function handlePointerDown/)
  assert.match(previewGridSource, /function handlePointerMove/)
  assert.match(previewGridSource, /function stopDraggingSelection/)
  assert.match(previewGridSource, /setPointerCapture/)
  assert.match(previewGridSource, /releasePointerCapture/)
  assert.match(previewGridSource, /data-offset=\{byteOffset\}/)
  assert.match(previewGridSource, /data-column=\{index\}/)
  assert.match(previewGridSource, /data-pane="hex"/)
  assert.match(previewGridSource, /data-pane="ascii"/)
  assert.match(previewGridSource, /class:hover=\{index === hoveredColumn\}/)
  assert.match(
    previewGridSource,
    /class:hover=\{rowIndex === hoveredRowIndex\}/
  )
  assert.match(previewGridSource, /class:columnHover/)
  assert.match(previewGridSource, /class:activePane/)
  assert.match(previewGridSource, /class:printable=\{isPrintable\(byte\)\}/)
  assert.match(previewGridSource, /class:control=\{isControlByte\(byte\)\}/)
  assert.match(previewGridSource, /class:high-bit=\{isHighBitByte\(byte\)\}/)
  assert.match(previewGridSource, /function isControlByte/)
  assert.match(previewGridSource, /function isHighBitByte/)
  assert.match(previewGridSource, /function formatBinary/)
  assert.match(previewGridSource, /function formatTooltipText/)
  assert.match(previewGridSource, /function byteClassLabel/)
  assert.match(previewGridSource, /function formatByteHoverTitle/)
  assert.match(previewGridSource, /strings\.grid\.byteHoverTitle/)
  assert.match(previewGridSource, /strings\.grid\.notPrintable/)
  assert.match(previewGridSource, /offsetRadix/)
  assert.match(previewGridSource, /function formatColumnOffset/)
  assert.match(previewGridSource, /strings\.grid\.hexByteTitle/)
  assert.match(previewGridSource, /strings\.grid\.textByteTitle/)
  assert.doesNotMatch(previewGridSource, /function formatHexOffset/)
  assert.match(previewGridSource, /inspectorStart/)
  assert.match(previewGridSource, /class:inspectorRange/)
  assert.match(previewGridSource, /externalHighlightByOffset = \$derived\.by/)
  assert.match(previewGridSource, /visibleByteCount/)
  assert.match(previewGridSource, /lookup\.size >= visibleByteCount/)
  assert.match(previewGridSource, /externalHighlightFor/)
  assert.match(
    previewGridSource,
    /externalHighlightByOffset\.get\(byteOffset\)/
  )
  assert.match(previewGridSource, /externalKind/)
  assert.match(previewGridSource, /byteTitle/)
  assert.match(previewGridSource, /class:externalHighlight/)
  assert.match(previewGridSource, /class:externalCurrent/)
  assert.match(previewGridSource, /class:externalParsed/)
  assert.match(previewGridSource, /class:externalError/)
  assert.match(previewGridSource, /class:externalBreakpoint/)
  assert.match(previewGridSource, /FALLBACK_VISIBLE_ROWS/)
  assert.match(previewGridSource, /availableHeight/)
  assert.match(previewGridSource, /Math\.max\(1, Math\.floor/)
  assert.match(previewGridSource, /ResizeObserver/)
  assert.match(previewGridSource, /onVisibleRowsChange/)
  assert.match(
    previewGridSource,
    /class=\{`preview-grid bytes-\$\{bytesPerRow\}`\}/
  )
  assert.match(previewGridSource, /role="grid"/)
  assert.match(previewGridSource, /role="row"/)
  assert.match(previewGridSource, /role="columnheader"/)
  assert.match(previewGridSource, /role="rowheader"/)
  assert.match(previewGridSource, /role="gridcell"/)
  assert.match(previewGridSource, /aria-selected/)
  assert.match(previewGridSource, /aria-label=\{byteTitle\}/)
  assert.match(previewGridSource, /title=\{byteTitle\}/)
  assert.match(previewGridSource, /searchStart/)
  assert.match(previewGridSource, /class:searchHit/)
  assert.match(previewGridSource, /class="text-byte"/)
  assert.match(previewGridSource, /formatAscii\(byte\)/)
  assert.match(i18nSource, /byteHoverTitle/)
  assert.match(i18nSource, /HEX Byte/)
  assert.match(
    i18nSource,
    /largeMatchSummary: \(limit: number, offset: string\)/
  )
  assert.match(
    i18nSource,
    /boundedMatchSummary: \(index: number, total: number, offset: string\)/
  )
  assert.doesNotMatch(i18nSource, /matches @ 0x/)
  assert.doesNotMatch(i18nSource, /Hex offset/)
  assert.doesNotMatch(i18nSource, /Decimal offset/)
  assert.match(i18nSource, /externalHighlight/)
  assert.match(i18nSource, /text: 'TEXT'/)
  assert.match(i18nSource, /resultAvailable/)
  assert.match(i18nSource, /resultHistoryTitle/)
  assert.match(i18nSource, /rangeEndBeforeStart/)
  assert.match(toolbarSource, /strings\.toolbar\.offsetRadix/)
  assert.match(toolbarSource, /strings\.toolbar\.hexOffsets/)
  assert.match(toolbarSource, /strings\.toolbar\.decOffsets/)
  assert.match(toolbarSource, /onOffsetRadix/)
  assert.match(toolbarSource, /OffsetJump/)
  assert.match(toolbarSource, /fileSize/)
  assert.match(toolbarSource, /onGoToOffset/)
  assert.match(toolbarSource, /TransformPanel/)
  assert.match(toolbarSource, /\{fileSize\}/)
  assert.match(toolbarSource, /pluginsLoaded=\{transformPluginsLoaded\}/)
  assert.match(toolbarSource, /pluginsLoading=\{transformPluginsLoading\}/)
  assert.match(toolbarSource, /transformResults/)
  assert.match(toolbarSource, /onOpenTransformResult/)
  assert.match(toolbarSource, /onRequestTransforms/)
  assert.match(toolbarSource, /onApplyTransform/)
  assert.doesNotMatch(toolbarSource, /canUndo/)
  assert.doesNotMatch(toolbarSource, /canRedo/)
  assert.doesNotMatch(toolbarSource, /onUndo/)
  assert.doesNotMatch(toolbarSource, /onRedo/)
  assert.doesNotMatch(toolbarSource, /strings\.toolbar\.undo/)
  assert.doesNotMatch(toolbarSource, /strings\.toolbar\.redo/)
  assert.match(transformPanelSource, /strings\.transform\.label/)
  assert.match(transformPanelSource, /function advertisedTransformExamples/)
  assert.match(transformPanelSource, /function validateJsonSchemaValue/)
  assert.match(transformPanelSource, /function validateTransformOptions/)
  assert.match(transformPanelSource, /function validateTransformRange/)
  assert.match(transformPanelSource, /function parseOffsetInput/)
  assert.match(transformPanelSource, /function useMaxRangeEnd/)
  assert.match(transformPanelSource, /function openTransformDialog/)
  assert.match(transformPanelSource, /function applySelectedTransform/)
  assert.match(transformPanelSource, /rangeStartInput = \$state/)
  assert.match(transformPanelSource, /rangeEndInput = \$state/)
  assert.match(transformPanelSource, /savedOptionsByPluginId = \$state/)
  assert.match(transformPanelSource, /pluginsLoading/)
  assert.match(transformPanelSource, /pluginsLoaded/)
  assert.match(transformPanelSource, /onRequestTransforms/)
  assert.match(transformPanelSource, /onApplyTransform/)
  assert.match(transformPanelSource, /role="dialog"/)
  assert.match(transformPanelSource, /aria-modal="true"/)
  assert.match(transformPanelSource, /MAX_TRANSFORM_OPTIONS_LENGTH/)
  assert.match(
    transformPanelSource,
    /maxlength=\{MAX_TRANSFORM_OPTIONS_LENGTH\}/
  )
  assert.match(
    transformPanelSource,
    /aria-label=\{strings\.transform\.closeDialog\}/
  )
  assert.match(transformPanelSource, /class="transform-select"/)
  assert.match(transformPanelSource, /class="transform-result-history"/)
  assert.match(transformPanelSource, /onOpenTransformResult/)
  assert.match(transformPanelSource, /class="help-example"/)
  assert.match(transformPanelSource, /JSON\.parse\(rawOptionsJson\)/)
  assert.match(transformPanelSource, /argsSchema/)
  assert.match(transformPanelSource, /strings\.transform\.invalidJson/)
  assert.match(transformPanelSource, /strings\.transform\.invalidSchema/)
  assert.match(transformPanelSource, /strings\.transform\.maxOffset/)
  assert.match(
    transformPanelSource,
    /onApplyTransform\([\s\S]*plugin\.id[\s\S]*transformRange\.offset[\s\S]*transformRange\.length/
  )
  assert.doesNotMatch(transformPanelSource, /transform-refresh/)
  assert.doesNotMatch(transformPanelSource, /refreshTransforms/)
  assert.match(transformResultPanelSource, /strings\.transform\.resultTitle/)
  assert.match(transformResultPanelSource, /navigator\.clipboard\.writeText/)
  assert.match(transformResultPanelSource, /class="transform-result-value"/)
  assert.match(transformResultPanelSource, /onDismiss/)
  assert.doesNotMatch(toolbarSource, /onTop/)
  assert.doesNotMatch(toolbarSource, /onScrollUp/)
  assert.doesNotMatch(toolbarSource, /onScrollDown/)
  assert.doesNotMatch(toolbarSource, /strings\.toolbar\.top/)
  assert.doesNotMatch(toolbarSource, /strings\.toolbar\.previous/)
  assert.doesNotMatch(toolbarSource, /strings\.toolbar\.next/)
  assert.match(offsetJumpSource, /strings\.navigation\.offsetLabel/)
  assert.match(offsetJumpSource, /strings\.navigation\.offsetPlaceholderHex/)
  assert.match(offsetJumpSource, /strings\.navigation\.offsetPlaceholderDec/)
  assert.match(offsetJumpSource, /offsetRadix === 'hex'/)
  assert.match(offsetJumpSource, /Number\.parseInt\(source, valueBase\)/)
  assert.match(offsetJumpSource, /parsedOffset >= fileSize/)
  assert.match(offsetJumpSource, /aria-invalid/)
  assert.match(offsetJumpSource, /id="offsetJumpInput"/)
  assert.match(offsetJumpSource, /onGoToOffset\(parsedOffset\)/)
  assert.match(fileScrollbarSource, /role="scrollbar"/)
  assert.match(fileScrollbarSource, /aria-controls="previewGrid"/)
  assert.match(fileScrollbarSource, /strings\.navigation\.scrollbarLabel/)
  assert.match(fileScrollbarSource, /requestAnimationFrame/)
  assert.match(fileScrollbarSource, /ResizeObserver/)
  assert.match(fileScrollbarSource, /function scrollFromTrackPosition/)
  assert.match(fileScrollbarSource, /function handleKeydown/)
  assert.match(fileScrollbarSource, /maxStartRow/)
  assert.match(fileScrollbarSource, /onScrollTo\(nextOffset\)/)
  assert.match(fileScrollbarSource, /<svg/)
  assert.doesNotMatch(fileScrollbarSource, /dynamicThumbStyle/)
  assert.match(searchPanelSource, /strings\.search\.label/)
  assert.match(searchPanelSource, /onSearch/)
  assert.match(searchPanelSource, /onNavigate/)
  assert.match(searchPanelSource, /strings\.search\.next/)
  assert.match(searchPanelSource, /strings\.search\.previous/)
  assert.match(searchPanelSource, /strings\.search\.replacePlaceholder/)
  assert.match(searchPanelSource, /strings\.search\.replaceAll/)
  assert.match(searchPanelSource, /canNavigate/)
  assert.match(searchPanelSource, /canReplace/)
  assert.match(searchPanelSource, /onReplaceAll/)
  assert.match(searchPanelSource, /caseInsensitive/)
  assert.doesNotMatch(searchPanelSource, />Search Next</)
  assert.doesNotMatch(searchPanelSource, />Replace All</)
  assert.match(byteInspectorSource, /strings\.inspector\.label/)
  assert.match(byteInspectorSource, /strings\.inspector\.byteOrder/)
  assert.match(byteInspectorSource, /strings\.inspector\.littleEndian/)
  assert.match(byteInspectorSource, /strings\.inspector\.bigEndian/)
  assert.match(byteInspectorSource, /strings\.inspector\.utf8/)
  assert.match(byteInspectorSource, /strings\.inspector\.utf16/)
  assert.match(byteInspectorSource, /\$props\(\)/)
  assert.match(byteInspectorSource, /\$state\(/)
  assert.match(byteInspectorSource, /\$derived\(/)
  assert.match(byteInspectorSource, /\$effect\(/)
  assert.match(byteInspectorSource, /lastSelectedOffset/)
  assert.match(byteInspectorSource, /function decodeFirstUtf8/)
  assert.match(byteInspectorSource, /function decodeFirstUtf16/)
  assert.match(byteInspectorSource, /function integerField/)
  assert.match(byteInspectorSource, /function writeIntegerBytes/)
  assert.match(byteInspectorSource, /strings\.inspector\.invalidAsciiByte/)
  assert.match(byteInspectorSource, /getBigUint64/)
  assert.match(byteInspectorSource, /byteLength/)
  assert.match(byteInspectorSource, /fieldByteLength/)
  assert.match(byteInspectorSource, /expanded/)
  assert.match(byteInspectorSource, /onToggleExpanded/)
  assert.match(
    byteInspectorSource,
    /class="segmented inspector-byte-order-toggle"/
  )
  assert.match(byteInspectorSource, /aria-pressed=\{littleEndian\}/)
  assert.match(byteInspectorSource, /aria-pressed=\{!littleEndian\}/)
  assert.match(byteInspectorSource, /float32/)
  assert.match(byteInspectorSource, /editable: false/)
  assert.match(byteInspectorSource, /inspector-value-button/)
  assert.match(byteInspectorSource, /class:inspector-value-readonly/)
  assert.doesNotMatch(byteInspectorSource, /class:readonly/)
  assert.match(byteInspectorSource, /onToggleEndian/)
  assert.match(byteInspectorSource, /onCommitValue/)
  assert.match(byteInspectorSource, /onInspectRange/)
  assert.match(byteInspectorSource, /isPrintableAscii/)
  assert.doesNotMatch(byteInspectorSource, /onCopyByte/)
  assert.doesNotMatch(byteInspectorSource, /onCopyRange/)
  assert.match(profilerPanelSource, /strings\.profiler\.label/)
  assert.match(profilerPanelSource, /data-analysis-panel="profile"/)
  assert.match(profilerPanelSource, /data-analysis-panel="structure"/)
  assert.match(profilerPanelSource, /sectionId === 'frequency'/)
  assert.match(profilerPanelSource, /sectionId === 'server'/)
  assert.match(profilerPanelSource, /buildServerRows/)
  assert.match(profilerPanelSource, /serverRows/)
  assert.match(profilerPanelSource, /SERVER_CURRENT_INSTANCE_METRIC_IDS/)
  assert.match(profilerPanelSource, /SERVER_HOST_BUILD_METRIC_IDS/)
  assert.match(profilerPanelSource, /strings\.profiler\.liveStatus/)
  assert.match(profilerPanelSource, /strings\.profiler\.currentInstance/)
  assert.match(profilerPanelSource, /strings\.profiler\.hostAndBuild/)
  assert.match(profilerPanelSource, /strings\.profiler\.details/)
  assert.match(profilerPanelSource, /row\.kind === 'heading'/)
  assert.match(profilerPanelSource, /server-health-section/)
  assert.doesNotMatch(profilerPanelSource, /serverRows\.slice\(1\)/)
  assert.match(profilerPanelSource, /analysis-collapse-button/)
  assert.match(profilerPanelSource, /sectionCollapseLabel/)
  assert.match(profilerPanelSource, /sectionCollapseGlyph/)
  assert.equal(
    (profilerPanelSource.match(/class="analysis-collapse-button"/g) ?? [])
      .length,
    8
  )
  assert.match(profilerPanelSource, /server-health-value/)
  assert.match(profilerPanelSource, /toggleSectionCollapsed/)
  assert.match(profilerPanelSource, /data-analysis-section=\{sectionId\}/)
  assert.match(profilerPanelSource, /DEFAULT_ANALYSIS_SECTION_ORDER/)
  assert.match(profilerPanelSource, /sectionOrder/)
  assert.match(profilerPanelSource, /data-analysis-drag="true"/)
  assert.match(profilerPanelSource, /function handleDragPointerDown/)
  assert.match(profilerPanelSource, /function handleDragPointerMove/)
  assert.match(profilerPanelSource, /function handleDragKeydown/)
  assert.match(profilerPanelSource, /onMoveSection/)
  assert.match(profilerPanelSource, /onReorderSection/)
  assert.match(profilerPanelSource, /frequencyScale/)
  assert.match(profilerPanelSource, /function analyzeBytes/)
  assert.match(profilerPanelSource, /function frequencyBarHeight/)
  assert.match(profilerPanelSource, /function barWidth/)
  assert.match(
    profilerPanelSource,
    /sectionId === 'frequency'[\s\S]*class="analysis-mini-button"[\s\S]*class="analysis-collapse-button"[\s\S]*class="analysis-drag-handle"/
  )
  assert.match(profilerPanelSource, /frequency-bars/)
  assert.doesNotMatch(profilerPanelSource, /dynamicWidth/)
  assert.doesNotMatch(profilerPanelSource, /dynamicBarHeight/)
  assert.doesNotMatch(profilerPanelSource, /dynamicTranslate/)
  assert.doesNotMatch(profilerPanelSource, /onRefresh/)
  assert.match(profilerPanelSource, /class:collapsed/)
  assert.match(profilerPanelSource, /profiler-collapsed-toggle/)
  assert.match(profilerPanelSource, /profiler-collapsed-label/)
  assert.match(svelteBundleCss, /--omega-byte-class-printable/)
  assert.match(svelteBundleCss, /--omega-byte-class-control/)
  assert.match(svelteBundleCss, /--omega-byte-class-high-bit/)
  assert.match(svelteBundleCss, /\.server-health-section/)
  assert.match(svelteBundleCss, /\.text-byte\.control/)
  assert.match(svelteBundleCss, /\.text-byte\.high-bit/)
  assert.match(
    svelteBundleCss,
    /\.analysis-bar-fill\.printable\{fill:var\(--omega-byte-class-printable\)/
  )
  assert.match(
    svelteBundleCss,
    /\.frequency-bar\.high-bit\{fill:var\(--omega-byte-class-high-bit\)/
  )
  assert.match(svelteBundleCss, /\.server-health-value\.ok/)
  assert.match(svelteBundleCss, /\.server-health-value\.warn/)
  assert.match(svelteBundleCss, /\.server-health-value\.error/)

  const extensionJs = fs.readFileSync(
    path.resolve(__dirname, '../out/extension.js'),
    'utf8'
  )
  assert.match(extensionJs, /transformPluginDirectories/)
  assert.match(extensionJs, /OMEGA_EDIT_UNDO_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_REDO_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_TOGGLE_INSERT_DIRECTION_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_SEARCH_NEXT_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND/)
  assert.match(extensionJs, /searchNextActive/)
  assert.match(extensionJs, /searchPreviousActive/)
  assert.match(extensionJs, /refreshActiveTransformPlugins/)
  assert.match(extensionJs, /OMEGA_EDIT_ROLLBACK_SESSION_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_GET_EDITOR_STATE_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND/)
  assert.match(extensionJs, /OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND/)
  assert.match(extensionJs, /getEditorState/)
  assert.match(extensionJs, /setExternalHighlights/)
  assert.match(extensionJs, /clearExternalHighlights/)
  assert.match(extensionJs, /createOmegaEditExtensionApi/)
  assert.match(extensionJs, /OMEGA_EDIT_EXTENSION_ID/)
  assert.match(extensionJs, /OMEGA_EDIT_EXTENSION_API_VERSION/)
  assert.match(extensionJs, /extensionId/)
  assert.match(extensionJs, /onDidChangeEditorState/)
  assert.match(extensionJs, /revealOffset/)
  assert.match(extensionJs, /OmegaEdit requires a non-negative integer offset/)
  assert.match(extensionJs, /undoActive/)
  assert.match(extensionJs, /redoActive/)
  assert.match(extensionJs, /setInsertDirection/)
  assert.match(extensionJs, /rollbackActiveSession/)
  assert.match(extensionJs, /rollbackActiveCheckpoint/)
  assert.match(extensionJs, /createActiveCheckpoint/)
  assert.match(extensionJs, /getDefaultTransformPluginDirectories/)
  assert.match(extensionJs, /findRepositoryRoot/)
  assert.match(extensionJs, /path\.resolve\(extensionPath,\s*['"]\.\.['"]\)/)
  assert.match(extensionJs, /normalizeWindowsPath/)
  assert.match(extensionJs, /replace\(\/\\\/\/g,\s*['"]\\\\['"]\)/)
  assert.match(extensionJs, /_build_core['"],\s*['"]plugins['"],\s*['"]plugins/)
  assert.match(extensionJs, /directoryHasTransformPlugin/)
  assert.match(extensionJs, /resolveServerConnection/)
  assert.match(extensionJs, /OMEGA_EDIT_SERVER_SOCKET/)
  assert.match(extensionJs, /XDG_RUNTIME_DIR/)
  assert.match(extensionJs, /WINDOWS_UNIX_SOCKET_UNSUPPORTED_MESSAGE/)
  assert.match(extensionJs, /\/tmp['"],\s*['"]omega-edit/)
  assert.match(extensionJs, /process\.platform === ['"]darwin['"]/)
  assert.match(extensionJs, /process\.platform === ['"]linux['"]/)
  assert.doesNotMatch(extensionJs, /platformAllowsUnixSocketFallback/)
  assert.doesNotMatch(extensionJs, /process\.platform === ['"]win32['"]/)
  assert.match(extensionJs, /startTcpServerConnection/)
  assert.doesNotMatch(extensionJs, /fallbackReason/)
  assert.match(extensionJs, /startServerUnixSocket/)
  assert.match(
    extensionJs,
    /startServer\)\(\s*tcpConnection\.port,\s*undefined,\s*undefined,\s*\{\s*transformPluginDirectories/
  )
  assert.match(
    extensionJs,
    /getClient\)\(connection\.port,\s*undefined,\s*\{\s*socketPath:\s*connection\.socketPath/
  )
})

test('webview protocol normalizes editor commands and rejects invalid ranges', () => {
  const context = { fileSize: 10 }

  assert.equal(normalizeBytesPerRow(24), 16)
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'editorStateChanged',
      visibleOffset: 0,
      visibleByteCount: 10,
      selectedOffset: 2,
      selectionStart: 2,
      selectionEnd: 5,
      selectionLength: 4,
      bytesPerRow: 16,
      offsetRadix: 'hex',
      activePane: 'ascii',
      editMode: 'overwrite',
      insertDirection: 'forward',
    }),
    {
      type: 'editorStateChanged',
      visibleOffset: 0,
      visibleByteCount: 10,
      selectedOffset: 2,
      selectionStart: 2,
      selectionEnd: 5,
      selectionLength: 4,
      bytesPerRow: 16,
      offsetRadix: 'hex',
      activePane: 'ascii',
      editMode: 'overwrite',
      insertDirection: 'forward',
    }
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'editorStateChanged',
      visibleOffset: 0,
      visibleByteCount: 10,
      selectedOffset: 2,
      selectionStart: 2,
      selectionEnd: 5,
      selectionLength: 4,
      bytesPerRow: 16,
      offsetRadix: 'hex',
      activePane: 'ascii',
      editMode: 'overwrite',
    }),
    {
      type: 'editorStateChanged',
      visibleOffset: 0,
      visibleByteCount: 10,
      selectedOffset: 2,
      selectionStart: 2,
      selectionEnd: 5,
      selectionLength: 4,
      bytesPerRow: 16,
      offsetRadix: 'hex',
      activePane: 'ascii',
      editMode: 'overwrite',
      insertDirection: 'forward',
    }
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'editorStateChanged',
      visibleOffset: 0,
      visibleByteCount: 10,
      selectedOffset: 2,
      selectionStart: 2,
      selectionEnd: 5,
      selectionLength: 3,
      bytesPerRow: 16,
      offsetRadix: 'hex',
      activePane: 'ascii',
      editMode: 'insert',
      insertDirection: 'backward',
    }),
    undefined
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, { type: 'toggleEditMode' }),
    {
      type: 'toggleEditMode',
    }
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'setInsertDirection',
      insertDirection: 'backward',
    }),
    {
      type: 'setInsertDirection',
      insertDirection: 'backward',
    }
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'scrollTo',
      offset: 9,
    }),
    { type: 'scrollTo', offset: 9 }
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'scrollTo',
      offset: 10,
    }),
    undefined
  )
  assert.deepEqual(
    normalizeWebviewMessage(
      { fileSize: 0 },
      {
        type: 'scrollTo',
        offset: 0,
      }
    ),
    { type: 'scrollTo', offset: 0 }
  )
  assert.deepEqual(
    normalizeExternalHighlights(context, [
      {
        id: 'dfdl.current',
        offset: 2,
        length: 3,
        kind: 'current',
        label: 'Current parse point',
        source: 'DFDL',
      },
      {
        id: 'dfdl.error',
        offset: 8,
        length: 1,
        kind: 'error',
        label: '',
      },
    ]),
    [
      {
        id: 'dfdl.current',
        offset: 2,
        length: 3,
        kind: 'current',
        label: 'Current parse point',
        source: 'DFDL',
      },
      {
        id: 'dfdl.error',
        offset: 8,
        length: 1,
        kind: 'error',
        label: 'error',
        source: undefined,
      },
    ]
  )
  assert.equal(
    normalizeExternalHighlights(context, [
      { id: 'duplicate', offset: 0, length: 1, kind: 'current' },
      { id: 'duplicate', offset: 1, length: 1, kind: 'parsed' },
    ]),
    undefined
  )
  assert.equal(
    normalizeExternalHighlights(context, [
      { id: 'outside', offset: 9, length: 2, kind: 'error' },
    ]),
    undefined
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'setBytesPerRow',
      bytesPerRow: 16,
    }),
    { type: 'setBytesPerRow', bytesPerRow: 16 }
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'setBytesPerRow',
      bytesPerRow: 24,
    }),
    undefined
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'insert',
      offset: 10,
      data: 'aa ff',
    }),
    { type: 'insert', offset: 10, data: 'aaff' }
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'insert',
      offset: 11,
      data: 'ff',
    }),
    undefined
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'delete',
      offset: 2,
      length: 3,
    }),
    { type: 'delete', offset: 2, length: 3 }
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'delete',
      offset: 8,
      length: 3,
    }),
    undefined
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'replace',
      offset: 10,
      length: 0,
      data: '',
    }),
    { type: 'replace', offset: 10, length: 0, data: '' }
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'overwrite',
      offset: 10,
      data: 'ff',
    }),
    undefined
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'copySelection',
      offset: 1,
      length: 4,
      format: 'utf8',
    }),
    { type: 'copySelection', offset: 1, length: 4, format: 'utf8' }
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'copySelection',
      offset: 1,
      length: 4,
      format: 'base64',
    }),
    undefined
  )
})

test('webview protocol normalizes analysis, search, and transform messages', () => {
  const context = { fileSize: 100_000 }
  const requestedLength = MAX_ANALYSIS_PROFILE_BYTES + 512

  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'requestAnalysisProfile',
      offset: 0,
      length: requestedLength,
      requestKey: 'visible',
      scopeLabel: 'Visible Range',
      requestedLength,
      isCapped: true,
    }),
    {
      type: 'requestAnalysisProfile',
      offset: 0,
      length: MAX_ANALYSIS_PROFILE_BYTES,
      requestKey: 'visible',
      scopeLabel: 'Visible Range',
      requestedLength,
      isCapped: true,
    }
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'requestAnalysisProfile',
      offset: 99_999,
      length: 2,
      requestKey: 'outside',
      scopeLabel: 'Outside Range',
      requestedLength: 2,
      isCapped: false,
    }),
    undefined
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'requestAnalysisProfile',
      offset: 10,
      length: 0,
      requestKey: 'empty',
      scopeLabel: 'Empty Range',
      requestedLength: 0,
      isCapped: false,
    }),
    undefined
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'search',
      query: '  needle  ',
      isHex: false,
      caseInsensitive: true,
      isReverse: true,
    }),
    {
      type: 'search',
      query: 'needle',
      isHex: false,
      caseInsensitive: true,
      isReverse: true,
    }
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'findAdjacentMatch',
      query: '41 42',
      isHex: true,
      direction: 'forward',
      offset: 99_999,
    }),
    {
      type: 'findAdjacentMatch',
      query: '4142',
      isHex: true,
      caseInsensitive: false,
      direction: 'forward',
      offset: 99_999,
    }
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'goToMatch',
      offset: 99_999,
    }),
    { type: 'goToMatch', offset: 99_999 }
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'goToMatch',
      offset: 100_000,
    }),
    undefined
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'findAdjacentMatch',
      query: '41 42',
      isHex: true,
      direction: 'forward',
      offset: 100_000,
    }),
    undefined
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'findAdjacentMatch',
      query: 'AB',
      isHex: false,
      direction: 'sideways',
      offset: 3,
    }),
    undefined
  )
  assert.deepEqual(
    normalizeWebviewMessage(context, {
      type: 'applyTransform',
      pluginId: 'omega.example.xor',
      offset: 1,
      length: 4,
      optionsJson: ' { "mask": 255 } ',
    }),
    {
      type: 'applyTransform',
      pluginId: 'omega.example.xor',
      offset: 1,
      length: 4,
      optionsJson: '{ "mask": 255 }',
    }
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'applyTransform',
      pluginId: 'omega.example.xor',
      offset: 1,
      length: 0,
    }),
    undefined
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'applyTransform',
      pluginId: 'omega.example.xor',
      offset: 99_999,
      length: 2,
    }),
    undefined
  )
  assert.equal(
    normalizeWebviewMessage(context, {
      type: 'applyTransform',
      pluginId: 'omega.example.xor',
      offset: 1,
      length: 4,
      optionsJson: '{',
    }),
    undefined
  )
})
