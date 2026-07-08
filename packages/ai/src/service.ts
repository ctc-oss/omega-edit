import {
  ChangeKind,
  CountKind,
  delay,
  type IServerControlResult,
  IOFlags,
  SessionFingerprintContent,
  TransformPluginOperation,
  TransformPluginSupport,
  applyTransformPlugin as applyClientTransformPlugin,
  checkSessionModel,
  createCheckpoint as createClientCheckpoint,
  createSession,
  del,
  destroyLastCheckpoint as destroyClientCheckpoint,
  destroySession,
  getChangeCount,
  getChangeDetails,
  getClient,
  getComputedFileSize,
  getContentType,
  getCounts,
  getLastChange,
  getServerInfo,
  getSegment,
  getSessionFingerprint,
  isPortAvailable,
  getUndoCount,
  getViewportCount,
  insert,
  listTransformPlugins as listClientTransformPlugins,
  numAscii,
  overwrite,
  PROFILE_DOS_EOL,
  profileSession,
  redo,
  replace,
  replaceSession as replaceWholeSession,
  resetClient,
  restoreLastCheckpoint as restoreClientCheckpoint,
  restoreToChangeCount,
  runSessionTransaction,
  saveSession,
  SearchCaseFolding,
  searchSession,
  startServer,
  stopServerGraceful,
  undo,
} from '@omega-edit/client'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { finished } from 'node:stream/promises'
import {
  DEFAULT_HOST,
  DEFAULT_MAX_EDIT_BYTES,
  DEFAULT_MAX_READ_BYTES,
  DEFAULT_MAX_SEARCH_RESULTS,
  DEFAULT_PORT,
  DEFAULT_PREVIEW_CONTEXT_BYTES,
} from './constants'
import { concatBytes, encodeData, parseInputData } from './codec'
import {
  AssistantCommandSurfaceEntry,
  AssistantSessionContext,
  ApplyTransformPluginRequest,
  ApplyTransformPluginResult,
  ApplyChangeLogRequest,
  ApplyChangeLogResult,
  ChangeLogPreview,
  ChangeLogPrimitiveCounts,
  ChangeLogDocument,
  ChangeLogEntry,
  ChangeLogFingerprint,
  ChangeLogResult,
  ChangeLogRollbackProtection,
  ChangeLogSafetyIssue,
  ChangeLogSizeDelta,
  ChangeLogTransformDescriptorPreview,
  CheckpointResult,
  PatchPreview,
  PatchRequest,
  PatchResult,
  PreviewChangeLogRequest,
  ProfileRangeResult,
  ReadRangeResult,
  ReplaceSessionRequest,
  ReplaceSessionResult,
  RestoreCheckpointResult,
  RollbackCheckpointResult,
  SearchRequest,
  SearchResult,
  SessionStatus,
  ToolkitOptions,
  TransformPluginInfoResult,
} from './types'

const MAX_CHANGE_LOG_JSON_NESTING = 256
const CHANGE_LOG_FORMAT = 'omega-edit.change-log'
const CHANGE_LOG_VERSION = 2
const ASSISTANT_CONTEXT_VERSION = 1
const DEFAULT_CHANGE_LOG_DIGEST_ALGORITHM = 'sha256'
const GRPC_NOT_FOUND = 5
const MAX_INT64 = 9_223_372_036_854_775_807n

const OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND = 'omegaEdit.openInHexEditor'
const OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND = 'omegaEdit.getAssistantContext'
const OMEGA_EDIT_GET_EDITOR_STATE_COMMAND = 'omegaEdit.getEditorState'
const OMEGA_EDIT_GO_TO_OFFSET_COMMAND = 'omegaEdit.goToOffset'
const OMEGA_EDIT_SEARCH_NEXT_COMMAND = 'omegaEdit.searchNext'
const OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND = 'omegaEdit.searchPrevious'
const OMEGA_EDIT_UNDO_COMMAND = 'omegaEdit.undo'
const OMEGA_EDIT_REDO_COMMAND = 'omegaEdit.redo'
const OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND =
  'omegaEdit.refreshTransformPlugins'
const OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND = 'omegaEdit.createCheckpoint'
const OMEGA_EDIT_RESTORE_CHECKPOINT_COMMAND = 'omegaEdit.restoreCheckpoint'
const OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND = 'omegaEdit.rollbackCheckpoint'
const OMEGA_EDIT_EXPORT_CHANGE_LOG_COMMAND = 'omegaEdit.exportChangeLog'
const OMEGA_EDIT_APPLY_CHANGE_LOG_COMMAND = 'omegaEdit.applyChangeLog'
const OMEGA_EDIT_ROLLBACK_SESSION_COMMAND = 'omegaEdit.rollbackSession'
const OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND =
  'omegaEdit.setExternalHighlights'
const OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND =
  'omegaEdit.clearExternalHighlights'
const OMEGA_EDIT_LOAD_RANGE_MAP_COMMAND = 'omegaEdit.loadRangeMap'
const OMEGA_EDIT_UNLOAD_RANGE_MAP_COMMAND = 'omegaEdit.unloadRangeMap'

const ASSISTANT_COMMAND_SURFACES: readonly AssistantCommandSurfaceEntry[] = [
  {
    action: 'openSession',
    ui: 'Open in Data Editor',
    vscodeCommands: [OMEGA_EDIT_OPEN_IN_HEX_EDITOR_COMMAND],
    extensionApis: ['open'],
    cliCommands: ['oe create-session --file <path>'],
    mcpTools: ['omega_edit_create_session'],
    result: 'structured session id and file path',
  },
  {
    action: 'assistantContext',
    vscodeCommands: [OMEGA_EDIT_GET_ASSISTANT_CONTEXT_COMMAND],
    extensionApis: ['getAssistantContext'],
    cliCommands: ['oe session-context --session <id> [--file <path>]'],
    mcpTools: ['omega_edit_session_context'],
    result: 'stable assistant-readable session context JSON',
  },
  {
    action: 'editorState',
    vscodeCommands: [OMEGA_EDIT_GET_EDITOR_STATE_COMMAND],
    extensionApis: ['getEditorState'],
    result: 'raw editor state JSON for VS Code integrations',
  },
  {
    action: 'navigateRange',
    ui: 'Go to Offset',
    vscodeCommands: [OMEGA_EDIT_GO_TO_OFFSET_COMMAND],
    extensionApis: ['reveal'],
    cliCommands: ['oe view --session <id> --offset <n> --length <n>'],
    mcpTools: ['omega_edit_read_range'],
    result: 'selected offset or bounded range bytes',
  },
  {
    action: 'profileRange',
    cliCommands: ['oe profile-range --session <id> --offset <n> --length <n>'],
    mcpTools: ['omega_edit_profile_range'],
    result: 'bounded range profile metrics',
  },
  {
    action: 'search',
    ui: 'Search',
    vscodeCommands: [
      OMEGA_EDIT_SEARCH_NEXT_COMMAND,
      OMEGA_EDIT_SEARCH_PREVIOUS_COMMAND,
    ],
    cliCommands: ['oe search --session <id> --text <value>'],
    mcpTools: ['omega_edit_search'],
    result: 'structured match offsets and lengths',
  },
  {
    action: 'patchRange',
    ui: 'Insert, delete, overwrite, or replace bytes',
    cliCommands: ['oe patch --session <id> --offset <n> --operation <kind>'],
    mcpTools: ['omega_edit_preview_patch', 'omega_edit_apply_patch'],
    result: 'operation kind, range, serial, preview, and resulting state',
  },
  {
    action: 'undoRedo',
    ui: 'Undo / Redo',
    vscodeCommands: [OMEGA_EDIT_UNDO_COMMAND, OMEGA_EDIT_REDO_COMMAND],
    cliCommands: ['oe undo --session <id>', 'oe redo --session <id>'],
    mcpTools: ['omega_edit_undo', 'omega_edit_redo'],
    result: 'serial and updated history counts',
  },
  {
    action: 'transforms',
    ui: 'Refresh or apply transform plugins',
    vscodeCommands: [OMEGA_EDIT_REFRESH_TRANSFORM_PLUGINS_COMMAND],
    cliCommands: [
      'oe list-transform-plugins',
      'oe apply-transform-plugin --session <id> --plugin <id>',
    ],
    mcpTools: [
      'omega_edit_list_transform_plugins',
      'omega_edit_apply_transform_plugin',
    ],
    result: 'plugin metadata or transform result with serial and descriptor',
  },
  {
    action: 'checkpoints',
    ui: 'Create, restore, or roll back checkpoints',
    vscodeCommands: [
      OMEGA_EDIT_CREATE_CHECKPOINT_COMMAND,
      OMEGA_EDIT_RESTORE_CHECKPOINT_COMMAND,
      OMEGA_EDIT_ROLLBACK_CHECKPOINT_COMMAND,
    ],
    extensionApis: [
      'createCheckpoint',
      'restoreCheckpoint',
      'rollbackCheckpoint',
    ],
    cliCommands: [
      'oe create-checkpoint',
      'oe restore-checkpoint',
      'oe rollback-checkpoint',
    ],
    mcpTools: [
      'omega_edit_create_checkpoint',
      'omega_edit_restore_checkpoint',
      'omega_edit_rollback_checkpoint',
    ],
    result: 'checkpoint count and resulting state',
  },
  {
    action: 'changeLog',
    ui: 'Export or apply change log',
    vscodeCommands: [
      OMEGA_EDIT_EXPORT_CHANGE_LOG_COMMAND,
      OMEGA_EDIT_APPLY_CHANGE_LOG_COMMAND,
    ],
    extensionApis: ['exportChangeLog', 'applyChangeLog'],
    cliCommands: ['oe export-change-log', 'oe apply-change-log'],
    mcpTools: ['omega_edit_export_change_log', 'omega_edit_apply_change_log'],
    result: 'change-log format, source counts, fingerprints, and state',
  },
  {
    action: 'rollbackSession',
    ui: 'Roll Back Session',
    vscodeCommands: [OMEGA_EDIT_ROLLBACK_SESSION_COMMAND],
    result: 'resulting editor state',
  },
  {
    action: 'annotations',
    vscodeCommands: [
      OMEGA_EDIT_SET_EXTERNAL_HIGHLIGHTS_COMMAND,
      OMEGA_EDIT_CLEAR_EXTERNAL_HIGHLIGHTS_COMMAND,
      OMEGA_EDIT_LOAD_RANGE_MAP_COMMAND,
      OMEGA_EDIT_UNLOAD_RANGE_MAP_COMMAND,
    ],
    extensionApis: [
      'setExternalHighlights',
      'clearExternalHighlights',
      'loadRangeMap',
      'unloadRangeMap',
    ],
    result: 'annotation counts, selected range, and resulting editor state',
  },
]

