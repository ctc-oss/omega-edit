/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createHash } from 'node:crypto'
import { getClient } from '../../client'
import {
  ChangeLogEntryKind,
  type ChangeLogEntryHeader,
  type ChangeLogPayloadChunk,
  type ChangeLogStreamComplete,
  type ChangeLogStreamHeader,
  type ExportChangeLogRequest,
  type ExportChangeLogResponse,
} from '../../protobuf_ts/generated/omega_edit/v1/omega_edit'
import {
  ChangeLogCancelledError,
  ChangeLogCodecError,
  parseChangeLogNonNegativeInt64,
  throwIfChangeLogCancelled,
} from '../codec'
import type { ChangeLogCancellationSignal, ChangeLogInt64 } from '../types'

const MAX_FRAME_QUEUE = 4
const RESUME_FRAME_QUEUE = 2
const MAX_PAYLOAD_CHUNK = 262_144
const ZERO = BigInt(0)
const ONE = BigInt(1)

interface ExportReadableStream {
  on(event: 'data', listener: (frame: ExportChangeLogResponse) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'end', listener: () => void): this
  pause(): this
  resume(): this
  cancel(): void
}

export interface ChangeLogRpcExportOptions {
  sessionId: string
  optimize?: boolean
  firstChangeSerial?: ChangeLogInt64
  lastChangeSerial?: ChangeLogInt64
  maxSpanBytes?: ChangeLogInt64
  maxEntries?: ChangeLogInt64
  maxOutputBytes?: ChangeLogInt64
  signal?: ChangeLogCancellationSignal
  /** Test/embedding hook; normal callers use the shared client. */
  subscribe?: (request: ExportChangeLogRequest) => ExportReadableStream
}

export type ValidatedChangeLogRpcFrame =
  | { type: 'header'; header: ChangeLogStreamHeader }
  | { type: 'entry'; entry: ChangeLogEntryHeader }
  | { type: 'payload'; payload: ChangeLogPayloadChunk }
  | { type: 'complete'; complete: ChangeLogStreamComplete }

function decimal(value: ChangeLogInt64 | undefined): string | undefined {
  return value === undefined
    ? undefined
    : parseChangeLogNonNegativeInt64(value, 'change-log RPC integer').toString()
}

function parseDecimal(value: string, name: string): bigint {
  return parseChangeLogNonNegativeInt64(value, name)
}

function fail(code: string, message: string): never {
  throw new ChangeLogCodecError(code, message)
}

function validateFingerprint(
  fingerprint: ChangeLogStreamHeader['before'],
  name: string
): void {
  if (!fingerprint) {
    fail('CHANGE_LOG_RPC_FRAMING', `${name} fingerprint is required`)
  }
  parseDecimal(fingerprint.byteLengthDecimal, `${name}.byteLengthDecimal`)
  if (fingerprint.digestAlgorithm !== 'sha256') {
    fail('CHANGE_LOG_RPC_FRAMING', `${name} digest must use sha256`)
  }
  if (!/^[0-9a-f]{64}$/.test(fingerprint.digestValue)) {
    fail('CHANGE_LOG_RPC_FRAMING', `${name} digest must be 64 lowercase hex characters`)
  }
}

