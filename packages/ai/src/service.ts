import {
  ChangeKind,
  CountKind,
  delay,
  type IServerControlResult,
  IOFlags,
  SessionFingerprintContent,
  TransformPluginOperation,
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
  runSessionTransaction,
  saveSession,
  searchSession,
  startServer,
  stopServerGraceful,
  undo,
} from '@omega-edit/client'
import * as fs from 'node:fs/promises'
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
  ApplyTransformPluginRequest,
  ApplyTransformPluginResult,
  ApplyChangeLogRequest,
  ApplyChangeLogResult,
  ChangeLogDocument,
  ChangeLogEntry,
  ChangeLogFingerprint,
  ChangeLogResult,
  CheckpointResult,
  PatchPreview,
  PatchRequest,
  PatchResult,
  ProfileRangeResult,
  ReadRangeResult,
  ReplaceSessionRequest,
  ReplaceSessionResult,
  RollbackCheckpointResult,
  SearchRequest,
  SearchResult,
  SessionStatus,
  ToolkitOptions,
  TransformPluginInfoResult,
} from './types'

const MAX_CHANGE_LOG_ENTRIES = 100_000
const MAX_CHANGE_LOG_ENTRY_BYTES = 32 * 1024 * 1024
const MAX_CHANGE_LOG_BYTES = MAX_CHANGE_LOG_ENTRY_BYTES * 3
const MAX_CHANGE_LOG_JSON_NESTING = 256
const CHANGE_LOG_FORMAT = 'omega-edit.change-log'
const CHANGE_LOG_VERSION = 2
const DEFAULT_CHANGE_LOG_DIGEST_ALGORITHM = 'sha256'
const GRPC_NOT_FOUND = 5

interface CollectedChangeLogEntries {
  changes: ChangeLogEntry[]
  unavailableChangeSerials: number[]
}

interface ParsedChangeLog {
  changes: ChangeLogEntry[]
  before?: ChangeLogFingerprint
  after?: ChangeLogFingerprint
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

function isFiniteInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value)
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!isFiniteInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  if (entries.length > MAX_CHANGE_LOG_ENTRIES) {
    throw new Error(
      `Change log has too many entries (${entries.length.toLocaleString()})`
    )
  }

  const normalized = entries.map((entry, index) =>
    normalizeChangeLogEntry(entry, index)
  )
  validateChangeLogMetadata(normalized)
  if (document) {
    validateChangeLogDocumentMetadata(document, normalized)
    return {
      changes: normalized,
      before: normalizeChangeLogFingerprint(document.before, 'before'),
      after: normalizeChangeLogFingerprint(document.after, 'after'),
    }
  }
  return { changes: normalized }
}

