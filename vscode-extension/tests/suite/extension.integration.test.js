const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
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
  OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND,
  OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
  OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
  OMEGA_EDIT_LOAD_RANGE_MAP_COMMAND,
  OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
  OMEGA_EDIT_ROLLBACK_SESSION_COMMAND,
  OMEGA_EDIT_SEARCH_NEXT_COMMAND,
  OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND,
  OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
  OMEGA_EDIT_UNLOAD_RANGE_MAP_COMMAND,
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

function makeUtf8Fingerprint(text) {
  const data = Buffer.from(text, 'utf8')
  return {
    byteLength: data.byteLength.toString(),
    digest: {
      algorithm: 'sha256',
      value: createHash('sha256').update(data).digest('hex'),
    },
  }
}

function canonicalizeTransformDescriptorValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeTransformDescriptorValue)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  return Object.keys(value)
    .sort()
    .reduce((canonical, key) => {
      canonical[key] = canonicalizeTransformDescriptorValue(value[key])
      return canonical
    }, {})
}

function makeTransformDataHex(transformId, args = {}) {
  return Buffer.from(
    JSON.stringify({
      transformId,
      args: canonicalizeTransformDescriptorValue(args),
    }),
    'utf8'
  ).toString('hex')
}

function parseTransformDataHex(data) {
  return JSON.parse(Buffer.from(data, 'hex').toString('utf8'))
}

function assertSamePath(actual, expected) {
  const normalizedActual = path.resolve(actual)
  const normalizedExpected = path.resolve(expected)
  if (process.platform === 'win32') {
    assert.equal(
      normalizedActual.toLowerCase(),
      normalizedExpected.toLowerCase()
    )
    return
  }
  assert.equal(normalizedActual, normalizedExpected)
}

function assertAssistantCommandSurface(commands) {
  assert.ok(Array.isArray(commands), 'expected assistant commands array')
  assert.ok(commands.length > 0, 'expected assistant command entries')

  for (const entry of commands) {
    assert.equal(typeof entry.action, 'string', 'entry action is named')
    assert.equal(typeof entry.result, 'string', `${entry.action}.result`)

    for (const legacyField of [
      'vscodeCommand',
      'extensionApi',
      'cli',
      'mcpTool',
    ]) {
      assert.equal(
        Object.hasOwn(entry, legacyField),
        false,
        `${entry.action}.${legacyField} must not leak legacy singular field`
      )
    }

    for (const arrayField of [
      'vscodeCommands',
      'extensionApis',
      'cliCommands',
      'mcpTools',
    ]) {
      if (!Object.hasOwn(entry, arrayField)) {
        continue
      }

      assert.ok(
        Array.isArray(entry[arrayField]),
        `${entry.action}.${arrayField}`
      )
      assert.ok(
        entry[arrayField].length > 0,
        `${entry.action}.${arrayField} not empty`
      )
      for (const value of entry[arrayField]) {
        assert.equal(typeof value, 'string', `${entry.action}.${arrayField}`)
        assert.equal(
          value.includes(' / '),
          false,
          `${entry.action}.${arrayField} must use separate array values`
        )
      }
    }
  }

  const byAction = new Map(commands.map((entry) => [entry.action, entry]))
  assert.deepEqual(byAction.get('assistantContext')?.vscodeCommands, [
    OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND,
  ])
  assert.deepEqual(byAction.get('assistantContext')?.extensionApis, [
    'getAssistantContext',
  ])
  assert.deepEqual(byAction.get('assistantContext')?.cliCommands, [
    'oe session-context --session <id> [--file <path>]',
  ])
  assert.deepEqual(byAction.get('assistantContext')?.mcpTools, [
    'omega_edit_session_context',
  ])
  assert.deepEqual(byAction.get('search')?.vscodeCommands, [
    OMEGA_EDIT_SEARCH_NEXT_COMMAND,
    OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND,
  ])
  assert.deepEqual(byAction.get('patchRange')?.mcpTools, [
    'omega_edit_preview_patch',
    'omega_edit_apply_patch',
  ])
  assert.deepEqual(byAction.get('undoRedo')?.vscodeCommands, [
    'omegaEdit.undo',
    'omegaEdit.redo',
  ])
  assert.deepEqual(byAction.get('undoRedo')?.cliCommands, [
    'oe undo --session <id>',
    'oe redo --session <id>',
  ])
  assert.deepEqual(byAction.get('undoRedo')?.mcpTools, [
    'omega_edit_undo',
    'omega_edit_redo',
  ])
}

