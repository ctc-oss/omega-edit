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

import { once } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { finished } from 'node:stream/promises'
import {
  ChangeLogCodecError,
  ChangeLogEntrySequenceValidator,
  changeLogInt64ToDecimal,
  normalizeChangeLogEntry,
  normalizeChangeLogHeader,
  parseChangeLogNonNegativeInt64,
  resolveChangeLogCodecLimits,
  serializeChangeLogEntry,
  throwIfChangeLogCancelled,
} from '../codec'
import { scanChangeLogJson } from '../stream'
import type {
  ChangeLogCodecOptions,
  ChangeLogFileReadResult,
  ChangeLogHeader,
  ChangeLogInt64,
  ChangeLogEntry,
  ChangeLogWriteResult,
  NormalizedChangeLogEntry,
} from '../types'
import {
  ChangeLogEntryKind,
  type ChangeLogStreamHeader,
} from '../../protobuf_ts/generated/omega_edit/v1/omega_edit'
import { streamChangeLogExport, type ChangeLogRpcExportOptions } from './rpc'

export * from './rpc'

interface FileIdentity {
  dev: bigint
  ino: bigint
  size: bigint
  mtimeNs: bigint
}

export interface AtomicChangeLogWriteOptions extends ChangeLogCodecOptions {
  overwrite?: boolean
  maxBytes?: number
  beforeCommit?: () => Promise<void>
  /** Called before a write crosses a byte boundary (for storage quotas). */
  onBytesWritten?: (byteLength: number) => Promise<void>
}

export interface ChangeLogEntrySink {
  writeEntry(entry: ChangeLogEntry | NormalizedChangeLogEntry): Promise<void>
}

export interface ChangeLogRpcFileResult extends ChangeLogWriteResult {
  sourceChangeCount: string
  before: ChangeLogHeader['before']
  after: ChangeLogHeader['after']
  optimized: boolean
}

function fileIdentity(stat: {
  dev: number | bigint
  ino: number | bigint
  size: number | bigint
  mtimeMs: number | bigint
  mtimeNs?: bigint
}): FileIdentity {
  return {
    dev: BigInt(stat.dev),
    ino: BigInt(stat.ino),
    size: BigInt(stat.size),
    mtimeNs:
      stat.mtimeNs ?? BigInt(Math.trunc(Number(stat.mtimeMs) * 1_000_000)),
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  )
}

async function syncFile(path: string): Promise<void> {
  const handle = await fs.open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncParentDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(dirname(path), 'r')
    await handle.sync()
  } catch {
    // Node/filesystem combinations that cannot fsync a directory still retain
    // file-level fsync and atomic rename/link semantics.
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function scanFile(
  path: string,
  options: ChangeLogCodecOptions,
  onEntry?: (entry: NormalizedChangeLogEntry) => Promise<void>
): Promise<{
  result: ChangeLogFileReadResult
  identity: FileIdentity
}> {
  throwIfChangeLogCancelled(options.signal)
  const before = fileIdentity(await fs.stat(path, { bigint: true }))
  const hash = createHash('sha256')
  let result:
    | Omit<
        ChangeLogFileReadResult,
        'entries' | 'path' | 'byteLength' | 'sha256'
      >
    | undefined

  async function* chunks(): AsyncGenerator<Uint8Array> {
    const stream = createReadStream(path, { highWaterMark: 64 * 1024 })
    try {
      for await (const chunk of stream) {
        throwIfChangeLogCancelled(options.signal)
        const bytes = chunk as Uint8Array
        hash.update(bytes)
        yield bytes
      }
    } finally {
      stream.destroy()
    }
  }

  for await (const event of scanChangeLogJson(chunks(), options)) {
    if (event.type === 'entry') {
      await onEntry?.(event.entry)
    } else {
      result = event.result
    }
  }
  if (!result) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INCOMPLETE_SCAN',
      'Change log file scan did not complete'
    )
  }
  const after = fileIdentity(await fs.stat(path, { bigint: true }))
  if (!sameIdentity(before, after)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_FILE_CHANGED',
      'Change log file changed while it was being read'
    )
  }
  const sha256 = hash.digest('hex')
  const completeResult: ChangeLogFileReadResult = {
    ...result,
    path,
    byteLength: before.size.toString(),
    sha256,
    entries: async function* () {
      throw new Error('Internal placeholder must be replaced')
    },
  }
  return { result: completeResult, identity: before }
}

