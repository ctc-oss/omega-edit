export type InputEncoding = 'utf8' | 'hex' | 'base64'
export type PatchKind = 'insert' | 'overwrite' | 'delete' | 'replace'
export type ChangeLogEntryKind =
  | 'INSERT'
  | 'DELETE'
  | 'OVERWRITE'
  | 'REPLACE'
  | 'TRANSFORM'

export interface ToolkitOptions {
  host?: string
  port?: number
  autoStart?: boolean
  maxReadBytes?: number
  maxEditBytes?: number
  maxSearchResults?: number
  previewContextBytes?: number
}

export interface EncodedData {
  byteLength: number
  hex: string
  base64: string
  utf8: string
}

export interface SessionStatus {
  sessionId: string
  computedSize: number
  changeCount: number
  undoCount: number
  viewportCount: number
  checkpointCount: number
  lastChange?: {
    kind: string
    offset: number
    length: number
    data: EncodedData
  }
}

export interface ChangeLogEntry {
  serial?: number
  kind: ChangeLogEntryKind
  offset: number
  length: number
  data: string
  transformId?: string
  optionsJson?: string
  replacementLength?: number
  computedFileSizeBefore?: number
  computedFileSizeAfter?: number
  groupId?: string
}

export interface ChangeLogDigest {
  algorithm: string
  value: string
}

export interface ChangeLogFingerprint {
  byteLength: number
  digest: ChangeLogDigest
}

export interface ChangeLogDocument {
  format: 'omega-edit.change-log'
  version: 2
  complete: boolean
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  changeCount: number
  sourceChangeCount: number
  unavailableChangeCount: number
  unavailableChangeSerials: number[]
  changes: ChangeLogEntry[]
}

export interface ChangeLogResult {
  sessionId: string
  format: 'omega-edit.change-log'
  version: 2
  complete: boolean
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  changeCount: number
  sourceChangeCount: number
  unavailableChangeCount: number
  unavailableChangeSerials: number[]
  changes: ChangeLogEntry[]
  outputPath?: string
}

export interface ApplyChangeLogRequest {
  sessionId: string
  changes?: ChangeLogDocument
  inputPath?: string
  dryRun?: boolean
}

export interface ApplyChangeLogResult {
  sessionId: string
  applied: boolean
  changeCount: number
  inputChangeCount: number
  inputPath?: string
}

export interface CheckpointResult {
  sessionId: string
  checkpointCount: number
}

export interface RollbackCheckpointResult {
  sessionId: string
  rolledBack: boolean
  checkpointCount: number
}

export interface ReadRangeResult {
  sessionId: string
  offset: number
  requestedLength: number
  actualLength: number
  data: EncodedData
}

export interface ByteFrequencyEntry {
  byte: number
  hex: string
  count: number
  percent: number
  printable?: string
}

export interface ProfileRangeResult {
  sessionId: string
  offset: number
  requestedLength: number
  actualLength: number
  totalBytes: number
  asciiBytes: number
  nonAsciiBytes: number
  asciiPercent: number
  dosLineEndings: number
  contentType: string
  frequency: number[]
  topBytes: ByteFrequencyEntry[]
}

export interface SearchRequest {
  sessionId: string
  pattern: string | Uint8Array
  inputEncoding?: InputEncoding
  caseInsensitive?: boolean
  reverse?: boolean
  offset?: number
  length?: number
  limit?: number
}

export interface SearchResult {
  sessionId: string
  offset: number
  length: number
  limit: number
  matches: number[]
}

export interface ReplaceSessionRequest {
  sessionId: string
  pattern: string | Uint8Array
  replacement: string | Uint8Array
  inputEncoding?: InputEncoding
  caseInsensitive?: boolean
  reverse?: boolean
  offset?: number
  length?: number
  limit?: number
  frontToBack?: boolean
  overwriteOnly?: boolean
}

export interface ReplaceSessionResult {
  sessionId: string
  offset: number
  length: number
  limit: number
  replacedCount: number
  frontToBack: boolean
  overwriteOnly: boolean
}

export interface TransformPluginInfoResult {
  id: string
  name: string
  description: string
  operation: number
  operationName: string
  flags: number
  abiVersion: number
}

export interface ApplyTransformPluginRequest {
  sessionId: string
  pluginId: string
  offset?: number
  length?: number
  optionsJson?: string
}

export interface ApplyTransformPluginResult {
  sessionId: string
  pluginId: string
  offset: number
  length: number
  operation: number
  operationName: string
  contentChanged: boolean
  computedFileSize: number
  replacementLength: number
  resultLabel?: string
  resultMimeType?: string
  result: EncodedData
}

export interface PatchRequest {
  sessionId: string
  kind: PatchKind
  offset: number
  data?: Uint8Array
  removeLength?: number
  previewContext?: number
  dryRun?: boolean
}

export interface PatchPreview {
  sessionId: string
  kind: PatchKind
  offset: number
  removeLength: number
  insertLength: number
  previewOffset: number
  previewBeforeLength: number
  previewAfterLength: number
  targetBefore: EncodedData
  targetAfter: EncodedData
  previewBefore: EncodedData
  previewAfter: EncodedData
}

export interface PatchResult {
  applied: boolean
  serial?: number
  preview: PatchPreview
}