function assertAssistantContextPayloadBudget(context) {
  assert.ok(
    Buffer.byteLength(JSON.stringify(context), 'utf8') < 32 * 1024,
    'assistant context should stay compact for small sessions'
  )
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
    assert.equal(typeof extensionApi.getAssistantContext, 'function')
    assert.equal(typeof extensionApi.setExternalHighlights, 'function')
    assert.equal(typeof extensionApi.clearExternalHighlights, 'function')
    assert.equal(typeof extensionApi.loadRangeMap, 'function')
    assert.equal(typeof extensionApi.unloadRangeMap, 'function')
    assert.equal(typeof extensionApi.createCheckpoint, 'function')
    assert.equal(typeof extensionApi.rollbackCheckpoint, 'function')
    assert.equal(typeof extensionApi.restoreCheckpoint, 'function')
    assert.equal(typeof extensionApi.exportChangeLog, 'function')
    assert.equal(typeof extensionApi.previewChangeLog, 'function')
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
    assert.ok(commands.includes(OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_LOAD_RANGE_MAP_COMMAND))
    assert.ok(commands.includes(OMEGA_EDIT_UNLOAD_RANGE_MAP_COMMAND))
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
        textEncoding: 'ascii',
        activePane: 'hex',
        editMode: 'insert',
      })

      const selectedState = extensionApi.getEditorState({ uri })
      assert.equal(selectedState.selectedOffset, 1)
      assert.equal(selectedState.editMode, 'insert')
      assert.equal(selectedState.selectionStart, 1)
      assert.equal(selectedState.selectionEnd, 3)

      const assistantContext = extensionApi.getAssistantContext({ uri })
      assert.equal(assistantContext.version, 1)
      assert.equal(assistantContext.session.id, session.sessionId)
      assert.equal(assistantContext.session.uri, uri.toString())
      assertSamePath(assistantContext.session.filePath, samplePath)
      assert.equal(assistantContext.sizes.computed, 6)
      assert.equal(assistantContext.sizes.original, 6)
      assert.deepEqual(assistantContext.selection, {
        offset: 1,
        start: 1,
        end: 3,
        length: 3,
      })
      assert.equal(
        assistantContext.viewport.activeViewportId,
        session.viewportId
      )
      assert.equal(assistantContext.history.undoCount, 0)
      assert.equal(assistantContext.history.redoCount, 0)
      assert.equal(assistantContext.history.undoStackDepth, 0)
      assert.equal(assistantContext.history.redoStackDepth, 0)
      assert.equal(assistantContext.changeLog.format, 'omega-edit.change-log')
      assertAssistantCommandSurface(assistantContext.commands)
      assertAssistantContextPayloadBudget(assistantContext)

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

      const rangeMapPath = path.join(tmpDir, 'typed-api.range-map.json')
      await fs.writeFile(
        rangeMapPath,
        JSON.stringify(
          {
            format: 'omega-edit.range-map',
            version: 1,
            source: 'synthetic.dfdl',
            selectedPath: '/doc/body',
            nodes: [
              {
                path: '/doc/header',
                label: 'Header',
                offset: 0,
                length: 2,
                kind: 'parsed',
                type: 'ascii',
                value: 'ab',
              },
              {
                path: '/doc/body',
                label: 'Body',
                offset: 2,
                length: 2,
                kind: 'parsed',
                type: 'ascii',
                value: 'cd',
              },
            ],
          },
          null,
          2
        )
      )
      const rangeMapResult = await extensionApi.loadRangeMap({
        uri,
        sourceUri: vscode.Uri.file(rangeMapPath),
        reveal: true,
      })
      assert.equal(rangeMapResult.nodeCount, 2)
      assert.equal(rangeMapResult.highlightCount, 2)
      assert.equal(rangeMapResult.selectedPath, '/doc/body')
      assert.deepEqual(rangeMapResult.selectedRange, { offset: 2, length: 2 })
      const expectedRangeMapHighlights = [
        {
          id: '/doc/header',
          offset: 0,
          length: 2,
          kind: 'parsed',
          label: 'Header (ascii) = ab',
          source: 'synthetic.dfdl',
        },
        {
          id: '/doc/body',
          offset: 2,
          length: 2,
          kind: 'current',
          label: 'Body (ascii) = cd',
          source: 'synthetic.dfdl',
        },
      ]
      assert.deepEqual(
        rangeMapResult.state.externalHighlights,
        expectedRangeMapHighlights
      )

      const badRangeMapPath = path.join(tmpDir, 'typed-api.bad-range-map.json')
      await fs.writeFile(
        badRangeMapPath,
        JSON.stringify(
          {
            format: 'omega-edit.range-map',
            version: 1,
            nodes: [
              {
                path: '/doc/out-of-bounds',
                label: 'Out of bounds',
                offset: 6,
                length: 1,
              },
            ],
          },
          null,
          2
        )
      )
      const badRangeMapResult = await extensionApi.loadRangeMap({
        uri,
        sourceUri: vscode.Uri.file(badRangeMapPath),
      })
      assert.equal(badRangeMapResult.cancelled, true)
      assert.match(
        badRangeMapResult.message,
        /\/doc\/out-of-bounds \[6, 7\) is outside file bounds \(6 bytes\)/
      )
      assert.deepEqual(
        badRangeMapResult.state.externalHighlights,
        expectedRangeMapHighlights
      )

      const unloadedRangeMap = extensionApi.unloadRangeMap({ uri })
      assert.equal(unloadedRangeMap.unloadedCount, 2)
      assert.equal(unloadedRangeMap.highlightCount, 0)
      assert.deepEqual(unloadedRangeMap.state.externalHighlights, [])

      const secondUnloadRangeMap = extensionApi.unloadRangeMap({ uri })
      assert.equal(secondUnloadRangeMap.unloadedCount, 0)
      assert.equal(secondUnloadRangeMap.highlightCount, 0)
      assert.deepEqual(secondUnloadRangeMap.state.externalHighlights, [])

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

  test('lets a code assistant operate the editor through public VS Code commands', async () => {
    const provider = getHexEditorProviderForTesting()
    assert.ok(
      provider,
      'Expected the activated extension to expose its provider'
    )

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-assistant-')
    )
    const samplePath = path.join(tmpDir, 'assistant.bin')
    const changeLogPath = path.join(tmpDir, 'assistant-change-log.json')
    await fs.writeFile(samplePath, Buffer.from('ABCDEFGH', 'utf8'))
    const uri = vscode.Uri.file(samplePath)

    const replaced = 'A12DxyZZZ'
    const transformed = Buffer.from(replaced, 'utf8').toString('base64')
    const changes = [
      {
        serial: '1',
        kind: 'INSERT',
        offset: '1',
        length: '0',
        data: Buffer.from('12', 'utf8').toString('hex'),
      },
      {
        serial: '2',
        kind: 'DELETE',
        offset: '3',
        length: '2',
        data: Buffer.from('BC', 'utf8').toString('hex'),
      },
      {
        serial: '3',
        kind: 'OVERWRITE',
        offset: '4',
        length: '2',
        data: Buffer.from('xy', 'utf8').toString('hex'),
      },
      {
        serial: '4',
        kind: 'REPLACE',
        offset: '6',
        length: '2',
        data: Buffer.from('ZZZ', 'utf8').toString('hex'),
      },
      {
        serial: '5',
        kind: 'TRANSFORM',
        offset: '0',
        length: String(Buffer.byteLength(replaced, 'utf8')),
        data: makeTransformDataHex('omega.example.base64'),
      },
    ]
    await fs.writeFile(
      changeLogPath,
      JSON.stringify(
        {
          format: 'omega-edit.change-log',
          version: 2,
          complete: true,
          before: makeUtf8Fingerprint('ABCDEFGH'),
          after: makeUtf8Fingerprint(transformed),
          changeCount: String(changes.length),
          sourceChangeCount: String(changes.length),
          unavailableChangeCount: '0',
          unavailableChangeSerials: [],
          changes,
        },
        null,
        2
      )
    )

    try {
      await vscode.commands.executeCommand(
        OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND,
        uri
      )
      const session = await waitForSession(provider, uri)
      assert.ok(session, 'Expected a live session for the assistant test')

      const initialState = await vscode.commands.executeCommand(
        OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
        { uri }
      )
      assert.equal(initialState.uri, uri.toString())
      assert.equal(initialState.fileSize, 8)
      assert.equal(
        await vscode.commands.executeCommand(OMEGA_EDIT_SEARCH_NEXT_COMMAND),
        undefined
      )
      assert.equal(
        await vscode.commands.executeCommand(
          OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND
        ),
        undefined
      )

      const revealState = await vscode.commands.executeCommand(
        OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
        { uri, offset: 2 }
      )
      assert.equal(revealState.uri, uri.toString())
      assert.equal(typeof revealState.visibleOffset, 'number')
      const numericRevealState = await vscode.commands.executeCommand(
        OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
        3
      )
      assert.equal(numericRevealState.uri, uri.toString())
      const offsetOnlyRevealState = await vscode.commands.executeCommand(
        OMEGA_EDIT_GO_TO_OFFSET_COMMAND,
        undefined,
        4
      )
      assert.equal(offsetOnlyRevealState.uri, uri.toString())

      const initialContext = await vscode.commands.executeCommand(
        OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND,
        { uri }
      )
      assert.equal(initialContext.session.id, session.sessionId)
      assertSamePath(initialContext.session.filePath, samplePath)
      assert.equal(initialContext.sizes.computed, 8)
      assert.equal(initialContext.selection, null)
      assert.equal(initialContext.history.pendingChanges, false)
      assert.equal(initialContext.history.undoStackDepth, 0)
      assert.equal(initialContext.history.redoStackDepth, 0)
      assertAssistantCommandSurface(initialContext.commands)
      assertAssistantContextPayloadBudget(initialContext)

      const applyResult = await vscode.commands.executeCommand(
        OMEGA_EDIT_APPLY_CHANGE_LOG_COMMAND,
        {
          uri,
          sourceUri: vscode.Uri.file(changeLogPath),
        }
      )
      assert.equal(applyResult.changeCount, 5)
      assert.equal(applyResult.state.uri, uri.toString())
      await assertSessionText(session.sessionId, transformed)

      const highlightedState = await vscode.commands.executeCommand(
        OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
        {
          uri: uri.toString(),
          reveal: true,
          highlights: [
            {
              id: 'assistant.generated-change',
              offset: 0,
              length: Buffer.byteLength(transformed, 'utf8'),
              kind: 'parsed',
              label: 'Assistant-applied edit',
              source: 'Code assistant',
            },
          ],
        }
      )
      assert.deepEqual(highlightedState.externalHighlights, [
        {
          id: 'assistant.generated-change',
          offset: 0,
          length: Buffer.byteLength(transformed, 'utf8'),
          kind: 'parsed',
          label: 'Assistant-applied edit',
          source: 'Code assistant',
        },
      ])
      assert.equal(highlightedState.undoCount, 2)
      assert.equal(highlightedState.redoCount, 0)
      const changedContext = await vscode.commands.executeCommand(
        OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND,
        { uri }
      )
      assert.equal(changedContext.history.undoCount, 2)
      assert.equal(changedContext.history.redoCount, 0)
      assert.equal(changedContext.history.undoStackDepth, 2)
      assert.equal(changedContext.history.redoStackDepth, 0)
      assertAssistantContextPayloadBudget(changedContext)
      assert.equal(
        changedContext.changeLog.sourceChangeCount,
        changedContext.history.changeCount
      )
      assert.ok(
        changedContext.changeLog.sourceChangeCount >=
          applyResult.sourceChangeCount
      )

      await provider.dispatchWebviewMessageForTesting(uri, { type: 'undo' })
      await assertSessionText(session.sessionId, replaced)
      let state = await vscode.commands.executeCommand(
        OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
        { uri }
      )
      assert.equal(state.undoCount, 1)
      assert.equal(state.redoCount, 1)
      const onceUndoneContext = await vscode.commands.executeCommand(
        OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND,
        { uri }
      )
      assert.equal(onceUndoneContext.history.undoCount, 1)
      assert.equal(onceUndoneContext.history.redoCount, 1)
      assert.equal(onceUndoneContext.history.undoStackDepth, 1)
      assert.equal(onceUndoneContext.history.redoStackDepth, 1)

      await provider.dispatchWebviewMessageForTesting(uri, { type: 'undo' })
      await assertSessionText(session.sessionId, 'ABCDEFGH')
      state = await vscode.commands.executeCommand(
        OMEGA_EDIT_GET_EDITOR_STATE_COMMAND,
        { uri }
      )
      assert.equal(state.undoCount, 0)
      assert.equal(state.redoCount, 2)
      const fullyUndoneContext = await vscode.commands.executeCommand(
        OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND,
        { uri }
      )
      assert.equal(fullyUndoneContext.history.undoCount, 0)
      assert.equal(fullyUndoneContext.history.redoCount, 2)
      assert.equal(fullyUndoneContext.history.undoStackDepth, 0)
      assert.equal(fullyUndoneContext.history.redoStackDepth, 2)

      await provider.dispatchWebviewMessageForTesting(uri, { type: 'redo' })
      await assertSessionText(session.sessionId, replaced)
      await provider.dispatchWebviewMessageForTesting(uri, { type: 'redo' })
      await assertSessionText(session.sessionId, transformed)
    } finally {
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
        ['DELETE', 'INSERT', 'OVERWRITE', 'REPLACE', 'TRANSFORM'].includes(
          change.kind
        )
      ),
      'Expected exported change kinds to stay within OmegaEdit operations'
    )
    const transformChange = script.changes.find(
      (change) => change.kind === 'TRANSFORM'
    )
    assert.ok(transformChange, 'Expected the base64 transform to be exported')
    assert.equal(transformChange.offset, '0')
    assert.equal(transformChange.length, '8')
    assert.notEqual(transformChange.data, '')
    assert.deepEqual(parseTransformDataHex(transformChange.data), {
      transformId: 'omega.example.base64',
      args: {},
    })
    assert.equal(Object.hasOwn(transformChange, 'transformId'), false)
    assert.equal(Object.hasOwn(transformChange, 'optionsJson'), false)
    assert.equal(Object.hasOwn(transformChange, 'replacementLength'), false)
    assert.equal(
      Object.hasOwn(transformChange, 'computedFileSizeBefore'),
      false
    )
    assert.equal(Object.hasOwn(transformChange, 'computedFileSizeAfter'), false)

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
    tamperedTransformChange.data = makeTransformDataHex('omega.example.missing')
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

    const tamperedResult = await provider3.applyChangeLog({
      uri: document3.uri,
      sourceUri: vscode.Uri.file(tamperedScriptPath),
    })
    assert.equal(tamperedResult?.cancelled, true)
    assert.equal(tamperedResult?.preview?.canApply, false)
    assert.ok(
      tamperedResult?.preview?.missingPlugins.includes('omega.example.missing')
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

    const preview = await provider.previewChangeLog({
      uri: document.uri,
      sourceUri: vscode.Uri.file(scriptPath),
    })
    assert.equal(preview?.canApply, false)
    assert.equal(preview?.unavailablePrimitives.count, '1')
    assert.deepEqual(preview?.unavailablePrimitives.serials, ['1'])
    assert.ok(
      preview?.safetyIssues.some(
        (issue) => issue.code === 'unavailable-primitives'
      )
    )

    const incompleteResult = await provider.applyChangeLog({
      uri: document.uri,
      sourceUri: vscode.Uri.file(scriptPath),
    })

    assert.equal(incompleteResult?.cancelled, true)
    assert.equal(incompleteResult?.changeCount, 0)
    assert.equal(incompleteResult?.preview?.canApply, false)
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
    const transformComplete = lastMessageOfType(
      panel.messages,
      'transformComplete'
    )
    assert.ok(transformComplete, 'Expected transform completion metadata')
    assert.equal(transformComplete.contentChanged, true)
    assert.ok(transformComplete.serial > 0, 'Expected transform change serial')
    assert.equal(
      transformComplete.descriptorJson,
      JSON.stringify({ transformId: 'omega.example.base64', args: {} })
    )
    assert.equal(
      transformComplete.descriptorHex,
      makeTransformDataHex('omega.example.base64')
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
    assert.equal(transformComplete.serial, undefined)
    assert.deepEqual(parseTransformDataHex(transformComplete.descriptorHex), {
      transformId: 'omega.example.common_checksums',
      args: { algorithm: 'sum8' },
    })
    assert.equal(
      transformComplete.descriptorJson,
      JSON.stringify({
        transformId: 'omega.example.common_checksums',
        args: { algorithm: 'sum8' },
      })
    )
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
    assert.equal(transformComplete.serial, undefined)
    assert.deepEqual(parseTransformDataHex(transformComplete.descriptorHex), {
      transformId: 'omega.example.common_checksums',
      args: { algorithm: 'sum8' },
    })
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
    assert.equal(xorTransformComplete.serial, undefined)
    assert.deepEqual(
      parseTransformDataHex(xorTransformComplete.descriptorHex),
      {
        transformId: 'omega.example.bitwise',
        args: { operator: 'xor', byte: '0x00' },
      }
    )
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
    assert.ok(upperTransformComplete.serial > 0)
    assert.deepEqual(
      parseTransformDataHex(upperTransformComplete.descriptorHex),
      {
        transformId: 'omega.example.case_change',
        args: { case: 'upper' },
      }
    )
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
    assert.equal(upperNoopTransformComplete.serial, undefined)
    assert.deepEqual(
      parseTransformDataHex(upperNoopTransformComplete.descriptorHex),
      {
        transformId: 'omega.example.case_change',
        args: { case: 'upper' },
      }
    )
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
        textEncoding: 'cp437',
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

      const rangeMapPath = path.join(tmpDir, 'external-state.range-map.json')
      await fs.writeFile(
        rangeMapPath,
        JSON.stringify(
          {
            format: 'omega-edit.range-map',
            version: 1,
            source: 'command.dfdl',
            nodes: [
              {
                path: '/doc/signature',
                label: 'Signature',
                offset: 0,
                length: 3,
                kind: 'parsed',
                type: 'ascii',
                value: 'abc',
              },
            ],
          },
          null,
          2
        )
      )
      const commandLoadedRangeMap = await vscode.commands.executeCommand(
        OMEGA_EDIT_LOAD_RANGE_MAP_COMMAND,
        {
          uri: uri.toString(),
          sourceUri: vscode.Uri.file(rangeMapPath),
          reveal: false,
        }
      )
      assert.equal(commandLoadedRangeMap.highlightCount, 1)
      assert.deepEqual(commandLoadedRangeMap.state.externalHighlights, [
        {
          id: '/doc/signature',
          offset: 0,
          length: 3,
          kind: 'parsed',
          label: 'Signature (ascii) = abc',
          source: 'command.dfdl',
        },
      ])

      const commandUnloadRangeMap = await vscode.commands.executeCommand(
        OMEGA_EDIT_UNLOAD_RANGE_MAP_COMMAND,
        { uri: uri.toString() }
      )
      assert.equal(commandUnloadRangeMap.unloadedCount, 1)
      assert.equal(commandUnloadRangeMap.highlightCount, 0)
      assert.deepEqual(commandUnloadRangeMap.state.externalHighlights, [])

      const commandUnloadAfterClear = await vscode.commands.executeCommand(
        OMEGA_EDIT_UNLOAD_RANGE_MAP_COMMAND,
        { uri: uri.toString() }
      )
      assert.equal(commandUnloadAfterClear.unloadedCount, 0)
      assert.equal(commandUnloadAfterClear.highlightCount, 0)
      assert.deepEqual(commandUnloadAfterClear.state.externalHighlights, [])
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

  test('updates bytes per row without replacing the live webview', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-vscode-bytes-row-')
    )
    const samplePath = path.join(tmpDir, 'bytes-row.bin')
    await fs.writeFile(samplePath, Buffer.from('bytes per row', 'utf8'))

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

      const initialHtml = panel.webview.html
      const session = provider.getSessionForTesting(document.uri)
      assert.ok(
        session,
        'Expected a live session for the bytes-per-row refresh test'
      )
      session.bytesPerRowSetting = 0
      session.bytesPerRow = 32

      provider.refreshBytesPerRow(0)

      assert.equal(panel.webview.html, initialHtml)
      const bytesPerRowMessage = lastMessageOfType(
        panel.messages,
        'bytesPerRow'
      )
      assert.deepEqual(bytesPerRowMessage, {
        type: 'bytesPerRow',
        bytesPerRow: 16,
        bytesPerRowMode: 'fixed',
      })
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
    const savedAssistantContext = provider.getAssistantContext(document.uri)
    assert.equal(savedAssistantContext.history.changeCount, 4)
    assert.equal(savedAssistantContext.history.pendingChanges, false)
    assert.equal(savedAssistantContext.dirty, false)

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