function summariesMatch(
  left: ChangeLogFileReadResult,
  right: ChangeLogFileReadResult
): boolean {
  return (
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength &&
    left.complete === right.complete &&
    left.changeCount === right.changeCount &&
    left.sourceChangeCount === right.sourceChangeCount &&
    left.unavailableChangeCount === right.unavailableChangeCount &&
    JSON.stringify(left.unavailableChangeSerials) ===
      JSON.stringify(right.unavailableChangeSerials) &&
    JSON.stringify(left.before) === JSON.stringify(right.before) &&
    JSON.stringify(left.after) === JSON.stringify(right.after)
  )
}

export async function openChangeLogFile(
  path: string,
  options: ChangeLogCodecOptions = {}
): Promise<ChangeLogFileReadResult> {
  const first = await scanFile(path, options)
  const prepared: ChangeLogFileReadResult = {
    ...first.result,
    entries: async function* (): AsyncGenerator<NormalizedChangeLogEntry> {
      const current = fileIdentity(await fs.stat(path, { bigint: true }))
      if (!sameIdentity(first.identity, current)) {
        throw new ChangeLogCodecError(
          'CHANGE_LOG_FILE_CHANGED',
          'Change log file changed after preflight validation'
        )
      }
      const hash = createHash('sha256')
      let secondResult:
        | Omit<
            ChangeLogFileReadResult,
            'entries' | 'path' | 'byteLength' | 'sha256'
          >
        | undefined

      async function* chunks(): AsyncGenerator<Uint8Array> {
        const stream = createReadStream(path, { highWaterMark: 64 * 1024 })
        try {
          for await (const chunk of stream) {
            throwIfChangeLogCancelled(options.signal)
            const bytes = chunk as Uint8Array
            hash.update(bytes)
            yield bytes
          }
        } finally {
          stream.destroy()
        }
      }

      for await (const event of scanChangeLogJson(chunks(), options)) {
        if (event.type === 'entry') {
          yield event.entry
        } else {
          secondResult = event.result
        }
      }
      const after = fileIdentity(await fs.stat(path, { bigint: true }))
      const second: ChangeLogFileReadResult | undefined = secondResult
        ? {
            ...secondResult,
            path,
            byteLength: after.size.toString(),
            sha256: hash.digest('hex'),
            entries: async function* () {},
          }
        : undefined
      if (
        !sameIdentity(first.identity, after) ||
        !second ||
        !summariesMatch(first.result, second)
      ) {
        throw new ChangeLogCodecError(
          'CHANGE_LOG_FILE_CHANGED',
          'Change log file changed between preflight and replay passes'
        )
      }
    },
  }
  return prepared
}

function normalizedHeaderObject(
  header: ChangeLogHeader
): Record<string, unknown> {
  return {
    format: header.format,
    version: header.version,
    complete: header.complete,
    before: header.before,
    after: header.after,
    changeCount: header.changeCount,
    sourceChangeCount: header.sourceChangeCount,
    unavailableChangeCount: header.unavailableChangeCount,
    unavailableChangeSerials: header.unavailableChangeSerials,
  }
}

