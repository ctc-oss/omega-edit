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
 * Î©editâ„¢ Hex Editor â€” Custom Editor Provider
 *
 * This is the core integration point between VS Code's custom editor API and
 * the Î©editâ„¢ editing engine. It demonstrates:
 *
 *   - Creating an Î©editâ„¢ session for each opened file
 *   - Creating a viewport that tracks the visible region
 *   - Subscribing to viewport events so the webview updates live
 *   - Handling insert / delete / overwrite edits from the webview
 *   - Undo / redo wired through VS Code's built-in command palette
 *   - Search within the file
 *   - Saving via Î©editâ„¢'s server-side replay
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
  startServerHeartbeatLoop,
  type TransformPluginInfo,
  type ServerHeartbeatLoop,
  undo,
  ViewportEventKind,
} from '@omega-edit/client'
import * as vscode from 'vscode'
import { OMEGA_EDIT_VIEW_TYPE } from './constants'
import { getWebviewContent } from './webview'

interface EditorSession {
  readonly sessionId: string
  readonly viewportId: string
  readonly fileSize: number
  readonly changeCount: number
  readonly sessionSyncVersion: number
  offset: number
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
}

interface AnalysisProfileRequest {
  offset: number
  length: number
  requestKey: string
  scopeLabel: string
  requestedLength: number
  isCapped: boolean
}

interface ServerHealthState {
  type: 'serverHealth'
  ok: boolean
  summary: string
  detail: string
  severity: 'ok' | 'warn' | 'error' | 'down'
  metrics: Array<{ label: string; value: string }>
}

const SESSION_SYNC_TIMEOUT_MS = 2000
const VIEWPORT_BUFFER_BYTES = 8 * 1024
const SERVER_HEALTH_WARN_LATENCY_MS = 75
const SERVER_HEALTH_ERROR_LATENCY_MS = 250
const MAX_TRANSFORM_RESULT_TEXT_LENGTH = 240
const MAX_TRANSFORM_RESULT_PREVIEW_BYTES = 4 * 1024
const MAX_WEBVIEW_HEX_BYTES = 16 * 1024 * 1024
const MAX_SEARCH_QUERY_LENGTH = 1024 * 1024
const MAX_TRANSFORM_OPTIONS_LENGTH = 256 * 1024
const MAX_ANALYSIS_PROFILE_BYTES = 64 * 1024
const MAX_CHANGE_SCRIPT_BYTES = 32 * 1024 * 1024
const MAX_CHANGE_SCRIPT_ENTRIES = 100_000
const MAX_LABEL_LENGTH = 128
const VALID_BYTES_PER_ROW = [8, 16, 32] as const
const DEFAULT_BYTES_PER_ROW = 16
const CONTEXT_HEX_EDITOR_ACTIVE = 'omegaEdit.hexEditorActive'
const CONTEXT_CAN_UNDO = 'omegaEdit.canUndo'
const CONTEXT_CAN_REDO = 'omegaEdit.canRedo'
const CONTEXT_HAS_PENDING_CHANGES = 'omegaEdit.hasPendingChanges'

type BytesPerRow = (typeof VALID_BYTES_PER_ROW)[number]

function normalizeBytesPerRow(value: unknown): BytesPerRow {
  return VALID_BYTES_PER_ROW.includes(value as BytesPerRow)
    ? (value as BytesPerRow)
    : DEFAULT_BYTES_PER_ROW
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

function safeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
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

function safeJsonString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value.trim()
  if (text.length === 0) {
    return undefined
  }
  if (text.length > maxLength) {
    return undefined
  }
  try {
    JSON.parse(text)
  } catch {
    return undefined
  }
  return text
}

