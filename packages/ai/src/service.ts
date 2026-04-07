import {
  ChangeKind,
  IOFlags,
  createSession,
  del,
  destroySession,
  getChangeCount,
  getClient,
  getComputedFileSize,
  getLastChange,
  getServerInfo,
  getSegment,
  getUndoCount,
  getViewportCount,
  insert,
  overwrite,
  redo,
  replace,
  resetClient,
  saveSession,
  searchSession,
  startServer,
  stopServerGraceful,
  undo,
} from '@omega-edit/client'
import * as net from 'net'
import {
  DEFAULT_HOST,
  DEFAULT_MAX_EDIT_BYTES,
  DEFAULT_MAX_READ_BYTES,
  DEFAULT_MAX_SEARCH_RESULTS,
  DEFAULT_PORT,
  DEFAULT_PREVIEW_CONTEXT_BYTES,
} from './constants'
import { concatBytes, encodeData, parseInputData } from './codec'
import {
  PatchPreview,
  PatchRequest,
  PatchResult,
  ReadRangeResult,
  SearchRequest,
  SearchResult,
  SessionStatus,
  ToolkitOptions,
} from './types'

const changeKindNames = new Map<number, string>(
  Object.entries(ChangeKind)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value as number, name])
)

function isFiniteInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value)
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!isFiniteInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen(port, host)
  })
}

export class OmegaEditToolkit {
  readonly host: string
  readonly port: number
  readonly autoStart: boolean
  readonly maxReadBytes: number
  readonly maxEditBytes: number
  readonly maxSearchResults: number
  readonly previewContextBytes: number

  constructor(options: ToolkitOptions = {}) {
    this.host = options.host || DEFAULT_HOST
    this.port = options.port || DEFAULT_PORT
    this.autoStart = options.autoStart !== false
    this.maxReadBytes = options.maxReadBytes || DEFAULT_MAX_READ_BYTES
    this.maxEditBytes = options.maxEditBytes || DEFAULT_MAX_EDIT_BYTES
    this.maxSearchResults =
      options.maxSearchResults || DEFAULT_MAX_SEARCH_RESULTS
    this.previewContextBytes =
      options.previewContextBytes || DEFAULT_PREVIEW_CONTEXT_BYTES
  }

  private async connectToServer(): Promise<void> {
    resetClient()
    await getClient(this.port, this.host)
    await getServerInfo()
  }

  private async connectToRunningServer(): Promise<void> {
    try {
      await this.connectToServer()
    } catch {
      resetClient()
      throw new Error(
        `OmegaEdit server is not running on ${this.host}:${this.port}`
      )
    }
  }

  async ensureServerRunning(): Promise<void> {
    const portIsAvailable = await isPortAvailable(this.host, this.port)
    if (portIsAvailable) {
      if (!this.autoStart) {
        throw new Error(
          `OmegaEdit server is not running on ${this.host}:${this.port}`
        )
      }

      await startServer(this.port, this.host)
      await this.connectToServer()
      return
    }

    try {
      await this.connectToServer()
      return
    } catch (error) {
      resetClient()
      if (!this.autoStart) {
        throw error
      }

      throw new Error(
        `Port ${this.port} on ${this.host} is occupied by a non-OmegaEdit service. Refusing to auto-start.`
      )
    }
  }

  async startServer(): Promise<object> {
    await this.ensureServerRunning()
    return await this.serverInfo()
  }

  async stopServer(): Promise<{
    responseCode: number
    serverProcessId: number
    status: string
  }> {
    await this.connectToRunningServer()
    const response = await stopServerGraceful()
    resetClient()
    return response
  }

  async serverInfo(): Promise<object> {
    await this.connectToRunningServer()
    return await getServerInfo()
  }

  async createSession(
    filePath: string = '',
    sessionId: string = '',
    checkpointDirectory: string = ''
  ): Promise<{ sessionId: string; filePath: string }> {
    await this.ensureServerRunning()
    const response = await createSession(
      filePath,
      sessionId,
      checkpointDirectory
    )
    return {
      sessionId: response.getSessionId(),
      filePath,
    }
  }

  async destroySession(sessionId: string): Promise<{ sessionId: string }> {
    await this.ensureServerRunning()
    return { sessionId: await destroySession(sessionId) }
  }

