import type { WebviewExternalHighlight, WebviewToHostMessage } from './protocol'

export interface PersistedViewportSnapshot {
  fileSize: number
  visibleOffset: number
  viewportOffset: number
  viewportData: number[]
  externalHighlights?: WebviewExternalHighlight[]
}

export interface PersistedPreviewState {
  bytesPerRow?: number
  bytesPerRowMode?: 'fixed' | 'auto'
  offsetRadix?: 'hex' | 'dec'
  insertDirection?: 'forward' | 'backward'
  searchPanelVisible?: boolean
  profilerExpanded?: boolean
  analysisSectionOrder?: Record<string, string[]>
  selectionAnchor?: number
  selectedOffset?: number
  viewportSnapshot?: PersistedViewportSnapshot
}

const vscode = acquireVsCodeApi<PersistedPreviewState>()

export function postToHost(message: WebviewToHostMessage): void {
  vscode.postMessage(message)
}

export function getPreviewState(): PersistedPreviewState | undefined {
  return vscode.getState()
}

export function setPreviewState(state: PersistedPreviewState): void {
  vscode.setState(state)
}
