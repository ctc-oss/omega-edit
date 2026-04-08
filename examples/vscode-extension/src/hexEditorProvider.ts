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
 * Ωedit™ Hex Editor — Custom Editor Provider
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
  createSession,
  createViewport,
  del,
  destroySession,
  destroyViewport,
  EventSubscriptionRequest,
  editSimple,
  getClient,
  getClientVersion,
  getComputedFileSize,
  getSegment,
  getServerHeartbeat,
  getServerInfo,
  getViewportData,
  IOFlags,
  insert,
  modifyViewport,
  overwrite,
  redo,
  SessionEventKind,
  saveSession,
  searchSession,
  undo,
  ViewportEventKind,
} from '@omega-edit/client'
import * as vscode from 'vscode'
import { OMEGA_EDIT_VIEW_TYPE } from './constants'
import { getWebviewContent } from './webview'

interface EditorSession {
  sessionId: string
  viewportId: string
  fileSize: number
  offset: number
  visibleRows: number
  capacity: number
  filePath: string
  savedChangeDepth: number
  panel: vscode.WebviewPanel
  changeLog: ChangeRecord[]
  undoneChangeLog: ChangeRecord[]
  disposed: boolean
  pendingScrollOffset?: number
  scrollTask?: Promise<void>
  viewportStream?: { cancel(): void }
  sessionStream?: { cancel(): void }
}

type ChangeRecordKind = 'INSERT' | 'DELETE' | 'OVERWRITE' | 'REPLACE'

interface ChangeRecord {
  serial: number
  kind: ChangeRecordKind
  offset: number
  length: number
  data: string
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
const SESSION_SYNC_POLL_MS = 25
const VIEWPORT_BUFFER_BYTES = 8 * 1024
const SERVER_HEALTH_WARN_LATENCY_MS = 75
const SERVER_HEALTH_ERROR_LATENCY_MS = 250

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

export class HexEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = OMEGA_EDIT_VIEW_TYPE

  /** Active editor sessions keyed by document URI string */
  private sessions = new Map<string, EditorSession>()

  /** The editor that last had focus (for goToOffset command routing) */
  private activeSession: EditorSession | undefined

  private heartbeatTimer: ReturnType<typeof setInterval> | undefined

