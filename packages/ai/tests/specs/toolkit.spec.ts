import { strict as assert } from 'assert'
import * as fs from 'fs'
import { createServer } from 'net'
import * as os from 'os'
import * as path from 'path'
import * as omegaEditClient from '@omega-edit/client'
import { OmegaEditToolkit } from '../../src/service'
import { parseInputData } from '../../src/codec'

describe('@omega-edit/ai toolkit', function () {
  this.timeout(90000)

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
          version: 2,
          changes: [],
        })
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
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }

    const wrappedDocument = await toolkit.applyChangeLog({
      sessionId: 'session',
      dryRun: true,
      changes: {
        format: 'omega-edit.change-log',
        version: 1,
        changeCount: 0,
        sourceChangeCount: 0,
        foldedChangeCount: 0,
        changes: [],
      },
    })
    assert.equal(wrappedDocument.applied, false)
    assert.equal(wrappedDocument.changeCount, 0)

    const legacyArray = await toolkit.applyChangeLog({
      sessionId: 'session',
      dryRun: true,
      changes: [],
    })
    assert.equal(legacyArray.applied, false)
    assert.equal(legacyArray.changeCount, 0)
  })

  it('rejects inconsistent change-log serial and group metadata', async function () {
    const toolkit = new OmegaEditToolkit({ autoStart: false })

    await assert.rejects(
      () =>
        toolkit.applyChangeLog({
          sessionId: 'session',
          dryRun: true,
          changes: [
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
          ],
        }),
      /serial metadata must be contiguous/
    )

    await assert.rejects(
      () =>
        toolkit.applyChangeLog({
          sessionId: 'session',
          dryRun: true,
          changes: [
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
          ],
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
      assert.equal(exportedLog.version, 1)
      assert.equal(exportedLog.changeCount, 1)
      assert.equal(exportedLog.sourceChangeCount, 1)
      assert.equal(exportedLog.foldedChangeCount, 0)
      assert.equal(exportedLog.changes[0].kind, 'OVERWRITE')
      assert.equal(fs.existsSync(changeLogPath), true)
      const changeLogDocument = JSON.parse(
        await fs.promises.readFile(changeLogPath, 'utf8')
      )
      assert.equal(changeLogDocument.format, 'omega-edit.change-log')
      assert.equal(changeLogDocument.version, 1)
      assert.equal(changeLogDocument.changeCount, 1)
      assert.equal(changeLogDocument.sourceChangeCount, 1)
      assert.equal(changeLogDocument.foldedChangeCount, 0)
      assert.equal(changeLogDocument.changes[0].kind, 'OVERWRITE')

      await fs.promises.writeFile(replayPath, Buffer.from('abcdef', 'utf8'))
      const replaySession = await toolkit.createSession(replayPath)
      try {
        const appliedLog = await toolkit.applyChangeLog({
          sessionId: replaySession.sessionId,
          inputPath: changeLogPath,
        })
        assert.equal(appliedLog.applied, true)
        assert.equal(appliedLog.changeCount, 1)
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
})
