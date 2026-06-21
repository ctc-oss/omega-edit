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
  getClientVersion,
  getContentType,
  getCounts,
  getLanguage,
  getSegment,
  getServerInfo,
  getViewportData,
  IOFlags,
  type IServerInfo,
  insert,
  listTransformPlugins,
  modifyViewport,
  numAscii,
  overwrite,
  profileSession,
  replaceSessionCheckpointed,
  redo,
  saveSession,
  SessionEventKind,
  startServerHeartbeatLoop,
  type TransformProgress,
  type TransformPluginInfo,
  type ServerHeartbeatLoop,
  undo,
  ViewportEventKind,
} from '@omega-edit/client'
import * as vscode from 'vscode'
import { OMEGA_EDIT_VIEW_TYPE } from './constants'
import {
  getSvelteWebviewContent,
  getSvelteWebviewLocalResourceRoot,
} from './svelteWebview'
import {
  MAX_ANALYSIS_PROFILE_BYTES,
  MAX_LABEL_LENGTH,
  MAX_WEBVIEW_HEX_BYTES,
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

const SESSION_SYNC_TIMEOUT_MS = 2000
const VIEWPORT_BUFFER_BYTES = 8 * 1024
const SERVER_HEALTH_WARN_LATENCY_MS = 75
const SERVER_HEALTH_ERROR_LATENCY_MS = 250
const MAX_TRANSFORM_RESULT_TEXT_LENGTH = 240
const MAX_TRANSFORM_RESULT_PREVIEW_BYTES = 4 * 1024
const MAX_TRANSFORM_NOOP_COMPARE_BYTES = 1024 * 1024
const MAX_CHANGE_SCRIPT_BYTES = 32 * 1024 * 1024
const MAX_CHANGE_SCRIPT_ENTRIES = 100_000
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

function transformMutationBlockedMessage(): string {
  return vscode.l10n.t('Transform in progress; edits are disabled.')
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
    case 'replaceAllMatches':
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

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    Buffer.from(left).equals(Buffer.from(right))
  )
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

function safeChangeRecord(value: unknown): ChangeRecord | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const offset = safeNonNegativeInteger(value.offset)
  if (offset === undefined) {
    return undefined
  }
  const serial = safeNonNegativeInteger(value.serial) ?? 0

  switch (value.kind) {
    case 'INSERT': {
      const data = safeHexString(value.data, MAX_WEBVIEW_HEX_BYTES)
      return data
        ? { serial, kind: 'INSERT', offset, length: 0, data }
        : undefined
    }
    case 'DELETE': {
      const length = safeNonNegativeInteger(value.length)
      return length && length > 0
        ? { serial, kind: 'DELETE', offset, length, data: '' }
        : undefined
    }
    case 'OVERWRITE': {
      const data = safeHexString(value.data, MAX_WEBVIEW_HEX_BYTES)
      return data
        ? {
            serial,
            kind: 'OVERWRITE',
            offset,
            length: data.length / 2,
            data,
          }
        : undefined
    }
    case 'REPLACE': {
      const length = safeNonNegativeInteger(value.length)
      const data = safeHexString(value.data, MAX_WEBVIEW_HEX_BYTES, true)
      const groupId = safeString(value.groupId, MAX_LABEL_LENGTH)
      if (length === undefined || data === undefined) {
        return undefined
      }
      return groupId
        ? { serial, kind: 'REPLACE', offset, length, data, groupId }
        : { serial, kind: 'REPLACE', offset, length, data }
    }
    default:
      return undefined
  }
}

