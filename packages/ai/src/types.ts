export type InputEncoding = 'utf8' | 'hex' | 'base64'
export type PatchKind = 'insert' | 'overwrite' | 'delete' | 'replace'
export type ChangeLogEntryKind =
  | 'INSERT'
  | 'DELETE'
  | 'OVERWRITE'
  | 'REPLACE'
  | 'TRANSFORM'
export type ChangeLogInt64 = number | string | bigint

export interface ToolkitOptions {
  host?: string
  port?: number
  autoStart?: boolean
  maxReadBytes?: number
  maxEditBytes?: number
  maxSearchResults?: number
  previewContextBytes?: number
  insecureAllowNonLoopback?: boolean
}

export interface CancellationSignal {
  readonly aborted: boolean
  addEventListener?(
    type: string,
    listener: (...args: any[]) => void,
    options?: unknown
  ): void
  removeEventListener?(type: string, listener: (...args: any[]) => void): void
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
  undoStackDepth: number
  redoStackDepth: number
  viewportCount: number
  checkpointCount: number
  lastChange?: {
    kind: string
    offset: number
    length: number
    data: EncodedData
  }
}

export interface AssistantCommandSurfaceEntry {
  action: string
  ui?: string
  vscodeCommands?: string[]
  extensionApis?: string[]
  cliCommands?: string[]
  mcpTools?: string[]
  result: string
}

export interface AssistantTransformPluginSummary {
  id: string
  name: string
  description?: string
  operation: number
  operationName?: string
  flags: number
  abiVersion?: number
}

export interface AssistantSessionContext {
  version: 1
  session: {
    id: string
    uri: string | null
    filePath: string | null
    contentType: string | null
    language: string | null
  }
  sizes: {
    computed: number
    original: number | string | null
  }
  dirty: boolean
  selection: {
    offset: number
    start: number
    end: number
    length: number
  } | null
  viewport: {
    count: number
    activeViewportId: string | null
    visibleOffset: number | null
    visibleByteCount: number | null
    bytesPerRow: number | null
    offsetRadix: string | null
    activePane: string | null
    editMode: string | null
    insertDirection: string | null
  }
  history: {
    changeCount: number
    undoCount: number
    redoCount: number
    undoStackDepth: number
    redoStackDepth: number
    canUndo: boolean
    canRedo: boolean
    checkpointCount: number | null
    checkpointAvailable: boolean
    savedChangeDepth: number | null
    pendingChanges: boolean
    pendingOperation: 'undo' | 'redo' | null
    pendingCount: number
  }
  transforms: {
    inFlight: boolean
    available: boolean
    pluginCount: number
    plugins: AssistantTransformPluginSummary[]
  }
  changeLog: {
    format: 'omega-edit.change-log'
    version: 2
    exportAvailable: boolean
    applyAvailable: boolean
    sourceChangeCount: number
    completeExportAvailable: boolean
  }
  commands: AssistantCommandSurfaceEntry[]
}

export interface ChangeLogEntry {
  serial?: ChangeLogInt64
  kind: ChangeLogEntryKind
  offset: ChangeLogInt64
  length: ChangeLogInt64
  data: string
  groupId?: string
}

export interface ChangeLogDigest {
  algorithm: string
  value: string
}

export interface ChangeLogFingerprint {
  byteLength: ChangeLogInt64
  digest: ChangeLogDigest
}

export interface ChangeLogDocument {
  format: 'omega-edit.change-log'
  version: 2
  complete: boolean
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  changeCount: ChangeLogInt64
  sourceChangeCount: ChangeLogInt64
  unavailableChangeCount: ChangeLogInt64
  unavailableChangeSerials: ChangeLogInt64[]
  changes: ChangeLogEntry[]
}

export interface ChangeLogResult {
  sessionId: string
  format: 'omega-edit.change-log'
  version: 2
  complete: boolean
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  changeCount: ChangeLogInt64
  sourceChangeCount: ChangeLogInt64
  unavailableChangeCount: ChangeLogInt64
  unavailableChangeSerials: ChangeLogInt64[]
  changes?: ChangeLogEntry[]
  outputPath?: string
}

export interface ChangeLogPrimitiveCounts {
  total: number
  insert: number
  delete: number
  overwrite: number
  replace: number
  transform: number
}

export interface ChangeLogSizeDelta {
  beforeByteLength: string
  afterByteLength: string
  deltaBytes: string
}

export interface ChangeLogTransformDescriptorPreview {
  index: number
  serial?: ChangeLogInt64
  offset: ChangeLogInt64
  length: ChangeLogInt64
  transformId: string
  optionsJson?: string
  descriptorSource: 'data'
}

export interface ChangeLogUnavailablePrimitives {
  count: ChangeLogInt64
  serials: ChangeLogInt64[]
}

export interface ChangeLogSafetyIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface ChangeLogRollbackProtection {
  available: boolean
  strategy: 'restore-to-change-count' | 'not-inspected'
  targetChangeCount?: number
  checkpointCount?: number
}

export interface ChangeLogPreview {
  sessionId: string
  inputPath?: string
  format: 'omega-edit.change-log'
  version: 2
  complete: boolean
  canApply: boolean
  primitiveCounts: ChangeLogPrimitiveCounts
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  current?: ChangeLogFingerprint
  expectedSize: ChangeLogSizeDelta
  transformDescriptors: ChangeLogTransformDescriptorPreview[]
  requiredPlugins: string[]
  missingPlugins: string[]
  unavailablePrimitives: ChangeLogUnavailablePrimitives
  rollbackProtection: ChangeLogRollbackProtection
  safetyIssues: ChangeLogSafetyIssue[]
}

export interface PreviewChangeLogRequest {
  sessionId: string
  changes?: ChangeLogDocument
  inputPath?: string
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
  appliedCount: number
  changeCount: number
  inputChangeCount: number
  inputPath?: string
  preview?: ChangeLogPreview
  rollback: {
    attempted: boolean
    succeeded?: boolean
    rolledBack?: boolean
    targetChangeCount?: number
    error?: string
  }
  finalFingerprint?: ChangeLogFingerprint
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

export interface RestoreCheckpointResult {
  sessionId: string
  restored: boolean
  checkpointCount: number
  changeCount: number
  discardedChangeCount: number
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
  signal?: CancellationSignal
}

export interface TransformDescriptorResult {
  transformId: string
  args: Record<string, unknown>
  json: string
  dataHex: string
}

export interface ApplyTransformPluginResult {
  sessionId: string
  pluginId: string
  offset: number
  length: number
  operation: number
  operationName: string
  contentChanged: boolean
  serial?: number
  computedFileSize: number
  replacementLength: number
  transformDescriptor: TransformDescriptorResult
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
