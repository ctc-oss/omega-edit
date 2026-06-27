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
  ChangeKind,
  checkSessionModel,
  clear,
  countCharacters,
  CountKind,
  createCheckpoint,
  del,
  destroyLastCheckpoint,
  editSimple,
  type EditorChangeRecord as ChangeRecord,
  type EditorHistoryExecutor,
  EditorHistoryController,
  EditorSearchController,
  ScopedEditorSessionHandle,
  getByteOrderMark,
  getChangeCount,
  getChangeDetails,
  getClientVersion,
  getComputedFileSize,
  getContentType,
  getCounts,
  getLanguage,
  getSegment,
  getServerInfo,
  getSessionFingerprint,
  getViewportData,
  IOFlags,
  SaveStatus,
  type IServerInfo,
  insert,
  listTransformPlugins,
  modifyViewport,
  numAscii,
  overwrite,
  profileSession,
  replaceSessionCheckpointed,
  redo,
  restoreLastCheckpoint,
  runSessionTransaction,
  saveSession,
  SessionFingerprintContent,
  SessionEventKind,
  startServerHeartbeatLoop,
  type TransformProgress,
  TransformPluginOperation,
  type TransformPluginInfo,
  type ServerHeartbeatLoop,
  undo,
  ViewportEventKind,
} from '@omega-edit/client'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import * as nodePath from 'node:path'
import { finished } from 'node:stream/promises'
import * as vscode from 'vscode'
import { OMEGA_EDIT_VIEW_TYPE } from './constants'
import {
  getSvelteWebviewContent,
  getSvelteWebviewLocalResourceRoot,
} from './svelteWebview'
import {
  MAX_ANALYSIS_PROFILE_BYTES,
  MAX_LABEL_LENGTH,
  type BytesPerRow,
  type InsertDirection,
  type WebviewEditMode,
  type WebviewEditorState,
  type WebviewEditorUiState,
  type WebviewExternalHighlight,
  type WebviewTransformPlugin,
  type HostToWebviewMessage,
  type ServerHealthMetric,
  type ServerHealthMetricId,
  type ServerHealthMessage,
  type WebviewToHostMessage,
  normalizeExternalHighlights,
  normalizeBytesPerRow,
  normalizeWebviewMessage,
} from './webviewProtocol'

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
  transformPlugins: WebviewTransformPlugin[]
  transformInFlight: boolean
  pendingHistoryOperation?: 'undo' | 'redo'
  pendingHistoryCount?: number
  historyCommandTask?: Promise<void>
  contentType?: string
  language?: string
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
  changes: ChangeRecord[]
  before?: ChangeLogFingerprint
  after?: ChangeLogFingerprint
}

const SESSION_SYNC_TIMEOUT_MS = 2000
const VIEWPORT_BUFFER_BYTES = 8 * 1024
const SERVER_HEALTH_WARN_LATENCY_MS = 75
const SERVER_HEALTH_ERROR_LATENCY_MS = 250
const MAX_TRANSFORM_RESULT_TEXT_LENGTH = 240
const MAX_TRANSFORM_RESULT_PREVIEW_BYTES = 4 * 1024
const MAX_FILE_SPLICE_BYTES = 32 * 1024 * 1024
const CHANGE_LOG_FORMAT = 'omega-edit.change-log'
const CHANGE_LOG_VERSION = 2
const DEFAULT_CHANGE_LOG_DIGEST_ALGORITHM = 'sha256'
const GRPC_NOT_FOUND = 5
const MAX_INT64 = 9_223_372_036_854_775_807n
const CONTEXT_HEX_EDITOR_ACTIVE = 'omegaEdit.hexEditorActive'
const CONTEXT_CAN_UNDO = 'omegaEdit.canUndo'
const CONTEXT_CAN_REDO = 'omegaEdit.canRedo'
const CONTEXT_HAS_PENDING_CHANGES = 'omegaEdit.hasPendingChanges'
const CONTEXT_TRANSFORM_IN_FLIGHT = 'omegaEdit.transformInFlight'

function openEditorFirstMessage(): string {
  return vscode.l10n.t('Open an OmegaEdit editor first')
}

