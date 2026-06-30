import { strict as assert } from 'assert'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { findFirstAvailablePort } from '@omega-edit/client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.resolve(__dirname, '../../dist/cjs/cli.js')

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
      await runOe([
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

      const status = await runOe([
        'session-status',
        ...common,
        '--session',
        sessionId,
      ])
      assert.equal(status.computedSize, Buffer.byteLength(transformed, 'utf8'))
      assert.equal(status.undoCount, 0)
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
