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
export const VALID_BYTES_PER_ROW = [8, 16, 32] as const
export const DEFAULT_BYTES_PER_ROW = 16

export type BytesPerRow = (typeof VALID_BYTES_PER_ROW)[number]
export type OffsetRadix = 'hex' | 'dec'
export type GridEditPane = 'hex' | 'ascii'
export type WebviewEditMode = 'insert' | 'overwrite'
export type ExternalHighlightKind =
  | 'current'
  | 'parsed'
  | 'error'
  | 'warning'
  | 'breakpoint'
  | 'secondary'

export interface WebviewProtocolContext {
  readonly fileSize: number
}

export interface WebviewTransformPlugin {
  id: string
  name: string
  description: string
  operation: number
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

export interface WebviewExternalHighlight {
  id: string
  offset: number
  length: number
  kind: ExternalHighlightKind
  label: string
  source?: string
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
  activePane: GridEditPane
  editMode: WebviewEditMode
}

export interface WebviewEditorState extends WebviewEditorUiState {
  uri: string
  filePath: string
  fileSize: number
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
    flags: number
  }>
  contentType?: string
  language?: string
}

export type WebviewToHostMessage =
  | ({ type: 'editorStateChanged' } & WebviewEditorUiState)
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'scrollTo'; offset: number }
  | { type: 'setViewportMetrics'; visibleRows: number }
  | { type: 'setBytesPerRow'; bytesPerRow: BytesPerRow }
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
  | { type: 'toggleEditMode' }
  | {
      type: 'applyTransform'
      pluginId: string
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
    }
  | { type: 'goToMatch'; offset: number }
  | {
      type: 'findAdjacentMatch'
      query: string
      isHex: boolean
      caseInsensitive?: boolean
      direction: 'forward' | 'backward'
      offset: number
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
      type: 'transformComplete'
      pluginId: string
      offset: number
      length: number
      operation: number
      contentChanged: boolean
      replacementLength: number
      computedFileSize: number
      resultLabel: string
      resultMimeType: string
      resultText: string
    }
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
      contentType: string
      language: string
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
      type: 'editMode'
      editMode: WebviewEditMode
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
  return VALID_BYTES_PER_ROW.includes(value as BytesPerRow)
    ? (value as BytesPerRow)
    : DEFAULT_BYTES_PER_ROW
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

function safeGridEditPane(value: unknown): GridEditPane | undefined {
  return value === 'hex' || value === 'ascii' ? value : undefined
}

function safeWebviewEditMode(value: unknown): WebviewEditMode | undefined {
  return value === 'insert' || value === 'overwrite' ? value : undefined
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
  const activePane = safeGridEditPane(raw.activePane)
  const editMode = safeWebviewEditMode(raw.editMode)

  if (
    visibleOffset === undefined ||
    visibleByteCount === undefined ||
    selectedOffset === undefined ||
    selectionStart === undefined ||
    selectionEnd === undefined ||
    selectionLength === undefined ||
    raw.bytesPerRow !== bytesPerRow ||
    !offsetRadix ||
    !activePane ||
    !editMode
  ) {
    return undefined
  }

  if (
    visibleOffset > context.fileSize ||
    visibleByteCount > Math.max(0, context.fileSize - visibleOffset)
  ) {
    return undefined
  }

  if (selectedOffset >= context.fileSize && context.fileSize > 0) {
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
    activePane,
    editMode,
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
      return raw.bytesPerRow === bytesPerRow
        ? { type: 'setBytesPerRow', bytesPerRow }
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
    case 'undo':
    case 'redo':
    case 'save':
    case 'saveAs':
    case 'revert':
      return { type: raw.type }

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

    case 'toggleEditMode':
      return { type: 'toggleEditMode' }

    case 'replaceAllMatches': {
      const query = safeSearchQuery(raw)
      const data = safeHexString(raw.data, MAX_WEBVIEW_HEX_BYTES, true)
      const length = safeNonNegativeInteger(raw.length)
      if (!query || data === undefined || !length) {
        return undefined
      }
      return {
        type: 'replaceAllMatches',
        query,
        isHex: raw.isHex === true,
        caseInsensitive: safeBoolean(raw.caseInsensitive),
        isReverse: safeBoolean(raw.isReverse),
        length,
        data,
      }
    }

    case 'applyTransform': {
      const pluginId = safeString(raw.pluginId, MAX_LABEL_LENGTH)
      const range = safeFileLengthRange(context, raw.offset, raw.length)
      const optionsJson =
        raw.optionsJson === undefined
          ? undefined
          : safeJsonString(raw.optionsJson, MAX_TRANSFORM_OPTIONS_LENGTH)
      if (
        !pluginId ||
        !range ||
        (raw.optionsJson !== undefined && optionsJson === undefined)
      ) {
        return undefined
      }
      return { type: 'applyTransform', pluginId, ...range, optionsJson }
    }

    case 'search': {
      const query = safeSearchQuery(raw)
      if (!query) {
        return undefined
      }
      return {
        type: 'search',
        query,
        isHex: raw.isHex === true,
        caseInsensitive: safeBoolean(raw.caseInsensitive),
        isReverse: safeBoolean(raw.isReverse),
      }
    }

    case 'goToMatch': {
      const offset = safeFileOffset(context, raw.offset)
      return offset === undefined ? undefined : { type: 'goToMatch', offset }
    }

    case 'findAdjacentMatch': {
      const query = safeSearchQuery(raw)
      const offset = safeFileOffset(context, raw.offset)
      if (
        !query ||
        offset === undefined ||
        (raw.direction !== 'forward' && raw.direction !== 'backward')
      ) {
        return undefined
      }
      return {
        type: 'findAdjacentMatch',
        query,
        isHex: raw.isHex === true,
        caseInsensitive: safeBoolean(raw.caseInsensitive),
        direction: raw.direction,
        offset,
      }
    }

    default:
      return undefined
  }
}