function parseChangeScript(content: Uint8Array): ChangeRecord[] {
  if (content.byteLength > MAX_CHANGE_SCRIPT_BYTES) {
    throw new Error(
      `Change script is too large (${content.byteLength.toLocaleString()} bytes)`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(content))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid change script JSON: ${message}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Change script must be a JSON array')
  }
  if (parsed.length > MAX_CHANGE_SCRIPT_ENTRIES) {
    throw new Error(
      `Change script has too many entries (${parsed.length.toLocaleString()})`
    )
  }

  return parsed.map((entry, index) => {
    const change = safeChangeRecord(entry)
    if (!change) {
      throw new Error(`Invalid change record at index ${index}`)
    }
    return change
  })
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
    if (!this.ensureSessionCanMutate(this.activeSession, true)) {
      return
    }
    await vscode.commands.executeCommand('undo')
  }

  public async redoActive(): Promise<void> {
    if (!this.activeSession) {
      return
    }
    if (!this.ensureSessionCanMutate(this.activeSession, true)) {
      return
    }
    await vscode.commands.executeCommand('redo')
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

    // --- Create a viewport starting at offset 0 ---
    // If VS Code supplies a backup id (crash-recovery), open from the backup so
    // unsaved edits are restored; save still targets the original filePath.
    const backupFilePath = backupIdToFilePath(document.backupId)
    const wasRestoredFromBackup = !!backupFilePath
    const restoreFromPath = backupFilePath ?? filePath
    document.backupId = undefined // consume – do not re-use on subsequent resolves

    const scope = await ScopedEditorSessionHandle.openFile(restoreFromPath, {
      filePath: restoreFromPath,
      capacity,
    })

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
    this.activeSession = session
    this.updateEditCommandContexts(session)

    // --- Configure the webview ---
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalResourceRoots(),
    }
    webviewPanel.webview.html = this.renderWebviewHtml(
      webviewPanel.webview,
      bytesPerRow
    )

    // --- Handle messages FROM the webview ---
    const panelDisposables: vscode.Disposable[] = []

    webviewPanel.webview.onDidReceiveMessage(
      (msg) => this.handleWebviewMessage(session, msg),
      undefined,
      panelDisposables
    )

    // Send initial data to the webview. The message listener must be in place
    // first because the webview posts its first metrics update as soon as it
    // mounts, and that update is also our reliable ready-to-render signal.
    await this.sendViewportData(session)
    this.postEditState(session)
    this.postEditMode(session)
    this.startHealthPolling()

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
      if (this.sessions.size === 0) {
        this.stopHealthPolling()
      }
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
    await saveSession(session.sessionId, session.filePath, IOFlags.OVERWRITE)
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
    await saveSession(session.sessionId, destination.fsPath, IOFlags.OVERWRITE)
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
      await saveSession(
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
          kind === ViewportEventKind.MODIFY
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
      this.sendViewportData(session)
      this.postEditState(session)
    }
  }

  async exportActiveChangeScript(targetUri?: vscode.Uri): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }

    const session = this.activeSession
    const scriptUri =
      targetUri ??
      (await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          `${session.filePath}.omega-edit-changes.json`
        ),
        filters: { JSON: ['json'] },
      }))

    if (!scriptUri) {
      return
    }

    const content = Buffer.from(
      JSON.stringify(session.history.getChangeLog(), null, 2),
      'utf8'
    )
    await vscode.workspace.fs.writeFile(scriptUri, content)
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Change script saved to {path}', {
        path: scriptUri.fsPath,
      })
    )
  }

  async replayActiveChangeScript(sourceUri?: vscode.Uri): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }
    const session = this.activeSession
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

    const scriptUri =
      sourceUri ??
      (
        await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { JSON: ['json'] },
        })
      )?.[0]

    if (!scriptUri) {
      return
    }

    const content = await vscode.workspace.fs.readFile(scriptUri)
    let changes: ChangeRecord[]
    try {
      changes = parseChangeScript(content)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Invalid OmegaEdit change script: {message}', {
          message,
        })
      )
      return
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Replaying {count} change(s)…', {
          count: changes.length,
        }),
        cancellable: false,
      },
      () => this.replayChanges(session, changes)
    )
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Replayed {count} change(s)', { count: changes.length })
    )
  }

  async createActiveCheckpoint(): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }
    if (!this.ensureSessionCanMutate(this.activeSession, true)) {
      return
    }

    const count = await this.createSessionCheckpoint(this.activeSession)
    void vscode.window.showInformationMessage(
      vscode.l10n.t('OmegaEdit checkpoint created ({count} total)', { count })
    )
  }

  async rollbackActiveCheckpoint(): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage(openEditorFirstMessage())
      return
    }
    if (!this.ensureSessionCanMutate(this.activeSession, true)) {
      return
    }

    const rolledBack = await this.rollbackCheckpoint(this.activeSession, true)
    if (rolledBack) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Rolled back last OmegaEdit checkpoint')
      )
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
      const response = await applyTransformPlugin(
        session.sessionId,
        pluginId,
        clampedOffset,
        originalLength,
        optionsJson
      )

      let contentChanged = response.contentChanged
      if (response.contentChanged) {
        const canCompareNoOp =
          response.offset === clampedOffset &&
          response.length === originalLength &&
          originalLength <= MAX_TRANSFORM_NOOP_COMPARE_BYTES &&
          response.replacementLength <= MAX_TRANSFORM_NOOP_COMPARE_BYTES
        const originalBytes =
          canCompareNoOp && originalLength > 0
            ? await getSegment(session.sessionId, clampedOffset, originalLength)
            : new Uint8Array()
        const replacement =
          canCompareNoOp && response.replacementLength > 0
            ? await getSegment(
                session.sessionId,
                response.offset,
                response.replacementLength
              )
            : new Uint8Array()
        const isNoOpReplace =
          canCompareNoOp && bytesEqual(originalBytes, replacement)

        if (isNoOpReplace) {
          await this.waitForSessionSync(session, sessionSyncVersion)
          const undoSyncVersion = session.sessionSyncVersion
          await undo(session.sessionId)
          await this.waitForSessionSync(session, undoSyncVersion)
          contentChanged = false
        } else {
          session.history.recordLocalChange({
            serial: session.history.getChangeLog().length + 1,
            kind: 'REPLACE',
            offset: response.offset,
            length: response.length,
            data:
              replacement.byteLength > 0
                ? Buffer.from(replacement).toString('hex')
                : '',
          })
          this.postEditState(session)
          this.notifyDocumentChanged(session)
          await this.waitForSessionSync(session, sessionSyncVersion)
          this.clearSearchState(session)
        }
      }

      this.postWebviewMessage(session, {
        type: 'transformComplete',
        pluginId: response.pluginId,
        offset: response.offset,
        length: response.length,
        operation: response.operation,
        contentChanged,
        replacementLength: response.replacementLength,
        computedFileSize: response.computedFileSize,
        resultLabel: response.resultLabel ?? '',
        resultMimeType: response.resultMimeType ?? '',
        resultText: transformResultToText(response.result),
      })
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
  ): Promise<number> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return this.getCheckpointCount(session)
    }

    const wasDirty =
      session.history.getEditState().isDirty || !!session.restoredFromBackup
    const sessionSyncVersion = session.sessionSyncVersion
    const count = await createCheckpoint(session.sessionId)
    await this.waitForSessionSync(session, sessionSyncVersion)
    await this.resetSessionState(session, wasDirty, false, false)
    return count
  }

  private async rollbackCheckpoint(
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

    const sessionSyncVersion = session.sessionSyncVersion
    await destroyLastCheckpoint(session.sessionId)
    await this.waitForSessionSync(session, sessionSyncVersion)
    await this.resetSessionState(session, markDirty, markDirty, false)
    return true
  }

  private async rollbackSession(
    session: EditorSession,
    markDirty: boolean
  ): Promise<void> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

    const sessionSyncVersion = session.sessionSyncVersion
    let checkpointCount = await this.getCheckpointCount(session)
    while (checkpointCount > 0) {
      await destroyLastCheckpoint(session.sessionId)
      checkpointCount -= 1
    }
    await clear(session.sessionId)
    await this.waitForSessionSync(session, sessionSyncVersion)
    await this.resetSessionState(session, markDirty, markDirty, true)
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
    if (this.sessions.size === 0) {
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

  private notifyDocumentChanged(session: EditorSession): void {
    this._onDidChangeCustomDocument.fire({
      document: session.document,
      undo: () => this.performUndoOnSession(session),
      redo: () => this.performRedoOnSession(session),
    })
  }

  private async replayChanges(
    session: EditorSession,
    changes: ChangeRecord[]
  ): Promise<void> {
    if (!this.ensureSessionCanMutate(session, true)) {
      return
    }

    for (const change of changes) {
      const sessionSyncVersion = session.sessionSyncVersion
      let shouldWaitForSync = true
      switch (change.kind) {
        case 'INSERT': {
          const serial = await insert(
            session.sessionId,
            change.offset,
            Buffer.from(change.data, 'hex')
          )
          session.history.recordLocalChange({
            serial,
            kind: 'INSERT',
            offset: change.offset,
            length: 0,
            data: change.data,
          })
          this.postEditState(session)
          this.notifyDocumentChanged(session)
          break
        }
        case 'DELETE': {
          const serial = await del(
            session.sessionId,
            change.offset,
            change.length
          )
          session.history.recordLocalChange({
            serial,
            kind: 'DELETE',
            offset: change.offset,
            length: change.length,
            data: '',
          })
          this.postEditState(session)
          this.notifyDocumentChanged(session)
          break
        }
        case 'OVERWRITE': {
          const buf = Buffer.from(change.data, 'hex')
          const serial = await overwrite(session.sessionId, change.offset, buf)
          session.history.recordLocalChange({
            serial,
            kind: 'OVERWRITE',
            offset: change.offset,
            length: buf.length,
            data: change.data,
          })
          this.postEditState(session)
          this.notifyDocumentChanged(session)
          break
        }
        case 'REPLACE':
          shouldWaitForSync = await this.applyReplace(
            session,
            change.offset,
            change.length,
            change.data,
            change.groupId
          )
          break
      }
      if (shouldWaitForSync) {
        await this.waitForSessionSync(session, sessionSyncVersion)
      }
    }
  }

  private async applyReplace(
    session: EditorSession,
    offset: number,
    length: number,
    dataHex: string,
    groupId?: string
  ): Promise<boolean> {
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

    if (changeSerial > 0) {
      session.history.recordLocalChange({
        serial: changeSerial,
        kind: 'REPLACE',
        offset,
        length,
        data: dataHex,
        groupId,
      })
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
        vscode.l10n.t('Transform in progress; edits are disabled.')
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

        case 'replaceAllMatches': {
          const sessionSyncVersion = session.sessionSyncVersion
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
          await vscode.commands.executeCommand('undo')
          break
        }

        case 'redo': {
          await vscode.commands.executeCommand('redo')
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