  async sessionStatus(sessionId: string): Promise<SessionStatus> {
    await this.ensureServerRunning()

    const [computedSize, changeCount, undoCount, viewportCount] =
      await Promise.all([
        getComputedFileSize(sessionId),
        getChangeCount(sessionId),
        getUndoCount(sessionId),
        getViewportCount(sessionId),
      ])

    let lastChange: SessionStatus['lastChange'] | undefined

    if (changeCount > 0) {
      const response = await getLastChange(sessionId)
      lastChange = {
        kind:
          changeKindNames.get(response.getKind()) || `${response.getKind()}`,
        offset: response.getOffset(),
        length: response.getLength(),
        data: encodeData(response.getData_asU8()),
      }
    }

    return {
      sessionId,
      computedSize,
      changeCount,
      undoCount,
      viewportCount,
      lastChange,
    }
  }

  async readRange(
    sessionId: string,
    offset: number,
    length: number
  ): Promise<ReadRangeResult> {
    assertNonNegativeInteger('offset', offset)
    assertNonNegativeInteger('length', length)

    if (length > this.maxReadBytes) {
      throw new Error(
        `length exceeds configured maximum of ${this.maxReadBytes} bytes`
      )
    }

    await this.ensureServerRunning()

    const computedSize = await getComputedFileSize(sessionId)
    if (offset > computedSize) {
      throw new Error('offset is beyond the end of the session')
    }

    const actualLength = Math.min(length, Math.max(0, computedSize - offset))
    const data =
      actualLength === 0
        ? new Uint8Array(0)
        : await getSegment(sessionId, offset, actualLength)

    return {
      sessionId,
      offset,
      requestedLength: length,
      actualLength,
      data: encodeData(data),
    }
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const offset = request.offset || 0
    const length = request.length || 0
    const requestedLimit = request.limit || 100

    assertNonNegativeInteger('offset', offset)
    assertNonNegativeInteger('length', length)
    assertNonNegativeInteger('limit', requestedLimit)

    if (requestedLimit === 0 || requestedLimit > this.maxSearchResults) {
      throw new Error(
        `limit must be between 1 and ${this.maxSearchResults} results`
      )
    }

    await this.ensureServerRunning()

    const pattern =
      typeof request.pattern === 'string'
        ? parseInputData(request.pattern, request.inputEncoding || 'utf8')
        : request.pattern

    if (pattern.length === 0) {
      throw new Error('pattern must not be empty')
    }

    const matches = await searchSession(
      request.sessionId,
      pattern,
      request.caseInsensitive || false,
      request.reverse || false,
      offset,
      length,
      requestedLimit
    )

    return {
      sessionId: request.sessionId,
      offset,
      length,
      limit: requestedLimit,
      matches,
    }
  }

  private normalizePatchRequest(request: PatchRequest): {
    removeLength: number
    data: Uint8Array
  } {
    assertNonNegativeInteger('offset', request.offset)

    const data = request.data || new Uint8Array(0)
    if (data.length > this.maxEditBytes) {
      throw new Error(
        `patch payload exceeds configured maximum of ${this.maxEditBytes} bytes`
      )
    }

    switch (request.kind) {
      case 'insert':
        if (data.length === 0) throw new Error('insert requires data')
        return { removeLength: 0, data }
      case 'overwrite':
        if (data.length === 0) throw new Error('overwrite requires data')
        return { removeLength: data.length, data }
      case 'delete': {
        const removeLength = request.removeLength || 0
        if (removeLength <= 0) {
          throw new Error('delete requires removeLength > 0')
        }
        return { removeLength, data }
      }
      case 'replace': {
        const removeLength = request.removeLength || 0
        if (removeLength < 0) {
          throw new Error('replace requires removeLength >= 0')
        }
        if (data.length === 0 && removeLength === 0) {
          throw new Error('replace requires data and/or removeLength')
        }
        return { removeLength, data }
      }
    }
  }

