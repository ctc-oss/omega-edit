import type {
  WebviewExternalHighlight,
  WebviewRangeMapNode,
  WebviewToHostMessage,
} from './protocol'

export interface PersistedViewportSnapshot {
  fileSize: number
  visibleOffset: number
  viewportOffset: number
  viewportData: number[]
  externalHighlights?: WebviewExternalHighlight[]
  rangeMapTree?: WebviewRangeMapNode[]
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
  transformPresetHistory?: Array<{
    id: string
    pluginId: string
    pluginName: string
    optionsJson: string
    descriptorJson: string
    descriptorHex: string
    createdAt: number
  }>
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
