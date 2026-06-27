import type * as vscode from 'vscode'
import type {
  ExternalHighlightKind,
  InsertDirection,
  WebviewEditorState,
  WebviewExternalHighlight,
} from './webviewProtocol'

export const OMEGA_EDIT_EXTENSION_PUBLISHER = 'ctc-oss'
export const OMEGA_EDIT_EXTENSION_NAME = 'omega-edit-data-editor'
export const OMEGA_EDIT_EXTENSION_ID =
  `${OMEGA_EDIT_EXTENSION_PUBLISHER}.${OMEGA_EDIT_EXTENSION_NAME}` as const
export const OMEGA_EDIT_EXTENSION_API_VERSION = 3

export type OmegaEditExternalHighlightKind = ExternalHighlightKind
export type OmegaEditExternalHighlight = WebviewExternalHighlight
export type OmegaEditEditorState = WebviewEditorState
export type OmegaEditInsertDirection = InsertDirection

export interface OmegaEditEditorSelector {
  uri?: vscode.Uri | string
}

export interface OmegaEditOpenOptions {
  offset?: number
}

export interface OmegaEditRevealOptions extends OmegaEditEditorSelector {
  offset: number
}

export interface OmegaEditInsertDirectionOptions
  extends OmegaEditEditorSelector {
  direction?: OmegaEditInsertDirection
}

export interface OmegaEditExternalHighlightRequest
  extends OmegaEditEditorSelector {
  highlights: OmegaEditExternalHighlight[]
  reveal?: boolean
}

export interface OmegaEditCheckpointOptions extends OmegaEditEditorSelector {}

export interface OmegaEditChangeLogExportOptions
  extends OmegaEditEditorSelector {
  targetUri?: vscode.Uri | string
}

export interface OmegaEditChangeLogApplyOptions
  extends OmegaEditEditorSelector {
  sourceUri?: vscode.Uri | string
}

export interface OmegaEditCheckpointResult {
  state?: OmegaEditEditorState
  checkpointCount: number
}

export interface OmegaEditRollbackCheckpointResult {
  state?: OmegaEditEditorState
  rolledBack: boolean
  checkpointCount: number
}

export interface OmegaEditRestoreCheckpointResult {
  state?: OmegaEditEditorState
  restored: boolean
  checkpointCount: number
  changeCount: number
  discardedChangeCount: number
}

export interface OmegaEditChangeLogDigest {
  algorithm: string
  value: string
}

export interface OmegaEditChangeLogFingerprint {
  byteLength: number | string
  digest: OmegaEditChangeLogDigest
}

export interface OmegaEditChangeLogResult {
  state?: OmegaEditEditorState
  uri?: vscode.Uri
  changeCount: number
  sourceChangeCount?: number
  complete?: boolean
  before?: OmegaEditChangeLogFingerprint
  after?: OmegaEditChangeLogFingerprint
  unavailableChangeCount?: number
  unavailableChangeSerials?: number[]
  cancelled?: boolean
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
  setInsertDirection(
    directionOrOptions?:
      | OmegaEditInsertDirection
      | vscode.Uri
      | string
      | OmegaEditInsertDirectionOptions,
    options?: vscode.Uri | string | OmegaEditEditorSelector
  ): OmegaEditEditorState | undefined
  createCheckpoint(
    options?: vscode.Uri | string | OmegaEditCheckpointOptions
  ): Promise<OmegaEditCheckpointResult | undefined>
  rollbackCheckpoint(
    options?: vscode.Uri | string | OmegaEditCheckpointOptions
  ): Promise<OmegaEditRollbackCheckpointResult | undefined>
  restoreCheckpoint(
    options?: vscode.Uri | string | OmegaEditCheckpointOptions
  ): Promise<OmegaEditRestoreCheckpointResult | undefined>
  exportChangeLog(
    options?: vscode.Uri | string | OmegaEditChangeLogExportOptions
  ): Promise<OmegaEditChangeLogResult | undefined>
  applyChangeLog(
    options?: vscode.Uri | string | OmegaEditChangeLogApplyOptions
  ): Promise<OmegaEditChangeLogResult | undefined>
}
