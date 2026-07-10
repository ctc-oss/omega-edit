import type * as vscode from 'vscode'
import type { AssistantSessionContext } from './assistantContext'
import type {
  ExternalHighlightKind,
  InsertDirection,
  TextEncoding,
  WebviewEditorState,
  WebviewExternalHighlight,
} from './webviewProtocol'

export const OMEGA_EDIT_EXTENSION_PUBLISHER = 'ctc-oss'
export const OMEGA_EDIT_EXTENSION_NAME = 'omega-edit-data-editor'
export const OMEGA_EDIT_EXTENSION_ID =
  `${OMEGA_EDIT_EXTENSION_PUBLISHER}.${OMEGA_EDIT_EXTENSION_NAME}` as const
export const OMEGA_EDIT_EXTENSION_API_VERSION = 2

export type OmegaEditExternalHighlightKind = ExternalHighlightKind
export type OmegaEditExternalHighlight = WebviewExternalHighlight
export type OmegaEditEditorState = WebviewEditorState
export type OmegaEditInsertDirection = InsertDirection
export type OmegaEditTextEncoding = TextEncoding
export type OmegaEditAssistantContext = AssistantSessionContext

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

export interface OmegaEditRangeMapLoadOptions extends OmegaEditEditorSelector {
  sourceUri?: vscode.Uri | string
  reveal?: boolean
  notify?: boolean
}

export interface OmegaEditRangeMapUnloadOptions
  extends OmegaEditEditorSelector {
  notify?: boolean
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

export interface OmegaEditChangeLogPreviewOptions
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

export interface OmegaEditChangeLogPrimitiveCounts {
  total: number
  insert: number
  delete: number
  overwrite: number
  replace: number
  transform: number
}

export interface OmegaEditChangeLogPreview {
  state?: OmegaEditEditorState
  uri?: vscode.Uri
  format: 'omega-edit.change-log'
  version: 2
  complete: boolean
  canApply: boolean
  primitiveCounts: OmegaEditChangeLogPrimitiveCounts
  before: OmegaEditChangeLogFingerprint
  after: OmegaEditChangeLogFingerprint
  current?: OmegaEditChangeLogFingerprint
  expectedSize: {
    beforeByteLength: string
    afterByteLength: string
    deltaBytes: string
  }
  transformDescriptors: Array<{
    index: number
    serial?: number | string
    offset: number | string
    length: number | string
    transformId: string
    optionsJson?: string
    descriptorSource: 'data'
  }>
  requiredPlugins: string[]
  missingPlugins: string[]
  unavailablePrimitives: {
    count: number | string
    serials: Array<number | string>
  }
  rollbackProtection: {
    available: boolean
    strategy: 'restore-to-change-count' | 'not-inspected'
    targetChangeCount?: number
    checkpointCount?: number
  }
  safetyIssues: Array<{
    severity: 'error' | 'warning'
    code: string
    message: string
  }>
}

export interface OmegaEditChangeLogResult {
  state?: OmegaEditEditorState
  uri?: vscode.Uri
  changeCount: number
  appliedCount?: number
  sourceChangeCount?: number
  complete?: boolean
  before?: OmegaEditChangeLogFingerprint
  after?: OmegaEditChangeLogFingerprint
  unavailableChangeCount?: number
  unavailableChangeSerials?: Array<number | string>
  cancelled?: boolean
  preview?: OmegaEditChangeLogPreview
  rollback?: {
    attempted: boolean
    succeeded?: boolean
    rolledBack?: boolean
    targetChangeCount?: number
    error?: string
  }
  finalFingerprint?: OmegaEditChangeLogFingerprint
}

export interface OmegaEditRangeMapLoadResult {
  state?: OmegaEditEditorState
  sourceUri?: vscode.Uri
  source?: string
  nodeCount: number
  highlightCount: number
  selectedPath?: string
  selectedRange?: {
    offset: number
    length: number
  }
  cancelled?: boolean
  message?: string
}

export interface OmegaEditRangeMapUnloadResult {
  state?: OmegaEditEditorState
  unloadedCount: number
  highlightCount: number
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
  getAssistantContext(
    options?: vscode.Uri | string | OmegaEditEditorSelector
  ): OmegaEditAssistantContext | undefined
  setExternalHighlights(
    request: OmegaEditExternalHighlightRequest
  ): Promise<OmegaEditEditorState | undefined>
  clearExternalHighlights(
    options?: vscode.Uri | string | OmegaEditEditorSelector
  ): OmegaEditEditorState | undefined
  loadRangeMap(
    options?: vscode.Uri | string | OmegaEditRangeMapLoadOptions
  ): Promise<OmegaEditRangeMapLoadResult | undefined>
  unloadRangeMap(
    options?: vscode.Uri | string | OmegaEditRangeMapUnloadOptions
  ): OmegaEditRangeMapUnloadResult | undefined
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
  previewChangeLog(
    options?: vscode.Uri | string | OmegaEditChangeLogPreviewOptions
  ): Promise<OmegaEditChangeLogPreview | undefined>
  applyChangeLog(
    options?: vscode.Uri | string | OmegaEditChangeLogApplyOptions
  ): Promise<OmegaEditChangeLogResult | undefined>
}
