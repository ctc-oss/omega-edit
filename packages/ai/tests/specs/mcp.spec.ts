import { strict as assert } from 'assert'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as readline from 'readline'
import { fileURLToPath } from 'url'
import { findFirstAvailablePort, getSessionCount } from '@omega-edit/client'
import { OmegaEditToolkit } from '../../src/service'
import {
  assertAssistantCommandSurface,
  assertAssistantContextPayloadBudget,
} from './assistantCommandSurface'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type PendingMap = Map<
  number,
  {
    resolve: (value: Record<string, unknown>) => void
    reject: (reason: Error) => void
  }
>

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

function canonicalizeTransformDescriptorValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeTransformDescriptorValue)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((canonical, key) => {
      canonical[key] = canonicalizeTransformDescriptorValue(
        (value as Record<string, unknown>)[key]
      )
      return canonical
    }, {})
}

function makeTransformDataHex(
  transformId: string,
  args: Record<string, unknown> = {}
) {
  return Buffer.from(
    JSON.stringify({
      transformId,
      args: canonicalizeTransformDescriptorValue(args),
    }),
    'utf8'
  ).toString('hex')
}

describe('@omega-edit/ai mcp server', () => {
  it('wires MCP cancellation notifications to tool abort signals', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/mcp.ts'),
      'utf8'
    )

    assert.match(
      source,
      /activeToolRequests = new Map<unknown, AbortController>/
    )
    assert.match(source, /method === 'notifications\/cancelled'/)
    assert.match(
      source,
      /activeToolRequests\.get\(params\.requestId\)\?\.abort\(\)/
    )
    assert.match(
      source,
      /tool\.run\(argumentsObject, abortController\.signal\)/
    )
  })

  it('serves OmegaEdit operations over MCP stdio', async function () {
    const port = await findFirstAvailablePort(20000, 20999)
    assert.ok(port, 'expected an available port for MCP test')

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-mcp-'))
    const inputPath = path.join(tempDir, 'input.bin')
    fs.writeFileSync(inputPath, Buffer.from('hello world hello', 'utf8'))

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
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_profile_range'),
        'expected omega_edit_profile_range in tool list'
      )
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_replace_session'),
        'expected omega_edit_replace_session in tool list'
      )
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_list_transform_plugins'),
        'expected omega_edit_list_transform_plugins in tool list'
      )
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_apply_transform_plugin'),
        'expected omega_edit_apply_transform_plugin in tool list'
      )
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_create_checkpoint'),
        'expected omega_edit_create_checkpoint in tool list'
      )
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_rollback_checkpoint'),
        'expected omega_edit_rollback_checkpoint in tool list'
      )
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_export_change_log'),
        'expected omega_edit_export_change_log in tool list'
      )
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_preview_change_log'),
        'expected omega_edit_preview_change_log in tool list'
      )
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_apply_change_log'),
        'expected omega_edit_apply_change_log in tool list'
      )
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_session_context'),
        'expected omega_edit_session_context in tool list'
      )
      assert.ok(
        tools.some((tool) => tool.name === 'omega_edit_run_file'),
        'expected omega_edit_run_file in tool list'
      )

      await toolkit.startServer()
      const sessionCountBeforeOneShot = await getSessionCount()
      const shorthandResponse = await sendRequest('tools/call', {
        name: 'omega_edit_run_file',
        arguments: {
          filePath: inputPath,
          tool: 'omega_edit_read_range',
          arguments: { offset: 0, length: 5 },
        },
      })
      const shorthandStructured = (
        shorthandResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>
      assert.equal(shorthandStructured.ephemeral, true)
      assert.equal(shorthandStructured.mutated, false)
      assert.equal(shorthandStructured.persisted, false)
      const shorthandOperations = shorthandStructured.operations as Array<
        Record<string, unknown>
      >
      assert.equal(
        ((
          (shorthandOperations[0].result as Record<string, unknown>)
            .data as Record<string, unknown>
        ).utf8 as string) || '',
        'hello'
      )
      assert.equal(await getSessionCount(), sessionCountBeforeOneShot)

      const oneShotOutputPath = path.join(tempDir, 'one-shot-output.bin')
      const oneShotResponse = await sendRequest('tools/call', {
        name: 'omega_edit_run_file',
        arguments: {
          filePath: inputPath,
          outputPath: oneShotOutputPath,
          operations: [
            {
              tool: 'omega_edit_read_range',
              arguments: { offset: 0, length: 5 },
            },
            {
              tool: 'omega_edit_apply_patch',
              arguments: {
                offset: 6,
                operation: 'overwrite',
                text: 'Omega',
              },
            },
            {
              tool: 'omega_edit_read_range',
              arguments: { offset: 0, length: 17 },
            },
          ],
        },
      })
      const oneShotStructured = (
        oneShotResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>
      assert.equal(oneShotStructured.ephemeral, true)
      assert.equal(oneShotStructured.mutated, true)
      assert.equal(oneShotStructured.persisted, true)
      assert.doesNotMatch(JSON.stringify(oneShotStructured), /sessionId/)
      assert.equal(fs.readFileSync(inputPath, 'utf8'), 'hello world hello')
      assert.equal(
        fs.readFileSync(oneShotOutputPath, 'utf8'),
        'hello Omega hello'
      )
      assert.equal(await getSessionCount(), sessionCountBeforeOneShot)

      const missingOutputResponse = await sendRequest('tools/call', {
        name: 'omega_edit_run_file',
        arguments: {
          filePath: inputPath,
          operations: [
            {
              tool: 'omega_edit_apply_patch',
              arguments: { offset: 0, operation: 'overwrite', text: 'H' },
            },
          ],
        },
      })
      const missingOutputResult = missingOutputResponse.result as Record<
        string,
        unknown
      >
      assert.equal(missingOutputResult.isError, true)
      assert.match(
        ((missingOutputResult.structuredContent as Record<string, unknown>)
          .error as string) || '',
        /outputPath is required/
      )
      assert.equal(await getSessionCount(), sessionCountBeforeOneShot)

      const discardedResponse = await sendRequest('tools/call', {
        name: 'omega_edit_run_file',
        arguments: {
          filePath: inputPath,
          discardChanges: true,
          operations: [
            {
              tool: 'omega_edit_apply_patch',
              arguments: {
                offset: 6,
                operation: 'overwrite',
                text: 'Omega',
              },
            },
            {
              tool: 'omega_edit_read_range',
              arguments: { offset: 0, length: 17 },
            },
          ],
        },
      })
      const discardedStructured = (
        discardedResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>
      assert.equal(discardedStructured.mutated, true)
      assert.equal(discardedStructured.persisted, false)
      assert.equal(discardedStructured.discarded, true)
      const discardedOperations = discardedStructured.operations as Array<
        Record<string, unknown>
      >
      assert.equal(
        ((
          (discardedOperations[1].result as Record<string, unknown>)
            .data as Record<string, unknown>
        ).utf8 as string) || '',
        'hello Omega hello'
      )
      assert.equal(fs.readFileSync(inputPath, 'utf8'), 'hello world hello')
      assert.equal(await getSessionCount(), sessionCountBeforeOneShot)

      const failedOneShotResponse = await sendRequest('tools/call', {
        name: 'omega_edit_run_file',
        arguments: {
          filePath: inputPath,
          operations: [
            {
              tool: 'omega_edit_read_range',
              arguments: { offset: 1000, length: 1 },
            },
          ],
        },
      })
      const failedOneShotResult = failedOneShotResponse.result as Record<
        string,
        unknown
      >
      assert.equal(failedOneShotResult.isError, true)
      assert.equal(await getSessionCount(), sessionCountBeforeOneShot)

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

      const sessionContextResponse = await sendRequest('tools/call', {
        name: 'omega_edit_session_context',
        arguments: {
          sessionId: createdSessionId,
          filePath: inputPath,
        },
      })
      const sessionContextStructured =
        ((sessionContextResponse.result as Record<string, unknown>)
          .structuredContent as Record<string, unknown>) || {}
      assert.equal(sessionContextStructured.version, 1)
      assert.equal(
        (sessionContextStructured.session as Record<string, unknown>).id,
        createdSessionId
      )
      assert.equal(
        (sessionContextStructured.session as Record<string, unknown>).filePath,
        inputPath
      )
      assert.equal(
        (sessionContextStructured.sizes as Record<string, unknown>).computed,
        Buffer.byteLength('hello world hello', 'utf8')
      )
      assertAssistantCommandSurface(sessionContextStructured.commands)
      assert.equal(
        (sessionContextStructured.history as Record<string, unknown>)
          .undoStackDepth,
        (sessionContextStructured.history as Record<string, unknown>).undoCount
      )
      assert.equal(
        (sessionContextStructured.history as Record<string, unknown>)
          .redoStackDepth,
        (sessionContextStructured.history as Record<string, unknown>).redoCount
      )
      assertAssistantContextPayloadBudget(sessionContextStructured)

      const listPluginsResponse = await sendRequest('tools/call', {
        name: 'omega_edit_list_transform_plugins',
        arguments: {},
      })
      const listPluginsStructured = ((
        listPluginsResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>) || { plugins: [] }
      assert.ok(Array.isArray(listPluginsStructured.plugins))

      const currentFingerprint = makeUtf8Fingerprint('hello world hello')
      const previewChangeLogResponse = await sendRequest('tools/call', {
        name: 'omega_edit_preview_change_log',
        arguments: {
          sessionId: createdSessionId,
          changeLog: {
            format: 'omega-edit.change-log',
            version: 2,
            complete: true,
            before: currentFingerprint,
            after: currentFingerprint,
            changeCount: 0,
            sourceChangeCount: 0,
            unavailableChangeCount: 0,
            unavailableChangeSerials: [],
            changes: [],
          },
        },
      })
      const previewChangeLogStructured = ((
        previewChangeLogResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>) || { canApply: false }
      assert.equal(
        (previewChangeLogResponse.result as Record<string, unknown>).isError,
        false,
        JSON.stringify(previewChangeLogResponse.result)
      )
      assert.equal(previewChangeLogStructured.canApply, true)
      assert.equal(
        ((previewChangeLogStructured.primitiveCounts as Record<string, unknown>)
          .total as number) || 0,
        0
      )

      const missingPluginResponse = await sendRequest('tools/call', {
        name: 'omega_edit_apply_transform_plugin',
        arguments: {
          sessionId: createdSessionId,
          pluginId: 'omega.example.missing',
        },
      })
      const missingPluginResult =
        (missingPluginResponse.result as Record<string, unknown>) || {}
      assert.equal(missingPluginResult.isError, true)
      assert.match(
        ((missingPluginResult.structuredContent as Record<string, unknown>)
          .error as string) || '',
        /omega\.example\.missing/
      )

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

      const profileRangeResponse = await sendRequest('tools/call', {
        name: 'omega_edit_profile_range',
        arguments: {
          sessionId: createdSessionId,
          offset: 0,
          length: 5,
        },
      })
      const profileStructured = ((
        profileRangeResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>) || { totalBytes: 0 }
      assert.equal((profileStructured.totalBytes as number) || 0, 5)
      assert.ok(Array.isArray(profileStructured.topBytes))

      const transformResponse = await sendRequest('tools/call', {
        name: 'omega_edit_apply_transform_plugin',
        arguments: {
          sessionId: createdSessionId,
          pluginId: 'omega.example.common_checksums',
          offset: 0,
          length: 5,
          optionsJson: JSON.stringify({ algorithm: 'sum8' }),
        },
      })
      const transformStructured = ((
        transformResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>) || {
        transformDescriptor: {},
      }
      assert.equal(transformStructured.contentChanged, false)
      assert.equal(transformStructured.serial, undefined)
      assert.deepEqual(transformStructured.transformDescriptor, {
        transformId: 'omega.example.common_checksums',
        args: { algorithm: 'sum8' },
        json: JSON.stringify({
          transformId: 'omega.example.common_checksums',
          args: { algorithm: 'sum8' },
        }),
        dataHex: makeTransformDataHex('omega.example.common_checksums', {
          algorithm: 'sum8',
        }),
      })

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

      const replaceResponse = await sendRequest('tools/call', {
        name: 'omega_edit_replace_session',
        arguments: {
          sessionId: createdSessionId,
          patternText: 'hello',
          replacementText: 'hi',
        },
      })
      const replaceStructured = ((
        replaceResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>) || {
        replacedCount: 0,
      }
      assert.equal((replaceStructured.replacedCount as number) || 0, 2)

      const replacedRangeResponse = await sendRequest('tools/call', {
        name: 'omega_edit_read_range',
        arguments: {
          sessionId: createdSessionId,
          offset: 0,
          length: 11,
        },
      })
      const replacedStructured = ((
        replacedRangeResponse.result as Record<string, unknown>
      ).structuredContent as Record<string, unknown>) || {
        data: { utf8: '' },
      }
      assert.equal(
        ((replacedStructured.data as Record<string, unknown>).utf8 as string) ||
          '',
        'hi world hi'
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