function readDocumentCount(
  document: Record<string, unknown>,
  key: string
): number {
  const value = document[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Change log ${key} must be a non-negative safe integer`)
  }
  return value
}

function normalizeUnavailableChangeSerials(
  value: unknown,
  sourceChangeCount: number
): number[] {
  if (!Array.isArray(value)) {
    throw new Error('Change log unavailableChangeSerials must be an array')
  }

  const seen = new Set<number>()
  return value.map((serial, index) => {
    if (
      typeof serial !== 'number' ||
      !Number.isSafeInteger(serial) ||
      serial <= 0
    ) {
      throw new Error(
        `Change log unavailableChangeSerials[${index}] must be a positive safe integer`
      )
    }
    if (serial > sourceChangeCount) {
      throw new Error(
        `Change log unavailableChangeSerials[${index}] exceeds sourceChangeCount`
      )
    }
    if (seen.has(serial)) {
      throw new Error(
        `Change log unavailableChangeSerials[${index}] duplicates serial ${serial}`
      )
    }
    seen.add(serial)
    return serial
  })
}

function normalizeChangeLogFingerprint(
  value: unknown,
  key: 'before' | 'after'
): ChangeLogFingerprint {
  if (!isRecord(value)) {
    throw new Error(`Change log ${key} fingerprint must be an object`)
  }

  const byteLength = value.byteLength
  if (
    typeof byteLength !== 'number' ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    throw new Error(
      `Change log ${key}.byteLength must be a non-negative safe integer`
    )
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
): void {
  if (typeof document.complete !== 'boolean') {
    throw new Error('Change log complete must be a boolean')
  }

  const changeCount = readDocumentCount(document, 'changeCount')
  const sourceChangeCount = readDocumentCount(document, 'sourceChangeCount')
  const unavailableChangeCount = readDocumentCount(
    document,
    'unavailableChangeCount'
  )
  if (changeCount !== changes.length) {
    throw new Error('Change log changeCount must match changes length')
  }
  if (sourceChangeCount < changeCount) {
    throw new Error('Change log sourceChangeCount must cover changeCount')
  }

  const unavailableChangeSerials = normalizeUnavailableChangeSerials(
    document.unavailableChangeSerials,
    sourceChangeCount
  )
  if (unavailableChangeCount !== unavailableChangeSerials.length) {
    throw new Error(
      'Change log unavailableChangeCount must match unavailableChangeSerials length'
    )
  }
  if (document.complete !== (unavailableChangeCount === 0)) {
    throw new Error(
      'Change log complete must match unavailable change metadata'
    )
  }

  assertCompleteChangeLog('apply', unavailableChangeSerials)
}

function normalizeChangeLogEntry(
  entry: unknown,
  index: number
): ChangeLogEntry {
  if (!isRecord(entry)) {
    throw new Error(`Change log entry ${index} must be an object`)
  }

  const {
    kind,
    offset,
    length,
    serial,
    data,
    groupId,
    transformId,
    optionsJson,
    replacementLength,
    computedFileSizeBefore,
    computedFileSizeAfter,
  } = entry
  if (
    kind !== 'INSERT' &&
    kind !== 'DELETE' &&
    kind !== 'OVERWRITE' &&
    kind !== 'REPLACE' &&
    kind !== 'TRANSFORM'
  ) {
    throw new Error(`Change log entry ${index} has an unsupported kind`)
  }
  if (typeof offset !== 'number') {
    throw new Error(`Change log entry ${index} offset must be a number`)
  }
  if (typeof length !== 'number') {
    throw new Error(`Change log entry ${index} length must be a number`)
  }
  assertNonNegativeInteger(`change log entry ${index} offset`, offset)
  assertNonNegativeInteger(`change log entry ${index} length`, length)

  if (kind === 'TRANSFORM' && data !== undefined && data !== '') {
    throw new Error(`Change log entry ${index} TRANSFORM does not carry data`)
  }

  const dataBytes =
    kind === 'TRANSFORM'
      ? new Uint8Array(0)
      : typeof data === 'string'
        ? parseInputData(data, 'hex')
        : new Uint8Array(0)
  if ((kind === 'INSERT' || kind === 'OVERWRITE') && dataBytes.length === 0) {
    throw new Error(`Change log entry ${index} ${kind} requires data`)
  }
  if (dataBytes.length > MAX_CHANGE_LOG_ENTRY_BYTES) {
    throw new Error(
      `Change log entry ${index} data exceeds ${MAX_CHANGE_LOG_ENTRY_BYTES.toLocaleString()} bytes`
    )
  }

  const normalized: ChangeLogEntry = {
    kind,
    offset,
    length,
    data: Buffer.from(dataBytes).toString('hex'),
  }
  if (kind === 'TRANSFORM') {
    if (typeof transformId !== 'string' || !transformId.trim()) {
      throw new Error(
        `Change log entry ${index} TRANSFORM requires transformId`
      )
    }
    normalized.transformId = transformId.trim()

    if (optionsJson !== undefined) {
      if (typeof optionsJson !== 'string') {
        throw new Error(
          `Change log entry ${index} optionsJson must be a string`
        )
      }
      if (Buffer.byteLength(optionsJson, 'utf8') > MAX_CHANGE_LOG_ENTRY_BYTES) {
        throw new Error(
          `Change log entry ${index} optionsJson exceeds ${MAX_CHANGE_LOG_ENTRY_BYTES.toLocaleString()} bytes`
        )
      }
      normalized.optionsJson = optionsJson
    }

    for (const [key, value] of Object.entries({
      replacementLength,
      computedFileSizeBefore,
      computedFileSizeAfter,
    }) as Array<
      [
        (
          | 'replacementLength'
          | 'computedFileSizeBefore'
          | 'computedFileSizeAfter'
        ),
        unknown,
      ]
    >) {
      if (value === undefined) {
        continue
      }
      if (typeof value !== 'number') {
        throw new Error(`Change log entry ${index} ${key} must be a number`)
      }
      assertNonNegativeInteger(`change log entry ${index} ${key}`, value)
      normalized[key] = value
    }
  }
  if (serial !== undefined) {
    if (
      typeof serial !== 'number' ||
      !Number.isSafeInteger(serial) ||
      serial <= 0
    ) {
      throw new Error(
        `Change log entry ${index} serial must be a positive safe integer`
      )
    }
    normalized.serial = serial
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
  const stat = await fs.stat(inputPath)
  if (stat.size > MAX_CHANGE_LOG_BYTES) {
    throw new Error(
      `Change log is too large (${stat.size.toLocaleString()} bytes)`
    )
  }

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

    return {
      serial: change.getSerial(),
      kind,
      offset: change.getOffset(),
      length: change.getLength(),
      data: '',
      transformId: transform.transformId,
      ...(transform.optionsJson !== undefined
        ? { optionsJson: transform.optionsJson }
        : {}),
      replacementLength: transform.replacementLength,
      computedFileSizeBefore: transform.computedFileSizeBefore,
      computedFileSizeAfter: transform.computedFileSizeAfter,
    }
  }

  return {
    serial: change.getSerial(),
    kind,
    offset: change.getOffset(),
    length: kind === 'INSERT' ? 0 : change.getLength(),
    data: Buffer.from(
      kind === 'DELETE' ? new Uint8Array(0) : change.getData_asU8()
    ).toString('hex'),
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
  sourceChangeCount: number
): Promise<CollectedChangeLogEntries> {
  const changes: ChangeLogEntry[] = []
  const unavailableChangeSerials: number[] = []
  for (let serial = 1; serial <= sourceChangeCount; serial += 1) {
    try {
      changes.push(
        changeDetailsToLogEntry(await getChangeDetails(sessionId, serial))
      )
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
  let currentChangeCount = await getChangeCount(sessionId)
  let rolledBack = false
  while (currentChangeCount > targetChangeCount) {
    await undo(sessionId)
    rolledBack = true
    const nextChangeCount = await getChangeCount(sessionId)
    if (nextChangeCount >= currentChangeCount) {
      throw new Error(
        `Rollback did not reduce change count from ${currentChangeCount}`
      )
    }
    currentChangeCount = nextChangeCount
  }

  if (currentChangeCount !== targetChangeCount) {
    throw new Error(
      `Rollback ended at change count ${currentChangeCount}, expected ${targetChangeCount}`
    )
  }

  return rolledBack
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
    byteLength: response.fingerprint.byteLength,
    digest: {
      algorithm: response.fingerprint.digest.algorithm.toLowerCase(),
      value: response.fingerprint.digest.value.toLowerCase(),
    },
  }
}

function fingerprintLabel(fingerprint: ChangeLogFingerprint): string {
  return `${fingerprint.byteLength} bytes ${fingerprint.digest.algorithm}:${fingerprint.digest.value}`
}

function fingerprintsMatch(
  actual: ChangeLogFingerprint,
  expected: ChangeLogFingerprint
): boolean {
  return (
    actual.byteLength === expected.byteLength &&
    actual.digest.algorithm === expected.digest.algorithm &&
    actual.digest.value === expected.digest.value
  )
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

  const preposition = phase === 'before' ? 'before applying' : 'after applying'
  throw new Error(
    `Change log ${phase} fingerprint mismatch ${preposition}: expected ${fingerprintLabel(
      expected
    )}, actual ${fingerprintLabel(actual)}`
  )
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
    changeCount: changes.length,
    sourceChangeCount,
    unavailableChangeCount: unavailableChangeSerials.length,
    unavailableChangeSerials,
    changes,
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

      await startServer(this.port, this.host)
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
      viewportCount,
      checkpointCount,
      lastChange,
    }
  }

  private async getCheckpointCount(sessionId: string): Promise<number> {
    const counts = await getCounts(sessionId, [CountKind.CHECKPOINTS])
    return counts[0]?.getCount() ?? 0
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
    if (sourceChangeCount > MAX_CHANGE_LOG_ENTRIES) {
      throw new Error(
        `Change log has too many entries (${sourceChangeCount.toLocaleString()})`
      )
    }

    const collected = await collectChangeLogEntries(
      sessionId,
      sourceChangeCount
    )
    assertCompleteChangeLog('export', collected.unavailableChangeSerials)
    const after = await getChangeLogFingerprint(
      sessionId,
      SessionFingerprintContent.COMPUTED,
      before.digest.algorithm
    )
    const document = createChangeLogDocument(
      collected.changes,
      sourceChangeCount,
      collected.unavailableChangeSerials,
      before,
      after
    )

    if (outputPath) {
      await fs.writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, {
        flag: overwriteExisting ? 'w' : 'wx',
      })
    }

    return {
      sessionId,
      format: document.format,
      version: document.version,
      complete: document.complete,
      before: document.before,
      after: document.after,
      changeCount: document.changeCount,
      sourceChangeCount: document.sourceChangeCount,
      unavailableChangeCount: document.unavailableChangeCount,
      unavailableChangeSerials: document.unavailableChangeSerials,
      changes: document.changes,
      outputPath,
    }
  }

  async applyChangeLog(
    request: ApplyChangeLogRequest
  ): Promise<ApplyChangeLogResult> {
    const parsed = request.inputPath
      ? await readChangeLogFile(request.inputPath)
      : normalizeChangeLogEntries(request.changes)
    const { changes } = parsed

    if (request.dryRun) {
      return {
        sessionId: request.sessionId,
        applied: false,
        changeCount: 0,
        inputChangeCount: changes.length,
        inputPath: request.inputPath,
      }
    }

    await this.ensureServerRunning()

    if (parsed.before) {
      await assertCurrentSessionFingerprint(
        request.sessionId,
        parsed.before,
        'before'
      )
    }

    let appliedChangeCount = 0
    const startChangeCount = await getChangeCount(request.sessionId)
    try {
      const applyChange = async (change: ChangeLogEntry) => {
        const data = Buffer.from(change.data, 'hex')
        switch (change.kind) {
          case 'INSERT':
            await insert(request.sessionId, change.offset, data)
            return true
          case 'DELETE':
            await del(request.sessionId, change.offset, change.length)
            return true
          case 'OVERWRITE':
            await overwrite(request.sessionId, change.offset, data)
            return true
          case 'REPLACE':
            await replace(request.sessionId, change.offset, change.length, data)
            return true
          case 'TRANSFORM':
            if (!change.transformId) {
              throw new Error('TRANSFORM change requires transformId')
            }
            return (
              await applyClientTransformPlugin(
                request.sessionId,
                change.transformId,
                change.offset,
                change.length,
                change.optionsJson
              )
            ).contentChanged
        }
      }
      const applyAndCountChange = async (change: ChangeLogEntry) => {
        if (await applyChange(change)) {
          appliedChangeCount += 1
        }
      }
      if (changes.length > 0) {
        let pendingBatch: ChangeLogEntry[] = []
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

      if (parsed.after) {
        await assertCurrentSessionFingerprint(
          request.sessionId,
          parsed.after,
          'after'
        )
      }
    } catch (error) {
      try {
        await rollbackSessionToChangeCount(request.sessionId, startChangeCount)
      } catch (rollbackError) {
        throw changeLogApplyErrorWithRollbackFailure(error, rollbackError)
      }
      throw error
    }

    return {
      sessionId: request.sessionId,
      applied: true,
      changeCount: appliedChangeCount,
      inputChangeCount: changes.length,
      inputPath: request.inputPath,
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
      request.caseInsensitive || false,
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
      request.caseInsensitive || false,
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
      request.optionsJson
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
      computedFileSize: response.computedFileSize,
      replacementLength: response.replacementLength,
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