function safeFileLengthRange(
  session: EditorSession,
  offsetValue: unknown,
  lengthValue: unknown,
  allowZeroLength = false,
  maxLength = Number.MAX_SAFE_INTEGER
): { offset: number; length: number } | undefined {
  const offset = safeNonNegativeInteger(offsetValue)
  const length = safeNonNegativeInteger(lengthValue, maxLength)
  if (offset === undefined || length === undefined) {
    return undefined
  }
  if ((!allowZeroLength && length === 0) || offset > session.fileSize) {
    return undefined
  }
  if (length > Math.max(0, session.fileSize - offset)) {
    return undefined
  }
  return { offset, length }
}

function safeSearchQuery(message: Record<string, unknown>): string | undefined {
  const isHex = message.isHex === true
  return isHex
    ? safeHexString(message.query, MAX_SEARCH_QUERY_LENGTH, false)
    : safeString(message.query, MAX_SEARCH_QUERY_LENGTH)
}

function classifyServerHealthLatency(
  latencyMs: number
): ServerHealthState['severity'] {
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

function normalizeWebviewMessage(
  session: EditorSession,
  raw: unknown
): WebviewMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return undefined
  }

  switch (raw.type) {
    case 'scroll':
      return raw.direction === 'up' || raw.direction === 'down'
        ? { type: 'scroll', direction: raw.direction }
        : undefined

    case 'scrollTo': {
      const offset = safeNonNegativeInteger(raw.offset)
      return offset === undefined ? undefined : { type: 'scrollTo', offset }
    }

    case 'setViewportMetrics': {
      const visibleRows = safeNonNegativeInteger(raw.visibleRows, 100_000)
      return visibleRows === undefined
        ? undefined
        : { type: 'setViewportMetrics', visibleRows }
    }

    case 'setBytesPerRow': {
      const bytesPerRow = normalizeBytesPerRow(raw.bytesPerRow)
      return raw.bytesPerRow === bytesPerRow
        ? { type: 'setBytesPerRow', bytesPerRow }
        : undefined
    }

    case 'requestAnalysisProfile': {
      const offset = safeNonNegativeInteger(raw.offset)
      const length = safeNonNegativeInteger(raw.length)
      const requestedLength = safeNonNegativeInteger(raw.requestedLength)
      const requestKey = safeString(raw.requestKey, MAX_LABEL_LENGTH)
      const scopeLabel = safeString(raw.scopeLabel, MAX_LABEL_LENGTH)
      if (
        offset === undefined ||
        length === undefined ||
        requestedLength === undefined ||
        !requestKey ||
        !scopeLabel
      ) {
        return undefined
      }
      return {
        type: 'requestAnalysisProfile',
        offset,
        length: Math.min(length, MAX_ANALYSIS_PROFILE_BYTES),
        requestKey,
        scopeLabel,
        requestedLength,
        isCapped: safeBoolean(raw.isCapped),
      }
    }

    case 'requestTransformPlugins':
    case 'undo':
    case 'redo':
    case 'save':
    case 'saveAs':
    case 'revert':
      return { type: raw.type }

    case 'copySelection':
    case 'cutSelection': {
      const range = safeFileLengthRange(
        session,
        raw.offset,
        raw.length,
        false,
        MAX_WEBVIEW_HEX_BYTES
      )
      if (!range || (raw.format !== 'hex' && raw.format !== 'utf8')) {
        return undefined
      }
      return {
        type: raw.type,
        ...range,
        format: raw.format,
      }
    }

    case 'insert': {
      const offset = safeNonNegativeInteger(raw.offset)
      const data = safeHexString(raw.data, MAX_WEBVIEW_HEX_BYTES)
      if (offset === undefined || offset > session.fileSize || !data) {
        return undefined
      }
      return { type: 'insert', offset, data }
    }

    case 'delete': {
      const range = safeFileLengthRange(session, raw.offset, raw.length)
      return range ? { type: 'delete', ...range } : undefined
    }

    case 'overwrite': {
      const offset = safeNonNegativeInteger(raw.offset)
      const data = safeHexString(raw.data, MAX_WEBVIEW_HEX_BYTES)
      if (
        offset === undefined ||
        !data ||
        offset >= session.fileSize ||
        data.length / 2 > Math.max(0, session.fileSize - offset)
      ) {
        return undefined
      }
      return { type: 'overwrite', offset, data }
    }

    case 'replace': {
      const range = safeFileLengthRange(session, raw.offset, raw.length, true)
      const data = safeHexString(raw.data, MAX_WEBVIEW_HEX_BYTES, true)
      return range && data !== undefined
        ? { type: 'replace', ...range, data }
        : undefined
    }

    case 'replaceAllMatches': {
      const query = safeSearchQuery(raw)
      const data = safeHexString(raw.data, MAX_WEBVIEW_HEX_BYTES, true)
      const length = safeNonNegativeInteger(raw.length)
      if (!query || data === undefined || !length) {
        return undefined
      }
      return {
        type: 'replaceAllMatches',
        query,
        isHex: raw.isHex === true,
        caseInsensitive: safeBoolean(raw.caseInsensitive),
        isReverse: safeBoolean(raw.isReverse),
        length,
        data,
      }
    }

    case 'applyTransform': {
      const pluginId = safeString(raw.pluginId, MAX_LABEL_LENGTH)
      const offset = safeNonNegativeInteger(raw.offset)
      const length = safeNonNegativeInteger(raw.length)
      const optionsJson =
        raw.optionsJson === undefined
          ? undefined
          : safeJsonString(raw.optionsJson, MAX_TRANSFORM_OPTIONS_LENGTH)
      if (
        !pluginId ||
        offset === undefined ||
        length === undefined ||
        (raw.optionsJson !== undefined && optionsJson === undefined)
      ) {
        return undefined
      }
      return { type: 'applyTransform', pluginId, offset, length, optionsJson }
    }

    case 'search': {
      const query = safeSearchQuery(raw)
      if (!query) {
        return undefined
      }
      return {
        type: 'search',
        query,
        isHex: raw.isHex === true,
        caseInsensitive: safeBoolean(raw.caseInsensitive),
        isReverse: safeBoolean(raw.isReverse),
      }
    }

    case 'goToMatch': {
      const offset = safeNonNegativeInteger(raw.offset)
      return offset === undefined ? undefined : { type: 'goToMatch', offset }
    }

    case 'findAdjacentMatch': {
      const query = safeSearchQuery(raw)
      const offset = safeNonNegativeInteger(raw.offset)
      if (
        !query ||
        offset === undefined ||
        (raw.direction !== 'forward' && raw.direction !== 'backward')
      ) {
        return undefined
      }
      return {
        type: 'findAdjacentMatch',
        query,
        isHex: raw.isHex === true,
        caseInsensitive: safeBoolean(raw.caseInsensitive),
        direction: raw.direction,
        offset,
      }
    }

    default:
      return undefined
  }
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
 * Represents a single file opened by the Hex Editor. VS Code tracks dirty
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

  /** Active editor sessions keyed by document URI string */
  private sessions = new Map<string, EditorSession>()

  /** The editor that last had focus (for goToOffset command routing) */
  private activeSession: EditorSession | undefined

  private heartbeatLoop: ServerHeartbeatLoop | undefined

  private serverInfo: IServerInfo | undefined

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

  public async dispatchWebviewMessageForTesting(
    uri: vscode.Uri,
    msg: WebviewMessage
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
        await this.performUndoOnSession(session)
        return
      case 'redo':
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
    await vscode.commands.executeCommand('undo')
  }

  public async redoActive(): Promise<void> {
    if (!this.activeSession) {
      return
    }
    await vscode.commands.executeCommand('redo')
  }

  // â”€â”€ VS Code Custom Editor API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      throw new Error('OmegaEdit Hex Editor can only open local files')
    }
    const filePath = uri.fsPath

    // --- Create Î©editâ„¢ session for this file ---
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
      visibleRows: 32,
      capacity,
      bytesPerRow,
      filePath,
      panel: webviewPanel,
      document,
      scope,
      history: new EditorHistoryController(),
      search: new EditorSearchController(scope.sessionId),
      restoredFromBackup: wasRestoredFromBackup,
    }
    this.sessions.set(uri.toString(), session)
    this.activeSession = session
    this.updateEditCommandContexts(session)

    // --- Configure the webview ---
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    }
    webviewPanel.webview.html = getWebviewContent(
      bytesPerRow,
      webviewPanel.webview.cspSource
    )

    // Send initial data to the webview
    await this.sendViewportData(session)
    this.postEditState(session)
    this.startHealthPolling()

    await this.startSessionSubscriptions(session)

    // --- Handle messages FROM the webview ---
    const panelDisposables: vscode.Disposable[] = []

    webviewPanel.webview.onDidReceiveMessage(
      (msg) => this.handleWebviewMessage(session, msg),
      undefined,
      panelDisposables
    )

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

  // â"€â"€ CustomEditorProvider required methods â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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
      throw new Error('OmegaEdit Hex Editor can only save to local files')
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

    await this.rollbackSession(session, false)
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
      onSessionEvent: async (_event, context) => {
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

  // â”€â”€ Public methods called from extension.ts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Navigate the active editor to a byte offset */
  goToOffset(offset: number): void {
    if (this.activeSession) {
      this.scrollTo(this.activeSession, offset)
    }
  }

  /** Re-read bytesPerRow from config and refresh all open editors */
  refreshBytesPerRow(): void {
    const config = vscode.workspace.getConfiguration('omegaEdit')
    const bytesPerRow = normalizeBytesPerRow(config.get('bytesPerRow'))
    for (const session of this.sessions.values()) {
      session.bytesPerRow = bytesPerRow
      session.panel.webview.html = getWebviewContent(
        bytesPerRow,
        session.panel.webview.cspSource
      )
      session.capacity = this.getViewportCapacity(bytesPerRow)
      this.sendViewportData(session)
      this.postEditState(session)
    }
  }

  async exportActiveChangeScript(targetUri?: vscode.Uri): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage('Open an OmegaEdit editor first')
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
      `Change script saved to ${scriptUri.fsPath}`
    )
  }

  async replayActiveChangeScript(sourceUri?: vscode.Uri): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage('Open an OmegaEdit editor first')
      return
    }
    const session = this.activeSession

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
        `Invalid OmegaEdit change script: ${message}`
      )
      return
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Replaying ${changes.length} change(s)…`,
        cancellable: false,
      },
      () => this.replayChanges(session, changes)
    )
    void vscode.window.showInformationMessage(
      `Replayed ${changes.length} change(s)`
    )
  }

  async createActiveCheckpoint(): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage('Open an OmegaEdit editor first')
      return
    }

    const count = await this.createSessionCheckpoint(this.activeSession)
    void vscode.window.showInformationMessage(
      `OmegaEdit checkpoint created (${count} total)`
    )
  }

  async rollbackActiveCheckpoint(): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage('Open an OmegaEdit editor first')
      return
    }

    const rolledBack = await this.rollbackCheckpoint(this.activeSession, true)
    if (rolledBack) {
      void vscode.window.showInformationMessage(
        'Rolled back last OmegaEdit checkpoint'
      )
    }
  }

  async rollbackActiveSession(): Promise<void> {
    if (!this.activeSession) {
      void vscode.window.showWarningMessage('Open an OmegaEdit editor first')
      return
    }

    await this.rollbackSession(this.activeSession, true)
    void vscode.window.showInformationMessage('Rolled back OmegaEdit session')
  }

  // â”€â”€ Event Subscriptions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Subscribe to Î©editâ„¢ viewport events. When edits change data visible in
   * the viewport, the server streams an event and we push fresh data to the
   * webview. This is the reactive data flow at the heart of Î©editâ„¢.
   */

  // â”€â”€ Viewport Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private postWebviewMessage(session: EditorSession, message: unknown): void {
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
    this.postWebviewMessage(session, {
      type: 'viewportData',
      offset: resp.getOffset(),
      visibleOffset: session.offset,
      data: Array.from(data),
      length: resp.getLength(),
      fileSize: session.fileSize,
      followingByteCount: resp.getFollowingByteCount(),
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
      !!session && (!!editState?.isDirty || !!session.restoredFromBackup)
    )
  }

  private async sendTransformPlugins(session: EditorSession): Promise<void> {
    try {
      const plugins = await listTransformPlugins()
      this.postWebviewMessage(session, {
        type: 'transformPlugins',
        plugins: plugins.map(serializeTransformPlugin),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
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
    const clampedOffset = Math.max(0, Math.min(offset, session.fileSize))
    const remainingLength = Math.max(0, session.fileSize - clampedOffset)
    const originalLength =
      length === 0 ? remainingLength : Math.min(length, remainingLength)
    const originalBytes =
      originalLength > 0
        ? await getSegment(session.sessionId, clampedOffset, originalLength)
        : new Uint8Array()
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
      const replacement =
        response.replacementLength > 0
          ? await getSegment(
              session.sessionId,
              response.offset,
              response.replacementLength
            )
          : new Uint8Array()
      const isNoOpReplace =
        response.offset === clampedOffset &&
        response.length === originalLength &&
        bytesEqual(originalBytes, replacement)

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
          data: Buffer.from(replacement).toString('hex'),
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
      contentType: contentType.getContentType(),
      language: language.getLanguage(),
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
          void vscode.window.showErrorMessage(`OmegaEdit error: ${message}`)
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
    const checkpointCount = await this.getCheckpointCount(session)
    if (checkpointCount <= 0) {
      void vscode.window.showWarningMessage(
        'No OmegaEdit checkpoint to roll back'
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
      intervalMs: 5000,
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
          summary: 'Ωedit™ unavailable',
          detail: error.message,
          severity: 'down',
          metrics: [{ label: 'Error', value: error.message }],
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
        bytes === undefined ? 'n/a' : `${Math.round(bytes / (1024 * 1024))} MiB`
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
      const metrics = [
        { label: 'Version', value: serverInfo.serverVersion },
        { label: 'Client', value: getClientVersion() },
        { label: 'Host', value: serverInfo.serverHostname },
        { label: 'PID', value: String(serverInfo.serverProcessId) },
        { label: 'Runtime', value: runtimeValue || 'n/a' },
        { label: 'Latency', value: `${heartbeat.latency} ms` },
        { label: 'Sessions', value: String(heartbeat.sessionCount) },
        { label: 'Uptime', value: `${uptimeSeconds}s` },
        { label: 'CPU', value: `${heartbeat.serverCpuCount} cores` },
      ]

      if (heartbeat.serverCpuLoadAverage !== undefined) {
        metrics.push({
          label: 'Load Avg',
          value: heartbeat.serverCpuLoadAverage.toFixed(2),
        })
      }

      if (availableProcessors !== undefined) {
        metrics.push({
          label: 'Processors',
          value: String(availableProcessors),
        })
      }

      if (platformValue) {
        metrics.push({ label: 'Platform', value: platformValue })
      }

      if (compilerValue) {
        metrics.push({ label: 'Compiler', value: compilerValue })
      }

      if (buildValue) {
        metrics.push({ label: 'Build', value: buildValue })
      }

      if (cppStandardValue) {
        metrics.push({ label: 'C++', value: cppStandardValue })
      }

      if (residentMemoryBytes !== undefined) {
        metrics.push({
          label: 'RSS',
          value: formatMemoryMiB(residentMemoryBytes),
        })
      }

      if (virtualMemoryBytes !== undefined) {
        metrics.push({
          label: 'Virtual',
          value: formatMemoryMiB(virtualMemoryBytes),
        })
      }

      if (peakResidentMemoryBytes !== undefined) {
        metrics.push({
          label: 'Peak RSS',
          value: formatMemoryMiB(peakResidentMemoryBytes),
        })
      }

      this.broadcastServerHealth({
        type: 'serverHealth',
        ok: true,
        summary: `Ωedit™ ${heartbeat.latency} ms`,
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
        summary: 'Ωedit™ unavailable',
        detail: message,
        severity: 'down',
        metrics: [{ label: 'Error', value: message }],
      })
    }
  }

  private broadcastServerHealth(payload: ServerHealthState): void {
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
    session.offset = rowAlignedOffset
    try {
      await modifyViewport(session.viewportId, bufferOffset, session.capacity)
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
    // Viewport event subscription will trigger sendViewportData
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

  // â”€â”€ Webview Message Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async handleWebviewMessage(
    session: EditorSession,
    rawMessage: unknown
  ): Promise<void> {
    const msg = normalizeWebviewMessage(session, rawMessage)
    if (!msg || session.scope.isDisposed || session.disposed) {
      return
    }

    try {
      switch (msg.type) {
        // --- Scrolling ---
        case 'scroll': {
          const delta =
            msg.direction === 'up'
              ? -session.bytesPerRow * 4
              : session.bytesPerRow * 4
          await this.scrollTo(session, session.offset + delta)
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
          session.visibleRows = Math.max(1, Math.floor(msg.visibleRows))
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
            const changed = await this.applyReplace(
              session,
              msg.offset,
              msg.length,
              msg.data
            )
            this.postWebviewMessage(session, {
              type: 'replaceComplete',
              scope: 'single',
              replacedOffset: msg.offset,
              offsetDelta: Buffer.from(msg.data, 'hex').length - msg.length,
              selectionOffset: changed && msg.data.length > 0 ? msg.offset : -1,
              replacedCount: changed ? 1 : 0,
            })
            if (changed) {
              await this.waitForSessionSync(session, sessionSyncVersion)
            }
          })
          break
        }

        case 'replaceAllMatches': {
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
      void vscode.window.showErrorMessage(`OmegaEdit error: ${message}`)
    }
  }
}

// â”€â”€ Webview Message Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type WebviewMessage =
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'scrollTo'; offset: number }
  | { type: 'setViewportMetrics'; visibleRows: number }
  | { type: 'setBytesPerRow'; bytesPerRow: 8 | 16 | 32 }
  | {
      type: 'requestAnalysisProfile'
      offset: number
      length: number
      requestKey: string
      scopeLabel: string
      requestedLength: number
      isCapped: boolean
    }
  | { type: 'requestTransformPlugins' }
  | {
      type: 'copySelection'
      offset: number
      length: number
      format: 'hex' | 'utf8'
    }
  | {
      type: 'cutSelection'
      offset: number
      length: number
      format: 'hex' | 'utf8'
    }
  | { type: 'insert'; offset: number; data: string }
  | { type: 'delete'; offset: number; length: number }
  | { type: 'overwrite'; offset: number; data: string }
  | { type: 'replace'; offset: number; length: number; data: string }
  | {
      type: 'applyTransform'
      pluginId: string
      offset: number
      length: number
      optionsJson?: string
    }
  | {
      type: 'replaceAllMatches'
      offsets?: number[]
      query: string
      isHex: boolean
      caseInsensitive?: boolean
      isReverse?: boolean
      length: number
      data: string
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'save' }
  | { type: 'saveAs' }
  | { type: 'revert' }
  | {
      type: 'search'
      query: string
      isHex: boolean
      caseInsensitive?: boolean
      isReverse?: boolean
    }
  | { type: 'goToMatch'; offset: number }
  | {
      type: 'findAdjacentMatch'
      query: string
      isHex: boolean
      caseInsensitive?: boolean
      direction: 'forward' | 'backward'
      offset: number
    }