  private heartbeatInFlight = false

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly port: number
  ) {}

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

    await this.handleWebviewMessage(session, msg)
  }

  // ── VS Code Custom Editor API ───────────────────────────────────────

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} }
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const uri = document.uri
    const filePath = uri.fsPath

    // --- Create Ωedit™ session for this file ---
    const sessionResp = await createSession(filePath)
    const sessionId = sessionResp.getSessionId()
    const fileSize = await getComputedFileSize(sessionId)

    const config = vscode.workspace.getConfiguration('omegaEdit')
    const bytesPerRow = config.get<number>('bytesPerRow', 16)

    // Keep a fixed buffered viewport so resizing the editor does not need to
    // resize the server-side viewport. Only the visible row count changes.
    const capacity = this.getViewportCapacity(bytesPerRow)

    // --- Create a viewport starting at offset 0 ---
    const vpResp = await createViewport(
      undefined,
      sessionId,
      0,
      capacity,
      false
    )
    const viewportId = vpResp.getViewportId()

    const session: EditorSession = {
      sessionId,
      viewportId,
      fileSize,
      offset: 0,
      visibleRows: 32,
      capacity,
      filePath,
      savedChangeDepth: 0,
      panel: webviewPanel,
      changeLog: [],
      undoneChangeLog: [],
      disposed: false,
    }
    this.sessions.set(uri.toString(), session)
    this.activeSession = session

    // --- Configure the webview ---
    webviewPanel.webview.options = { enableScripts: true }
    webviewPanel.webview.html = getWebviewContent(bytesPerRow)

    // Send initial data to the webview
    await this.sendViewportData(session)
    this.postEditState(session)
    this.startHealthPolling()

    // --- Subscribe to viewport events for live updates ---
    this.subscribeToViewportEvents(session)
    this.subscribeToSessionEvents(session)

    // --- Handle messages FROM the webview ---
    webviewPanel.webview.onDidReceiveMessage(
      (msg) => this.handleWebviewMessage(session, msg),
      undefined,
      this.context.subscriptions
    )

    // Track which editor is active (for command routing)
    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) {
        this.activeSession = session
      }
    })

    // --- Cleanup on close ---
    webviewPanel.onDidDispose(async () => {
      session.disposed = true
      this.sessions.delete(uri.toString())
      if (this.activeSession === session) {
        this.activeSession = undefined
      }
      if (this.sessions.size === 0) {
        this.stopHealthPolling()
      }
      session.viewportStream?.cancel()
      session.sessionStream?.cancel()
      try {
        await destroyViewport(session.viewportId)
      } catch {
        /* already destroyed */
      }
      try {
        await destroySession(sessionId)
      } catch {
        /* already destroyed */
      }
    })
  }

  // ── Public methods called from extension.ts ─────────────────────────

  /** Navigate the active editor to a byte offset */
  goToOffset(offset: number): void {
    if (this.activeSession) {
      this.scrollTo(this.activeSession, offset)
    }
  }

  /** Re-read bytesPerRow from config and refresh all open editors */
  refreshBytesPerRow(): void {
    const config = vscode.workspace.getConfiguration('omegaEdit')
    const bytesPerRow = config.get<number>('bytesPerRow', 16)
    for (const session of this.sessions.values()) {
      session.panel.webview.html = getWebviewContent(bytesPerRow)
      session.capacity = this.getViewportCapacity(bytesPerRow)
      this.sendViewportData(session)
      this.postEditState(session)
    }
  }

  async exportActiveChangeScript(targetUri?: vscode.Uri): Promise<void> {
    if (!this.activeSession) {
      vscode.window.showWarningMessage('Open an OmegaEdit editor first')
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
      JSON.stringify(session.changeLog, null, 2),
      'utf8'
    )
    await vscode.workspace.fs.writeFile(scriptUri, content)
    vscode.window.showInformationMessage(
      `Change script saved to ${scriptUri.fsPath}`
    )
  }

  async replayActiveChangeScript(sourceUri?: vscode.Uri): Promise<void> {
    if (!this.activeSession) {
      vscode.window.showWarningMessage('Open an OmegaEdit editor first')
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
    const changes = JSON.parse(
      Buffer.from(content).toString('utf8')
    ) as ChangeRecord[]
    await this.replayChanges(this.activeSession, changes)
    vscode.window.showInformationMessage(`Replayed ${changes.length} change(s)`)
  }

  // ── Event Subscriptions ─────────────────────────────────────────────

  /**
   * Subscribe to Ωedit™ viewport events. When edits change data visible in
   * the viewport, the server streams an event and we push fresh data to the
   * webview. This is the reactive data flow at the heart of Ωedit™.
   */
  private async subscribeToViewportEvents(
    session: EditorSession
  ): Promise<void> {
    const client = await getClient(this.port)
    const request = new EventSubscriptionRequest()
      .setId(session.viewportId)
      .setInterest(ALL_EVENTS)

    const vpStream = client
      .subscribeToViewportEvents(request)
      .on('data', async (event) => {
        const kind = event.getViewportEventKind()
        if (
          kind === ViewportEventKind.VIEWPORT_EVT_EDIT ||
          kind === ViewportEventKind.VIEWPORT_EVT_UNDO ||
          kind === ViewportEventKind.VIEWPORT_EVT_CLEAR ||
          kind === ViewportEventKind.VIEWPORT_EVT_TRANSFORM ||
          kind === ViewportEventKind.VIEWPORT_EVT_MODIFY
        ) {
          await this.sendViewportData(session)
        }
      })
      .on('error', () => {
        // Stream closed — expected during shutdown
      })
    session.viewportStream = vpStream
  }

  /**
   * Subscribe to session events to track file size changes and edit state.
   */
  private async subscribeToSessionEvents(
    session: EditorSession
  ): Promise<void> {
    const client = await getClient(this.port)
    const request = new EventSubscriptionRequest()
      .setId(session.sessionId)
      .setInterest(ALL_EVENTS)

    const sesStream = client
      .subscribeToSessionEvents(request)
      .on('data', async (event) => {
        const kind = event.getSessionEventKind()
        if (
          kind === SessionEventKind.SESSION_EVT_EDIT ||
          kind === SessionEventKind.SESSION_EVT_UNDO ||
          kind === SessionEventKind.SESSION_EVT_CLEAR
        ) {
          session.fileSize = await getComputedFileSize(session.sessionId)
          session.panel.webview.postMessage({
            type: 'fileSizeChanged',
            fileSize: session.fileSize,
          })
        }
      })
      .on('error', () => {})
    session.sessionStream = sesStream
  }

  // ── Viewport Data ───────────────────────────────────────────────────

  /** Fetch current viewport data and send it to the webview */
  private async sendViewportData(session: EditorSession): Promise<void> {
    const resp = await getViewportData(session.viewportId)
    const data = resp.getData_asU8()
    session.panel.webview.postMessage({
      type: 'viewportData',
      offset: resp.getOffset(),
      visibleOffset: session.offset,
      data: Array.from(data),
      length: resp.getLength(),
      fileSize: session.fileSize,
      followingByteCount: resp.getFollowingByteCount(),
    })
  }

  private async recreateViewport(
    session: EditorSession,
    offset: number,
    capacity: number
  ): Promise<void> {
    if (session.disposed) {
      return
    }

    const previousViewportId = session.viewportId
    session.viewportStream?.cancel()

    const vpResp = await createViewport(
      undefined,
      session.sessionId,
      offset,
      capacity,
      false
    )
    session.viewportId = vpResp.getViewportId()

    try {
      await destroyViewport(previousViewportId)
    } catch {
      /* ignore stale viewport cleanup errors */
    }

    await this.subscribeToViewportEvents(session)
    await this.sendViewportData(session)
  }

  private postEditState(session: EditorSession): void {
    session.panel.webview.postMessage({
      type: 'editState',
      canUndo: session.changeLog.length > 0,
      canRedo: session.undoneChangeLog.length > 0,
      undoCount: session.changeLog.length,
      redoCount: session.undoneChangeLog.length,
      isDirty: session.changeLog.length !== session.savedChangeDepth,
      savedChangeDepth: session.savedChangeDepth,
    })
  }

  private async refreshSessionFileSize(
    session: EditorSession,
    expectedFileSize?: number
  ): Promise<void> {
    let nextFileSize = session.fileSize
    const deadline = Date.now() + SESSION_SYNC_TIMEOUT_MS

    while (Date.now() <= deadline) {
      nextFileSize = await getComputedFileSize(session.sessionId)
      if (
        expectedFileSize === undefined
          ? nextFileSize !== session.fileSize
          : nextFileSize === expectedFileSize
      ) {
        break
      }

      await new Promise((resolve) => setTimeout(resolve, SESSION_SYNC_POLL_MS))
    }

    if (expectedFileSize !== undefined && nextFileSize !== expectedFileSize) {
      throw new Error(
        `Timed out waiting for session size ${expectedFileSize}; last size was ${nextFileSize}`
      )
    }

    if (nextFileSize === session.fileSize) {
      return
    }

    session.fileSize = nextFileSize
    session.panel.webview.postMessage({
      type: 'fileSizeChanged',
      fileSize: nextFileSize,
    })
  }

  private pushChange(session: EditorSession, change: ChangeRecord): void {
    session.changeLog.push(change)
    session.undoneChangeLog = []
    this.postEditState(session)
  }

  private startHealthPolling(): void {
    if (this.heartbeatTimer) {
      return
    }

    void this.publishServerHealth()
    this.heartbeatTimer = setInterval(() => {
      void this.publishServerHealth()
    }, 5000)
  }

  private stopHealthPolling(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  private async publishServerHealth(): Promise<void> {
    if (this.heartbeatInFlight || this.sessions.size === 0) {
      return
    }

    this.heartbeatInFlight = true
    try {
      const [serverInfo, heartbeat] = await Promise.all([
        getServerInfo(),
        getServerHeartbeat(
          Array.from(this.sessions.values(), (session) => session.sessionId)
        ),
      ])

      const uptimeSeconds = Math.max(
        0,
        Math.round(heartbeat.serverUptime / 1000)
      )
      const formatMemoryMiB = (bytes?: number): string =>
        bytes === undefined ? 'n/a' : `${Math.round(bytes / (1024 * 1024))} MiB`
      const severity = classifyServerHealthLatency(heartbeat.latency)
      const runtimeKind =
        getOptionalStringProperty(serverInfo, 'runtimeKind') ?? 'JVM'
      const runtimeName =
        getOptionalStringProperty(serverInfo, 'runtimeName') ??
        [
          getOptionalStringProperty(serverInfo, 'jvmVendor'),
          getOptionalStringProperty(serverInfo, 'jvmVersion'),
        ]
          .filter(Boolean)
          .join(' ')
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
      const serverUsedMemory = getOptionalNumberProperty(
        heartbeat,
        'serverUsedMemory'
      )
      const serverCommittedMemory = getOptionalNumberProperty(
        heartbeat,
        'serverCommittedMemory'
      )
      const serverMaxMemory = getOptionalNumberProperty(
        heartbeat,
        'serverMaxMemory'
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
        {
          label: 'Load',
          value:
            heartbeat.serverCpuLoadAverage === undefined
              ? 'n/a'
              : heartbeat.serverCpuLoadAverage.toFixed(2),
        },
      ]

      if (availableProcessors !== undefined) {
        metrics.push({
          label: 'Processors',
          value: String(availableProcessors),
        })
      }

      if (serverUsedMemory !== undefined) {
        metrics.push({
          label: 'Heap Used',
          value: formatMemoryMiB(serverUsedMemory),
        })
      }

      if (serverCommittedMemory !== undefined) {
        metrics.push({
          label: 'Heap Committed',
          value: formatMemoryMiB(serverCommittedMemory),
        })
      }

      if (serverMaxMemory !== undefined) {
        metrics.push({
          label: 'Heap Max',
          value: formatMemoryMiB(serverMaxMemory),
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
    } finally {
      this.heartbeatInFlight = false
    }
  }

  private broadcastServerHealth(payload: ServerHealthState): void {
    for (const session of this.sessions.values()) {
      session.panel.webview.postMessage(payload)
    }
  }

  private async replayChanges(
    session: EditorSession,
    changes: ChangeRecord[]
  ): Promise<void> {
    for (const change of changes) {
      const expectedFileSize = this.getExpectedFileSizeAfterRecord(
        session.fileSize,
        change
      )
      switch (change.kind) {
        case 'INSERT': {
          const serial = await insert(
            session.sessionId,
            change.offset,
            Buffer.from(change.data, 'hex')
          )
          this.pushChange(session, {
            serial,
            kind: 'INSERT',
            offset: change.offset,
            length: 0,
            data: change.data,
          })
          break
        }
        case 'DELETE': {
          const serial = await del(
            session.sessionId,
            change.offset,
            change.length
          )
          this.pushChange(session, {
            serial,
            kind: 'DELETE',
            offset: change.offset,
            length: change.length,
            data: '',
          })
          break
        }
        case 'OVERWRITE': {
          const serial = await overwrite(
            session.sessionId,
            change.offset,
            Buffer.from(change.data, 'hex')
          )
          this.pushChange(session, {
            serial,
            kind: 'OVERWRITE',
            offset: change.offset,
            length: Buffer.from(change.data, 'hex').length,
            data: change.data,
          })
          break
        }
        case 'REPLACE':
          await this.applyReplace(
            session,
            change.offset,
            change.length,
            change.data
          )
          break
      }
      await this.refreshSessionFileSize(session, expectedFileSize)
    }
  }

  private getExpectedFileSizeAfterRecord(
    currentFileSize: number,
    change: Pick<ChangeRecord, 'kind' | 'length' | 'data'>
  ): number {
    const insertedLength = change.data.length / 2
    switch (change.kind) {
      case 'INSERT':
        return currentFileSize + insertedLength
      case 'DELETE':
        return Math.max(0, currentFileSize - change.length)
      case 'OVERWRITE':
        return currentFileSize
      case 'REPLACE':
        return Math.max(0, currentFileSize - change.length + insertedLength)
    }
  }

  private async applyReplace(
    session: EditorSession,
    offset: number,
    length: number,
    dataHex: string
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
      this.pushChange(session, {
        serial: changeSerial,
        kind: 'REPLACE',
        offset,
        length,
        data: dataHex,
      })
      return true
    }

    return false
  }

  private async saveToPath(
    session: EditorSession,
    filePath: string,
    successMessage: string,
    markClean: boolean
  ): Promise<void> {
    await saveSession(session.sessionId, filePath, IOFlags.IO_FLG_OVERWRITE)
    if (markClean) {
      session.savedChangeDepth = session.changeLog.length
      this.postEditState(session)
    }
    vscode.window.showInformationMessage(successMessage)
  }

  /** Scroll the viewport to a given offset, clamped to file bounds */
  private async applyScrollTo(
    session: EditorSession,
    offset: number
  ): Promise<void> {
    if (session.disposed) {
      return
    }

    const config = vscode.workspace.getConfiguration('omegaEdit')
    const bytesPerRow = config.get<number>('bytesPerRow', 16)
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
    if (session.disposed) {
      return
    }

    session.pendingScrollOffset = offset
    if (session.scrollTask) {
      return session.scrollTask
    }

    session.scrollTask = (async () => {
      while (
        !session.disposed &&
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

  // ── Webview Message Handler ─────────────────────────────────────────

  private async handleWebviewMessage(
    session: EditorSession,
    msg: WebviewMessage
  ): Promise<void> {
    try {
      switch (msg.type) {
        // --- Scrolling ---
        case 'scroll': {
          const config = vscode.workspace.getConfiguration('omegaEdit')
          const bytesPerRow = config.get<number>('bytesPerRow', 16)
          const delta =
            msg.direction === 'up' ? -bytesPerRow * 4 : bytesPerRow * 4
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

        // --- Editing ---
        case 'insert': {
          const data = Buffer.from(msg.data, 'hex')
          const expectedFileSize = session.fileSize + data.length
          const serial = await insert(session.sessionId, msg.offset, data)
          this.pushChange(session, {
            serial,
            kind: 'INSERT',
            offset: msg.offset,
            length: 0,
            data: msg.data,
          })
          await this.refreshSessionFileSize(session, expectedFileSize)
          break
        }

        case 'delete': {
          const expectedFileSize = Math.max(0, session.fileSize - msg.length)
          const serial = await del(session.sessionId, msg.offset, msg.length)
          this.pushChange(session, {
            serial,
            kind: 'DELETE',
            offset: msg.offset,
            length: msg.length,
            data: '',
          })
          await this.refreshSessionFileSize(session, expectedFileSize)
          break
        }

        case 'overwrite': {
          const serial = await overwrite(
            session.sessionId,
            msg.offset,
            Buffer.from(msg.data, 'hex')
          )
          this.pushChange(session, {
            serial,
            kind: 'OVERWRITE',
            offset: msg.offset,
            length: msg.data.length / 2,
            data: msg.data,
          })
          await this.refreshSessionFileSize(session)
          break
        }

        case 'replace': {
          const expectedFileSize = this.getExpectedFileSizeAfterRecord(
            session.fileSize,
            { kind: 'REPLACE', length: msg.length, data: msg.data }
          )
          const changed = await this.applyReplace(
            session,
            msg.offset,
            msg.length,
            msg.data
          )
          session.panel.webview.postMessage({
            type: 'replaceComplete',
            selectionOffset: changed && msg.data.length > 0 ? msg.offset : -1,
            replacedCount: changed ? 1 : 0,
          })
          await this.refreshSessionFileSize(session, expectedFileSize)
          break
        }

        case 'replaceAllMatches': {
          const offsets = [...msg.offsets].sort((a, b) => b - a)
          let changedOffset = -1
          let replacedCount = 0
          for (const offset of offsets) {
            const expectedFileSize = this.getExpectedFileSizeAfterRecord(
              session.fileSize,
              { kind: 'REPLACE', length: msg.length, data: msg.data }
            )
            const changed = await this.applyReplace(
              session,
              offset,
              msg.length,
              msg.data
            )
            if (changed && msg.data.length > 0) {
              changedOffset = offset
            }
            if (changed) {
              replacedCount += 1
            }
            await this.refreshSessionFileSize(session, expectedFileSize)
          }
          session.panel.webview.postMessage({
            type: 'replaceComplete',
            selectionOffset: changedOffset,
            replacedCount,
          })
          break
        }

        // --- Undo / Redo ---
        case 'undo': {
          if (session.changeLog.length === 0) {
            this.postEditState(session)
            break
          }
          await undo(session.sessionId)
          const lastChange = session.changeLog.pop()
          if (lastChange) {
            session.undoneChangeLog.push(lastChange)
          }
          await this.refreshSessionFileSize(session)
          this.postEditState(session)
          break
        }

        case 'redo': {
          if (session.undoneChangeLog.length === 0) {
            this.postEditState(session)
            break
          }
          await redo(session.sessionId)
          const redoneChange = session.undoneChangeLog.pop()
          if (redoneChange) {
            session.changeLog.push(redoneChange)
          }
          await this.refreshSessionFileSize(session)
          this.postEditState(session)
          break
        }

        // --- Save ---
        case 'save': {
          await this.saveToPath(session, session.filePath, 'File saved', true)
          break
        }

        case 'saveAs': {
          const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(session.filePath),
            title: 'Save OmegaEdit contents as',
          })
          if (!saveUri) {
            break
          }
          await this.saveToPath(
            session,
            saveUri.fsPath,
            `File saved as ${saveUri.fsPath}`,
            false
          )
          break
        }

        // --- Search ---
        case 'search': {
          const normalizedQuery = msg.query.trim()
          if (!normalizedQuery) {
            session.panel.webview.postMessage({
              type: 'searchResults',
              matches: [],
              patternLength: 0,
            })
            break
          }

          const pattern = msg.isHex
            ? Buffer.from(normalizedQuery, 'hex')
            : Buffer.from(normalizedQuery, 'utf8')
          const matches = await searchSession(
            session.sessionId,
            pattern,
            msg.caseInsensitive ?? false,
            msg.isReverse ?? false,
            0,
            0,
            1000 // reasonable limit
          )
          session.panel.webview.postMessage({
            type: 'searchResults',
            matches,
            patternLength: pattern.length,
          })
          // Jump to first match if any
          if (matches.length > 0) {
            await this.scrollTo(session, matches[0])
          }
          break
        }

        case 'goToMatch': {
          await this.scrollTo(session, msg.offset)
          break
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(`OmegaEdit error: ${message}`)
    }
  }
}

// ── Webview Message Types ─────────────────────────────────────────────

type WebviewMessage =
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'scrollTo'; offset: number }
  | { type: 'setViewportMetrics'; visibleRows: number }
  | { type: 'setBytesPerRow'; bytesPerRow: 8 | 16 | 32 }
  | { type: 'insert'; offset: number; data: string }
  | { type: 'delete'; offset: number; length: number }
  | { type: 'overwrite'; offset: number; data: string }
  | { type: 'replace'; offset: number; length: number; data: string }
  | {
      type: 'replaceAllMatches'
      offsets: number[]
      length: number
      data: string
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'save' }
  | { type: 'saveAs' }
  | {
      type: 'search'
      query: string
      isHex: boolean
      caseInsensitive?: boolean
      isReverse?: boolean
    }
  | { type: 'goToMatch'; offset: number }
