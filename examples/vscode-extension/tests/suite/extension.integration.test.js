const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vscode = require('vscode')
const { getComputedFileSize, getSegment } = require('@omega-edit/client')

const packageJson = require('../../package.json')
const { getHexEditorProviderForTesting } = require('../../out/extension.js')
const { HexEditorProvider } = require('../../out/hexEditorProvider.js')
const {
  OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
  OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
  OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
  OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
  OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND,
  OMEGA_EDIT_ROLLBACK_SESSION_COMMAND,
  OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
  OMEGA_EDIT_VIEW_TYPE,
} = require('../../out/constants.js')

const OBSERVE_MODE = process.env.OMEGA_EDIT_OBSERVE === '1'
const OBSERVE_STEP_DELAY_MS = parseDelay(
  process.env.OMEGA_EDIT_OBSERVE_DELAY_MS,
  2000
)
const OBSERVE_FINAL_DELAY_MS = parseDelay(
  process.env.OMEGA_EDIT_OBSERVE_FINAL_DELAY_MS,
  10000
)

suite('OmegaEdit VS Code extension', () => {
  let testPort
  let extensionApi

  suiteSetup(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')

    testPort = getConfiguredTestPort()

    const extensionId = `${packageJson.publisher}.${packageJson.name}`
    const extension = vscode.extensions.getExtension(extensionId)

    assert.ok(extension, `Expected extension ${extensionId} to be present`)
    extensionApi = await extension.activate()
    assert.equal(extension.isActive, true)
    assert.equal(extensionApi.version, 1)
    assert.equal(typeof extensionApi.open, 'function')
    assert.equal(typeof extensionApi.reveal, 'function')
    assert.equal(typeof extensionApi.getEditorState, 'function')
    assert.equal(typeof extensionApi.setExternalHighlights, 'function')
    assert.equal(typeof extensionApi.clearExternalHighlights, 'function')
    assert.equal(typeof extensionApi.onDidChangeEditorState, 'function')
  })

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('registers the go to offset command', async () => {
    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes(OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_GO_TO_OFFSET_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_EXPORT_CHANGE_SCRIPT_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_REPLAY_CHANGE_SCRIPT_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_ROLLBACK_SESSION_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_GET_EDITOR_STATE_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND))
  })

  test('exposes a typed extension API for generic debugger integration', async () => {
    const provider = getHexEditorProviderForTesting()
    assert.ok(
      provider,
      'Expected the activated extension to expose its provider'
    )
    assert.ok(extensionApi, 'Expected the extension to return its public API')

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-typed-api-')
    )
    const samplePath = path.join(tmpDir, 'typed-api.bin')
    await fs.writeFile(samplePath, Buffer.from('abcdef', 'utf8'))
    const uri = vscode.Uri.file(samplePath)
    const observedStates = []
    const disposable = extensionApi.onDidChangeEditorState((state) => {
      observedStates.push(state)
    })

    try {
      const openedState = await extensionApi.open(uri, { offset: 1 })
      const session = await waitForSession(provider, uri)
      assert.ok(session, 'Expected a live session for the typed API test')
      assert.equal(openedState.uri, uri.toString())
      assert.equal(openedState.fileSize, 6)

      await provider.dispatchWebviewMessageForTesting(uri, {
        type: 'editorStateChanged',
        visibleOffset: 0,
        visibleByteCount: 6,
        selectedOffset: 1,
        selectionStart: 1,
        selectionEnd: 3,
        selectionLength: 3,
        bytesPerRow: 16,
        offsetRadix: 'hex',
        activePane: 'hex',
        editMode: 'insert',
      })

      const selectedState = extensionApi.getEditorState({ uri })
      assert.equal(selectedState.selectedOffset, 1)
      assert.equal(selectedState.editMode, 'insert')
      assert.equal(selectedState.selectionStart, 1)
      assert.equal(selectedState.selectionEnd, 3)

      const highlightedState = await extensionApi.setExternalHighlights({
        uri,
        reveal: true,
        highlights: [
          {
            id: 'parser.node.header',
            offset: 1,
            length: 3,
            kind: 'parsed',
            label: 'Parsed header',
            source: 'Generic parser',
          },
        ],
      })
      assert.deepEqual(highlightedState.externalHighlights, [
        {
          id: 'parser.node.header',
          offset: 1,
          length: 3,
          kind: 'parsed',
          label: 'Parsed header',
          source: 'Generic parser',
        },
      ])

      const revealedState = await extensionApi.reveal(uri, 5)
      assert.equal(revealedState.uri, uri.toString())
      await assert.rejects(
        () => extensionApi.reveal(uri, 99),
        /outside the file range/
      )

      const clearedState = extensionApi.clearExternalHighlights({ uri })
      assert.deepEqual(clearedState.externalHighlights, [])
      assert.ok(
        observedStates.some(
          (state) =>
            state.uri === uri.toString() &&
            state.selectedOffset === 1 &&
            state.selectionStart === 1
        ),
        'Expected typed API listener to observe webview state changes'
      )
      assert.ok(
        observedStates.some(
          (state) =>
            state.uri === uri.toString() &&
            state.externalHighlights.some(
              (highlight) => highlight.id === 'parser.node.header'
            )
        ),
        'Expected typed API listener to observe external highlights'
      )
    } finally {
      disposable.dispose()
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('opens sample file through the explicit open-in-hex-editor command', async () => {
    const uri = vscode.Uri.file(
      path.resolve(__dirname, '..', 'workspace', 'sample.txt')
    )

    await vscode.commands.executeCommand(
      OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
      uri
    )

    const activeTab = await waitForTab(
      (tab) =>
        tab?.input instanceof vscode.TabInputCustom &&
        tab.input.viewType === OMEGA_EDIT_VIEW_TYPE &&
        tab.input.uri.fsPath === uri.fsPath
    )

    assert.ok(
      activeTab,
      'Expected the explicit OmegaEdit open command to open the custom editor'
    )
  })

  test('opens sample file in the custom editor', async () => {
    const uri = vscode.Uri.file(
      path.resolve(__dirname, '..', 'workspace', 'sample.txt')
    )

    await vscode.commands.executeCommand(
      'vscode.openWith',
      uri,
      OMEGA_EDIT_VIEW_TYPE
    )

    const activeTab = await waitForTab(
      (tab) =>
        tab?.input instanceof vscode.TabInputCustom &&
        tab.input.viewType === OMEGA_EDIT_VIEW_TYPE &&
        tab.input.uri.fsPath === uri.fsPath
    )

    assert.ok(activeTab, 'Expected the OmegaEdit custom editor tab to open')
  })

  test('exports and replays a JSON change script that reproduces the saved file', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-')
    )
    const sourcePath = path.join(tmpDir, 'source.bin')
    const replayPath = path.join(tmpDir, 'replay.bin')
    const scriptPath = path.join(tmpDir, 'changes.json')
    await fs.writeFile(sourcePath, Buffer.from('ABCDEFGH', 'utf8'))
    await fs.writeFile(replayPath, Buffer.from('ABCDEFGH', 'utf8'))

    const provider1 = new HexEditorProvider({ subscriptions: [] }, testPort)
    const panel1 = createMockWebviewPanel()
    const document1 = await provider1.openCustomDocument(
      vscode.Uri.file(sourcePath),
      { backupId: undefined, untitledDocumentData: undefined },
      new vscode.CancellationTokenSource().token
    )

    await provider1.resolveCustomEditor(
      document1,
      panel1,
      new vscode.CancellationTokenSource().token
    )

    const session1 = provider1.getSessionForTesting(document1.uri)
    assert.ok(
      session1,
      'Expected a live editor session after resolving the editor'
    )

    await provider1.dispatchWebviewMessageForTesting(document1.uri, {
      type: 'insert',
      offset: 1,
      data: Buffer.from('12', 'utf8').toString('hex'),
    })
    await assertSessionText(session1.sessionId, 'A12BCDEFGH')
    await provider1.dispatchWebviewMessageForTesting(document1.uri, {
      type: 'delete',
      offset: 3,
      length: 2,
    })
    await assertSessionText(session1.sessionId, 'A12DEFGH')
    await provider1.dispatchWebviewMessageForTesting(document1.uri, {
      type: 'overwrite',
      offset: 4,
      data: Buffer.from('xy', 'utf8').toString('hex'),
    })
    await assertSessionText(session1.sessionId, 'A12DxyGH')
    await provider1.dispatchWebviewMessageForTesting(document1.uri, {
      type: 'replace',
      offset: 6,
      length: 2,
      data: Buffer.from('ZZ', 'utf8').toString('hex'),
    })
    await assertSessionText(session1.sessionId, 'A12DxyZZ')
    await provider1.exportActiveChangeScript(vscode.Uri.file(scriptPath))
    await provider1.dispatchWebviewMessageForTesting(document1.uri, {
      type: 'save',
    })

    const script = JSON.parse(await fs.readFile(scriptPath, 'utf8'))
    assert.ok(Array.isArray(script), 'Expected export to produce a JSON array')
    assert.ok(
      script.length > 0,
      'Expected the exported change script to capture at least one change'
    )
    assert.ok(
      script.every((change) =>
        ['DELETE', 'INSERT', 'OVERWRITE', 'REPLACE'].includes(change.kind)
      ),
      'Expected exported change kinds to stay within the supported replay operations'
    )

    const provider2 = new HexEditorProvider({ subscriptions: [] }, testPort)
    const panel2 = createMockWebviewPanel()
    const document2 = await provider2.openCustomDocument(
      vscode.Uri.file(replayPath),
      { backupId: undefined, untitledDocumentData: undefined },
      new vscode.CancellationTokenSource().token
    )

    await provider2.resolveCustomEditor(
      document2,
      panel2,
      new vscode.CancellationTokenSource().token
    )

    await provider2.replayActiveChangeScript(vscode.Uri.file(scriptPath))

    const session2 = provider2.getSessionForTesting(document2.uri)
    assert.ok(
      session2,
      'Expected a replay session after resolving the second editor'
    )
    await provider2.dispatchWebviewMessageForTesting(document2.uri, {
      type: 'save',
    })

    const saved = await fs.readFile(sourcePath, 'utf8')
    const replayed = await fs.readFile(replayPath, 'utf8')
    assert.equal(saved, 'A12DxyZZ')
    assert.equal(replayed, saved)

    await panel1.fireDidDispose()
    await panel2.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('reports search matches and keeps undo/redo disabled state in sync', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-state-')
    )
    const samplePath = path.join(tmpDir, 'search.bin')
    await fs.writeFile(samplePath, Buffer.from('Alpha alpha ALPHA', 'utf8'))

    const provider = new HexEditorProvider({ subscriptions: [] }, testPort)
    const panel = createMockWebviewPanel()
    const document = await provider.openCustomDocument(
      vscode.Uri.file(samplePath),
      { backupId: undefined, untitledDocumentData: undefined },
      new vscode.CancellationTokenSource().token
    )

    await provider.resolveCustomEditor(
      document,
      panel,
      new vscode.CancellationTokenSource().token
    )

    const session = provider.getSessionForTesting(document.uri)
    assert.ok(session, 'Expected a live session for the search test')

    const initialState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(initialState, {
      type: 'editState',
      canUndo: false,
      canRedo: false,
      undoCount: 0,
      redoCount: 0,
      isDirty: false,
      savedChangeDepth: 0,
    })

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'search',
      query: 'alpha',
      isHex: false,
      caseInsensitive: true,
    })

    const searchResults = lastMessageOfType(panel.messages, 'searchResults')
    assert.ok(
      searchResults,
      'Expected search results to be posted back to the webview'
    )
    assert.deepEqual(searchResults.matches, [0, 6, 12])
    assert.equal(
      searchResults.patternLength,
      Buffer.from('alpha', 'utf8').length
    )

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'insert',
      offset: 0,
      data: Buffer.from('!', 'utf8').toString('hex'),
    })

    let editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
      isDirty: true,
      savedChangeDepth: 0,
    })

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'undo',
    })
    editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: false,
      canRedo: true,
      undoCount: 0,
      redoCount: 1,
      isDirty: false,
      savedChangeDepth: 0,
    })

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'redo',
    })
    editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
      isDirty: true,
      savedChangeDepth: 0,
    })

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('tracks transform edits through undo and redo', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-transform-undo-')
    )
    const samplePath = path.join(tmpDir, 'transform.bin')
    await fs.writeFile(samplePath, Buffer.from('abc', 'utf8'))

    const provider = new HexEditorProvider({ subscriptions: [] }, testPort)
    const panel = createMockWebviewPanel()
    const document = await provider.openCustomDocument(
      vscode.Uri.file(samplePath),
      { backupId: undefined, untitledDocumentData: undefined },
      new vscode.CancellationTokenSource().token
    )

    await provider.resolveCustomEditor(
      document,
      panel,
      new vscode.CancellationTokenSource().token
    )

    const session = provider.getSessionForTesting(document.uri)
    assert.ok(session, 'Expected a live session for the transform undo test')

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.base64_encode',
      offset: 0,
      length: 3,
    })

    await assertSessionText(session.sessionId, 'YWJj')
    let editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
      isDirty: true,
      savedChangeDepth: 0,
    })

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'undo',
    })
    await assertSessionText(session.sessionId, 'abc')
    editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: false,
      canRedo: true,
      undoCount: 0,
      redoCount: 1,
      isDirty: false,
      savedChangeDepth: 0,
    })

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'redo',
    })
    await assertSessionText(session.sessionId, 'YWJj')
    editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
      isDirty: true,
      savedChangeDepth: 0,
    })

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('clamps stale transform ranges before applying', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-transform-clamp-')
    )
    const samplePath = path.join(tmpDir, 'transform-clamp.bin')
    await fs.writeFile(samplePath, Buffer.from('abc', 'utf8'))

    const provider = new HexEditorProvider({ subscriptions: [] }, testPort)
    const panel = createMockWebviewPanel()
    const document = await provider.openCustomDocument(
      vscode.Uri.file(samplePath),
      { backupId: undefined, untitledDocumentData: undefined },
      new vscode.CancellationTokenSource().token
    )

    await provider.resolveCustomEditor(
      document,
      panel,
      new vscode.CancellationTokenSource().token
    )

    const session = provider.getSessionForTesting(document.uri)
    assert.ok(session, 'Expected a live session for the transform clamp test')

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.base64_encode',
      offset: 1,
      length: 999,
    })

    await assertSessionText(session.sessionId, 'aYmM=')
    assert.equal(
      lastMessageOfType(panel.messages, 'transformComplete')?.contentChanged,
      true
    )

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('does not record identity transform edits in undo history', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-transform-identity-')
    )
    const samplePath = path.join(tmpDir, 'transform-identity.bin')
    await fs.writeFile(samplePath, Buffer.from('abc', 'utf8'))

    const provider = new HexEditorProvider({ subscriptions: [] }, testPort)
    const panel = createMockWebviewPanel()
    const document = await provider.openCustomDocument(
      vscode.Uri.file(samplePath),
      { backupId: undefined, untitledDocumentData: undefined },
      new vscode.CancellationTokenSource().token
    )

    await provider.resolveCustomEditor(
      document,
      panel,
      new vscode.CancellationTokenSource().token
    )

    const session = provider.getSessionForTesting(document.uri)
    assert.ok(
      session,
      'Expected a live session for the identity transform test'
    )
    const cleanEditState = lastMessageOfType(panel.messages, 'editState')

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.and',
      offset: 0,
      length: 3,
      optionsJson: JSON.stringify({ byte: '0xFF' }),
    })

    await assertSessionText(session.sessionId, 'abc')
    let transformComplete = lastMessageOfType(
      panel.messages,
      'transformComplete'
    )
    assert.equal(transformComplete.contentChanged, false)
    assert.deepEqual(
      lastMessageOfType(panel.messages, 'editState'),
      cleanEditState
    )

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.base64_encode',
      offset: 0,
      length: 3,
    })

    await assertSessionText(session.sessionId, 'YWJj')
    const transformedEditState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(transformedEditState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
      isDirty: true,
      savedChangeDepth: 0,
    })

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.and',
      offset: 0,
      length: 4,
      optionsJson: JSON.stringify({ byte: '0xFF' }),
    })

    await assertSessionText(session.sessionId, 'YWJj')
    transformComplete = lastMessageOfType(panel.messages, 'transformComplete')
    assert.equal(transformComplete.contentChanged, false)
    assert.deepEqual(
      lastMessageOfType(panel.messages, 'editState'),
      transformedEditState
    )

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'undo',
    })
    await assertSessionText(session.sessionId, 'abc')

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'redo',
    })
    await assertSessionText(session.sessionId, 'YWJj')

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('routes VS Code undo and redo commands for transform edits', async () => {
    const provider = getHexEditorProviderForTesting()
    assert.ok(
      provider,
      'Expected the activated extension to expose its provider'
    )

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-command-undo-')
    )
    const samplePath = path.join(tmpDir, 'transform-command.bin')
    await fs.writeFile(samplePath, Buffer.from('abc', 'utf8'))
    const uri = vscode.Uri.file(samplePath)

    await vscode.commands.executeCommand(
      'vscode.openWith',
      uri,
      OMEGA_EDIT_VIEW_TYPE
    )
    const session = await waitForSession(provider, uri)
    assert.ok(session, 'Expected a live session for the command undo test')

    await provider.dispatchWebviewMessageForTesting(uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.base64_encode',
      offset: 0,
      length: 3,
    })

    await assertSessionText(session.sessionId, 'YWJj')

    await vscode.commands.executeCommand('undo')
    await assertSessionText(session.sessionId, 'abc')

    await vscode.commands.executeCommand('redo')
    await assertSessionText(session.sessionId, 'YWJj')

    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('exposes compact editor state and generic external highlights', async () => {
    const provider = getHexEditorProviderForTesting()
    assert.ok(
      provider,
      'Expected the activated extension to expose its provider'
    )

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-external-state-')
    )
    const samplePath = path.join(tmpDir, 'external-state.bin')
    await fs.writeFile(samplePath, Buffer.from('abcdef', 'utf8'))
    const uri = vscode.Uri.file(samplePath)

    try {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        uri,
        OMEGA_EDIT_VIEW_TYPE
      )
      const session = await waitForSession(provider, uri)
      assert.ok(session, 'Expected a live session for the editor state test')

      await provider.dispatchWebviewMessageForTesting(uri, {
        type: 'editorStateChanged',
        visibleOffset: 0,
        visibleByteCount: 6,
        selectedOffset: 2,
        selectionStart: 2,
        selectionEnd: 4,
        selectionLength: 3,
        bytesPerRow: 16,
        offsetRadix: 'dec',
        activePane: 'ascii',
        editMode: 'insert',
      })

      const state = await vscode.commands.executeCommand(
        OMEGA_EDIT_GET_EDITOR_STATE_COMMAND
      )
      assert.equal(state.uri, uri.toString())
      assert.equal(state.fileSize, 6)
      assert.equal(state.visibleOffset, 0)
      assert.equal(state.visibleByteCount, 6)
      assert.equal(state.selectedOffset, 2)
      assert.equal(state.selectionStart, 2)
      assert.equal(state.selectionEnd, 4)
      assert.equal(state.selectionLength, 3)
      assert.equal(state.offsetRadix, 'dec')
      assert.equal(state.activePane, 'ascii')
      assert.equal(state.editMode, 'insert')
      assert.deepEqual(state.externalHighlights, [])

      const highlightedState = await vscode.commands.executeCommand(
        OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
        {
          uri: uri.toString(),
          reveal: true,
          highlights: [
            {
              id: 'dfdl.current',
              offset: 1,
              length: 2,
              kind: 'current',
              label: 'Current parse point',
              source: 'DFDL',
            },
            {
              id: 'dfdl.error',
              offset: 4,
              length: 1,
              kind: 'error',
              label: 'Parse error',
            },
          ],
        }
      )
      assert.deepEqual(highlightedState.externalHighlights, [
        {
          id: 'dfdl.current',
          offset: 1,
          length: 2,
          kind: 'current',
          label: 'Current parse point',
          source: 'DFDL',
        },
        {
          id: 'dfdl.error',
          offset: 4,
          length: 1,
          kind: 'error',
          label: 'Parse error',
          source: undefined,
        },
      ])
      const stateAfterHighlight = await vscode.commands.executeCommand(
        OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
        { uri: uri.toString() }
      )
      assert.deepEqual(
        stateAfterHighlight.externalHighlights,
        highlightedState.externalHighlights
      )

      const clearedState = await vscode.commands.executeCommand(
        OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
        { uri: uri.toString() }
      )
      assert.deepEqual(clearedState.externalHighlights, [])
      const stateAfterClear = await vscode.commands.executeCommand(
        OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
        { uri: uri.toString() }
      )
      assert.deepEqual(stateAfterClear.externalHighlights, [])
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('routes native revert through VS Code and OmegaEdit revert through session rollback', async () => {
    const provider = getHexEditorProviderForTesting()
    assert.ok(
      provider,
      'Expected the activated extension to expose its provider'
    )

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-command-revert-')
    )
    const samplePath = path.join(tmpDir, 'revert-command.bin')
    await fs.writeFile(samplePath, Buffer.from('abc', 'utf8'))
    const uri = vscode.Uri.file(samplePath)

    try {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        uri,
        OMEGA_EDIT_VIEW_TYPE
      )
      const session = await waitForSession(provider, uri)
      assert.ok(session, 'Expected a live session for the command revert test')

      await provider.dispatchWebviewMessageForTesting(uri, {
        type: 'insert',
        offset: 0,
        data: Buffer.from('!', 'utf8').toString('hex'),
      })
      await provider.dispatchWebviewMessageForTesting(uri, {
        type: 'insert',
        offset: 4,
        data: Buffer.from('?', 'utf8').toString('hex'),
      })
      await assertSessionText(session.sessionId, '!abc?')
      assert.deepEqual(session.history.getEditState(), {
        canUndo: true,
        canRedo: false,
        undoCount: 2,
        redoCount: 0,
        isDirty: true,
        savedChangeDepth: 0,
      })

      await vscode.commands.executeCommand('workbench.action.files.revert')
      await assertSessionText(session.sessionId, 'abc')
      assert.deepEqual(session.history.getEditState(), {
        canUndo: false,
        canRedo: false,
        undoCount: 0,
        redoCount: 0,
        isDirty: false,
        savedChangeDepth: 0,
      })

      await provider.dispatchWebviewMessageForTesting(uri, {
        type: 'insert',
        offset: 3,
        data: Buffer.from('!', 'utf8').toString('hex'),
      })
      await assertSessionText(session.sessionId, 'abc!')
      assert.deepEqual(session.history.getEditState(), {
        canUndo: true,
        canRedo: false,
        undoCount: 1,
        redoCount: 0,
        isDirty: true,
        savedChangeDepth: 0,
      })

      await vscode.commands.executeCommand('workbench.action.files.save')
      assert.equal(await fs.readFile(samplePath, 'utf8'), 'abc!')
      assert.deepEqual(session.history.getEditState(), {
        canUndo: true,
        canRedo: false,
        undoCount: 1,
        redoCount: 0,
        isDirty: false,
        savedChangeDepth: 1,
      })

      await vscode.commands.executeCommand(OMEGA_EDIT_ROLLBACK_SESSION_COMMAND)
      await assertSessionText(session.sessionId, 'abc')
      assert.equal(await fs.readFile(samplePath, 'utf8'), 'abc!')
      assert.equal(session.restoredFromBackup, true)
      assert.deepEqual(session.history.getEditState(), {
        canUndo: false,
        canRedo: false,
        undoCount: 0,
        redoCount: 0,
        isDirty: false,
        savedChangeDepth: 0,
      })

      await vscode.commands.executeCommand('workbench.action.files.save')
      assert.equal(await fs.readFile(samplePath, 'utf8'), 'abc')
      assert.equal(session.restoredFromBackup, false)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('tracks optimized replace counts and clears dirty state on save', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-replace-')
    )
    const samplePath = path.join(tmpDir, 'replace.bin')
    await fs.writeFile(samplePath, Buffer.from('foo foo foo foo', 'utf8'))

    const provider = new HexEditorProvider({ subscriptions: [] }, testPort)
    const panel = createMockWebviewPanel()
    const document = await provider.openCustomDocument(
      vscode.Uri.file(samplePath),
      { backupId: undefined, untitledDocumentData: undefined },
      new vscode.CancellationTokenSource().token
    )

    await provider.resolveCustomEditor(
      document,
      panel,
      new vscode.CancellationTokenSource().token
    )

    const session = provider.getSessionForTesting(document.uri)
    assert.ok(session, 'Expected a live session for the replace test')

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'replaceAllMatches',
      offsets: [0, 4, 8, 12],
      query: 'foo',
      isHex: false,
      length: 3,
      data: Buffer.from('qux', 'utf8').toString('hex'),
    })

    const replaceComplete = lastMessageOfType(panel.messages, 'replaceComplete')
    assert.deepEqual(replaceComplete, {
      type: 'replaceComplete',
      scope: 'all',
      selectionOffset: 0,
      replacedCount: 4,
    })

    let editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
      isDirty: true,
      savedChangeDepth: 0,
    })
    assert.equal(session.history.getChangeLog().length, 4)

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'save',
    })
    editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
      isDirty: false,
      savedChangeDepth: 1,
    })

    const saved = await fs.readFile(samplePath, 'utf8')
    assert.equal(saved, 'qux qux qux qux')

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('tracks save-state semantics after checkpointed replace-all followed by more edits', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-checkpoint-save-')
    )
    const samplePath = path.join(tmpDir, 'checkpoint-save.bin')
    const matchCount = 1205
    const original = Array.from({ length: matchCount }, () => 'PD').join('|')
    const replaced = Array.from({ length: matchCount }, () => 'PDF').join('|')
    await fs.writeFile(samplePath, Buffer.from(original, 'utf8'))

    const provider = new HexEditorProvider({ subscriptions: [] }, testPort)
    const panel = createMockWebviewPanel()
    const document = await provider.openCustomDocument(
      vscode.Uri.file(samplePath),
      { backupId: undefined, untitledDocumentData: undefined },
      new vscode.CancellationTokenSource().token
    )

    await provider.resolveCustomEditor(
      document,
      panel,
      new vscode.CancellationTokenSource().token
    )

    const session = provider.getSessionForTesting(document.uri)
    assert.ok(
      session,
      'Expected a live session for the checkpoint save-state test'
    )

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'replaceAllMatches',
      query: 'PD',
      isHex: false,
      length: 2,
      data: Buffer.from('PDF', 'utf8').toString('hex'),
    })
    await assertSessionText(session.sessionId, replaced)

    let editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
      isDirty: true,
      savedChangeDepth: 0,
    })

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'insert',
      offset: 0,
      data: Buffer.from('!', 'utf8').toString('hex'),
    })
    await assertSessionText(session.sessionId, `!${replaced}`)

    editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 2,
      redoCount: 0,
      isDirty: true,
      savedChangeDepth: 0,
    })

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'save',
    })

    editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 2,
      redoCount: 0,
      isDirty: false,
      savedChangeDepth: 2,
    })
    assert.equal(await fs.readFile(samplePath, 'utf8'), `!${replaced}`)

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'undo',
    })
    await assertSessionText(session.sessionId, replaced)

    editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: true,
      undoCount: 1,
      redoCount: 1,
      isDirty: true,
      savedChangeDepth: 2,
    })

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'redo',
    })
    await assertSessionText(session.sessionId, `!${replaced}`)

    editState = lastMessageOfType(panel.messages, 'editState')
    assert.deepEqual(editState, {
      type: 'editState',
      canUndo: true,
      canRedo: false,
      undoCount: 2,
      redoCount: 0,
      isDirty: false,
      savedChangeDepth: 2,
    })

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('shows a live custom-editor demo when observation mode is enabled', async function () {
    if (!OBSERVE_MODE) {
      this.skip()
      return
    }

    this.timeout(180000)

    const provider = getHexEditorProviderForTesting()
    assert.ok(
      provider,
      'Expected the activated extension to expose its provider'
    )

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-observe-')
    )
    const sourcePath = path.join(tmpDir, 'observe-source.bin')
    const replayPath = path.join(tmpDir, 'observe-replay.bin')
    const scriptPath = path.join(tmpDir, 'observe-script.json')
    await fs.writeFile(sourcePath, Buffer.from('ABCDEFGH', 'utf8'))
    await fs.writeFile(replayPath, Buffer.from('ABCDEFGH', 'utf8'))

    const sourceUri = vscode.Uri.file(sourcePath)
    const replayUri = vscode.Uri.file(replayPath)

    await vscode.commands.executeCommand(
      'vscode.openWith',
      sourceUri,
      OMEGA_EDIT_VIEW_TYPE
    )
    const sourceSession = await waitForSession(provider, sourceUri)
    assert.ok(
      sourceSession,
      'Expected the observation source session to be ready'
    )
    await delay(OBSERVE_STEP_DELAY_MS)

    await provider.dispatchWebviewMessageForTesting(sourceUri, {
      type: 'insert',
      offset: 1,
      data: Buffer.from('12', 'utf8').toString('hex'),
    })
    await delay(OBSERVE_STEP_DELAY_MS)

    await provider.dispatchWebviewMessageForTesting(sourceUri, {
      type: 'delete',
      offset: 3,
      length: 2,
    })
    await delay(OBSERVE_STEP_DELAY_MS)

    await provider.dispatchWebviewMessageForTesting(sourceUri, {
      type: 'overwrite',
      offset: 4,
      data: Buffer.from('xy', 'utf8').toString('hex'),
    })
    await delay(OBSERVE_STEP_DELAY_MS)

    await provider.dispatchWebviewMessageForTesting(sourceUri, {
      type: 'replace',
      offset: 6,
      length: 2,
      data: Buffer.from('ZZ', 'utf8').toString('hex'),
    })
    await delay(OBSERVE_STEP_DELAY_MS)

    await provider.exportActiveChangeScript(vscode.Uri.file(scriptPath))
    await delay(OBSERVE_STEP_DELAY_MS)

    await provider.dispatchWebviewMessageForTesting(sourceUri, { type: 'save' })
    await delay(OBSERVE_STEP_DELAY_MS)

    await vscode.commands.executeCommand(
      'vscode.openWith',
      replayUri,
      OMEGA_EDIT_VIEW_TYPE
    )
    const replaySession = await waitForSession(provider, replayUri)
    assert.ok(
      replaySession,
      'Expected the observation replay session to be ready'
    )
    await delay(OBSERVE_STEP_DELAY_MS)

    await provider.replayActiveChangeScript(vscode.Uri.file(scriptPath))
    await delay(OBSERVE_STEP_DELAY_MS)

    await provider.dispatchWebviewMessageForTesting(replayUri, { type: 'save' })

    const saved = await fs.readFile(sourcePath, 'utf8')
    const replayed = await fs.readFile(replayPath, 'utf8')
    assert.equal(saved, 'A12DxyZZ')
    assert.equal(replayed, saved)

    await delay(OBSERVE_FINAL_DELAY_MS)
    await fs.rm(tmpDir, { recursive: true, force: true })
  })
})

