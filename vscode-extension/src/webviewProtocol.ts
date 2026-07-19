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

export const MAX_WEBVIEW_HEX_BYTES = 16 * 1024 * 1024
export const MAX_SEARCH_QUERY_LENGTH = 1024 * 1024
export const MAX_TRANSFORM_OPTIONS_LENGTH = 256 * 1024
export const MAX_ANALYSIS_PROFILE_BYTES = 64 * 1024
export const MAX_LABEL_LENGTH = 128
export const MAX_EXTERNAL_HIGHLIGHTS = 512
export const MIN_BYTES_PER_ROW = 8
export const MAX_BYTES_PER_ROW = 64
export const DEFAULT_BYTES_PER_ROW = 16
export const FIXED_BYTES_PER_ROW_OPTIONS = [8, 16, 32, 64] as const
export const TEXT_ENCODING_OPTIONS = [
  'ascii',
  'windows-1252',
  'cp437',
  'ebcdic-037',
  'macroman',
] as const
export const DEFAULT_TEXT_ENCODING = 'ascii'
const TIMELINE_METADATA_EDGE_COUNT = 8
const TIMELINE_METADATA_CONTEXT_RADIUS = 12
const TIMELINE_METADATA_SAVED_RADIUS = 4
const TIMELINE_METADATA_SAMPLE_COUNT = 24

export function checkpointTimelineMetadataWindow(
  checkpointCount: number,
  cursor: number,
  savedCheckpoint?: number
): number[] {
  const checkpoints = new Set<number>()
  const add = (checkpoint: number) => {
    if (checkpoint >= 1 && checkpoint <= checkpointCount) {
      checkpoints.add(checkpoint)
    }
  }
  const addRange = (first: number, last: number) => {
    for (let checkpoint = first; checkpoint <= last; checkpoint += 1) {
      add(checkpoint)
    }
  }

  addRange(1, TIMELINE_METADATA_EDGE_COUNT)
  addRange(checkpointCount - TIMELINE_METADATA_EDGE_COUNT + 1, checkpointCount)
  addRange(
    cursor - TIMELINE_METADATA_CONTEXT_RADIUS,
    cursor + TIMELINE_METADATA_CONTEXT_RADIUS
  )
  if (savedCheckpoint !== undefined) {
    addRange(
      savedCheckpoint - TIMELINE_METADATA_SAVED_RADIUS,
      savedCheckpoint + TIMELINE_METADATA_SAVED_RADIUS
    )
  }
  if (checkpointCount > 1) {
    for (let index = 0; index < TIMELINE_METADATA_SAMPLE_COUNT; index += 1) {
      add(
        1 +
          Math.round(
            ((checkpointCount - 1) * index) /
              (TIMELINE_METADATA_SAMPLE_COUNT - 1)
          )
      )
    }
  }

  return [...checkpoints].sort((left, right) => left - right)
}

export type BytesPerRow = number
export type BytesPerRowMode = 'fixed' | 'auto'
export type OffsetRadix = 'hex' | 'dec'
export type GridEditPane = 'hex' | 'ascii'
export type WebviewEditMode = 'insert' | 'overwrite'
export type InsertDirection = 'forward' | 'backward'
export type TextEncoding = (typeof TEXT_ENCODING_OPTIONS)[number]
export type WebviewSessionContentSource =
  | 'original'
  | 'computed'
  | 'latestCheckpoint'
export type ExternalHighlightKind =
  | 'current'
  | 'parsed'
  | 'error'
  | 'warning'
  | 'breakpoint'
  | 'secondary'

export interface WebviewProtocolContext {
  readonly fileSize: number
  readonly contentSources?: readonly WebviewSessionContentInfo[]
}

export interface WebviewTransformPlugin {
  id: string
  name: string
  description: string
  operation: number
  support: number
  flags: number
  abiVersion: number
  help: string
  example: string
  defaultArgs: string
  argsSchema: string
}

export interface WebviewCharacterCount {
  byteOrderMark: string
  byteOrderMarkBytes: number
  singleByteCount: number
  doubleByteCount: number
  tripleByteCount: number
  quadByteCount: number
  invalidBytes: number
}

export interface WebviewSessionContentInfo {
  content: WebviewSessionContentSource
  available: boolean
  byteLength: number
  label: string
}

export const WEBVIEW_ACTION_JOURNAL_KINDS = [
  'INSERT',
  'DELETE',
  'OVERWRITE',
  'REPLACE',
  'TRANSFORM',
] as const

export type WebviewActionJournalKind =
  (typeof WEBVIEW_ACTION_JOURNAL_KINDS)[number]

