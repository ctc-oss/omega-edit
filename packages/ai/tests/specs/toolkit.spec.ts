import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { findFirstAvailablePort } from '@omega-edit/client'
import { OmegaEditToolkit } from '../../src/service'
import { parseInputData } from '../../src/codec'

describe('@omega-edit/ai toolkit', function () {
  this.timeout(90000)

  it('supports bounded reads, search, preview, patching, and undo/redo', async function () {
    const port = await findFirstAvailablePort(19000, 19999)
    assert.ok(port, 'expected an available port for OmegaEdit')

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-ai-'))
    const inputPath = path.join(tempDir, 'input.bin')
    const outputPath = path.join(tempDir, 'output.bin')

    fs.writeFileSync(inputPath, Buffer.from('abcdef', 'utf8'))

    let createdSessionId = ''

    try {
      const created = await toolkit.createSession(inputPath)
      createdSessionId = created.sessionId
      assert.ok(createdSessionId.length > 0)

      const initialRange = await toolkit.readRange(createdSessionId, 0, 6)
      assert.equal(initialRange.actualLength, 6)
      assert.equal(initialRange.data.utf8, 'abcdef')

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

      const status = await toolkit.sessionStatus(createdSessionId)
      assert.equal(status.changeCount, 1)
      assert.equal(status.undoCount, 0)

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
    } finally {
      if (createdSessionId) {
        await toolkit.destroySession(createdSessionId)
      }
      await toolkit.stopServer()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
