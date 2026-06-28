const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vscode = require('vscode')
const { getComputedFileSize, getSegment } = require('@omega-edit/client')

const packageJson = require('../../package.json')
const {
  OMEGA_EDIT_EXTENSION_API_VERSION,
  OMEGA_EDIT_EXTENSION_ID,
} = require('../../out/api.js')
const { getHexEditorProviderForTesting } = require('../../out/extension.js')
const { HexEditorProvider } = require('../../out/hexEditorProvider.js')
const {
  OMEGA_EDIT_APPLY_CHANGE_LOG_COMMAND,
  OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
  OMEGA_EDIT_EXPORT_CHANGE_LOG_COMMAND,
  OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
  OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
  OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
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
const ABC_SHA256_FINGERPRINT = {
  byteLength: 3,
  digest: {
    algorithm: 'sha256',
    value: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
}

suite('OmegaEdit VS Code extension', () => {
  let testPort
  let extensionApi

  suiteSetup(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')

    testPort = getConfiguredTestPort()

    assert.equal(
      `${packageJson.publisher}.${packageJson.name}`,
      OMEGA_EDIT_EXTENSION_ID
    )
    const extension = vscode.extensions.getExtension(OMEGA_EDIT_EXTENSION_ID)

    assert.ok(
      extension,
      `Expected extension ${OMEGA_EDIT_EXTENSION_ID} to be present`
    )
    extensionApi = await extension.activate()
    assert.equal(extension.isActive, true)
    assert.equal(extensionApi.extensionId, OMEGA_EDIT_EXTENSION_ID)
    assert.equal(extensionApi.version, OMEGA_EDIT_EXTENSION_API_VERSION)
    assert.equal(typeof extensionApi.open, 'function')
    assert.equal(typeof extensionApi.reveal, 'function')
    assert.equal(typeof extensionApi.getEditorState, 'function')
    assert.equal(typeof extensionApi.setExternalHighlights, 'function')
    assert.equal(typeof extensionApi.clearExternalHighlights, 'function')
    assert.equal(typeof extensionApi.createCheckpoint, 'function')
    assert.equal(typeof extensionApi.rollbackCheckpoint, 'function')
    assert.equal(typeof extensionApi.restoreCheckpoint, 'function')
    assert.equal(typeof extensionApi.exportChangeLog, 'function')
    assert.equal(typeof extensionApi.applyChangeLog, 'function')
    assert.equal(typeof extensionApi.onDidChangeEditorState, 'function')
  })

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('registers the go to offset command', async () => {
    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes(OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_GO_TO_OFFSET_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_EXPORT_CHANGE_LOG_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_APPLY_CHANGE_LOG_COMMAND))
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
        () => extensionApi.open(uri, { offset: Number.NaN }),
        /OmegaEdit requires a non-negative integer offset/
      )
      await assert.rejects(
        () => extensionApi.open(uri, { offset: -1 }),
        /OmegaEdit requires a non-negative integer offset/
      )
      await assert.rejects(
        () => extensionApi.open(uri, { offset: 1.5 }),
        /OmegaEdit requires a non-negative integer offset/
      )
      await assert.rejects(
        () => extensionApi.reveal(uri),
        /OmegaEdit requires a non-negative integer offset/
      )
      await assert.rejects(
        () => extensionApi.reveal('not-a-file-uri', 1),
        /can only open local files/
      )
      await assert.rejects(
        () =>
          extensionApi.reveal({
            uri: vscode.Uri.parse('untitled:typed-api.bin'),
            offset: 1,
          }),
        /can only open local files/
      )
      await assert.rejects(
        () =>
          extensionApi.reveal({
            uri: { scheme: 'file', path: samplePath },
            offset: 1,
          }),
        /can only open local files/
      )
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

  test('exports and applies a JSON change log that reproduces the saved file', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-')
    )
    const sourcePath = path.join(tmpDir, 'source.bin')
    const replayPath = path.join(tmpDir, 'replay.bin')
    const tamperedReplayPath = path.join(tmpDir, 'replay-tampered.bin')
    const scriptPath = path.join(tmpDir, 'changes.json')
    const tamperedScriptPath = path.join(tmpDir, 'changes-tampered.json')
    await fs.writeFile(sourcePath, Buffer.from('ABCDEFGH', 'utf8'))
    await fs.writeFile(replayPath, Buffer.from('ABCDEFGH', 'utf8'))
    await fs.writeFile(tamperedReplayPath, Buffer.from('ABCDEFGH', 'utf8'))

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
    await provider1.dispatchWebviewMessageForTesting(document1.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.base64',
      offset: 0,
      length: 8,
    })
    await assertSessionText(session1.sessionId, 'QTEyRHh5Wlo=')
    await provider1.exportChangeLog({
      uri: document1.uri,
      targetUri: vscode.Uri.file(scriptPath),
    })
    await provider1.dispatchWebviewMessageForTesting(document1.uri, {
      type: 'save',
    })

    const script = JSON.parse(await fs.readFile(scriptPath, 'utf8'))
    assert.equal(script.format, 'omega-edit.change-log')
    assert.equal(script.version, 2)
    assert.equal(script.complete, true)
    assert.equal(script.before.byteLength, '8')
    assert.equal(script.before.digest.algorithm, 'sha256')
    assert.match(script.before.digest.value, /^[0-9a-f]+$/)
    assert.equal(script.after.byteLength, '12')
    assert.equal(script.after.digest.algorithm, 'sha256')
    assert.match(script.after.digest.value, /^[0-9a-f]+$/)
    assert.notEqual(script.before.digest.value, script.after.digest.value)
    assert.equal(script.sourceChangeCount, script.changeCount)
    assert.equal(script.unavailableChangeCount, '0')
    assert.deepEqual(script.unavailableChangeSerials, [])
    assert.ok(
      Array.isArray(script.changes),
      'Expected export to produce a change-log document'
    )
    assert.ok(
      script.changes.length > 0,
      'Expected the exported change log to capture at least one change'
    )
    assert.ok(
      script.changes.every((change) =>
        ['DELETE', 'INSERT', 'OVERWRITE', 'TRANSFORM'].includes(change.kind)
      ),
      'Expected exported change kinds to stay within OmegaEdit operations'
    )
    const transformChange = script.changes.find(
      (change) => change.kind === 'TRANSFORM'
    )
    assert.ok(transformChange, 'Expected the base64 transform to be exported')
    assert.equal(transformChange.transformId, 'omega.example.base64')
    assert.equal(transformChange.offset, '0')
    assert.equal(transformChange.length, '8')
    assert.equal(transformChange.data, '')
    assert.equal(transformChange.replacementLength, '12')
    assert.equal(transformChange.computedFileSizeBefore, '8')
    assert.equal(transformChange.computedFileSizeAfter, '12')
    assert.equal(Object.hasOwn(transformChange, 'optionsJson'), false)

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

    await provider2.applyChangeLog({
      uri: document2.uri,
      sourceUri: vscode.Uri.file(scriptPath),
    })

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
    assert.equal(saved, 'QTEyRHh5Wlo=')
    assert.equal(replayed, saved)

    const tamperedScript = structuredClone(script)
    const tamperedTransformChange = tamperedScript.changes.find(
      (change) => change.kind === 'TRANSFORM'
    )
    assert.ok(
      tamperedTransformChange,
      'Expected a transform change to tamper with'
    )
    tamperedTransformChange.replacementLength = '999'
    await fs.writeFile(
      tamperedScriptPath,
      JSON.stringify(tamperedScript, null, 2)
    )

    const provider3 = new HexEditorProvider({ subscriptions: [] }, testPort)
    const panel3 = createMockWebviewPanel()
    const document3 = await provider3.openCustomDocument(
      vscode.Uri.file(tamperedReplayPath),
      { backupId: undefined, untitledDocumentData: undefined },
      new vscode.CancellationTokenSource().token
    )

    await provider3.resolveCustomEditor(
      document3,
      panel3,
      new vscode.CancellationTokenSource().token
    )

    await assert.rejects(
      () =>
        provider3.applyChangeLog({
          uri: document3.uri,
          sourceUri: vscode.Uri.file(tamperedScriptPath),
        }),
      /replacement length mismatch/
    )
    const session3 = provider3.getSessionForTesting(document3.uri)
    assert.ok(session3, 'Expected a tampered replay session')
    await assertSessionText(session3.sessionId, 'ABCDEFGH')
    assert.equal(session3.history.getChangeLog().length, 0)

    await panel1.fireDidDispose()
    await panel2.fireDidDispose()
    await panel3.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('rejects change logs with inconsistent metadata before applying', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-invalid-change-log-')
    )
    const samplePath = path.join(tmpDir, 'sample.bin')
    const scriptPath = path.join(tmpDir, 'invalid-changes.json')
    await fs.writeFile(samplePath, Buffer.from('abc', 'utf8'))
    await fs.writeFile(
      scriptPath,
      JSON.stringify({
        format: 'omega-edit.change-log',
        version: 2,
        complete: true,
        before: ABC_SHA256_FINGERPRINT,
        after: ABC_SHA256_FINGERPRINT,
        changeCount: 2,
        sourceChangeCount: 2,
        unavailableChangeCount: 0,
        unavailableChangeSerials: [],
        changes: [
          {
            serial: 1,
            kind: 'INSERT',
            offset: 0,
            length: 0,
            data: Buffer.from('A', 'utf8').toString('hex'),
            groupId: 'batch-a',
          },
          {
            serial: 3,
            kind: 'INSERT',
            offset: 1,
            length: 0,
            data: Buffer.from('B', 'utf8').toString('hex'),
            groupId: 'batch-a',
          },
        ],
      })
    )

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
    assert.ok(session, 'Expected a live session for invalid change-log test')

    const result = await provider.applyChangeLog({
      uri: document.uri,
      sourceUri: vscode.Uri.file(scriptPath),
    })

    assert.equal(result?.cancelled, true)
    assert.equal(result?.changeCount, 0)
    await assertSessionText(session.sessionId, 'abc')

    await fs.writeFile(
      scriptPath,
      JSON.stringify({
        format: 'omega-edit.change-log',
        version: 2,
        complete: false,
        before: ABC_SHA256_FINGERPRINT,
        after: ABC_SHA256_FINGERPRINT,
        changeCount: 0,
        sourceChangeCount: 1,
        unavailableChangeCount: 1,
        unavailableChangeSerials: [1],
        changes: [],
      })
    )

    const incompleteResult = await provider.applyChangeLog({
      uri: document.uri,
      sourceUri: vscode.Uri.file(scriptPath),
    })

    assert.equal(incompleteResult?.cancelled, true)
    assert.equal(incompleteResult?.changeCount, 0)
    await assertSessionText(session.sessionId, 'abc')

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('restores the latest checkpoint without dropping it', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-restore-checkpoint-')
    )
    const samplePath = path.join(tmpDir, 'sample.bin')
    await fs.writeFile(samplePath, Buffer.from('abcdef', 'utf8'))

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
    assert.ok(session, 'Expected a session for checkpoint restore')

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'overwrite',
      offset: 1,
      data: Buffer.from('Z', 'utf8').toString('hex'),
    })
    await assertSessionText(session.sessionId, 'aZcdef')

    const checkpoint = await provider.createCheckpoint({ uri: document.uri })
    assert.ok(checkpoint)
    assert.equal(checkpoint.checkpointCount, 1)

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'insert',
      offset: 6,
      data: Buffer.from('!', 'utf8').toString('hex'),
    })
    await assertSessionText(session.sessionId, 'aZcdef!')

    const restored = await provider.restoreCheckpoint({ uri: document.uri })
    assert.ok(restored)
    assert.equal(restored.restored, true)
    assert.equal(restored.checkpointCount, 1)
    assert.equal(restored.discardedChangeCount, 1)
    await assertSessionText(session.sessionId, 'aZcdef')

    await panel.fireDidDispose()
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
      pluginId: 'omega.example.base64',
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

  test('rejects invalid transform ranges and applies valid ranges', async () => {
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
      pluginId: 'omega.example.base64',
      offset: 1,
      length: 999,
    })
    await assertSessionText(session.sessionId, 'abc')
    assert.equal(
      lastMessageOfType(panel.messages, 'transformComplete'),
      undefined
    )

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.base64',
      offset: 1,
      length: 2,
    })

    await assertSessionText(session.sessionId, 'aYmM=')
    assert.equal(
      lastMessageOfType(panel.messages, 'transformComplete')?.contentChanged,
      true
    )

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('reports calculation actions without content changes', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-transform-calculation-')
    )
    const samplePath = path.join(tmpDir, 'transform-calculation.bin')
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
      'Expected a live session for the calculation action test'
    )
    const cleanEditState = lastMessageOfType(panel.messages, 'editState')

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.common_checksums',
      offset: 0,
      length: 3,
      optionsJson: JSON.stringify({ algorithm: 'sum8' }),
    })

    await assertSessionText(session.sessionId, 'abc')
    const transformComplete = lastMessageOfType(
      panel.messages,
      'transformComplete'
    )
    assert.ok(transformComplete, 'Expected calculation action completion')
    assert.equal(transformComplete.contentSource, 'computed')
    assert.equal(transformComplete.contentChanged, false)
    assert.equal(transformComplete.resultLabel, 'sum8')
    assert.equal(transformComplete.resultText, '0x26')
    assert.deepEqual(
      lastMessageOfType(panel.messages, 'editState'),
      cleanEditState
    )

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('reports calculation content source for original snapshots', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-transform-original-')
    )
    const samplePath = path.join(tmpDir, 'transform-original.bin')
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
      'Expected a live session for the original calculation test'
    )

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'overwrite',
      offset: 0,
      data: Buffer.from('z', 'utf8').toString('hex'),
    })
    await assertSessionText(session.sessionId, 'zbc')

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.common_checksums',
      contentSource: 'original',
      offset: 0,
      length: 3,
      optionsJson: JSON.stringify({ algorithm: 'sum8' }),
    })

    await assertSessionText(session.sessionId, 'zbc')
    const transformComplete = lastMessageOfType(
      panel.messages,
      'transformComplete'
    )
    assert.ok(transformComplete, 'Expected original calculation completion')
    assert.equal(transformComplete.contentSource, 'original')
    assert.equal(transformComplete.contentChanged, false)
    assert.equal(transformComplete.resultLabel, 'sum8')
    assert.equal(transformComplete.resultText, '0x26')

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('does not record no-op transforms in undo history', async () => {
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
      pluginId: 'omega.example.bitwise',
      offset: 0,
      length: 3,
      optionsJson: JSON.stringify({ operator: 'xor', byte: '0x00' }),
    })

    await assertSessionText(session.sessionId, 'abc')
    const xorTransformComplete = lastMessageOfType(
      panel.messages,
      'transformComplete'
    )
    assert.ok(xorTransformComplete, 'Expected XOR identity completion')
    assert.equal(xorTransformComplete.contentChanged, false)
    assert.deepEqual(
      lastMessageOfType(panel.messages, 'editState'),
      cleanEditState
    )

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.bitwise',
      offset: 0,
      length: 3,
      optionsJson: JSON.stringify({ operator: 'and', byte: '0xFF' }),
    })

    await assertSessionText(session.sessionId, 'abc')
    const andTransformComplete = lastMessageOfType(
      panel.messages,
      'transformComplete'
    )
    assert.ok(andTransformComplete, 'Expected AND identity completion')
    assert.equal(andTransformComplete.contentChanged, false)
    assert.deepEqual(
      lastMessageOfType(panel.messages, 'editState'),
      cleanEditState
    )

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.bitwise',
      offset: 0,
      length: 3,
      optionsJson: JSON.stringify({ operator: 'or', byte: '0x00' }),
    })

    await assertSessionText(session.sessionId, 'abc')
    const orTransformComplete = lastMessageOfType(
      panel.messages,
      'transformComplete'
    )
    assert.ok(orTransformComplete, 'Expected OR identity completion')
    assert.equal(orTransformComplete.contentChanged, false)
    assert.deepEqual(
      lastMessageOfType(panel.messages, 'editState'),
      cleanEditState
    )

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.case_change',
      offset: 0,
      length: 3,
      optionsJson: JSON.stringify({ case: 'upper' }),
    })

    await assertSessionText(session.sessionId, 'ABC')
    const upperTransformComplete = lastMessageOfType(
      panel.messages,
      'transformComplete'
    )
    assert.ok(upperTransformComplete, 'Expected uppercase completion')
    assert.equal(upperTransformComplete.contentChanged, true)
    const uppercaseEditState = lastMessageOfType(panel.messages, 'editState')
    assert.notDeepEqual(uppercaseEditState, cleanEditState)

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.case_change',
      offset: 0,
      length: 3,
      optionsJson: JSON.stringify({ case: 'upper' }),
    })

    await assertSessionText(session.sessionId, 'ABC')
    const upperNoopTransformComplete = lastMessageOfType(
      panel.messages,
      'transformComplete'
    )
    assert.ok(upperNoopTransformComplete, 'Expected uppercase no-op completion')
    assert.equal(upperNoopTransformComplete.contentChanged, false)
    assert.deepEqual(
      lastMessageOfType(panel.messages, 'editState'),
      uppercaseEditState
    )

    await panel.fireDidDispose()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('does not record large no-op transforms in undo history', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-transform-large-identity-')
    )
    const samplePath = path.join(tmpDir, 'transform-large-identity.bin')
    const largeLength = 1024 * 1024 + 1
    await fs.writeFile(samplePath, Buffer.alloc(largeLength, 'A'))

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
      'Expected a live session for the large identity transform test'
    )
    const cleanEditState = lastMessageOfType(panel.messages, 'editState')

    await provider.dispatchWebviewMessageForTesting(document.uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.case_change',
      offset: 0,
      length: largeLength,
      optionsJson: JSON.stringify({ case: 'upper' }),
    })

    assert.equal(await getComputedFileSize(session.sessionId), largeLength)
    assert.deepEqual(
      Buffer.from(await getSegment(session.sessionId, largeLength - 4, 4)),
      Buffer.from('AAAA')
    )
    const transformComplete = lastMessageOfType(
      panel.messages,
      'transformComplete'
    )
    assert.ok(transformComplete, 'Expected large uppercase no-op completion')
    assert.equal(transformComplete.contentChanged, false)
    assert.deepEqual(
      lastMessageOfType(panel.messages, 'editState'),
      cleanEditState
    )

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
    await waitForOmegaEditTab(uri)
    const session = await waitForSession(provider, uri)
    assert.ok(session, 'Expected a live session for the command undo test')

    await provider.dispatchWebviewMessageForTesting(uri, {
      type: 'applyTransform',
      pluginId: 'omega.example.base64',
      offset: 0,
      length: 3,
    })

    await assertSessionText(session.sessionId, 'YWJj')
    await waitForOmegaEditTab(uri, { dirty: true })

    await vscode.commands.executeCommand('undo')
    await assertSessionText(session.sessionId, 'abc')
    await waitForOmegaEditTab(uri, { dirty: false })

    await vscode.commands.executeCommand('redo')
    await assertSessionText(session.sessionId, 'YWJj')
    await waitForOmegaEditTab(uri, { dirty: true })

    try {
      await vscode.commands.executeCommand('undo')
      await assertSessionText(session.sessionId, 'abc')
      await waitForOmegaEditTab(uri, { dirty: false })
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
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
      await waitForOmegaEditTab(uri)
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
      await waitForOmegaEditTab(uri, { dirty: true })

      await vscode.commands.executeCommand('workbench.action.files.revert')
      await assertSessionText(session.sessionId, 'abc')
      await assertEditState(session, {
        canUndo: false,
        canRedo: false,
        undoCount: 0,
        redoCount: 0,
        isDirty: false,
        savedChangeDepth: 0,
      })
      await waitForOmegaEditTab(uri, { dirty: false })

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
      await waitForOmegaEditTab(uri, { dirty: true })

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
      await waitForOmegaEditTab(uri, { dirty: false })

      await vscode.commands.executeCommand(OMEGA_EDIT_ROLLBACK_SESSION_COMMAND)
      await assertSessionText(session.sessionId, 'abc')
      assert.equal(await fs.readFile(samplePath, 'utf8'), 'abc!')
      assert.equal(session.restoredFromBackup, true)
      await assertEditState(session, {
        canUndo: false,
        canRedo: false,
        undoCount: 0,
        redoCount: 0,
        isDirty: false,
        savedChangeDepth: 0,
      })
      await waitForOmegaEditTab(uri, { dirty: true })

      await vscode.commands.executeCommand('workbench.action.files.save')
      assert.equal(await fs.readFile(samplePath, 'utf8'), 'abc')
      assert.equal(session.restoredFromBackup, false)
      await waitForOmegaEditTab(uri, { dirty: false })
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('refreshes viewport data when webview metrics arrive after initial load', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-ready-')
    )
    const samplePath = path.join(tmpDir, 'ready.bin')
    await fs.writeFile(samplePath, Buffer.from('ready bytes', 'utf8'))

    const provider = new HexEditorProvider({ subscriptions: [] }, testPort)
    const panel = createMockWebviewPanel()
    const document = await provider.openCustomDocument(
      vscode.Uri.file(samplePath),
      { backupId: undefined, untitledDocumentData: undefined },
      new vscode.CancellationTokenSource().token
    )

    try {
      await provider.resolveCustomEditor(
        document,
        panel,
        new vscode.CancellationTokenSource().token
      )

      const initialViewportMessages = panel.messages.filter(
        (message) => message.type === 'viewportData'
      )
      assert.equal(initialViewportMessages.length, 1)

      const session = provider.getSessionForTesting(document.uri)
      assert.ok(session, 'Expected a live session for the ready test')
      await provider.dispatchWebviewMessageForTesting(document.uri, {
        type: 'setViewportMetrics',
        visibleRows: session.visibleRows,
      })

      const refreshedViewportMessages = panel.messages.filter(
        (message) => message.type === 'viewportData'
      )
      assert.equal(refreshedViewportMessages.length, 2)
      assert.deepEqual(
        refreshedViewportMessages.at(-1).data,
        Array.from(Buffer.from('ready bytes', 'utf8'))
      )
    } finally {
      await panel.fireDidDispose()
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

    await provider.exportChangeLog({
      uri: sourceUri,
      targetUri: vscode.Uri.file(scriptPath),
    })
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

    await provider.applyChangeLog({
      uri: replayUri,
      sourceUri: vscode.Uri.file(scriptPath),
    })
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

async function waitForOmegaEditTab(uri, options = {}) {
  const tab = await waitForTab((candidate) => {
    if (
      !(candidate?.input instanceof vscode.TabInputCustom) ||
      candidate.input.viewType !== OMEGA_EDIT_VIEW_TYPE ||
      candidate.input.uri.fsPath !== uri.fsPath
    ) {
      return false
    }

    return options.dirty === undefined || candidate.isDirty === options.dirty
  })
  assert.ok(
    tab,
    options.dirty === undefined
      ? `Expected active OmegaEdit tab for ${uri.fsPath}`
      : `Expected active OmegaEdit tab for ${uri.fsPath} with dirty=${options.dirty}`
  )
  return tab
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

async function assertEditState(
  session,
  expected,
  timeoutMs = 3000,
  intervalMs = 50
) {
  const deadline = Date.now() + timeoutMs
  let lastState = session.history.getEditState()

  while (Date.now() < deadline) {
    lastState = session.history.getEditState()
    try {
      assert.deepEqual(lastState, expected)
      return
    } catch {
      await delay(intervalMs)
    }
  }

  assert.deepEqual(lastState, expected)
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
