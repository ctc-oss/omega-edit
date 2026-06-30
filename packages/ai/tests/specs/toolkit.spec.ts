import { strict as assert } from 'assert'
import { createHash } from 'crypto'
import * as fs from 'fs'
import { createServer } from 'net'
import * as os from 'os'
import * as path from 'path'
import * as omegaEditClient from '@omega-edit/client'
import { OmegaEditToolkit } from '../../src/service'
import { parseInputData } from '../../src/codec'
import type { ChangeLogDocument, ChangeLogEntry } from '../../src/types'

const EMPTY_SHA256_FINGERPRINT = {
  byteLength: 0,
  digest: {
    algorithm: 'sha256',
    value: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
}

const ABCDEF_SHA256_FINGERPRINT = {
  byteLength: 6,
  digest: {
    algorithm: 'sha256',
    value: 'bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721',
  },
}

function makeUtf8Fingerprint(text: string) {
  const data = Buffer.from(text, 'utf8')
  return {
    byteLength: data.byteLength,
    digest: {
      algorithm: 'sha256',
      value: createHash('sha256').update(data).digest('hex'),
    },
  }
}

function makeChangeLogDocument(
  changes: ChangeLogEntry[],
  overrides: Partial<ChangeLogDocument> = {}
): ChangeLogDocument {
  const document: ChangeLogDocument = {
    format: 'omega-edit.change-log',
    version: 2,
    complete: true,
    before: EMPTY_SHA256_FINGERPRINT,
    after: EMPTY_SHA256_FINGERPRINT,
    changeCount: changes.length,
    sourceChangeCount: changes.length,
    unavailableChangeCount: 0,
    unavailableChangeSerials: [],
    changes,
  }
  return { ...document, ...overrides }
}

function makeTransformDataHex(
  transformId: string,
  args: Record<string, unknown> = {}
) {
  return Buffer.from(JSON.stringify({ transformId, args }), 'utf8').toString(
    'hex'
  )
}

function parseTransformDataHex(data: string) {
  return JSON.parse(Buffer.from(data, 'hex').toString('utf8')) as {
    transformId?: unknown
    args?: unknown
  }
}

async function assertToolkitText(
  toolkit: OmegaEditToolkit,
  sessionId: string,
  expected: string
) {
  const expectedLength = Buffer.byteLength(expected, 'utf8')
  const status = await toolkit.sessionStatus(sessionId)
  assert.equal(status.computedSize, expectedLength)
  const range = await toolkit.readRange(sessionId, 0, expectedLength)
  assert.equal(range.actualLength, expectedLength)
  assert.equal(range.data.utf8, expected)
}

describe('@omega-edit/ai toolkit', () => {
  it('preserves the original connection failure as the cause', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: false })

    try {
      await (toolkit as any).connectToRunningServer()
      assert.fail('connectToRunningServer should fail without a running server')
    } catch (error) {
      assert.ok(error instanceof Error)
      assert.match(
        error.message,
        new RegExp(`OmegaEdit server is not running on 127.0.0.1:${port}`)
      )
      assert.ok((error as Error & { cause?: unknown }).cause instanceof Error)
    }
  })

  it('rejects wrapped change logs with incompatible format metadata', async function () {
    const toolkit = new OmegaEditToolkit({ autoStart: false })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const invalidFormatPath = path.join(tempDir, 'invalid-format.json')
    const invalidVersionPath = path.join(tempDir, 'invalid-version.json')
    const deeplyNestedPath = path.join(tempDir, 'deeply-nested.json')

    try {
      await fs.promises.writeFile(
        invalidFormatPath,
        JSON.stringify({
          format: 'not-omega-edit',
          version: 1,
          changes: [],
        })
      )
      await fs.promises.writeFile(
        invalidVersionPath,
        JSON.stringify({
          format: 'omega-edit.change-log',
          version: 1,
          changes: [],
        })
      )
      await fs.promises.writeFile(
        deeplyNestedPath,
        `${'['.repeat(257)}${']'.repeat(257)}`
      )

      await assert.rejects(
        () =>
          toolkit.applyChangeLog({
            sessionId: 'session',
            dryRun: true,
            inputPath: invalidFormatPath,
          }),
        /Unsupported change log format/
      )

      await assert.rejects(
        () =>
          toolkit.applyChangeLog({
            sessionId: 'session',
            dryRun: true,
            inputPath: invalidVersionPath,
          }),
        /Unsupported change log version/
      )

      await assert.rejects(
        () =>
          toolkit.applyChangeLog({
            sessionId: 'session',
            dryRun: true,
            inputPath: deeplyNestedPath,
          }),
        /Change log JSON nesting exceeds/
      )
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }

    const wrappedDocument = await toolkit.applyChangeLog({
      sessionId: 'session',
      dryRun: true,
      changes: makeChangeLogDocument([]),
    })
    assert.equal(wrappedDocument.applied, false)
    assert.equal(wrappedDocument.changeCount, 0)
    assert.equal(wrappedDocument.inputChangeCount, 0)

    await assert.rejects(
      () =>
        toolkit.applyChangeLog({
          sessionId: 'session',
          dryRun: true,
          changes: makeChangeLogDocument([], {
            complete: false,
            sourceChangeCount: 1,
            unavailableChangeCount: 1,
            unavailableChangeSerials: [1],
          }),
        }),
      /Change log is incomplete/
    )

    await assert.rejects(
      () =>
        (toolkit.applyChangeLog as any)({
          sessionId: 'session',
          dryRun: true,
          changes: [],
        }),
      /versioned omega-edit\.change-log document/
    )
  })

  it('accepts decimal int64 strings in change-log documents', async function () {
    const toolkit = new OmegaEditToolkit({ autoStart: false })

    const dryRun = await toolkit.applyChangeLog({
      sessionId: 'session',
      dryRun: true,
      changes: makeChangeLogDocument(
        [
          {
            serial: '1',
            kind: 'REPLACE',
            offset: '2',
            length: '1',
            data: Buffer.from('Z', 'utf8').toString('hex'),
          },
        ],
        {
          before: {
            ...ABCDEF_SHA256_FINGERPRINT,
            byteLength: '6',
          },
          after: {
            ...ABCDEF_SHA256_FINGERPRINT,
            byteLength: '6',
          },
          changeCount: '1',
          sourceChangeCount: '1',
          unavailableChangeCount: '0',
        }
      ),
    })

    assert.equal(dryRun.inputChangeCount, 1)

    await assert.rejects(
      () =>
        toolkit.applyChangeLog({
          sessionId: 'session',
          dryRun: true,
          changes: makeChangeLogDocument(
            [
              {
                kind: 'REPLACE',
                offset: '9007199254740992',
                length: '0',
                data: '',
              },
            ],
            {
              changeCount: '1',
              sourceChangeCount: '1',
              unavailableChangeCount: '0',
            }
          ),
        }),
      /transport safe integer range/
    )
  })

  it('does not impose the former 100k-entry change-log cap', async function () {
    const toolkit = new OmegaEditToolkit({ autoStart: false })
    const changes = Array.from({ length: 100_001 }, () => ({
      kind: 'REPLACE' as const,
      offset: 0,
      length: 0,
      data: '',
    }))

    const dryRun = await toolkit.applyChangeLog({
      sessionId: 'session',
      dryRun: true,
      changes: makeChangeLogDocument(changes),
    })

    assert.equal(dryRun.inputChangeCount, changes.length)
  })

  it('rejects inconsistent change-log serial and group metadata', async function () {
    const toolkit = new OmegaEditToolkit({ autoStart: false })

    await assert.rejects(
      () =>
        toolkit.applyChangeLog({
          sessionId: 'session',
          dryRun: true,
          changes: makeChangeLogDocument([
            {
              serial: 1,
              kind: 'INSERT',
              offset: 0,
              length: 0,
              data: '41',
            },
            {
              serial: 3,
              kind: 'INSERT',
              offset: 1,
              length: 0,
              data: '42',
            },
          ]),
        }),
      /serial metadata must be contiguous/
    )

    await assert.rejects(
      () =>
        toolkit.applyChangeLog({
          sessionId: 'session',
          dryRun: true,
          changes: makeChangeLogDocument([
            {
              kind: 'INSERT',
              offset: 0,
              length: 0,
              data: '41',
              groupId: 'batch-a',
            },
            {
              kind: 'INSERT',
              offset: 1,
              length: 0,
              data: '42',
              groupId: 'batch-b',
            },
            {
              kind: 'INSERT',
              offset: 2,
              length: 0,
              data: '43',
              groupId: 'batch-a',
            },
          ]),
        }),
      /groupId "batch-a" is not contiguous/
    )
  })

  it('supports bounded reads, search, preview, patching, and undo/redo', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const inputPath = path.join(tempDir, 'input.bin')
    const outputPath = path.join(tempDir, 'output.bin')
    const changeLogPath = path.join(tempDir, 'changes.json')
    const replayPath = path.join(tempDir, 'replay.bin')

    fs.writeFileSync(inputPath, Buffer.from('abcdef', 'utf8'))

    let createdSessionId = ''

    try {
      const created = await toolkit.createSession(inputPath)
      createdSessionId = created.sessionId
      assert.ok(createdSessionId.length > 0)

      const initialRange = await toolkit.readRange(createdSessionId, 0, 6)
      assert.equal(initialRange.actualLength, 6)
      assert.equal(initialRange.data.utf8, 'abcdef')

      const profile = await toolkit.profileRange(createdSessionId, 1, 4)
      assert.equal(profile.actualLength, 4)
      assert.equal(profile.totalBytes, 4)
      assert.equal(profile.asciiBytes, 4)
      assert.equal(profile.frequency['b'.charCodeAt(0)], 1)
      assert.equal(profile.frequency['e'.charCodeAt(0)], 1)
      assert.deepEqual(
        profile.topBytes.map((entry) => entry.hex),
        ['0x62', '0x63', '0x64', '0x65']
      )
      assert.equal(profile.topBytes[0].printable, 'b')
      assert.ok(typeof profile.contentType === 'string')

      const plugins = await toolkit.listTransformPlugins()
      assert.ok(Array.isArray(plugins))

      await assert.rejects(
        () =>
          toolkit.applyTransformPlugin({
            sessionId: createdSessionId,
            pluginId: 'omega.example.missing',
          }),
        /omega\.example\.missing/
      )

      await assert.rejects(
        () =>
          toolkit.applyTransformPlugin({
            sessionId: createdSessionId,
            pluginId: 'omega.example.missing',
            offset: Number.NaN,
          }),
        /offset must be a non-negative integer/
      )

      const searchResult = await toolkit.search({
        sessionId: createdSessionId,
        pattern: parseInputData('cd', 'utf8'),
        limit: 5,
      })
      assert.deepEqual(searchResult.matches, [2])

      const preview = await toolkit.previewPatch({
        sessionId: createdSessionId,
        kind: 'overwrite',
        offset: 1,
        data: parseInputData('Z', 'utf8'),
      })
      assert.equal(preview.targetBefore.utf8, 'b')
      assert.equal(preview.targetAfter.utf8, 'Z')

      const patchResult = await toolkit.applyPatch({
        sessionId: createdSessionId,
        kind: 'overwrite',
        offset: 1,
        data: parseInputData('Z', 'utf8'),
      })
      assert.equal(patchResult.applied, true)
      assert.ok(typeof patchResult.serial === 'number')

      const patchedRange = await toolkit.readRange(createdSessionId, 0, 6)
      assert.equal(patchedRange.data.utf8, 'aZcdef')

      const undoResult = await toolkit.undo(createdSessionId)
      assert.ok(typeof undoResult.serial === 'number')
      const afterUndo = await toolkit.readRange(createdSessionId, 0, 6)
      assert.equal(afterUndo.data.utf8, 'abcdef')

      const redoResult = await toolkit.redo(createdSessionId)
      assert.ok(typeof redoResult.serial === 'number')
      const afterRedo = await toolkit.readRange(createdSessionId, 0, 6)
      assert.equal(afterRedo.data.utf8, 'aZcdef')

      const exportedLog = await toolkit.exportChangeLog(
        createdSessionId,
        changeLogPath,
        true
      )
      assert.equal(exportedLog.format, 'omega-edit.change-log')
      assert.equal(exportedLog.version, 2)
      assert.equal(exportedLog.complete, true)
      assert.equal(exportedLog.before.byteLength, '6')
      assert.equal(exportedLog.before.digest.algorithm, 'sha256')
      assert.match(exportedLog.before.digest.value, /^[0-9a-f]+$/)
      assert.equal(exportedLog.after.byteLength, '6')
      assert.equal(exportedLog.after.digest.algorithm, 'sha256')
      assert.match(exportedLog.after.digest.value, /^[0-9a-f]+$/)
      assert.notEqual(
        exportedLog.before.digest.value,
        exportedLog.after.digest.value
      )
      assert.equal(exportedLog.changeCount, '1')
      assert.equal(exportedLog.sourceChangeCount, '1')
      assert.equal(exportedLog.unavailableChangeCount, '0')
      assert.deepEqual(exportedLog.unavailableChangeSerials, [])
      assert.equal(exportedLog.changes, undefined)
      assert.equal(fs.existsSync(changeLogPath), true)
      const changeLogDocument = JSON.parse(
        await fs.promises.readFile(changeLogPath, 'utf8')
      )
      assert.equal(changeLogDocument.format, 'omega-edit.change-log')
      assert.equal(changeLogDocument.version, 2)
      assert.equal(changeLogDocument.complete, true)
      assert.deepEqual(changeLogDocument.before, exportedLog.before)
      assert.deepEqual(changeLogDocument.after, exportedLog.after)
      assert.equal(changeLogDocument.changeCount, '1')
      assert.equal(changeLogDocument.sourceChangeCount, '1')
      assert.equal(changeLogDocument.unavailableChangeCount, '0')
      assert.deepEqual(changeLogDocument.unavailableChangeSerials, [])
      assert.equal(changeLogDocument.changes[0].kind, 'OVERWRITE')
      assert.equal(changeLogDocument.changes[0].offset, '1')

      await fs.promises.writeFile(replayPath, Buffer.from('abcdef', 'utf8'))
      const replaySession = await toolkit.createSession(replayPath)
      try {
        const appliedLog = await toolkit.applyChangeLog({
          sessionId: replaySession.sessionId,
          inputPath: changeLogPath,
        })
        assert.equal(appliedLog.applied, true)
        assert.equal(appliedLog.changeCount, 1)
        assert.equal(appliedLog.inputChangeCount, 1)
        const replayedRange = await toolkit.readRange(
          replaySession.sessionId,
          0,
          6
        )
        assert.equal(replayedRange.data.utf8, 'aZcdef')
      } finally {
        await toolkit.destroySession(replaySession.sessionId)
      }

      const status = await toolkit.sessionStatus(createdSessionId)
      assert.equal(status.changeCount, 1)
      assert.equal(status.undoCount, 0)
      assert.equal(typeof status.checkpointCount, 'number')

      const saveResult = await toolkit.saveSession(
        createdSessionId,
        outputPath,
        true
      )
      assert.equal(
        fs.realpathSync.native(saveResult.filePath),
        fs.realpathSync.native(outputPath)
      )
      assert.equal(fs.readFileSync(outputPath, 'utf8'), 'aZcdef')

      const checkpoint = await toolkit.createCheckpoint(createdSessionId)
      assert.ok(checkpoint.checkpointCount >= 1)
      await toolkit.applyPatch({
        sessionId: createdSessionId,
        kind: 'insert',
        offset: 6,
        data: parseInputData('!', 'utf8'),
      })
      const restored = await toolkit.restoreCheckpoint(createdSessionId)
      assert.equal(restored.restored, true)
      assert.equal(restored.checkpointCount, checkpoint.checkpointCount)
      assert.ok(restored.discardedChangeCount >= 1)
      const afterRestore = await toolkit.readRange(createdSessionId, 0, 6)
      assert.equal(afterRestore.data.utf8, 'aZcdef')
      const rolledBack = await toolkit.rollbackCheckpoint(createdSessionId)
      assert.equal(rolledBack.rolledBack, true)
      assert.ok(rolledBack.checkpointCount >= 0)
    } finally {
      if (createdSessionId) {
        await toolkit.destroySession(createdSessionId)
      }
      await toolkit.stopServer()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rolls back a partially applied change log when a later entry fails', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const inputPath = path.join(tempDir, 'input.bin')
    fs.writeFileSync(inputPath, Buffer.from('abcdef', 'utf8'))

    let createdSessionId = ''

    try {
      const created = await toolkit.createSession(inputPath)
      createdSessionId = created.sessionId

      await assert.rejects(
        () =>
          toolkit.applyChangeLog({
            sessionId: createdSessionId,
            changes: makeChangeLogDocument(
              [
                {
                  kind: 'INSERT',
                  offset: 1,
                  length: 0,
                  data: Buffer.from('ZZ', 'utf8').toString('hex'),
                },
                {
                  kind: 'DELETE',
                  offset: 1000,
                  length: 1,
                  data: Buffer.from('x', 'utf8').toString('hex'),
                },
              ],
              {
                before: ABCDEF_SHA256_FINGERPRINT,
              }
            ),
          }),
        /delete failed|change operation failed|invalid change arguments/i
      )

      const range = await toolkit.readRange(createdSessionId, 0, 6)
      assert.equal(range.data.utf8, 'abcdef')
      const status = await toolkit.sessionStatus(createdSessionId)
      assert.equal(status.changeCount, 0)
    } finally {
      if (createdSessionId) {
        await toolkit.destroySession(createdSessionId).catch(() => undefined)
      }
      await toolkit.stopServer().catch(() => undefined)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('reports server-detected content types through profileRange', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const pngPath = path.join(tempDir, 'image.png')
    const markdownPath = path.join(tempDir, 'notes.md')

    fs.writeFileSync(
      pngPath,
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52,
      ])
    )
    fs.writeFileSync(
      markdownPath,
      '# Heading\n\n- item\n- [link](https://example.com)\n\n```text\nhello\n```\n',
      'utf8'
    )

    const sessionIds: string[] = []

    try {
      const pngSession = await toolkit.createSession(pngPath)
      sessionIds.push(pngSession.sessionId)
      const pngProfile = await toolkit.profileRange(pngSession.sessionId, 8, 8)
      assert.equal(pngProfile.contentType, 'image/png')

      const markdownSession = await toolkit.createSession(markdownPath)
      sessionIds.push(markdownSession.sessionId)
      const markdownProfile = await toolkit.profileRange(
        markdownSession.sessionId,
        0,
        64
      )
      assert.equal(markdownProfile.contentType, 'text/markdown')
    } finally {
      for (const sessionId of sessionIds) {
        await toolkit.destroySession(sessionId).catch(() => undefined)
      }
      await toolkit.stopServer().catch(() => undefined)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('normalizes patch input only once during applyPatch', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const inputPath = path.join(tempDir, 'input.bin')
    fs.writeFileSync(inputPath, Buffer.from('abcdef', 'utf8'))

    let createdSessionId = ''
    let normalizeCalls = 0
    const originalNormalize = (toolkit as any).normalizePatchRequest

    ;(toolkit as any).normalizePatchRequest = function (request: unknown) {
      normalizeCalls += 1
      return originalNormalize.call(this, request)
    }

    try {
      const created = await toolkit.createSession(inputPath)
      createdSessionId = created.sessionId

      const patchResult = await toolkit.applyPatch({
        sessionId: createdSessionId,
        kind: 'overwrite',
        offset: 1,
        data: parseInputData('Z', 'utf8'),
      })

      assert.equal(patchResult.applied, true)
      assert.equal(normalizeCalls, 1)
    } finally {
      if (createdSessionId) {
        await toolkit.destroySession(createdSessionId)
      }
      await toolkit.stopServer().catch(() => undefined)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('exposes transactional replaceSession through the toolkit', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const inputPath = path.join(tempDir, 'input.bin')
    fs.writeFileSync(inputPath, Buffer.from('hello world hello', 'utf8'))

    let createdSessionId = ''

    try {
      const created = await toolkit.createSession(inputPath)
      createdSessionId = created.sessionId

      const replaceResult = await toolkit.replaceSession({
        sessionId: createdSessionId,
        pattern: parseInputData('hello', 'utf8'),
        replacement: parseInputData('hi', 'utf8'),
      })

      assert.equal(replaceResult.replacedCount, 2)
      const updated = await toolkit.readRange(createdSessionId, 0, 11)
      assert.equal(updated.data.utf8, 'hi world hi')
      const status = await toolkit.sessionStatus(createdSessionId)
      assert.equal(status.changeCount, 4)
    } finally {
      if (createdSessionId) {
        await toolkit.destroySession(createdSessionId).catch(() => undefined)
      }
      await toolkit.stopServer().catch(() => undefined)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('waitForServerToStop only polls port availability while draining', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: false })
    let connectCalls = 0
    const blocker = createServer()

    ;(toolkit as any).connectToServer = async () => {
      connectCalls += 1
      throw new Error('connectToServer should not be called while polling')
    }

    try {
      await new Promise<void>((resolve, reject) => {
        blocker.once('error', reject)
        blocker.listen(port!, '127.0.0.1', () => resolve())
      })
      setTimeout(() => blocker.close(), 200)

      await (toolkit as any).waitForServerToStop(1000)
      assert.equal(connectCalls, 0)
    } finally {
      if (blocker.listening) {
        blocker.close()
      }
    }
  })

  it('waits for graceful shutdown to finish before reusing the same port', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const firstToolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const secondToolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const firstInputPath = path.join(tempDir, 'first.bin')
    const secondInputPath = path.join(tempDir, 'second.bin')

    fs.writeFileSync(firstInputPath, Buffer.from('abcdef', 'utf8'))
    fs.writeFileSync(secondInputPath, Buffer.from('uvwxyz', 'utf8'))

    let firstSessionId = ''
    let secondSessionId = ''

    try {
      const firstCreated = await firstToolkit.createSession(firstInputPath)
      firstSessionId = firstCreated.sessionId
      assert.ok(firstSessionId.length > 0)

      await firstToolkit.destroySession(firstSessionId)
      firstSessionId = ''

      const stopResult = await firstToolkit.stopServer()
      assert.ok(
        (stopResult.responseCode === 0 && stopResult.status === 'completed') ||
          (stopResult.responseCode === 1 && stopResult.status === 'draining')
      )

      const secondCreated = await secondToolkit.createSession(secondInputPath)
      secondSessionId = secondCreated.sessionId
      assert.ok(secondSessionId.length > 0)
    } finally {
      if (secondSessionId) {
        await secondToolkit
          .destroySession(secondSessionId)
          .catch(() => undefined)
      }
      await secondToolkit.stopServer().catch(() => undefined)
      if (firstSessionId) {
        await firstToolkit.destroySession(firstSessionId).catch(() => undefined)
      }
      await firstToolkit.stopServer().catch(() => undefined)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('applies multi-entry change logs with replace entries atomically', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const inputPath = path.join(tempDir, 'input.bin')
    fs.writeFileSync(inputPath, Buffer.from('abcdef', 'utf8'))

    let createdSessionId = ''

    try {
      const created = await toolkit.createSession(inputPath)
      createdSessionId = created.sessionId

      const result = await toolkit.applyChangeLog({
        sessionId: createdSessionId,
        changes: makeChangeLogDocument(
          [
            {
              serial: 1,
              kind: 'INSERT',
              offset: 1,
              length: 0,
              data: Buffer.from('12', 'utf8').toString('hex'),
            },
            {
              serial: 2,
              kind: 'REPLACE',
              offset: 4,
              length: 2,
              data: Buffer.from('ZZ', 'utf8').toString('hex'),
            },
            {
              serial: 3,
              kind: 'OVERWRITE',
              offset: 7,
              length: 1,
              data: Buffer.from('!', 'utf8').toString('hex'),
            },
          ],
          {
            before: ABCDEF_SHA256_FINGERPRINT,
            after: makeUtf8Fingerprint('a12bZZe!'),
          }
        ),
      })
      assert.equal(result.applied, true)
      assert.equal(result.changeCount, 3)
      assert.equal(result.inputChangeCount, 3)

      const range = await toolkit.readRange(createdSessionId, 0, 8)
      assert.equal(range.data.utf8, 'a12bZZe!')
      const status = await toolkit.sessionStatus(createdSessionId)
      assert.equal(status.changeCount, 3)
    } finally {
      if (createdSessionId) {
        await toolkit.destroySession(createdSessionId).catch(() => undefined)
      }
      await toolkit.stopServer().catch(() => undefined)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('round-trips every first-class primitive through change logs and undo/redo', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const inputPath = path.join(tempDir, 'input.bin')
    const replayPath = path.join(tempDir, 'replay.bin')
    fs.writeFileSync(inputPath, Buffer.from('ABCDEFGH', 'utf8'))
    fs.writeFileSync(replayPath, Buffer.from('ABCDEFGH', 'utf8'))

    const replaced = 'A12DxyZZZ'
    const transformed = Buffer.from(replaced, 'utf8').toString('base64')
    const changes: ChangeLogEntry[] = [
      {
        serial: 1,
        kind: 'INSERT',
        offset: 1,
        length: 0,
        data: Buffer.from('12', 'utf8').toString('hex'),
      },
      {
        serial: 2,
        kind: 'DELETE',
        offset: 3,
        length: 2,
        data: Buffer.from('BC', 'utf8').toString('hex'),
      },
      {
        serial: 3,
        kind: 'OVERWRITE',
        offset: 4,
        length: 2,
        data: Buffer.from('xy', 'utf8').toString('hex'),
      },
      {
        serial: 4,
        kind: 'REPLACE',
        offset: 6,
        length: 2,
        data: Buffer.from('ZZZ', 'utf8').toString('hex'),
      },
      {
        serial: 5,
        kind: 'TRANSFORM',
        offset: 0,
        length: Buffer.byteLength(replaced, 'utf8'),
        data: makeTransformDataHex('omega.example.base64'),
      },
    ]

    let sessionId = ''
    let replaySessionId = ''

    try {
      const created = await toolkit.createSession(inputPath)
      sessionId = created.sessionId

      const result = await toolkit.applyChangeLog({
        sessionId,
        changes: makeChangeLogDocument(changes, {
          before: makeUtf8Fingerprint('ABCDEFGH'),
          after: makeUtf8Fingerprint(transformed),
        }),
      })
      assert.equal(result.applied, true)
      assert.equal(result.changeCount, 5)
      assert.equal(result.inputChangeCount, 5)
      await assertToolkitText(toolkit, sessionId, transformed)

      let status = await toolkit.sessionStatus(sessionId)
      assert.equal(status.changeCount, 6)
      assert.equal(status.undoCount, 0)

      await toolkit.undo(sessionId)
      await assertToolkitText(toolkit, sessionId, replaced)
      status = await toolkit.sessionStatus(sessionId)
      assert.equal(status.changeCount, 5)
      assert.equal(status.undoCount, 1)

      await toolkit.undo(sessionId)
      await assertToolkitText(toolkit, sessionId, 'ABCDEFGH')
      status = await toolkit.sessionStatus(sessionId)
      assert.equal(status.changeCount, 0)
      assert.equal(status.undoCount, 6)

      await toolkit.redo(sessionId)
      await assertToolkitText(toolkit, sessionId, replaced)
      status = await toolkit.sessionStatus(sessionId)
      assert.equal(status.changeCount, 5)
      assert.equal(status.undoCount, 1)

      await toolkit.redo(sessionId)
      await assertToolkitText(toolkit, sessionId, transformed)
      status = await toolkit.sessionStatus(sessionId)
      assert.equal(status.changeCount, 6)
      assert.equal(status.undoCount, 0)

      const replay = await toolkit.createSession(replayPath)
      replaySessionId = replay.sessionId
      const replayResult = await toolkit.applyChangeLog({
        sessionId: replaySessionId,
        changes: makeChangeLogDocument(changes, {
          before: makeUtf8Fingerprint('ABCDEFGH'),
          after: makeUtf8Fingerprint(transformed),
        }),
      })
      assert.equal(replayResult.applied, true)
      await assertToolkitText(toolkit, replaySessionId, transformed)
    } finally {
      if (sessionId) {
        await toolkit.destroySession(sessionId).catch(() => undefined)
      }
      if (replaySessionId) {
        await toolkit.destroySession(replaySessionId).catch(() => undefined)
      }
      await toolkit.stopServer().catch(() => undefined)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('undoes and redoes each first-class change-log primitive independently', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const cases: Array<{
      name: string
      before: string
      after: string
      change: ChangeLogEntry
    }> = [
      {
        name: 'INSERT',
        before: 'ABCDEF',
        after: 'A12BCDEF',
        change: {
          kind: 'INSERT',
          offset: 1,
          length: 0,
          data: Buffer.from('12', 'utf8').toString('hex'),
        },
      },
      {
        name: 'DELETE',
        before: 'ABCDEF',
        after: 'ADEF',
        change: {
          kind: 'DELETE',
          offset: 1,
          length: 2,
          data: Buffer.from('BC', 'utf8').toString('hex'),
        },
      },
      {
        name: 'OVERWRITE',
        before: 'ABCDEF',
        after: 'ABxyEF',
        change: {
          kind: 'OVERWRITE',
          offset: 2,
          length: 2,
          data: Buffer.from('xy', 'utf8').toString('hex'),
        },
      },
      {
        name: 'REPLACE',
        before: 'ABCDEF',
        after: 'ABXYZEF',
        change: {
          kind: 'REPLACE',
          offset: 2,
          length: 2,
          data: Buffer.from('XYZ', 'utf8').toString('hex'),
        },
      },
      {
        name: 'TRANSFORM',
        before: 'ABCDEFGH',
        after: Buffer.from('ABCDEFGH', 'utf8').toString('base64'),
        change: {
          kind: 'TRANSFORM',
          offset: 0,
          length: 8,
          data: makeTransformDataHex('omega.example.base64'),
        },
      },
    ]

    const sessionIds: string[] = []

    try {
      for (const testCase of cases) {
        const inputPath = path.join(tempDir, `${testCase.name}.bin`)
        fs.writeFileSync(inputPath, Buffer.from(testCase.before, 'utf8'))
        const created = await toolkit.createSession(inputPath)
        sessionIds.push(created.sessionId)

        const result = await toolkit.applyChangeLog({
          sessionId: created.sessionId,
          changes: makeChangeLogDocument([testCase.change], {
            before: makeUtf8Fingerprint(testCase.before),
            after: makeUtf8Fingerprint(testCase.after),
          }),
        })
        assert.equal(result.applied, true, testCase.name)
        assert.equal(result.changeCount, 1, testCase.name)
        await assertToolkitText(toolkit, created.sessionId, testCase.after)

        await toolkit.undo(created.sessionId)
        await assertToolkitText(toolkit, created.sessionId, testCase.before)
        let status = await toolkit.sessionStatus(created.sessionId)
        assert.equal(status.changeCount, 0, testCase.name)
        assert.equal(
          status.undoCount,
          testCase.name === 'REPLACE' ? 2 : 1,
          testCase.name
        )

        await toolkit.redo(created.sessionId)
        await assertToolkitText(toolkit, created.sessionId, testCase.after)
        status = await toolkit.sessionStatus(created.sessionId)
        assert.equal(
          status.changeCount,
          testCase.name === 'REPLACE' ? 2 : 1,
          testCase.name
        )
        assert.equal(status.undoCount, 0, testCase.name)
      }
    } finally {
      for (const sessionId of sessionIds) {
        await toolkit.destroySession(sessionId).catch(() => undefined)
      }
      await toolkit.stopServer().catch(() => undefined)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('treats transform change-log data as the canonical descriptor', async function () {
    const toolkit = new OmegaEditToolkit({ autoStart: false })
    const transformData = makeTransformDataHex('omega.example.base64', {
      direction: 'encode',
    })

    const dryRun = await toolkit.applyChangeLog({
      sessionId: 'dry-run-session',
      dryRun: true,
      changes: makeChangeLogDocument([
        {
          serial: 1,
          kind: 'TRANSFORM',
          offset: 0,
          length: 8,
          data: transformData,
        },
      ]),
    })
    assert.equal(dryRun.applied, false)
    assert.equal(dryRun.inputChangeCount, 1)

    await assert.rejects(
      () =>
        toolkit.applyChangeLog({
          sessionId: 'dry-run-session',
          dryRun: true,
          changes: makeChangeLogDocument([
            {
              kind: 'TRANSFORM',
              offset: 0,
              length: 8,
              data: '',
            },
          ]),
        }),
      /TRANSFORM data requires data/
    )

    await assert.rejects(
      () =>
        toolkit.applyChangeLog({
          sessionId: 'dry-run-session',
          dryRun: true,
          changes: makeChangeLogDocument([
            {
              kind: 'TRANSFORM',
              offset: 0,
              length: 8,
              data: transformData,
              transformId: 'omega.example.base64',
            } as unknown as ChangeLogEntry,
          ]),
        }),
      /metadata must be carried in data/
    )

    await assert.rejects(
      () =>
        toolkit.applyChangeLog({
          sessionId: 'dry-run-session',
          dryRun: true,
          changes: makeChangeLogDocument([
            {
              kind: 'TRANSFORM',
              offset: 0,
              length: 8,
              data: transformData,
              replacementLength: 12,
            } as unknown as ChangeLogEntry,
          ]),
        }),
      /metadata must be carried in data/
    )
  })

  it('exports and replays transform change logs with first-class data', async function () {
    const port = await omegaEditClient.findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const sourcePath = path.join(tempDir, 'source.bin')
    const replayPath = path.join(tempDir, 'replay.bin')
    const changeLogPath = path.join(tempDir, 'changes.json')
    fs.writeFileSync(sourcePath, Buffer.from('ABCDEFGH', 'utf8'))
    fs.writeFileSync(replayPath, Buffer.from('ABCDEFGH', 'utf8'))

    let sourceSessionId = ''
    let replaySessionId = ''

    try {
      const source = await toolkit.createSession(sourcePath)
      sourceSessionId = source.sessionId
      await toolkit.applyTransformPlugin({
        sessionId: sourceSessionId,
        pluginId: 'omega.example.base64',
        offset: 0,
        length: 8,
      })
      await toolkit.exportChangeLog(sourceSessionId, changeLogPath, true)

      const exportedLog = JSON.parse(
        await fs.promises.readFile(changeLogPath, 'utf8')
      )
      const transformChange = exportedLog.changes.find(
        (change: ChangeLogEntry) => change.kind === 'TRANSFORM'
      )
      assert.ok(transformChange, 'expected exported transform change')
      assert.notEqual(transformChange.data, '')
      const transformDescriptor = parseTransformDataHex(transformChange.data)
      assert.equal(transformDescriptor.transformId, 'omega.example.base64')
      assert.deepEqual(transformDescriptor.args, {})
      assert.equal('transformId' in transformChange, false)
      assert.equal('optionsJson' in transformChange, false)
      assert.equal('replacementLength' in transformChange, false)
      assert.equal('computedFileSizeBefore' in transformChange, false)
      assert.equal('computedFileSizeAfter' in transformChange, false)

      const replay = await toolkit.createSession(replayPath)
      replaySessionId = replay.sessionId
      const applyResult = await toolkit.applyChangeLog({
        sessionId: replaySessionId,
        changes: exportedLog,
      })
      assert.equal(applyResult.applied, true)
      assert.equal(applyResult.changeCount, 1)

      const replayedRange = await toolkit.readRange(replaySessionId, 0, 12)
      assert.equal(replayedRange.data.utf8, 'QUJDREVGR0g=')
      const status = await toolkit.sessionStatus(replaySessionId)
      assert.equal(status.changeCount, 1)
    } finally {
      if (sourceSessionId) {
        await toolkit.destroySession(sourceSessionId).catch(() => undefined)
      }
      if (replaySessionId) {
        await toolkit.destroySession(replaySessionId).catch(() => undefined)
      }
      await toolkit.stopServer().catch(() => undefined)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
