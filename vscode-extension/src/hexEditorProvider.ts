// Copyright 2024 Concurrent Technologies Corporation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Ωedit™ Data Editor - Custom Editor Provider
 *
 * This is the core integration point between VS Code's custom editor API and
 * the Ωedit™ editing engine. It demonstrates:
 *
 *   - Creating an Ωedit™ session for each opened file
 *   - Creating a viewport that tracks the visible region
 *   - Subscribing to viewport events so the webview updates live
 *   - Handling insert / delete / overwrite edits from the webview
 *   - Undo / redo wired through VS Code's built-in command palette
 *   - Search within the file
 *   - Saving via Ωedit™'s server-side replay
 */

import {
  ALL_EVENTS,
  applyTransformPlugin,
  CHANGE_LOG_FORMAT,
  CHANGE_LOG_VERSION,
  ChangeLogCancelledError,
  changeLogHeaderForExport,
  ChangeKind,
  checkSessionModel,
  checkoutCheckpoint,
  clear,
  countCharacters,
  CountKind,
  createCheckpoint,
  del,
  destroyLastCheckpoint,
  discardCheckpointFuture,
  editSimple,
  type EditorChangeRecord as ChangeRecord,
  type EditorHistoryExecutor,
  EditorHistoryController,
  EditorSearchController,
  ScopedEditorSessionHandle,
  getByteOrderMark,
  getActionJournalViewport as requestActionJournalViewport,
  getChangeCount,
  getChangeDetails,
  getClientVersion,
  getComputedFileSize,
  getCounts,
  getSegment,
  getServerInfo,
  getSessionContentInfo,
  getSessionFingerprint,
  getViewportData,
  IOFlags,
  inspectSessionContent,
  SaveStatus,
  SearchCaseFolding,
  type IServerInfo,
  type ActionJournalEntry,
  type ActionJournalViewport,
  insert,
  listTransformPlugins,
  modifyViewport,
  normalizeChangeLogDocument,
  openChangeLogFile,
  numAscii,
  overwrite,
  profileSession,
  replaceSessionCheckpointed,
  redo,
  restoreLastCheckpoint,
  restoreToChangeCount,
  runSessionTransaction,
  saveSession,
  serializeChangeLogEntry,
  SessionContentSource,
  SessionFingerprintContent,
  SessionEventKind,
  startServerHeartbeatLoop,
  type TransformProgress,
  TransformPluginOperation,
  type TransformPluginInfo,
  type ServerHeartbeatLoop,
  undo,
  writeChangeLogRpcExportAtomic,
  writeChangeLogFileAtomic,
  type PreparedChangeLog,
  ViewportEventKind,
} from '@omega-edit/client'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { OMEGA_EDIT_VIEW_TYPE } from './constants'
import {
  type AssistantSessionContext,
  cloneAssistantCommandSurfaces,
  OMEGA_EDIT_ASSISTANT_CONTEXT_VERSION,
} from './assistantContext'
import {
  getSvelteWebviewContent,
  getSvelteWebviewLocalResourceRoot,
} from './svelteWebview'
import { assertRangeMapFitsFile, parseRangeMapContent } from './rangeMap'
import {
  MAX_ANALYSIS_PROFILE_BYTES,
  MAX_LABEL_LENGTH,
  type BytesPerRow,
  type InsertDirection,
  type TextEncoding,
  type WebviewEditMode,
  type WebviewEditorState,
  type WebviewEditorUiState,
  type WebviewExternalHighlight,
  type WebviewActionJournalKind,
  type WebviewActionJournalViewport,
  WEBVIEW_ACTION_JOURNAL_KINDS,
  type WebviewRangeMapNode,
  type WebviewSessionContentInfo,
  type WebviewSessionContentSource,
  type WebviewTransformPlugin,
  type HostToWebviewMessage,
  type ServerHealthMetric,
  type ServerHealthMetricId,
  type ServerHealthMessage,
  type WebviewToHostMessage,
  bytesPerRowFromSetting,
  checkpointTimelineMetadataWindow,
  normalizeExternalHighlights,
  normalizeBytesPerRow,
  normalizeBytesPerRowSetting,
  normalizeTextEncoding,
  normalizeWebviewMessage,
} from './webviewProtocol'
import { decodeTextBytes } from './textEncoding'
import {
  CheckpointTimelineStorageManager,
  type CheckpointTimelineStorageSession,
  type CheckpointIntervalManifestEntryV1,
  CHECKPOINT_HISTORY_DEFAULTS,
  TimelineStorageError,
  writeEmptyCheckpointInterval,
} from './checkpointTimelineStorage'

interface EditorSession {
  readonly sessionId: string
  readonly viewportId: string
  readonly fileSize: number
  readonly changeCount: number
  readonly sessionSyncVersion: number
  offset: number
  bufferOffset: number
  visibleRows: number
  capacity: number
  bytesPerRowSetting: number
  bytesPerRow: BytesPerRow
  filePath: string
  panel: vscode.WebviewPanel
  document: HexDocument
  scope: ScopedEditorSessionHandle
  history: EditorHistoryController
  search: EditorSearchController
  restoredFromBackup?: boolean
  disposed?: boolean
  pendingScrollOffset?: number
  scrollTask?: Promise<void>
  pendingAnalysisProfile?: AnalysisProfileRequest
  analysisProfileTask?: Promise<void>
  webviewState: WebviewEditorUiState
  externalHighlights: WebviewExternalHighlight[]
  rangeMapTree: WebviewRangeMapNode[]
  externalHighlightBaseline?: ExternalHighlightBaseline
  contentSources: WebviewSessionContentInfo[]
  transformPlugins: WebviewTransformPlugin[]
  transformInFlight: boolean
  transformAbortController?: AbortController
  pendingHistoryOperation?: 'undo' | 'redo'
  pendingHistoryCount?: number
  historyCommandTask?: Promise<void>
  saveTask?: Promise<void>
  savedDiskFingerprint?: ChangeLogFingerprint
  checkpointTimeline: CheckpointTimelineState
  actionJournal: ActionJournalState
}

interface ActionJournalState {
  visible: boolean
  capacity: number
  direction: 'older' | 'newer'
  kinds: WebviewActionJournalKind[]
  transactionId?: string
  entries: Map<string, ActionJournalEntry>
  requestGeneration: number
  refreshTask?: Promise<void>
  refreshPending: boolean
}

interface CheckpointTimelineEntry {
  changeCount: number
  interval: CheckpointIntervalManifestEntryV1
}

interface CheckpointTimelineState {
  entries: CheckpointTimelineEntry[]
  storage?: CheckpointTimelineStorageSession
  originalFingerprint: ChangeLogFingerprint
  lastArchivedChangeCount: number
  cursor: number
  savedChangeCount: number
  savedFingerprint: ChangeLogFingerprint
  currentFingerprint: ChangeLogFingerprint
  visible: boolean
  navigating: boolean
  operation?: Promise<void>
}

function timelineFingerprintsEqual(
  left: ChangeLogFingerprint,
  right: ChangeLogFingerprint
): boolean {
  return (
    String(left.byteLength) === String(right.byteLength) &&
    left.digest.algorithm === right.digest.algorithm &&
    left.digest.value === right.digest.value
  )
}

interface ExternalHighlightBaseline {
  changeCount: number
  fileSize: number
  highlights: WebviewExternalHighlight[]
  rangeMapTree: WebviewRangeMapNode[]
}

interface AnalysisProfileRequest {
  offset: number
  length: number
  requestKey: string
  scopeLabel: string
  requestedLength: number
  isCapped: boolean
}

interface CollectedChangeLogRecords {
  changes?: ChangeRecord[]
  unavailableChangeSerials: number[]
}

interface ChangeLogDigest {
  algorithm: string
  value: string
}

interface ChangeLogFingerprint {
  byteLength: number | string
  digest: ChangeLogDigest
}

interface ParsedChangeLog {
  complete: boolean
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  changeCount: string
  sourceChangeCount: string
  unavailableChangeCount: string
  unavailableChangeSerials: string[]
  entryCount: number
  primitiveCounts: ChangeLogPrimitiveCounts
  transformDescriptors: ChangeLogTransformDescriptorPreview[]
  requiredPlugins: string[]
  entries(): AsyncIterable<ParsedChangeRecord>
}

interface TransformPrimitiveDescriptor {
  transformId: string
  optionsJson?: string
}

interface TransformPrimitivePayload {
  transformId: string
  args: Record<string, unknown>
}

interface ParsedChangeRecord extends ChangeRecord {
  transformDescriptor?: TransformPrimitiveDescriptor
}

interface ChangeLogPrimitiveCounts {
  total: number
  insert: number
  delete: number
  overwrite: number
  replace: number
  transform: number
}

interface ChangeLogSizeDelta {
  beforeByteLength: string
  afterByteLength: string
  deltaBytes: string
}

interface ChangeLogTransformDescriptorPreview {
  index: number
  serial?: number | string
  offset: number | string
  length: number | string
  transformId: string
  optionsJson?: string
  descriptorSource: 'data'
}

interface ChangeLogSafetyIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
}

interface ChangeLogRollbackProtection {
  available: boolean
  strategy: 'restore-to-change-count' | 'not-inspected'
  targetChangeCount?: number
  checkpointCount?: number
}

interface ChangeLogPreview {
  state?: WebviewEditorState
  uri?: vscode.Uri
  format: 'omega-edit.change-log'
  version: 2
  complete: boolean
  canApply: boolean
  primitiveCounts: ChangeLogPrimitiveCounts
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  current?: ChangeLogFingerprint
  expectedSize: ChangeLogSizeDelta
  transformDescriptors: ChangeLogTransformDescriptorPreview[]
  requiredPlugins: string[]
  missingPlugins: string[]
  unavailablePrimitives: {
    count: number | string
    serials: Array<number | string>
  }
  rollbackProtection: ChangeLogRollbackProtection
  safetyIssues: ChangeLogSafetyIssue[]
}

interface ChangeLogApplyResult {
  state: WebviewEditorState
  uri?: vscode.Uri
  changeCount: number
  appliedCount?: number
  sourceChangeCount?: number
  complete?: boolean
  before?: ChangeLogFingerprint
  after?: ChangeLogFingerprint
  unavailableChangeCount?: number
  unavailableChangeSerials?: Array<number | string>
  cancelled?: boolean
  preview?: ChangeLogPreview
  rollback?: {
    attempted: boolean
    succeeded?: boolean
    rolledBack?: boolean
    targetChangeCount?: number
    error?: string
  }
  finalFingerprint?: ChangeLogFingerprint
}

export interface CheckpointTimelineResult {
  state: WebviewEditorState
  checkpointCount: number
  moved: boolean
}

interface ChangeLogReplayFailureDetails {
  appliedCount: number
  rollback: NonNullable<ChangeLogApplyResult['rollback']>
  finalFingerprint?: ChangeLogFingerprint
}

type ChangeLogReplayError = Error & {
  changeLogReplay?: ChangeLogReplayFailureDetails
  result?: ChangeLogApplyResult
}

interface RangeMapLoadResult {
  state: WebviewEditorState
  sourceUri?: vscode.Uri
  source?: string
  nodeCount: number
  highlightCount: number
  selectedPath?: string
  selectedRange?: {
    offset: number
    length: number
  }
  cancelled?: boolean
  message?: string
}

interface RangeMapUnloadResult {
  state: WebviewEditorState
  unloadedCount: number
  highlightCount: number
}

const SESSION_SYNC_TIMEOUT_MS = 2000
const VIEWPORT_BUFFER_BYTES = 8 * 1024
const SERVER_HEALTH_WARN_LATENCY_MS = 75
const SERVER_HEALTH_ERROR_LATENCY_MS = 250
const MAX_TRANSFORM_RESULT_TEXT_LENGTH = 240
const MAX_TRANSFORM_RESULT_PREVIEW_BYTES = 4 * 1024
const MAX_FILE_SPLICE_BYTES = 32 * 1024 * 1024
const MAX_NON_FILE_CHANGE_LOG_BYTES = 64 * 1024 * 1024
const MAX_NON_FILE_CHANGE_LOG_ENTRIES = 10_000
const DEFAULT_CHANGE_LOG_DIGEST_ALGORITHM = 'sha256'
const DEFAULT_SAVE_CONFLICT_FINGERPRINT_ALGORITHM = 'sha256'
const SAVE_CONFLICT_FINGERPRINT_ALGORITHMS = [
  'sha224',
  'sha256',
  'sha384',
  'sha512',
  'sha3-256',
  'sha3-512',
  'blake2b-512',
  'blake2s-256',
] as const
type SaveConflictFingerprintAlgorithm =
  (typeof SAVE_CONFLICT_FINGERPRINT_ALGORITHMS)[number]
const INTERNAL_REPLACE_ALL_REPLAY_ID = 'omega.internal.replace-all'
const GRPC_NOT_FOUND = 5
const MAX_INT64 = 9_223_372_036_854_775_807n
const CONTEXT_HEX_EDITOR_ACTIVE = 'omegaEdit.hexEditorActive'
const CONTEXT_CAN_UNDO = 'omegaEdit.canUndo'
const CONTEXT_CAN_REDO = 'omegaEdit.canRedo'
const CONTEXT_HAS_PENDING_CHANGES = 'omegaEdit.hasPendingChanges'
const CONTEXT_TRANSFORM_IN_FLIGHT = 'omegaEdit.transformInFlight'
const CONTEXT_ACTIVE_SESSION_RESOURCE_PATHS =
  'omegaEdit.activeSessionResourcePaths'
const ACTION_JOURNAL_REQUEST_TIMEOUT_MS = 15_000

function openEditorFirstMessage(): string {
  return vscode.l10n.t('Open an OmegaEdit editor first')
}

function omegaEditErrorMessage(message: string): string {
  return vscode.l10n.t('OmegaEdit error: {message}', { message })
}

