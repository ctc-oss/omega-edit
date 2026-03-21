import { strict as assert } from 'assert'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as readline from 'readline'
import { findFirstAvailablePort } from '@omega-edit/client'
import { OmegaEditToolkit } from '../../src/service'

type PendingMap = Map<
  number,
  {
    resolve: (value: Record<string, unknown>) => void
    reject: (reason: Error) => void
  }
>

describe('@omega-edit/ai mcp server', function () {
  this.timeout(90000)

  it('serves OmegaEdit operations over MCP stdio', async function () {
    const port = await findFirstAvailablePort(20000, 20999)
    assert.ok(port, 'expected an available port for MCP test')

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-mcp-'))
    const inputPath = path.join(tempDir, 'input.bin')
    fs.writeFileSync(inputPath, Buffer.from('hello world', 'utf8'))

    const toolkit = new OmegaEditToolkit({ port: port!, autoStart: true })
    const child = spawn(
      process.execPath,
      [
        path.resolve(__dirname, '../../dist/cjs/mcp.js'),
        '--port',
        String(port),
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )

    const pending: PendingMap = new Map()
    let requestId = 0

    const stdoutReader = readline.createInterface({
      input: child.stdout!,
      crlfDelay: Infinity,
    })

    const stderrLines: string[] = []
    const stderrReader = readline.createInterface({
      input: child.stderr!,
      crlfDelay: Infinity,
    })

    stderrReader.on('line', (line) => {
      stderrLines.push(line)
    })

    stdoutReader.on('line', (line) => {
      const message = JSON.parse(line) as Record<string, unknown>
      const id = message.id
      if (typeof id === 'number' && pending.has(id)) {
        pending.get(id)!.resolve(message)
        pending.delete(id)
      }
    })

    const sendRequest = (
      method: string,
      params?: Record<string, unknown>
    ): Promise<Record<string, unknown>> => {
      requestId += 1
      const id = requestId
      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      return new Promise<Record<string, unknown>>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        child.stdin!.write(`${JSON.stringify(message)}\n`)
      })
    }

    const sendNotification = (
      method: string,
      params?: Record<string, unknown>
    ): void => {
      child.stdin!.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method,
          params,
        })}\n`
      )
    }

    let createdSessionId = ''

    try {
      const initializeResponse = await sendRequest('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      })
      assert.equal(
        (initializeResponse.result as Record<string, unknown>).protocolVersion,
        '2025-11-25'
      )

      sendNotification('notifications/initialized')

      const toolsResponse = await sendRequest('tools/list')
      const tools = (toolsResponse.result as Record<string, unknown>)
        .tools as Array<Record<string, unknown>>
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_read_range'),
        'expected omega_edit_read_range in tool list'
      )

      const createSessionResponse = await sendRequest('tools/call', {
        name: 'omega_edit_create_session',
        arguments: {
          filePath: inputPath,
        },
      })
      const createStructured = ((
        createSessionResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>) || { sessionId: '' }
      createdSessionId = createStructured.sessionId as string
      assert.ok(createdSessionId.length > 0)

      const readRangeResponse = await sendRequest('tools/call', {
        name: 'omega_edit_read_range',
        arguments: {
          sessionId: createdSessionId,
          offset: 0,
          length: 5,
        },
      })
      const readStructured = ((
        readRangeResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>) || { data: { utf8: '' } }

      assert.equal(
        ((readStructured.data as Record<string, unknown>).utf8 as string) || '',
        'hello'
      )

      const previewPatchResponse = await sendRequest('tools/call', {
        name: 'omega_edit_preview_patch',
        arguments: {
          sessionId: createdSessionId,
          offset: 6,
          operation: 'insert',
          text: 'OmegaEdit',
        },
      })
      const previewStructured = ((
        previewPatchResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>) || {
        targetAfter: { utf8: '' },
      }
      assert.equal(
        ((previewStructured.targetAfter as Record<string, unknown>)
          .utf8 as string) || '',
        'OmegaEdit'
      )
    } finally {
      if (createdSessionId) {
        await toolkit.destroySession(createdSessionId)
      }
      await toolkit.stopServer().catch(() => undefined)

      for (const { reject } of pending.values()) {
        reject(new Error('MCP server terminated before responding'))
      }

      child.kill()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    assert.ok(stderrLines.every((line) => typeof line === 'string'))
  })
})