function cloneAssistantCommandSurfaces(): AssistantCommandSurfaceEntry[] {
  return ASSISTANT_COMMAND_SURFACES.map((entry) => {
    const clone: AssistantCommandSurfaceEntry = {
      action: entry.action,
      result: entry.result,
    }
    if (entry.ui) {
      clone.ui = entry.ui
    }
    if (entry.vscodeCommands) {
      clone.vscodeCommands = [...entry.vscodeCommands]
    }
    if (entry.extensionApis) {
      clone.extensionApis = [...entry.extensionApis]
    }
    if (entry.cliCommands) {
      clone.cliCommands = [...entry.cliCommands]
    }
    if (entry.mcpTools) {
      clone.mcpTools = [...entry.mcpTools]
    }
    return clone
  })
}

interface CollectedChangeLogEntries {
  changes?: ChangeLogEntry[]
  unavailableChangeSerials: number[]
}

interface ParsedChangeLog {
  changes: NormalizedChangeLogEntry[]
  complete: boolean
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  changeCount: string
  sourceChangeCount: string
  unavailableChangeCount: string
  unavailableChangeSerials: number[]
}

interface ChangeLogDocumentMetadata {
  complete: boolean
  changeCount: string
  sourceChangeCount: string
  unavailableChangeCount: string
  unavailableChangeSerials: number[]
}

const changeKindNames = new Map<number, string>(
  Object.entries(ChangeKind)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value as number, name])
)

const transformPluginOperationNames = new Map<number, string>(
  Object.entries(TransformPluginOperation)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value as number, name])
)

const transformPluginSupportNames = new Map<number, string>(
  Object.entries(TransformPluginSupport)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value as number, name])
)

function isFiniteInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value)
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!isFiniteInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
}

function searchCaseFoldingForRequest(
  caseInsensitive: boolean | undefined
): SearchCaseFolding {
  return caseInsensitive ? SearchCaseFolding.ASCII : SearchCaseFolding.NONE
}

function parseNonNegativeInt64(value: unknown, name: string): bigint {
  let parsed: bigint
  if (typeof value === 'bigint') {
    parsed = value
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `${name} must be a non-negative safe integer or decimal int64 string`
      )
    }
    parsed = BigInt(value)
  } else if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    parsed = BigInt(value)
  } else {
    throw new Error(`${name} must be a non-negative int64`)
  }

  if (parsed < 0n || parsed > MAX_INT64) {
    throw new Error(`${name} must be in the non-negative int64 range`)
  }
  return parsed
}

function parsePositiveInt64(value: unknown, name: string): bigint {
  const parsed = parseNonNegativeInt64(value, name)
  if (parsed <= 0n) {
    throw new Error(`${name} must be a positive int64`)
  }
  return parsed
}

function int64ToSafeNumber(value: bigint, name: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `${name} exceeds the current OmegaEdit TypeScript transport safe integer range`
    )
  }
  return Number(value)
}

function normalizeNonNegativeInt64ForClient(
  value: unknown,
  name: string
): number {
  return int64ToSafeNumber(parseNonNegativeInt64(value, name), name)
}

function normalizePositiveInt64ForClient(value: unknown, name: string): number {
  return int64ToSafeNumber(parsePositiveInt64(value, name), name)
}

