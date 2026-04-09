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
  del,
  destroyLastCheckpoint,
  editSimple,
  type EditorChangeRecord as ChangeRecord,
  EditorHistoryController,
  EditorSearchController,
  ScopedEditorSessionHandle,
  getClientVersion,
  getSegment,
  getServerInfo,
  getViewportData,
  IOFlags,
  type IServerInfo,
  insert,
  modifyViewport,
  overwrite,
  replaceSessionCheckpointed,
  redo,
  saveSession,
  startServerHeartbeatLoop,
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
  filePath: string
  panel: vscode.WebviewPanel
  scope: ScopedEditorSessionHandle
  history: EditorHistoryController
  search: EditorSearchController
  pendingScrollOffset?: number
  scrollTask?: Promise<void>
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

  private heartbeatLoop: ServerHeartbeatLoop | undefined

  private serverInfo: IServerInfo | undefined

  constructor(
    private readonly context: vscode.ExtensionContext,
    _port: number
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

  // â”€â”€ VS Code Custom Editor API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // --- Create Î©editâ„¢ session for this file ---
    const config = vscode.workspace.getConfiguration('omegaEdit')
    const bytesPerRow = config.get<number>('bytesPerRow', 16)

    // Keep a fixed buffered viewport so resizing the editor does not need to
    // resize the server-side viewport. Only the visible row count changes.
    const capacity = this.getViewportCapacity(bytesPerRow)

    // --- Create a viewport starting at offset 0 ---
    const scope = await ScopedEditorSessionHandle.openFile(filePath, {
      filePath,
      capacity,
    })

    const session: EditorSession = {
      get sessionId() {
        return scope.sessionId
      },
      get viewportId() {
        return scope.viewportId
      },
      get fileSize() {
        return scope.model.fileSize
      },
      get changeCount() {
        return scope.model.changeCount
      },
      get sessionSyncVersion() {
        return scope.model.syncVersion
      },
      offset: 0,
      visibleRows: 32,
      capacity,
      filePath,
      panel: webviewPanel,
      scope,
      history: new EditorHistoryController(),
      search: new EditorSearchController(scope.sessionId),
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

        session.panel.webview.postMessage({
          type: 'fileSizeChanged',
          fileSize: context.model.fileSize,
        })
        if (session.search.shouldClearAfterExternalEdit()) {
          this.clearSearchState(session)
        }
      },
    })

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
      this.sessions.delete(uri.toString())
      if (this.activeSession === session) {
        this.activeSession = undefined
      }
      if (this.sessions.size === 0) {
        this.stopHealthPolling()
      }
      await session.scope.dispose()
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
      JSON.stringify(session.history.getChangeLog(), null, 2),
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

  // â”€â”€ Event Subscriptions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Subscribe to Î©editâ„¢ viewport events. When edits change data visible in
   * the viewport, the server streams an event and we push fresh data to the
   * webview. This is the reactive data flow at the heart of Î©editâ„¢.
   */

  // â”€â”€ Viewport Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    if (session.scope.isDisposed) {
      return
    }

    await session.scope.recreateViewport(offset, capacity)
    await this.sendViewportData(session)
  }

  private postEditState(session: EditorSession): void {
    session.panel.webview.postMessage({
      type: 'editState',
      ...session.history.getEditState(),
    })
  }

  private waitForSessionSync(
    session: EditorSession,
    minimumVersion: number,
    timeoutMs: number = SESSION_SYNC_TIMEOUT_MS
  ): Promise<void> {
    return session.scope.model.waitForSync(minimumVersion, timeoutMs)
  }

  private clearSearchState(session: EditorSession): void {
    if (session.search.clear()) {
      session.panel.webview.postMessage({ type: 'searchStateCleared' })
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
      session.panel.webview.postMessage(payload)
    }
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
          break
        }
        case 'OVERWRITE': {
          const serial = await overwrite(
            session.sessionId,
            change.offset,
            Buffer.from(change.data, 'hex')
          )
          session.history.recordLocalChange({
            serial,
            kind: 'OVERWRITE',
            offset: change.offset,
            length: Buffer.from(change.data, 'hex').length,
            data: change.data,
          })
          this.postEditState(session)
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
    await saveSession(session.sessionId, filePath, IOFlags.OVERWRITE)
    if (markClean) {
      session.history.markSaved()
      this.postEditState(session)
    }
    vscode.window.showInformationMessage(successMessage)
  }

  /** Scroll the viewport to a given offset, clamped to file bounds */
  private async applyScrollTo(
    session: EditorSession,
    offset: number
  ): Promise<void> {
    if (session.scope.isDisposed) {
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
            session.panel.webview.postMessage({
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
            }

            session.panel.webview.postMessage({
              type: 'replaceComplete',
              scope: 'all',
              selectionOffset: result.selectionOffset,
              replacedCount: result.replacedCount,
            })
          })
          break
        }

        // --- Undo / Redo ---
        case 'undo': {
          const sessionSyncVersion = session.sessionSyncVersion
          const didUndo = await session.history.undo({
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
          })
          if (didUndo) {
            await this.waitForSessionSync(session, sessionSyncVersion)
            this.clearSearchState(session)
          }
          this.postEditState(session)
          break
        }

        case 'redo': {
          const sessionSyncVersion = session.sessionSyncVersion
          const didRedo = await session.history.redo({
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
          })
          if (didRedo) {
            await this.waitForSessionSync(session, sessionSyncVersion)
            this.clearSearchState(session)
          }
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
            title: 'Save Ωedit™ contents as',
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
          const result = await session.search.search({
            query: msg.query,
            isHex: msg.isHex,
            caseInsensitive: msg.caseInsensitive ?? false,
            isReverse: msg.isReverse ?? false,
          })
          session.panel.webview.postMessage({
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
          session.panel.webview.postMessage({
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
      vscode.window.showErrorMessage(`OmegaEdit error: ${message}`)
    }
  }
}

// â”€â”€ Webview Message Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