function validateEntry(entry: ChangeLogEntryHeader, expectedIndex: bigint): bigint {
  const index = parseDecimal(entry.entryIndexDecimal, 'entry.entryIndexDecimal')
  if (index !== expectedIndex) {
    fail(
      'CHANGE_LOG_RPC_FRAMING',
      `expected entry index ${expectedIndex}, received ${index}`
    )
  }
  parseDecimal(entry.offsetDecimal, 'entry.offsetDecimal')
  parseDecimal(entry.lengthDecimal, 'entry.lengthDecimal')
  const payloadLength = parseDecimal(
    entry.payloadLengthDecimal,
    'entry.payloadLengthDecimal'
  )
  if (
    entry.kind < ChangeLogEntryKind.DELETE ||
    entry.kind > ChangeLogEntryKind.TRANSFORM
  ) {
    fail('CHANGE_LOG_RPC_FRAMING', 'entry kind is invalid')
  }
  if (entry.kind === ChangeLogEntryKind.TRANSFORM) {
    if (!entry.transform || payloadLength !== ZERO) {
      fail(
        'CHANGE_LOG_RPC_FRAMING',
        'TRANSFORM requires metadata and no payload chunks'
      )
    }
    if (Buffer.byteLength(entry.transform.transformId, 'utf8') > 4096) {
      fail('CHANGE_LOG_RPC_LIMIT', 'transform id exceeds 4096 UTF-8 bytes')
    }
    if (Buffer.byteLength(entry.transform.optionsJson, 'utf8') > 1_048_576) {
      fail('CHANGE_LOG_RPC_LIMIT', 'transform options exceed 1 MiB')
    }
    parseDecimal(
      entry.transform.replacementLengthDecimal,
      'transform.replacementLengthDecimal'
    )
    parseDecimal(
      entry.transform.computedFileSizeBeforeDecimal,
      'transform.computedFileSizeBeforeDecimal'
    )
    parseDecimal(
      entry.transform.computedFileSizeAfterDecimal,
      'transform.computedFileSizeAfterDecimal'
    )
  } else if (entry.transform) {
    fail('CHANGE_LOG_RPC_FRAMING', 'non-transform entry has transform metadata')
  }
  return payloadLength
}

async function openStream(
  request: ExportChangeLogRequest,
  options: ChangeLogRpcExportOptions
): Promise<ExportReadableStream> {
  if (options.subscribe) {
    return options.subscribe(request)
  }
  const client = await getClient()
  return client.exportChangeLog(request) as ExportReadableStream
}

/**
 * Validates and yields one server frame at a time. The gRPC stream is paused
 * once four frames are queued, so a slow consumer cannot turn the transport
 * into an unbounded payload buffer.
 */