export interface WebviewActionJournalEntry {
  index: string
  firstSerial: string
  lastSerial: string
  kind: WebviewActionJournalKind
  offset: string
  length: string
  dataLength: string
  sizeDelta: string
  changeCountBefore: string
  changeCountAfter: string
  checkpointBefore?: string
  checkpointAfter?: string
  transactionId?: string
  payloadHint: 'none' | 'inline' | 'file-backed' | 'checkpoint-backed'
  transform?: {
    transformId: string
    optionsJson?: string
    replacementLength: string
    computedFileSizeBefore: string
    computedFileSizeAfter: string
  }
}

export interface WebviewActionJournalViewport {
  version: 1
  activeTipSerial: string
  changeCount: string
  undoCount: string
  checkpointCount: string
  anchorSerial: string
  capacity: number
  direction: 'older' | 'newer'
  entries: WebviewActionJournalEntry[]
  hasMore: boolean
  nextAnchorSerial?: string
}

export interface WebviewActionJournalCheckpoint {
  checkpoint: number
  changeCount: number
  sourceChangeCount?: string
  byteLengthAfter: string
  boundaryKind: 'plain' | 'transform' | 'tip'
  createdAt: number
  available: boolean
}

export interface WebviewExternalHighlight {
  id: string
  offset: number
  length: number
  kind: ExternalHighlightKind
  label: string
  source?: string
  stale?: boolean
}

export interface WebviewRangeMapNode {
  id: string
  path: string
  label: string
  offset: number
  length: number
  kind: ExternalHighlightKind
  source?: string
  type?: string
  value?: string
  stale?: boolean
  children: WebviewRangeMapNode[]
}

export interface WebviewEditorUiState {
  visibleOffset: number
  visibleByteCount: number
  selectedOffset: number
  selectionStart: number
  selectionEnd: number
  selectionLength: number
  bytesPerRow: BytesPerRow
  offsetRadix: OffsetRadix
  textEncoding: TextEncoding
  activePane: GridEditPane
  editMode: WebviewEditMode
  insertDirection: InsertDirection
}

export interface WebviewEditorState extends WebviewEditorUiState {
  uri: string
  filePath: string
  fileSize: number
  transformInFlight: boolean
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  undoCount: number
  redoCount: number
  savedChangeDepth: number
  changeCount: number
  sessionSyncVersion: number
  externalHighlights: WebviewExternalHighlight[]
  transformSummaries: Array<{
    id: string
    name: string
    description: string
    operation: number
    support: number
    flags: number
  }>
  contentSources: WebviewSessionContentInfo[]
}

export type WebviewToHostMessage =
  | ({ type: 'editorStateChanged' } & WebviewEditorUiState)
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'scrollTo'; offset: number }
  | { type: 'setViewportMetrics'; visibleRows: number }
  | { type: 'setBytesPerRow'; bytesPerRow: BytesPerRow; persist?: boolean }
  | { type: 'setBytesPerRowMode'; mode: BytesPerRowMode }
  | { type: 'setTextEncoding'; textEncoding: TextEncoding }
  | {
      type: 'requestAnalysisProfile'
      offset: number
      length: number
      requestKey: string
      scopeLabel: string
      requestedLength: number
      isCapped: boolean
    }
  | { type: 'requestTransformPlugins' }
  | { type: 'cancelTransform' }
  | {
      type: 'copySelection'
      offset: number
      length: number
      format: 'hex' | 'utf8'
    }
  | {
      type: 'cutSelection'
      offset: number
      length: number
      format: 'hex' | 'utf8'
    }
  | { type: 'insert'; offset: number; data: string }
  | { type: 'delete'; offset: number; length: number }
  | { type: 'overwrite'; offset: number; data: string }
  | { type: 'replace'; offset: number; length: number; data: string }
  | { type: 'exportRange'; offset: number; length: number }
  | { type: 'insertFile'; offset: number }
  | { type: 'replaceRangeWithFile'; offset: number; length: number }
  | { type: 'createCheckpoint' }
  | { type: 'rollbackCheckpoint' }
  | { type: 'restoreCheckpoint' }
  // Internal checkpoint-replay hook retained after retiring the standalone timeline UI.
  | { type: 'navigateCheckpointTimeline'; checkpoint: number }
  | { type: 'exportChangeLog' }
  | {
      type: 'requestActionJournalViewport'
      anchorSerial?: string
      capacity?: number
      direction?: 'older' | 'newer'
      append?: boolean
    }
  | { type: 'hideActionJournal' }
  | { type: 'applyChangeLog' }
  | { type: 'loadRangeMap' }
  | { type: 'unloadRangeMap' }
  | { type: 'toggleEditMode' }
  | { type: 'setInsertDirection'; insertDirection: InsertDirection }
  | {
      type: 'applyTransform'
      pluginId: string
      contentSource?: WebviewSessionContentSource
      offset: number
      length: number
      optionsJson?: string
    }
  | {
      type: 'replaceAllMatches'
      query: string
      isHex: boolean
      caseInsensitive?: boolean
      isReverse?: boolean
      textEncoding?: TextEncoding
      length: number
      data: string
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'save' }
  | { type: 'saveAs' }
  | { type: 'revert' }
  | {
      type: 'search'
      query: string
      isHex: boolean
      caseInsensitive?: boolean
      isReverse?: boolean
      textEncoding?: TextEncoding
    }
  | { type: 'goToMatch'; offset: number }
  | {
      type: 'findAdjacentMatch'
      query: string
      isHex: boolean
      caseInsensitive?: boolean
      textEncoding?: TextEncoding
      direction: 'forward' | 'backward'
      offset: number
    }
  | {
      type: 'searchViewportMatches'
      query: string
      isHex: boolean
      caseInsensitive?: boolean
      textEncoding?: TextEncoding
      viewportOffset: number
      viewportLength: number
    }

