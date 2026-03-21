#!/usr/bin/env node

import { parseArgs } from 'node:util'
import * as readline from 'readline'
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_PREVIEW_CONTEXT_BYTES,
  DEFAULT_PROTOCOL_VERSION,
  TOOLING_VERSION,
} from './constants'
import { OmegaEditToolkit } from './service'
import { parseInputData } from './codec'
import { InputEncoding, PatchKind } from './types'

type JsonObject = Record<string, unknown>

interface JsonRpcRequest extends JsonObject {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

interface ToolDefinition {
  name: string
  description: string
  inputSchema: JsonObject
  outputSchema?: JsonObject
  run: (argumentsObject: JsonObject) => Promise<object>
}

function sendMessage(message: JsonObject): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function makeErrorResponse(
  id: unknown,
  code: number,
  message: string
): JsonObject {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  }
}

function makeResult(id: unknown, result: JsonObject): JsonObject {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as JsonObject
}

function getString(
  object: JsonObject,
  key: string,
  required: boolean = false
): string | undefined {
  const value = object[key]
  if (value === undefined || value === null) {
    if (required) throw new Error(`${key} is required`)
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`)
  }
  return value
}

function getBoolean(object: JsonObject, key: string): boolean | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`)
  }
  return value
}

function getNumber(
  object: JsonObject,
  key: string,
  required: boolean = false,
  defaultValue?: number
): number {
  const value = object[key]
  if (value === undefined || value === null) {
    if (defaultValue !== undefined) return defaultValue
    if (required) throw new Error(`${key} is required`)
    return 0
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`${key} must be a non-negative integer`)
  }
  return value
}

function getInputValue(argumentsObject: JsonObject): {
  data?: Uint8Array
  inputEncoding?: InputEncoding
} {
  const encodings = [
    argumentsObject.text !== undefined ? 'utf8' : undefined,
    argumentsObject.hex !== undefined ? 'hex' : undefined,
    argumentsObject.base64 !== undefined ? 'base64' : undefined,
  ].filter((value): value is InputEncoding => value !== undefined)

  if (encodings.length > 1) {
    throw new Error('Provide only one of text, hex, or base64')
  }

  if (encodings.length === 0) {
    return {}
  }

  const inputEncoding = encodings[0]
  const value =
    inputEncoding === 'utf8'
      ? getString(argumentsObject, 'text', true)
      : inputEncoding === 'hex'
        ? getString(argumentsObject, 'hex', true)
        : getString(argumentsObject, 'base64', true)

  return {
    data: parseInputData(value!, inputEncoding),
    inputEncoding,
  }
}

function inferPatchKind(
  explicitKind: string | undefined,
  dataLength: number,
  deleteLength: number
): PatchKind {
  if (explicitKind) {
    if (
      explicitKind === 'insert' ||
      explicitKind === 'overwrite' ||
      explicitKind === 'delete' ||
      explicitKind === 'replace'
    ) {
      return explicitKind
    }
    throw new Error('operation must be insert, overwrite, delete, or replace')
  }

  if (deleteLength > 0 && dataLength > 0) return 'replace'
  if (deleteLength > 0) return 'delete'
  if (dataLength > 0) return 'overwrite'

  throw new Error(
    'Unable to infer operation; provide operation, patch data, or deleteLength'
  )
}

function toolResult(data: object, isError: boolean = false): JsonObject {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data as JsonObject,
    isError,
  }
}