function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`
}

function describeSaveStatus(status: number): string {
  if (status === SaveStatus.MODIFIED) {
    return vscode.l10n.t('original file was modified outside OmegaEdit')
  }
  return vscode.l10n.t('status {status}', { status })
}

function resolveSaveConflictFingerprintAlgorithm(
  resource?: vscode.Uri
): SaveConflictFingerprintAlgorithm {
  const configured = vscode.workspace
    .getConfiguration('omegaEdit', resource)
    .get<string>(
      'saveConflictFingerprintAlgorithm',
      DEFAULT_SAVE_CONFLICT_FINGERPRINT_ALGORITHM
    )
    .toLowerCase()
  return (
    SAVE_CONFLICT_FINGERPRINT_ALGORITHMS.find(
      (algorithm) => algorithm === configured
    ) ?? DEFAULT_SAVE_CONFLICT_FINGERPRINT_ALGORITHM
  )
}

async function saveSessionOrThrow(
  sessionId: string,
  filePath: string,
  flags: number
): Promise<void> {
  const response = await saveSession(sessionId, filePath, flags)
  const status = response.getSaveStatus()
  if (status !== SaveStatus.SUCCESS) {
    throw new Error(
      vscode.l10n.t('OmegaEdit save failed for {path}: {reason}', {
        path: filePath,
        reason: describeSaveStatus(status),
      })
    )
  }
}

async function saveSessionWithKnownDiskVersion(
  session: EditorSession,
  cancellation: vscode.CancellationToken
): Promise<void> {
  if (cancellation.isCancellationRequested) {
    throw new vscode.CancellationError()
  }
  const expected =
    session.savedDiskFingerprint ?? session.checkpointTimeline.savedFingerprint
  const expectedByteLength = Number(expected.byteLength)
  if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 0) {
    throw new Error('Saved file fingerprint has an invalid byte length')
  }
  const response = await saveSession(
    session.sessionId,
    session.filePath,
    IOFlags.OVERWRITE,
    0,
    0,
    {
      byteLength: expectedByteLength,
      digest: expected.digest,
    }
  )
  const status = response.getSaveStatus()
  if (status === SaveStatus.SUCCESS) {
    return
  }

  throw new Error(
    vscode.l10n.t('OmegaEdit save failed for {path}: {reason}', {
      path: session.filePath,
      reason: describeSaveStatus(status),
    })
  )
}

function transformMutationBlockedMessage(): string {
  return vscode.l10n.t('Action in progress; edits are disabled.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function safeNonNegativeInteger(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER
): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max
    ? value
    : undefined
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

function safeString(
  value: unknown,
  maxLength: number,
  allowEmpty = false
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value.trim()
  if ((!allowEmpty && text.length === 0) || text.length > maxLength) {
    return undefined
  }
  return text
}

function safeHexString(
  value: unknown,
  maxBytes: number,
  allowEmpty = false
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value.replace(/\s/g, '')
  if ((!allowEmpty && text.length === 0) || text.length > maxBytes * 2) {
    return undefined
  }
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) {
    return undefined
  }
  return text
}

function parseJsonObject(text: string, name: string): Record<string, unknown> {
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

function parseTransformOptionsJson(
  optionsJson: string | undefined,
  name: string
): Record<string, unknown> {
  if (optionsJson === undefined || optionsJson === '') {
    return {}
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

function createTransformPrimitivePayload(
  transformId: string,
  optionsJson?: string
): TransformPrimitivePayload {
  const args = parseTransformOptionsJson(optionsJson, 'transform options')
  return {
    transformId: transformId.trim(),
    args: canonicalizeTransformDescriptorArgs(args),
  }
}

function createTransformPrimitiveDescriptorJson(
  transformId: string,
  optionsJson?: string
): string {
  return JSON.stringify(
    createTransformPrimitivePayload(transformId, optionsJson)
  )
}

function encodeTransformPrimitiveDataHex(
  transformId: string,
  optionsJson?: string
): string {
  return Buffer.from(
    createTransformPrimitiveDescriptorJson(transformId, optionsJson),
    'utf8'
  ).toString('hex')
}

function parseTransformPrimitiveDescriptor(
  dataHex: string,
  name: string
): TransformPrimitiveDescriptor {
  const data = Buffer.from(dataHex, 'hex')
  if (data.length === 0) {
    throw new Error(`${name} requires data`)
  }

  const descriptor = parseJsonObject(data.toString('utf8'), name)
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

function assertTransformReplayResponse(
  descriptor: TransformPrimitiveDescriptor,
  offset: number,
  length: number,
  computedFileSizeBefore: number,
  computedFileSizeAfter: number,
  response: Awaited<ReturnType<typeof applyTransformPlugin>>
): void {
  if (response.pluginId !== descriptor.transformId) {
    throw new Error(
      `Transform ${descriptor.transformId} replay returned plugin ${response.pluginId}`
    )
  }
  if (response.offset !== offset || response.length !== length) {
    throw new Error(
      `Transform ${descriptor.transformId} replay range mismatch: expected offset ${offset}, length ${length}; actual offset ${response.offset}, length ${response.length}`
    )
  }

  const expectedFileSize =
    computedFileSizeBefore - response.length + response.replacementLength
  if (response.computedFileSize !== expectedFileSize) {
    throw new Error(
      `Transform ${descriptor.transformId} replay size mismatch: expected ${expectedFileSize}, actual ${response.computedFileSize}`
    )
  }
  if (computedFileSizeAfter !== response.computedFileSize) {
    throw new Error(
      `Transform ${descriptor.transformId} replay session size mismatch: expected ${response.computedFileSize}, actual ${computedFileSizeAfter}`
    )
  }
}

function initialWebviewState(bytesPerRow: BytesPerRow): WebviewEditorUiState {
  return {
    visibleOffset: 0,
    visibleByteCount: 0,
    selectedOffset: -1,
    selectionStart: -1,
    selectionEnd: -1,
    selectionLength: 0,
    bytesPerRow,
    offsetRadix: 'hex',
    textEncoding: 'ascii',
    activePane: 'hex',
    editMode: 'insert',
    insertDirection: 'forward',
  }
}

function isMutationWebviewMessage(message: WebviewToHostMessage): boolean {
  switch (message.type) {
    case 'cutSelection':
    case 'insert':
    case 'delete':
    case 'overwrite':
    case 'replace':
    case 'replaceAllMatches':
    case 'createCheckpoint':
    case 'rollbackCheckpoint':
    case 'restoreCheckpoint':
    case 'undo':
    case 'redo':
    case 'revert':
      return true
    default:
      return false
  }
}

function isTransformCancellationError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  const causeCode = (error as { cause?: { code?: unknown } })?.cause?.code
  if (code === 1 || causeCode === 1) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return normalized.includes('cancelled') || normalized.includes('canceled')
}

function safeInsertDirection(value: unknown): InsertDirection | undefined {
  return value === 'forward' || value === 'backward' ? value : undefined
}

function safeTextEncoding(value: unknown): TextEncoding | undefined {
  const textEncoding = normalizeTextEncoding(value)
  return value === textEncoding ? textEncoding : undefined
}

function textEncodingStatusLabel(encoding: TextEncoding): string {
  switch (encoding) {
    case 'ascii':
      return vscode.l10n.t('ASCII')
    case 'windows-1252':
      return vscode.l10n.t('Windows-1252')
    case 'cp437':
      return vscode.l10n.t('CP437')
    case 'ebcdic-037':
      return vscode.l10n.t('EBCDIC')
    case 'macroman':
      return vscode.l10n.t('MacRoman')
  }
}

function searchCaseFoldingForTextEncoding(
  encoding: TextEncoding
): SearchCaseFolding {
  switch (encoding) {
    case 'ascii':
      return SearchCaseFolding.ASCII
    case 'windows-1252':
      return SearchCaseFolding.WINDOWS_1252
    case 'cp437':
      return SearchCaseFolding.CP437
    case 'ebcdic-037':
      return SearchCaseFolding.EBCDIC_037
    case 'macroman':
      return SearchCaseFolding.MAC_ROMAN
  }
}

function searchCaseFoldingForRequest(
  caseInsensitive: boolean | undefined,
  encoding: TextEncoding | undefined
): SearchCaseFolding {
  if (!caseInsensitive) {
    return SearchCaseFolding.NONE
  }
  return searchCaseFoldingForTextEncoding(encoding ?? 'ascii')
}

function parseCommandUri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) {
    return value
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  try {
    return vscode.Uri.parse(value.trim(), true)
  } catch {
    return undefined
  }
}

function parseCommandOptionUri(
  options: unknown,
  key: 'sourceUri' | 'targetUri'
): vscode.Uri | undefined {
  return isRecord(options) ? parseCommandUri(options[key]) : undefined
}

function classifyServerHealthLatency(
  latencyMs: number
): ServerHealthMessage['severity'] {
  if (latencyMs <= SERVER_HEALTH_WARN_LATENCY_MS) {
    return 'ok'
  }
  if (latencyMs <= SERVER_HEALTH_ERROR_LATENCY_MS) {
    return 'warn'
  }
  return 'error'
}

function getOptionalStringProperty(
  source: object,
  key: string
): string | undefined {
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getOptionalNumberProperty(
  source: object,
  key: string
): number | undefined {
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : undefined
}

function truncateTransformResult(value: string): string {
  if (value.length <= MAX_TRANSFORM_RESULT_TEXT_LENGTH) {
    return value
  }
  return `${value.slice(0, MAX_TRANSFORM_RESULT_TEXT_LENGTH - 1)}...`
}

function formatTransformCompletionMessage(response: {
  operation: TransformPluginOperation
  contentChanged: boolean
  length: number
  replacementLength: number
}): string {
  if (response.contentChanged) {
    return vscode.l10n.t(
      'OmegaEdit transformed {from} byte(s) into {to} byte(s)',
      {
        from: response.length,
        to: response.replacementLength,
      }
    )
  }

  if (response.operation === TransformPluginOperation.INSPECT) {
    return vscode.l10n.t('OmegaEdit calculation completed')
  }

  return vscode.l10n.t('OmegaEdit action completed without content changes')
}

function webviewContentSourceToClient(
  source: WebviewSessionContentSource
): SessionContentSource {
  switch (source) {
    case 'original':
      return SessionContentSource.ORIGINAL
    case 'latestCheckpoint':
      return SessionContentSource.LATEST_CHECKPOINT
    case 'computed':
      return SessionContentSource.COMPUTED
  }
}

function clientContentSourceToWebview(
  source: SessionContentSource
): WebviewSessionContentSource | undefined {
  switch (source) {
    case SessionContentSource.ORIGINAL:
      return 'original'
    case SessionContentSource.COMPUTED:
      return 'computed'
    case SessionContentSource.LATEST_CHECKPOINT:
      return 'latestCheckpoint'
    default:
      return undefined
  }
}

function defaultContentSources(fileSize: number): WebviewSessionContentInfo[] {
  return [
    {
      content: 'computed',
      available: true,
      byteLength: fileSize,
      label: vscode.l10n.t('Current Content'),
    },
    {
      content: 'original',
      available: true,
      byteLength: fileSize,
      label: vscode.l10n.t('Original Snapshot'),
    },
    {
      content: 'latestCheckpoint',
      available: false,
      byteLength: 0,
      label: vscode.l10n.t('Latest Checkpoint'),
    },
  ]
}

function formatStatusByteCount(value: number): string {
  return value.toLocaleString()
}

function formatStatusOffset(offset: number, radix: 'hex' | 'dec'): string {
  return radix === 'dec'
    ? offset.toLocaleString()
    : `0x${offset.toString(16).toUpperCase()}`
}

function formatStatusProgress(
  fileSize: number,
  visibleOffset: number,
  visibleByteCount: number
): string {
  if (fileSize <= 0 || visibleByteCount <= 0) {
    return '0.00%'
  }
  const visibleEnd = Math.min(
    fileSize,
    Math.max(0, visibleOffset) + visibleByteCount
  )
  const progress = visibleEnd >= fileSize ? 100 : (visibleEnd / fileSize) * 100
  return `${progress.toFixed(2)}%`
}

function formatServerHealthSeverity(
  severity: ServerHealthMessage['severity']
): string {
  switch (severity) {
    case 'ok':
      return vscode.l10n.t('OK')
    case 'warn':
      return vscode.l10n.t('Warn')
    case 'error':
      return vscode.l10n.t('Error')
    case 'down':
      return vscode.l10n.t('Down')
  }
}

function serverHealthColorId(
  severity: ServerHealthMessage['severity'] | 'pending'
): string {
  switch (severity) {
    case 'ok':
      return 'charts.green'
    case 'warn':
      return 'charts.yellow'
    case 'error':
    case 'down':
      return 'charts.red'
    case 'pending':
      return 'statusBar.foreground'
  }
}

function serverHealthIcon(
  severity: ServerHealthMessage['severity'] | 'pending'
): string {
  return severity === 'down' ? 'debug-disconnect' : 'server'
}

function formatServerHealthLatencyBand(
  severity: ServerHealthMessage['severity'] | 'pending'
): string {
  switch (severity) {
    case 'ok':
      return vscode.l10n.t('Low (<= {threshold} ms)', {
        threshold: SERVER_HEALTH_WARN_LATENCY_MS,
      })
    case 'warn':
      return vscode.l10n.t('{low}-{high} ms', {
        low: SERVER_HEALTH_WARN_LATENCY_MS + 1,
        high: SERVER_HEALTH_ERROR_LATENCY_MS,
      })
    case 'error':
      return vscode.l10n.t('High (> {threshold} ms)', {
        threshold: SERVER_HEALTH_ERROR_LATENCY_MS,
      })
    case 'down':
      return vscode.l10n.t('Unavailable')
    case 'pending':
      return vscode.l10n.t('Pending')
  }
}

function formatServerUptime(totalSeconds: number): string {
  const remainingSeconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(remainingSeconds / 86_400)
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600)
  const minutes = Math.floor((remainingSeconds % 3_600) / 60)
  const seconds = remainingSeconds % 60
  const formatCount = (count: number): string =>
    count.toLocaleString(vscode.env.language, { useGrouping: false })
  const parts: string[] = []

  if (days > 0) {
    parts.push(vscode.l10n.t('{count}d', { count: formatCount(days) }))
  }
  if (hours > 0) {
    parts.push(vscode.l10n.t('{count}h', { count: formatCount(hours) }))
  }
  if (minutes > 0) {
    parts.push(vscode.l10n.t('{count}m', { count: formatCount(minutes) }))
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(vscode.l10n.t('{count}s', { count: formatCount(seconds) }))
  }

  return parts.join('')
}

interface ServerHealthTooltipEntry {
  label: string
  value: string
}

function appendServerHealthTooltipSection(
  tooltip: vscode.MarkdownString,
  heading: string,
  entries: ServerHealthTooltipEntry[]
): void {
  const trimmedEntries = entries
    .map(({ label, value }) => ({
      label: label.trim(),
      value: value.trim(),
    }))
    .filter(({ label, value }) => label && value)

  if (trimmedEntries.length === 0) {
    return
  }

  tooltip.appendMarkdown(`**${heading}**\n\n`)
  for (const { label, value } of trimmedEntries) {
    tooltip.appendMarkdown('- ')
    tooltip.appendText(`${label}: ${value}`)
    tooltip.appendMarkdown('\n')
  }
  tooltip.appendMarkdown('\n')
}

const SERVER_HEALTH_VOLATILE_METRIC_IDS = new Set<ServerHealthMetricId>([
  'latency',
  'sessions',
  'uptime',
  'loadAverage',
  'residentMemory',
  'virtualMemory',
  'peakResidentMemory',
])

function serverHealthMetric(
  id: ServerHealthMetricId,
  label: string,
  value: string
): ServerHealthMetric {
  return { id, label, value }
}

function getServerHealthMetricMap(
  metrics: ServerHealthMessage['metrics']
): Map<ServerHealthMetricId, ServerHealthTooltipEntry> {
  const metricById = new Map<ServerHealthMetricId, ServerHealthTooltipEntry>()
  for (const metric of metrics) {
    const label = metric.label.trim()
    const value = metric.value.trim()
    if (!label || !value || metricById.has(metric.id)) {
      continue
    }
    metricById.set(metric.id, { label, value })
  }
  return metricById
}

function collectServerHealthTooltipMetrics(
  metricById: Map<ServerHealthMetricId, ServerHealthTooltipEntry>,
  ids: readonly ServerHealthMetricId[],
  seenIds: Set<ServerHealthMetricId>
): ServerHealthTooltipEntry[] {
  const entries: ServerHealthTooltipEntry[] = []
  for (const id of ids) {
    const metric = metricById.get(id)
    if (!metric || seenIds.has(id)) {
      continue
    }
    seenIds.add(id)
    entries.push(metric)
  }
  return entries
}

function collectRemainingServerHealthTooltipMetrics(
  metricById: Map<ServerHealthMetricId, ServerHealthTooltipEntry>,
  seenIds: Set<ServerHealthMetricId>,
  excludedIds = new Set<ServerHealthMetricId>()
): ServerHealthTooltipEntry[] {
  const entries: ServerHealthTooltipEntry[] = []
  for (const [id, metric] of metricById) {
    if (seenIds.has(id) || excludedIds.has(id)) {
      continue
    }
    seenIds.add(id)
    entries.push(metric)
  }
  return entries
}

function buildServerHealthTooltip(
  health: ServerHealthMessage | undefined
): vscode.MarkdownString {
  const statusLabel = vscode.l10n.t('Status')
  const latencyLabel = vscode.l10n.t('Latency')
  const tooltip = new vscode.MarkdownString()
  tooltip.supportThemeIcons = true
  tooltip.appendMarkdown(`**${vscode.l10n.t('Ωedit™ Server')}**\n\n`)

  if (!health) {
    appendServerHealthTooltipSection(tooltip, vscode.l10n.t('Live Status'), [
      { label: statusLabel, value: vscode.l10n.t('Pending') },
      { label: latencyLabel, value: formatServerHealthLatencyBand('pending') },
    ])
    return tooltip
  }

  const metricById = getServerHealthMetricMap(health.metrics)
  const seenIds = new Set<ServerHealthMetricId>()
  const latencyBand = formatServerHealthLatencyBand(health.severity)
  seenIds.add('latency')

  appendServerHealthTooltipSection(tooltip, vscode.l10n.t('Live Status'), [
    {
      label: statusLabel,
      value: formatServerHealthSeverity(health.severity),
    },
    {
      label: latencyLabel,
      value: latencyBand,
    },
  ])

  appendServerHealthTooltipSection(
    tooltip,
    vscode.l10n.t('Current Instance'),
    collectServerHealthTooltipMetrics(metricById, ['pid'], seenIds)
  )

  appendServerHealthTooltipSection(
    tooltip,
    vscode.l10n.t('Host and Build'),
    collectServerHealthTooltipMetrics(
      metricById,
      [
        'host',
        'platform',
        'logicalCpus',
        'runtime',
        'version',
        'client',
        'compiler',
        'build',
        'cppStandard',
      ],
      seenIds
    )
  )

  appendServerHealthTooltipSection(
    tooltip,
    vscode.l10n.t('Details'),
    collectRemainingServerHealthTooltipMetrics(
      metricById,
      seenIds,
      SERVER_HEALTH_VOLATILE_METRIC_IDS
    )
  )

  return tooltip
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function transformResultToText(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    return ''
  }

  const preview =
    bytes.byteLength > MAX_TRANSFORM_RESULT_PREVIEW_BYTES
      ? bytes.subarray(0, MAX_TRANSFORM_RESULT_PREVIEW_BYTES)
      : bytes
  const suffix = preview.byteLength < bytes.byteLength ? '...' : ''
  return truncateTransformResult(Buffer.from(preview).toString('utf8') + suffix)
}

function serializeTransformPlugin(plugin: TransformPluginInfo): {
  id: string
  name: string
  description: string
  operation: number
  support: number
  flags: number
  abiVersion: number
  help: string
  example: string
  defaultArgs: string
  argsSchema: string
} {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    operation: plugin.operation,
    support: plugin.support,
    flags: plugin.flags,
    abiVersion: plugin.abiVersion,
    help: plugin.help,
    example: plugin.example,
    defaultArgs: plugin.defaultArgs,
    argsSchema: plugin.argsSchema,
  }
}

const changeKindNames = new Map<number, ChangeRecord['kind']>([
  [ChangeKind.INSERT, 'INSERT'],
  [ChangeKind.DELETE, 'DELETE'],
  [ChangeKind.OVERWRITE, 'OVERWRITE'],
  [ChangeKind.TRANSFORM, 'TRANSFORM'],
])

function changeDetailsToChangeRecord(
  change: Awaited<ReturnType<typeof getChangeDetails>>
): ChangeRecord {
  const kind = changeKindNames.get(change.getKind())
  if (!kind) {
    throw new Error(`Unsupported change kind: ${change.getKind()}`)
  }

  if (kind === 'TRANSFORM') {
    const transform = change.getTransform()
    const data = Buffer.from(change.getData_asU8()).toString('hex')
    const descriptor = parseTransformPrimitiveDescriptor(
      data,
      'TRANSFORM change data'
    )
    if (!transform?.transformId) {
      throw new Error('Transform change is missing transform metadata')
    }
    if (descriptor.transformId !== transform.transformId) {
      throw new Error(
        `Transform metadata mismatch: descriptor ${descriptor.transformId} does not match change ${transform.transformId}`
      )
    }
    if (
      !transformOptionsMatchDescriptor(
        transform.optionsJson,
        descriptor.optionsJson,
        'transform options'
      )
    ) {
      throw new Error(
        `Transform metadata mismatch: options for ${transform.transformId} do not match change data`
      )
    }

    return {
      serial: change.getSerial(),
      kind,
      offset: change.getOffset(),
      length: change.getLength(),
      data,
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

async function collectChangeLogRecords(
  sessionId: string,
  sourceChangeCount: number,
  onRecord?: (record: ChangeRecord) => Promise<void>,
  onProgress?: (processedSerial: number) => void,
  signal?: AbortSignal
): Promise<CollectedChangeLogRecords> {
  const changes = onRecord ? undefined : ([] as ChangeRecord[])
  const unavailableChangeSerials: number[] = []
  for (let serial = 1; serial <= sourceChangeCount; serial += 1) {
    if (signal?.aborted) {
      throw new ChangeLogCancelledError()
    }
    try {
      const record = changeDetailsToChangeRecord(
        await getChangeDetails(sessionId, serial)
      )
      if (onRecord) {
        await onRecord(record)
      } else {
        changes?.push(record)
      }
    } catch (error) {
      if (!isMissingChangeDetailsError(error)) {
        throw error
      }
      unavailableChangeSerials.push(serial)
    } finally {
      onProgress?.(serial)
    }
  }
  return { changes, unavailableChangeSerials }
}

async function writeChangeLogFile(
  targetPath: string,
  sourceChangeCount: number,
  before: ChangeLogFingerprint,
  after: ChangeLogFingerprint,
  writeRecords: (
    writeRecord: (record: ChangeRecord) => Promise<void>
  ) => Promise<CollectedChangeLogRecords>,
  verifyBeforeCommit?: () => Promise<void>,
  signal?: AbortSignal
): Promise<CollectedChangeLogRecords> {
  const header = changeLogHeaderForExport({
    complete: true,
    before: {
      byteLength: int64ToDecimal(before.byteLength),
      digest: before.digest,
    },
    after: {
      byteLength: int64ToDecimal(after.byteLength),
      digest: after.digest,
    },
    changeCount: sourceChangeCount,
    sourceChangeCount,
    unavailableChangeSerials: [],
  })
  let collected: CollectedChangeLogRecords | undefined
  await writeChangeLogFileAtomic(
    targetPath,
    header,
    async (sink) => {
      collected = await writeRecords(async (record) => sink.writeEntry(record))
      assertCompleteChangeLog('export', collected.unavailableChangeSerials)
    },
    {
      overwrite: true,
      beforeCommit: verifyBeforeCommit,
      ...(signal ? { signal } : {}),
    }
  )
  if (!collected) {
    throw new Error('Change log export did not collect completion metadata')
  }
  return collected
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

function replayErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function replayError(error: unknown): ChangeLogReplayError {
  return error instanceof Error ? error : new Error(String(error))
}

function isChangeLogCancellationError(error: unknown): boolean {
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current && !seen.has(current)) {
    seen.add(current)
    if (
      current instanceof ChangeLogCancelledError ||
      (isRecord(current) && current.code === 'CHANGE_LOG_CANCELLED')
    ) {
      return true
    }
    current = isRecord(current) ? current.cause : undefined
  }
  return false
}

function attachChangeLogReplayDetails(
  error: Error,
  details: ChangeLogReplayFailureDetails
): ChangeLogReplayError {
  const detailed = error as ChangeLogReplayError
  detailed.changeLogReplay = details
  return detailed
}

function safeChangeRecord(value: unknown): ParsedChangeRecord | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  let offset: number
  try {
    offset = normalizeNonNegativeInt64ForClient(
      value.offset,
      'change log entry offset'
    )
  } catch {
    return undefined
  }
  let serial = 0
  if (value.serial !== undefined) {
    try {
      serial = normalizePositiveInt64ForClient(
        value.serial,
        'change log entry serial'
      )
    } catch {
      return undefined
    }
  }
  const groupId = safeString(value.groupId, MAX_LABEL_LENGTH)
  if (value.groupId !== undefined && !groupId) {
    return undefined
  }

  switch (value.kind) {
    case 'INSERT': {
      const data = safeHexString(value.data, Number.POSITIVE_INFINITY)
      if (!data) {
        return undefined
      }
      return groupId
        ? { serial, kind: 'INSERT', offset, length: 0, data, groupId }
        : { serial, kind: 'INSERT', offset, length: 0, data }
    }
    case 'DELETE': {
      let length: number
      try {
        length = normalizePositiveInt64ForClient(
          value.length,
          'change log entry length'
        )
      } catch {
        return undefined
      }
      const data = safeHexString(value.data, Number.POSITIVE_INFINITY)
      if (!data || data.length / 2 !== length) {
        return undefined
      }
      return groupId
        ? { serial, kind: 'DELETE', offset, length, data, groupId }
        : { serial, kind: 'DELETE', offset, length, data }
    }
    case 'OVERWRITE': {
      const data = safeHexString(value.data, Number.POSITIVE_INFINITY)
      if (!data) {
        return undefined
      }
      return groupId
        ? {
            serial,
            kind: 'OVERWRITE',
            offset,
            length: data.length / 2,
            data,
            groupId,
          }
        : {
            serial,
            kind: 'OVERWRITE',
            offset,
            length: data.length / 2,
            data,
          }
    }
    case 'REPLACE': {
      let length: number
      try {
        length = normalizeNonNegativeInt64ForClient(
          value.length,
          'change log entry length'
        )
      } catch {
        return undefined
      }
      const data = safeHexString(value.data, Number.POSITIVE_INFINITY, true)
      if (data === undefined) {
        return undefined
      }
      return groupId
        ? { serial, kind: 'REPLACE', offset, length, data, groupId }
        : { serial, kind: 'REPLACE', offset, length, data }
    }
    case 'TRANSFORM': {
      let length: number
      try {
        length = normalizeNonNegativeInt64ForClient(
          value.length,
          'change log entry length'
        )
      } catch {
        return undefined
      }
      const data = safeHexString(value.data, Number.POSITIVE_INFINITY)
      if (!data) {
        return undefined
      }
      for (const key of [
        'transformId',
        'optionsJson',
        'replacementLength',
        'computedFileSizeBefore',
        'computedFileSizeAfter',
      ] as const) {
        if (value[key] !== undefined) {
          return undefined
        }
      }
      let transformDescriptor: TransformPrimitiveDescriptor
      try {
        transformDescriptor = parseTransformPrimitiveDescriptor(
          data,
          'TRANSFORM change data'
        )
      } catch {
        return undefined
      }

      return groupId
        ? {
            serial,
            kind: 'TRANSFORM',
            offset,
            length,
            data,
            groupId,
            transformDescriptor,
          }
        : {
            serial,
            kind: 'TRANSFORM',
            offset,
            length,
            data,
            transformDescriptor,
          }
    }
    default:
      return undefined
  }
}

function describeUnavailableSerials(serials: Array<number | string>): string {
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
  unavailableChangeSerials: Array<number | string>
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

function replayPreviewErrorMessage(preview: ChangeLogPreview): string {
  const issueSummary = preview.safetyIssues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message)
    .join('; ')
  return issueSummary
    ? `Change log preview found unsafe replay: ${issueSummary}`
    : 'Change log preview found unsafe replay'
}

function serializeChangeLogPreviewForDisplay(
  preview: ChangeLogPreview
): Record<string, unknown> {
  const { state: _state, uri, ...displayPreview } = preview
  return {
    ...displayPreview,
    ...(uri ? { uri: uri.toString() } : {}),
  }
}

function preparedChangeLogToParsed(
  prepared: PreparedChangeLog
): ParsedChangeLog {
  return {
    complete: prepared.complete,
    before: prepared.before,
    after: prepared.after,
    changeCount: prepared.changeCount,
    sourceChangeCount: prepared.sourceChangeCount,
    unavailableChangeCount: prepared.unavailableChangeCount,
    unavailableChangeSerials: prepared.unavailableChangeSerials,
    entryCount: prepared.entryCount,
    primitiveCounts: prepared.primitiveCounts,
    transformDescriptors: prepared.transformDescriptors.map((descriptor) => ({
      ...descriptor,
      descriptorSource: 'data',
    })),
    requiredPlugins: prepared.requiredPlugins,
    async *entries(): AsyncIterable<ParsedChangeRecord> {
      for await (const entry of prepared.entries()) {
        const change = safeChangeRecord(entry)
        if (!change) {
          throw new Error(
            'Validated change log entry is not client-addressable'
          )
        }
        yield change
      }
    },
  }
}

function parseChangeLog(content: Uint8Array): ParsedChangeLog {
  let parsed: unknown
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(content)
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid change log JSON: ${message}`)
  }
  return preparedChangeLogToParsed(normalizeChangeLogDocument(parsed))
}

async function openParsedChangeLog(
  uri: vscode.Uri,
  signal?: AbortSignal
): Promise<ParsedChangeLog> {
  if (uri.scheme === 'file') {
    return preparedChangeLogToParsed(
      await openChangeLogFile(uri.fsPath, signal ? { signal } : undefined)
    )
  }
  const stat = await vscode.workspace.fs.stat(uri)
  if (stat.size > MAX_NON_FILE_CHANGE_LOG_BYTES) {
    throw new Error(
      `Non-file change logs are limited to ${MAX_NON_FILE_CHANGE_LOG_BYTES} bytes because this file system provider does not expose streaming reads`
    )
  }
  if (signal?.aborted) {
    throw new ChangeLogCancelledError()
  }
  const content = await vscode.workspace.fs.readFile(uri)
  if (content.byteLength > MAX_NON_FILE_CHANGE_LOG_BYTES) {
    throw new Error(
      `Non-file change logs are limited to ${MAX_NON_FILE_CHANGE_LOG_BYTES} bytes because this file system provider does not expose streaming reads`
    )
  }
  const parsed = parseChangeLog(content)
  if (signal?.aborted) {
    throw new ChangeLogCancelledError()
  }
  return parsed
}

function backupIdToFilePath(backupId: string | undefined): string | undefined {
  if (!backupId) {
    return undefined
  }

  try {
    const backupUri = vscode.Uri.parse(backupId)
    return backupUri.scheme === 'file' ? backupUri.fsPath : undefined
  } catch {
    return undefined
  }
}

/**
 * Represents a single file opened by the Data Editor. VS Code tracks dirty
 * state and initiates saves through this object.
 */
export class HexDocument implements vscode.CustomDocument {
  readonly uri: vscode.Uri
  backupId: string | undefined

  constructor(uri: vscode.Uri, backupId?: string) {
    this.uri = uri
    this.backupId = backupId
  }

  dispose(): void {
    // VS Code calls this when all editors for the document are closed.
    // Session and webview cleanup happens in webviewPanel.onDidDispose.
  }
}