export type HostToWebviewMessage =
  | {
      type: 'viewportData'
      offset: number
      visibleOffset: number
      data: number[]
      length: number
      fileSize: number
      followingByteCount: number
      externalHighlights: WebviewExternalHighlight[]
      rangeMapTree: WebviewRangeMapNode[]
      profile: {
        fetchDurationMs: number
        sentAt: number
        payloadBytes: number
        capacity: number
        visibleRows: number
        changeCount: number
        sessionSyncVersion: number
      }
    }
  | { type: 'fileSizeChanged'; fileSize: number }
  | { type: 'documentReverted' }
  | {
      type: 'editState'
      canUndo: boolean
      canRedo: boolean
      undoCount: number
      redoCount: number
      isDirty: boolean
      savedChangeDepth: number
    }
  | {
      type: 'transformPlugins'
      plugins: WebviewTransformPlugin[]
      error?: string
    }
  | {
      type: 'sessionContentInfo'
      contentSources: WebviewSessionContentInfo[]
    }
  | {
      type: 'transformStatus'
      inFlight: boolean
      pluginId?: string
      message?: string
      operationId?: string
      processedBytes?: number
      totalBytes?: number
      percent?: number
      phase?: string
      indeterminate?: boolean
    }
  | {
      type: 'transformComplete'
      pluginId: string
      offset: number
      length: number
      operation: number
      contentSource: WebviewSessionContentSource
      contentChanged: boolean
      serial?: number
      replacementLength: number
      computedFileSize: number
      descriptorJson: string
      descriptorHex: string
      resultLabel: string
      resultMimeType: string
      resultText: string
    }
  | {
      type: 'fileActionComplete'
      action: 'exportRange' | 'insertFile' | 'replaceRangeWithFile'
      offset: number
      length: number
      byteCount: number
      fileName?: string
      cancelled?: boolean
      message?: string
    }
  | {
      type: 'sessionActionComplete'
      action:
        | 'createCheckpoint'
        | 'rollbackCheckpoint'
        | 'restoreCheckpoint'
        | 'exportChangeLog'
        | 'applyChangeLog'
      changeCount?: number
      checkpointCount?: number
      cancelled?: boolean
      message?: string
    }
  | {
      type: 'checkpointTimeline'
      visible: boolean
      cursor: number
      checkpointCount: number
      originalByteLength: string
      savedChangeCount: number
      savedCheckpoint?: number
      savedOffBranch: boolean
      canRewind: boolean
      canFastForward: boolean
      navigating: boolean
      checkpoints: Array<
        WebviewActionJournalCheckpoint & {
          sourceChangeCount: string
          replayChangeCount?: string
          byteLengthBefore: string
          archiveByteLength?: string
          transformPluginIds: string[]
          missingPluginIds: string[]
          optimized: boolean
          error?: string
        }
      >
    }
  | {
      type: 'actionJournalViewport'
      visible: boolean
      append: boolean
      viewport: WebviewActionJournalViewport
    }
  | {
      type: 'actionJournalError'
      visible: boolean
      message: string
    }
  | { type: 'actionJournalHidden' }
  | {
      type: 'clipboardComplete'
      action: 'copy' | 'cut'
      byteCount: number
      format: 'hex' | 'utf8'
      offset: number
    }
  | {
      type: 'analysisProfile'
      requestKey: string
      scopeLabel: string
      offset: number
      length: number
      requestedLength: number
      isCapped: boolean
      durationMs: number
      byteProfile: number[]
      numAscii: number
      characterCount: WebviewCharacterCount
    }
  | { type: 'searchStateCleared' }
  | { type: 'cutComplete'; offset: number }
  | {
      type: 'replaceComplete'
      scope: 'single' | 'all'
      replacedOffset?: number
      offsetDelta?: number
      selectionOffset: number
      replacedCount: number
    }
  | {
      type: 'searchResults'
      mode: string
      matches: number[]
      currentOffset: number
      patternLength: number
      windowLimit: number
    }
  | {
      type: 'searchNavigationResult'
      offset: number
      patternLength: number
      viewportOffset?: number
      viewportLength?: number
      viewportMatches?: number[]
      viewportHasMoreMatches?: boolean
    }
  | {
      type: 'searchViewportMatchesResult'
      viewportOffset: number
      viewportLength: number
      matches: number[]
      patternLength: number
    }
  | {
      type: 'searchNavigationCommand'
      direction: 'forward' | 'backward'
    }
  | {
      type: 'externalHighlights'
      highlights: WebviewExternalHighlight[]
    }
  | {
      type: 'rangeMapTree'
      tree: WebviewRangeMapNode[]
    }
  | {
      type: 'bytesPerRow'
      bytesPerRow: BytesPerRow
      bytesPerRowMode: BytesPerRowMode
    }
  | {
      type: 'textEncoding'
      textEncoding: TextEncoding
    }
  | {
      type: 'editMode'
      editMode: WebviewEditMode
    }
  | {
      type: 'insertDirection'
      insertDirection: InsertDirection
    }
  | ServerHealthMessage

