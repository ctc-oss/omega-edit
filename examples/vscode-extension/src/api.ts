import type * as vscode from 'vscode'
import type {
  ExternalHighlightKind,
  WebviewEditorState,
  WebviewExternalHighlight,
} from './webviewProtocol'

export const OMEGA_EDIT_EXTENSION_API_VERSION = 1

export type OmegaEditExternalHighlightKind = ExternalHighlightKind
export type OmegaEditExternalHighlight = WebviewExternalHighlight
export type OmegaEditEditorState = WebviewEditorState

export interface OmegaEditEditorSelector {
  uri?: vscode.Uri | string
}

export interface OmegaEditOpenOptions {
  offset?: number
}

export interface OmegaEditRevealOptions extends OmegaEditEditorSelector {
  offset: number
}

export interface OmegaEditExternalHighlightRequest
  extends OmegaEditEditorSelector {
  highlights: OmegaEditExternalHighlight[]
  reveal?: boolean
}

export interface OmegaEditExtensionApi {
  readonly version: typeof OMEGA_EDIT_EXTENSION_API_VERSION
  readonly onDidChangeEditorState: vscode.Event<OmegaEditEditorState>
  open(
    uri: vscode.Uri,
    options?: OmegaEditOpenOptions
  ): Promise<OmegaEditEditorState | undefined>
  reveal(
    uriOrOptions: vscode.Uri | string | OmegaEditRevealOptions,
    offset?: number
  ): Promise<OmegaEditEditorState | undefined>
  getEditorState(
    options?: vscode.Uri | string | OmegaEditEditorSelector
  ): OmegaEditEditorState | undefined
  setExternalHighlights(
    request: OmegaEditExternalHighlightRequest
  ): Promise<OmegaEditEditorState | undefined>
  clearExternalHighlights(
    options?: vscode.Uri | string | OmegaEditEditorSelector
  ): OmegaEditEditorState | undefined
}