export async function* streamChangeLogExport(
  options: ChangeLogRpcExportOptions
): AsyncGenerator<ValidatedChangeLogRpcFrame> {
  throwIfChangeLogCancelled(options.signal)
  const request: ExportChangeLogRequest = {
    sessionId: options.sessionId,
    optimize: options.optimize ?? false,
    firstChangeSerialDecimal: decimal(options.firstChangeSerial),
    lastChangeSerialDecimal: decimal(options.lastChangeSerial),
    maxSpanBytesDecimal: decimal(options.maxSpanBytes),
    maxEntriesDecimal: decimal(options.maxEntries),
    maxOutputBytesDecimal: decimal(options.maxOutputBytes),
  }
  const stream = await openStream(request, options)
  const queue: ExportChangeLogResponse[] = []
  let streamError: Error | undefined
  let ended = false
  let paused = false
  let wake: (() => void) | undefined
  const notify = (): void => {
    wake?.()
    wake = undefined
  }
  stream.on('data', (frame) => {
    queue.push(frame)
    if (!paused && queue.length >= MAX_FRAME_QUEUE) {
      paused = true
      stream.pause()
    }
    notify()
  })
  stream.on('error', (error) => {
    streamError = error
    ended = true
    notify()
  })
  stream.on('end', () => {
    ended = true
    notify()
  })
  const abort = (): void => {
    stream.cancel()
    notify()
  }
  options.signal?.addEventListener?.('abort', abort, { once: true })

  let sawHeader = false
  let sawComplete = false
  let expectedEntry = ZERO
  let currentPayload:
    | { entryIndex: bigint; declared: bigint; received: bigint }
    | undefined
  let payloadBytes = ZERO
  const payloadDigest = createHash('sha256')

  try {
    while (!ended || queue.length > 0) {
      throwIfChangeLogCancelled(options.signal)
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      const frame = queue.shift() as ExportChangeLogResponse
      if (paused && queue.length <= RESUME_FRAME_QUEUE) {
        paused = false
        stream.resume()
      }
      if (sawComplete) {
        fail('CHANGE_LOG_RPC_FRAMING', 'received a frame after completion')
      }
      switch (frame.frame.oneofKind) {
        case 'header': {
          if (sawHeader || expectedEntry !== ZERO || currentPayload) {
            fail('CHANGE_LOG_RPC_FRAMING', 'header must be the first frame')
          }
          const header = frame.frame.header
          if (header.formatVersion !== 2) {
            fail('CHANGE_LOG_RPC_FRAMING', 'unsupported change-log stream version')
          }
          parseDecimal(
            header.resolvedFirstSerialDecimal,
            'header.resolvedFirstSerialDecimal'
          )
          parseDecimal(
            header.resolvedLastSerialDecimal,
            'header.resolvedLastSerialDecimal'
          )
          parseDecimal(
            header.sourceChangeCountDecimal,
            'header.sourceChangeCountDecimal'
          )
          validateFingerprint(header.before, 'before')
          validateFingerprint(header.after, 'after')
          sawHeader = true
          yield { type: 'header', header }
          break
        }
        case 'entry': {
          if (!sawHeader || currentPayload) {
            fail(
              'CHANGE_LOG_RPC_FRAMING',
              'entry arrived before the header or before its predecessor completed'
            )
          }
          const declared = validateEntry(frame.frame.entry, expectedEntry)
          yield { type: 'entry', entry: frame.frame.entry }
          if (declared === ZERO) {
            expectedEntry += ONE
          } else {
            currentPayload = {
              entryIndex: expectedEntry,
              declared,
            received: ZERO,
            }
          }
          break
        }
        case 'payload': {
          if (!sawHeader || !currentPayload) {
            fail('CHANGE_LOG_RPC_FRAMING', 'unexpected payload chunk')
          }
          const payload = frame.frame.payload
          const index = parseDecimal(
            payload.entryIndexDecimal,
            'payload.entryIndexDecimal'
          )
          const offset = parseDecimal(
            payload.chunkOffsetDecimal,
            'payload.chunkOffsetDecimal'
          )
          if (
            index !== currentPayload.entryIndex ||
            offset !== currentPayload.received ||
            payload.data.length === 0 ||
            payload.data.length > MAX_PAYLOAD_CHUNK
          ) {
            fail('CHANGE_LOG_RPC_FRAMING', 'payload chunk is not contiguous or bounded')
          }
          currentPayload.received += BigInt(payload.data.length)
          payloadBytes += BigInt(payload.data.length)
          if (currentPayload.received > currentPayload.declared) {
            fail('CHANGE_LOG_RPC_FRAMING', 'payload exceeds its declared length')
          }
          const atEnd = currentPayload.received === currentPayload.declared
          if (payload.finalChunk !== atEnd) {
            fail('CHANGE_LOG_RPC_FRAMING', 'payload final-chunk marker is invalid')
          }
          payloadDigest.update(payload.data)
          yield { type: 'payload', payload }
          if (atEnd) {
            expectedEntry += ONE
            currentPayload = undefined
          }
          break
        }
        case 'complete': {
          if (!sawHeader || currentPayload) {
            fail('CHANGE_LOG_RPC_FRAMING', 'completion arrived with an open entry')
          }
          const complete = frame.frame.complete
          if (
            parseDecimal(
              complete.emittedChangeCountDecimal,
              'complete.emittedChangeCountDecimal'
            ) !== expectedEntry ||
            parseDecimal(
              complete.payloadByteCountDecimal,
              'complete.payloadByteCountDecimal'
            ) !== payloadBytes ||
            complete.payloadSha256.length !== 32
          ) {
            fail('CHANGE_LOG_RPC_FRAMING', 'completion counts or digest length are invalid')
          }
          const actualDigest = payloadDigest.digest()
          if (!actualDigest.equals(Buffer.from(complete.payloadSha256))) {
            fail('CHANGE_LOG_RPC_CHECKSUM', 'payload stream checksum mismatch')
          }
          sawComplete = true
          yield { type: 'complete', complete }
          break
        }
        default:
          fail('CHANGE_LOG_RPC_FRAMING', 'response frame is empty')
      }
    }
    if (streamError) {
      throw streamError
    }
    if (!sawHeader || !sawComplete) {
      fail('CHANGE_LOG_RPC_FRAMING', 'change-log stream ended before completion')
    }
  } catch (error) {
    stream.cancel()
    if (options.signal?.aborted && !(error instanceof ChangeLogCancelledError)) {
      throw new ChangeLogCancelledError()
    }
    throw error
  } finally {
    options.signal?.removeEventListener?.('abort', abort)
  }
}
