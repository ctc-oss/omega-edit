import type { WebviewToHostMessage } from './protocol'

export interface PersistedPreviewState {
  bytesPerRow?: number
  profilerExpanded?: boolean
  analysisSectionOrder?: Record<string, string[]>
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