function int64ToDecimal(value: number | string | bigint): string {
  return parseNonNegativeInt64(value, 'change log integer').toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface TransformPrimitiveDescriptor {
  transformId: string
  optionsJson?: string
}

interface NormalizedChangeLogEntry extends ChangeLogEntry {
  transformDescriptor?: TransformPrimitiveDescriptor
}

function parseJsonObject(text: string, name: string): Record<string, unknown> {
  assertJsonNestingLimit(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${name} must be valid JSON: ${message}`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`${name} must be a JSON object`)
  }
  return parsed
}

function transformOptionsToJson(
  args: Record<string, unknown>
): string | undefined {
  return Object.keys(args).length > 0 ? JSON.stringify(args) : undefined
}

function parseTransformPrimitiveDescriptor(
  dataBytes: Uint8Array,
  name: string
): TransformPrimitiveDescriptor {
  if (dataBytes.length === 0) {
    throw new Error(`${name} requires data`)
  }

  const descriptorText = Buffer.from(dataBytes).toString('utf8')
  const descriptor = parseJsonObject(descriptorText, name)
  if (
    typeof descriptor.transformId !== 'string' ||
    !descriptor.transformId.trim()
  ) {
    throw new Error(`${name} requires transformId`)
  }

  const args = descriptor.args === undefined ? {} : descriptor.args
  if (!isRecord(args)) {
    throw new Error(`${name} args must be a JSON object`)
  }

  return {
    transformId: descriptor.transformId.trim(),
    optionsJson: transformOptionsToJson(args),
  }
}

function parseTransformOptionsJson(
  optionsJson: string | undefined,
  name: string
): Record<string, unknown> {
  if (optionsJson === undefined || optionsJson === '') {
    return {}
  }
  if (typeof optionsJson !== 'string') {
    throw new Error(`${name} must be a string`)
  }
  return parseJsonObject(optionsJson, name)
}

function canonicalizeTransformDescriptorValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeTransformDescriptorValue)
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((canonical, key) => {
      canonical[key] = canonicalizeTransformDescriptorValue(value[key])
      return canonical
    }, {})
}

function canonicalizeTransformDescriptorArgs(
  args: Record<string, unknown>
): Record<string, unknown> {
  return canonicalizeTransformDescriptorValue(args) as Record<string, unknown>
}

function createTransformPrimitiveDescriptorResult(
  transformId: string,
  optionsJson?: string
): ApplyTransformPluginResult['transformDescriptor'] {
  const args = parseTransformOptionsJson(optionsJson, 'transform options')
  const canonicalArgs = canonicalizeTransformDescriptorArgs(args)
  const descriptor = {
    transformId: transformId.trim(),
    args: canonicalArgs,
  }
  const json = JSON.stringify(descriptor)
  return {
    ...descriptor,
    json,
    dataHex: Buffer.from(json, 'utf8').toString('hex'),
  }
}

function normalizeJsonForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonForComparison)
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizeJsonForComparison(value[key])])
  )
}

function jsonObjectsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  return (
    JSON.stringify(normalizeJsonForComparison(left)) ===
    JSON.stringify(normalizeJsonForComparison(right))
  )
}

function transformOptionsMatchDescriptor(
  optionsJson: string | undefined,
  descriptorOptionsJson: string | undefined,
  name: string
): boolean {
  const options = parseTransformOptionsJson(optionsJson, name)
  const descriptorOptions = parseTransformOptionsJson(
    descriptorOptionsJson,
    name
  )
  return jsonObjectsEqual(options, descriptorOptions)
}

function assertTransformReplayResponse(
  descriptor: TransformPrimitiveDescriptor,
  offset: number,
  length: number,
  computedFileSizeBefore: number,
  computedFileSizeAfter: number,
  response: Awaited<ReturnType<typeof applyClientTransformPlugin>>
): void {
  if (response.pluginId !== descriptor.transformId) {
    throw new Error(
      `TRANSFORM ${descriptor.transformId} replay returned plugin ${response.pluginId}`
    )
  }
  if (response.offset !== offset || response.length !== length) {
    throw new Error(
      `TRANSFORM ${descriptor.transformId} replay range mismatch: expected offset ${offset}, length ${length}; actual offset ${response.offset}, length ${response.length}`
    )
  }

  const expectedFileSize =
    computedFileSizeBefore - response.length + response.replacementLength
  if (response.computedFileSize !== expectedFileSize) {
    throw new Error(
      `TRANSFORM ${descriptor.transformId} replay size mismatch: expected ${expectedFileSize}, actual ${response.computedFileSize}`
    )
  }
  if (computedFileSizeAfter !== response.computedFileSize) {
    throw new Error(
      `TRANSFORM ${descriptor.transformId} replay session size mismatch: expected ${response.computedFileSize}, actual ${computedFileSizeAfter}`
    )
  }
}

function assertJsonNestingLimit(text: string): void {
  let depth = 0
  let inString = false
  let escaped = false

  for (const ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
    } else if (ch === '{' || ch === '[') {
      ++depth
      if (depth > MAX_CHANGE_LOG_JSON_NESTING) {
        throw new Error(
          `Change log JSON nesting exceeds ${MAX_CHANGE_LOG_JSON_NESTING} levels`
        )
      }
    } else if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1)
    }
  }
}

function normalizeChangeLogEntries(value: unknown): ParsedChangeLog {
  let entries: unknown[] | undefined
  let document: Record<string, unknown> | undefined
  if (isRecord(value)) {
    if (value.format !== CHANGE_LOG_FORMAT) {
      throw new Error('Unsupported change log format')
    }
    if (value.version !== CHANGE_LOG_VERSION) {
      throw new Error('Unsupported change log version')
    }
    document = value
    entries = Array.isArray(value.changes) ? value.changes : undefined
  }

  if (!entries) {
    throw new Error(
      'Change log must be a versioned omega-edit.change-log document'
    )
  }

  const normalized = entries.map((entry, index) =>
    normalizeChangeLogEntry(entry, index)
  )
  validateChangeLogMetadata(normalized)
  if (document) {
    const metadata = validateChangeLogDocumentMetadata(document, normalized)
    return {
      changes: normalized,
      ...metadata,
      before: normalizeChangeLogFingerprint(document.before, 'before'),
      after: normalizeChangeLogFingerprint(document.after, 'after'),
    }
  }
  throw new Error(
    'Change log must be a versioned omega-edit.change-log document'
  )
}

function readDocumentCount(
  document: Record<string, unknown>,
  key: string
): bigint {
  return parseNonNegativeInt64(document[key], `Change log ${key}`)
}

function normalizeUnavailableChangeSerials(
  value: unknown,
  sourceChangeCount: bigint
): number[] {
  if (!Array.isArray(value)) {
    throw new Error('Change log unavailableChangeSerials must be an array')
  }

  const seen = new Set<number>()
  return value.map((serial, index) => {
    let serialValue: bigint
    try {
      serialValue = parsePositiveInt64(
        serial,
        `Change log unavailableChangeSerials[${index}]`
      )
    } catch {
      throw new Error(
        `Change log unavailableChangeSerials[${index}] must be a positive int64`
      )
    }
    if (serialValue > sourceChangeCount) {
      throw new Error(
        `Change log unavailableChangeSerials[${index}] exceeds sourceChangeCount`
      )
    }
    const serialNumber = int64ToSafeNumber(
      serialValue,
      `Change log unavailableChangeSerials[${index}]`
    )
    if (seen.has(serialNumber)) {
      throw new Error(
        `Change log unavailableChangeSerials[${index}] duplicates serial ${serialNumber}`
      )
    }
    seen.add(serialNumber)
    return serialNumber
  })
}

function normalizeChangeLogFingerprint(
  value: unknown,
  key: 'before' | 'after'
): ChangeLogFingerprint {
  if (!isRecord(value)) {
    throw new Error(`Change log ${key} fingerprint must be an object`)
  }

  let byteLength: string
  try {
    byteLength = parseNonNegativeInt64(
      value.byteLength,
      `Change log ${key}.byteLength`
    ).toString()
  } catch {
    throw new Error(`Change log ${key}.byteLength must be a non-negative int64`)
  }

  if (!isRecord(value.digest)) {
    throw new Error(`Change log ${key}.digest must be an object`)
  }

  const algorithm = value.digest.algorithm
  if (typeof algorithm !== 'string' || !algorithm.trim()) {
    throw new Error(`Change log ${key}.digest.algorithm must be a string`)
  }

  const digestValue = value.digest.value
  if (typeof digestValue !== 'string' || !digestValue.trim()) {
    throw new Error(`Change log ${key}.digest.value must be a string`)
  }

  return {
    byteLength,
    digest: {
      algorithm: algorithm.trim().toLowerCase(),
      value: digestValue.trim().toLowerCase(),
    },
  }
}

function describeUnavailableSerials(serials: number[]): string {
  const preview = serials.slice(0, 10).join(', ')
  const suffix = serials.length > 10 ? ', ...' : ''
  return preview ? ` (serials: ${preview}${suffix})` : ''
}

function incompleteChangeLogMessage(action: 'export' | 'apply'): string {
  return action === 'export'
    ? 'Change log export is incomplete: the server no longer has details for every reported change'
    : 'Change log is incomplete: unavailable change details cannot be replayed safely'
}

function assertCompleteChangeLog(
  action: 'export' | 'apply',
  unavailableChangeSerials: number[]
): void {
  if (unavailableChangeSerials.length === 0) {
    return
  }
  throw new Error(
    `${incompleteChangeLogMessage(action)}${describeUnavailableSerials(
      unavailableChangeSerials
    )}`
  )
}

async function assertSessionModelValidForChangeLogExport(
  sessionId: string
): Promise<void> {
  const check = await checkSessionModel(sessionId)
  if (check.valid) {
    return
  }

  throw new Error(
    `Change log export refused: OmegaEdit model integrity check failed with status ${check.status}`
  )
}

function validateChangeLogDocumentMetadata(
  document: Record<string, unknown>,
  changes: ChangeLogEntry[]
): ChangeLogDocumentMetadata {
  if (typeof document.complete !== 'boolean') {
    throw new Error('Change log complete must be a boolean')
  }

  const changeCount = readDocumentCount(document, 'changeCount')
  const sourceChangeCount = readDocumentCount(document, 'sourceChangeCount')
  const unavailableChangeCount = readDocumentCount(
    document,
    'unavailableChangeCount'
  )
  if (changeCount !== BigInt(changes.length)) {
    throw new Error('Change log changeCount must match changes length')
  }
  if (sourceChangeCount < changeCount) {
    throw new Error('Change log sourceChangeCount must cover changeCount')
  }

  const unavailableChangeSerials = normalizeUnavailableChangeSerials(
    document.unavailableChangeSerials,
    sourceChangeCount
  )
  if (unavailableChangeCount !== BigInt(unavailableChangeSerials.length)) {
    throw new Error(
      'Change log unavailableChangeCount must match unavailableChangeSerials length'
    )
  }
  if (document.complete !== (unavailableChangeCount === 0n)) {
    throw new Error(
      'Change log complete must match unavailable change metadata'
    )
  }

  return {
    complete: document.complete,
    changeCount: changeCount.toString(),
    sourceChangeCount: sourceChangeCount.toString(),
    unavailableChangeCount: unavailableChangeCount.toString(),
    unavailableChangeSerials,
  }
}

function normalizeChangeLogEntry(
  entry: unknown,
  index: number
): NormalizedChangeLogEntry {
  if (!isRecord(entry)) {
    throw new Error(`Change log entry ${index} must be an object`)
  }

  const { kind, offset, length, serial, data, groupId } = entry
  if (
    kind !== 'INSERT' &&
    kind !== 'DELETE' &&
    kind !== 'OVERWRITE' &&
    kind !== 'REPLACE' &&
    kind !== 'TRANSFORM'
  ) {
    throw new Error(`Change log entry ${index} has an unsupported kind`)
  }
  const normalizedOffset = normalizeNonNegativeInt64ForClient(
    offset,
    `change log entry ${index} offset`
  )
  const normalizedLength = normalizeNonNegativeInt64ForClient(
    length,
    `change log entry ${index} length`
  )

  const dataBytes =
    typeof data === 'string' ? parseInputData(data, 'hex') : new Uint8Array(0)
  if (
    (kind === 'INSERT' || kind === 'DELETE' || kind === 'OVERWRITE') &&
    dataBytes.length === 0
  ) {
    throw new Error(`Change log entry ${index} ${kind} requires data`)
  }
  if (kind === 'DELETE' && dataBytes.length !== normalizedLength) {
    throw new Error(`Change log entry ${index} DELETE data length mismatch`)
  }

  const normalized: NormalizedChangeLogEntry = {
    kind,
    offset: normalizedOffset,
    length: normalizedLength,
    data: Buffer.from(dataBytes).toString('hex'),
  }
  if (kind === 'TRANSFORM') {
    const legacyFields = [
      'transformId',
      'optionsJson',
      'replacementLength',
      'computedFileSizeBefore',
      'computedFileSizeAfter',
    ].filter((field) => Object.prototype.hasOwnProperty.call(entry, field))
    if (legacyFields.length > 0) {
      throw new Error(
        `Change log entry ${index} TRANSFORM metadata must be carried in data`
      )
    }
    normalized.transformDescriptor = parseTransformPrimitiveDescriptor(
      dataBytes,
      `Change log entry ${index} TRANSFORM data`
    )
  }
  if (serial !== undefined) {
    normalized.serial = normalizePositiveInt64ForClient(
      serial,
      `change log entry ${index} serial`
    )
  }
  if (groupId !== undefined) {
    if (typeof groupId !== 'string' || !groupId.trim()) {
      throw new Error(`Change log entry ${index} groupId must be a string`)
    }
    normalized.groupId = groupId.trim()
  }
  return normalized
}

function validateChangeLogMetadata(entries: ChangeLogEntry[]): void {
  const serializedEntries = entries.filter(
    (entry) => entry.serial !== undefined
  )
  if (
    serializedEntries.length > 0 &&
    serializedEntries.length !== entries.length
  ) {
    throw new Error('Change log serial metadata must be present on every entry')
  }

  for (let index = 0; index < entries.length; index += 1) {
    const serial = entries[index].serial
    if (serial !== undefined && serial !== index + 1) {
      throw new Error(
        `Change log serial metadata must be contiguous; entry ${index} has serial ${serial}, expected ${
          index + 1
        }`
      )
    }
  }

  const closedGroups = new Set<string>()
  let activeGroup: string | undefined
  for (const [index, entry] of entries.entries()) {
    const groupId = entry.groupId
    if (!groupId) {
      if (activeGroup) {
        closedGroups.add(activeGroup)
        activeGroup = undefined
      }
      continue
    }

    if (groupId !== activeGroup) {
      if (closedGroups.has(groupId)) {
        throw new Error(
          `Change log groupId "${groupId}" is not contiguous at entry ${index}`
        )
      }
      if (activeGroup) {
        closedGroups.add(activeGroup)
      }
      activeGroup = groupId
    }
  }
}

async function readChangeLogFile(inputPath: string): Promise<ParsedChangeLog> {
  const text = await fs.readFile(inputPath, 'utf8')
  assertJsonNestingLimit(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid change log JSON: ${message}`)
  }
  return normalizeChangeLogEntries(parsed)
}