function buildTools(toolkit: OmegaEditToolkit): ToolDefinition[] {
  return [
    {
      name: 'omega_edit_create_session',
      description:
        'Create an OmegaEdit session, optionally backed by an existing file.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          sessionId: { type: 'string' },
          checkpointDirectory: { type: 'string' },
        },
      },
      run: async (argumentsObject) => {
        return await toolkit.createSession(
          getString(argumentsObject, 'filePath') || '',
          getString(argumentsObject, 'sessionId') || '',
          getString(argumentsObject, 'checkpointDirectory') || ''
        )
      },
    },
    {
      name: 'omega_edit_destroy_session',
      description: 'Destroy an OmegaEdit session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
      run: async (argumentsObject) => {
        return await toolkit.destroySession(
          getString(argumentsObject, 'sessionId', true)!
        )
      },
    },
    {
      name: 'omega_edit_session_status',
      description:
        'Get session size, change counts, viewport count, and last-change metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
      run: async (argumentsObject) => {
        return await toolkit.sessionStatus(
          getString(argumentsObject, 'sessionId', true)!
        )
      },
    },
    {
      name: 'omega_edit_read_range',
      description:
        'Read a bounded byte range from a session without loading the entire file.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          offset: { type: 'integer' },
          length: { type: 'integer' },
        },
        required: ['sessionId', 'offset', 'length'],
      },
      run: async (argumentsObject) => {
        return await toolkit.readRange(
          getString(argumentsObject, 'sessionId', true)!,
          getNumber(argumentsObject, 'offset', true),
          getNumber(argumentsObject, 'length', true)
        )
      },
    },
    {
      name: 'omega_edit_search',
      description:
        'Search for text or bytes in a bounded session range and return matching offsets.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          text: { type: 'string' },
          hex: { type: 'string' },
          base64: { type: 'string' },
          offset: { type: 'integer' },
          length: { type: 'integer' },
          limit: { type: 'integer' },
          caseInsensitive: { type: 'boolean' },
          reverse: { type: 'boolean' },
        },
        required: ['sessionId'],
      },
      run: async (argumentsObject) => {
        const { data, inputEncoding } = getInputValue(argumentsObject)
        if (!data) {
          throw new Error('Search requires one of text, hex, or base64')
        }

        return await toolkit.search({
          sessionId: getString(argumentsObject, 'sessionId', true)!,
          pattern: data,
          inputEncoding,
          offset: getNumber(argumentsObject, 'offset', false, 0),
          length: getNumber(argumentsObject, 'length', false, 0),
          limit: getNumber(argumentsObject, 'limit', false, 100),
          caseInsensitive:
            getBoolean(argumentsObject, 'caseInsensitive') || false,
          reverse: getBoolean(argumentsObject, 'reverse') || false,
        })
      },
    },
    {
      name: 'omega_edit_preview_patch',
      description:
        'Preview an insert, overwrite, delete, or replace operation before applying it.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          offset: { type: 'integer' },
          operation: { type: 'string' },
          deleteLength: { type: 'integer' },
          previewContext: { type: 'integer' },
          text: { type: 'string' },
          hex: { type: 'string' },
          base64: { type: 'string' },
        },
        required: ['sessionId', 'offset'],
      },
      run: async (argumentsObject) => {
        const { data } = getInputValue(argumentsObject)
        const deleteLength = getNumber(
          argumentsObject,
          'deleteLength',
          false,
          0
        )
        return await toolkit.previewPatch({
          sessionId: getString(argumentsObject, 'sessionId', true)!,
          kind: inferPatchKind(
            getString(argumentsObject, 'operation'),
            data?.length || 0,
            deleteLength
          ),
          offset: getNumber(argumentsObject, 'offset', true),
          removeLength: deleteLength,
          data,
          previewContext: getNumber(
            argumentsObject,
            'previewContext',
            false,
            DEFAULT_PREVIEW_CONTEXT_BYTES
          ),
        })
      },
    },
    {
      name: 'omega_edit_apply_patch',
      description:
        'Apply a reversible insert, overwrite, delete, or replace operation to a session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          offset: { type: 'integer' },
          operation: { type: 'string' },
          deleteLength: { type: 'integer' },
          previewContext: { type: 'integer' },
          text: { type: 'string' },
          hex: { type: 'string' },
          base64: { type: 'string' },
        },
        required: ['sessionId', 'offset'],
      },
      run: async (argumentsObject) => {
        const { data } = getInputValue(argumentsObject)
        const deleteLength = getNumber(
          argumentsObject,
          'deleteLength',
          false,
          0
        )
        return await toolkit.applyPatch({
          sessionId: getString(argumentsObject, 'sessionId', true)!,
          kind: inferPatchKind(
            getString(argumentsObject, 'operation'),
            data?.length || 0,
            deleteLength
          ),
          offset: getNumber(argumentsObject, 'offset', true),
          removeLength: deleteLength,
          data,
          previewContext: getNumber(
            argumentsObject,
            'previewContext',
            false,
            DEFAULT_PREVIEW_CONTEXT_BYTES
          ),
        })
      },
    },
    {
      name: 'omega_edit_undo',
      description: 'Undo the last change in a session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
      run: async (argumentsObject) => {
        return await toolkit.undo(
          getString(argumentsObject, 'sessionId', true)!
        )
      },
    },
    {
      name: 'omega_edit_redo',
      description: 'Redo the last undone change in a session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
      run: async (argumentsObject) => {
        return await toolkit.redo(
          getString(argumentsObject, 'sessionId', true)!
        )
      },
    },
    {
      name: 'omega_edit_save_session',
      description: 'Save the current session content to a file.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          outputPath: { type: 'string' },
          overwriteExisting: { type: 'boolean' },
        },
        required: ['sessionId', 'outputPath'],
      },
      run: async (argumentsObject) => {
        return await toolkit.saveSession(
          getString(argumentsObject, 'sessionId', true)!,
          getString(argumentsObject, 'outputPath', true)!,
          getBoolean(argumentsObject, 'overwriteExisting') || false
        )
      },
    },
    {
      name: 'omega_edit_export_range',
      description: 'Save a bounded session range to a file.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          offset: { type: 'integer' },
          length: { type: 'integer' },
          outputPath: { type: 'string' },
          overwriteExisting: { type: 'boolean' },
        },
        required: ['sessionId', 'offset', 'length', 'outputPath'],
      },
      run: async (argumentsObject) => {
        return await toolkit.exportRange(
          getString(argumentsObject, 'sessionId', true)!,
          getNumber(argumentsObject, 'offset', true),
          getNumber(argumentsObject, 'length', true),
          getString(argumentsObject, 'outputPath', true)!,
          getBoolean(argumentsObject, 'overwriteExisting') || false
        )
      },
    },
    {
      name: 'omega_edit_server_info',
      description: 'Get OmegaEdit server metadata.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      run: async () => {
        return await toolkit.serverInfo()
      },
    },
  ]
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      'no-autostart': { type: 'boolean' },
    },
    allowPositionals: false,
  })

  const toolkit = new OmegaEditToolkit({
    host: (parsed.values.host as string | undefined) || DEFAULT_HOST,
    port:
      parsed.values.port !== undefined
        ? Number.parseInt(parsed.values.port as string, 10)
        : DEFAULT_PORT,
    autoStart: parsed.values['no-autostart'] ? false : true,
  })

  const tools = buildTools(toolkit)
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]))
  let initializeComplete = false
  let receivedInitializedNotification = false

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  rl.on('line', async (line) => {
    if (line.trim().length === 0) {
      return
    }

    let message: JsonRpcRequest

    try {
      message = JSON.parse(line) as JsonRpcRequest
    } catch (error) {
      sendMessage(makeErrorResponse(null, -32700, 'Parse error'))
      return
    }

    const id = message.id
    const method =
      typeof message.method === 'string' ? message.method : undefined

    if (message.jsonrpc !== '2.0' || !method) {
      sendMessage(makeErrorResponse(id ?? null, -32600, 'Invalid Request'))
      return
    }

    try {
      if (method === 'initialize') {
        const params = asObject(message.params)
        const requestedVersion =
          getString(params, 'protocolVersion') || DEFAULT_PROTOCOL_VERSION
        initializeComplete = true
        receivedInitializedNotification = false

        sendMessage(
          makeResult(id, {
            protocolVersion:
              requestedVersion === DEFAULT_PROTOCOL_VERSION
                ? requestedVersion
                : DEFAULT_PROTOCOL_VERSION,
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: '@omega-edit/ai',
              title: 'OmegaEdit AI Tooling',
              version: TOOLING_VERSION,
              description:
                'Bounded CLI and MCP tooling for large-file-safe OmegaEdit sessions.',
            },
            instructions:
              'Create a session first, keep reads bounded, preview patches before applying them when possible, and use undo/redo for reversible changes.',
          })
        )
        return
      }

      if (method === 'notifications/initialized') {
        if (initializeComplete) {
          receivedInitializedNotification = true
        }
        return
      }

      if (method === 'ping') {
        sendMessage(makeResult(id, {}))
        return
      }

      if (!initializeComplete || !receivedInitializedNotification) {
        sendMessage(
          makeErrorResponse(
            id ?? null,
            -32002,
            'Server has not completed MCP initialization'
          )
        )
        return
      }

      if (method === 'tools/list') {
        sendMessage(
          makeResult(id, {
            tools: tools.map((tool) => ({
              name: tool.name,
              title: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              outputSchema: tool.outputSchema,
            })),
          })
        )
        return
      }

      if (method === 'tools/call') {
        const params = asObject(message.params)
        const name = getString(params, 'name', true)!
        const tool = toolMap.get(name)
        if (!tool) {
          sendMessage(
            makeErrorResponse(id ?? null, -32601, `Unknown tool: ${name}`)
          )
          return
        }

        const argumentsObject = asObject(params.arguments)

        try {
          const result = await tool.run(argumentsObject)
          sendMessage(makeResult(id, toolResult(result)))
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : String(error)
          sendMessage(
            makeResult(
              id,
              toolResult(
                {
                  tool: name,
                  error: messageText,
                },
                true
              )
            )
          )
        }
        return
      }

      sendMessage(
        makeErrorResponse(id ?? null, -32601, `Method not found: ${method}`)
      )
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      sendMessage(makeErrorResponse(id ?? null, -32603, messageText))
    }
  })
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
})