export type ServerHealthMetricId =
  | 'version'
  | 'client'
  | 'host'
  | 'pid'
  | 'runtime'
  | 'latency'
  | 'sessions'
  | 'uptime'
  | 'logicalCpus'
  | 'loadAverage'
  | 'platform'
  | 'compiler'
  | 'build'
  | 'cppStandard'
  | 'residentMemory'
  | 'virtualMemory'
  | 'peakResidentMemory'
  | 'error'

export interface ServerHealthMetric {
  id: ServerHealthMetricId
  label: string
  value: string
}

export interface ServerHealthMessage {
  type: 'serverHealth'
  ok: boolean
  summary: string
  detail: string
  severity: 'ok' | 'warn' | 'error' | 'down'
  metrics: ServerHealthMetric[]
}

export function normalizeBytesPerRow(value: unknown): BytesPerRow {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= MIN_BYTES_PER_ROW &&
    value <= MAX_BYTES_PER_ROW
    ? value
    : DEFAULT_BYTES_PER_ROW
}

export function normalizeBytesPerRowSetting(value: unknown): number {
  return normalizeBytesPerRow(value)
}

export function bytesPerRowFromSetting(value: unknown): BytesPerRow {
  return normalizeBytesPerRowSetting(value)
}

export function normalizeBytesPerRowMode(value: unknown): BytesPerRowMode {
  void value
  return 'fixed'
}

export function normalizeTextEncoding(value: unknown): TextEncoding {
  return TEXT_ENCODING_OPTIONS.includes(value as TextEncoding)
    ? (value as TextEncoding)
    : DEFAULT_TEXT_ENCODING
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function safeNonNegativeInteger(
  value: unknown,
  max = Number.MAX_SAFE_INTEGER
): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max
    ? value
    : undefined
}

function safeIntegerAtLeast(
  value: unknown,
  min: number,
  max = Number.MAX_SAFE_INTEGER
): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined
}

function safeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function safeString(
  value: unknown,
  maxLength: number,
  allowEmpty = false
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value.trim()
  if ((!allowEmpty && text.length === 0) || text.length > maxLength) {
    return undefined
  }
  return text
}

function safeHexString(
  value: unknown,
  maxBytes: number,
  allowEmpty = false
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value.replace(/\s/g, '')
  if ((!allowEmpty && text.length === 0) || text.length > maxBytes * 2) {
    return undefined
  }
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) {
    return undefined
  }
  return text
}

function safeJsonString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value.trim()
  if (text.length === 0) {
    return undefined
  }
  if (text.length > maxLength) {
    return undefined
  }
  try {
    JSON.parse(text)
  } catch {
    return undefined
  }
  return text
}