async function waitForTab(predicate, timeoutMs = 30000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab
    if (predicate(activeTab)) {
      return activeTab
    }

    await delay(intervalMs)
  }

  return undefined
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForSession(
  provider,
  uri,
  timeoutMs = 30000,
  intervalMs = 200
) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const session = provider.getSessionForTesting(uri)
    if (session) {
      return session
    }

    await delay(intervalMs)
  }

  return undefined
}

async function assertSessionText(
  sessionId,
  expected,
  timeoutMs = 3000,
  intervalMs = 50
) {
  const deadline = Date.now() + timeoutMs
  const expectedBuffer = Buffer.from(expected, 'utf8')
  let lastValue = ''

  while (Date.now() < deadline) {
    const size = await getComputedFileSize(sessionId)
    const segment = await getSegment(sessionId, 0, size)
    lastValue = Buffer.from(segment).toString('utf8')
    if (lastValue === expected) {
      return
    }

    await delay(intervalMs)
  }

  assert.equal(lastValue, expectedBuffer.toString('utf8'))
}

function parseDelay(rawValue, fallbackMs) {
  const parsed = Number.parseInt(rawValue ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackMs
}

function getConfiguredTestPort() {
  const parsed = Number.parseInt(process.env.OMEGA_EDIT_SERVER_PORT ?? '', 10)
  assert.ok(
    Number.isInteger(parsed) && parsed > 0 && parsed <= 65535,
    'Expected OMEGA_EDIT_SERVER_PORT to be set to a valid TCP port'
  )
  return parsed
}

function createMockWebviewPanel() {
  const receiveMessageListeners = []
  const viewStateListeners = []
  const disposeListeners = []

  const webview = {
    html: '',
    options: undefined,
    messages: [],
    onDidReceiveMessage(listener) {
      receiveMessageListeners.push(listener)
      return new vscode.Disposable(() => {
        const index = receiveMessageListeners.indexOf(listener)
        if (index >= 0) {
          receiveMessageListeners.splice(index, 1)
        }
      })
    },
    postMessage(message) {
      webview.messages.push(message)
      return Promise.resolve(true)
    },
  }

  return {
    active: true,
    webview,
    messages: webview.messages,
    onDidChangeViewState(listener) {
      viewStateListeners.push(listener)
      return new vscode.Disposable(() => {
        const index = viewStateListeners.indexOf(listener)
        if (index >= 0) {
          viewStateListeners.splice(index, 1)
        }
      })
    },
    onDidDispose(listener) {
      disposeListeners.push(listener)
      return new vscode.Disposable(() => {
        const index = disposeListeners.indexOf(listener)
        if (index >= 0) {
          disposeListeners.splice(index, 1)
        }
      })
    },
    async fireDidDispose() {
      for (const listener of disposeListeners) {
        await listener()
      }
    },
  }
}

function lastMessageOfType(messages, type) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === type) {
      return messages[i]
    }
  }

  return undefined
}