export async function writeChangeLogFileAtomic(
  outputPath: string,
  header: ChangeLogHeader,
  writeEntries: (sink: ChangeLogEntrySink) => Promise<void>,
  options: AtomicChangeLogWriteOptions = {}
): Promise<ChangeLogWriteResult> {
  const limits = resolveChangeLogCodecLimits(options.limits)
  const expectedCount = Number(
    parseChangeLogNonNegativeInt64(header.changeCount, 'Change log changeCount')
  )
  if (
    !Number.isSafeInteger(expectedCount) ||
    expectedCount > limits.maxEntryCount
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_ENTRY_LIMIT',
      `Change log changeCount exceeds ${limits.maxEntryCount}`
    )
  }
  if (
    options.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0)
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_LIMIT',
      'maxBytes must be a positive safe integer'
    )
  }
  const validatedHeader = normalizeChangeLogHeader(
    normalizedHeaderObject(header),
    expectedCount,
    limits
  )
  const tempPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
  )
  const stream = createWriteStream(tempPath, {
    encoding: 'utf8',
    flags: 'wx',
    mode: 0o600,
  })
  const hash = createHash('sha256')
  const sequence = new ChangeLogEntrySequenceValidator(limits)
  let byteLength = 0
  let entryCount = 0
  let committed = false
  let streamEnded = false

  const writeText = async (text: string): Promise<void> => {
    throwIfChangeLogCancelled(options.signal)
    const bytes = Buffer.byteLength(text, 'utf8')
    if (
      options.maxBytes !== undefined &&
      byteLength + bytes > options.maxBytes
    ) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_OUTPUT_LIMIT',
        `Change log output exceeds ${options.maxBytes} bytes`
      )
    }
    await options.onBytesWritten?.(byteLength + bytes)
    hash.update(text, 'utf8')
    byteLength += bytes
    if (!stream.write(text)) {
      await once(stream, 'drain')
    }
  }

  try {
    const metadata = normalizedHeaderObject(validatedHeader)
    const prefix = `${JSON.stringify(metadata, null, 2).replace(
      /\n}$/,
      ',\n  "changes": ['
    )}\n`
    await writeText(prefix)
    let first = true
    await writeEntries({
      writeEntry: async (entry) => {
        if (entryCount >= limits.maxEntryCount) {
          throw new ChangeLogCodecError(
            'CHANGE_LOG_ENTRY_LIMIT',
            `Change log entry count exceeds ${limits.maxEntryCount}`
          )
        }
        const normalized = normalizeChangeLogEntry(entry, entryCount, limits)
        sequence.accept(normalized, entryCount)
        const serialized = JSON.stringify(
          serializeChangeLogEntry(normalized),
          null,
          2
        )
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n')
        await writeText(`${first ? '' : ',\n'}${serialized}`)
        first = false
        entryCount += 1
      },
    })
    if (entryCount !== expectedCount) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_METADATA',
        `Change log wrote ${entryCount} entries, expected ${expectedCount}`
      )
    }
    normalizeChangeLogHeader(
      normalizedHeaderObject(validatedHeader),
      entryCount,
      limits
    )
    await writeText('\n  ]\n}\n')
    stream.end()
    streamEnded = true
    await finished(stream)
    await syncFile(tempPath)
    await options.beforeCommit?.()
    throwIfChangeLogCancelled(options.signal)

    if (options.overwrite) {
      await fs.rename(tempPath, outputPath)
      committed = true
    } else {
      await fs.link(tempPath, outputPath)
      committed = true
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
    await syncParentDirectory(outputPath)
    return {
      path: outputPath,
      byteLength,
      sha256: hash.digest('hex'),
      entryCount,
    }
  } finally {
    if (!streamEnded) {
      stream.destroy()
      await finished(stream).catch(() => undefined)
    }
    if (!committed) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
  }
}

function rpcEntryKind(
  kind: ChangeLogEntryKind
): NormalizedChangeLogEntry['kind'] {
  switch (kind) {
    case ChangeLogEntryKind.DELETE:
      return 'DELETE'
    case ChangeLogEntryKind.INSERT:
      return 'INSERT'
    case ChangeLogEntryKind.OVERWRITE:
      return 'OVERWRITE'
    case ChangeLogEntryKind.REPLACE:
      return 'REPLACE'
    case ChangeLogEntryKind.TRANSFORM:
      return 'TRANSFORM'
    default:
      throw new ChangeLogCodecError(
        'CHANGE_LOG_RPC_FRAMING',
        'RPC entry has an unspecified kind'
      )
  }
}