function safeFileLengthRange(
  context: WebviewProtocolContext,
  offsetValue: unknown,
  lengthValue: unknown,
  allowZeroLength = false,
  maxLength = Number.MAX_SAFE_INTEGER
): { offset: number; length: number } | undefined {
  const offset = safeNonNegativeInteger(offsetValue)
  const length = safeNonNegativeInteger(lengthValue, maxLength)
  if (offset === undefined || length === undefined) {
    return undefined
  }
  if ((!allowZeroLength && length === 0) || offset > context.fileSize) {
    return undefined
  }
  if (length > Math.max(0, context.fileSize - offset)) {
    return undefined
  }
  return { offset, length }
}

function safeSessionContentSource(
  value: unknown
): WebviewSessionContentSource | undefined {
  return value === 'original' ||
    value === 'computed' ||
    value === 'latestCheckpoint'
    ? value
    : undefined
}

function sessionContentByteLength(
  context: WebviewProtocolContext,
  contentSource: WebviewSessionContentSource
): number | undefined {
  if (contentSource === 'computed') {
    return context.fileSize
  }
  const entry = context.contentSources?.find(
    (candidate) => candidate.content === contentSource && candidate.available
  )
  return entry?.byteLength
}

function safeContentLengthRange(
  context: WebviewProtocolContext,
  contentSource: WebviewSessionContentSource,
  offsetValue: unknown,
  lengthValue: unknown,
  allowZeroLength = false,
  maxLength = Number.MAX_SAFE_INTEGER
): { offset: number; length: number } | undefined {
  const byteLength = sessionContentByteLength(context, contentSource)
  if (byteLength === undefined) {
    return undefined
  }
  return safeFileLengthRange(
    { fileSize: byteLength },
    offsetValue,
    lengthValue,
    allowZeroLength,
    maxLength
  )
}

function safeFileOffset(
  context: WebviewProtocolContext,
  value: unknown,
  allowEnd = false
): number | undefined {
  const maxOffset = allowEnd
    ? context.fileSize
    : Math.max(0, context.fileSize - 1)
  return safeNonNegativeInteger(value, maxOffset)
}

function safeSearchQuery(message: Record<string, unknown>): string | undefined {
  const isHex = message.isHex === true
  return isHex
    ? safeHexString(message.query, MAX_SEARCH_QUERY_LENGTH, false)
    : safeString(message.query, MAX_SEARCH_QUERY_LENGTH)
}

function safeOffsetRadix(value: unknown): OffsetRadix | undefined {
  return value === 'hex' || value === 'dec' ? value : undefined
}

function safeTextEncoding(value: unknown): TextEncoding | undefined {
  const textEncoding = normalizeTextEncoding(value)
  return value === textEncoding ? textEncoding : undefined
}

function safeGridEditPane(value: unknown): GridEditPane | undefined {
  return value === 'hex' || value === 'ascii' ? value : undefined
}

function safeWebviewEditMode(value: unknown): WebviewEditMode | undefined {
  return value === 'insert' || value === 'overwrite' ? value : undefined
}

function safeInsertDirection(value: unknown): InsertDirection | undefined {
  return value === 'forward' || value === 'backward' ? value : undefined
}

function safeExternalHighlightKind(
  value: unknown
): ExternalHighlightKind | undefined {
  return value === 'current' ||
    value === 'parsed' ||
    value === 'error' ||
    value === 'warning' ||
    value === 'breakpoint' ||
    value === 'secondary'
    ? value
    : undefined
}

function safeActionJournalDecimal(value: unknown): string | undefined {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value)
    ? value
    : undefined
}

function normalizeEditorUiState(
  context: WebviewProtocolContext,
  raw: Record<string, unknown>
): WebviewEditorUiState | undefined {
  const visibleOffset = safeNonNegativeInteger(raw.visibleOffset)
  const visibleByteCount = safeNonNegativeInteger(
    raw.visibleByteCount,
    MAX_WEBVIEW_HEX_BYTES
  )
  const selectedOffset = safeIntegerAtLeast(raw.selectedOffset, -1)
  const selectionStart = safeIntegerAtLeast(raw.selectionStart, -1)
  const selectionEnd = safeIntegerAtLeast(raw.selectionEnd, -1)
  const selectionLength = safeNonNegativeInteger(
    raw.selectionLength,
    MAX_WEBVIEW_HEX_BYTES
  )
  const bytesPerRow = normalizeBytesPerRow(raw.bytesPerRow)
  const offsetRadix = safeOffsetRadix(raw.offsetRadix)
  const textEncoding = safeTextEncoding(raw.textEncoding)
  const activePane = safeGridEditPane(raw.activePane)
  const editMode = safeWebviewEditMode(raw.editMode)
  const insertDirection = safeInsertDirection(raw.insertDirection) ?? 'forward'

  if (
    visibleOffset === undefined ||
    visibleByteCount === undefined ||
    selectedOffset === undefined ||
    selectionStart === undefined ||
    selectionEnd === undefined ||
    selectionLength === undefined ||
    raw.bytesPerRow !== bytesPerRow ||
    !offsetRadix ||
    !textEncoding ||
    !activePane ||
    !editMode ||
    !insertDirection
  ) {
    return undefined
  }

  if (
    visibleOffset > context.fileSize ||
    visibleByteCount > Math.max(0, context.fileSize - visibleOffset)
  ) {
    return undefined
  }

  if (selectedOffset > context.fileSize) {
    return undefined
  }

  const hasSelection = selectionStart >= 0 || selectionEnd >= 0
  if (
    hasSelection &&
    (selectionStart < 0 ||
      selectionEnd < selectionStart ||
      selectionEnd >= context.fileSize ||
      selectionLength !== selectionEnd - selectionStart + 1)
  ) {
    return undefined
  }

  if (!hasSelection && selectionLength !== 0) {
    return undefined
  }

  return {
    visibleOffset,
    visibleByteCount,
    selectedOffset,
    selectionStart,
    selectionEnd,
    selectionLength,
    bytesPerRow,
    offsetRadix,
    textEncoding,
    activePane,
    editMode,
    insertDirection,
  }
}

