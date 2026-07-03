import { strict as assert } from 'assert'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { findFirstAvailablePort } from '@omega-edit/client'
import {
  assertAssistantCommandSurface,
  assertAssistantContextPayloadBudget,
} from './assistantCommandSurface'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.resolve(__dirname, '../../dist/cjs/cli.js')

function makeTransformDataHex(
  transformId: string,
  args: Record<string, unknown> = {}
) {
  return Buffer.from(JSON.stringify({ transformId, args }), 'utf8').toString(
    'hex'
  )
}

function runOe(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: {
        ...process.env,
        OMEGA_EDIT_CLIENT_LOG_LEVEL: 'fatal',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`oe ${args.join(' ')} timed out`))
    }, 30_000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(
          new Error(
            `oe ${args.join(' ')} exited ${code}: ${stderr || stdout}`.trim()
          )
        )
        return
      }

      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        reject(
          new Error(
            `oe ${args.join(' ')} did not return JSON: ${message}; stdout=${stdout}; stderr=${stderr}`
          )
        )
      }
    })
  })
}

describe('@omega-edit/ai CLI', () => {
  it('lets an AI agent drive OmegaEdit as a JSON command-line skill', async function () {
    const port = await findFirstAvailablePort(21000, 21999)
    assert.ok(port, 'expected an available port for CLI test')

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-cli-'))
    const inputPath = path.join(tempDir, 'agent.bin')
    const changeLogPath = path.join(tempDir, 'agent-change-log.json')
    fs.writeFileSync(inputPath, Buffer.from('ABCDEFGH', 'utf8'))

    const common = ['--port', String(port)]
    let sessionId = ''

    try {
      const created = await runOe([
        'create-session',
        ...common,
        '--file',
        inputPath,
      ])
      sessionId = created.sessionId as string
      assert.ok(sessionId.length > 0)

      const readInitial = await runOe([
        'view',
        ...common,
        '--session',
        sessionId,
        '--offset',
        '0',
        '--length',
        '8',
      ])
      assert.equal(
        ((readInitial.data as Record<string, unknown>).utf8 as string) || '',
        'ABCDEFGH'
      )

      await runOe([
        'patch',
        ...common,
        '--session',
        sessionId,
        '--operation',
        'insert',
        '--offset',
        '1',
        '--text',
        '12',
      ])
      await runOe([
        'patch',
        ...common,
        '--session',
        sessionId,
        '--operation',
        'delete',
        '--offset',
        '3',
        '--delete-length',
        '2',
      ])
      await runOe([
        'patch',
        ...common,
        '--session',
        sessionId,
        '--operation',
        'overwrite',
        '--offset',
        '4',
        '--text',
        'xy',
      ])
      await runOe([
        'patch',
        ...common,
        '--session',
        sessionId,
        '--operation',
        'replace',
        '--offset',
        '6',
        '--delete-length',
        '2',
        '--text',
        'ZZZ',
      ])

      const replaced = 'A12DxyZZZ'
      const transformResult = await runOe([
        'apply-transform-plugin',
        ...common,
        '--session',
        sessionId,
        '--plugin',
        'omega.example.base64',
        '--offset',
        '0',
        '--length',
        String(Buffer.byteLength(replaced, 'utf8')),
      ])
      assert.equal(transformResult.contentChanged, true)
      assert.ok((transformResult.serial as number) > 0)
      assert.deepEqual(transformResult.transformDescriptor, {
        transformId: 'omega.example.base64',
        args: {},
        json: JSON.stringify({ transformId: 'omega.example.base64', args: {} }),
        dataHex: makeTransformDataHex('omega.example.base64'),
      })
      const transformed = Buffer.from(replaced, 'utf8').toString('base64')

      const readTransformed = await runOe([
        'view',
        ...common,
        '--session',
        sessionId,
        '--offset',
        '0',
        '--length',
        String(Buffer.byteLength(transformed, 'utf8')),
      ])
      assert.equal(
        ((readTransformed.data as Record<string, unknown>).utf8 as string) ||
          '',
        transformed
      )

      await runOe(['undo', ...common, '--session', sessionId])
      const readUndo = await runOe([
        'view',
        ...common,
        '--session',
        sessionId,
        '--offset',
        '0',
        '--length',
        String(Buffer.byteLength(replaced, 'utf8')),
      ])
      assert.equal(
        ((readUndo.data as Record<string, unknown>).utf8 as string) || '',
        replaced
      )

      await runOe(['redo', ...common, '--session', sessionId])
      const exported = await runOe([
        'export-change-log',
        ...common,
        '--session',
        sessionId,
        '--output',
        changeLogPath,
        '--overwrite',
      ])
      assert.equal(exported.format, 'omega-edit.change-log')
      assert.equal(exported.complete, true)
      assert.equal(fs.existsSync(changeLogPath), true)

      const preview = await runOe([
        'preview-change-log',
        ...common,
        '--session',
        sessionId,
        '--input',
        changeLogPath,
      ])
      assert.equal(preview.format, 'omega-edit.change-log')
      assert.equal(
        (preview.primitiveCounts as Record<string, unknown>).transform,
        1
      )
      assert.equal(
        (preview.transformDescriptors as Array<Record<string, unknown>>)[0]
          .descriptorSource,
        'data'
      )
      assert.equal(preview.canApply, false)
      assert.ok(
        (preview.safetyIssues as Array<Record<string, unknown>>).some(
          (issue) => issue.code === 'before-fingerprint-mismatch'
        )
      )

      const status = await runOe([
        'session-status',
        ...common,
        '--session',
        sessionId,
      ])
      assert.equal(status.computedSize, Buffer.byteLength(transformed, 'utf8'))
      assert.equal(status.undoCount, 0)
      assert.equal(status.undoStackDepth, status.changeCount)
      assert.equal(status.redoStackDepth, status.undoCount)

      const context = await runOe([
        'session-context',
        ...common,
        '--session',
        sessionId,
        '--file',
        inputPath,
      ])
      assert.equal(context.version, 1)
      assert.equal((context.session as Record<string, unknown>).id, sessionId)
      assert.equal(
        (context.session as Record<string, unknown>).filePath,
        inputPath
      )
      assert.equal(
        (context.sizes as Record<string, unknown>).computed,
        Buffer.byteLength(transformed, 'utf8')
      )
      assert.equal(
        (context.history as Record<string, unknown>).undoCount,
        status.changeCount
      )
      assert.equal((context.history as Record<string, unknown>).redoCount, 0)
      assert.equal(
        (context.history as Record<string, unknown>).undoStackDepth,
        status.changeCount
      )
      assert.equal(
        (context.history as Record<string, unknown>).redoStackDepth,
        status.undoCount
      )
      assert.equal(context.selection, null)
      assertAssistantCommandSurface(context.commands)
      assertAssistantContextPayloadBudget(context)

      await runOe(['undo', ...common, '--session', sessionId])
      const undoneStatus = await runOe([
        'session-status',
        ...common,
        '--session',
        sessionId,
      ])
      assert.equal(undoneStatus.undoStackDepth, undoneStatus.changeCount)
      assert.equal(undoneStatus.redoStackDepth, undoneStatus.undoCount)
      assert.ok(
        (undoneStatus.redoStackDepth as number) > 0,
        'undo should expose redo stack depth'
      )

      const undoneContext = await runOe([
        'session-context',
        ...common,
        '--session',
        sessionId,
        '--file',
        inputPath,
      ])
      assert.equal(
        (undoneContext.history as Record<string, unknown>).undoCount,
        undoneStatus.changeCount
      )
      assert.equal(
        (undoneContext.history as Record<string, unknown>).redoCount,
        undoneStatus.undoCount
      )
      assert.equal(
        (undoneContext.history as Record<string, unknown>).undoStackDepth,
        undoneStatus.changeCount
      )
      assert.equal(
        (undoneContext.history as Record<string, unknown>).redoStackDepth,
        undoneStatus.undoCount
      )
      assertAssistantContextPayloadBudget(undoneContext)
    } finally {
      if (sessionId) {
        await runOe([
          'destroy-session',
          ...common,
          '--session',
          sessionId,
        ]).catch(() => undefined)
      }
      await runOe(['server-stop', ...common]).catch(() => undefined)
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