/** Stream a validated ranged RPC directly into an atomic v2 JSON document. */
export async function writeChangeLogRpcExportAtomic(
  outputPath: string,
  rpcOptions: ChangeLogRpcExportOptions,
  options: AtomicChangeLogWriteOptions = {}
): Promise<ChangeLogRpcFileResult> {
  if (
    options.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0)
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_LIMIT',
      'maxBytes must be a positive safe integer'
    )
  }
  const tempPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
  )
  const stream = createWriteStream(tempPath, {
    encoding: 'utf8',
    flags: 'wx',
    mode: 0o600,
  })
  const hash = createHash('sha256')
  let byteLength = 0
  let committed = false
  let streamEnded = false
  let header: ChangeLogStreamHeader | undefined
  let entryOpen = false
  let firstEntry = true
  let entryCount = 0

  const writeText = async (text: string): Promise<void> => {
    throwIfChangeLogCancelled(options.signal ?? rpcOptions.signal)
    const bytes = Buffer.byteLength(text, 'utf8')
    if (
      options.maxBytes !== undefined &&
      byteLength + bytes > options.maxBytes
    ) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_OUTPUT_LIMIT',
        `Change log output exceeds ${options.maxBytes} bytes`
      )
    }
    await options.onBytesWritten?.(byteLength + bytes)
    hash.update(text, 'utf8')
    byteLength += bytes
    if (!stream.write(text)) {
      await once(stream, 'drain')
    }
  }

  try {
    for await (const frame of streamChangeLogExport({
      ...rpcOptions,
      signal: options.signal ?? rpcOptions.signal,
    })) {
      if (frame.type === 'header') {
        header = frame.header
        const metadata = {
          format: 'omega-edit.change-log',
          version: 2,
          complete: true,
          before: {
            byteLength: frame.header.before?.byteLengthDecimal,
            digest: {
              pluginId: frame.header.before?.digestPluginId,
              algorithm: frame.header.before?.digestAlgorithm,
              value: frame.header.before?.digestValue,
            },
          },
          after: {
            byteLength: frame.header.after?.byteLengthDecimal,
            digest: {
              pluginId: frame.header.after?.digestPluginId,
              algorithm: frame.header.after?.digestAlgorithm,
              value: frame.header.after?.digestValue,
            },
          },
          sourceChangeCount: frame.header.sourceChangeCountDecimal,
          unavailableChangeCount: '0',
          unavailableChangeSerials: [],
        }
        await writeText(
          `${JSON.stringify(metadata).replace(/}$/, ',"changes":[')}`
        )
      } else if (frame.type === 'entry') {
        const entry = frame.entry
        const kind = rpcEntryKind(entry.kind)
        const prefix = firstEntry ? '' : ','
        firstEntry = false
        if (kind === 'TRANSFORM') {
          const transform = entry.transform
          if (!transform) {
            throw new ChangeLogCodecError(
              'CHANGE_LOG_RPC_FRAMING',
              'TRANSFORM entry is missing metadata'
            )
          }
          let args: unknown = {}
          if (transform.optionsJson) {
            try {
              args = JSON.parse(transform.optionsJson)
            } catch (error) {
              throw new ChangeLogCodecError(
                'CHANGE_LOG_INVALID_TRANSFORM',
                'TRANSFORM options are not valid JSON',
                error
              )
            }
          }
          const descriptor = Buffer.from(
            JSON.stringify({ transformId: transform.transformId, args }),
            'utf8'
          ).toString('hex')
          await writeText(
            `${prefix}${JSON.stringify({
              kind,
              offset: entry.offsetDecimal,
              length: entry.lengthDecimal,
              data: descriptor,
            })}`
          )
          entryCount += 1
        } else {
          await writeText(
            `${prefix}{"kind":${JSON.stringify(kind)},"offset":${JSON.stringify(
              entry.offsetDecimal
            )},"length":${JSON.stringify(entry.lengthDecimal)},"data":"`
          )
          entryOpen = true
          if (entry.payloadLengthDecimal === '0') {
            await writeText('"}')
            entryOpen = false
            entryCount += 1
          }
        }
      } else if (frame.type === 'payload') {
        if (!entryOpen) {
          throw new ChangeLogCodecError(
            'CHANGE_LOG_RPC_FRAMING',
            'payload arrived without an open JSON entry'
          )
        }
        await writeText(Buffer.from(frame.payload.data).toString('hex'))
        if (frame.payload.finalChunk) {
          await writeText('"}')
          entryOpen = false
          entryCount += 1
        }
      } else {
        if (!header || entryOpen) {
          throw new ChangeLogCodecError(
            'CHANGE_LOG_RPC_FRAMING',
            'RPC completed before its JSON document could be closed'
          )
        }
        if (
          frame.complete.emittedChangeCountDecimal !== entryCount.toString()
        ) {
          throw new ChangeLogCodecError(
            'CHANGE_LOG_RPC_FRAMING',
            'RPC entry count changed while writing JSON'
          )
        }
        await writeText(
          `],"changeCount":${JSON.stringify(
            frame.complete.emittedChangeCountDecimal
          )}}\n`
        )
      }
    }
    if (!header) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_RPC_FRAMING',
        'RPC stream did not provide a header'
      )
    }
    stream.end()
    streamEnded = true
    await finished(stream)
    await syncFile(tempPath)
    await options.beforeCommit?.()
    throwIfChangeLogCancelled(options.signal ?? rpcOptions.signal)
    if (options.overwrite) {
      await fs.rename(tempPath, outputPath)
      committed = true
    } else {
      await fs.link(tempPath, outputPath)
      committed = true
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
    await syncParentDirectory(outputPath)
    return {
      path: outputPath,
      byteLength,
      sha256: hash.digest('hex'),
      entryCount,
      sourceChangeCount: header.sourceChangeCountDecimal,
      before: {
        byteLength: header.before!.byteLengthDecimal,
        digest: {
          pluginId: header.before!.digestPluginId,
          algorithm: header.before!.digestAlgorithm,
          value: header.before!.digestValue,
        },
      },
      after: {
        byteLength: header.after!.byteLengthDecimal,
        digest: {
          pluginId: header.after!.digestPluginId,
          algorithm: header.after!.digestAlgorithm,
          value: header.after!.digestValue,
        },
      },
      optimized: header.optimized,
    }
  } finally {
    if (!streamEnded) {
      stream.destroy()
      await finished(stream).catch(() => undefined)
    }
    if (!committed) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
  }
}

export function changeLogHeaderForExport(input: {
  complete: boolean
  before: ChangeLogHeader['before']
  after: ChangeLogHeader['after']
  changeCount: ChangeLogInt64
  sourceChangeCount: ChangeLogInt64
  unavailableChangeSerials: ChangeLogInt64[]
}): ChangeLogHeader {
  const unavailable = input.unavailableChangeSerials.map((serial) =>
    changeLogInt64ToDecimal(serial, 'unavailable change serial')
  )
  return {
    format: 'omega-edit.change-log',
    version: 2,
    complete: input.complete,
    before: input.before,
    after: input.after,
    changeCount: changeLogInt64ToDecimal(input.changeCount, 'changeCount'),
    sourceChangeCount: changeLogInt64ToDecimal(
      input.sourceChangeCount,
      'sourceChangeCount'
    ),
    unavailableChangeCount: unavailable.length.toString(),
    unavailableChangeSerials: unavailable,
  }
}