export function normalizeExternalHighlights(
  context: WebviewProtocolContext,
  rawHighlights: unknown
): WebviewExternalHighlight[] | undefined {
  if (
    !Array.isArray(rawHighlights) ||
    rawHighlights.length > MAX_EXTERNAL_HIGHLIGHTS
  ) {
    return undefined
  }

  const highlights: WebviewExternalHighlight[] = []
  const ids = new Set<string>()
  for (const rawHighlight of rawHighlights) {
    if (!isRecord(rawHighlight)) {
      return undefined
    }

    const id = safeString(rawHighlight.id, MAX_LABEL_LENGTH)
    const offset = safeNonNegativeInteger(rawHighlight.offset)
    const length = safeNonNegativeInteger(
      rawHighlight.length,
      MAX_WEBVIEW_HEX_BYTES
    )
    const kind = safeExternalHighlightKind(rawHighlight.kind)
    const label =
      safeString(rawHighlight.label, MAX_LABEL_LENGTH, true) ?? kind ?? ''
    const source =
      rawHighlight.source === undefined
        ? undefined
        : safeString(rawHighlight.source, MAX_LABEL_LENGTH)

    if (
      !id ||
      ids.has(id) ||
      offset === undefined ||
      length === undefined ||
      length === 0 ||
      !kind ||
      offset >= context.fileSize ||
      length > Math.max(0, context.fileSize - offset) ||
      (rawHighlight.source !== undefined && source === undefined)
    ) {
      return undefined
    }

    ids.add(id)
    highlights.push({
      id,
      offset,
      length,
      kind,
      label: label || kind,
      source,
      ...(rawHighlight.stale === true ? { stale: true } : {}),
    })
  }

  return highlights
}