function omegaEditErrorMessage(message: string): string {
  return vscode.l10n.t('OmegaEdit error: {message}', { message })
}

function describeSaveStatus(status: number): string {
  if (status === SaveStatus.MODIFIED) {
    return vscode.l10n.t('original file was modified outside OmegaEdit')
  }
  return vscode.l10n.t('status {status}', { status })
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
    case 'insertFile':
    case 'replaceRangeWithFile':
    case 'replaceAllMatches':
    case 'createCheckpoint':
    case 'rollbackCheckpoint':
    case 'restoreCheckpoint':
    case 'applyChangeLog':
    case 'undo':
    case 'redo':
    case 'revert':
      return true
    default:
      return false
  }
}

function safeInsertDirection(value: unknown): InsertDirection | undefined {
  return value === 'forward' || value === 'backward' ? value : undefined
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
    data:
      kind === 'DELETE'
        ? ''
        : Buffer.from(change.getData_asU8()).toString('hex'),
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
  onProgress?: (processedSerial: number) => void
): Promise<CollectedChangeLogRecords> {
  const changes = onRecord ? undefined : ([] as ChangeRecord[])
  const unavailableChangeSerials: number[] = []
  for (let serial = 1; serial <= sourceChangeCount; serial += 1) {
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

function serializeChangeLogRecord(
  record: ChangeRecord
): Record<string, unknown> {
  return {
    ...record,
    serial: int64ToDecimal(record.serial),
    offset: int64ToDecimal(record.offset),
    length: int64ToDecimal(record.length),
    ...(record.replacementLength !== undefined
      ? { replacementLength: int64ToDecimal(record.replacementLength) }
      : {}),
    ...(record.computedFileSizeBefore !== undefined
      ? {
          computedFileSizeBefore: int64ToDecimal(record.computedFileSizeBefore),
        }
      : {}),
    ...(record.computedFileSizeAfter !== undefined
      ? {
          computedFileSizeAfter: int64ToDecimal(record.computedFileSizeAfter),
        }
      : {}),
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

async function writeChangeLogFile(
  targetPath: string,
  sourceChangeCount: number,
  before: ChangeLogFingerprint,
  after: ChangeLogFingerprint,
  writeRecords: (
    writeRecord: (record: ChangeRecord) => Promise<void>
  ) => Promise<CollectedChangeLogRecords>,
  verifyBeforeCommit?: () => Promise<void>
): Promise<CollectedChangeLogRecords> {
  const tempPath = nodePath.join(
    nodePath.dirname(targetPath),
    `.${nodePath.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
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
    const collected = await writeRecords(async (record) => {
      const serialized = JSON.stringify(
        serializeChangeLogRecord(record),
        null,
        2
      )
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
    await verifyBeforeCommit?.()
    await nodeFs.rename(tempPath, targetPath)
    committed = true
    return collected
  } finally {
    if (!committed) {
      stream.destroy()
      await nodeFs.rm(tempPath, { force: true }).catch(() => undefined)
    }
  }
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

function safeChangeRecord(value: unknown): ChangeRecord | undefined {
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
      return groupId
        ? { serial, kind: 'DELETE', offset, length, data: '', groupId }
        : { serial, kind: 'DELETE', offset, length, data: '' }
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
      const transformId = safeString(value.transformId, MAX_LABEL_LENGTH)
      const optionsJson =
        value.optionsJson === undefined
          ? undefined
          : safeString(value.optionsJson, Number.POSITIVE_INFINITY, true)
      if (
        length === undefined ||
        !transformId ||
        (value.optionsJson !== undefined && optionsJson === undefined) ||
        (value.data !== undefined && value.data !== '')
      ) {
        return undefined
      }

      const record: ChangeRecord = groupId
        ? {
            serial,
            kind: 'TRANSFORM',
            offset,
            length,
            data: '',
            transformId,
            groupId,
          }
        : {
            serial,
            kind: 'TRANSFORM',
            offset,
            length,
            data: '',
            transformId,
          }
      if (optionsJson !== undefined) {
        record.optionsJson = optionsJson
      }

      for (const key of [
        'replacementLength',
        'computedFileSizeBefore',
        'computedFileSizeAfter',
      ] as const) {
        if (value[key] === undefined) {
          continue
        }
        try {
          record[key] = normalizeNonNegativeInt64ForClient(
            value[key],
            `change log entry ${key}`
          )
        } catch {
          return undefined
        }
      }

      return record
    }
    default:
      return undefined
  }
}

function validateChangeRecordMetadata(
  changes: ChangeRecord[],
  entries: unknown[]
): void {
  const serialEntryCount = entries.filter(
    (entry) => isRecord(entry) && entry.serial !== undefined
  ).length
  if (serialEntryCount > 0 && serialEntryCount !== changes.length) {
    throw new Error('Change log serial metadata must be present on every entry')
  }

  for (let index = 0; index < changes.length; index += 1) {
    if (serialEntryCount > 0 && changes[index].serial !== index + 1) {
      throw new Error(
        `Change log serial metadata must be contiguous; entry ${index} has serial ${
          changes[index].serial
        }, expected ${index + 1}`
      )
    }
  }

  const closedGroups = new Set<string>()
  let activeGroup: string | undefined
  for (const [index, change] of changes.entries()) {
    const groupId = change.groupId
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

function readChangeLogDocumentCount(
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

function assertCompleteChangeLog(
  action: 'export' | 'apply',
  unavailableChangeSerials: number[]
): void {
  if (unavailableChangeSerials.length === 0) {
    return
  }

  throw new Error(
    `${
      action === 'export'
        ? 'Change log export is incomplete: the server no longer has details for every reported change'
        : 'Change log is incomplete: unavailable change details cannot be replayed safely'
    }${describeUnavailableSerials(unavailableChangeSerials)}`
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

function validateChangeLogDocumentMetadata(
  document: Record<string, unknown>,
  changes: ChangeRecord[]
): void {
  if (typeof document.complete !== 'boolean') {
    throw new Error('Change log complete must be a boolean')
  }

  const changeCount = readChangeLogDocumentCount(document, 'changeCount')
  const sourceChangeCount = readChangeLogDocumentCount(
    document,
    'sourceChangeCount'
  )
  const unavailableChangeCount = readChangeLogDocumentCount(
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

  assertCompleteChangeLog('apply', unavailableChangeSerials)
}

function parseChangeLog(content: Uint8Array): ParsedChangeLog {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(content))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid change log JSON: ${message}`)
  }

  let entries: unknown[] | undefined
  let document: Record<string, unknown> | undefined
  if (isRecord(parsed)) {
    if (parsed.format !== CHANGE_LOG_FORMAT) {
      throw new Error('Unsupported change log format')
    }
    if (parsed.version !== CHANGE_LOG_VERSION) {
      throw new Error('Unsupported change log version')
    }
    document = parsed
    entries = Array.isArray(parsed.changes) ? parsed.changes : undefined
  }

  if (!entries) {
    throw new Error(
      'Change log must be a versioned omega-edit.change-log document'
    )
  }

  const changes = entries.map((entry, index) => {
    const change = safeChangeRecord(entry)
    if (!change) {
      throw new Error(`Invalid change record at index ${index}`)
    }
    return change
  })
  validateChangeRecordMetadata(changes, entries)
  if (document) {
    validateChangeLogDocumentMetadata(document, changes)
    return {
      changes,
      before: normalizeChangeLogFingerprint(document.before, 'before'),
      after: normalizeChangeLogFingerprint(document.after, 'after'),
    }
  }
  return { changes }
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

  private readonly statusItems = {
    offset: vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      106
    ),
    pane: vscode.window.createStatusBarItem(
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
      'extensionUri' | 'subscriptions'
    >
  ) {
    this.extensionContext?.subscriptions.push(
      this.statusItems.offset,
      this.statusItems.pane,
      this.statusItems.transforms,
      this.statusItems.dirty,
      this.statusItems.server
    )
    this.hideStatusBar()
  }

  private getViewportCapacity(bytesPerRow: number): number {
    const bufferedRows = Math.max(
      128,
      Math.ceil(VIEWPORT_BUFFER_BYTES / bytesPerRow)
    )
    return bufferedRows * bytesPerRow
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
    bytesPerRow: BytesPerRow
  ): string {
    const extensionUri = this.extensionContext?.extensionUri
    if (!extensionUri) {
      const message = escapeHtmlText(
        vscode.l10n.t('OmegaEdit webview unavailable.')
      )
      return `<!DOCTYPE html><html><body>${message}</body></html>`
    }

    return getSvelteWebviewContent(webview, extensionUri, bytesPerRow)
  }

  public async dispatchWebviewMessageForTesting(
    uri: vscode.Uri,
    msg: WebviewToHostMessage
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

    await this.handleWebviewMessage(session, msg)
  }

  public async undoActive(): Promise<void> {
    if (!this.activeSession) {
      return
    }
    await this.enqueueHistoryCommand(this.activeSession, 'undo', true)
  }

  public async redoActive(): Promise<void> {
    if (!this.activeSession) {
      return
    }
    await this.enqueueHistoryCommand(this.activeSession, 'redo', true)
  }

  public searchNextActive(): void {
    this.postSearchNavigationCommand('forward')
  }

  public searchPreviousActive(): void {
    this.postSearchNavigationCommand('backward')
  }

  public async refreshActiveTransformPlugins(): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }

    await this.sendTransformPlugins(this.activeSession)
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
    const bytesPerRow = normalizeBytesPerRow(config.get('bytesPerRow'))

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
      bytesPerRow
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
      bytesPerRow,
      filePath,
      panel: webviewPanel,
      document,
      scope,
      history: new EditorHistoryController(),
      search: new EditorSearchController(scope.sessionId),
      webviewState: initialWebviewState(bytesPerRow),
      externalHighlights: [],
      transformPlugins: [],
      transformInFlight: false,
      restoredFromBackup: wasRestoredFromBackup,
    }
    this.sessions.set(uri.toString(), session)
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
      if (this.activeSession === session) {
        this.activeSession = undefined
        this.updateEditCommandContexts(undefined)
      }
      this.stopHealthPollingIfIdle()
      await session.scope.dispose()
    })
  }

  // --- CustomEditorProvider required methods ---

  async saveCustomDocument(
    document: HexDocument,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    const session = this.sessions.get(document.uri.toString())
    if (!session) {
      return
    }
    await saveSessionOrThrow(
      session.sessionId,
      session.filePath,
      IOFlags.OVERWRITE
    )
    session.restoredFromBackup = false
    session.history.markSaved()
    this.postEditState(session)
  }

  async saveCustomDocumentAs(
    document: HexDocument,
    destination: vscode.Uri,
    _cancellation: vscode.CancellationToken
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
    await saveSessionOrThrow(
      session.sessionId,
      destination.fsPath,
      IOFlags.OVERWRITE
    )
    session.restoredFromBackup = false
    session.history.markSaved()
    this.postEditState(session)
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
        if (!context.stateChanged) {
          return
        }

        this.postWebviewMessage(session, {
          type: 'fileSizeChanged',
          fileSize: context.model.fileSize,
        })
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

    session.externalHighlights = highlights
    this.postExternalHighlights(session)

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

    session.externalHighlights = []
    this.postExternalHighlights(session)
    return this.buildEditorState(session)
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
  refreshBytesPerRow(): void {
    const config = vscode.workspace.getConfiguration('omegaEdit')
    const bytesPerRow = normalizeBytesPerRow(config.get('bytesPerRow'))
    for (const session of this.sessions.values()) {
      session.bytesPerRow = bytesPerRow
      session.webviewState = {
        ...session.webviewState,
        bytesPerRow,
      }
      session.panel.webview.options = {
        ...session.panel.webview.options,
        localResourceRoots: this.getLocalResourceRoots(),
      }
      session.panel.webview.html = this.renderWebviewHtml(
        session.panel.webview,
        bytesPerRow
      )
      session.capacity = this.getViewportCapacity(bytesPerRow)
      this.postTransformStatus(
        session,
        session.transformInFlight,
        undefined,
        session.transformInFlight
          ? transformMutationBlockedMessage()
          : undefined
      )
      this.sendViewportData(session)
      this.postEditState(session)
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
        session.bytesPerRow
      )
      this.postTransformStatus(
        session,
        session.transformInFlight,
        undefined,
        session.transformInFlight
          ? transformMutationBlockedMessage()
          : undefined
      )
      this.sendViewportData(session)
      this.postEditState(session)
    }
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

    let changeCount = sourceChangeCount
    let unavailableChangeSerials: number[] = []
    if (scriptUri.scheme === 'file') {
      const collected = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Exporting {count} change log entries…', {
            count: sourceChangeCount,
          }),
          cancellable: false,
        },
        async (progress) => {
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
                }
              ),
            async () =>
              await assertChangeLogExportStable(
                session.sessionId,
                sourceChangeCount,
                after
              )
          )
        }
      )
      unavailableChangeSerials = collected.unavailableChangeSerials
    } else {
      let changes: ChangeRecord[] = []
      if (sourceChangeCount > 0) {
        const collected = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('Exporting {count} change log entries…', {
              count: sourceChangeCount,
            }),
            cancellable: false,
          },
          async (progress) => {
            let previousSerial = 0
            return await collectChangeLogRecords(
              session.sessionId,
              sourceChangeCount,
              undefined,
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
              }
            )
          }
        )
        changes = collected.changes ?? []
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
            changes: changes.map(serializeChangeLogRecord),
          },
          null,
          2
        ),
        'utf8'
      )
      await vscode.workspace.fs.writeFile(scriptUri, content)
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

  async applyChangeLog(options?: unknown): Promise<
    | {
        state: WebviewEditorState
        uri?: vscode.Uri
        changeCount: number
        sourceChangeCount?: number
        cancelled?: boolean
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

    const scriptUri =
      parseCommandOptionUri(options, 'sourceUri') ??
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
        cancelled: true,
      }
    }

    const content = await vscode.workspace.fs.readFile(scriptUri)
    let parsed: ParsedChangeLog
    try {
      parsed = parseChangeLog(content)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.postSessionActionComplete(session, {
        action: 'applyChangeLog',
        changeCount: 0,
        cancelled: true,
        message,
      })
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Invalid OmegaEdit change log: {message}', {
          message,
        })
      )
      return {
        state: this.buildEditorState(session),
        uri: scriptUri,
        changeCount: 0,
        cancelled: true,
      }
    }
    const { changes } = parsed
    if (parsed.before) {
      await assertCurrentSessionFingerprint(
        session.sessionId,
        parsed.before,
        'before'
      )
    }

    let appliedChangeCount = 0
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Applying {count} change log entries…', {
          count: changes.length,
        }),
        cancellable: false,
      },
      async () => {
        appliedChangeCount = await this.applyChangeLogEntries(
          session,
          changes,
          parsed.after
        )
      }
    )
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
      sourceChangeCount: changes.length,
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

  async rollbackActiveSession(): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }
    if (!this.ensureSessionCanMutate(this.activeSession, true)) {
      return
    }

    await this.revertSessionChanges(this.activeSession, true)
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Rolled back OmegaEdit session')
    )
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
      isDirty: editState.isDirty || !!session.restoredFromBackup,
    })
    this.fireEditorStateChanged(session)
  }

  private postExternalHighlights(session: EditorSession): void {
    this.postWebviewMessage(session, {
      type: 'externalHighlights',
      highlights: session.externalHighlights,
    })
    this.fireEditorStateChanged(session)
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
        flags: plugin.flags,
      })),
      contentType: session.contentType,
      language: session.language,
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
    const offset = formatStatusOffset(state.visibleOffset, state.offsetRadix)
    this.statusItems.offset.text = `$(arrow-right) ${offset} ${visibleProgress}`
    this.statusItems.offset.tooltip = vscode.l10n.t(
      'Ωedit offset {offset}; visible bytes {start} to {end} of {size}.',
      {
        offset,
        start: formatStatusByteCount(state.visibleOffset),
        end: formatStatusByteCount(visibleEnd),
        size: formatStatusByteCount(session.fileSize),
      }
    )

    this.statusItems.pane.text =
      state.activePane === 'ascii'
        ? vscode.l10n.t('TEXT')
        : vscode.l10n.t('HEX')
    this.statusItems.pane.tooltip = vscode.l10n.t('Ωedit active edit pane')

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
    }
  }

  private async applyTransformToRange(
    session: EditorSession,
    pluginId: string,
    offset: number,
    length: number,
    optionsJson?: string
  ): Promise<void> {
    if (session.transformInFlight) {
      throw new Error('A transform is already in progress for this session')
    }

    this.postTransformStatus(
      session,
      true,
      pluginId,
      vscode.l10n.t('Applying transform...')
    )
    let failureMessage: string | undefined
    try {
      const clampedOffset = Math.max(0, Math.min(offset, session.fileSize))
      const remainingLength = Math.max(0, session.fileSize - clampedOffset)
      const originalLength =
        length === 0 ? remainingLength : Math.min(length, remainingLength)
      const sessionSyncVersion = session.sessionSyncVersion
      const computedFileSizeBefore = session.fileSize
      const response = await applyTransformPlugin(
        session.sessionId,
        pluginId,
        clampedOffset,
        originalLength,
        optionsJson
      )

      if (response.contentChanged) {
        if (response.serial === undefined) {
          throw new Error('Transform did not return a change serial')
        }
        session.history.recordLocalChange({
          serial: response.serial,
          kind: 'TRANSFORM',
          offset: response.offset,
          length: response.length,
          data: '',
          transformId: response.pluginId,
          ...(optionsJson !== undefined ? { optionsJson } : {}),
          replacementLength: response.replacementLength,
          computedFileSizeBefore,
          computedFileSizeAfter: response.computedFileSize,
        })
        this.postEditState(session)
        this.notifyDocumentChanged(session)
        await this.waitForSessionSync(session, sessionSyncVersion)
        this.clearSearchState(session)
      }

      await this.sendViewportData(session)

      this.postWebviewMessage(session, {
        type: 'transformComplete',
        pluginId: response.pluginId,
        offset: response.offset,
        length: response.length,
        operation: response.operation,
        contentChanged: response.contentChanged,
        replacementLength: response.replacementLength,
        computedFileSize: response.computedFileSize,
        resultLabel: response.resultLabel ?? '',
        resultMimeType: response.resultMimeType ?? '',
        resultText: transformResultToText(response.result),
      })
      void vscode.window.showInformationMessage(
        formatTransformCompletionMessage(response)
      )
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      this.postTransformStatus(session, false, pluginId, failureMessage)
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
        ? Buffer.from(bytes).toString('utf8')
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
        contentType: '',
        language: '',
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
    const contentTypeSampleLength = Math.min(session.fileSize, 16 * 1024)
    const [characterCount, contentType, language] = await Promise.all([
      countCharacters(session.sessionId, clampedOffset, clampedLength, bomName),
      getContentType(session.sessionId, 0, contentTypeSampleLength),
      getLanguage(session.sessionId, clampedOffset, clampedLength, bomName),
    ])
    if (
      session.pendingAnalysisProfile ||
      session.scope.isDisposed ||
      session.disposed
    ) {
      return
    }

    session.contentType = contentType.getContentType()
    session.language = language.getLanguage()

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
      contentType: session.contentType,
      language: session.language,
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

  private async resetSessionState(
    session: EditorSession,
    restoredFromBackup: boolean,
    markDirty: boolean,
    scrollToStart: boolean
  ): Promise<void> {
    session.history = new EditorHistoryController()
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

    const wasDirty =
      session.history.getEditState().isDirty || !!session.restoredFromBackup
    if (!wasDirty) {
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
    try {
      const sessionSyncVersion = session.sessionSyncVersion
      const count = await createCheckpoint(session.sessionId)
      await this.waitForSessionSync(session, sessionSyncVersion)
      await this.resetSessionState(session, wasDirty, false, false)
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
    markDirty: boolean
  ): Promise<boolean> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return false
    }

    const checkpointCount = await this.getCheckpointCount(session)
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
      await this.resetSessionState(session, markDirty, markDirty, false)
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
    markDirty: boolean
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

    const checkpointCount = await this.getCheckpointCount(session)
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
      await this.resetSessionState(session, markDirty, markDirty, false)
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
    markDirty: boolean
  ): Promise<void> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

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
      await this.resetSessionState(session, markDirty, markDirty, true)
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
    serverCpuLoadAverage?: number
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

      const uptimeSeconds = Math.max(
        0,
        Math.round(heartbeat.serverUptime / 1000)
      )
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
          vscode.l10n.t('{seconds}s', { seconds: uptimeSeconds })
        ),
        serverHealthMetric(
          'logicalCpus',
          vscode.l10n.t('Logical CPUs'),
          logicalCpuValue
        ),
      ]

      if (heartbeat.serverCpuLoadAverage !== undefined) {
        metrics.push(
          serverHealthMetric(
            'loadAverage',
            vscode.l10n.t('Load Avg'),
            heartbeat.serverCpuLoadAverage.toFixed(2)
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
    return {
      async undoLocal() {
        await undo(session.sessionId)
      },
      async redoLocal() {
        await redo(session.sessionId)
      },
      async undoCheckpoint() {
        await destroyLastCheckpoint(session.sessionId)
      },
      async redoCheckpoint(transaction) {
        const pattern = transaction.isHex
          ? Buffer.from(transaction.query, 'hex')
          : Buffer.from(transaction.query, 'utf8')
        await replaceSessionCheckpointed(
          session.sessionId,
          pattern,
          Buffer.from(transaction.data, 'hex'),
          transaction.caseInsensitive,
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
      await this.waitForSessionSync(session, sessionSyncVersion)
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
      await this.waitForSessionSync(session, sessionSyncVersion)
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
    this._onDidChangeCustomDocument.fire({
      document: session.document,
      undo: () => this.performUndoOnSession(session),
      redo: () => this.performRedoOnSession(session),
    })
  }

  private async applyChangeLogEntries(
    session: EditorSession,
    changes: ChangeRecord[],
    expectedAfter?: ChangeLogFingerprint
  ): Promise<number> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return 0
    }
    if (changes.length === 0 && !expectedAfter) {
      return 0
    }

    const startChangeCount = await getChangeCount(session.sessionId)
    const sessionSyncVersion = session.sessionSyncVersion
    const appliedChanges: ChangeRecord[] = []
    const recordAppliedChanges = async () => {
      if (appliedChanges.length === 0) {
        return
      }

      session.history.recordLocalChanges(appliedChanges)
      this.postEditState(session)
      this.notifyDocumentChanged(session)
      await this.waitForSessionSync(session, sessionSyncVersion)
      this.clearSearchState(session)
    }

    const applyOne = async (change: ChangeRecord) => {
      const appliedChange = await this.applyChangeLogEntry(session, change)
      if (appliedChange) {
        appliedChanges.push(appliedChange)
      }
    }
    let pendingBatch: ChangeRecord[] = []
    const flushBatch = async () => {
      if (pendingBatch.length === 0) {
        return
      }

      const batch = pendingBatch
      pendingBatch = []
      await runSessionTransaction(session.sessionId, async () => {
        for (const change of batch) {
          await applyOne(change)
        }
      })
    }

    try {
      if (changes.length > 0) {
        for (const change of changes) {
          if (change.kind === 'TRANSFORM') {
            await flushBatch()
            await applyOne(change)
          } else {
            pendingBatch.push(change)
          }
        }
        await flushBatch()
      }
      if (expectedAfter) {
        await assertCurrentSessionFingerprint(
          session.sessionId,
          expectedAfter,
          'after'
        )
      }
    } catch (error) {
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
      } catch (rollbackError) {
        throw changeLogApplyErrorWithRollbackFailure(error, rollbackError)
      }
      throw error
    }

    await recordAppliedChanges()
    return appliedChanges.length
  }

  private async applyChangeLogEntry(
    session: EditorSession,
    change: ChangeRecord
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
          data: '',
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
        if (!change.transformId) {
          throw new Error('Transform change is missing transformId')
        }

        const expectedSizeBefore =
          change.computedFileSizeBefore !== undefined
            ? normalizeNonNegativeInt64ForClient(
                change.computedFileSizeBefore,
                'change log entry computedFileSizeBefore'
              )
            : undefined
        const actualSizeBefore = await getComputedFileSize(session.sessionId)
        if (
          expectedSizeBefore !== undefined &&
          actualSizeBefore !== expectedSizeBefore
        ) {
          throw new Error(
            `Transform ${change.transformId} expected pre-transform size ${expectedSizeBefore}, found ${actualSizeBefore}`
          )
        }

        const response = await applyTransformPlugin(
          session.sessionId,
          change.transformId,
          change.offset,
          change.length,
          change.optionsJson
        )
        if (!response.contentChanged) {
          throw new Error(
            `Transform ${change.transformId} replay produced no content change`
          )
        }
        if (response.serial === undefined) {
          throw new Error('Transform did not return a change serial')
        }
        if (
          change.replacementLength !== undefined &&
          response.replacementLength !==
            normalizeNonNegativeInt64ForClient(
              change.replacementLength,
              'change log entry replacementLength'
            )
        ) {
          throw new Error(
            `Transform ${change.transformId} replacement length mismatch`
          )
        }
        if (
          change.computedFileSizeAfter !== undefined &&
          response.computedFileSize !==
            normalizeNonNegativeInt64ForClient(
              change.computedFileSizeAfter,
              'change log entry computedFileSizeAfter'
            )
        ) {
          throw new Error(
            `Transform ${change.transformId} post-transform size mismatch`
          )
        }

        return {
          serial: response.serial,
          kind: 'TRANSFORM',
          offset: response.offset,
          length: response.length,
          data: '',
          transformId: response.pluginId,
          ...(change.optionsJson !== undefined
            ? { optionsJson: change.optionsJson }
            : {}),
          replacementLength: response.replacementLength,
          computedFileSizeBefore: actualSizeBefore,
          computedFileSizeAfter: response.computedFileSize,
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
    rawMessage: unknown
  ): Promise<void> {
    const msg = normalizeWebviewMessage(
      { fileSize: session.fileSize },
      rawMessage
    )
    if (!msg || session.scope.isDisposed || session.disposed) {
      return
    }

    if (session.transformInFlight && isMutationWebviewMessage(msg)) {
      this.postTransformStatus(
        session,
        true,
        undefined,
        transformMutationBlockedMessage()
      )
      return
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
              await configuration.update('bytesPerRow', msg.bytesPerRow, target)
              updated = true
              break
            } catch (err) {
              lastError = err
            }
          }

          if (!updated && lastError) {
            throw lastError
          }
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

        case 'applyChangeLog': {
          await this.applyChangeLog({ uri: session.document.uri })
          break
        }

        case 'replaceAllMatches': {
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
                caseInsensitive: msg.caseInsensitive ?? false,
                isReverse: msg.isReverse ?? false,
                length: msg.length,
                replacement: Buffer.from(msg.data, 'hex'),
                replacementData: msg.data,
              })

              if (result.replacedCount > 0) {
                if (
                  result.strategy === 'checkpointed' &&
                  result.checkpointTransaction
                ) {
                  session.history.recordCheckpointReplaceAll(
                    result.checkpointTransaction
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
          await session.search.preserveState(async () => {
            await this.applyTransformToRange(
              session,
              msg.pluginId,
              msg.offset,
              msg.length,
              msg.optionsJson?.trim() || undefined
            )
          })
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
          const result = await session.search.search({
            query: msg.query,
            isHex: msg.isHex,
            caseInsensitive: msg.caseInsensitive ?? false,
            isReverse: msg.isReverse ?? false,
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
          const navigation = await session.search.findAdjacent({
            query: msg.query,
            isHex: msg.isHex,
            caseInsensitive: msg.caseInsensitive ?? false,
            direction: msg.direction,
            anchorOffset: msg.offset,
            fileSize: session.fileSize,
          })
          this.postWebviewMessage(session, {
            type: 'searchNavigationResult',
            offset: navigation.offset,
            patternLength: navigation.patternLength,
          })
          if (navigation.offset >= 0) {
            await this.scrollTo(session, navigation.offset)
          }
          break
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      void vscode.window.showErrorMessage(omegaEditErrorMessage(message))
    }
  }
}
