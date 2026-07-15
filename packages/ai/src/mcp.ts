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
import { ChangeLogReplayError, OmegaEditToolkit } from './service'
import { parseInputData } from './codec'
import { ChangeLogDocument, InputEncoding, PatchKind } from './types'

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
  oneShotMutation?: 'never' | 'always' | 'result'
  oneShotDidMutate?: (result: object, argumentsObject: JsonObject) => boolean
  run: (argumentsObject: JsonObject, signal?: AbortSignal) => Promise<object>
}

interface OneShotOperation {
  tool: string
  arguments: JsonObject
}

const MAX_ONE_SHOT_OPERATIONS = 16

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

function getChangeLogDocument(
  object: JsonObject,
  key: string
): ChangeLogDocument | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} must be an object`)
  }
  return value as ChangeLogDocument
}

function getInputValue(argumentsObject: JsonObject): {
  data?: Uint8Array
  inputEncoding?: InputEncoding
} {
  return getNamedInputValue(argumentsObject, {
    text: 'text',
    hex: 'hex',
    base64: 'base64',
  })
}

function getNamedInputValue(
  argumentsObject: JsonObject,
  fieldNames: {
    text: string
    hex: string
    base64: string
  }
): {
  data?: Uint8Array
  inputEncoding?: InputEncoding
} {
  const encodings = [
    argumentsObject[fieldNames.text] !== undefined ? 'utf8' : undefined,
    argumentsObject[fieldNames.hex] !== undefined ? 'hex' : undefined,
    argumentsObject[fieldNames.base64] !== undefined ? 'base64' : undefined,
  ].filter((value): value is InputEncoding => value !== undefined)

  if (encodings.length > 1) {
    throw new Error(
      `Provide only one of ${fieldNames.text}, ${fieldNames.hex}, or ${fieldNames.base64}`
    )
  }

  if (encodings.length === 0) {
    return {}
  }

  const inputEncoding = encodings[0]
  const value =
    inputEncoding === 'utf8'
      ? getString(argumentsObject, fieldNames.text, true)
      : inputEncoding === 'hex'
        ? getString(argumentsObject, fieldNames.hex, true)
        : getString(argumentsObject, fieldNames.base64, true)

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

function getOneShotOperations(argumentsObject: JsonObject): OneShotOperation[] {
  const shorthandTool = getString(argumentsObject, 'tool')
  if (shorthandTool && argumentsObject.operations !== undefined) {
    throw new Error('Provide tool or operations, not both')
  }
  const value = shorthandTool
    ? [
        {
          tool: shorthandTool,
          arguments: argumentsObject.arguments,
        },
      ]
    : argumentsObject.operations
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('operations must be a non-empty array')
  }
  if (value.length > MAX_ONE_SHOT_OPERATIONS) {
    throw new Error(
      `operations exceeds the maximum of ${MAX_ONE_SHOT_OPERATIONS}`
    )
  }

  return value.map((operation, index) => {
    if (
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation)
    ) {
      throw new Error(`operations[${index}] must be an object`)
    }
    const operationObject = operation as JsonObject
    const tool = getString(operationObject, 'tool', true)!
    const rawArguments = operationObject.arguments
    if (
      rawArguments !== undefined &&
      (!rawArguments ||
        typeof rawArguments !== 'object' ||
        Array.isArray(rawArguments))
    ) {
      throw new Error(`operations[${index}].arguments must be an object`)
    }
    const nestedArguments = {
      ...((rawArguments as JsonObject | undefined) || {}),
    }
    if (nestedArguments.sessionId !== undefined) {
      throw new Error(
        `operations[${index}].arguments must not provide sessionId`
      )
    }
    return { tool, arguments: nestedArguments }
  })
}

function omitSessionIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitSessionIds)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([key]) => key !== 'sessionId')
      .map(([key, entry]) => [key, omitSessionIds(entry)])
  )
}

function buildTools(toolkit: OmegaEditToolkit): ToolDefinition[] {
  const tools: ToolDefinition[] = [
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
      oneShotMutation: 'never',
      run: async (argumentsObject) => {
        return await toolkit.sessionStatus(
          getString(argumentsObject, 'sessionId', true)!
        )
      },
    },
    {
      name: 'omega_edit_session_context',
      description:
        'Get stable assistant-readable context for a session, including history, viewport, transforms, change-log status, and command surfaces.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          filePath: { type: 'string' },
        },
        required: ['sessionId'],
      },
      oneShotMutation: 'never',
      run: async (argumentsObject) => {
        return await toolkit.assistantContext(
          getString(argumentsObject, 'sessionId', true)!,
          getString(argumentsObject, 'filePath')
        )
      },
    },
    {
      name: 'omega_edit_create_checkpoint',
      description:
        'Create an OmegaEdit checkpoint for the current session state.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
      run: async (argumentsObject) => {
        return await toolkit.createCheckpoint(
          getString(argumentsObject, 'sessionId', true)!
        )
      },
    },
    {
      name: 'omega_edit_rollback_checkpoint',
      description:
        'Roll back the most recent OmegaEdit checkpoint by dropping the current checkpoint model.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
      run: async (argumentsObject) => {
        return await toolkit.rollbackCheckpoint(
          getString(argumentsObject, 'sessionId', true)!
        )
      },
    },
    {
      name: 'omega_edit_restore_checkpoint',
      description:
        'Restore session content to the most recent OmegaEdit checkpoint without dropping that checkpoint.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
      run: async (argumentsObject) => {
        return await toolkit.restoreCheckpoint(
          getString(argumentsObject, 'sessionId', true)!
        )
      },
    },
    {
      name: 'omega_edit_export_change_log',
      description:
        'Export the OmegaEdit change log for a session as JSON entries, optionally writing the same change-log document to a file.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          outputPath: { type: 'string' },
          overwriteExisting: { type: 'boolean' },
          optimize: { type: 'boolean' },
        },
        required: ['sessionId'],
      },
      oneShotMutation: 'never',
      run: async (argumentsObject) => {
        return await toolkit.exportChangeLog(
          getString(argumentsObject, 'sessionId', true)!,
          getString(argumentsObject, 'outputPath'),
          getBoolean(argumentsObject, 'overwriteExisting') || false,
          getBoolean(argumentsObject, 'optimize') || false
        )
      },
    },
    {
      name: 'omega_edit_preview_change_log',
      description:
        'Preview a versioned OmegaEdit change-log document before replay, including primitive counts, fingerprints, size delta, transform plugins, unavailable primitives, and rollback protection.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          inputPath: { type: 'string' },
          changeLog: { type: 'object' },
        },
        required: ['sessionId'],
      },
      oneShotMutation: 'never',
      run: async (argumentsObject) => {
        return await toolkit.previewChangeLog({
          sessionId: getString(argumentsObject, 'sessionId', true)!,
          inputPath: getString(argumentsObject, 'inputPath'),
          changes: getChangeLogDocument(argumentsObject, 'changeLog'),
        })
      },
    },
    {
      name: 'omega_edit_apply_change_log',
      description:
        'Apply a versioned OmegaEdit change-log document to a session from an inputPath or inline changeLog object.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          inputPath: { type: 'string' },
          changeLog: { type: 'object' },
          dryRun: { type: 'boolean' },
        },
        required: ['sessionId'],
      },
      oneShotMutation: 'result',
      oneShotDidMutate: (result) =>
        (result as { applied?: unknown }).applied === true,
      run: async (argumentsObject) => {
        return await toolkit.applyChangeLog({
          sessionId: getString(argumentsObject, 'sessionId', true)!,
          inputPath: getString(argumentsObject, 'inputPath'),
          changes: getChangeLogDocument(argumentsObject, 'changeLog'),
          dryRun: getBoolean(argumentsObject, 'dryRun') || false,
        })
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
      oneShotMutation: 'never',
      run: async (argumentsObject) => {
        return await toolkit.readRange(
          getString(argumentsObject, 'sessionId', true)!,
          getNumber(argumentsObject, 'offset', true),
          getNumber(argumentsObject, 'length', true)
        )
      },
    },
    {
      name: 'omega_edit_profile_range',
      description:
        'Profile a bounded byte range and return frequency bins, byte-class counts, top bytes, and line endings.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          offset: { type: 'integer' },
          length: { type: 'integer' },
        },
        required: ['sessionId', 'offset', 'length'],
      },
      oneShotMutation: 'never',
      run: async (argumentsObject) => {
        return await toolkit.profileRange(
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
      oneShotMutation: 'never',
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
      name: 'omega_edit_replace_session',
      description:
        'Transactionally replace all matches in a session using OmegaEdit client search-and-replace semantics.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          patternText: { type: 'string' },
          patternHex: { type: 'string' },
          patternBase64: { type: 'string' },
          replacementText: { type: 'string' },
          replacementHex: { type: 'string' },
          replacementBase64: { type: 'string' },
          offset: { type: 'integer' },
          length: { type: 'integer' },
          limit: { type: 'integer' },
          caseInsensitive: { type: 'boolean' },
          reverse: { type: 'boolean' },
          frontToBack: { type: 'boolean' },
          overwriteOnly: { type: 'boolean' },
        },
        required: ['sessionId'],
      },
      oneShotMutation: 'result',
      oneShotDidMutate: (result) =>
        ((result as { replacedCount?: unknown }).replacedCount as number) > 0,
      run: async (argumentsObject) => {
        const pattern = getNamedInputValue(argumentsObject, {
          text: 'patternText',
          hex: 'patternHex',
          base64: 'patternBase64',
        })
        const replacement = getNamedInputValue(argumentsObject, {
          text: 'replacementText',
          hex: 'replacementHex',
          base64: 'replacementBase64',
        })

        if (!pattern.data) {
          throw new Error(
            'Replace requires one of patternText, patternHex, or patternBase64'
          )
        }
        if (!replacement.data) {
          throw new Error(
            'Replace requires one of replacementText, replacementHex, or replacementBase64'
          )
        }

        return await toolkit.replaceSession({
          sessionId: getString(argumentsObject, 'sessionId', true)!,
          pattern: pattern.data,
          replacement: replacement.data,
          offset: getNumber(argumentsObject, 'offset', false, 0),
          length: getNumber(argumentsObject, 'length', false, 0),
          limit: getNumber(argumentsObject, 'limit', false, 0),
          caseInsensitive:
            getBoolean(argumentsObject, 'caseInsensitive') || false,
          reverse: getBoolean(argumentsObject, 'reverse') || false,
          frontToBack: getBoolean(argumentsObject, 'frontToBack'),
          overwriteOnly: getBoolean(argumentsObject, 'overwriteOnly') || false,
        })
      },
    },
    {
      name: 'omega_edit_list_transform_plugins',
      description:
        'List transform plugins registered with the OmegaEdit server.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      run: async () => {
        return {
          plugins: await toolkit.listTransformPlugins(),
        }
      },
    },
    {
      name: 'omega_edit_apply_transform_plugin',
      description:
        'Apply a registered transform plugin to a session range and return replacement/inspection metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          pluginId: { type: 'string' },
          offset: { type: 'integer' },
          length: { type: 'integer' },
          optionsJson: { type: 'string' },
        },
        required: ['sessionId', 'pluginId'],
      },
      oneShotMutation: 'result',
      oneShotDidMutate: (result) =>
        (result as { contentChanged?: unknown }).contentChanged === true,
      run: async (argumentsObject, signal) => {
        return await toolkit.applyTransformPlugin({
          sessionId: getString(argumentsObject, 'sessionId', true)!,
          pluginId: getString(argumentsObject, 'pluginId', true)!,
          offset: getNumber(argumentsObject, 'offset', false, 0),
          length: getNumber(argumentsObject, 'length', false, 0),
          optionsJson: getString(argumentsObject, 'optionsJson'),
          signal,
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
      oneShotMutation: 'never',
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
      oneShotMutation: 'always',
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
      oneShotMutation: 'always',
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
      oneShotMutation: 'always',
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
      oneShotMutation: 'never',
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

  const oneShotTools = new Map(
    tools
      .filter((tool) => tool.oneShotMutation !== undefined)
      .map((tool) => [tool.name, tool])
  )
  const oneShotToolNames = [...oneShotTools.keys()]

  tools.push({
    name: 'omega_edit_run_file',
    description:
      'Run OmegaEdit operations in an always-destroyed ephemeral session. For one operation pass {filePath, tool, arguments}. For a pipeline pass {filePath, operations: [{tool, arguments}]}; the limit is 16. Read-only work needs only filePath. Mutating work also requires outputPath for save-on-success or discardChanges for explicit temporary work.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        outputPath: { type: 'string' },
        overwriteExisting: { type: 'boolean' },
        discardChanges: { type: 'boolean' },
        tool: { type: 'string', enum: oneShotToolNames },
        arguments: { type: 'object' },
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_ONE_SHOT_OPERATIONS,
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', enum: oneShotToolNames },
              arguments: { type: 'object' },
            },
            required: ['tool'],
            additionalProperties: false,
          },
        },
      },
      required: ['filePath'],
      oneOf: [{ required: ['tool'] }, { required: ['operations'] }],
    },
    run: async (argumentsObject, signal) => {
      const filePath = getString(argumentsObject, 'filePath', true)!
      if (filePath.length === 0) throw new Error('filePath must not be empty')

      const outputPath = getString(argumentsObject, 'outputPath')
      const overwriteExisting =
        getBoolean(argumentsObject, 'overwriteExisting') || false
      const discardChanges =
        getBoolean(argumentsObject, 'discardChanges') || false
      if (outputPath && discardChanges) {
        throw new Error('Provide outputPath or discardChanges, not both')
      }
      const operations = getOneShotOperations(argumentsObject)
      const resolvedOperations = operations.map((operation, index) => {
        const tool = oneShotTools.get(operation.tool)
        if (!tool) {
          throw new Error(
            `operations[${index}].tool is not available for one-shot use: ${operation.tool}`
          )
        }
        return { ...operation, definition: tool }
      })

      if (
        !outputPath &&
        !discardChanges &&
        resolvedOperations.some(
          ({ definition }) => definition.oneShotMutation === 'always'
        )
      ) {
        throw new Error(
          'outputPath is required when a one-shot pipeline contains mutating operations'
        )
      }

      const created = await toolkit.createSession(filePath)
      let operationError: unknown
      try {
        let mutated = false
        const results: Array<{ tool: string; result: unknown }> = []

        for (const operation of resolvedOperations) {
          if (signal?.aborted) throw new Error('One-shot operation cancelled')
          const nestedArguments: JsonObject = {
            ...operation.arguments,
            sessionId: created.sessionId,
          }
          if (operation.tool === 'omega_edit_session_context') {
            nestedArguments.filePath = created.filePath
          }

          const result = await operation.definition.run(nestedArguments, signal)
          const didMutate =
            operation.definition.oneShotMutation === 'always' ||
            (operation.definition.oneShotMutation === 'result' &&
              (operation.definition.oneShotDidMutate?.(
                result,
                nestedArguments
              ) ??
                false))
          mutated ||= didMutate
          results.push({
            tool: operation.tool,
            result: omitSessionIds(result),
          })
        }

        if (mutated && !outputPath && !discardChanges) {
          throw new Error(
            'outputPath is required because a one-shot operation changed file content'
          )
        }

        const saved =
          mutated && outputPath
            ? await toolkit.saveSession(
                created.sessionId,
                outputPath,
                overwriteExisting
              )
            : undefined

        return {
          ephemeral: true,
          filePath,
          mutated,
          persisted: saved !== undefined,
          discarded: mutated && saved === undefined,
          ...(saved ? { output: saved } : {}),
          operations: results,
        }
      } catch (error) {
        operationError = error
        throw error
      } finally {
        try {
          await toolkit.destroySession(created.sessionId)
        } catch (cleanupError) {
          if (operationError !== undefined) {
            const operationMessage =
              operationError instanceof Error
                ? operationError.message
                : String(operationError)
            const cleanupMessage =
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError)
            throw new Error(
              `One-shot operation failed (${operationMessage}) and its ephemeral session could not be destroyed (${cleanupMessage})`
            )
          }
          throw cleanupError
        }
      }
    },
  })

  return tools
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      'no-autostart': { type: 'boolean' },
      'insecure-allow-non-loopback': { type: 'boolean' },
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
    insecureAllowNonLoopback:
      parsed.values['insecure-allow-non-loopback'] === true,
  })

  const tools = buildTools(toolkit)
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]))
  const activeToolRequests = new Map<unknown, AbortController>()
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
              'Use omega_edit_run_file for self-cleaning one-shot file work. For one operation pass {filePath, tool, arguments}; for pipelines pass {filePath, operations: [{tool, arguments}]}. Create a session only for longer workflows. Keep reads bounded, preview patches before applying them when possible, and use undo/redo for reversible changes.',
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

      if (method === 'notifications/cancelled') {
        const params = asObject(message.params)
        activeToolRequests.get(params.requestId)?.abort()
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
        const abortController = new AbortController()
        if (id !== undefined && id !== null) {
          activeToolRequests.set(id, abortController)
        }

        try {
          const result = await tool.run(argumentsObject, abortController.signal)
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
                  ...(error instanceof ChangeLogReplayError
                    ? { result: error.result }
                    : {}),
                },
                true
              )
            )
          )
        } finally {
          if (activeToolRequests.get(id) === abortController) {
            activeToolRequests.delete(id)
          }
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