async function readChangeLogRequest(
  request: PreviewChangeLogRequest
): Promise<ParsedChangeLog> {
  return request.inputPath
    ? await readChangeLogFile(request.inputPath)
    : normalizeChangeLogEntries(request.changes)
}

function changeDetailsToLogEntry(
  change: Awaited<ReturnType<typeof getChangeDetails>>
): ChangeLogEntry {
  const kind = changeKindNames.get(change.getKind())
  if (
    kind !== 'INSERT' &&
    kind !== 'DELETE' &&
    kind !== 'OVERWRITE' &&
    kind !== 'TRANSFORM'
  ) {
    throw new Error(`Unsupported change kind: ${kind ?? change.getKind()}`)
  }

  if (kind === 'TRANSFORM') {
    const transform = change.getTransform()
    if (!transform?.transformId) {
      throw new Error('Transform change is missing transform metadata')
    }
    const data = change.getData_asU8()
    const descriptor = parseTransformPrimitiveDescriptor(
      data,
      'Transform change data'
    )
    if (transform.transformId !== descriptor.transformId) {
      throw new Error('Transform change metadata does not match data')
    }
    if (
      transform.optionsJson !== undefined &&
      !transformOptionsMatchDescriptor(
        transform.optionsJson,
        descriptor.optionsJson,
        'Transform change optionsJson'
      )
    ) {
      throw new Error('Transform change options metadata does not match data')
    }

    return {
      serial: change.getSerial(),
      kind,
      offset: change.getOffset(),
      length: change.getLength(),
      data: Buffer.from(data).toString('hex'),
    }
  }

  return {
    serial: change.getSerial(),
    kind,
    offset: change.getOffset(),
    length: kind === 'INSERT' ? 0 : change.getLength(),
    data: Buffer.from(change.getData_asU8()).toString('hex'),
  }
}

function isMissingChangeDetailsError(error: unknown): boolean {
  return hasGrpcStatusCode(error, GRPC_NOT_FOUND)
}

function hasGrpcStatusCode(error: unknown, code: number): boolean {
  let current: unknown = error
  while (isRecord(current)) {
    if (current.code === code) {
      return true
    }
    current = current.cause
  }
  return false
}

async function collectChangeLogEntries(
  sessionId: string,
  sourceChangeCount: number,
  onEntry?: (entry: ChangeLogEntry) => Promise<void>
): Promise<CollectedChangeLogEntries> {
  const changes = onEntry ? undefined : ([] as ChangeLogEntry[])
  const unavailableChangeSerials: number[] = []
  for (let serial = 1; serial <= sourceChangeCount; serial += 1) {
    try {
      const entry = changeDetailsToLogEntry(
        await getChangeDetails(sessionId, serial)
      )
      if (onEntry) {
        await onEntry(entry)
      } else {
        changes?.push(entry)
      }
    } catch (error) {
      if (!isMissingChangeDetailsError(error)) {
        throw error
      }
      unavailableChangeSerials.push(serial)
    }
  }
  return { changes, unavailableChangeSerials }
}

async function rollbackSessionToChangeCount(
  sessionId: string,
  targetChangeCount: number
): Promise<boolean> {
  const response = await restoreToChangeCount(sessionId, targetChangeCount)
  if (response.changeCount !== targetChangeCount) {
    throw new Error(
      `Rollback ended at change count ${response.changeCount}, expected ${targetChangeCount}`
    )
  }

  return response.discardedChangeCount > 0 || response.discardedUndoCount > 0
}

function changeLogApplyErrorWithRollbackFailure(
  applyError: unknown,
  rollbackError: unknown
): Error {
  const applyMessage =
    applyError instanceof Error ? applyError.message : String(applyError)
  const rollbackMessage =
    rollbackError instanceof Error
      ? rollbackError.message
      : String(rollbackError)
  const error = new Error(
    `Failed to apply change log and rollback failed: ${applyMessage}; rollback error: ${rollbackMessage}`
  )
  ;(error as Error & { cause?: unknown }).cause = applyError
  return error
}

async function getChangeLogFingerprint(
  sessionId: string,
  content: SessionFingerprintContent,
  algorithm = DEFAULT_CHANGE_LOG_DIGEST_ALGORITHM
): Promise<ChangeLogFingerprint> {
  const response = await getSessionFingerprint(sessionId, content, algorithm)
  if (!response.fingerprint?.digest) {
    throw new Error('Server fingerprint response is missing digest metadata')
  }

  return {
    byteLength: int64ToDecimal(response.fingerprint.byteLength),
    digest: {
      algorithm: response.fingerprint.digest.algorithm.toLowerCase(),
      value: response.fingerprint.digest.value.toLowerCase(),
    },
  }
}

function fingerprintLabel(fingerprint: ChangeLogFingerprint): string {
  return `${int64ToDecimal(fingerprint.byteLength)} bytes ${fingerprint.digest.algorithm}:${fingerprint.digest.value}`
}

function fingerprintsMatch(
  actual: ChangeLogFingerprint,
  expected: ChangeLogFingerprint
): boolean {
  return (
    int64ToDecimal(actual.byteLength) === int64ToDecimal(expected.byteLength) &&
    actual.digest.algorithm === expected.digest.algorithm &&
    actual.digest.value === expected.digest.value
  )
}

function changeLogFingerprintMismatchMessage(
  actual: ChangeLogFingerprint,
  expected: ChangeLogFingerprint,
  phase: 'before' | 'after'
): string {
  const preposition = phase === 'before' ? 'before applying' : 'after applying'
  return `Change log ${phase} fingerprint mismatch ${preposition}: expected ${fingerprintLabel(
    expected
  )}, actual ${fingerprintLabel(actual)}`
}

async function assertCurrentSessionFingerprint(
  sessionId: string,
  expected: ChangeLogFingerprint,
  phase: 'before' | 'after'
): Promise<void> {
  const actual = await getChangeLogFingerprint(
    sessionId,
    SessionFingerprintContent.COMPUTED,
    expected.digest.algorithm
  )
  if (fingerprintsMatch(actual, expected)) {
    return
  }

  throw new Error(changeLogFingerprintMismatchMessage(actual, expected, phase))
}

async function assertChangeLogExportStable(
  sessionId: string,
  sourceChangeCount: number,
  expectedAfter: ChangeLogFingerprint
): Promise<void> {
  const finalChangeCount = await getChangeCount(sessionId)
  if (finalChangeCount !== sourceChangeCount) {
    throw new Error(
      `Change log export refused: session changed during export; expected ${sourceChangeCount} change(s), found ${finalChangeCount}`
    )
  }

  const finalAfter = await getChangeLogFingerprint(
    sessionId,
    SessionFingerprintContent.COMPUTED,
    expectedAfter.digest.algorithm
  )
  if (!fingerprintsMatch(finalAfter, expectedAfter)) {
    throw new Error(
      `Change log export refused: session fingerprint changed during export; expected ${fingerprintLabel(
        expectedAfter
      )}, found ${fingerprintLabel(finalAfter)}`
    )
  }
}

function createPrimitiveCounts(
  changes: NormalizedChangeLogEntry[]
): ChangeLogPrimitiveCounts {
  const counts: ChangeLogPrimitiveCounts = {
    total: changes.length,
    insert: 0,
    delete: 0,
    overwrite: 0,
    replace: 0,
    transform: 0,
  }
  for (const change of changes) {
    switch (change.kind) {
      case 'INSERT':
        counts.insert += 1
        break
      case 'DELETE':
        counts.delete += 1
        break
      case 'OVERWRITE':
        counts.overwrite += 1
        break
      case 'REPLACE':
        counts.replace += 1
        break
      case 'TRANSFORM':
        counts.transform += 1
        break
    }
  }
  return counts
}

function createExpectedSizeDelta(parsed: ParsedChangeLog): ChangeLogSizeDelta {
  const beforeByteLength = parseNonNegativeInt64(
    parsed.before.byteLength,
    'Change log before.byteLength'
  )
  const afterByteLength = parseNonNegativeInt64(
    parsed.after.byteLength,
    'Change log after.byteLength'
  )
  return {
    beforeByteLength: beforeByteLength.toString(),
    afterByteLength: afterByteLength.toString(),
    deltaBytes: (afterByteLength - beforeByteLength).toString(),
  }
}

function createTransformDescriptorPreviews(
  changes: NormalizedChangeLogEntry[]
): ChangeLogTransformDescriptorPreview[] {
  return changes.flatMap((change, index) => {
    if (change.kind !== 'TRANSFORM' || !change.transformDescriptor) {
      return []
    }
    return [
      {
        index,
        ...(change.serial !== undefined
          ? { serial: int64ToDecimal(change.serial) }
          : {}),
        offset: int64ToDecimal(change.offset),
        length: int64ToDecimal(change.length),
        transformId: change.transformDescriptor.transformId,
        ...(change.transformDescriptor.optionsJson
          ? { optionsJson: change.transformDescriptor.optionsJson }
          : {}),
        descriptorSource: 'data' as const,
      },
    ]
  })
}

function createRequiredPlugins(
  descriptors: ChangeLogTransformDescriptorPreview[]
): string[] {
  return Array.from(
    new Set(descriptors.map((descriptor) => descriptor.transformId))
  ).sort()
}

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}