  async previewPatch(request: PatchRequest): Promise<PatchPreview> {
    await this.ensureServerRunning()

    const { removeLength, data } = this.normalizePatchRequest(request)
    const sessionSize = await getComputedFileSize(request.sessionId)
    const previewContext = Math.min(
      request.previewContext || this.previewContextBytes,
      this.previewContextBytes
    )

    if (request.offset > sessionSize) {
      throw new Error('offset is beyond the end of the session')
    }
    if (request.offset + removeLength > sessionSize) {
      throw new Error('patch extends beyond the end of the session')
    }

    const targetBefore =
      removeLength === 0
        ? new Uint8Array(0)
        : await getSegment(request.sessionId, request.offset, removeLength)

    const targetAfter = request.kind === 'delete' ? new Uint8Array(0) : data

    const previewOffset = Math.max(0, request.offset - previewContext)
    const previewEnd = Math.min(
      sessionSize,
      request.offset + removeLength + previewContext
    )
    const previewBeforeLength = previewEnd - previewOffset
    const previewBefore =
      previewBeforeLength === 0
        ? new Uint8Array(0)
        : await getSegment(
            request.sessionId,
            previewOffset,
            previewBeforeLength
          )

    const relativeOffset = request.offset - previewOffset
    const relativeEnd = relativeOffset + removeLength
    const previewAfter = concatBytes(
      previewBefore.subarray(0, relativeOffset),
      targetAfter,
      previewBefore.subarray(relativeEnd)
    )

    return {
      sessionId: request.sessionId,
      kind: request.kind,
      offset: request.offset,
      removeLength,
      insertLength: targetAfter.length,
      previewOffset,
      previewBeforeLength: previewBefore.length,
      previewAfterLength: previewAfter.length,
      targetBefore: encodeData(targetBefore),
      targetAfter: encodeData(targetAfter),
      previewBefore: encodeData(previewBefore),
      previewAfter: encodeData(previewAfter),
    }
  }

  async applyPatch(request: PatchRequest): Promise<PatchResult> {
    const preview = await this.previewPatch(request)

    if (request.dryRun) {
      return {
        applied: false,
        preview,
      }
    }

    const { removeLength, data } = this.normalizePatchRequest(request)

    let serial: number
    switch (request.kind) {
      case 'insert':
        serial = await insert(request.sessionId, request.offset, data)
        break
      case 'overwrite':
        serial = await overwrite(request.sessionId, request.offset, data)
        break
      case 'delete':
        serial = await del(request.sessionId, request.offset, removeLength)
        break
      case 'replace':
        serial = await replace(
          request.sessionId,
          request.offset,
          removeLength,
          data
        )
        break
    }

    return {
      applied: true,
      serial,
      preview,
    }
  }

  async undo(sessionId: string): Promise<{ serial: number }> {
    await this.ensureServerRunning()
    return { serial: await undo(sessionId) }
  }

  async redo(sessionId: string): Promise<{ serial: number }> {
    await this.ensureServerRunning()
    return { serial: await redo(sessionId) }
  }

  async saveSession(
    sessionId: string,
    outputPath: string,
    overwriteExisting: boolean = false
  ): Promise<{ filePath: string; status: number }> {
    await this.ensureServerRunning()
    const response = await saveSession(
      sessionId,
      outputPath,
      overwriteExisting
        ? IOFlags.IO_FLAGS_OVERWRITE
        : IOFlags.IO_FLAGS_UNSPECIFIED
    )
    return {
      filePath: response.getFilePath(),
      status: response.getSaveStatus(),
    }
  }

  async exportRange(
    sessionId: string,
    offset: number,
    length: number,
    outputPath: string,
    overwriteExisting: boolean = false
  ): Promise<{
    filePath: string
    status: number
    offset: number
    length: number
  }> {
    assertNonNegativeInteger('offset', offset)
    assertNonNegativeInteger('length', length)
    if (length > this.maxReadBytes) {
      throw new Error(
        `length exceeds configured maximum of ${this.maxReadBytes} bytes`
      )
    }

    await this.ensureServerRunning()
    const response = await saveSession(
      sessionId,
      outputPath,
      overwriteExisting
        ? IOFlags.IO_FLAGS_OVERWRITE
        : IOFlags.IO_FLAGS_UNSPECIFIED,
      offset,
      length
    )
    return {
      filePath: response.getFilePath(),
      status: response.getSaveStatus(),
      offset,
      length,
    }
  }
}
