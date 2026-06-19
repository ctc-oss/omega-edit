import type * as vscode from 'vscode'
import type {
  ExternalHighlightKind,
  WebviewEditorState,
  WebviewExternalHighlight,
} from './webviewProtocol'

export const OMEGA_EDIT_EXTENSION_PUBLISHER = 'ctc-oss'
export const OMEGA_EDIT_EXTENSION_NAME = 'omega-edit-data-editor'
export const OMEGA_EDIT_EXTENSION_ID =
  `${OMEGA_EDIT_EXTENSION_PUBLISHER}.${OMEGA_EDIT_EXTENSION_NAME}` as const
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
  /**
   * Stable VS Code extension id expected by dependent extensions.
   */
  readonly extensionId: typeof OMEGA_EDIT_EXTENSION_ID
  /**
   * Version of this activation API contract, independent of package version.
   */
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