export function normalizeWebviewMessage(
  context: WebviewProtocolContext,
  raw: unknown
): WebviewToHostMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return undefined
  }

  switch (raw.type) {
    case 'editorStateChanged': {
      const state = normalizeEditorUiState(context, raw)
      return state ? { type: 'editorStateChanged', ...state } : undefined
    }

    case 'scroll':
      return raw.direction === 'up' || raw.direction === 'down'
        ? { type: 'scroll', direction: raw.direction }
        : undefined

    case 'scrollTo': {
      const offset = safeFileOffset(context, raw.offset)
      return offset === undefined ? undefined : { type: 'scrollTo', offset }
    }

    case 'setViewportMetrics': {
      const visibleRows = safeNonNegativeInteger(raw.visibleRows, 100_000)
      return visibleRows === undefined
        ? undefined
        : { type: 'setViewportMetrics', visibleRows }
    }

    case 'setBytesPerRow': {
      const bytesPerRow = normalizeBytesPerRow(raw.bytesPerRow)
      const persist =
        raw.persist === undefined
          ? undefined
          : typeof raw.persist === 'boolean'
            ? raw.persist
            : null
      return raw.bytesPerRow === bytesPerRow && persist !== null
        ? {
            type: 'setBytesPerRow',
            bytesPerRow,
            ...(persist === undefined ? {} : { persist }),
          }
        : undefined
    }

    case 'setBytesPerRowMode': {
      return raw.mode === 'fixed'
        ? { type: 'setBytesPerRowMode', mode: raw.mode }
        : undefined
    }

    case 'setTextEncoding': {
      const textEncoding = safeTextEncoding(raw.textEncoding)
      return textEncoding
        ? { type: 'setTextEncoding', textEncoding }
        : undefined
    }

    case 'requestAnalysisProfile': {
      const range = safeFileLengthRange(context, raw.offset, raw.length)
      const requestedLength = safeNonNegativeInteger(raw.requestedLength)
      const requestKey = safeString(raw.requestKey, MAX_LABEL_LENGTH)
      const scopeLabel = safeString(raw.scopeLabel, MAX_LABEL_LENGTH)
      if (
        !range ||
        requestedLength === undefined ||
        !requestKey ||
        !scopeLabel
      ) {
        return undefined
      }
      return {
        type: 'requestAnalysisProfile',
        offset: range.offset,
        length: Math.min(range.length, MAX_ANALYSIS_PROFILE_BYTES),
        requestKey,
        scopeLabel,
        requestedLength,
        isCapped: safeBoolean(raw.isCapped),
      }
    }

    case 'requestTransformPlugins':
    case 'cancelTransform':
    case 'createCheckpoint':
    case 'rollbackCheckpoint':
    case 'restoreCheckpoint':
    case 'exportChangeLog':
    case 'applyChangeLog':
    case 'loadRangeMap':
    case 'unloadRangeMap':
    case 'undo':
    case 'redo':
    case 'save':
    case 'saveAs':
    case 'revert':
      return { type: raw.type }

    case 'hideActionJournal':
      return { type: raw.type }

    case 'requestActionJournalViewport': {
      const anchorSerial =
        raw.anchorSerial === undefined
          ? undefined
          : safeActionJournalDecimal(raw.anchorSerial)
      const capacity =
        raw.capacity === undefined
          ? undefined
          : safeNonNegativeInteger(raw.capacity, 1000)
      const direction =
        raw.direction === undefined
          ? undefined
          : raw.direction === 'older' || raw.direction === 'newer'
            ? raw.direction
            : null
      if (
        (raw.anchorSerial !== undefined && anchorSerial === undefined) ||
        (raw.capacity !== undefined && capacity === undefined) ||
        (capacity !== undefined && capacity === 0) ||
        direction === null ||
        (raw.append !== undefined && typeof raw.append !== 'boolean')
      ) {
        return undefined
      }
      return {
        type: raw.type,
        ...(anchorSerial === undefined ? {} : { anchorSerial }),
        ...(capacity === undefined ? {} : { capacity }),
        ...(direction === undefined ? {} : { direction }),
        ...(raw.append === undefined ? {} : { append: raw.append }),
      }
    }

    case 'navigateCheckpointTimeline': {
      const checkpoint = safeNonNegativeInteger(raw.checkpoint)
      return checkpoint !== undefined
        ? { type: raw.type, checkpoint }
        : undefined
    }

    case 'copySelection':
    case 'cutSelection': {
      const range = safeFileLengthRange(
        context,
        raw.offset,
        raw.length,
        false,
        MAX_WEBVIEW_HEX_BYTES
      )
      if (!range || (raw.format !== 'hex' && raw.format !== 'utf8')) {
        return undefined
      }
      return {
        type: raw.type,
        ...range,
        format: raw.format,
      }
    }

    case 'insert': {
      const offset = safeNonNegativeInteger(raw.offset)
      const data = safeHexString(raw.data, MAX_WEBVIEW_HEX_BYTES)
      if (offset === undefined || offset > context.fileSize || !data) {
        return undefined
      }
      return { type: 'insert', offset, data }
    }

    case 'delete': {
      const range = safeFileLengthRange(context, raw.offset, raw.length)
      return range ? { type: 'delete', ...range } : undefined
    }

    case 'overwrite': {
      const offset = safeNonNegativeInteger(raw.offset)
      const data = safeHexString(raw.data, MAX_WEBVIEW_HEX_BYTES)
      if (
        offset === undefined ||
        !data ||
        offset >= context.fileSize ||
        data.length / 2 > Math.max(0, context.fileSize - offset)
      ) {
        return undefined
      }
      return { type: 'overwrite', offset, data }
    }

    case 'replace': {
      const range = safeFileLengthRange(context, raw.offset, raw.length, true)
      const data = safeHexString(raw.data, MAX_WEBVIEW_HEX_BYTES, true)
      return range && data !== undefined
        ? { type: 'replace', ...range, data }
        : undefined
    }

    case 'exportRange': {
      const range = safeFileLengthRange(context, raw.offset, raw.length)
      return range ? { type: 'exportRange', ...range } : undefined
    }

    case 'insertFile': {
      const offset = safeFileOffset(context, raw.offset, true)
      return offset === undefined ? undefined : { type: 'insertFile', offset }
    }

    case 'replaceRangeWithFile': {
      const range = safeFileLengthRange(context, raw.offset, raw.length)
      return range ? { type: 'replaceRangeWithFile', ...range } : undefined
    }

    case 'toggleEditMode':
      return { type: 'toggleEditMode' }

    case 'setInsertDirection': {
      const insertDirection = safeInsertDirection(raw.insertDirection)
      return insertDirection
        ? { type: 'setInsertDirection', insertDirection }
        : undefined
    }

    case 'replaceAllMatches': {
      const query = safeSearchQuery(raw)
      const data = safeHexString(raw.data, MAX_WEBVIEW_HEX_BYTES, true)
      const length = safeNonNegativeInteger(raw.length)
      const textEncoding =
        raw.textEncoding === undefined
          ? undefined
          : safeTextEncoding(raw.textEncoding)
      if (
        !query ||
        data === undefined ||
        !length ||
        (raw.textEncoding !== undefined && !textEncoding)
      ) {
        return undefined
      }
      return {
        type: 'replaceAllMatches',
        query,
        isHex: raw.isHex === true,
        caseInsensitive: safeBoolean(raw.caseInsensitive),
        isReverse: safeBoolean(raw.isReverse),
        ...(textEncoding ? { textEncoding } : {}),
        length,
        data,
      }
    }

    case 'applyTransform': {
      const pluginId = safeString(raw.pluginId, MAX_LABEL_LENGTH)
      const contentSource =
        raw.contentSource === undefined
          ? 'computed'
          : safeSessionContentSource(raw.contentSource)
      // Transform APIs use zero length as the sentinel for offset through EOF.
      const range = contentSource
        ? safeContentLengthRange(
            context,
            contentSource,
            raw.offset,
            raw.length,
            true
          )
        : undefined
      const optionsJson =
        raw.optionsJson === undefined
          ? undefined
          : safeJsonString(raw.optionsJson, MAX_TRANSFORM_OPTIONS_LENGTH)
      if (
        !pluginId ||
        !contentSource ||
        !range ||
        (raw.optionsJson !== undefined && optionsJson === undefined)
      ) {
        return undefined
      }
      return {
        type: 'applyTransform',
        pluginId,
        contentSource,
        ...range,
        optionsJson,
      }
    }

    case 'search': {
      const query = safeSearchQuery(raw)
      const textEncoding =
        raw.textEncoding === undefined
          ? undefined
          : safeTextEncoding(raw.textEncoding)
      if (!query || (raw.textEncoding !== undefined && !textEncoding)) {
        return undefined
      }
      return {
        type: 'search',
        query,
        isHex: raw.isHex === true,
        caseInsensitive: safeBoolean(raw.caseInsensitive),
        isReverse: safeBoolean(raw.isReverse),
        ...(textEncoding ? { textEncoding } : {}),
      }
    }

    case 'goToMatch': {
      const offset = safeFileOffset(context, raw.offset)
      return offset === undefined ? undefined : { type: 'goToMatch', offset }
    }

    case 'findAdjacentMatch': {
      const query = safeSearchQuery(raw)
      const offset = safeFileOffset(context, raw.offset)
      const textEncoding =
        raw.textEncoding === undefined
          ? undefined
          : safeTextEncoding(raw.textEncoding)
      if (
        !query ||
        offset === undefined ||
        (raw.textEncoding !== undefined && !textEncoding) ||
        (raw.direction !== 'forward' && raw.direction !== 'backward')
      ) {
        return undefined
      }
      return {
        type: 'findAdjacentMatch',
        query,
        isHex: raw.isHex === true,
        caseInsensitive: safeBoolean(raw.caseInsensitive),
        ...(textEncoding ? { textEncoding } : {}),
        direction: raw.direction,
        offset,
      }
    }

    case 'searchViewportMatches': {
      const query = safeSearchQuery(raw)
      const textEncoding =
        raw.textEncoding === undefined
          ? undefined
          : safeTextEncoding(raw.textEncoding)
      const viewportOffset = safeFileOffset(context, raw.viewportOffset)
      const viewportLength = safeIntegerAtLeast(raw.viewportLength, 1)
      if (
        !query ||
        viewportOffset === undefined ||
        viewportLength === undefined ||
        viewportLength <= 0 ||
        (raw.textEncoding !== undefined && !textEncoding)
      ) {
        return undefined
      }
      return {
        type: 'searchViewportMatches',
        query,
        isHex: raw.isHex === true,
        caseInsensitive: safeBoolean(raw.caseInsensitive),
        ...(textEncoding ? { textEncoding } : {}),
        viewportOffset,
        viewportLength,
      }
    }

    default:
      return undefined
  }
}