export class HexEditorProvider
  implements vscode.CustomEditorProvider<HexDocument>
{
  public static readonly viewType = OMEGA_EDIT_VIEW_TYPE

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<HexDocument>
  >()
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event
  private readonly _onDidChangeEditorState =
    new vscode.EventEmitter<WebviewEditorState>()
  readonly onDidChangeEditorState = this._onDidChangeEditorState.event

  /** Active editor sessions keyed by document URI string */
  private sessions = new Map<string, EditorSession>()

  /** The editor that last had focus (for goToOffset command routing) */
  private activeSession: EditorSession | undefined

  private heartbeatLoop: ServerHeartbeatLoop | undefined

  private serverInfo: IServerInfo | undefined

  private latestServerHealth: ServerHealthMessage | undefined

  private pendingHealthWebviews = new Set<vscode.Webview>()

  private lastServerStatusItemKey = ''

  private readonly timelineStorage?: Promise<CheckpointTimelineStorageManager>

  private readonly statusItems = {
    offset: vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      110
    ),
    selection: vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      109
    ),
    size: vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      108
    ),
    pane: vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      107
    ),
    mode: vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      106
    ),
    layout: vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      105
    ),
    transforms: vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      104
    ),
    dirty: vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      103
    ),
    server: vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      102
    ),
  }

  constructor(
    private readonly extensionContext?: Pick<
      vscode.ExtensionContext,
      'extensionUri' | 'subscriptions' | 'storageUri' | 'globalStorageUri'
    >
  ) {
    this.extensionContext?.subscriptions.push(
      this.statusItems.offset,
      this.statusItems.selection,
      this.statusItems.size,
      this.statusItems.pane,
      this.statusItems.mode,
      this.statusItems.layout,
      this.statusItems.transforms,
      this.statusItems.dirty,
      this.statusItems.server
    )
    const configuration = vscode.workspace.getConfiguration('omegaEdit')
    const configuredStorage =
      this.extensionContext?.storageUri?.fsPath ||
      this.extensionContext?.globalStorageUri?.fsPath
    const storageRoot =
      configuredStorage ??
      path.join(os.tmpdir(), 'omega-edit-vscode-checkpoint-storage')
    this.timelineStorage = Promise.resolve().then(async () => {
      const manager = new CheckpointTimelineStorageManager(storageRoot, {
        limits: {
          maxBytesPerSession: configuration.get(
            'checkpointHistory.maxBytesPerSession',
            CHECKPOINT_HISTORY_DEFAULTS.maxBytesPerSession
          ),
          maxBytesTotal: configuration.get(
            'checkpointHistory.maxBytesTotal',
            CHECKPOINT_HISTORY_DEFAULTS.maxBytesTotal
          ),
          maxCheckpoints: configuration.get(
            'checkpointHistory.maxCheckpoints',
            CHECKPOINT_HISTORY_DEFAULTS.maxCheckpoints
          ),
          staleRetentionDays: configuration.get(
            'checkpointHistory.staleRetentionDays',
            CHECKPOINT_HISTORY_DEFAULTS.staleRetentionDays
          ),
        },
      })
      await manager.initialize()
      return manager
    })
    this.hideStatusBar()
  }

  private getViewportCapacity(bytesPerRow: number): number {
    const bufferedRows = Math.max(
      128,
      Math.ceil(VIEWPORT_BUFFER_BYTES / bytesPerRow)
    )
    return bufferedRows * bytesPerRow
  }

  private async applySessionBytesPerRow(
    session: EditorSession,
    bytesPerRow: BytesPerRow
  ): Promise<void> {
    const normalizedBytesPerRow = normalizeBytesPerRow(bytesPerRow)
    const capacity = this.getViewportCapacity(normalizedBytesPerRow)
    const bytesPerRowChanged = session.bytesPerRow !== normalizedBytesPerRow
    session.bytesPerRow = normalizedBytesPerRow
    session.webviewState = {
      ...session.webviewState,
      bytesPerRow: normalizedBytesPerRow,
    }
    if (!bytesPerRowChanged && session.capacity === capacity) {
      this.postEditState(session)
      return
    }

    session.capacity = capacity
    session.bufferOffset = -1
    await this.scrollTo(session, session.offset)
    this.postEditState(session)
  }

  private async updateBytesPerRowConfiguration(
    session: EditorSession,
    value: number
  ): Promise<void> {
    const resource = vscode.Uri.file(session.filePath)
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource)
    const configuration = vscode.workspace.getConfiguration(
      'omegaEdit',
      resource
    )
    const targets = workspaceFolder
      ? [
          vscode.ConfigurationTarget.WorkspaceFolder,
          vscode.ConfigurationTarget.Workspace,
          vscode.ConfigurationTarget.Global,
        ]
      : vscode.workspace.workspaceFolders &&
          vscode.workspace.workspaceFolders.length > 0
        ? [
            vscode.ConfigurationTarget.Workspace,
            vscode.ConfigurationTarget.Global,
          ]
        : [vscode.ConfigurationTarget.Global]

    let lastError: unknown
    let updated = false
    for (const target of targets) {
      try {
        await configuration.update('bytesPerRow', value, target)
        updated = true
        break
      } catch (err) {
        lastError = err
      }
    }

    if (!updated && lastError) {
      throw lastError
    }
  }

  public getSessionForTesting(uri: vscode.Uri): EditorSession | undefined {
    if (process.env.NODE_ENV !== 'test') {
      return undefined
    }
    return this.sessions.get(uri.toString())
  }

  private getLocalResourceRoots(): readonly vscode.Uri[] {
    const extensionUri = this.extensionContext?.extensionUri
    return extensionUri ? [getSvelteWebviewLocalResourceRoot(extensionUri)] : []
  }

  private renderWebviewHtml(
    webview: vscode.Webview,
    bytesPerRowSetting: number
  ): string {
    const extensionUri = this.extensionContext?.extensionUri
    if (!extensionUri) {
      const message = escapeHtmlText(
        vscode.l10n.t('OmegaEdit webview unavailable.')
      )
      return `<!DOCTYPE html><html><body>${message}</body></html>`
    }

    return getSvelteWebviewContent(webview, extensionUri, bytesPerRowSetting)
  }

  public async dispatchWebviewMessageForTesting(
    uri: vscode.Uri,
    msg: WebviewToHostMessage,
    options?: { propagateErrors?: boolean }
  ): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('Test-only message dispatch is unavailable outside tests')
    }

    const session = this.sessions.get(uri.toString())
    if (!session) {
      throw new Error(`No session found for ${uri.toString()}`)
    }

    // Intercept operations that would normally route through VS Code commands
    // in production; invoke session logic directly in the test context where
    // no real VS Code custom-editor edit stack is registered.
    switch (msg.type) {
      case 'undo':
        if (!this.ensureSessionCanMutate(session)) {
          return
        }
        await this.performUndoOnSession(session)
        return
      case 'redo':
        if (!this.ensureSessionCanMutate(session)) {
          return
        }
        await this.performRedoOnSession(session)
        return
      case 'save':
      case 'saveAs': {
        const cts = new vscode.CancellationTokenSource()
        try {
          await this.saveCustomDocument(session.document, cts.token)
        } finally {
          cts.dispose()
        }
        return
      }
      case 'revert': {
        if (!this.ensureSessionCanMutate(session)) {
          return
        }
        const cts = new vscode.CancellationTokenSource()
        try {
          await this.revertCustomDocument(session.document, cts.token)
        } finally {
          cts.dispose()
        }
        return
      }
    }

    await this.handleWebviewMessage(
      session,
      msg,
      options?.propagateErrors === true
    )
  }

  public async undoActive(): Promise<WebviewEditorState | undefined> {
    const session = this.activeSession
    if (!session) {
      return
    }
    await this.enqueueHistoryCommand(session, 'undo', true)
    return this.buildEditorState(session)
  }

  public async redoActive(): Promise<WebviewEditorState | undefined> {
    const session = this.activeSession
    if (!session) {
      return
    }
    await this.enqueueHistoryCommand(session, 'redo', true)
    return this.buildEditorState(session)
  }

  public searchNextActive(): void {
    this.postSearchNavigationCommand('forward')
  }

  public searchPreviousActive(): void {
    this.postSearchNavigationCommand('backward')
  }

  public setTextEncoding(
    encodingOrOptions?: unknown,
    options?: unknown
  ): WebviewEditorState | undefined {
    const requestedEncoding =
      safeTextEncoding(encodingOrOptions) ??
      (isRecord(encodingOrOptions)
        ? safeTextEncoding(
            encodingOrOptions.textEncoding ?? encodingOrOptions.encoding
          )
        : undefined)
    const commandOptions =
      requestedEncoding && !isRecord(encodingOrOptions)
        ? options
        : encodingOrOptions
    const session = this.resolveCommandSession(commandOptions)
    if (!session) {
      return undefined
    }

    if (requestedEncoding) {
      this.setSessionTextEncoding(session, requestedEncoding)
    }
    return this.buildEditorState(session)
  }

  public async refreshActiveTransformPlugins(): Promise<
    WebviewEditorState | undefined
  > {
    const session = this.activeSession
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }

    await this.sendTransformPlugins(session)
    return this.buildEditorState(session)
  }

  private postSearchNavigationCommand(direction: 'forward' | 'backward'): void {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }

    this.postWebviewMessage(this.activeSession, {
      type: 'searchNavigationCommand',
      direction,
    })
  }

  // --- VS Code Custom Editor API ---

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<HexDocument> {
    const doc = new HexDocument(uri, openContext.backupId)
    return doc
  }

  async resolveCustomEditor(
    document: HexDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const uri = document.uri
    if (uri.scheme !== 'file') {
      throw new Error(
        vscode.l10n.t('OmegaEdit Data Editor can only open local files')
      )
    }
    const filePath = uri.fsPath

    // --- Create Ωedit™ session for this file ---
    const config = vscode.workspace.getConfiguration('omegaEdit')
    const bytesPerRowSetting = normalizeBytesPerRowSetting(
      config.get('bytesPerRow')
    )
    const bytesPerRow = bytesPerRowFromSetting(bytesPerRowSetting)

    // Keep a fixed buffered viewport so resizing the editor does not need to
    // resize the server-side viewport. Only the visible row count changes.
    const capacity = this.getViewportCapacity(bytesPerRow)

    // Configure the webview before opening the native session so very large
    // files still show a live preparing state while Ωedit copies the original
    // into its immutable checkpoint.
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalResourceRoots(),
    }
    webviewPanel.webview.html = this.renderWebviewHtml(
      webviewPanel.webview,
      bytesPerRowSetting
    )

    const panelDisposables: vscode.Disposable[] = []
    const pendingWebviewMessages: WebviewToHostMessage[] = []
    let resolvedSession: EditorSession | undefined
    let panelDisposed = false
    webviewPanel.webview.onDidReceiveMessage(
      (msg) => {
        if (!resolvedSession) {
          pendingWebviewMessages.push(msg)
          return
        }
        void this.handleWebviewMessage(resolvedSession, msg)
      },
      undefined,
      panelDisposables
    )
    this.pendingHealthWebviews.add(webviewPanel.webview)
    panelDisposables.push(
      webviewPanel.onDidDispose(() => {
        panelDisposed = true
        this.pendingHealthWebviews.delete(webviewPanel.webview)
        this.stopHealthPollingIfIdle()
      })
    )
    this.startHealthPolling()

    // --- Create a viewport starting at offset 0 ---
    // If VS Code supplies a backup id (crash-recovery), open from the backup so
    // unsaved edits are restored; save still targets the original filePath.
    const backupFilePath = backupIdToFilePath(document.backupId)
    const wasRestoredFromBackup = !!backupFilePath
    const restoreFromPath = backupFilePath ?? filePath
    document.backupId = undefined // consume – do not re-use on subsequent resolves

    let scope: ScopedEditorSessionHandle
    try {
      scope = await ScopedEditorSessionHandle.openFile(restoreFromPath, {
        filePath: restoreFromPath,
        capacity,
      })
    } catch (error) {
      this.pendingHealthWebviews.delete(webviewPanel.webview)
      this.stopHealthPollingIfIdle()
      throw error
    }
    if (panelDisposed) {
      await scope.dispose()
      this.stopHealthPollingIfIdle()
      return
    }

    let fingerprintFailure: unknown
    const originalFingerprint = await getChangeLogFingerprint(
      scope.sessionId,
      SessionFingerprintContent.COMPUTED,
      DEFAULT_CHANGE_LOG_DIGEST_ALGORITHM
    ).catch((error) => {
      fingerprintFailure = error
      return {
        byteLength: String(scope.model.fileSize),
        digest: { algorithm: 'sha256', value: '0'.repeat(64) },
      }
    })
    const saveConflictFingerprintAlgorithm =
      resolveSaveConflictFingerprintAlgorithm(uri)
    const savedDiskFingerprint =
      !fingerprintFailure &&
      originalFingerprint.digest.algorithm === saveConflictFingerprintAlgorithm
        ? originalFingerprint
        : await getChangeLogFingerprint(
            scope.sessionId,
            SessionFingerprintContent.COMPUTED,
            saveConflictFingerprintAlgorithm
          ).catch(() => undefined)
    const timelineStorage = fingerprintFailure
      ? undefined
      : await this.timelineStorage
          ?.then((manager) =>
            manager.createSession(
              document.uri.toString(true),
              originalFingerprint,
              path.basename(filePath)
            )
          )
          .catch((error) => {
            fingerprintFailure = error
            return undefined
          })
    if (fingerprintFailure) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Checkpoint history storage is unavailable; editing remains enabled. {message}',
          {
            message:
              fingerprintFailure instanceof Error
                ? fingerprintFailure.message
                : String(fingerprintFailure),
          }
        )
      )
    }

    const session: EditorSession = {
      get sessionId() {
        return this.scope.sessionId
      },
      get viewportId() {
        return this.scope.viewportId
      },
      get fileSize() {
        return this.scope.model.fileSize
      },
      get changeCount() {
        return this.scope.model.changeCount
      },
      get sessionSyncVersion() {
        return this.scope.model.syncVersion
      },
      offset: 0,
      bufferOffset: 0,
      visibleRows: 32,
      capacity,
      bytesPerRowSetting,
      bytesPerRow,
      filePath,
      panel: webviewPanel,
      document,
      scope,
      history: new EditorHistoryController(),
      search: new EditorSearchController(scope.sessionId),
      webviewState: initialWebviewState(bytesPerRow),
      externalHighlights: [],
      rangeMapTree: [],
      contentSources: defaultContentSources(scope.model.fileSize),
      transformPlugins: [],
      transformInFlight: false,
      restoredFromBackup: wasRestoredFromBackup,
      savedDiskFingerprint,
      checkpointTimeline: {
        entries: [],
        storage: timelineStorage,
        originalFingerprint,
        lastArchivedChangeCount: 0,
        cursor: 0,
        savedChangeCount: 0,
        savedFingerprint: originalFingerprint,
        currentFingerprint: originalFingerprint,
        visible: false,
        navigating: false,
      },
      actionJournal: {
        visible: false,
        capacity: 256,
        direction: 'older',
        kinds: [...WEBVIEW_ACTION_JOURNAL_KINDS],
        entries: new Map(),
        requestGeneration: 0,
        refreshPending: false,
      },
    }
    if (timelineStorage) {
      const heartbeatTimer = setInterval(() => {
        void timelineStorage.heartbeat().catch((error) => {
          console.warn(
            `Failed to refresh checkpoint timeline heartbeat: ${error instanceof Error ? error.message : String(error)}`
          )
        })
      }, 60_000)
      panelDisposables.push({ dispose: () => clearInterval(heartbeatTimer) })
    }
    this.sessions.set(uri.toString(), session)
    this.updateActiveSessionResourcePathContext()
    this.pendingHealthWebviews.delete(webviewPanel.webview)
    resolvedSession = session
    this.activeSession = session
    this.updateEditCommandContexts(session)

    // Send initial data to the webview. The message listener must be in place
    // first because the webview posts its first metrics update as soon as it
    // mounts, and that update is also our reliable ready-to-render signal.
    for (const pendingMessage of pendingWebviewMessages.splice(0)) {
      await this.handleWebviewMessage(session, pendingMessage)
    }
    await this.sendViewportData(session)
    await this.refreshSessionContentInfo(session)
    this.postEditState(session)
    this.postEditMode(session)

    await this.startSessionSubscriptions(session)

    // Track which editor is active (for command routing)
    webviewPanel.onDidChangeViewState(
      () => {
        if (webviewPanel.active) {
          this.activeSession = session
          this.updateEditCommandContexts(session)
        } else if (this.activeSession === session) {
          this.activeSession = undefined
          this.updateEditCommandContexts(undefined)
        }
      },
      undefined,
      panelDisposables
    )

    // --- Cleanup on close ---
    webviewPanel.onDidDispose(async () => {
      session.disposed = true
      vscode.Disposable.from(...panelDisposables).dispose()
      this.sessions.delete(uri.toString())
      this.updateActiveSessionResourcePathContext()
      if (this.activeSession === session) {
        this.activeSession = undefined
        this.updateEditCommandContexts(undefined)
      }
      this.stopHealthPollingIfIdle()
      await session.checkpointTimeline.operation?.catch(() => undefined)
      await session.scope.dispose()
      await session.checkpointTimeline.storage?.close().catch((error) => {
        console.warn(
          `Failed to remove checkpoint timeline storage: ${error instanceof Error ? error.message : String(error)}`
        )
      })
    })
  }

  // --- CustomEditorProvider required methods ---

  private async runSerializedSave(
    session: EditorSession,
    cancellation: vscode.CancellationToken,
    operation: () => Promise<void>
  ): Promise<void> {
    const previous = session.saveTask ?? Promise.resolve()
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        if (cancellation.isCancellationRequested) {
          throw new vscode.CancellationError()
        }
        await operation()
      })
    session.saveTask = task
    try {
      await task
    } finally {
      if (session.saveTask === task) {
        session.saveTask = undefined
      }
    }
  }

  private async recordSuccessfulSave(
    session: EditorSession,
    updateOriginalDiskFingerprint: boolean
  ): Promise<void> {
    session.restoredFromBackup = false
    session.history.markSaved()
    session.checkpointTimeline.savedChangeCount = await getChangeCount(
      session.sessionId
    )
    const fingerprint = await getChangeLogFingerprint(
      session.sessionId,
      SessionFingerprintContent.COMPUTED,
      DEFAULT_CHANGE_LOG_DIGEST_ALGORITHM
    )
    session.checkpointTimeline.savedFingerprint = fingerprint
    session.checkpointTimeline.currentFingerprint = fingerprint
    if (updateOriginalDiskFingerprint) {
      const algorithm = resolveSaveConflictFingerprintAlgorithm(
        session.document.uri
      )
      session.savedDiskFingerprint =
        fingerprint.digest.algorithm === algorithm
          ? fingerprint
          : await getChangeLogFingerprint(
              session.sessionId,
              SessionFingerprintContent.COMPUTED,
              algorithm
            ).catch(() => undefined)
    }
    await session.checkpointTimeline.storage?.setSavedFingerprint(fingerprint)
    this.postCheckpointTimeline(session)
    this.postEditState(session)
  }

  async saveCustomDocument(
    document: HexDocument,
    cancellation: vscode.CancellationToken
  ): Promise<void> {
    const session = this.sessions.get(document.uri.toString())
    if (!session) {
      return
    }
    await this.runSerializedSave(session, cancellation, async () => {
      await saveSessionWithKnownDiskVersion(session, cancellation)
      await this.recordSuccessfulSave(session, true)
    })
  }

  async saveCustomDocumentAs(
    document: HexDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken
  ): Promise<void> {
    const session = this.sessions.get(document.uri.toString())
    if (!session) {
      return
    }
    if (destination.scheme !== 'file') {
      throw new Error(
        vscode.l10n.t('OmegaEdit Data Editor can only save to local files')
      )
    }
    await this.runSerializedSave(session, cancellation, async () => {
      await saveSessionOrThrow(
        session.sessionId,
        destination.fsPath,
        IOFlags.OVERWRITE
      )
      await this.recordSuccessfulSave(session, false)
    })
  }

  async revertCustomDocument(
    document: HexDocument,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    const session = this.sessions.get(document.uri.toString())
    if (!session || session.scope.isDisposed) {
      return
    }

    await this.revertSessionChanges(session, false)
  }

  async backupCustomDocument(
    document: HexDocument,
    context: vscode.CustomDocumentBackupContext,
    _cancellation: vscode.CancellationToken
  ): Promise<vscode.CustomDocumentBackup> {
    const session = this.sessions.get(document.uri.toString())
    if (session && !session.scope.isDisposed) {
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(context.destination, '..')
      )
      await saveSessionOrThrow(
        session.sessionId,
        context.destination.fsPath,
        IOFlags.OVERWRITE
      )
    }
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination)
        } catch {
          // Backup may not exist; ignore.
        }
      },
    }
  }

  private async startSessionSubscriptions(
    session: EditorSession
  ): Promise<void> {
    await session.scope.startSubscriptions({
      sessionInterest: ALL_EVENTS,
      viewportInterest: ALL_EVENTS,
      onViewportEvent: async (event) => {
        const kind = event.getViewportEventKind()
        if (
          kind === ViewportEventKind.EDIT ||
          kind === ViewportEventKind.UNDO ||
          kind === ViewportEventKind.CLEAR ||
          kind === ViewportEventKind.TRANSFORM ||
          kind === ViewportEventKind.MODIFY ||
          kind === ViewportEventKind.CHANGES
        ) {
          await this.sendViewportData(session)
        }
      },
      onSessionEvent: async (event, context) => {
        this.postTransformProgress(session, event)
        const kind = event.getSessionEventKind()
        if (
          kind === SessionEventKind.EDIT ||
          kind === SessionEventKind.UNDO ||
          kind === SessionEventKind.CLEAR ||
          kind === SessionEventKind.TRANSFORM ||
          kind === SessionEventKind.CREATE_CHECKPOINT ||
          kind === SessionEventKind.DESTROY_CHECKPOINT ||
          kind === SessionEventKind.RESTORE_CHECKPOINT
        ) {
          this.queueActionJournalRefresh(session)
        }
        if (!context.stateChanged) {
          return
        }

        this.postWebviewMessage(session, {
          type: 'fileSizeChanged',
          fileSize: context.model.fileSize,
        })
        void this.refreshSessionContentInfo(session)
        if (session.search.shouldClearAfterExternalEdit()) {
          this.clearSearchState(session)
        }
      },
    })
  }

  // --- Public methods called from extension.ts ---

  /** Navigate the active editor to a byte offset */
  goToOffset(offset: number): void {
    if (this.activeSession) {
      void this.revealOffset({ offset })
    }
  }

  async revealOffset(options: {
    uri?: vscode.Uri | string
    offset: number
  }): Promise<WebviewEditorState | undefined> {
    const offset = safeNonNegativeInteger(options.offset)
    if (offset === undefined) {
      throw new TypeError('Offset must be a non-negative safe integer')
    }

    const session = this.resolveCommandSession(options)
    if (!session) {
      return undefined
    }

    const maxOffset = Math.max(0, session.fileSize - 1)
    if (offset > maxOffset) {
      throw new RangeError(
        `Offset ${offset} is outside the file range 0..${maxOffset}`
      )
    }

    await this.scrollTo(session, offset)
    return this.buildEditorState(session)
  }

  getEditorState(options?: unknown): WebviewEditorState | undefined {
    const session = this.resolveCommandSession(options)
    return session ? this.buildEditorState(session) : undefined
  }

  async getActionJournalViewport(options?: {
    uri?: vscode.Uri | string
    anchorSerial?: string | number | bigint
    capacity?: number
    direction?: 'older' | 'newer'
    kinds?: WebviewActionJournalKind[]
    transactionId?: string
  }): Promise<ActionJournalViewport | undefined> {
    const session = this.resolveCommandSession(options)
    if (!session) {
      return undefined
    }
    return requestActionJournalViewport({
      sessionId: session.sessionId,
      anchorSerial: options?.anchorSerial,
      capacity: options?.capacity,
      direction: options?.direction,
      kinds: options?.kinds,
      transactionId: options?.transactionId,
    })
  }

  async showActionJournal(options?: unknown): Promise<void> {
    const session = this.resolveCommandSession(options)
    if (!session) {
      return
    }
    if (session.checkpointTimeline.visible) {
      session.checkpointTimeline.visible = false
      this.postCheckpointTimeline(session)
    }
    await this.postActionJournalViewport(session)
  }

  getAssistantContext(options?: unknown): AssistantSessionContext | undefined {
    const session = this.resolveCommandSession(options)
    return session ? this.buildAssistantContext(session) : undefined
  }

  async setExternalHighlights(
    highlightsOrRequest?: unknown,
    options?: unknown
  ): Promise<WebviewEditorState | undefined> {
    const request = this.parseExternalHighlightCommand(
      highlightsOrRequest,
      options
    )
    const session = this.resolveCommandSession(request.options)
    if (!session) {
      return undefined
    }

    const highlights = normalizeExternalHighlights(
      { fileSize: session.fileSize },
      request.highlights
    )
    if (!highlights) {
      throw new Error('Invalid external highlight request')
    }

    this.setSessionExternalHighlights(session, highlights)

    if (request.options.reveal && highlights.length > 0) {
      await this.scrollTo(session, highlights[0].offset)
    }

    return this.buildEditorState(session)
  }

  clearExternalHighlights(options?: unknown): WebviewEditorState | undefined {
    const session = this.resolveCommandSession(options)
    if (!session) {
      return undefined
    }

    this.clearSessionExternalHighlights(session)
    return this.buildEditorState(session)
  }

  unloadRangeMap(options?: unknown): RangeMapUnloadResult | undefined {
    const session = this.resolveCommandSession(options)
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }

    const unloadedCount = session.externalHighlights.length
    this.clearSessionExternalHighlights(session)

    if (unloadedCount > 0 && (!isRecord(options) || options.notify !== false)) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Unloaded {count} range map label(s)', {
          count: unloadedCount,
        })
      )
    }

    return {
      state: this.buildEditorState(session),
      unloadedCount,
      highlightCount: 0,
    }
  }

  async loadRangeMap(
    options?: unknown
  ): Promise<RangeMapLoadResult | undefined> {
    const session = this.resolveCommandSession(options)
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }

    const rangeMapUri =
      parseCommandOptionUri(options, 'sourceUri') ??
      (
        await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { JSON: ['json'] },
          openLabel: vscode.l10n.t('Load Range Map'),
          title: vscode.l10n.t('Load OmegaEdit range map'),
        })
      )?.[0]

    if (!rangeMapUri) {
      return {
        state: this.buildEditorState(session),
        nodeCount: 0,
        highlightCount: 0,
        cancelled: true,
      }
    }

    let parsed: ReturnType<typeof parseRangeMapContent>
    let highlights: NonNullable<ReturnType<typeof normalizeExternalHighlights>>
    try {
      parsed = parseRangeMapContent(
        await vscode.workspace.fs.readFile(rangeMapUri)
      )
      assertRangeMapFitsFile(parsed, session.fileSize)
      const normalizedHighlights = normalizeExternalHighlights(
        { fileSize: session.fileSize },
        parsed.highlights
      )
      if (!normalizedHighlights) {
        throw new Error('Range map highlights failed validation')
      }
      highlights = normalizedHighlights
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!isRecord(options) || options.notify !== false) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t('Could not load OmegaEdit range map: {message}', {
            message,
          })
        )
      }
      return {
        state: this.buildEditorState(session),
        sourceUri: rangeMapUri,
        nodeCount: 0,
        highlightCount: 0,
        cancelled: true,
        message,
      }
    }

    const selectedHighlight =
      parsed.selectedHighlight === undefined
        ? undefined
        : highlights.find(
            (highlight) => highlight.id === parsed.selectedHighlight?.id
          )
    this.setSessionRangeMap(session, highlights, parsed.tree)

    const shouldReveal = !isRecord(options) || options.reveal !== false
    if (shouldReveal && selectedHighlight) {
      await this.scrollTo(session, selectedHighlight.offset)
    }

    const message = selectedHighlight
      ? vscode.l10n.t('Loaded {count} range map label(s); selected {path}', {
          count: highlights.length,
          path: parsed.document.selectedPath ?? selectedHighlight.label,
        })
      : vscode.l10n.t('Loaded {count} range map label(s)', {
          count: highlights.length,
        })
    if (!isRecord(options) || options.notify !== false) {
      void vscode.window.showInformationMessage(message)
    }

    return {
      state: this.buildEditorState(session),
      sourceUri: rangeMapUri,
      source: parsed.document.source,
      nodeCount: parsed.nodeCount,
      highlightCount: highlights.length,
      selectedPath: parsed.document.selectedPath,
      selectedRange: selectedHighlight
        ? {
            offset: selectedHighlight.offset,
            length: selectedHighlight.length,
          }
        : undefined,
    }
  }

  setInsertDirection(
    directionOrOptions?: unknown,
    options?: unknown
  ): WebviewEditorState | undefined {
    const requestedDirection =
      safeInsertDirection(directionOrOptions) ??
      (isRecord(directionOrOptions)
        ? safeInsertDirection(
            directionOrOptions.insertDirection ?? directionOrOptions.direction
          )
        : undefined)
    const commandOptions =
      requestedDirection && !isRecord(directionOrOptions)
        ? options
        : directionOrOptions
    const session = this.resolveCommandSession(commandOptions)
    if (!session) {
      return undefined
    }

    const insertDirection =
      requestedDirection ??
      (session.webviewState.insertDirection === 'forward'
        ? 'backward'
        : 'forward')
    this.setSessionInsertDirection(session, insertDirection)
    return this.buildEditorState(session)
  }

  /** Re-read bytesPerRow from config and refresh all open editors */
  refreshBytesPerRow(bytesPerRowSettingOverride?: number): void {
    const bytesPerRowSetting = normalizeBytesPerRowSetting(
      bytesPerRowSettingOverride ??
        vscode.workspace.getConfiguration('omegaEdit').get('bytesPerRow')
    )
    for (const session of this.sessions.values()) {
      const bytesPerRow = bytesPerRowFromSetting(bytesPerRowSetting)
      session.bytesPerRowSetting = bytesPerRowSetting
      this.postBytesPerRow(session, bytesPerRow)
      this.postTransformStatus(
        session,
        session.transformInFlight,
        undefined,
        session.transformInFlight
          ? transformMutationBlockedMessage()
          : undefined
      )
      void this.applySessionBytesPerRow(session, bytesPerRow)
    }
  }

  /** Re-render open webviews after the UI language setting changes. */
  refreshLanguage(): void {
    for (const session of this.sessions.values()) {
      session.panel.webview.options = {
        ...session.panel.webview.options,
        localResourceRoots: this.getLocalResourceRoots(),
      }
      session.panel.webview.html = this.renderWebviewHtml(
        session.panel.webview,
        session.bytesPerRowSetting
      )
      this.postTransformStatus(
        session,
        session.transformInFlight,
        undefined,
        session.transformInFlight
          ? transformMutationBlockedMessage()
          : undefined
      )
      void this.sendViewportData(session)
      this.postEditState(session)
    }
  }

  private async createChangeLogPreview(
    session: EditorSession,
    parsed: ParsedChangeLog,
    scriptUri: vscode.Uri | undefined
  ): Promise<ChangeLogPreview> {
    const safetyIssues: ChangeLogSafetyIssue[] = []
    const transformDescriptors = parsed.transformDescriptors
    const requiredPlugins = parsed.requiredPlugins
    let missingPlugins: string[] = []

    if (parsed.unavailableChangeSerials.length > 0) {
      safetyIssues.push({
        severity: 'error',
        code: 'unavailable-primitives',
        message: `${incompleteChangeLogMessage(
          'apply'
        )}${describeUnavailableSerials(parsed.unavailableChangeSerials)}`,
      })
    }

    const current = await getChangeLogFingerprint(
      session.sessionId,
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
      getChangeCount(session.sessionId),
      this.getCheckpointCount(session),
      listTransformPlugins(),
    ])
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

    const errorCount = safetyIssues.filter(
      (issue) => issue.severity === 'error'
    ).length

    return {
      state: this.buildEditorState(session),
      ...(scriptUri ? { uri: scriptUri } : {}),
      format: CHANGE_LOG_FORMAT,
      version: CHANGE_LOG_VERSION,
      complete: parsed.complete,
      canApply: errorCount === 0,
      primitiveCounts: parsed.primitiveCounts,
      before: parsed.before,
      after: parsed.after,
      current,
      expectedSize: createExpectedSizeDelta(parsed),
      transformDescriptors,
      requiredPlugins,
      missingPlugins,
      unavailablePrimitives: {
        count: parsed.unavailableChangeCount,
        serials: parsed.unavailableChangeSerials,
      },
      rollbackProtection: {
        available: true,
        strategy: 'restore-to-change-count',
        targetChangeCount,
        checkpointCount,
      },
      safetyIssues,
    }
  }

  private async showChangeLogPreviewDocument(
    preview: ChangeLogPreview
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      language: 'json',
      content: JSON.stringify(
        serializeChangeLogPreviewForDisplay(preview),
        null,
        2
      ),
    })
    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    })
  }

  async previewChangeLog(
    options?: unknown
  ): Promise<ChangeLogPreview | undefined> {
    const session = this.resolveCommandSession(options)
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }

    const providedScriptUri = parseCommandOptionUri(options, 'sourceUri')
    const scriptUri =
      providedScriptUri ??
      (
        await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { JSON: ['json'] },
          openLabel: vscode.l10n.t('Preview Change Log'),
          title: vscode.l10n.t('Preview OmegaEdit change log'),
        })
      )?.[0]

    if (!scriptUri) {
      return {
        state: this.buildEditorState(session),
        format: CHANGE_LOG_FORMAT,
        version: CHANGE_LOG_VERSION,
        complete: false,
        canApply: false,
        primitiveCounts: {
          total: 0,
          insert: 0,
          delete: 0,
          overwrite: 0,
          replace: 0,
          transform: 0,
        },
        before: {
          byteLength: '0',
          digest: {
            algorithm: DEFAULT_CHANGE_LOG_DIGEST_ALGORITHM,
            value: '',
          },
        },
        after: {
          byteLength: '0',
          digest: {
            algorithm: DEFAULT_CHANGE_LOG_DIGEST_ALGORITHM,
            value: '',
          },
        },
        expectedSize: {
          beforeByteLength: '0',
          afterByteLength: '0',
          deltaBytes: '0',
        },
        transformDescriptors: [],
        requiredPlugins: [],
        missingPlugins: [],
        unavailablePrimitives: {
          count: 0,
          serials: [],
        },
        rollbackProtection: {
          available: false,
          strategy: 'not-inspected',
        },
        safetyIssues: [
          {
            severity: 'warning',
            code: 'cancelled',
            message: vscode.l10n.t('Change log preview cancelled'),
          },
        ],
      }
    }

    const controller = new AbortController()
    let parsed: ParsedChangeLog
    try {
      parsed = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Validating OmegaEdit change log…'),
          cancellable: true,
        },
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            controller.abort()
          )
          try {
            return await openParsedChangeLog(scriptUri, controller.signal)
          } finally {
            subscription.dispose()
          }
        }
      )
    } catch (error) {
      if (isChangeLogCancellationError(error)) {
        void vscode.window.showInformationMessage(
          vscode.l10n.t('Change log preview cancelled')
        )
        return
      }
      throw error
    }
    const preview = await this.createChangeLogPreview(
      session,
      parsed,
      scriptUri
    )
    if (!providedScriptUri) {
      await this.showChangeLogPreviewDocument(preview)
    }
    return preview
  }

  async exportChangeLog(options?: unknown): Promise<
    | {
        state: WebviewEditorState
        uri?: vscode.Uri
        changeCount: number
        sourceChangeCount?: number
        complete?: boolean
        before?: ChangeLogFingerprint
        after?: ChangeLogFingerprint
        unavailableChangeCount?: number
        unavailableChangeSerials?: number[]
        cancelled?: boolean
      }
    | undefined
  > {
    const session = this.resolveCommandSession(options)
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }

    const modelCheck = await checkSessionModel(session.sessionId)
    if (!modelCheck.valid) {
      throw new Error(
        vscode.l10n.t(
          'Change log export refused: OmegaEdit model integrity check failed with status {status}.',
          { status: modelCheck.status }
        )
      )
    }

    const before = await getChangeLogFingerprint(
      session.sessionId,
      SessionFingerprintContent.ORIGINAL
    )
    const sourceChangeCount = await getChangeCount(session.sessionId)
    const scriptUri =
      parseCommandOptionUri(options, 'targetUri') ??
      (await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          `${session.filePath}.omega-edit-change-log.json`
        ),
        filters: { JSON: ['json'] },
        saveLabel: vscode.l10n.t('Export Change Log'),
        title: vscode.l10n.t('Export OmegaEdit change log'),
      }))

    if (!scriptUri) {
      this.postSessionActionComplete(session, {
        action: 'exportChangeLog',
        changeCount: sourceChangeCount,
        cancelled: true,
        message: vscode.l10n.t('Change log export cancelled'),
      })
      return {
        state: this.buildEditorState(session),
        changeCount: sourceChangeCount,
        sourceChangeCount,
        cancelled: true,
      }
    }

    const after = await getChangeLogFingerprint(
      session.sessionId,
      SessionFingerprintContent.COMPUTED,
      before.digest.algorithm
    )
    const controller = new AbortController()
    const withExportProgress = async <T>(
      work: (
        progress: vscode.Progress<{ increment?: number; message?: string }>,
        signal: AbortSignal
      ) => Promise<T>
    ): Promise<T> =>
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Exporting {count} change log entries…', {
            count: sourceChangeCount,
          }),
          cancellable: true,
        },
        async (progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            controller.abort()
          )
          try {
            return await work(progress, controller.signal)
          } finally {
            subscription.dispose()
          }
        }
      )

    let changeCount = sourceChangeCount
    let unavailableChangeSerials: number[] = []
    try {
      if (scriptUri.scheme === 'file') {
        const collected = await withExportProgress(async (progress, signal) => {
          let previousSerial = 0
          return await writeChangeLogFile(
            scriptUri.fsPath,
            sourceChangeCount,
            before,
            after,
            async (writeRecord) =>
              await collectChangeLogRecords(
                session.sessionId,
                sourceChangeCount,
                writeRecord,
                (serial) => {
                  const increment =
                    sourceChangeCount === 0
                      ? 100
                      : ((serial - previousSerial) / sourceChangeCount) * 100
                  previousSerial = serial
                  progress.report({
                    increment,
                    message: vscode.l10n.t('{current} of {total}', {
                      current: serial,
                      total: sourceChangeCount,
                    }),
                  })
                },
                signal
              ),
            async () =>
              await assertChangeLogExportStable(
                session.sessionId,
                sourceChangeCount,
                after
              ),
            signal
          )
        })
        unavailableChangeSerials = collected.unavailableChangeSerials
      } else {
        const changes: ChangeRecord[] = []
        if (sourceChangeCount > 0) {
          let encodedEntryBytes = 0
          const collected = await withExportProgress(
            async (progress, signal) => {
              let previousSerial = 0
              return await collectChangeLogRecords(
                session.sessionId,
                sourceChangeCount,
                async (record) => {
                  if (changes.length >= MAX_NON_FILE_CHANGE_LOG_ENTRIES) {
                    throw new Error(
                      `Non-file change log export is limited to ${MAX_NON_FILE_CHANGE_LOG_ENTRIES} entries because this file system provider does not expose streaming writes`
                    )
                  }
                  encodedEntryBytes += Buffer.byteLength(
                    JSON.stringify(serializeChangeLogEntry(record)),
                    'utf8'
                  )
                  if (encodedEntryBytes > MAX_NON_FILE_CHANGE_LOG_BYTES) {
                    throw new Error(
                      `Non-file change log export is limited to ${MAX_NON_FILE_CHANGE_LOG_BYTES} bytes because this file system provider does not expose streaming writes`
                    )
                  }
                  changes.push(record)
                },
                (serial) => {
                  const increment =
                    ((serial - previousSerial) / sourceChangeCount) * 100
                  previousSerial = serial
                  progress.report({
                    increment,
                    message: vscode.l10n.t('{current} of {total}', {
                      current: serial,
                      total: sourceChangeCount,
                    }),
                  })
                },
                signal
              )
            }
          )
          unavailableChangeSerials = collected.unavailableChangeSerials
        }
        assertCompleteChangeLog('export', unavailableChangeSerials)
        await assertChangeLogExportStable(
          session.sessionId,
          sourceChangeCount,
          after
        )
        changeCount = changes.length
        const unavailableChangeCount = unavailableChangeSerials.length
        const content = Buffer.from(
          JSON.stringify(
            {
              format: CHANGE_LOG_FORMAT,
              version: CHANGE_LOG_VERSION,
              complete: unavailableChangeCount === 0,
              before,
              after,
              changeCount: changeCount.toString(),
              sourceChangeCount: sourceChangeCount.toString(),
              unavailableChangeCount: unavailableChangeCount.toString(),
              unavailableChangeSerials: unavailableChangeSerials.map((serial) =>
                serial.toString()
              ),
              changes: changes.map(serializeChangeLogEntry),
            },
            null,
            2
          ),
          'utf8'
        )
        if (content.byteLength > MAX_NON_FILE_CHANGE_LOG_BYTES) {
          throw new Error(
            `Non-file change log export is limited to ${MAX_NON_FILE_CHANGE_LOG_BYTES} bytes because this file system provider does not expose streaming writes`
          )
        }
        if (controller.signal.aborted) {
          throw new ChangeLogCancelledError()
        }
        await vscode.workspace.fs.writeFile(scriptUri, content)
      }
    } catch (error) {
      if (!isChangeLogCancellationError(error)) {
        throw error
      }
      this.postSessionActionComplete(session, {
        action: 'exportChangeLog',
        changeCount: 0,
        cancelled: true,
        message: vscode.l10n.t('Change log export cancelled'),
      })
      return {
        state: this.buildEditorState(session),
        uri: scriptUri,
        changeCount: 0,
        sourceChangeCount,
        cancelled: true,
      }
    }
    assertCompleteChangeLog('export', unavailableChangeSerials)
    const unavailableChangeCount = unavailableChangeSerials.length
    this.postSessionActionComplete(session, {
      action: 'exportChangeLog',
      changeCount,
      message: vscode.l10n.t('Exported {count} change(s)', {
        count: changeCount,
      }),
    })
    void vscode.window.showInformationMessage(
      vscode.l10n.t('OmegaEdit change log saved to {path}', {
        path: scriptUri.fsPath,
      })
    )
    return {
      state: this.buildEditorState(session),
      uri: scriptUri,
      changeCount,
      sourceChangeCount,
      complete: unavailableChangeCount === 0,
      before,
      after,
      unavailableChangeCount,
      unavailableChangeSerials,
    }
  }

  async applyChangeLog(
    options?: unknown
  ): Promise<ChangeLogApplyResult | undefined> {
    const session = this.resolveCommandSession(options)
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

    const providedScriptUri = parseCommandOptionUri(options, 'sourceUri')
    const scriptUri =
      providedScriptUri ??
      (
        await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { JSON: ['json'] },
          openLabel: vscode.l10n.t('Apply Change Log'),
          title: vscode.l10n.t('Apply OmegaEdit change log'),
        })
      )?.[0]

    if (!scriptUri) {
      this.postSessionActionComplete(session, {
        action: 'applyChangeLog',
        changeCount: 0,
        cancelled: true,
        message: vscode.l10n.t('Change log apply cancelled'),
      })
      return {
        state: this.buildEditorState(session),
        changeCount: 0,
        appliedCount: 0,
        cancelled: true,
        rollback: {
          attempted: false,
        },
      }
    }

    const controller = new AbortController()
    let parsed: ParsedChangeLog
    try {
      parsed = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Validating OmegaEdit change log…'),
          cancellable: true,
        },
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            controller.abort()
          )
          try {
            return await openParsedChangeLog(scriptUri, controller.signal)
          } finally {
            subscription.dispose()
          }
        }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.postSessionActionComplete(session, {
        action: 'applyChangeLog',
        changeCount: 0,
        cancelled: true,
        message,
      })
      if (isChangeLogCancellationError(error)) {
        void vscode.window.showInformationMessage(
          vscode.l10n.t('Change log apply cancelled')
        )
      } else {
        void vscode.window.showErrorMessage(
          vscode.l10n.t('Invalid OmegaEdit change log: {message}', {
            message,
          })
        )
      }
      return {
        state: this.buildEditorState(session),
        uri: scriptUri,
        changeCount: 0,
        appliedCount: 0,
        cancelled: true,
        rollback: {
          attempted: false,
        },
      }
    }
    const preview = await this.createChangeLogPreview(
      session,
      parsed,
      scriptUri
    )
    if (!providedScriptUri) {
      await this.showChangeLogPreviewDocument(preview)
    }
    const baseResult = (
      appliedCount: number,
      rollback: NonNullable<ChangeLogApplyResult['rollback']>,
      finalFingerprint?: ChangeLogFingerprint,
      cancelled?: boolean
    ): ChangeLogApplyResult => ({
      state: this.buildEditorState(session),
      uri: scriptUri,
      changeCount: appliedCount,
      appliedCount,
      sourceChangeCount: parsed.entryCount,
      complete: parsed.complete,
      before: parsed.before,
      after: parsed.after,
      unavailableChangeCount: parsed.unavailableChangeSerials.length,
      unavailableChangeSerials: parsed.unavailableChangeSerials,
      ...(cancelled !== undefined ? { cancelled } : {}),
      preview,
      rollback,
      ...(finalFingerprint ? { finalFingerprint } : {}),
    })

    if (!preview.canApply) {
      const message = replayPreviewErrorMessage(preview)
      this.postSessionActionComplete(session, {
        action: 'applyChangeLog',
        changeCount: 0,
        cancelled: true,
        message,
      })
      void vscode.window.showErrorMessage(message)
      return baseResult(
        0,
        {
          attempted: false,
          targetChangeCount: preview.rollbackProtection.targetChangeCount,
        },
        preview.current,
        true
      )
    }

    if (!providedScriptUri) {
      const applyLabel = vscode.l10n.t('Apply')
      const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t(
          'Change log preview: {count} change(s), {delta} byte size change, {plugins} required transform plugin(s).',
          {
            count: preview.primitiveCounts.total,
            delta: preview.expectedSize.deltaBytes,
            plugins: preview.requiredPlugins.length,
          }
        ),
        { modal: true },
        applyLabel
      )
      if (choice !== applyLabel) {
        this.postSessionActionComplete(session, {
          action: 'applyChangeLog',
          changeCount: 0,
          cancelled: true,
          message: vscode.l10n.t('Change log apply cancelled'),
        })
        return baseResult(
          0,
          {
            attempted: false,
            targetChangeCount: preview.rollbackProtection.targetChangeCount,
          },
          preview.current,
          true
        )
      }
    }

    let appliedChangeCount = 0
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Applying {count} change log entries…', {
            count: parsed.entryCount,
          }),
          cancellable: true,
        },
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() =>
            controller.abort()
          )
          try {
            appliedChangeCount = await this.applyChangeLogEntries(
              session,
              parsed.entries(),
              parsed.after
            )
          } finally {
            subscription.dispose()
          }
        }
      )
    } catch (error) {
      const detailedError = replayError(error)
      const details = detailedError.changeLogReplay
      const result = baseResult(
        details?.appliedCount ?? appliedChangeCount,
        details?.rollback ?? {
          attempted: false,
          targetChangeCount: preview.rollbackProtection.targetChangeCount,
        },
        details?.finalFingerprint
      )
      detailedError.result = result
      if (isChangeLogCancellationError(error)) {
        this.postSessionActionComplete(session, {
          action: 'applyChangeLog',
          changeCount: result.appliedCount ?? 0,
          cancelled: true,
          message: vscode.l10n.t('Change log apply cancelled'),
        })
        return { ...result, cancelled: true }
      }
      throw detailedError
    }

    const finalFingerprint = await getChangeLogFingerprint(
      session.sessionId,
      SessionFingerprintContent.COMPUTED,
      parsed.after.digest.algorithm
    )
    if (appliedChangeCount > 0) {
      await this.truncateCheckpointTimelineFuture(session)
      session.checkpointTimeline.currentFingerprint = finalFingerprint
    }
    this.postSessionActionComplete(session, {
      action: 'applyChangeLog',
      changeCount: appliedChangeCount,
      message: vscode.l10n.t('Applied {count} change(s)', {
        count: appliedChangeCount,
      }),
    })
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Applied {count} OmegaEdit change(s)', {
        count: appliedChangeCount,
      })
    )
    return {
      state: this.buildEditorState(session),
      uri: scriptUri,
      changeCount: appliedChangeCount,
      appliedCount: appliedChangeCount,
      sourceChangeCount: parsed.entryCount,
      complete: parsed.complete,
      before: parsed.before,
      after: parsed.after,
      unavailableChangeCount: parsed.unavailableChangeSerials.length,
      unavailableChangeSerials: parsed.unavailableChangeSerials,
      preview,
      rollback: {
        attempted: false,
        targetChangeCount: preview.rollbackProtection.targetChangeCount,
      },
      finalFingerprint,
    }
  }

  private async pickFileSpliceBytes(
    openLabel: string
  ): Promise<{ uri: vscode.Uri; bytes: Uint8Array } | undefined> {
    const sourceUri = (
      await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel,
      })
    )?.[0]

    if (!sourceUri) {
      return undefined
    }

    const stat = await vscode.workspace.fs.stat(sourceUri)
    if ((stat.type & vscode.FileType.File) === 0) {
      throw new Error(vscode.l10n.t('Select a file to splice.'))
    }
    if (stat.size > MAX_FILE_SPLICE_BYTES) {
      throw new Error(
        vscode.l10n.t(
          'Selected file is {size} bytes; file splicing is limited to {limit} bytes per operation.',
          {
            size: formatStatusByteCount(stat.size),
            limit: formatStatusByteCount(MAX_FILE_SPLICE_BYTES),
          }
        )
      )
    }

    const bytes = await vscode.workspace.fs.readFile(sourceUri)
    if (bytes.byteLength > MAX_FILE_SPLICE_BYTES) {
      throw new Error(
        vscode.l10n.t(
          'Selected file is {size} bytes; file splicing is limited to {limit} bytes per operation.',
          {
            size: formatStatusByteCount(bytes.byteLength),
            limit: formatStatusByteCount(MAX_FILE_SPLICE_BYTES),
          }
        )
      )
    }

    return { uri: sourceUri, bytes }
  }

  private postFileActionComplete(
    session: EditorSession,
    message: Omit<
      Extract<HostToWebviewMessage, { type: 'fileActionComplete' }>,
      'type'
    >
  ): void {
    this.postWebviewMessage(session, {
      type: 'fileActionComplete',
      ...message,
    })
  }

  private postSessionActionComplete(
    session: EditorSession,
    message: Omit<
      Extract<HostToWebviewMessage, { type: 'sessionActionComplete' }>,
      'type'
    >
  ): void {
    this.postWebviewMessage(session, {
      type: 'sessionActionComplete',
      ...message,
    })
  }

  private defaultRangeExportUri(
    session: EditorSession,
    offset: number,
    length: number
  ): vscode.Uri {
    const end = offset + Math.max(0, length - 1)
    return vscode.Uri.file(
      `${session.filePath}.0x${offset.toString(16).toUpperCase()}-0x${end
        .toString(16)
        .toUpperCase()}.bin`
    )
  }

  private async exportRangeToFile(
    session: EditorSession,
    offset: number,
    length: number
  ): Promise<void> {
    this.postTransformStatus(
      session,
      true,
      undefined,
      vscode.l10n.t('Exporting range...')
    )
    let failureMessage: string | undefined

    try {
      if (length > MAX_FILE_SPLICE_BYTES) {
        throw new Error(
          vscode.l10n.t(
            'Selected range is {size} bytes; file splicing is limited to {limit} bytes per operation.',
            {
              size: formatStatusByteCount(length),
              limit: formatStatusByteCount(MAX_FILE_SPLICE_BYTES),
            }
          )
        )
      }

      const targetUri = await vscode.window.showSaveDialog({
        defaultUri: this.defaultRangeExportUri(session, offset, length),
        saveLabel: vscode.l10n.t('Export Range'),
        title: vscode.l10n.t('Export selected bytes'),
      })

      if (!targetUri) {
        this.postFileActionComplete(session, {
          action: 'exportRange',
          offset,
          length,
          byteCount: 0,
          cancelled: true,
          message: vscode.l10n.t('Export cancelled'),
        })
        return
      }

      const bytes = await getSegment(session.sessionId, offset, length)
      await vscode.workspace.fs.writeFile(targetUri, bytes)
      const path = targetUri.fsPath || targetUri.toString(true)
      const message = vscode.l10n.t('Exported {count} byte(s)', {
        count: bytes.byteLength,
      })
      this.postFileActionComplete(session, {
        action: 'exportRange',
        offset,
        length,
        byteCount: bytes.byteLength,
        fileName: path,
        message,
      })
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Exported {count} byte(s) to {path}', {
          count: bytes.byteLength,
          path,
        })
      )
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
      this.postFileActionComplete(session, {
        action: 'exportRange',
        offset,
        length,
        byteCount: 0,
        cancelled: true,
        message: failureMessage,
      })
      void vscode.window.showErrorMessage(omegaEditErrorMessage(failureMessage))
    } finally {
      this.postTransformStatus(session, false, undefined, failureMessage)
    }
  }

  private async insertFileAtOffset(
    session: EditorSession,
    offset: number
  ): Promise<void> {
    this.postTransformStatus(
      session,
      true,
      undefined,
      vscode.l10n.t('Selecting file to insert...')
    )
    let failureMessage: string | undefined

    try {
      const picked = await this.pickFileSpliceBytes(vscode.l10n.t('Insert'))
      if (!picked) {
        this.postFileActionComplete(session, {
          action: 'insertFile',
          offset,
          length: 0,
          byteCount: 0,
          cancelled: true,
          message: vscode.l10n.t('Insert cancelled'),
        })
        return
      }

      const path = picked.uri.fsPath || picked.uri.toString(true)
      if (picked.bytes.byteLength === 0) {
        this.postFileActionComplete(session, {
          action: 'insertFile',
          offset,
          length: 0,
          byteCount: 0,
          fileName: path,
          message: vscode.l10n.t('Selected file is empty'),
        })
        return
      }

      const sessionSyncVersion = session.sessionSyncVersion
      const dataHex = Buffer.from(picked.bytes).toString('hex')
      const serial = await insert(session.sessionId, offset, picked.bytes)
      await this.truncateCheckpointTimelineFuture(session)
      this.markCheckpointTimelineChanged(session)
      session.history.recordLocalChange({
        serial,
        kind: 'INSERT',
        offset,
        length: 0,
        data: dataHex,
      })
      this.postEditState(session)
      this.notifyDocumentChanged(session)
      await this.waitForSessionSync(session, sessionSyncVersion)
      await this.sendViewportData(session)
      this.clearSearchState(session)
      this.postFileActionComplete(session, {
        action: 'insertFile',
        offset,
        length: 0,
        byteCount: picked.bytes.byteLength,
        fileName: path,
        message: vscode.l10n.t('Inserted {count} byte(s)', {
          count: picked.bytes.byteLength,
        }),
      })
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
      this.postFileActionComplete(session, {
        action: 'insertFile',
        offset,
        length: 0,
        byteCount: 0,
        cancelled: true,
        message: failureMessage,
      })
      void vscode.window.showErrorMessage(omegaEditErrorMessage(failureMessage))
    } finally {
      this.postTransformStatus(session, false, undefined, failureMessage)
    }
  }

  private async replaceRangeWithFile(
    session: EditorSession,
    offset: number,
    length: number
  ): Promise<void> {
    this.postTransformStatus(
      session,
      true,
      undefined,
      vscode.l10n.t('Selecting replacement file...')
    )
    let failureMessage: string | undefined

    try {
      const picked = await this.pickFileSpliceBytes(vscode.l10n.t('Replace'))
      if (!picked) {
        this.postFileActionComplete(session, {
          action: 'replaceRangeWithFile',
          offset,
          length,
          byteCount: 0,
          cancelled: true,
          message: vscode.l10n.t('Replace cancelled'),
        })
        return
      }

      const sessionSyncVersion = session.sessionSyncVersion
      const replacementHex = Buffer.from(picked.bytes).toString('hex')
      const changed = await this.applyReplace(
        session,
        offset,
        length,
        replacementHex
      )
      if (changed) {
        await this.waitForSessionSync(session, sessionSyncVersion)
        await this.sendViewportData(session)
        this.clearSearchState(session)
      }
      this.postFileActionComplete(session, {
        action: 'replaceRangeWithFile',
        offset,
        length,
        byteCount: picked.bytes.byteLength,
        fileName: picked.uri.fsPath || picked.uri.toString(true),
        message: changed
          ? vscode.l10n.t('Replaced range with {count} byte(s)', {
              count: picked.bytes.byteLength,
            })
          : vscode.l10n.t('Replacement made no changes'),
      })
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
      this.postFileActionComplete(session, {
        action: 'replaceRangeWithFile',
        offset,
        length,
        byteCount: 0,
        cancelled: true,
        message: failureMessage,
      })
      void vscode.window.showErrorMessage(omegaEditErrorMessage(failureMessage))
    } finally {
      this.postTransformStatus(session, false, undefined, failureMessage)
    }
  }

  async createCheckpoint(options?: unknown): Promise<
    | {
        state: WebviewEditorState
        checkpointCount: number
      }
    | undefined
  > {
    const session = this.resolveCommandSession(options)
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

    const result = await this.createSessionCheckpoint(session)
    this.postSessionActionComplete(session, {
      action: 'createCheckpoint',
      checkpointCount: result.checkpointCount,
      cancelled: !result.created,
      message: result.created
        ? vscode.l10n.t('OmegaEdit checkpoint created ({count} total)', {
            count: result.checkpointCount,
          })
        : vscode.l10n.t('No OmegaEdit changes to checkpoint'),
    })
    if (result.created) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('OmegaEdit checkpoint created ({count} total)', {
          count: result.checkpointCount,
        })
      )
    } else {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('No OmegaEdit changes to checkpoint')
      )
    }
    return {
      state: this.buildEditorState(session),
      checkpointCount: result.checkpointCount,
    }
  }

  async rollbackCheckpoint(options?: unknown): Promise<
    | {
        state: WebviewEditorState
        rolledBack: boolean
        checkpointCount: number
      }
    | undefined
  > {
    const session = this.resolveCommandSession(options)
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

    const rolledBack = await this.rollbackLastCheckpoint(session, true)
    const checkpointCount = await this.getCheckpointCount(session)
    this.postSessionActionComplete(session, {
      action: 'rollbackCheckpoint',
      checkpointCount,
      cancelled: !rolledBack,
      message: rolledBack
        ? vscode.l10n.t('Rolled back last OmegaEdit checkpoint')
        : vscode.l10n.t('No OmegaEdit checkpoint to roll back'),
    })
    if (rolledBack) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Rolled back last OmegaEdit checkpoint')
      )
    }
    return {
      state: this.buildEditorState(session),
      rolledBack,
      checkpointCount,
    }
  }

  async restoreCheckpoint(options?: unknown): Promise<
    | {
        state: WebviewEditorState
        restored: boolean
        checkpointCount: number
        changeCount: number
        discardedChangeCount: number
      }
    | undefined
  > {
    const session = this.resolveCommandSession(options)
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

    const result = await this.restoreLastCheckpoint(session, true)
    this.postSessionActionComplete(session, {
      action: 'restoreCheckpoint',
      checkpointCount: result.checkpointCount,
      cancelled: !result.restored,
      message: result.restored
        ? vscode.l10n.t('Restored latest OmegaEdit checkpoint')
        : vscode.l10n.t('No OmegaEdit checkpoint to restore'),
    })
    if (result.restored) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Restored latest OmegaEdit checkpoint')
      )
    }
    return {
      state: this.buildEditorState(session),
      ...result,
    }
  }

  async showCheckpointTimeline(
    options?: unknown
  ): Promise<CheckpointTimelineResult | undefined> {
    const session = this.resolveCommandSession(options)
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }
    session.checkpointTimeline.visible = true
    this.postCheckpointTimeline(session)
    return {
      state: this.buildEditorState(session),
      checkpointCount: session.checkpointTimeline.entries.length,
      moved: false,
    }
  }

  private async navigateToCheckpoint(
    session: EditorSession,
    targetCheckpointCount: number
  ): Promise<CheckpointTimelineResult> {
    const timeline = session.checkpointTimeline
    const checkpointCount = timeline.entries.length
    if (
      !Number.isInteger(targetCheckpointCount) ||
      targetCheckpointCount < 0 ||
      targetCheckpointCount > checkpointCount
    ) {
      throw new RangeError(
        `Checkpoint target ${targetCheckpointCount} is outside 0..${checkpointCount}`
      )
    }

    if (targetCheckpointCount === timeline.cursor) {
      return {
        state: this.buildEditorState(session),
        checkpointCount,
        moved: false,
      }
    }

    await this.captureCheckpointTimelineTip(session)
    await this.assertCheckpointTimelineNativeAlignment(
      session,
      'before navigation'
    )

    timeline.navigating = true
    this.postCheckpointTimeline(session)
    this.postTransformStatus(
      session,
      true,
      undefined,
      vscode.l10n.t('Moving through checkpoint timeline...')
    )
    let failureMessage: string | undefined
    const originalCursor = timeline.cursor
    try {
      const sessionSyncVersion = session.sessionSyncVersion
      const response = await checkoutCheckpoint(
        session.sessionId,
        targetCheckpointCount
      )
      if (
        response.checkpointCount !== targetCheckpointCount ||
        response.futureCheckpointCount !==
          timeline.entries.length - targetCheckpointCount
      ) {
        throw new Error(
          `Native checkpoint checkout reached ${response.checkpointCount} with ${response.futureCheckpointCount} future checkpoints; expected ${targetCheckpointCount} with ${timeline.entries.length - targetCheckpointCount} future checkpoints`
        )
      }
      const expected =
        targetCheckpointCount === 0
          ? timeline.originalFingerprint
          : timeline.entries[targetCheckpointCount - 1].interval.after
      await assertCurrentSessionFingerprint(
        session.sessionId,
        expected,
        'after'
      )
      timeline.cursor = targetCheckpointCount
      await timeline.storage?.setCursor(targetCheckpointCount)

      await this.waitForSessionSync(session, sessionSyncVersion)
      const currentFingerprint = await getChangeLogFingerprint(
        session.sessionId,
        SessionFingerprintContent.COMPUTED,
        'sha256'
      )
      timeline.currentFingerprint = currentFingerprint
      const isDirty = !timelineFingerprintsEqual(
        currentFingerprint,
        timeline.savedFingerprint
      )
      const targetHistorySnapshot =
        targetCheckpointCount > 0
          ? timeline.entries[targetCheckpointCount - 1]?.interval.history
          : undefined
      const tipHistorySnapshot = timeline.entries.at(-1)?.interval.history
      session.history = tipHistorySnapshot
        ? EditorHistoryController.fromSnapshotAtDepth(
            tipHistorySnapshot,
            targetHistorySnapshot?.transactionLog.length ?? 0
          )
        : new EditorHistoryController()
      await this.resetSessionState(session, isDirty, isDirty, false, true)
      await this.refreshSessionContentInfo(session)
      this.clearSearchState(session)
      this.postTransformStatus(
        session,
        false,
        undefined,
        vscode.l10n.t('Checkpoint timeline updated')
      )
      return {
        state: this.buildEditorState(session),
        checkpointCount: targetCheckpointCount,
        moved: true,
      }
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
      console.warn(`Checkpoint timeline navigation failed: ${failureMessage}`)
      let rollbackFailure: string | undefined
      try {
        await checkoutCheckpoint(session.sessionId, originalCursor)
        const originalFingerprint =
          originalCursor === 0
            ? timeline.originalFingerprint
            : timeline.entries[originalCursor - 1].interval.after
        await assertCurrentSessionFingerprint(
          session.sessionId,
          originalFingerprint,
          'after'
        )
        timeline.cursor = originalCursor
        await timeline.storage?.setCursor(originalCursor)
        timeline.currentFingerprint = await getChangeLogFingerprint(
          session.sessionId,
          SessionFingerprintContent.COMPUTED,
          'sha256'
        )
      } catch (rollbackError) {
        rollbackFailure =
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError)
        timeline.cursor = await this.getCheckpointCount(session).catch(
          () => timeline.cursor
        )
      }
      await this.sendViewportData(session).catch(() => undefined)
      if (rollbackFailure) {
        throw new Error(
          `${failureMessage}; rollback to checkpoint ${originalCursor} also failed: ${rollbackFailure}`
        )
      }
      throw new Error(
        `${failureMessage}; restored checkpoint ${originalCursor}`
      )
    } finally {
      timeline.navigating = false
      this.postCheckpointTimeline(session)
      if (failureMessage) {
        this.postTransformStatus(session, false, undefined, failureMessage)
      }
    }
  }

  async rollbackActiveSession(): Promise<WebviewEditorState | undefined> {
    const session = this.activeSession
    if (!session) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

    await this.revertSessionChanges(session, true)
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Rolled back OmegaEdit session')
    )
    return this.buildEditorState(session)
  }

  // --- Event Subscriptions ---

  /**
   * Subscribe to Ωedit™ viewport events. When edits change data visible in
   * the viewport, the server streams an event and we push fresh data to the
   * webview. This is the reactive data flow at the heart of Ωedit™.
   */

  // --- Viewport Data ---

  private postWebviewMessage(
    session: EditorSession,
    message: HostToWebviewMessage
  ): void {
    if (session.disposed) {
      return
    }

    try {
      void session.panel.webview
        .postMessage(message)
        .then(undefined, (error) => {
          if (
            error instanceof Error &&
            error.message.includes('Webview is disposed')
          ) {
            session.disposed = true
          }
        })
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Webview is disposed')
      ) {
        session.disposed = true
        return
      }
      throw error
    }
  }

  private async postActionJournalViewport(
    session: EditorSession,
    options: {
      anchorSerial?: string
      capacity?: number
      direction?: 'older' | 'newer'
      kinds?: WebviewActionJournalKind[]
      transactionId?: string
      append?: boolean
    } = {}
  ): Promise<void> {
    const state = session.actionJournal
    const requestGeneration = ++state.requestGeneration
    const capacity = options.capacity ?? state.capacity
    const direction = options.direction ?? state.direction
    const kinds = options.kinds ?? state.kinds
    const transactionId =
      options.transactionId === undefined
        ? state.transactionId
        : options.transactionId.trim() || undefined
    state.visible = true
    state.capacity = capacity
    state.direction = direction
    state.kinds = kinds
    state.transactionId = transactionId
    let viewport: ActionJournalViewport
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      viewport = await Promise.race([
        requestActionJournalViewport({
          sessionId: session.sessionId,
          anchorSerial: options.anchorSerial,
          capacity,
          direction,
          kinds,
          transactionId,
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(vscode.l10n.t('Action journal request timed out')))
          }, ACTION_JOURNAL_REQUEST_TIMEOUT_MS)
        }),
      ])
    } catch (error) {
      if (
        requestGeneration === state.requestGeneration &&
        !session.disposed &&
        !session.scope.isDisposed
      ) {
        const message = error instanceof Error ? error.message : String(error)
        this.postWebviewMessage(session, {
          type: 'actionJournalError',
          visible: true,
          message: omegaEditErrorMessage(message),
        })
      }
      throw error
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
    if (
      requestGeneration !== state.requestGeneration ||
      session.disposed ||
      session.scope.isDisposed
    ) {
      return
    }
    if (!options.append) {
      state.entries.clear()
    }
    for (const entry of viewport.entries) {
      state.entries.set(`${entry.firstSerial}:${entry.lastSerial}`, entry)
    }

    const webviewViewport: WebviewActionJournalViewport = {
      version: 1,
      activeTipSerial: viewport.activeTipSerial,
      changeCount: viewport.changeCount,
      undoCount: viewport.undoCount,
      checkpointCount: viewport.checkpointCount,
      anchorSerial: viewport.anchorSerial,
      capacity: viewport.capacity,
      direction: viewport.direction,
      entries: viewport.entries,
      hasMore: viewport.hasMore,
      nextAnchorSerial: viewport.nextAnchorSerial,
    }
    this.postWebviewMessage(session, {
      type: 'actionJournalViewport',
      visible: true,
      append: options.append === true,
      viewport: webviewViewport,
    })
  }

  private queueActionJournalRefresh(session: EditorSession): void {
    const state = session.actionJournal
    if (!state.visible || session.disposed || session.scope.isDisposed) {
      return
    }
    if (state.refreshTask) {
      state.refreshPending = true
      return
    }
    state.refreshTask = (async () => {
      do {
        state.refreshPending = false
        await this.postActionJournalViewport(session)
      } while (state.refreshPending && state.visible)
    })()
      .catch((error) => {
        console.warn(
          `Failed to refresh action journal: ${error instanceof Error ? error.message : String(error)}`
        )
      })
      .finally(() => {
        state.refreshTask = undefined
      })
  }

  private async copyActionJournalEntry(
    session: EditorSession,
    firstSerialText: string,
    lastSerialText: string,
    format: 'json' | 'cli' | 'mcp'
  ): Promise<void> {
    const journalEntry = session.actionJournal.entries.get(
      `${firstSerialText}:${lastSerialText}`
    )
    if (!journalEntry) {
      throw new Error(
        vscode.l10n.t(
          'The action journal entry is no longer in the active window'
        )
      )
    }
    const firstSerial = Number(firstSerialText)
    const lastSerial = Number(lastSerialText)
    if (
      !Number.isSafeInteger(firstSerial) ||
      !Number.isSafeInteger(lastSerial)
    ) {
      throw new Error(
        vscode.l10n.t(
          'This server history exceeds the client change-detail range'
        )
      )
    }

    let record = changeDetailsToChangeRecord(
      await getChangeDetails(session.sessionId, firstSerial)
    )
    if (journalEntry.kind === 'REPLACE') {
      const replacement = changeDetailsToChangeRecord(
        await getChangeDetails(session.sessionId, lastSerial)
      )
      if (record.kind !== 'DELETE' || replacement.kind !== 'INSERT') {
        throw new Error(
          vscode.l10n.t(
            'The replace journal entry no longer matches native history'
          )
        )
      }
      record = {
        serial: firstSerial,
        kind: 'REPLACE',
        offset: record.offset,
        length: record.length,
        data: replacement.data,
        groupId: journalEntry.transactionId,
      }
    } else if (journalEntry.transactionId) {
      record = { ...record, groupId: journalEntry.transactionId }
    }
    if (record.kind === 'DELETE') {
      record = { ...record, data: '' }
    }

    const serialized = serializeChangeLogEntry(record)
    let clipboardText: string
    if (format === 'json') {
      clipboardText = JSON.stringify(serialized, null, 2)
    } else if (record.kind === 'TRANSFORM') {
      const descriptor = parseTransformPrimitiveDescriptor(
        record.data,
        'TRANSFORM change data'
      )
      const args = {
        sessionId: session.sessionId,
        pluginId: descriptor.transformId,
        offset: record.offset,
        length: record.length,
        ...(descriptor.optionsJson === undefined
          ? {}
          : { optionsJson: descriptor.optionsJson }),
      }
      clipboardText =
        format === 'mcp'
          ? JSON.stringify(
              { tool: 'omega_edit_apply_transform_plugin', arguments: args },
              null,
              2
            )
          : [
              'oe apply-transform-plugin',
              `--session ${shellQuote(session.sessionId)}`,
              `--plugin ${shellQuote(descriptor.transformId)}`,
              `--offset ${record.offset}`,
              `--length ${record.length}`,
              ...(descriptor.optionsJson === undefined
                ? []
                : [`--options-json ${shellQuote(descriptor.optionsJson)}`]),
            ].join(' ')
    } else {
      const operation = record.kind.toLowerCase()
      const args = {
        sessionId: session.sessionId,
        offset: record.offset,
        operation,
        ...(record.length === 0 ? {} : { deleteLength: record.length }),
        ...(record.data.length === 0 ? {} : { hex: record.data }),
      }
      clipboardText =
        format === 'mcp'
          ? JSON.stringify(
              { tool: 'omega_edit_apply_patch', arguments: args },
              null,
              2
            )
          : [
              'oe patch',
              `--session ${shellQuote(session.sessionId)}`,
              `--offset ${record.offset}`,
              `--operation ${operation}`,
              ...(record.length === 0
                ? []
                : [`--delete-length ${record.length}`]),
              ...(record.data.length === 0
                ? []
                : [`--hex ${shellQuote(record.data)}`]),
            ].join(' ')
    }
    await vscode.env.clipboard.writeText(clipboardText)
  }

  private postPendingHealthWebviewMessage(
    webview: vscode.Webview,
    message: HostToWebviewMessage
  ): void {
    try {
      void webview.postMessage(message).then(undefined, (error) => {
        if (
          error instanceof Error &&
          error.message.includes('Webview is disposed')
        ) {
          this.pendingHealthWebviews.delete(webview)
          this.stopHealthPollingIfIdle()
        }
      })
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Webview is disposed')
      ) {
        this.pendingHealthWebviews.delete(webview)
        this.stopHealthPollingIfIdle()
        return
      }
      throw error
    }
  }

  /** Fetch current viewport data and send it to the webview */
  private async sendViewportData(session: EditorSession): Promise<void> {
    if (session.disposed || session.scope.isDisposed) {
      return
    }
    const fetchStartedAt = Date.now()
    const resp = await getViewportData(session.viewportId)
    if (session.disposed || session.scope.isDisposed) {
      return
    }
    const fetchDurationMs = Date.now() - fetchStartedAt
    const data = resp.getData_asU8()
    session.bufferOffset = resp.getOffset()
    session.webviewState = {
      ...session.webviewState,
      visibleOffset: session.offset,
      visibleByteCount: Math.min(
        session.visibleRows * session.bytesPerRow,
        Math.max(0, session.fileSize - session.offset)
      ),
    }
    this.postWebviewMessage(session, {
      type: 'viewportData',
      offset: resp.getOffset(),
      visibleOffset: session.offset,
      data: Array.from(data),
      length: resp.getLength(),
      fileSize: session.fileSize,
      followingByteCount: resp.getFollowingByteCount(),
      externalHighlights: session.externalHighlights,
      rangeMapTree: session.rangeMapTree,
      profile: {
        fetchDurationMs,
        sentAt: Date.now(),
        payloadBytes: data.byteLength,
        capacity: session.capacity,
        visibleRows: session.visibleRows,
        changeCount: session.changeCount,
        sessionSyncVersion: session.sessionSyncVersion,
      },
    })
    this.fireEditorStateChanged(session)
  }

  private async recreateViewport(
    session: EditorSession,
    offset: number,
    capacity: number
  ): Promise<void> {
    if (session.scope.isDisposed) {
      return
    }

    await session.scope.recreateViewport(offset, capacity)
    await this.sendViewportData(session)
  }

  private postEditState(session: EditorSession): void {
    const editState = session.history.getEditState()
    if (this.activeSession === session) {
      this.updateEditCommandContexts(session)
    }
    this.postWebviewMessage(session, {
      type: 'editState',
      ...editState,
      isDirty:
        !timelineFingerprintsEqual(
          session.checkpointTimeline.currentFingerprint,
          session.checkpointTimeline.savedFingerprint
        ) || !!session.restoredFromBackup,
    })
    this.fireEditorStateChanged(session)
  }

  private postCheckpointTimeline(session: EditorSession): void {
    const timeline = session.checkpointTimeline
    const manifest = timeline.storage?.manifest
    const savedCheckpoint =
      manifest?.saved.checkpoint ??
      (timelineFingerprintsEqual(
        timeline.savedFingerprint,
        timeline.originalFingerprint
      )
        ? 0
        : undefined)
    const availablePlugins = new Set(
      session.transformPlugins.map((plugin) => plugin.id)
    )
    const intervalAvailability = (checkpoint: number) => {
      const interval = timeline.entries[checkpoint - 1]?.interval
      const missingPluginIds =
        interval?.transformPluginIds.filter(
          (id) => !availablePlugins.has(id)
        ) ?? []
      const available =
        !!timeline.storage &&
        interval?.state === 'ready' &&
        missingPluginIds.length === 0
      return {
        available,
        missingPluginIds,
        error:
          interval?.error?.message ??
          (!timeline.storage
            ? 'Checkpoint history storage is unavailable'
            : missingPluginIds.length > 0
              ? `Missing transform plugin(s): ${missingPluginIds.join(', ')}`
              : undefined),
      }
    }
    const canRewind = timeline.cursor > 0
    const canFastForward = timeline.cursor < timeline.entries.length
    const metadataCheckpoints = checkpointTimelineMetadataWindow(
      timeline.entries.length,
      timeline.cursor,
      savedCheckpoint
    )
    this.postWebviewMessage(session, {
      type: 'checkpointTimeline',
      visible: timeline.visible,
      cursor: timeline.cursor,
      checkpointCount: timeline.entries.length,
      originalByteLength: String(timeline.originalFingerprint.byteLength),
      savedChangeCount: timeline.savedChangeCount,
      savedCheckpoint,
      savedOffBranch:
        manifest?.saved.offBranch ??
        (!timelineFingerprintsEqual(
          timeline.savedFingerprint,
          timeline.originalFingerprint
        ) &&
          savedCheckpoint === undefined),
      canRewind,
      canFastForward,
      navigating: timeline.navigating,
      checkpoints: metadataCheckpoints.map((checkpoint) => {
        const entry = timeline.entries[checkpoint - 1]
        const availability = intervalAvailability(checkpoint)
        return {
          checkpoint,
          changeCount: entry.changeCount,
          sourceChangeCount: entry.interval.sourceChangeCount,
          ...(entry.interval.archive
            ? {
                replayChangeCount: entry.interval.archive.emittedChangeCount,
                archiveByteLength: entry.interval.archive.byteLength,
              }
            : {}),
          byteLengthBefore: entry.interval.before.byteLength,
          byteLengthAfter: entry.interval.after.byteLength,
          boundaryKind: entry.interval.boundaryKind,
          transformPluginIds: entry.interval.transformPluginIds,
          missingPluginIds: availability.missingPluginIds,
          optimized: entry.interval.archive?.optimized ?? false,
          createdAt: Date.parse(entry.interval.createdAt),
          available: availability.available,
          error: availability.error,
        }
      }),
    })
  }

  private postExternalHighlights(session: EditorSession): void {
    this.postWebviewMessage(session, {
      type: 'externalHighlights',
      highlights: session.externalHighlights,
    })
    this.fireEditorStateChanged(session)
  }

  private postRangeMapTree(session: EditorSession): void {
    this.postWebviewMessage(session, {
      type: 'rangeMapTree',
      tree: session.rangeMapTree,
    })
    this.fireEditorStateChanged(session)
  }

  private cloneExternalHighlights(
    highlights: WebviewExternalHighlight[]
  ): WebviewExternalHighlight[] {
    return highlights.map((highlight) => ({ ...highlight }))
  }

  private cloneRangeMapTree(
    nodes: WebviewRangeMapNode[]
  ): WebviewRangeMapNode[] {
    return nodes.map((node) => ({
      ...node,
      children: this.cloneRangeMapTree(node.children),
    }))
  }

  private markRangeMapTreeNodesStale(
    nodes: WebviewRangeMapNode[]
  ): WebviewRangeMapNode[] {
    return nodes.map((node) => ({
      ...node,
      stale: true,
      children: this.markRangeMapTreeNodesStale(node.children),
    }))
  }

  private rangeMapTreeHasFreshNodes(nodes: WebviewRangeMapNode[]): boolean {
    return nodes.some(
      (node) =>
        node.stale !== true || this.rangeMapTreeHasFreshNodes(node.children)
    )
  }

  private setSessionExternalHighlights(
    session: EditorSession,
    highlights: WebviewExternalHighlight[]
  ): void {
    session.externalHighlights = this.cloneExternalHighlights(highlights)
    session.rangeMapTree = []
    session.externalHighlightBaseline =
      highlights.length === 0
        ? undefined
        : {
            changeCount: session.changeCount,
            fileSize: session.fileSize,
            highlights: this.cloneExternalHighlights(highlights),
            rangeMapTree: [],
          }
    this.postExternalHighlights(session)
    this.postRangeMapTree(session)
  }

  private setSessionRangeMap(
    session: EditorSession,
    highlights: WebviewExternalHighlight[],
    tree: WebviewRangeMapNode[]
  ): void {
    session.externalHighlights = this.cloneExternalHighlights(highlights)
    session.rangeMapTree = this.cloneRangeMapTree(tree)
    session.externalHighlightBaseline =
      highlights.length === 0
        ? undefined
        : {
            changeCount: session.changeCount,
            fileSize: session.fileSize,
            highlights: this.cloneExternalHighlights(highlights),
            rangeMapTree: this.cloneRangeMapTree(tree),
          }
    this.postExternalHighlights(session)
    this.postRangeMapTree(session)
  }

  private clearSessionExternalHighlights(session: EditorSession): void {
    session.externalHighlights = []
    session.rangeMapTree = []
    session.externalHighlightBaseline = undefined
    this.postExternalHighlights(session)
    this.postRangeMapTree(session)
  }

  private reconcileExternalHighlightStaleness(session: EditorSession): void {
    const baseline = session.externalHighlightBaseline
    if (!baseline || session.externalHighlights.length === 0) {
      return
    }

    if (
      session.changeCount === baseline.changeCount &&
      session.fileSize === baseline.fileSize
    ) {
      session.externalHighlights = this.cloneExternalHighlights(
        baseline.highlights
      )
      session.rangeMapTree = this.cloneRangeMapTree(baseline.rangeMapTree)
      this.postExternalHighlights(session)
      this.postRangeMapTree(session)
      return
    }

    this.markExternalHighlightsStale(session)
  }

  private postBytesPerRow(
    session: EditorSession,
    bytesPerRow = session.bytesPerRow
  ): void {
    this.postWebviewMessage(session, {
      type: 'bytesPerRow',
      bytesPerRow,
      bytesPerRowMode: 'fixed',
    })
  }

  private markExternalHighlightsStale(session: EditorSession): void {
    const shouldMarkHighlights =
      session.externalHighlights.length > 0 &&
      !session.externalHighlights.every((highlight) => highlight.stale === true)
    const shouldMarkTree = this.rangeMapTreeHasFreshNodes(session.rangeMapTree)

    if (!shouldMarkHighlights && !shouldMarkTree) {
      return
    }

    if (shouldMarkHighlights) {
      session.externalHighlights = session.externalHighlights.map(
        (highlight) => ({
          ...highlight,
          stale: true,
        })
      )
      this.postExternalHighlights(session)
    }
    if (shouldMarkTree) {
      session.rangeMapTree = this.markRangeMapTreeNodesStale(
        session.rangeMapTree
      )
      this.postRangeMapTree(session)
    }
  }

  private postEditMode(session: EditorSession): void {
    this.postWebviewMessage(session, {
      type: 'editMode',
      editMode: session.webviewState.editMode,
    })
    this.fireEditorStateChanged(session)
  }

  private postInsertDirection(session: EditorSession): void {
    this.postWebviewMessage(session, {
      type: 'insertDirection',
      insertDirection: session.webviewState.insertDirection,
    })
    this.fireEditorStateChanged(session)
  }

  private postTextEncoding(session: EditorSession): void {
    this.postWebviewMessage(session, {
      type: 'textEncoding',
      textEncoding: session.webviewState.textEncoding,
    })
    this.fireEditorStateChanged(session)
  }

  private postTransformStatus(
    session: EditorSession,
    inFlight: boolean,
    pluginId?: string,
    message?: string
  ): void {
    session.transformInFlight = inFlight
    if (this.activeSession === session) {
      this.updateEditCommandContexts(session)
    }
    this.postWebviewMessage(session, {
      type: 'transformStatus',
      inFlight,
      pluginId,
      message,
    })
    this.fireEditorStateChanged(session)
  }

  private postTransformProgress(session: EditorSession, event: unknown): void {
    const sessionEvent = event as {
      getSessionEventKind?: () => number
      getTransformProgress?: () => TransformProgress | undefined
    }
    const kind = sessionEvent.getSessionEventKind?.()
    if (
      kind !== SessionEventKind.TRANSFORM_STARTED &&
      kind !== SessionEventKind.TRANSFORM_PROGRESS &&
      kind !== SessionEventKind.TRANSFORM_COMPLETED &&
      kind !== SessionEventKind.TRANSFORM_FAILED
    ) {
      return
    }

    const progress = sessionEvent.getTransformProgress?.()
    const inFlight =
      kind === SessionEventKind.TRANSFORM_STARTED ||
      kind === SessionEventKind.TRANSFORM_PROGRESS
    session.transformInFlight = inFlight
    if (this.activeSession === session) {
      this.updateEditCommandContexts(session)
    }
    this.postWebviewMessage(session, {
      type: 'transformStatus',
      inFlight,
      pluginId: progress?.pluginId,
      operationId: progress?.operationId,
      message: progress?.message,
      processedBytes: progress?.processedBytes,
      totalBytes: progress?.totalBytes,
      percent: progress?.percent,
      phase: progress?.phase,
      indeterminate: progress?.indeterminate,
    })
    this.fireEditorStateChanged(session)
  }

  private ensureSessionCanMutate(
    session: EditorSession,
    showWarning = false
  ): boolean {
    if (!session.transformInFlight) {
      return true
    }

    const message = transformMutationBlockedMessage()
    this.postTransformStatus(session, true, undefined, message)
    if (showWarning) {
      void vscode.window.showWarningMessage(message)
    }
    return false
  }

  private toggleEditMode(session: EditorSession): void {
    const editMode: WebviewEditMode =
      session.webviewState.editMode === 'insert' ? 'overwrite' : 'insert'
    session.webviewState = {
      ...session.webviewState,
      editMode,
    }
    this.postEditMode(session)
  }

  private setSessionInsertDirection(
    session: EditorSession,
    insertDirection: InsertDirection
  ): void {
    session.webviewState = {
      ...session.webviewState,
      insertDirection,
    }
    this.postInsertDirection(session)
  }

  private setSessionTextEncoding(
    session: EditorSession,
    textEncoding: TextEncoding
  ): void {
    session.webviewState = {
      ...session.webviewState,
      textEncoding,
    }
    this.postTextEncoding(session)
  }

  private fireEditorStateChanged(session: EditorSession): void {
    if (session.disposed || session.scope.isDisposed) {
      return
    }

    if (this.activeSession === session) {
      this.updateStatusBar(session)
    }
    this._onDidChangeEditorState.fire(this.buildEditorState(session))
  }

  private buildEditorState(session: EditorSession): WebviewEditorState {
    const editState = session.history.getEditState()
    return {
      uri: session.document.uri.toString(),
      filePath: session.filePath,
      fileSize: session.fileSize,
      dirty: editState.isDirty || !!session.restoredFromBackup,
      canUndo: editState.canUndo,
      canRedo: editState.canRedo,
      undoCount: editState.undoCount,
      redoCount: editState.redoCount,
      savedChangeDepth: editState.savedChangeDepth,
      changeCount: session.changeCount,
      sessionSyncVersion: session.sessionSyncVersion,
      transformInFlight: session.transformInFlight,
      ...session.webviewState,
      externalHighlights: session.externalHighlights,
      transformSummaries: session.transformPlugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        operation: plugin.operation,
        support: plugin.support,
        flags: plugin.flags,
      })),
      contentSources: session.contentSources,
    }
  }

  private buildAssistantContext(
    session: EditorSession
  ): AssistantSessionContext {
    const editState = session.history.getEditState()
    const originalSource = session.contentSources.find(
      (source) => source.content === 'original' && source.available
    )
    const checkpointSource = session.contentSources.find(
      (source) => source.content === 'latestCheckpoint' && source.available
    )
    const dirty = editState.isDirty || !!session.restoredFromBackup
    const selection =
      session.webviewState.selectedOffset >= 0
        ? {
            offset: session.webviewState.selectedOffset,
            start: session.webviewState.selectionStart,
            end: session.webviewState.selectionEnd,
            length: session.webviewState.selectionLength,
          }
        : null

    return {
      version: OMEGA_EDIT_ASSISTANT_CONTEXT_VERSION,
      session: {
        id: session.sessionId,
        uri: session.document.uri.toString(),
        filePath: session.filePath,
      },
      sizes: {
        computed: session.fileSize,
        original: originalSource?.byteLength ?? null,
      },
      dirty,
      selection,
      viewport: {
        count: 1,
        activeViewportId: session.viewportId,
        visibleOffset: session.webviewState.visibleOffset,
        visibleByteCount: session.webviewState.visibleByteCount,
        bytesPerRow: session.webviewState.bytesPerRow,
        offsetRadix: session.webviewState.offsetRadix,
        activePane: session.webviewState.activePane,
        editMode: session.webviewState.editMode,
        insertDirection: session.webviewState.insertDirection,
        textEncoding: session.webviewState.textEncoding,
      },
      history: {
        changeCount: session.changeCount,
        undoCount: editState.undoCount,
        redoCount: editState.redoCount,
        undoStackDepth: editState.undoCount,
        redoStackDepth: editState.redoCount,
        canUndo: editState.canUndo,
        canRedo: editState.canRedo,
        checkpointCount: null,
        checkpointAvailable: checkpointSource !== undefined,
        savedChangeDepth: editState.savedChangeDepth,
        pendingChanges: dirty,
        pendingOperation: session.pendingHistoryOperation ?? null,
        pendingCount: session.pendingHistoryCount ?? 0,
      },
      transforms: {
        inFlight: session.transformInFlight,
        available: session.transformPlugins.length > 0,
        pluginCount: session.transformPlugins.length,
        plugins: session.transformPlugins.map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
          operation: plugin.operation,
          operationName: `${plugin.operation}`,
          support: plugin.support,
          supportName: `${plugin.support}`,
          flags: plugin.flags,
          abiVersion: plugin.abiVersion,
        })),
      },
      changeLog: {
        format: CHANGE_LOG_FORMAT,
        version: CHANGE_LOG_VERSION,
        exportAvailable: !session.transformInFlight,
        applyAvailable: !session.transformInFlight,
        sourceChangeCount: session.changeCount,
        completeExportAvailable: !session.transformInFlight,
      },
      commands: cloneAssistantCommandSurfaces(),
    }
  }

  private async refreshSessionContentInfo(
    session: EditorSession
  ): Promise<void> {
    if (session.disposed || session.scope.isDisposed) {
      return
    }
    try {
      const response = await getSessionContentInfo(session.sessionId)
      if (session.disposed || session.scope.isDisposed) {
        return
      }
      const contentSources = response.info
        .map((entry): WebviewSessionContentInfo | undefined => {
          const content = clientContentSourceToWebview(entry.content)
          return content
            ? {
                content,
                available: entry.available,
                byteLength: entry.byteLength,
                label: entry.label,
              }
            : undefined
        })
        .filter(
          (entry): entry is WebviewSessionContentInfo => entry !== undefined
        )
      session.contentSources =
        contentSources.length > 0
          ? contentSources
          : defaultContentSources(session.fileSize)
      this.postWebviewMessage(session, {
        type: 'sessionContentInfo',
        contentSources: session.contentSources,
      })
      this._onDidChangeEditorState.fire(this.buildEditorState(session))
    } catch {
      session.contentSources = defaultContentSources(session.fileSize)
      this.postWebviewMessage(session, {
        type: 'sessionContentInfo',
        contentSources: session.contentSources,
      })
    }
  }

  private resolveCommandSession(options?: unknown): EditorSession | undefined {
    const rawUri = isRecord(options) ? options.uri : options
    const uri = parseCommandUri(rawUri)
    if (!uri) {
      return this.activeSession
    }
    return this.sessions.get(uri.toString())
  }

  private parseExternalHighlightCommand(
    highlightsOrRequest: unknown,
    options?: unknown
  ): {
    highlights: unknown
    options: { uri?: vscode.Uri | string; reveal?: boolean }
  } {
    if (
      isRecord(highlightsOrRequest) &&
      Array.isArray(highlightsOrRequest.highlights)
    ) {
      return {
        highlights: highlightsOrRequest.highlights,
        options: {
          uri: highlightsOrRequest.uri as vscode.Uri | string | undefined,
          reveal: highlightsOrRequest.reveal === true,
        },
      }
    }

    return {
      highlights: highlightsOrRequest,
      options: {
        uri: isRecord(options)
          ? (options.uri as vscode.Uri | string | undefined)
          : undefined,
        reveal: isRecord(options) && options.reveal === true,
      },
    }
  }

  private updateEditCommandContexts(session: EditorSession | undefined): void {
    const editState = session?.history.getEditState()
    void vscode.commands.executeCommand(
      'setContext',
      CONTEXT_HEX_EDITOR_ACTIVE,
      !!session
    )
    void vscode.commands.executeCommand(
      'setContext',
      CONTEXT_CAN_UNDO,
      !!editState?.canUndo
    )
    void vscode.commands.executeCommand(
      'setContext',
      CONTEXT_CAN_REDO,
      !!editState?.canRedo
    )
    void vscode.commands.executeCommand(
      'setContext',
      CONTEXT_HAS_PENDING_CHANGES,
      !!session &&
        (!!editState?.isDirty ||
          !!editState?.undoCount ||
          !!session.restoredFromBackup)
    )
    void vscode.commands.executeCommand(
      'setContext',
      CONTEXT_TRANSFORM_IN_FLIGHT,
      !!session?.transformInFlight
    )
    this.updateStatusBar(session)
  }

  private updateActiveSessionResourcePathContext(): void {
    const activeSessionResourcePaths: Record<string, true> = {}
    for (const session of this.sessions.values()) {
      if (session.disposed || session.document.uri.scheme !== 'file') {
        continue
      }
      activeSessionResourcePaths[session.document.uri.fsPath] = true
      activeSessionResourcePaths[session.document.uri.path] = true
    }

    void vscode.commands.executeCommand(
      'setContext',
      CONTEXT_ACTIVE_SESSION_RESOURCE_PATHS,
      activeSessionResourcePaths
    )
  }

  private hideStatusBar(): void {
    for (const item of Object.values(this.statusItems)) {
      item.hide()
    }
  }

  private updateStatusBar(session: EditorSession | undefined): void {
    if (!session || session.disposed || session.scope.isDisposed) {
      this.hideStatusBar()
      return
    }

    const editState = session.history.getEditState()
    const state = session.webviewState
    const visibleProgress = formatStatusProgress(
      session.fileSize,
      state.visibleOffset,
      state.visibleByteCount
    )
    const visibleEnd = Math.min(
      session.fileSize,
      Math.max(0, state.visibleOffset) + Math.max(0, state.visibleByteCount)
    )
    const selectedOffset =
      state.selectedOffset >= 0
        ? formatStatusOffset(state.selectedOffset, state.offsetRadix)
        : vscode.l10n.t('None')
    const visibleOffset = formatStatusOffset(
      state.visibleOffset,
      state.offsetRadix
    )
    this.statusItems.offset.name = vscode.l10n.t('Ωedit Selected Offset')
    this.statusItems.offset.text = `$(location) ${selectedOffset}`
    this.statusItems.offset.tooltip = vscode.l10n.t(
      'Ωedit selected offset {selectedOffset}; viewport offset {visibleOffset} {progress}; visible bytes {start} to {end} of {size}.',
      {
        selectedOffset,
        visibleOffset,
        progress: visibleProgress,
        start: formatStatusByteCount(state.visibleOffset),
        end: formatStatusByteCount(visibleEnd),
        size: formatStatusByteCount(session.fileSize),
      }
    )

    const selectionLength = Math.max(0, state.selectionLength)
    this.statusItems.selection.name = vscode.l10n.t('Ωedit Selection')
    this.statusItems.selection.text = `$(selection) ${formatStatusByteCount(selectionLength)} B`
    this.statusItems.selection.tooltip =
      selectionLength > 0
        ? vscode.l10n.t('Ωedit selection {start} to {end}; {length} bytes.', {
            start: formatStatusOffset(state.selectionStart, state.offsetRadix),
            end: formatStatusOffset(state.selectionEnd, state.offsetRadix),
            length: formatStatusByteCount(selectionLength),
          })
        : vscode.l10n.t('Ωedit has no active selection')

    this.statusItems.size.name = vscode.l10n.t('Ωedit File Size')
    this.statusItems.size.text = `$(database) ${formatStatusByteCount(session.fileSize)} B`
    this.statusItems.size.tooltip = vscode.l10n.t(
      'Ωedit computed file size: {size} bytes',
      { size: formatStatusByteCount(session.fileSize) }
    )

    this.statusItems.pane.text =
      state.activePane === 'ascii'
        ? vscode.l10n.t('TEXT {encoding}', {
            encoding: textEncodingStatusLabel(state.textEncoding),
          })
        : vscode.l10n.t('HEX')
    this.statusItems.pane.tooltip = vscode.l10n.t('Ωedit active edit pane')

    const mode =
      state.editMode === 'overwrite'
        ? vscode.l10n.t('Overwrite')
        : vscode.l10n.t('Insert')
    const direction = state.insertDirection === 'forward' ? '→' : '←'
    this.statusItems.mode.name = vscode.l10n.t('Ωedit Edit Mode')
    this.statusItems.mode.text = `${mode} ${direction}`
    this.statusItems.mode.tooltip = vscode.l10n.t(
      'Ωedit {mode} mode; {direction} insertion direction',
      {
        mode,
        direction:
          state.insertDirection === 'forward'
            ? vscode.l10n.t('forward')
            : vscode.l10n.t('backward'),
      }
    )

    this.statusItems.layout.name = vscode.l10n.t('Ωedit Bytes Per Row')
    this.statusItems.layout.text = vscode.l10n.t('{count} B/row', {
      count: formatStatusByteCount(state.bytesPerRow),
    })
    this.statusItems.layout.tooltip = vscode.l10n.t(
      'Ωedit displays {count} bytes per row',
      { count: formatStatusByteCount(state.bytesPerRow) }
    )

    this.statusItems.transforms.text = session.transformInFlight
      ? vscode.l10n.t('$(sync~spin) Transforming')
      : `$(tools) ${session.transformPlugins.length.toLocaleString()}`
    this.statusItems.transforms.tooltip = session.transformInFlight
      ? vscode.l10n.t('Ωedit transform in progress; edits are disabled')
      : vscode.l10n.t('Ωedit transform plugins available')

    const dirty = editState.isDirty || !!session.restoredFromBackup
    this.statusItems.dirty.text = dirty
      ? vscode.l10n.t('$(circle-filled) Dirty')
      : vscode.l10n.t('$(check) Saved')
    this.statusItems.dirty.tooltip = dirty
      ? vscode.l10n.t('Ωedit session has unsaved changes')
      : vscode.l10n.t('Ωedit session is saved')

    const health = this.latestServerHealth
    const serverSeverity = health?.severity ?? 'pending'
    const serverText = `$(${serverHealthIcon(serverSeverity)})`
    const serverColorId = serverHealthColorId(serverSeverity)
    const serverTooltip = buildServerHealthTooltip(health)
    const serverStatusItemKey = [
      serverText,
      serverColorId,
      serverTooltip.value,
    ].join('\0')

    if (this.lastServerStatusItemKey !== serverStatusItemKey) {
      this.statusItems.server.text = serverText
      this.statusItems.server.name = vscode.l10n.t('Ωedit™ Server')
      this.statusItems.server.color = new vscode.ThemeColor(serverColorId)
      this.statusItems.server.tooltip = serverTooltip
      this.lastServerStatusItemKey = serverStatusItemKey
    }

    for (const item of Object.values(this.statusItems)) {
      item.show()
    }
  }

  private async sendTransformPlugins(session: EditorSession): Promise<void> {
    try {
      const plugins = await listTransformPlugins()
      const serializedPlugins = plugins.map(serializeTransformPlugin)
      session.transformPlugins = serializedPlugins
      if (this.activeSession === session) {
        this.updateStatusBar(session)
      }
      this.postWebviewMessage(session, {
        type: 'transformPlugins',
        plugins: serializedPlugins,
      })
      this.postCheckpointTimeline(session)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      session.transformPlugins = []
      if (this.activeSession === session) {
        this.updateStatusBar(session)
      }
      this.postWebviewMessage(session, {
        type: 'transformPlugins',
        plugins: [],
        error: message,
      })
      this.postCheckpointTimeline(session)
    }
  }

  private async applyTransformToRange(
    session: EditorSession,
    pluginId: string,
    contentSource: WebviewSessionContentSource,
    offset: number,
    length: number,
    optionsJson?: string,
    token?: vscode.CancellationToken
  ): Promise<void> {
    if (session.transformInFlight) {
      throw new Error('A transform is already in progress for this session')
    }

    const abortController = new AbortController()
    const cancellationListener = token?.onCancellationRequested(() => {
      abortController.abort()
    })
    if (token?.isCancellationRequested) {
      abortController.abort()
    }
    session.transformAbortController = abortController

    this.postTransformStatus(
      session,
      true,
      pluginId,
      vscode.l10n.t('Applying transform...')
    )
    let failureMessage: string | undefined
    try {
      const plugin = session.transformPlugins.find(
        (entry) => entry.id === pluginId
      )
      const inspectOnly =
        plugin?.operation === TransformPluginOperation.INSPECT ||
        contentSource !== 'computed'
      const effectiveContentSource = inspectOnly ? contentSource : 'computed'
      const contentByteLength =
        session.contentSources.find(
          (entry) => entry.content === effectiveContentSource && entry.available
        )?.byteLength ??
        (effectiveContentSource === 'computed' ? session.fileSize : 0)
      const clampedOffset = Math.max(0, Math.min(offset, contentByteLength))
      const remainingLength = Math.max(0, contentByteLength - clampedOffset)
      const originalLength =
        length === 0 ? remainingLength : Math.min(length, remainingLength)
      const sessionSyncVersion = session.sessionSyncVersion
      if (inspectOnly) {
        const response = await inspectSessionContent(
          session.sessionId,
          webviewContentSourceToClient(effectiveContentSource),
          pluginId,
          clampedOffset,
          originalLength,
          optionsJson,
          { signal: abortController.signal }
        )
        const descriptorJson = createTransformPrimitiveDescriptorJson(
          response.pluginId,
          optionsJson
        )
        const descriptorHex = encodeTransformPrimitiveDataHex(
          response.pluginId,
          optionsJson
        )

        this.postWebviewMessage(session, {
          type: 'transformComplete',
          pluginId: response.pluginId,
          offset: response.offset,
          length: response.length,
          operation: TransformPluginOperation.INSPECT,
          contentSource: effectiveContentSource,
          contentChanged: false,
          replacementLength: 0,
          computedFileSize: session.fileSize,
          descriptorJson,
          descriptorHex,
          resultLabel: response.resultLabel ?? '',
          resultMimeType: response.resultMimeType ?? '',
          resultText: transformResultToText(response.result),
        })
        void vscode.window.showInformationMessage(
          formatTransformCompletionMessage({
            operation: TransformPluginOperation.INSPECT,
            contentChanged: false,
            length: response.length,
            replacementLength: 0,
          })
        )
        return
      }

      const response = await applyTransformPlugin(
        session.sessionId,
        pluginId,
        clampedOffset,
        originalLength,
        optionsJson,
        { signal: abortController.signal }
      )
      const descriptorJson = createTransformPrimitiveDescriptorJson(
        response.pluginId,
        optionsJson
      )
      const descriptorHex = encodeTransformPrimitiveDataHex(
        response.pluginId,
        optionsJson
      )

      if (response.contentChanged) {
        if (response.serial === undefined) {
          throw new Error('Transform did not return a change serial')
        }
        await this.truncateCheckpointTimelineFuture(session)
        this.markCheckpointTimelineChanged(session)
        session.history.recordLocalChange({
          serial: response.serial,
          kind: 'TRANSFORM',
          offset: response.offset,
          length: response.length,
          data: descriptorHex,
        })
        this.postEditState(session)
        this.notifyDocumentChanged(session)
        await this.waitForSessionSync(session, sessionSyncVersion)
        const checkpointCount = await this.getCheckpointCount(session)
        if (checkpointCount > session.checkpointTimeline.entries.length) {
          await this.recordCheckpointTimelineEntry(
            session,
            checkpointCount,
            'transform',
            [response.pluginId]
          )
        }
        this.clearSearchState(session)
      }

      await this.sendViewportData(session)
      await this.refreshSessionContentInfo(session)

      this.postWebviewMessage(session, {
        type: 'transformComplete',
        pluginId: response.pluginId,
        offset: response.offset,
        length: response.length,
        operation: response.operation,
        contentSource: 'computed',
        contentChanged: response.contentChanged,
        ...(response.serial === undefined ? {} : { serial: response.serial }),
        replacementLength: response.replacementLength,
        computedFileSize: response.computedFileSize,
        descriptorJson,
        descriptorHex,
        resultLabel: response.resultLabel ?? '',
        resultMimeType: response.resultMimeType ?? '',
        resultText: transformResultToText(response.result),
      })
      void vscode.window.showInformationMessage(
        formatTransformCompletionMessage(response)
      )
    } catch (error) {
      if (
        abortController.signal.aborted ||
        token?.isCancellationRequested ||
        isTransformCancellationError(error)
      ) {
        failureMessage = vscode.l10n.t('Transform cancelled')
        void vscode.window.showInformationMessage(failureMessage)
        return
      }
      failureMessage = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      cancellationListener?.dispose()
      if (session.transformAbortController === abortController) {
        session.transformAbortController = undefined
      }
      this.postTransformStatus(session, false, pluginId, failureMessage)
    }
  }

  private cancelTransform(session: EditorSession): void {
    if (!session.transformInFlight) {
      return
    }
    const controller = session.transformAbortController
    if (!controller) {
      this.postTransformStatus(
        session,
        true,
        undefined,
        vscode.l10n.t('This action cannot be cancelled.')
      )
      return
    }
    if (!controller.signal.aborted) {
      controller.abort()
      this.postTransformStatus(
        session,
        true,
        undefined,
        vscode.l10n.t('Cancelling transform...')
      )
    }
  }

  private async postClipboardSelection(
    session: EditorSession,
    action: 'copy' | 'cut',
    offset: number,
    length: number,
    format: 'hex' | 'utf8'
  ): Promise<Uint8Array> {
    const bytes = await getSegment(session.sessionId, offset, length)
    const clipboardText =
      format === 'utf8'
        ? (decodeTextBytes(
            Array.from(bytes),
            session.webviewState.textEncoding
          ) ?? Buffer.from(bytes).toString('utf8'))
        : Array.from(bytes, (byte) =>
            byte.toString(16).toUpperCase().padStart(2, '0')
          ).join(' ')
    await vscode.env.clipboard.writeText(clipboardText)
    this.postWebviewMessage(session, {
      type: 'clipboardComplete',
      action,
      byteCount: bytes.byteLength,
      format,
      offset,
    })
    return bytes
  }

  private async postAnalysisProfile(
    session: EditorSession,
    request: AnalysisProfileRequest
  ): Promise<void> {
    const clampedOffset = Math.max(
      0,
      Math.min(request.offset, session.fileSize)
    )
    const clampedLength = Math.max(
      0,
      Math.min(
        request.length,
        MAX_ANALYSIS_PROFILE_BYTES,
        Math.max(0, session.fileSize - clampedOffset)
      )
    )
    const startedAt = Date.now()

    if (clampedLength <= 0) {
      if (session.pendingAnalysisProfile) {
        return
      }
      this.postWebviewMessage(session, {
        type: 'analysisProfile',
        requestKey: request.requestKey,
        scopeLabel: request.scopeLabel,
        offset: clampedOffset,
        length: 0,
        requestedLength: request.requestedLength,
        isCapped: request.isCapped,
        durationMs: 0,
        byteProfile: new Array(257).fill(0),
        numAscii: 0,
        characterCount: {
          byteOrderMark: 'none',
          byteOrderMarkBytes: 0,
          singleByteCount: 0,
          doubleByteCount: 0,
          tripleByteCount: 0,
          quadByteCount: 0,
          invalidBytes: 0,
        },
      })
      return
    }

    const [byteProfile, bom] = await Promise.all([
      profileSession(session.sessionId, clampedOffset, clampedLength),
      getByteOrderMark(session.sessionId, clampedOffset),
    ])
    if (
      session.pendingAnalysisProfile ||
      session.scope.isDisposed ||
      session.disposed
    ) {
      return
    }

    const bomName = bom.getByteOrderMark()
    const characterCount = await countCharacters(
      session.sessionId,
      clampedOffset,
      clampedLength,
      bomName
    )
    if (
      session.pendingAnalysisProfile ||
      session.scope.isDisposed ||
      session.disposed
    ) {
      return
    }

    this.postWebviewMessage(session, {
      type: 'analysisProfile',
      requestKey: request.requestKey,
      scopeLabel: request.scopeLabel,
      offset: clampedOffset,
      length: clampedLength,
      requestedLength: request.requestedLength,
      isCapped: request.isCapped,
      durationMs: Date.now() - startedAt,
      byteProfile,
      numAscii: numAscii(byteProfile),
      characterCount: {
        byteOrderMark: characterCount.getByteOrderMark(),
        byteOrderMarkBytes: characterCount.getByteOrderMarkBytes(),
        singleByteCount: characterCount.getSingleByteChars(),
        doubleByteCount: characterCount.getDoubleByteChars(),
        tripleByteCount: characterCount.getTripleByteChars(),
        quadByteCount: characterCount.getQuadByteChars(),
        invalidBytes: characterCount.getInvalidBytes(),
      },
    })
  }

  private enqueueAnalysisProfile(
    session: EditorSession,
    request: AnalysisProfileRequest
  ): void {
    session.pendingAnalysisProfile = request
    if (!session.analysisProfileTask) {
      session.analysisProfileTask = this.processAnalysisProfileQueue(session)
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          void vscode.window.showErrorMessage(omegaEditErrorMessage(message))
        })
        .finally(() => {
          session.analysisProfileTask = undefined
        })
    }
  }

  private async processAnalysisProfileQueue(
    session: EditorSession
  ): Promise<void> {
    while (session.pendingAnalysisProfile && !session.scope.isDisposed) {
      const request = session.pendingAnalysisProfile
      session.pendingAnalysisProfile = undefined
      await this.postAnalysisProfile(session, request)
    }
  }

  private waitForSessionSync(
    session: EditorSession,
    minimumVersion: number,
    timeoutMs: number = SESSION_SYNC_TIMEOUT_MS
  ): Promise<void> {
    return session.scope.model.waitForSync(minimumVersion, timeoutMs)
  }

  private async getCheckpointCount(session: EditorSession): Promise<number> {
    const counts = await getCounts(session.sessionId, [CountKind.CHECKPOINTS])
    return counts[0]?.getCount() ?? 0
  }

  private async assertCheckpointTimelineNativeAlignment(
    session: EditorSession,
    context: string
  ): Promise<number> {
    const nativeCheckpointCount = await this.getCheckpointCount(session)
    const durableCursor = session.checkpointTimeline.cursor
    if (nativeCheckpointCount !== durableCursor) {
      throw new TimelineStorageError(
        'TIMELINE_CHECKPOINT_MISMATCH',
        `Native checkpoint count ${nativeCheckpointCount} does not match timeline cursor ${durableCursor} ${context}`
      )
    }
    return nativeCheckpointCount
  }

  private async recordCheckpointTimelineEntry(
    session: EditorSession,
    checkpointCount: number,
    boundaryKind: 'plain' | 'transform' | 'tip' = 'plain',
    transformPluginIds: string[] = [],
    replayRecords: ChangeRecord[] = []
  ): Promise<CheckpointIntervalManifestEntryV1 | undefined> {
    if (session.checkpointTimeline.navigating) {
      return
    }

    const timeline = session.checkpointTimeline
    let resolveTimelineOperation: () => void = () => undefined
    timeline.operation = new Promise<void>((resolve) => {
      resolveTimelineOperation = resolve
    })
    try {
      const previousChangeCount = timeline.lastArchivedChangeCount
      const changeCount = await getChangeCount(session.sessionId)
      const after = await getChangeLogFingerprint(
        session.sessionId,
        SessionFingerprintContent.COMPUTED,
        DEFAULT_CHANGE_LOG_DIGEST_ALGORITHM
      )
      const before =
        timeline.entries.at(-1)?.interval.after ?? timeline.originalFingerprint
      const sourceChangeCount =
        replayRecords.length > 0
          ? replayRecords.length
          : Math.max(0, changeCount - previousChangeCount)
      const storage = timeline.storage
      let interval: CheckpointIntervalManifestEntryV1
      const captureInput = {
        checkpoint: checkpointCount,
        expectedGeneration:
          storage?.manifest.nextGeneration ??
          (timeline.entries.at(-1)?.interval.generation ?? 0) + 1,
        sourceChangeCount,
        before,
        after,
        boundaryKind,
        transformPluginIds,
        history: session.history.snapshot(),
      } as const
      try {
        if (!storage) {
          throw new TimelineStorageError(
            'TIMELINE_STORAGE_UNAVAILABLE',
            'Checkpoint history storage is unavailable'
          )
        }
        const writeCandidate =
          (optimize: boolean) =>
          async (
            outputPath: string,
            maxBytes: number,
            onBytesWritten: (byteLength: number) => Promise<void>
          ) => {
            if (replayRecords.length > 0) {
              const result = await writeChangeLogFileAtomic(
                outputPath,
                changeLogHeaderForExport({
                  complete: true,
                  before: {
                    byteLength: String(before.byteLength),
                    digest: before.digest,
                  },
                  after: {
                    byteLength: String(after.byteLength),
                    digest: after.digest,
                  },
                  changeCount: replayRecords.length,
                  sourceChangeCount: replayRecords.length,
                  unavailableChangeSerials: [],
                }),
                async (sink) => {
                  for (const record of replayRecords) {
                    await sink.writeEntry(record)
                  }
                },
                { maxBytes }
              )
              await onBytesWritten(result.byteLength)
              return { byteLength: result.byteLength }
            }
            if (sourceChangeCount === 0) {
              return await writeEmptyCheckpointInterval(
                outputPath,
                before,
                after,
                maxBytes
              )
            }
            const result = await writeChangeLogRpcExportAtomic(
              outputPath,
              {
                sessionId: session.sessionId,
                optimize,
                firstChangeSerial: previousChangeCount + 1,
                lastChangeSerial: changeCount,
                maxOutputBytes: maxBytes,
              },
              { maxBytes, onBytesWritten }
            )
            return { byteLength: result.byteLength }
          }
        interval = await storage.captureInterval({
          ...captureInput,
          writeRaw: writeCandidate(false),
          writeOptimized: writeCandidate(true),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const unavailable: CheckpointIntervalManifestEntryV1 = {
          checkpoint: checkpointCount,
          generation: captureInput.expectedGeneration,
          before: {
            byteLength: String(before.byteLength),
            digest: before.digest,
          },
          after: {
            byteLength: String(after.byteLength),
            digest: after.digest,
          },
          sourceChangeCount: String(sourceChangeCount),
          createdAt: new Date().toISOString(),
          boundaryKind,
          transformPluginIds: [...new Set(transformPluginIds)].sort(),
          history: session.history.snapshot(),
          state: 'unavailable',
          error: {
            code:
              error instanceof TimelineStorageError
                ? error.code
                : 'TIMELINE_CAPTURE_FAILED',
            message,
          },
        }
        // If manifest publication also fails, keep a fail-closed local
        // boundary for this session. Reopening reloads the authoritative
        // manifest instead of trusting this fallback.
        interval = storage
          ? await storage
              .recordUnavailable(
                captureInput,
                unavailable.error?.code ?? 'TIMELINE_CAPTURE_FAILED',
                message
              )
              .catch(() => unavailable)
          : unavailable
      }

      timeline.entries.splice(checkpointCount - 1)
      timeline.entries.push({ changeCount, interval })
      timeline.lastArchivedChangeCount = changeCount
      timeline.cursor = checkpointCount
      timeline.currentFingerprint = after
      this.postCheckpointTimeline(session)
      return interval
    } finally {
      resolveTimelineOperation()
      timeline.operation = undefined
    }
  }

  private async captureCheckpointTimelineTip(
    session: EditorSession
  ): Promise<void> {
    const timeline = session.checkpointTimeline
    if (timeline.cursor !== timeline.entries.length) return

    const changeCount = await getChangeCount(session.sessionId)
    if (changeCount === timeline.lastArchivedChangeCount) return

    const historyBefore = session.history.snapshot()
    const sessionSyncVersion = session.sessionSyncVersion
    const count = await createCheckpoint(session.sessionId)
    session.history.recordMilestone()
    await this.waitForSessionSync(session, sessionSyncVersion)
    const interval = await this.recordCheckpointTimelineEntry(
      session,
      count,
      'tip'
    )
    if (interval?.state !== 'ready') {
      await this.rollbackUnusableTimelineBoundary(session, count, historyBefore)
      throw new TimelineStorageError(
        interval?.error?.code ?? 'TIMELINE_CAPTURE_FAILED',
        interval?.error?.message ??
          'Latest editor history could not be archived'
      )
    }
  }

  private async rollbackUnusableTimelineBoundary(
    session: EditorSession,
    checkpoint: number,
    historyBefore: ReturnType<EditorHistoryController['snapshot']>
  ): Promise<void> {
    const timeline = session.checkpointTimeline
    if ((await this.getCheckpointCount(session)) >= checkpoint) {
      await destroyLastCheckpoint(session.sessionId)
    }
    try {
      await timeline.storage?.truncateFuture(checkpoint - 1)
    } catch (error) {
      timeline.storage = undefined
      console.warn(
        `Failed to remove unusable checkpoint history; disabling persisted history for this session: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    timeline.entries.splice(checkpoint - 1)
    timeline.cursor = checkpoint - 1
    timeline.lastArchivedChangeCount = timeline.entries.at(-1)?.changeCount ?? 0
    session.history = EditorHistoryController.fromSnapshot(historyBefore)
    this.postCheckpointTimeline(session)
  }

  private async truncateCheckpointTimelineFuture(
    session: EditorSession,
    cursor = session.checkpointTimeline.cursor
  ): Promise<void> {
    const timeline = session.checkpointTimeline
    if (
      timeline.navigating ||
      !Number.isInteger(cursor) ||
      cursor < 0 ||
      cursor >= timeline.entries.length
    ) {
      return
    }
    const discarded = await discardCheckpointFuture(session.sessionId)
    if (discarded.checkpointCount < cursor) {
      throw new Error(
        `Native checkpoint branch is at ${discarded.checkpointCount}, before timeline cursor ${cursor}`
      )
    }
    try {
      await timeline.storage?.truncateFuture(cursor)
    } catch (error) {
      // The content mutation has already succeeded on the native server.
      // Detach storage so a lock or persistence failure cannot suppress edit
      // history, while also preventing navigation through the stale manifest.
      timeline.storage = undefined
      console.warn(
        `Checkpoint timeline branch truncation failed; disabling persisted history for this session: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    timeline.entries.splice(cursor)
    timeline.cursor = cursor
    timeline.lastArchivedChangeCount = timeline.entries.at(-1)?.changeCount ?? 0
    this.postCheckpointTimeline(session)
  }

  private markCheckpointTimelineChanged(session: EditorSession): void {
    const saved = session.checkpointTimeline.savedFingerprint
    session.checkpointTimeline.currentFingerprint = {
      byteLength: saved.byteLength,
      digest: {
        algorithm: saved.digest.algorithm,
        value: `changed:${saved.digest.value}`,
      },
    }
  }

  private async resetSessionState(
    session: EditorSession,
    restoredFromBackup: boolean,
    markDirty: boolean,
    scrollToStart: boolean,
    preserveHistory = false
  ): Promise<void> {
    if (!preserveHistory) {
      session.history = new EditorHistoryController()
    }
    session.search = new EditorSearchController(session.sessionId)
    session.restoredFromBackup = restoredFromBackup
    this.clearSearchState(session)
    this.postEditState(session)
    if (scrollToStart) {
      // scrollTo repositions the server-side viewport; sendViewportData alone
      // would leave the server viewport at the old position.
      await this.scrollTo(session, 0)
    } else {
      await this.sendViewportData(session)
    }
    if (markDirty) {
      this.notifyDocumentChanged(session)
    }
  }

  private async createSessionCheckpoint(
    session: EditorSession
  ): Promise<{ checkpointCount: number; created: boolean }> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return {
        checkpointCount: await this.getCheckpointCount(session),
        created: false,
      }
    }
    await this.assertCheckpointTimelineNativeAlignment(
      session,
      'before checkpoint creation'
    )
    const wasDirty =
      session.history.getEditState().isDirty || !!session.restoredFromBackup
    const currentChangeCount = await getChangeCount(session.sessionId)
    const latestCheckpointChangeCount =
      session.checkpointTimeline.entries.at(-1)?.changeCount ?? 0
    const hasCheckpointableChanges =
      currentChangeCount !== latestCheckpointChangeCount ||
      !!session.restoredFromBackup
    if (!hasCheckpointableChanges) {
      const checkpointCount = await this.getCheckpointCount(session)
      this.postTransformStatus(
        session,
        false,
        undefined,
        vscode.l10n.t('No changes to checkpoint')
      )
      return { checkpointCount, created: false }
    }

    this.postTransformStatus(
      session,
      true,
      undefined,
      vscode.l10n.t('Creating checkpoint...')
    )
    let failureMessage: string | undefined
    const historyBefore = session.history.snapshot()
    try {
      const sessionSyncVersion = session.sessionSyncVersion
      const count = await createCheckpoint(session.sessionId)
      session.history.recordMilestone()
      await this.waitForSessionSync(session, sessionSyncVersion)
      const interval = await this.recordCheckpointTimelineEntry(session, count)
      if (interval?.state !== 'ready') {
        await this.rollbackUnusableTimelineBoundary(
          session,
          count,
          historyBefore
        )
        throw new TimelineStorageError(
          interval?.error?.code ?? 'TIMELINE_CAPTURE_FAILED',
          interval?.error?.message ?? 'Checkpoint history could not be archived'
        )
      }
      await this.resetSessionState(session, wasDirty, false, false, true)
      this.postTransformStatus(
        session,
        false,
        undefined,
        vscode.l10n.t('Checkpoint created')
      )
      return { checkpointCount: count, created: true }
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (failureMessage) {
        this.postTransformStatus(session, false, undefined, failureMessage)
      }
    }
  }

  private async rollbackLastCheckpoint(
    session: EditorSession,
    _markDirty: boolean
  ): Promise<boolean> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return false
    }
    const checkpointCount = await this.assertCheckpointTimelineNativeAlignment(
      session,
      'before checkpoint rollback'
    )
    if (checkpointCount <= 0) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('No OmegaEdit checkpoint to roll back')
      )
      return false
    }

    this.postTransformStatus(
      session,
      true,
      undefined,
      vscode.l10n.t('Rolling back checkpoint...')
    )
    let failureMessage: string | undefined
    try {
      const sessionSyncVersion = session.sessionSyncVersion
      await destroyLastCheckpoint(session.sessionId)
      await this.waitForSessionSync(session, sessionSyncVersion)
      session.checkpointTimeline.currentFingerprint =
        await getChangeLogFingerprint(
          session.sessionId,
          SessionFingerprintContent.COMPUTED,
          'sha256'
        )
      const isDirty = !timelineFingerprintsEqual(
        session.checkpointTimeline.currentFingerprint,
        session.checkpointTimeline.savedFingerprint
      )
      await this.resetSessionState(session, isDirty, isDirty, false)
      await this.truncateCheckpointTimelineFuture(session, checkpointCount - 1)
      this.postTransformStatus(
        session,
        false,
        undefined,
        vscode.l10n.t('Checkpoint rolled back')
      )
      return true
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (failureMessage) {
        this.postTransformStatus(session, false, undefined, failureMessage)
      }
    }
  }

  private async restoreLastCheckpoint(
    session: EditorSession,
    _markDirty: boolean
  ): Promise<{
    restored: boolean
    checkpointCount: number
    changeCount: number
    discardedChangeCount: number
  }> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return {
        restored: false,
        checkpointCount: await this.getCheckpointCount(session),
        changeCount: await getChangeCount(session.sessionId),
        discardedChangeCount: 0,
      }
    }
    const checkpointCount = await this.assertCheckpointTimelineNativeAlignment(
      session,
      'before checkpoint restore'
    )
    if (checkpointCount <= 0) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('No OmegaEdit checkpoint to restore')
      )
      return {
        restored: false,
        checkpointCount,
        changeCount: await getChangeCount(session.sessionId),
        discardedChangeCount: 0,
      }
    }

    this.postTransformStatus(
      session,
      true,
      undefined,
      vscode.l10n.t('Restoring checkpoint...')
    )
    let failureMessage: string | undefined
    try {
      const sessionSyncVersion = session.sessionSyncVersion
      const response = await restoreLastCheckpoint(session.sessionId)
      await this.waitForSessionSync(session, sessionSyncVersion)
      await this.sendViewportData(session)
      session.checkpointTimeline.currentFingerprint =
        await getChangeLogFingerprint(
          session.sessionId,
          SessionFingerprintContent.COMPUTED,
          'sha256'
        )
      const isDirty = !timelineFingerprintsEqual(
        session.checkpointTimeline.currentFingerprint,
        session.checkpointTimeline.savedFingerprint
      )
      await this.resetSessionState(session, isDirty, isDirty, false)
      this.clearSearchState(session)
      this.postTransformStatus(
        session,
        false,
        undefined,
        vscode.l10n.t('Checkpoint restored')
      )
      return {
        restored: true,
        checkpointCount: response.checkpointCount,
        changeCount: response.changeCount,
        discardedChangeCount: response.discardedChangeCount,
      }
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (failureMessage) {
        this.postTransformStatus(session, false, undefined, failureMessage)
      }
    }
  }

  private async rollbackSession(
    session: EditorSession,
    _markDirty: boolean
  ): Promise<void> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

    // A rollback changes the session baseline. Let any Auto Save that already
    // captured the pre-rollback state finish publishing its disk fingerprint
    // before the rollback makes the original content dirty again.
    await session.saveTask?.catch(() => undefined)

    let resolveTimelineOperation: () => void = () => undefined
    session.checkpointTimeline.operation = new Promise<void>((resolve) => {
      resolveTimelineOperation = resolve
    })

    this.postTransformStatus(
      session,
      true,
      undefined,
      vscode.l10n.t('Rolling back session...')
    )
    let failureMessage: string | undefined
    try {
      const sessionSyncVersion = session.sessionSyncVersion
      let checkpointCount = await this.getCheckpointCount(session)
      while (checkpointCount > 0) {
        await destroyLastCheckpoint(session.sessionId)
        checkpointCount -= 1
      }
      await clear(session.sessionId)
      await this.waitForSessionSync(session, sessionSyncVersion)
      session.checkpointTimeline.currentFingerprint =
        session.checkpointTimeline.originalFingerprint
      const isDirty = !timelineFingerprintsEqual(
        session.checkpointTimeline.currentFingerprint,
        session.checkpointTimeline.savedFingerprint
      )
      await this.resetSessionState(session, isDirty, isDirty, true)
      await session.checkpointTimeline.storage?.truncateFuture(0)
      session.checkpointTimeline.entries.length = 0
      session.checkpointTimeline.cursor = 0
      session.checkpointTimeline.lastArchivedChangeCount = 0
      this.postCheckpointTimeline(session)
      this.postTransformStatus(
        session,
        false,
        undefined,
        vscode.l10n.t('Session rolled back')
      )
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (failureMessage) {
        this.postTransformStatus(session, false, undefined, failureMessage)
      }
      resolveTimelineOperation()
      session.checkpointTimeline.operation = undefined
    }
  }

  private async revertSessionChanges(
    session: EditorSession,
    markDirty: boolean
  ): Promise<void> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

    await this.rollbackSession(session, markDirty)
    this.postWebviewMessage(session, { type: 'documentReverted' })
  }

  private clearSearchState(session: EditorSession): void {
    if (session.search.clear()) {
      this.postWebviewMessage(session, { type: 'searchStateCleared' })
    }
  }

  private startHealthPolling(): void {
    if (this.heartbeatLoop) {
      return
    }

    this.heartbeatLoop = startServerHeartbeatLoop({
      intervalMs: 1000,
      getSessionIds: () =>
        Array.from(this.sessions.values(), (session) => session.sessionId),
      onHeartbeat: async (heartbeat) => {
        await this.publishServerHealth(heartbeat)
      },
      onError: (error) => {
        this.serverInfo = undefined
        this.broadcastServerHealth({
          type: 'serverHealth',
          ok: false,
          summary: vscode.l10n.t('Ωedit™ unavailable'),
          detail: error.message,
          severity: 'down',
          metrics: [
            serverHealthMetric('error', vscode.l10n.t('Error'), error.message),
          ],
        })
      },
    })
  }

  private stopHealthPolling(): void {
    this.heartbeatLoop?.stop()
    this.heartbeatLoop = undefined
    this.serverInfo = undefined
  }

  private stopHealthPollingIfIdle(): void {
    if (this.sessions.size === 0 && this.pendingHealthWebviews.size === 0) {
      this.stopHealthPolling()
    }
  }

  private async publishServerHealth(heartbeat: {
    latency: number
    sessionCount: number
    serverUptime: number
    serverCpuCount: number
    serverLoadAverage?: number
    serverResidentMemoryBytes?: number
    serverVirtualMemoryBytes?: number
    serverPeakResidentMemoryBytes?: number
  }): Promise<void> {
    if (this.sessions.size === 0 && this.pendingHealthWebviews.size === 0) {
      return
    }

    try {
      this.serverInfo ??= await getServerInfo()
      const serverInfo = this.serverInfo

      const uptimeSeconds = heartbeat.serverUptime / 1000
      const formatMemoryMiB = (bytes?: number): string =>
        bytes === undefined
          ? vscode.l10n.t('n/a')
          : vscode.l10n.t('{mib} MiB', {
              mib: Math.round(bytes / (1024 * 1024)),
            })
      const severity = classifyServerHealthLatency(heartbeat.latency)
      const runtimeKind = getOptionalStringProperty(serverInfo, 'runtimeKind')
      const runtimeName = getOptionalStringProperty(serverInfo, 'runtimeName')
      const runtimeValue = [runtimeKind, runtimeName]
        .filter(Boolean)
        .join(' / ')
      const platformValue = getOptionalStringProperty(serverInfo, 'platform')
      const compilerValue = getOptionalStringProperty(serverInfo, 'compiler')
      const buildValue = getOptionalStringProperty(serverInfo, 'buildType')
      const cppStandardValue = getOptionalStringProperty(
        serverInfo,
        'cppStandard'
      )
      const availableProcessors = getOptionalNumberProperty(
        serverInfo,
        'availableProcessors'
      )
      const residentMemoryBytes = getOptionalNumberProperty(
        heartbeat,
        'serverResidentMemoryBytes'
      )
      const virtualMemoryBytes = getOptionalNumberProperty(
        heartbeat,
        'serverVirtualMemoryBytes'
      )
      const peakResidentMemoryBytes = getOptionalNumberProperty(
        heartbeat,
        'serverPeakResidentMemoryBytes'
      )
      const logicalCpuValue =
        availableProcessors !== undefined &&
        availableProcessors !== heartbeat.serverCpuCount
          ? vscode.l10n.t('{available} available, {reported} heartbeat', {
              available: availableProcessors,
              reported: heartbeat.serverCpuCount,
            })
          : String(availableProcessors ?? heartbeat.serverCpuCount)
      const metrics = [
        serverHealthMetric(
          'version',
          vscode.l10n.t('Version'),
          serverInfo.serverVersion
        ),
        serverHealthMetric(
          'client',
          vscode.l10n.t('Client'),
          getClientVersion()
        ),
        serverHealthMetric(
          'host',
          vscode.l10n.t('Host'),
          serverInfo.serverHostname
        ),
        serverHealthMetric(
          'pid',
          vscode.l10n.t('PID'),
          String(serverInfo.serverProcessId)
        ),
        serverHealthMetric(
          'runtime',
          vscode.l10n.t('Runtime'),
          runtimeValue || vscode.l10n.t('n/a')
        ),
        serverHealthMetric(
          'latency',
          vscode.l10n.t('Latency'),
          vscode.l10n.t('{latency} ms', {
            latency: heartbeat.latency,
          })
        ),
        serverHealthMetric(
          'sessions',
          vscode.l10n.t('Sessions'),
          String(heartbeat.sessionCount)
        ),
        serverHealthMetric(
          'uptime',
          vscode.l10n.t('Uptime'),
          formatServerUptime(uptimeSeconds)
        ),
        serverHealthMetric(
          'logicalCpus',
          vscode.l10n.t('Logical CPUs'),
          logicalCpuValue
        ),
      ]

      if (heartbeat.serverLoadAverage !== undefined) {
        metrics.push(
          serverHealthMetric(
            'loadAverage',
            vscode.l10n.t('Load Avg'),
            heartbeat.serverLoadAverage.toFixed(2)
          )
        )
      }

      if (platformValue) {
        metrics.push(
          serverHealthMetric(
            'platform',
            vscode.l10n.t('Platform'),
            platformValue
          )
        )
      }

      if (compilerValue) {
        metrics.push(
          serverHealthMetric(
            'compiler',
            vscode.l10n.t('Compiler'),
            compilerValue
          )
        )
      }

      if (buildValue) {
        metrics.push(
          serverHealthMetric('build', vscode.l10n.t('Build'), buildValue)
        )
      }

      if (cppStandardValue) {
        metrics.push(
          serverHealthMetric(
            'cppStandard',
            vscode.l10n.t('C++'),
            cppStandardValue
          )
        )
      }

      if (residentMemoryBytes !== undefined) {
        metrics.push(
          serverHealthMetric(
            'residentMemory',
            vscode.l10n.t('RSS'),
            formatMemoryMiB(residentMemoryBytes)
          )
        )
      }

      if (virtualMemoryBytes !== undefined) {
        metrics.push(
          serverHealthMetric(
            'virtualMemory',
            vscode.l10n.t('Virtual'),
            formatMemoryMiB(virtualMemoryBytes)
          )
        )
      }

      if (peakResidentMemoryBytes !== undefined) {
        metrics.push(
          serverHealthMetric(
            'peakResidentMemory',
            vscode.l10n.t('Peak RSS'),
            formatMemoryMiB(peakResidentMemoryBytes)
          )
        )
      }

      this.broadcastServerHealth({
        type: 'serverHealth',
        ok: true,
        summary: vscode.l10n.t('Ωedit™ {latency} ms', {
          latency: heartbeat.latency,
        }),
        detail: metrics
          .map((metric) => `${metric.label}: ${metric.value}`)
          .join('\n'),
        severity,
        metrics,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.broadcastServerHealth({
        type: 'serverHealth',
        ok: false,
        summary: vscode.l10n.t('Ωedit™ unavailable'),
        detail: message,
        severity: 'down',
        metrics: [serverHealthMetric('error', vscode.l10n.t('Error'), message)],
      })
    }
  }

  private broadcastServerHealth(payload: ServerHealthMessage): void {
    this.latestServerHealth = payload
    if (this.activeSession) {
      this.updateStatusBar(this.activeSession)
    }
    for (const session of this.sessions.values()) {
      this.postWebviewMessage(session, payload)
    }
    for (const webview of this.pendingHealthWebviews) {
      this.postPendingHealthWebviewMessage(webview, payload)
    }
  }

  private makeHistoryExecutor(session: EditorSession): EditorHistoryExecutor {
    const hasTimeline = session.checkpointTimeline.entries.length > 0
    const undoCrossesTimelineMilestone =
      hasTimeline && session.history.willUndoCrossMilestone()
    const redoCrossesTimelineMilestone =
      hasTimeline && session.history.willRedoCrossMilestone()
    const checkoutTimelineMilestone = async (direction: -1 | 1) => {
      const targetCheckpoint = session.checkpointTimeline.cursor + direction
      if (
        targetCheckpoint < 0 ||
        targetCheckpoint > session.checkpointTimeline.entries.length
      ) {
        throw new Error(
          `Checkpoint milestone target ${targetCheckpoint} is outside the materialized timeline`
        )
      }
      await checkoutCheckpoint(session.sessionId, targetCheckpoint)
    }
    return {
      async undoLocal() {
        if (undoCrossesTimelineMilestone) {
          await checkoutTimelineMilestone(-1)
          return
        }
        await undo(session.sessionId)
      },
      async redoLocal() {
        if (redoCrossesTimelineMilestone) {
          await checkoutTimelineMilestone(1)
          return
        }
        await redo(session.sessionId)
      },
      async undoMilestone() {
        if (undoCrossesTimelineMilestone) return
        await destroyLastCheckpoint(session.sessionId)
      },
      async redoMilestone() {
        if (redoCrossesTimelineMilestone) return
        await createCheckpoint(session.sessionId)
      },
      async undoCheckpoint() {
        if (hasTimeline) {
          await checkoutTimelineMilestone(-1)
          return
        }
        await destroyLastCheckpoint(session.sessionId)
      },
      async redoCheckpoint(transaction) {
        if (hasTimeline) {
          await checkoutTimelineMilestone(1)
          return
        }
        const pattern = transaction.isHex
          ? Buffer.from(transaction.query, 'hex')
          : Buffer.from(transaction.query, 'utf8')
        await replaceSessionCheckpointed(
          session.sessionId,
          pattern,
          Buffer.from(transaction.data, 'hex'),
          transaction.caseFolding,
          0,
          0
        )
      },
    }
  }

  private async performUndoOnSession(session: EditorSession): Promise<void> {
    if (!this.ensureSessionCanMutate(session)) {
      return
    }

    const sessionSyncVersion = session.sessionSyncVersion
    const didUndo = await session.history.undo(
      this.makeHistoryExecutor(session)
    )
    if (didUndo) {
      this.markExternalHighlightsStale(session)
      await this.waitForSessionSync(session, sessionSyncVersion)
      session.checkpointTimeline.cursor = Math.min(
        await this.getCheckpointCount(session),
        session.checkpointTimeline.entries.length
      )
      await session.checkpointTimeline.storage?.setCursor(
        session.checkpointTimeline.cursor
      )
      session.checkpointTimeline.currentFingerprint =
        await getChangeLogFingerprint(
          session.sessionId,
          SessionFingerprintContent.COMPUTED,
          'sha256'
        )
      this.postCheckpointTimeline(session)
      this.reconcileExternalHighlightStaleness(session)
      this.clearSearchState(session)
    }
    this.postEditState(session)
  }

  private async performRedoOnSession(session: EditorSession): Promise<void> {
    if (!this.ensureSessionCanMutate(session)) {
      return
    }

    const sessionSyncVersion = session.sessionSyncVersion
    const didRedo = await session.history.redo(
      this.makeHistoryExecutor(session)
    )
    if (didRedo) {
      this.markExternalHighlightsStale(session)
      await this.waitForSessionSync(session, sessionSyncVersion)
      session.checkpointTimeline.cursor = Math.min(
        await this.getCheckpointCount(session),
        session.checkpointTimeline.entries.length
      )
      await session.checkpointTimeline.storage?.setCursor(
        session.checkpointTimeline.cursor
      )
      session.checkpointTimeline.currentFingerprint =
        await getChangeLogFingerprint(
          session.sessionId,
          SessionFingerprintContent.COMPUTED,
          'sha256'
        )
      this.postCheckpointTimeline(session)
      this.reconcileExternalHighlightStaleness(session)
      this.clearSearchState(session)
    }
    this.postEditState(session)
  }

  private enqueueHistoryCommand(
    session: EditorSession,
    operation: 'undo' | 'redo',
    showWarning = false
  ): Promise<void> {
    if (!this.ensureSessionCanMutate(session, showWarning)) {
      return Promise.resolve()
    }

    if (session.pendingHistoryOperation !== operation) {
      session.pendingHistoryOperation = operation
      session.pendingHistoryCount = 0
    }
    session.pendingHistoryCount = (session.pendingHistoryCount ?? 0) + 1

    if (!session.historyCommandTask) {
      session.historyCommandTask = this.processHistoryCommandQueue(session)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          void vscode.window.showErrorMessage(omegaEditErrorMessage(message))
        })
        .finally(() => {
          session.historyCommandTask = undefined
          session.pendingHistoryOperation = undefined
          session.pendingHistoryCount = 0
        })
    }

    return session.historyCommandTask
  }

  private async processHistoryCommandQueue(
    session: EditorSession
  ): Promise<void> {
    while (
      !session.scope.isDisposed &&
      !session.disposed &&
      session.pendingHistoryOperation &&
      (session.pendingHistoryCount ?? 0) > 0
    ) {
      if (this.activeSession !== session) {
        session.pendingHistoryOperation = undefined
        session.pendingHistoryCount = 0
        return
      }

      const operation = session.pendingHistoryOperation
      session.pendingHistoryCount = Math.max(
        0,
        (session.pendingHistoryCount ?? 0) - 1
      )

      const editState = session.history.getEditState()
      if (operation === 'undo') {
        if (!editState.canUndo) {
          continue
        }
        await vscode.commands.executeCommand('undo')
      } else {
        if (!editState.canRedo) {
          continue
        }
        await vscode.commands.executeCommand('redo')
      }
    }
  }

  private notifyDocumentChanged(session: EditorSession): void {
    this.markExternalHighlightsStale(session)
    this._onDidChangeCustomDocument.fire({
      document: session.document,
      undo: () => this.performUndoOnSession(session),
      redo: () => this.performRedoOnSession(session),
    })
  }

  private async applyChangeLogEntries(
    session: EditorSession,
    changes: Iterable<ParsedChangeRecord> | AsyncIterable<ParsedChangeRecord>,
    expectedAfter?: ChangeLogFingerprint
  ): Promise<number> {
    if (
      !session.checkpointTimeline.navigating &&
      !this.ensureSessionCanMutate(session, true)
    ) {
      return 0
    }

    const startChangeCount = await getChangeCount(session.sessionId)
    const sessionSyncVersion = session.sessionSyncVersion
    const appliedTransactions: ChangeRecord[][] = []
    let appliedChangeCount = 0
    const getFinalFingerprint = async () =>
      expectedAfter
        ? await getChangeLogFingerprint(
            session.sessionId,
            SessionFingerprintContent.COMPUTED,
            expectedAfter.digest.algorithm
          ).catch(() => undefined)
        : undefined
    const recordAppliedChanges = async () => {
      if (appliedTransactions.length === 0) {
        return
      }

      for (const transaction of appliedTransactions) {
        session.history.recordLocalChanges(transaction)
      }
      this.postEditState(session)
      this.notifyDocumentChanged(session)
      await this.waitForSessionSync(session, sessionSyncVersion)
      this.clearSearchState(session)
    }

    const applyOne = async (
      change: ParsedChangeRecord
    ): Promise<ChangeRecord | undefined> => {
      const appliedChange = await this.applyChangeLogEntry(session, change)
      return appliedChange
    }
    const maxReplayBatchEntries = 1024
    let pendingBatch: ParsedChangeRecord[] = []
    const flushBatch = async () => {
      if (pendingBatch.length === 0) {
        return
      }

      const batch = pendingBatch
      pendingBatch = []
      const appliedBatch: ChangeRecord[] = []
      await runSessionTransaction(session.sessionId, async () => {
        for (const change of batch) {
          const appliedChange = await applyOne(change)
          if (appliedChange) {
            appliedBatch.push(appliedChange)
            appliedChangeCount += 1
          }
        }
      })
      if (appliedBatch.length > 0) {
        appliedTransactions.push(appliedBatch)
      }
    }

    try {
      for await (const change of changes) {
        if (change.kind === 'TRANSFORM') {
          await flushBatch()
          const appliedChange = await applyOne(change)
          if (appliedChange) {
            appliedTransactions.push([appliedChange])
            appliedChangeCount += 1
          }
        } else {
          pendingBatch.push(change)
          if (pendingBatch.length >= maxReplayBatchEntries) {
            await flushBatch()
          }
        }
      }
      await flushBatch()
      if (expectedAfter) {
        await assertCurrentSessionFingerprint(
          session.sessionId,
          expectedAfter,
          'after'
        )
      }
    } catch (error) {
      let rollbackDetails: ChangeLogReplayFailureDetails
      try {
        const rolledBack = await rollbackSessionToChangeCount(
          session.sessionId,
          startChangeCount
        )
        if (rolledBack) {
          await this.waitForSessionSync(session, sessionSyncVersion)
          await this.sendViewportData(session)
          this.clearSearchState(session)
          this.postEditState(session)
        }
        rollbackDetails = {
          appliedCount: appliedChangeCount,
          rollback: {
            attempted: true,
            succeeded: true,
            rolledBack,
            targetChangeCount: startChangeCount,
          },
          ...(await getFinalFingerprint().then((finalFingerprint) =>
            finalFingerprint ? { finalFingerprint } : {}
          )),
        }
      } catch (rollbackError) {
        const combinedError = changeLogApplyErrorWithRollbackFailure(
          error,
          rollbackError
        )
        throw attachChangeLogReplayDetails(combinedError, {
          appliedCount: appliedChangeCount,
          rollback: {
            attempted: true,
            succeeded: false,
            targetChangeCount: startChangeCount,
            error: replayErrorMessage(rollbackError),
          },
          ...(await getFinalFingerprint().then((finalFingerprint) =>
            finalFingerprint ? { finalFingerprint } : {}
          )),
        })
      }
      throw attachChangeLogReplayDetails(replayError(error), rollbackDetails)
    }

    await recordAppliedChanges()
    return appliedChangeCount
  }

  private async applyChangeLogEntry(
    session: EditorSession,
    change: ParsedChangeRecord
  ): Promise<ChangeRecord | undefined> {
    switch (change.kind) {
      case 'INSERT': {
        const serial = await insert(
          session.sessionId,
          change.offset,
          Buffer.from(change.data, 'hex')
        )
        return {
          serial,
          kind: 'INSERT',
          offset: change.offset,
          length: 0,
          data: change.data,
          ...(change.groupId ? { groupId: change.groupId } : {}),
        }
      }
      case 'DELETE': {
        const serial = await del(
          session.sessionId,
          change.offset,
          change.length
        )
        return {
          serial,
          kind: 'DELETE',
          offset: change.offset,
          length: change.length,
          data: change.data,
          ...(change.groupId ? { groupId: change.groupId } : {}),
        }
      }
      case 'OVERWRITE': {
        const buf = Buffer.from(change.data, 'hex')
        const serial = await overwrite(session.sessionId, change.offset, buf)
        return {
          serial,
          kind: 'OVERWRITE',
          offset: change.offset,
          length: buf.length,
          data: change.data,
          ...(change.groupId ? { groupId: change.groupId } : {}),
        }
      }
      case 'REPLACE':
        return await this.applyReplaceChange(
          session,
          change.offset,
          change.length,
          change.data,
          change.groupId
        )
      case 'TRANSFORM': {
        const descriptor = change.transformDescriptor
        if (!descriptor) {
          throw new Error('TRANSFORM change data was not normalized')
        }

        if (descriptor.transformId === INTERNAL_REPLACE_ALL_REPLAY_ID) {
          const options = parseTransformOptionsJson(
            descriptor.optionsJson,
            'checkpointed replace-all replay'
          )
          if (
            typeof options.query !== 'string' ||
            typeof options.isHex !== 'boolean' ||
            typeof options.caseFolding !== 'number' ||
            typeof options.data !== 'string'
          ) {
            throw new Error(
              'Checkpointed replace-all replay descriptor is invalid'
            )
          }
          const pattern = options.isHex
            ? Buffer.from(options.query, 'hex')
            : Buffer.from(options.query, 'utf8')
          const replacedCount = await replaceSessionCheckpointed(
            session.sessionId,
            pattern,
            Buffer.from(options.data, 'hex'),
            options.caseFolding as SearchCaseFolding,
            0,
            0
          )
          if (replacedCount <= 0) {
            throw new Error(
              'Checkpointed replace-all replay produced no content change'
            )
          }
          return {
            serial: 1,
            kind: 'TRANSFORM',
            offset: 0,
            length: 0,
            data: change.data,
          }
        }

        const computedFileSizeBefore = await getComputedFileSize(
          session.sessionId
        )
        const response = await applyTransformPlugin(
          session.sessionId,
          descriptor.transformId,
          change.offset,
          change.length,
          descriptor.optionsJson
        )
        if (!response.contentChanged) {
          throw new Error(
            `Transform ${descriptor.transformId} replay produced no content change`
          )
        }
        if (response.serial === undefined) {
          throw new Error('Transform did not return a change serial')
        }
        const computedFileSizeAfter = await getComputedFileSize(
          session.sessionId
        )
        assertTransformReplayResponse(
          descriptor,
          change.offset,
          change.length,
          computedFileSizeBefore,
          computedFileSizeAfter,
          response
        )

        return {
          serial: response.serial,
          kind: 'TRANSFORM',
          offset: response.offset,
          length: response.length,
          data: change.data,
          ...(change.groupId ? { groupId: change.groupId } : {}),
        }
      }
    }
  }

  private async applyReplaceChange(
    session: EditorSession,
    offset: number,
    length: number,
    dataHex: string,
    groupId?: string
  ): Promise<ChangeRecord | undefined> {
    const originalSegment =
      length > 0
        ? await getSegment(session.sessionId, offset, length)
        : new Uint8Array()
    const replacementSegment = Buffer.from(dataHex, 'hex')
    const changeSerial = await editSimple(
      session.sessionId,
      offset,
      originalSegment,
      replacementSegment
    )

    if (changeSerial <= 0) {
      return undefined
    }

    return {
      serial: changeSerial,
      kind: 'REPLACE',
      offset,
      length,
      data: dataHex,
      groupId,
    }
  }

  private async applyReplace(
    session: EditorSession,
    offset: number,
    length: number,
    dataHex: string,
    groupId?: string
  ): Promise<boolean> {
    const change = await this.applyReplaceChange(
      session,
      offset,
      length,
      dataHex,
      groupId
    )

    if (change) {
      await this.truncateCheckpointTimelineFuture(session)
      this.markCheckpointTimelineChanged(session)
      session.history.recordLocalChange(change)
      this.postEditState(session)
      this.notifyDocumentChanged(session)
      return true
    }

    return false
  }

  /** Scroll the viewport to a given offset, clamped to file bounds */
  private async applyScrollTo(
    session: EditorSession,
    offset: number
  ): Promise<void> {
    if (session.scope.isDisposed) {
      return
    }

    const bytesPerRow = session.bytesPerRow
    const viewportRows = Math.max(32, session.visibleRows || 32)
    const bufferedRows = Math.max(
      viewportRows,
      Math.floor(session.capacity / bytesPerRow)
    )
    const clamped = Math.max(
      0,
      Math.min(offset, Math.max(0, session.fileSize - 1))
    )
    const rowAlignedOffset = clamped - (clamped % bytesPerRow)
    const preloadBeforeRows = Math.max(
      0,
      Math.floor((bufferedRows - viewportRows) / 2)
    )
    const bufferOffset = Math.max(
      0,
      rowAlignedOffset - preloadBeforeRows * bytesPerRow
    )
    if (
      rowAlignedOffset === session.offset &&
      bufferOffset === session.bufferOffset
    ) {
      return
    }

    session.offset = rowAlignedOffset
    try {
      await modifyViewport(session.viewportId, bufferOffset, session.capacity)
      await this.sendViewportData(session)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // Resizing can occasionally race the native viewport state. Recreate the
      // viewport in place so the editor stays usable instead of surfacing an error.
      if (
        message.includes('modifyViewport error') ||
        message.includes('modify viewport failed')
      ) {
        await this.recreateViewport(session, bufferOffset, session.capacity)
        return
      }

      throw error
    }
    // Viewport events still refresh edit-driven changes; scrolls push data
    // immediately so the UI does not wait on subscription delivery.
  }

  /** Coalesce rapid viewport updates from resize/scroll into a single in-flight mutation */
  private async scrollTo(
    session: EditorSession,
    offset: number
  ): Promise<void> {
    if (session.scope.isDisposed) {
      return
    }

    session.pendingScrollOffset = offset
    if (session.scrollTask) {
      return session.scrollTask
    }

    session.scrollTask = (async () => {
      while (
        !session.scope.isDisposed &&
        typeof session.pendingScrollOffset === 'number'
      ) {
        const nextOffset = session.pendingScrollOffset
        session.pendingScrollOffset = undefined
        await this.applyScrollTo(session, nextOffset)
      }
    })().finally(() => {
      session.scrollTask = undefined
    })

    return session.scrollTask
  }

  // --- Webview Message Handler ---

  private async handleWebviewMessage(
    session: EditorSession,
    rawMessage: unknown,
    propagateErrors = false
  ): Promise<void> {
    const msg = normalizeWebviewMessage(
      { fileSize: session.fileSize, contentSources: session.contentSources },
      rawMessage
    )
    if (!msg || session.scope.isDisposed || session.disposed) {
      return
    }

    if (session.transformInFlight && isMutationWebviewMessage(msg)) {
      if (session.checkpointTimeline.operation) {
        await session.checkpointTimeline.operation.catch(() => undefined)
      }
      if (session.transformInFlight) {
        this.postTransformStatus(
          session,
          true,
          undefined,
          transformMutationBlockedMessage()
        )
        return
      }
    }

    try {
      switch (msg.type) {
        case 'editorStateChanged': {
          session.webviewState = {
            visibleOffset: msg.visibleOffset,
            visibleByteCount: msg.visibleByteCount,
            selectedOffset: msg.selectedOffset,
            selectionStart: msg.selectionStart,
            selectionEnd: msg.selectionEnd,
            selectionLength: msg.selectionLength,
            bytesPerRow: msg.bytesPerRow,
            offsetRadix: msg.offsetRadix,
            textEncoding: msg.textEncoding,
            activePane: msg.activePane,
            editMode: session.webviewState.editMode,
            insertDirection: msg.insertDirection,
          }
          this.fireEditorStateChanged(session)
          break
        }

        case 'toggleEditMode': {
          await this.toggleEditMode(session)
          break
        }

        case 'setInsertDirection': {
          this.setSessionInsertDirection(session, msg.insertDirection)
          break
        }

        case 'setTextEncoding': {
          this.setSessionTextEncoding(session, msg.textEncoding)
          break
        }

        // --- Scrolling ---
        case 'scroll': {
          const delta =
            msg.direction === 'up'
              ? -session.bytesPerRow * 4
              : session.bytesPerRow * 4
          const baseOffset = session.pendingScrollOffset ?? session.offset
          await this.scrollTo(session, baseOffset + delta)
          break
        }

        case 'scrollTo': {
          await this.scrollTo(session, msg.offset)
          break
        }

        case 'setBytesPerRow': {
          if (msg.persist === false) {
            await this.applySessionBytesPerRow(session, msg.bytesPerRow)
          } else {
            session.bytesPerRowSetting = msg.bytesPerRow
            await this.updateBytesPerRowConfiguration(session, msg.bytesPerRow)
          }
          break
        }

        case 'setBytesPerRowMode': {
          session.bytesPerRowSetting = session.bytesPerRow
          await this.updateBytesPerRowConfiguration(
            session,
            session.bytesPerRow
          )
          break
        }

        case 'setViewportMetrics': {
          const visibleRows = Math.max(1, Math.floor(msg.visibleRows))
          if (session.transformInFlight) {
            this.postTransformStatus(
              session,
              true,
              undefined,
              transformMutationBlockedMessage()
            )
          }
          if (visibleRows !== session.visibleRows) {
            session.visibleRows = visibleRows
            await this.scrollTo(session, session.offset)
          } else {
            await this.sendViewportData(session)
          }
          break
        }

        case 'requestAnalysisProfile': {
          this.enqueueAnalysisProfile(session, msg)
          break
        }

        case 'requestTransformPlugins': {
          await this.sendTransformPlugins(session)
          break
        }

        case 'cancelTransform': {
          this.cancelTransform(session)
          break
        }

        case 'copySelection': {
          await this.postClipboardSelection(
            session,
            'copy',
            msg.offset,
            msg.length,
            msg.format
          )
          break
        }

        case 'cutSelection': {
          const sessionSyncVersion = session.sessionSyncVersion
          await this.postClipboardSelection(
            session,
            'cut',
            msg.offset,
            msg.length,
            msg.format
          )
          const serial = await del(session.sessionId, msg.offset, msg.length)
          await this.truncateCheckpointTimelineFuture(session)
          this.markCheckpointTimelineChanged(session)
          session.history.recordLocalChange({
            serial,
            kind: 'DELETE',
            offset: msg.offset,
            length: msg.length,
            data: '',
          })
          this.postEditState(session)
          this.notifyDocumentChanged(session)
          await this.waitForSessionSync(session, sessionSyncVersion)
          this.clearSearchState(session)
          this.postWebviewMessage(session, {
            type: 'cutComplete',
            offset: msg.offset,
          })
          break
        }

        // --- Editing ---
        case 'insert': {
          const sessionSyncVersion = session.sessionSyncVersion
          const data = Buffer.from(msg.data, 'hex')
          const serial = await insert(session.sessionId, msg.offset, data)
          await this.truncateCheckpointTimelineFuture(session)
          this.markCheckpointTimelineChanged(session)
          session.history.recordLocalChange({
            serial,
            kind: 'INSERT',
            offset: msg.offset,
            length: 0,
            data: msg.data,
          })
          this.postEditState(session)
          this.notifyDocumentChanged(session)
          await this.waitForSessionSync(session, sessionSyncVersion)
          this.clearSearchState(session)
          break
        }

        case 'delete': {
          const sessionSyncVersion = session.sessionSyncVersion
          const serial = await del(session.sessionId, msg.offset, msg.length)
          await this.truncateCheckpointTimelineFuture(session)
          this.markCheckpointTimelineChanged(session)
          session.history.recordLocalChange({
            serial,
            kind: 'DELETE',
            offset: msg.offset,
            length: msg.length,
            data: '',
          })
          this.postEditState(session)
          this.notifyDocumentChanged(session)
          await this.waitForSessionSync(session, sessionSyncVersion)
          this.clearSearchState(session)
          break
        }

        case 'overwrite': {
          const sessionSyncVersion = session.sessionSyncVersion
          const serial = await overwrite(
            session.sessionId,
            msg.offset,
            Buffer.from(msg.data, 'hex')
          )
          await this.truncateCheckpointTimelineFuture(session)
          this.markCheckpointTimelineChanged(session)
          session.history.recordLocalChange({
            serial,
            kind: 'OVERWRITE',
            offset: msg.offset,
            length: msg.data.length / 2,
            data: msg.data,
          })
          this.postEditState(session)
          this.notifyDocumentChanged(session)
          await this.waitForSessionSync(session, sessionSyncVersion)
          this.clearSearchState(session)
          break
        }

        case 'replace': {
          const sessionSyncVersion = session.sessionSyncVersion
          await session.search.preserveState(async () => {
            const replacementLength = Buffer.from(msg.data, 'hex').length
            const changed = await this.applyReplace(
              session,
              msg.offset,
              msg.length,
              msg.data
            )
            if (changed) {
              await this.waitForSessionSync(session, sessionSyncVersion)
              await this.sendViewportData(session)
            }
            this.postWebviewMessage(session, {
              type: 'replaceComplete',
              scope: 'single',
              replacedOffset: msg.offset,
              offsetDelta: replacementLength - msg.length,
              selectionOffset: changed && msg.data.length > 0 ? msg.offset : -1,
              replacedCount: changed ? 1 : 0,
            })
          })
          break
        }

        case 'exportRange': {
          await this.exportRangeToFile(session, msg.offset, msg.length)
          break
        }

        case 'insertFile': {
          await this.insertFileAtOffset(session, msg.offset)
          break
        }

        case 'replaceRangeWithFile': {
          await this.replaceRangeWithFile(session, msg.offset, msg.length)
          break
        }

        case 'createCheckpoint': {
          await this.createCheckpoint({ uri: session.document.uri })
          break
        }

        case 'navigateCheckpointTimeline': {
          const timeline = session.checkpointTimeline
          if (msg.checkpoint > timeline.entries.length || timeline.navigating) {
            break
          }
          await this.navigateToCheckpoint(session, msg.checkpoint)
          break
        }

        case 'hideCheckpointTimeline': {
          session.checkpointTimeline.visible = false
          this.postCheckpointTimeline(session)
          break
        }

        case 'rollbackCheckpoint': {
          await this.rollbackCheckpoint({ uri: session.document.uri })
          break
        }

        case 'restoreCheckpoint': {
          await this.restoreCheckpoint({ uri: session.document.uri })
          break
        }

        case 'exportChangeLog': {
          await this.exportChangeLog({ uri: session.document.uri })
          break
        }

        case 'requestActionJournalViewport': {
          await this.postActionJournalViewport(session, msg)
          break
        }

        case 'hideActionJournal': {
          session.actionJournal.visible = false
          session.actionJournal.requestGeneration += 1
          session.actionJournal.entries.clear()
          this.postWebviewMessage(session, { type: 'actionJournalHidden' })
          break
        }

        case 'revealActionJournalEntry': {
          const offset = Number(msg.offset)
          if (!Number.isSafeInteger(offset) || offset < 0) {
            throw new RangeError(
              vscode.l10n.t('Action journal offset exceeds the editor range')
            )
          }
          await this.scrollTo(
            session,
            Math.min(offset, Math.max(0, session.fileSize - 1))
          )
          break
        }

        case 'copyActionJournalEntry': {
          await this.copyActionJournalEntry(
            session,
            msg.firstSerial,
            msg.lastSerial,
            msg.format
          )
          break
        }

        case 'applyChangeLog': {
          await this.applyChangeLog({ uri: session.document.uri })
          break
        }

        case 'loadRangeMap': {
          await this.loadRangeMap({ uri: session.document.uri })
          break
        }

        case 'unloadRangeMap': {
          this.unloadRangeMap({ uri: session.document.uri })
          break
        }

        case 'replaceAllMatches': {
          const caseFolding = searchCaseFoldingForRequest(
            msg.caseInsensitive,
            msg.textEncoding
          )
          this.postTransformStatus(
            session,
            true,
            undefined,
            vscode.l10n.t('Replacing matches...')
          )
          let failureMessage: string | undefined
          const sessionSyncVersion = session.sessionSyncVersion
          try {
            await session.search.preserveState(async () => {
              const result = await session.search.replaceAll({
                query: msg.query,
                isHex: msg.isHex,
                isReverse: msg.isReverse ?? false,
                caseFolding,
                length: msg.length,
                replacement: Buffer.from(msg.data, 'hex'),
                replacementData: msg.data,
              })

              if (result.replacedCount > 0) {
                const checkpointTransaction = result.checkpointTransaction
                await this.truncateCheckpointTimelineFuture(session)
                this.markCheckpointTimelineChanged(session)
                if (
                  result.strategy === 'checkpointed' &&
                  checkpointTransaction
                ) {
                  session.history.recordCheckpointReplaceAll(
                    checkpointTransaction
                  )
                } else {
                  session.history.recordLocalReplaceAll(
                    result.orderedOffsets,
                    msg.length,
                    msg.data
                  )
                }
                this.postEditState(session)
                this.notifyDocumentChanged(session)
                await this.waitForSessionSync(session, sessionSyncVersion)
                if (
                  result.strategy === 'checkpointed' &&
                  checkpointTransaction
                ) {
                  const checkpointCount = await this.getCheckpointCount(session)
                  await this.recordCheckpointTimelineEntry(
                    session,
                    checkpointCount,
                    'plain',
                    [],
                    [
                      {
                        serial: 1,
                        kind: 'TRANSFORM',
                        offset: 0,
                        length: 0,
                        data: encodeTransformPrimitiveDataHex(
                          INTERNAL_REPLACE_ALL_REPLAY_ID,
                          JSON.stringify({
                            query: checkpointTransaction.query,
                            isHex: checkpointTransaction.isHex,
                            caseFolding: checkpointTransaction.caseFolding,
                            data: checkpointTransaction.data,
                          })
                        ),
                      },
                    ]
                  )
                }
                await this.sendViewportData(session)
              }

              this.postWebviewMessage(session, {
                type: 'replaceComplete',
                scope: 'all',
                selectionOffset: result.selectionOffset,
                replacedCount: result.replacedCount,
              })
            })
          } catch (error) {
            failureMessage =
              error instanceof Error ? error.message : String(error)
            throw error
          } finally {
            this.postTransformStatus(session, false, undefined, failureMessage)
          }
          break
        }

        case 'applyTransform': {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: vscode.l10n.t('Applying transform...'),
              cancellable: true,
            },
            async (_progress, token) => {
              await session.search.preserveState(async () => {
                await this.applyTransformToRange(
                  session,
                  msg.pluginId,
                  msg.contentSource ?? 'computed',
                  msg.offset,
                  msg.length,
                  msg.optionsJson?.trim() || undefined,
                  token
                )
              })
            }
          )
          break
        }

        // --- Undo / Redo ---
        case 'undo': {
          // Route through VS Code so it pops from its CustomDocumentEditEvent
          // stack; VS Code then calls our registered undo() callback, which
          // calls session.history.undo() and keeps VS Code's dirty state in
          // sync (including clearing dirty when back at the saved baseline).
          await this.enqueueHistoryCommand(session, 'undo')
          break
        }

        case 'redo': {
          await this.enqueueHistoryCommand(session, 'redo')
          break
        }

        // --- Save ---
        case 'save': {
          // Delegate to VS Code so it owns the save lifecycle and clears
          // the dirty indicator.  VS Code will call saveCustomDocument().
          await vscode.commands.executeCommand('workbench.action.files.save')
          break
        }

        case 'saveAs': {
          // Delegate to VS Code so it presents its own destination picker and
          // then calls saveCustomDocumentAs(), clearing the dirty indicator.
          await vscode.commands.executeCommand('workbench.action.files.saveAs')
          break
        }

        case 'revert': {
          // Delegate to VS Code so File > Revert File and webview-initiated
          // reverts share the same custom-editor lifecycle.
          await vscode.commands.executeCommand('workbench.action.files.revert')
          break
        }

        // --- Search ---
        case 'search': {
          const caseFolding = searchCaseFoldingForRequest(
            msg.caseInsensitive,
            msg.textEncoding
          )
          const result = await session.search.search({
            query: msg.query,
            isHex: msg.isHex,
            isReverse: msg.isReverse ?? false,
            caseFolding,
          })
          this.postWebviewMessage(session, {
            type: 'searchResults',
            mode: result.mode,
            matches: result.matches,
            currentOffset: result.currentOffset,
            patternLength: result.patternLength,
            windowLimit: result.windowLimit,
          })
          if (result.firstOffset >= 0) {
            await this.scrollTo(session, result.firstOffset)
          }
          break
        }

        case 'goToMatch': {
          await this.scrollTo(session, msg.offset)
          break
        }

        case 'findAdjacentMatch': {
          const caseFolding = searchCaseFoldingForRequest(
            msg.caseInsensitive,
            msg.textEncoding
          )
          const navigation = await session.search.findAdjacent({
            query: msg.query,
            isHex: msg.isHex,
            caseFolding,
            direction: msg.direction,
            anchorOffset: msg.offset,
            fileSize: session.fileSize,
          })
          if (navigation.offset >= 0) {
            await this.scrollTo(session, navigation.offset)
          }
          const viewportOffset = session.offset
          const viewportLength = Math.min(
            session.webviewState.visibleByteCount,
            Math.max(0, session.fileSize - viewportOffset)
          )
          const viewport =
            navigation.offset >= 0 && viewportLength > 0
              ? await session.search.findViewportMatches({
                  query: msg.query,
                  isHex: msg.isHex,
                  caseFolding,
                  fileSize: session.fileSize,
                  viewportOffset,
                  viewportLength,
                  focusedOffset: navigation.offset,
                })
              : undefined
          this.postWebviewMessage(session, {
            type: 'searchNavigationResult',
            offset: navigation.offset,
            patternLength: navigation.patternLength,
            ...(viewport
              ? {
                  viewportOffset: viewport.offset,
                  viewportLength: viewport.length,
                  viewportMatches: viewport.matches,
                  viewportHasMoreMatches: viewport.hasMore,
                }
              : {}),
          })
          break
        }
        case 'searchViewportMatches': {
          const caseFolding = searchCaseFoldingForRequest(
            msg.caseInsensitive,
            msg.textEncoding
          )
          const patternLength = Math.floor(msg.query.length / 2)
          const viewport = await session.search.findViewportMatches({
            query: msg.query,
            isHex: msg.isHex,
            caseFolding,
            fileSize: session.fileSize,
            viewportOffset: msg.viewportOffset,
            viewportLength: msg.viewportLength,
          })
          this.postWebviewMessage(session, {
            type: 'searchViewportMatchesResult',
            viewportOffset: msg.viewportOffset,
            viewportLength: msg.viewportLength,
            matches: viewport?.matches ?? [],
            patternLength,
          })
          break
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      void vscode.window.showErrorMessage(omegaEditErrorMessage(message))
      if (propagateErrors) {
        throw err
      }
    }
  }
}
