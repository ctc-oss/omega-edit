export type InputEncoding = 'utf8' | 'hex' | 'base64'
export type PatchKind = 'insert' | 'overwrite' | 'delete' | 'replace'

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
  lastChange?: {
    kind: string
    offset: number
    length: number
    data: EncodedData
  }
}

export interface ReadRangeResult {
  sessionId: string
  offset: number
  requestedLength: number
  actualLength: number
  data: EncodedData
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