function replayPreviewErrorMessage(preview: ChangeLogPreview): string {
  const issueSummary = preview.safetyIssues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message)
    .join('; ')
  return issueSummary
    ? `Change log preview found unsafe replay: ${issueSummary}`
    : 'Change log preview found unsafe replay'
}

function replayErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ChangeLogReplayError extends Error {
  readonly result: ApplyChangeLogResult

  constructor(message: string, result: ApplyChangeLogResult, cause?: unknown) {
    super(message)
    this.name = 'ChangeLogReplayError'
    this.result = result
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

function createChangeLogDocument(
  changes: ChangeLogEntry[],
  sourceChangeCount: number,
  unavailableChangeSerials: number[],
  before: ChangeLogFingerprint,
  after: ChangeLogFingerprint
): ChangeLogDocument {
  return {
    format: CHANGE_LOG_FORMAT,
    version: CHANGE_LOG_VERSION,
    complete: unavailableChangeSerials.length === 0,
    before,
    after,
    changeCount: changes.length.toString(),
    sourceChangeCount: sourceChangeCount.toString(),
    unavailableChangeCount: unavailableChangeSerials.length.toString(),
    unavailableChangeSerials: unavailableChangeSerials.map((serial) =>
      serial.toString()
    ),
    changes: changes.map(serializeChangeLogEntry),
  }
}

function serializeChangeLogEntry(entry: ChangeLogEntry): ChangeLogEntry {
  const serialized: ChangeLogEntry = {
    kind: entry.kind,
    offset: int64ToDecimal(entry.offset),
    length: int64ToDecimal(entry.length),
    data: entry.data,
  }
  if (entry.serial !== undefined) {
    serialized.serial = int64ToDecimal(entry.serial)
  }
  if (entry.groupId) {
    serialized.groupId = entry.groupId
  }
  return serialized
}

function createChangeLogSummary(
  sessionId: string,
  sourceChangeCount: number,
  unavailableChangeSerials: number[],
  before: ChangeLogFingerprint,
  after: ChangeLogFingerprint,
  changes?: ChangeLogEntry[],
  outputPath?: string
): ChangeLogResult {
  return {
    sessionId,
    format: CHANGE_LOG_FORMAT,
    version: CHANGE_LOG_VERSION,
    complete: unavailableChangeSerials.length === 0,
    before,
    after,
    changeCount: (changes?.length ?? sourceChangeCount).toString(),
    sourceChangeCount: sourceChangeCount.toString(),
    unavailableChangeCount: unavailableChangeSerials.length.toString(),
    unavailableChangeSerials: unavailableChangeSerials.map((serial) =>
      serial.toString()
    ),
    ...(changes ? { changes: changes.map(serializeChangeLogEntry) } : {}),
    outputPath,
  }
}

async function writeStreamText(
  stream: NodeJS.WritableStream,
  text: string
): Promise<void> {
  if (!stream.write(text)) {
    await once(stream, 'drain')
  }
}

async function syncFileToDisk(path: string): Promise<void> {
  const handle = await fs.open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncParentDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(dirname(path), 'r')
    await handle.sync()
  } catch {
    // Some filesystems/platforms do not support directory fsync through Node.
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function writeChangeLogDocumentFile(
  outputPath: string,
  overwriteExisting: boolean,
  sourceChangeCount: number,
  before: ChangeLogFingerprint,
  after: ChangeLogFingerprint,
  writeEntries: (
    writeEntry: (entry: ChangeLogEntry) => Promise<void>
  ) => Promise<CollectedChangeLogEntries>,
  verifyBeforeCommit?: () => Promise<void>
): Promise<CollectedChangeLogEntries> {
  if (!overwriteExisting) {
    try {
      await fs.access(outputPath)
      throw new Error(
        `Refusing to overwrite existing change log: ${outputPath}`
      )
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        throw error
      }
    }
  }

  const tempPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${Date.now()}.tmp`
  )
  const stream = createWriteStream(tempPath, {
    encoding: 'utf8',
    flags: 'wx',
  })
  let committed = false

  try {
    const metadata = {
      format: CHANGE_LOG_FORMAT,
      version: CHANGE_LOG_VERSION,
      complete: true,
      before,
      after,
      changeCount: sourceChangeCount.toString(),
      sourceChangeCount: sourceChangeCount.toString(),
      unavailableChangeCount: '0',
      unavailableChangeSerials: [],
    }
    const prefix = `${JSON.stringify(metadata, null, 2).replace(/\n}$/, ',\n  "changes": [')}\n`
    await writeStreamText(stream, prefix)

    let first = true
    const collected = await writeEntries(async (entry) => {
      const serialized = JSON.stringify(serializeChangeLogEntry(entry), null, 2)
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n')
      await writeStreamText(stream, `${first ? '' : ',\n'}${serialized}`)
      first = false
    })
    await writeStreamText(stream, '\n  ]\n}\n')
    stream.end()
    await finished(stream)

    assertCompleteChangeLog('export', collected.unavailableChangeSerials)
    await syncFileToDisk(tempPath)
    await verifyBeforeCommit?.()
    await fs.rename(tempPath, outputPath)
    await syncParentDirectory(outputPath)
    committed = true
    return collected
  } finally {
    if (!committed) {
      stream.destroy()
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
  }
}

export class OmegaEditToolkit {
  readonly host: string
  readonly port: number
  readonly autoStart: boolean
  readonly maxReadBytes: number
  readonly maxEditBytes: number
  readonly maxSearchResults: number
  readonly previewContextBytes: number
  readonly insecureAllowNonLoopback: boolean

  constructor(options: ToolkitOptions = {}) {
    this.host = options.host || DEFAULT_HOST
    this.port = options.port || DEFAULT_PORT
    this.autoStart = options.autoStart !== false
    this.maxReadBytes = options.maxReadBytes || DEFAULT_MAX_READ_BYTES
    this.maxEditBytes = options.maxEditBytes || DEFAULT_MAX_EDIT_BYTES
    this.maxSearchResults =
      options.maxSearchResults || DEFAULT_MAX_SEARCH_RESULTS
    this.previewContextBytes =
      options.previewContextBytes || DEFAULT_PREVIEW_CONTEXT_BYTES
    this.insecureAllowNonLoopback = options.insecureAllowNonLoopback === true
  }

  private async waitForServerToStop(timeoutMs: number = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      if (await isPortAvailable(this.port, this.host)) {
        return
      }

      await delay(100)
    }

    throw new Error(
      `OmegaEdit server did not stop on ${this.host}:${this.port} within ${timeoutMs}ms`
    )
  }

  private async connectToServer(): Promise<void> {
    resetClient()
    await getClient(this.port, this.host)
    await getServerInfo()
  }

  private async connectToRunningServer(): Promise<void> {
    try {
      await this.connectToServer()
    } catch (err) {
      resetClient()
      const connectionError = new Error(
        `OmegaEdit server is not running on ${this.host}:${this.port}`
      )
      ;(connectionError as Error & { cause?: unknown }).cause = err
      throw connectionError
    }
  }

  async ensureServerRunning(): Promise<void> {
    const portIsAvailable = await isPortAvailable(this.port, this.host)
    if (portIsAvailable) {
      if (!this.autoStart) {
        throw new Error(
          `OmegaEdit server is not running on ${this.host}:${this.port}`
        )
      }

      await startServer(
        this.port,
        this.host,
        undefined,
        this.insecureAllowNonLoopback
          ? { insecureAllowNonLoopback: true }
          : undefined
      )
      await this.connectToServer()
      return
    }

    try {
      await this.connectToServer()
      return
    } catch (error) {
      resetClient()
      if (!this.autoStart) {
        throw error
      }

      throw new Error(
        `Port ${this.port} on ${this.host} is occupied by a non-OmegaEdit service. Refusing to auto-start.`
      )
    }
  }

  async startServer(): Promise<object> {
    await this.ensureServerRunning()
    return await this.serverInfo()
  }

  async stopServer(): Promise<IServerControlResult> {
    await this.connectToRunningServer()
    const response = await stopServerGraceful()
    resetClient()
    if (response.responseCode === 0 || response.status === 'draining') {
      await this.waitForServerToStop()
      resetClient()
    }
    return response
  }

  async serverInfo(): Promise<object> {
    await this.connectToRunningServer()
    return await getServerInfo()
  }

  async createSession(
    filePath: string = '',
    sessionId: string = '',
    checkpointDirectory: string = ''
  ): Promise<{ sessionId: string; filePath: string }> {
    await this.ensureServerRunning()
    const response = await createSession(
      filePath,
      sessionId,
      checkpointDirectory
    )
    return {
      sessionId: response.getSessionId(),
      filePath,
    }
  }

  async destroySession(sessionId: string): Promise<{ sessionId: string }> {
    await this.ensureServerRunning()
    return { sessionId: await destroySession(sessionId) }
  }

  async sessionStatus(sessionId: string): Promise<SessionStatus> {
    await this.ensureServerRunning()

    const [
      computedSize,
      changeCount,
      undoCount,
      viewportCount,
      checkpointCount,
    ] = await Promise.all([
      getComputedFileSize(sessionId),
      getChangeCount(sessionId),
      getUndoCount(sessionId),
      getViewportCount(sessionId),
      this.getCheckpointCount(sessionId),
    ])

    let lastChange: SessionStatus['lastChange'] | undefined

    if (changeCount > 0) {
      const response = await getLastChange(sessionId)
      lastChange = {
        kind:
          changeKindNames.get(response.getKind()) || `${response.getKind()}`,
        offset: response.getOffset(),
        length: response.getLength(),
        data: encodeData(response.getData_asU8()),
      }
    }

    return {
      sessionId,
      computedSize,
      changeCount,
      undoCount,
      // The backend's UNDOS count is the undone-change stack, which is
      // exposed to editor users as redo stack depth.
      undoStackDepth: changeCount,
      redoStackDepth: undoCount,
      viewportCount,
      checkpointCount,
      lastChange,
    }
  }

  async assistantContext(
    sessionId: string,
    filePath?: string
  ): Promise<AssistantSessionContext> {
    const status = await this.sessionStatus(sessionId)
    const [rawPlugins, originalFingerprint] = await Promise.all([
      listClientTransformPlugins(),
      getChangeLogFingerprint(
        sessionId,
        SessionFingerprintContent.ORIGINAL
      ).catch(() => undefined),
    ])
    const plugins = rawPlugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      operation: plugin.operation,
      operationName:
        transformPluginOperationNames.get(plugin.operation) ||
        `${plugin.operation}`,
      support: plugin.support,
      supportName:
        transformPluginSupportNames.get(plugin.support) || `${plugin.support}`,
      flags: plugin.flags,
      abiVersion: plugin.abiVersion,
    }))

    return {
      version: ASSISTANT_CONTEXT_VERSION,
      session: {
        id: sessionId,
        uri: null,
        filePath: filePath || null,
        contentType: null,
        language: null,
      },
      sizes: {
        computed: status.computedSize,
        original: originalFingerprint
          ? int64ToDecimal(originalFingerprint.byteLength)
          : null,
      },
      dirty: status.changeCount > 0,
      selection: null,
      viewport: {
        count: status.viewportCount,
        activeViewportId: null,
        visibleOffset: null,
        visibleByteCount: null,
        bytesPerRow: null,
        offsetRadix: null,
        activePane: null,
        editMode: null,
        insertDirection: null,
      },
      history: {
        changeCount: status.changeCount,
        undoCount: status.undoStackDepth,
        redoCount: status.redoStackDepth,
        undoStackDepth: status.undoStackDepth,
        redoStackDepth: status.redoStackDepth,
        canUndo: status.undoStackDepth > 0,
        canRedo: status.redoStackDepth > 0,
        checkpointCount: status.checkpointCount,
        checkpointAvailable: status.checkpointCount > 0,
        savedChangeDepth: null,
        pendingChanges: status.undoStackDepth > 0,
        pendingOperation: null,
        pendingCount: 0,
      },
      transforms: {
        inFlight: false,
        available: plugins.length > 0,
        pluginCount: plugins.length,
        plugins: plugins.map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
          operation: plugin.operation,
          operationName: plugin.operationName,
          support: plugin.support,
          supportName: plugin.supportName,
          flags: plugin.flags,
          abiVersion: plugin.abiVersion,
        })),
      },
      changeLog: {
        format: CHANGE_LOG_FORMAT,
        version: CHANGE_LOG_VERSION,
        exportAvailable: true,
        applyAvailable: true,
        sourceChangeCount: status.changeCount,
        completeExportAvailable: true,
      },
      commands: cloneAssistantCommandSurfaces(),
    }
  }

  private async getCheckpointCount(sessionId: string): Promise<number> {
    const counts = await getCounts(sessionId, [CountKind.CHECKPOINTS])
    return counts[0]?.getCount() ?? 0
  }

  private async createChangeLogPreview(
    sessionId: string,
    parsed: ParsedChangeLog,
    inputPath: string | undefined,
    inspectSession: boolean
  ): Promise<ChangeLogPreview> {
    const safetyIssues: ChangeLogSafetyIssue[] = []
    const transformDescriptors = createTransformDescriptorPreviews(
      parsed.changes
    )
    const requiredPlugins = createRequiredPlugins(transformDescriptors)
    let missingPlugins: string[] = []
    let current: ChangeLogFingerprint | undefined
    let rollbackProtection: ChangeLogRollbackProtection = {
      available: false,
      strategy: 'not-inspected',
    }

    if (parsed.unavailableChangeSerials.length > 0) {
      safetyIssues.push({
        severity: 'error',
        code: 'unavailable-primitives',
        message: `${incompleteChangeLogMessage(
          'apply'
        )}${describeUnavailableSerials(parsed.unavailableChangeSerials)}`,
      })
    }

    if (inspectSession) {
      current = await getChangeLogFingerprint(
        sessionId,
        SessionFingerprintContent.COMPUTED,
        parsed.before.digest.algorithm
      )
      if (!fingerprintsMatch(current, parsed.before)) {
        safetyIssues.push({
          severity: 'error',
          code: 'before-fingerprint-mismatch',
          message: changeLogFingerprintMismatchMessage(
            current,
            parsed.before,
            'before'
          ),
        })
      }

      const [targetChangeCount, checkpointCount, plugins] = await Promise.all([
        getChangeCount(sessionId),
        this.getCheckpointCount(sessionId),
        listClientTransformPlugins(),
      ])
      rollbackProtection = {
        available: true,
        strategy: 'restore-to-change-count',
        targetChangeCount,
        checkpointCount,
      }

      const installedPluginIds = new Set(plugins.map((plugin) => plugin.id))
      missingPlugins = requiredPlugins.filter(
        (pluginId) => !installedPluginIds.has(pluginId)
      )
      for (const pluginId of missingPlugins) {
        safetyIssues.push({
          severity: 'error',
          code: 'missing-transform-plugin',
          message: `Required transform plugin is unavailable: ${pluginId}`,
        })
      }
    }

    const unavailableSerials = parsed.unavailableChangeSerials.map((serial) =>
      serial.toString()
    )
    const errorCount = safetyIssues.filter(
      (issue) => issue.severity === 'error'
    ).length

    return {
      sessionId,
      ...(inputPath ? { inputPath } : {}),
      format: CHANGE_LOG_FORMAT,
      version: CHANGE_LOG_VERSION,
      complete: parsed.complete,
      canApply: errorCount === 0,
      primitiveCounts: createPrimitiveCounts(parsed.changes),
      before: parsed.before,
      after: parsed.after,
      ...(current ? { current } : {}),
      expectedSize: createExpectedSizeDelta(parsed),
      transformDescriptors,
      requiredPlugins,
      missingPlugins: uniqueSortedStrings(missingPlugins),
      unavailablePrimitives: {
        count: parsed.unavailableChangeCount,
        serials: unavailableSerials,
      },
      rollbackProtection,
      safetyIssues,
    }
  }

  async previewChangeLog(
    request: PreviewChangeLogRequest
  ): Promise<ChangeLogPreview> {
    const parsed = await readChangeLogRequest(request)
    await this.ensureServerRunning()
    return await this.createChangeLogPreview(
      request.sessionId,
      parsed,
      request.inputPath,
      true
    )
  }

  async createCheckpoint(sessionId: string): Promise<CheckpointResult> {
    await this.ensureServerRunning()
    return {
      sessionId,
      checkpointCount: await createClientCheckpoint(sessionId),
    }
  }

  async rollbackCheckpoint(
    sessionId: string
  ): Promise<RollbackCheckpointResult> {
    await this.ensureServerRunning()
    const existingCount = await this.getCheckpointCount(sessionId)
    if (existingCount <= 0) {
      return {
        sessionId,
        rolledBack: false,
        checkpointCount: 0,
      }
    }

    return {
      sessionId,
      rolledBack: true,
      checkpointCount: await destroyClientCheckpoint(sessionId),
    }
  }

  async restoreCheckpoint(sessionId: string): Promise<RestoreCheckpointResult> {
    await this.ensureServerRunning()
    const existingCount = await this.getCheckpointCount(sessionId)
    if (existingCount <= 0) {
      return {
        sessionId,
        restored: false,
        checkpointCount: 0,
        changeCount: await getChangeCount(sessionId),
        discardedChangeCount: 0,
      }
    }

    const response = await restoreClientCheckpoint(sessionId)
    return {
      sessionId: response.sessionId,
      restored: true,
      checkpointCount: response.checkpointCount,
      changeCount: response.changeCount,
      discardedChangeCount: response.discardedChangeCount,
    }
  }

  async exportChangeLog(
    sessionId: string,
    outputPath?: string,
    overwriteExisting: boolean = false
  ): Promise<ChangeLogResult> {
    await this.ensureServerRunning()

    await assertSessionModelValidForChangeLogExport(sessionId)
    const before = await getChangeLogFingerprint(
      sessionId,
      SessionFingerprintContent.ORIGINAL
    )
    const sourceChangeCount = await getChangeCount(sessionId)
    const after = await getChangeLogFingerprint(
      sessionId,
      SessionFingerprintContent.COMPUTED,
      before.digest.algorithm
    )

    if (outputPath) {
      const collected = await writeChangeLogDocumentFile(
        outputPath,
        overwriteExisting,
        sourceChangeCount,
        before,
        after,
        async (writeEntry) =>
          await collectChangeLogEntries(
            sessionId,
            sourceChangeCount,
            writeEntry
          ),
        async () =>
          await assertChangeLogExportStable(sessionId, sourceChangeCount, after)
      )
      return createChangeLogSummary(
        sessionId,
        sourceChangeCount,
        collected.unavailableChangeSerials,
        before,
        after,
        undefined,
        outputPath
      )
    }

    const collected = await collectChangeLogEntries(
      sessionId,
      sourceChangeCount
    )
    assertCompleteChangeLog('export', collected.unavailableChangeSerials)
    await assertChangeLogExportStable(sessionId, sourceChangeCount, after)
    const document = createChangeLogDocument(
      collected.changes ?? [],
      sourceChangeCount,
      collected.unavailableChangeSerials,
      before,
      after
    )

    return createChangeLogSummary(
      sessionId,
      sourceChangeCount,
      collected.unavailableChangeSerials,
      document.before,
      document.after,
      document.changes
    )
  }

  async applyChangeLog(
    request: ApplyChangeLogRequest
  ): Promise<ApplyChangeLogResult> {
    const parsed = await readChangeLogRequest(request)
    const { changes } = parsed
    const inputChangeCount = changes.length

    if (request.dryRun) {
      const preview = await this.createChangeLogPreview(
        request.sessionId,
        parsed,
        request.inputPath,
        false
      )
      return {
        sessionId: request.sessionId,
        applied: false,
        appliedCount: 0,
        changeCount: 0,
        inputChangeCount,
        inputPath: request.inputPath,
        preview,
        rollback: {
          attempted: false,
        },
      }
    }

    await this.ensureServerRunning()
    const preview = await this.createChangeLogPreview(
      request.sessionId,
      parsed,
      request.inputPath,
      true
    )

    const startChangeCount =
      preview.rollbackProtection.targetChangeCount ??
      (await getChangeCount(request.sessionId))
    const getFinalFingerprint = async () =>
      await getChangeLogFingerprint(
        request.sessionId,
        SessionFingerprintContent.COMPUTED,
        parsed.after.digest.algorithm
      ).catch(() => undefined)
    const createReplayResult = (
      applied: boolean,
      appliedCount: number,
      rollback: ApplyChangeLogResult['rollback'],
      finalFingerprint?: ChangeLogFingerprint
    ): ApplyChangeLogResult => ({
      sessionId: request.sessionId,
      applied,
      appliedCount,
      changeCount: appliedCount,
      inputChangeCount,
      inputPath: request.inputPath,
      preview,
      rollback,
      ...(finalFingerprint ? { finalFingerprint } : {}),
    })

    if (!preview.canApply) {
      throw new ChangeLogReplayError(
        replayPreviewErrorMessage(preview),
        createReplayResult(
          false,
          0,
          {
            attempted: false,
            targetChangeCount: startChangeCount,
          },
          preview.current
        )
      )
    }

    let appliedChangeCount = 0
    try {
      const applyChange = async (change: NormalizedChangeLogEntry) => {
        const offset = normalizeNonNegativeInt64ForClient(
          change.offset,
          'change log entry offset'
        )
        const length = normalizeNonNegativeInt64ForClient(
          change.length,
          'change log entry length'
        )
        switch (change.kind) {
          case 'INSERT':
            await insert(
              request.sessionId,
              offset,
              Buffer.from(change.data, 'hex')
            )
            return true
          case 'DELETE':
            await del(request.sessionId, offset, length)
            return true
          case 'OVERWRITE':
            await overwrite(
              request.sessionId,
              offset,
              Buffer.from(change.data, 'hex')
            )
            return true
          case 'REPLACE':
            await replace(
              request.sessionId,
              offset,
              length,
              Buffer.from(change.data, 'hex')
            )
            return true
          case 'TRANSFORM': {
            const descriptor = change.transformDescriptor
            if (!descriptor) {
              throw new Error('TRANSFORM change data was not normalized')
            }
            const computedFileSizeBefore = await getComputedFileSize(
              request.sessionId
            )
            const response = await applyClientTransformPlugin(
              request.sessionId,
              descriptor.transformId,
              offset,
              length,
              descriptor.optionsJson
            )
            if (!response.contentChanged) {
              throw new Error(
                `TRANSFORM ${descriptor.transformId} replay produced no content change`
              )
            }
            const computedFileSizeAfter = await getComputedFileSize(
              request.sessionId
            )
            assertTransformReplayResponse(
              descriptor,
              offset,
              length,
              computedFileSizeBefore,
              computedFileSizeAfter,
              response
            )
            return true
          }
        }
      }
      const applyAndCountChange = async (change: NormalizedChangeLogEntry) => {
        if (await applyChange(change)) {
          appliedChangeCount += 1
        }
      }
      if (changes.length > 0) {
        let pendingBatch: NormalizedChangeLogEntry[] = []
        const flushBatch = async () => {
          if (pendingBatch.length === 0) {
            return
          }

          const batch = pendingBatch
          pendingBatch = []
          await runSessionTransaction(request.sessionId, async () => {
            for (const change of batch) {
              await applyAndCountChange(change)
            }
          })
        }

        for (const change of changes) {
          if (change.kind === 'TRANSFORM') {
            await flushBatch()
            await applyAndCountChange(change)
          } else {
            pendingBatch.push(change)
          }
        }
        await flushBatch()
      }

      await assertCurrentSessionFingerprint(
        request.sessionId,
        parsed.after,
        'after'
      )
    } catch (error) {
      let finalFingerprint: ChangeLogFingerprint | undefined
      try {
        const rolledBack = await rollbackSessionToChangeCount(
          request.sessionId,
          startChangeCount
        )
        finalFingerprint = await getFinalFingerprint()
        throw new ChangeLogReplayError(
          replayErrorMessage(error),
          createReplayResult(
            false,
            appliedChangeCount,
            {
              attempted: true,
              succeeded: true,
              rolledBack,
              targetChangeCount: startChangeCount,
            },
            finalFingerprint
          ),
          error
        )
      } catch (rollbackError) {
        if (rollbackError instanceof ChangeLogReplayError) {
          throw rollbackError
        }
        finalFingerprint = await getFinalFingerprint()
        const combinedError = changeLogApplyErrorWithRollbackFailure(
          error,
          rollbackError
        )
        throw new ChangeLogReplayError(
          combinedError.message,
          createReplayResult(
            false,
            appliedChangeCount,
            {
              attempted: true,
              succeeded: false,
              targetChangeCount: startChangeCount,
              error: replayErrorMessage(rollbackError),
            },
            finalFingerprint
          ),
          error
        )
      }
    }

    const finalFingerprint = await getFinalFingerprint()
    return {
      sessionId: request.sessionId,
      applied: true,
      appliedCount: appliedChangeCount,
      changeCount: appliedChangeCount,
      inputChangeCount,
      inputPath: request.inputPath,
      preview,
      rollback: {
        attempted: false,
        targetChangeCount: startChangeCount,
      },
      ...(finalFingerprint ? { finalFingerprint } : {}),
    }
  }

  async readRange(
    sessionId: string,
    offset: number,
    length: number
  ): Promise<ReadRangeResult> {
    assertNonNegativeInteger('offset', offset)
    assertNonNegativeInteger('length', length)

    if (length > this.maxReadBytes) {
      throw new Error(
        `length exceeds configured maximum of ${this.maxReadBytes} bytes`
      )
    }

    await this.ensureServerRunning()

    const computedSize = await getComputedFileSize(sessionId)
    if (offset > computedSize) {
      throw new Error('offset is beyond the end of the session')
    }

    const actualLength = Math.min(length, Math.max(0, computedSize - offset))
    const data =
      actualLength === 0
        ? new Uint8Array(0)
        : await getSegment(sessionId, offset, actualLength)

    return {
      sessionId,
      offset,
      requestedLength: length,
      actualLength,
      data: encodeData(data),
    }
  }

  async profileRange(
    sessionId: string,
    offset: number,
    length: number
  ): Promise<ProfileRangeResult> {
    assertNonNegativeInteger('offset', offset)
    assertNonNegativeInteger('length', length)

    if (length === 0) {
      throw new Error('length must be greater than 0')
    }
    if (length > this.maxReadBytes) {
      throw new Error(
        `length exceeds configured maximum of ${this.maxReadBytes} bytes`
      )
    }

    await this.ensureServerRunning()

    const computedSize = await getComputedFileSize(sessionId)
    if (offset > computedSize) {
      throw new Error('offset is beyond the end of the session')
    }

    const actualLength = Math.min(length, Math.max(0, computedSize - offset))
    let frequency: number[]
    let contentTypeValue = 'application/octet-stream'
    if (actualLength === 0) {
      frequency = new Array(257).fill(0)
    } else {
      const contentTypeLength = Math.min(computedSize, 16 * 1024)
      const [rangeProfile, contentType] = await Promise.all([
        profileSession(sessionId, offset, actualLength),
        getContentType(sessionId, 0, contentTypeLength),
      ])
      frequency = rangeProfile
      contentTypeValue = contentType.getContentType()
    }

    const totalBytes = frequency
      .slice(0, 256)
      .reduce((sum, count) => sum + count, 0)
    const asciiBytes = numAscii(frequency)
    const topBytes = frequency
      .slice(0, 256)
      .map((count, byte) => ({
        byte,
        hex: `0x${byte.toString(16).padStart(2, '0').toUpperCase()}`,
        count,
        percent: totalBytes > 0 ? (count / totalBytes) * 100 : 0,
        printable:
          byte >= 0x20 && byte <= 0x7e
            ? byte === 0x20
              ? 'SP'
              : String.fromCharCode(byte)
            : undefined,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.byte - b.byte)
      .slice(0, 10)

    return {
      sessionId,
      offset,
      requestedLength: length,
      actualLength,
      totalBytes,
      asciiBytes,
      nonAsciiBytes: totalBytes - asciiBytes,
      asciiPercent: totalBytes > 0 ? (asciiBytes / totalBytes) * 100 : 0,
      dosLineEndings: frequency[PROFILE_DOS_EOL] || 0,
      contentType: contentTypeValue,
      frequency,
      topBytes,
    }
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const offset = request.offset ?? 0
    const length = request.length ?? 0
    const requestedLimit = request.limit ?? 100

    assertNonNegativeInteger('offset', offset)
    assertNonNegativeInteger('length', length)
    assertNonNegativeInteger('limit', requestedLimit)

    if (requestedLimit === 0 || requestedLimit > this.maxSearchResults) {
      throw new Error(
        `limit must be between 1 and ${this.maxSearchResults} results`
      )
    }

    await this.ensureServerRunning()

    const pattern =
      typeof request.pattern === 'string'
        ? parseInputData(request.pattern, request.inputEncoding || 'utf8')
        : request.pattern

    if (pattern.length === 0) {
      throw new Error('pattern must not be empty')
    }

    const matches = await searchSession(
      request.sessionId,
      pattern,
      searchCaseFoldingForRequest(request.caseInsensitive),
      request.reverse || false,
      offset,
      length,
      requestedLimit
    )

    return {
      sessionId: request.sessionId,
      offset,
      length,
      limit: requestedLimit,
      matches,
    }
  }

  async replaceSession(
    request: ReplaceSessionRequest
  ): Promise<ReplaceSessionResult> {
    const offset = request.offset ?? 0
    const length = request.length ?? 0
    const requestedLimit = request.limit ?? 0
    const frontToBack = request.frontToBack !== false
    const overwriteOnly = request.overwriteOnly || false

    assertNonNegativeInteger('offset', offset)
    assertNonNegativeInteger('length', length)
    assertNonNegativeInteger('limit', requestedLimit)

    if (requestedLimit !== 0 && requestedLimit > this.maxSearchResults) {
      throw new Error(
        `limit must be between 0 and ${this.maxSearchResults} results`
      )
    }

    const pattern =
      typeof request.pattern === 'string'
        ? parseInputData(request.pattern, request.inputEncoding || 'utf8')
        : request.pattern
    const replacement =
      typeof request.replacement === 'string'
        ? parseInputData(request.replacement, request.inputEncoding || 'utf8')
        : request.replacement

    if (pattern.length === 0) {
      throw new Error('pattern must not be empty')
    }
    if (replacement.length > this.maxEditBytes) {
      throw new Error(
        `replacement exceeds configured maximum of ${this.maxEditBytes} bytes`
      )
    }

    await this.ensureServerRunning()

    const replacedCount = await replaceWholeSession(
      request.sessionId,
      pattern,
      replacement,
      searchCaseFoldingForRequest(request.caseInsensitive),
      request.reverse || false,
      offset,
      length,
      requestedLimit,
      frontToBack,
      overwriteOnly
    )

    return {
      sessionId: request.sessionId,
      offset,
      length,
      limit: requestedLimit,
      replacedCount,
      frontToBack,
      overwriteOnly,
    }
  }

  async listTransformPlugins(): Promise<TransformPluginInfoResult[]> {
    await this.ensureServerRunning()

    return (await listClientTransformPlugins()).map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      operation: plugin.operation,
      operationName:
        transformPluginOperationNames.get(plugin.operation) ||
        `${plugin.operation}`,
      support: plugin.support,
      supportName:
        transformPluginSupportNames.get(plugin.support) || `${plugin.support}`,
      flags: plugin.flags,
      abiVersion: plugin.abiVersion,
    }))
  }

  async applyTransformPlugin(
    request: ApplyTransformPluginRequest
  ): Promise<ApplyTransformPluginResult> {
    const offset = request.offset ?? 0
    const length = request.length ?? 0

    assertNonNegativeInteger('offset', offset)
    assertNonNegativeInteger('length', length)

    if (!request.pluginId) {
      throw new Error('pluginId is required')
    }

    await this.ensureServerRunning()

    const response = await applyClientTransformPlugin(
      request.sessionId,
      request.pluginId,
      offset,
      length,
      request.optionsJson,
      { signal: request.signal }
    )

    return {
      sessionId: response.sessionId,
      pluginId: response.pluginId,
      offset: response.offset,
      length: response.length,
      operation: response.operation,
      operationName:
        transformPluginOperationNames.get(response.operation) ||
        `${response.operation}`,
      contentChanged: response.contentChanged,
      ...(response.serial === undefined ? {} : { serial: response.serial }),
      computedFileSize: response.computedFileSize,
      replacementLength: response.replacementLength,
      transformDescriptor: createTransformPrimitiveDescriptorResult(
        response.pluginId,
        request.optionsJson
      ),
      resultLabel: response.resultLabel,
      resultMimeType: response.resultMimeType,
      result: encodeData(response.result),
    }
  }

  private normalizePatchRequest(request: PatchRequest): {
    removeLength: number
    data: Uint8Array
  } {
    assertNonNegativeInteger('offset', request.offset)

    const data = request.data || new Uint8Array(0)
    if (data.length > this.maxEditBytes) {
      throw new Error(
        `patch payload exceeds configured maximum of ${this.maxEditBytes} bytes`
      )
    }

    switch (request.kind) {
      case 'insert':
        if (data.length === 0) throw new Error('insert requires data')
        return { removeLength: 0, data }
      case 'overwrite':
        if (data.length === 0) throw new Error('overwrite requires data')
        return { removeLength: data.length, data }
      case 'delete': {
        const removeLength = request.removeLength || 0
        if (removeLength <= 0) {
          throw new Error('delete requires removeLength > 0')
        }
        return { removeLength, data }
      }
      case 'replace': {
        const removeLength = request.removeLength || 0
        if (removeLength < 0) {
          throw new Error('replace requires removeLength >= 0')
        }
        if (data.length === 0 && removeLength === 0) {
          throw new Error('replace requires data and/or removeLength')
        }
        return { removeLength, data }
      }
    }
  }

  private async buildPatchPreview(
    request: PatchRequest,
    normalizedRequest: { removeLength: number; data: Uint8Array }
  ): Promise<PatchPreview> {
    await this.ensureServerRunning()

    const { removeLength, data } = normalizedRequest
    const sessionSize = await getComputedFileSize(request.sessionId)
    const previewContext = Math.min(
      request.previewContext || this.previewContextBytes,
      this.previewContextBytes
    )

    if (request.offset > sessionSize) {
      throw new Error('offset is beyond the end of the session')
    }
    if (request.offset + removeLength > sessionSize) {
      throw new Error('patch extends beyond the end of the session')
    }

    const targetBefore =
      removeLength === 0
        ? new Uint8Array(0)
        : await getSegment(request.sessionId, request.offset, removeLength)

    const targetAfter = request.kind === 'delete' ? new Uint8Array(0) : data

    const previewOffset = Math.max(0, request.offset - previewContext)
    const previewEnd = Math.min(
      sessionSize,
      request.offset + removeLength + previewContext
    )
    const previewBeforeLength = previewEnd - previewOffset
    const previewBefore =
      previewBeforeLength === 0
        ? new Uint8Array(0)
        : await getSegment(
            request.sessionId,
            previewOffset,
            previewBeforeLength
          )

    const relativeOffset = request.offset - previewOffset
    const relativeEnd = relativeOffset + removeLength
    const previewAfter = concatBytes(
      previewBefore.subarray(0, relativeOffset),
      targetAfter,
      previewBefore.subarray(relativeEnd)
    )

    return {
      sessionId: request.sessionId,
      kind: request.kind,
      offset: request.offset,
      removeLength,
      insertLength: targetAfter.length,
      previewOffset,
      previewBeforeLength: previewBefore.length,
      previewAfterLength: previewAfter.length,
      targetBefore: encodeData(targetBefore),
      targetAfter: encodeData(targetAfter),
      previewBefore: encodeData(previewBefore),
      previewAfter: encodeData(previewAfter),
    }
  }

  async previewPatch(request: PatchRequest): Promise<PatchPreview> {
    return this.buildPatchPreview(request, this.normalizePatchRequest(request))
  }

  async applyPatch(request: PatchRequest): Promise<PatchResult> {
    const normalizedRequest = this.normalizePatchRequest(request)
    const preview = await this.buildPatchPreview(request, normalizedRequest)

    if (request.dryRun) {
      return {
        applied: false,
        preview,
      }
    }

    const { removeLength, data } = normalizedRequest

    let serial: number
    switch (request.kind) {
      case 'insert':
        serial = await insert(request.sessionId, request.offset, data)
        break
      case 'overwrite':
        serial = await overwrite(request.sessionId, request.offset, data)
        break
      case 'delete':
        serial = await del(request.sessionId, request.offset, removeLength)
        break
      case 'replace':
        serial = await replace(
          request.sessionId,
          request.offset,
          removeLength,
          data
        )
        break
    }

    return {
      applied: true,
      serial,
      preview,
    }
  }

  async undo(sessionId: string): Promise<{ serial: number }> {
    await this.ensureServerRunning()
    return { serial: await undo(sessionId) }
  }

  async redo(sessionId: string): Promise<{ serial: number }> {
    await this.ensureServerRunning()
    return { serial: await redo(sessionId) }
  }

  async saveSession(
    sessionId: string,
    outputPath: string,
    overwriteExisting: boolean = false
  ): Promise<{ filePath: string; status: number }> {
    await this.ensureServerRunning()
    const response = await saveSession(
      sessionId,
      outputPath,
      overwriteExisting ? IOFlags.OVERWRITE : IOFlags.UNSPECIFIED
    )
    return {
      filePath: response.getFilePath(),
      status: response.getSaveStatus(),
    }
  }

  async exportRange(
    sessionId: string,
    offset: number,
    length: number,
    outputPath: string,
    overwriteExisting: boolean = false
  ): Promise<{
    filePath: string
    status: number
    offset: number
    length: number
  }> {
    assertNonNegativeInteger('offset', offset)
    assertNonNegativeInteger('length', length)
    if (length > this.maxReadBytes) {
      throw new Error(
        `length exceeds configured maximum of ${this.maxReadBytes} bytes`
      )
    }

    await this.ensureServerRunning()
    const response = await saveSession(
      sessionId,
      outputPath,
      overwriteExisting ? IOFlags.OVERWRITE : IOFlags.UNSPECIFIED,
      offset,
      length
    )
    return {
      filePath: response.getFilePath(),
      status: response.getSaveStatus(),
      offset,
      length,
    }
  }
}
