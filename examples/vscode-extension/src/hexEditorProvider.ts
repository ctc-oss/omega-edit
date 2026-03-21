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

import * as vscode from 'vscode'
import {
  getClient,
  createSession,
  destroySession,
  saveSession,
  getComputedFileSize,
  insert,
  del,
  overwrite,
  undo,
  redo,
  createViewport,
  modifyViewport,
  destroyViewport,
  getViewportData,
  searchSession,
  IOFlags,
  EventSubscriptionRequest,
  ALL_EVENTS,
  ViewportEventKind,
  SessionEventKind,
} from '@omega-edit/client'
import { getWebviewContent } from './webview'

/** Tracks state for one open editor tab */
interface EditorSession {
  sessionId: string
  viewportId: string
  fileSize: number
  offset: number
  capacity: number
  filePath: string
  panel: vscode.WebviewPanel
  viewportStream?: { cancel(): void }
  sessionStream?: { cancel(): void }
}

export class HexEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'omegaEdit.hexEditor'

  /** Active editor sessions keyed by document URI string */
  private sessions = new Map<string, EditorSession>()

  /** The editor that last had focus (for goToOffset command routing) */
  private activeSession: EditorSession | undefined

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly port: number
  ) {}

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

    // Viewport capacity: enough rows to fill a typical editor pane
    const capacity = bytesPerRow * 64 // 1 KiB at 16 bytes/row

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
      capacity,
      filePath,
      panel: webviewPanel,
    }
    this.sessions.set(uri.toString(), session)
    this.activeSession = session

    // --- Configure the webview ---
    webviewPanel.webview.options = { enableScripts: true }
    webviewPanel.webview.html = getWebviewContent(bytesPerRow)

    // Send initial data to the webview
    await this.sendViewportData(session)

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
      this.sessions.delete(uri.toString())
      if (this.activeSession === session) {
        this.activeSession = undefined
      }
      session.viewportStream?.cancel()
      session.sessionStream?.cancel()
      try {
        await destroyViewport(viewportId)
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
      session.capacity = bytesPerRow * 64
      this.sendViewportData(session)
    }
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
      data: Array.from(data),
      length: resp.getLength(),
      fileSize: session.fileSize,
      followingByteCount: resp.getFollowingByteCount(),
    })
  }

  /** Scroll the viewport to a given offset, clamped to file bounds */
  private async scrollTo(
    session: EditorSession,
    offset: number
  ): Promise<void> {
    const clamped = Math.max(
      0,
      Math.min(offset, Math.max(0, session.fileSize - 1))
    )
    session.offset = clamped
    await modifyViewport(session.viewportId, clamped, session.capacity)
    // Viewport event subscription will trigger sendViewportData
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

        // --- Editing ---
        case 'insert': {
          await insert(
            session.sessionId,
            msg.offset,
            Buffer.from(msg.data, 'hex')
          )
          break
        }

        case 'delete': {
          await del(session.sessionId, msg.offset, msg.length)
          break
        }

        case 'overwrite': {
          await overwrite(
            session.sessionId,
            msg.offset,
            Buffer.from(msg.data, 'hex')
          )
          break
        }

        // --- Undo / Redo ---
        case 'undo': {
          await undo(session.sessionId)
          break
        }

        case 'redo': {
          await redo(session.sessionId)
          break
        }

        // --- Save ---
        case 'save': {
          await saveSession(
            session.sessionId,
            session.filePath, // original file path
            IOFlags.IO_FLG_OVERWRITE
          )
          vscode.window.showInformationMessage('File saved')
          break
        }

        // --- Search ---
        case 'search': {
          const pattern = msg.isHex ? Buffer.from(msg.query, 'hex') : msg.query
          const matches = await searchSession(
            session.sessionId,
            pattern,
            msg.caseInsensitive ?? false,
            false, // forward
            0,
            0,
            1000 // reasonable limit
          )
          session.panel.webview.postMessage({
            type: 'searchResults',
            matches,
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
      vscode.window.showErrorMessage(`Ωedit™ error: ${message}`)
    }
  }
}

// ── Webview Message Types ─────────────────────────────────────────────

type WebviewMessage =
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'scrollTo'; offset: number }
  | { type: 'insert'; offset: number; data: string }
  | { type: 'delete'; offset: number; length: number }
  | { type: 'overwrite'; offset: number; data: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'save' }
  | { type: 'search'; query: string; isHex: boolean; caseInsensitive?: boolean }
  | { type: 'goToMatch'; offset: number }
