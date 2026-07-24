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
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CHANGE_LOG_DIGEST_ALGORITHM_MAX_LENGTH,
  CHANGE_LOG_DIGEST_PLUGIN_ID_MAX_LENGTH,
  CHANGE_LOG_DIGEST_VALUE_MAX_LENGTH,
  ChangeLogCancelledError,
  ChangeLogCodecError,
  normalizeChangeLogDocument,
  scanChangeLogJson,
  type ChangeLogDocument,
  type ChangeLogHeader,
  type NormalizedChangeLogEntry,
} from '../../src/changeLog'
import {
  openChangeLogFile,
  streamChangeLogExport,
  writeChangeLogFileAtomic,
  writeChangeLogRpcExportAtomic,
} from '../../src/changeLog/node'
import {
  ChangeLogEntryKind,
  type ExportChangeLogResponse,
} from '../../src/protobuf_ts/generated/omega_edit/v1/omega_edit'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true }))
  )
})

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'omega-change-log-')
  )
  tempDirectories.push(directory)
  return directory
}

function fingerprint(byteLength: string) {
  return {
    byteLength,
    digest: {
      algorithm: 'sha256',
      value: 'a'.repeat(64),
    },
  }
}

function documentWithEntries(count: number): ChangeLogDocument {
  return {
    format: 'omega-edit.change-log',
    version: 2,
    complete: true,
    before: fingerprint('0'),
    after: fingerprint(count.toString()),
    changeCount: count.toString(),
    sourceChangeCount: count.toString(),
    unavailableChangeCount: '0',
    unavailableChangeSerials: [],
    changes: Array.from({ length: count }, (_, index) => ({
      serial: (index + 1).toString(),
      kind: 'INSERT' as const,
      offset: index.toString(),
      length: '0',
      data: '61',
      groupId: `group-${Math.floor(index / 10)}`,
    })),
  }
}

function headerFor(document: ChangeLogDocument): ChangeLogHeader {
  return {
    format: document.format,
    version: document.version,
    complete: document.complete,
    before: {
      byteLength: document.before.byteLength.toString(),
      digest: document.before.digest,
    },
    after: {
      byteLength: document.after.byteLength.toString(),
      digest: document.after.digest,
    },
    changeCount: document.changeCount.toString(),
    sourceChangeCount: document.sourceChangeCount.toString(),
    unavailableChangeCount: document.unavailableChangeCount.toString(),
    unavailableChangeSerials: [],
  }
}

async function* chunks(text: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = Buffer.from(text, 'utf8')
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, offset + size)
  }
}

async function streamedEntries(
  text: string
): Promise<NormalizedChangeLogEntry[]> {
  const entries: NormalizedChangeLogEntry[] = []
  for await (const event of scanChangeLogJson(chunks(text, 7))) {
    if (event.type === 'entry') {
      entries.push(event.entry)
    }
  }
  return entries
}

describe('shared change-log codec', () => {
  it('rejects invalid or oversized fingerprint digest metadata', () => {
    const document = documentWithEntries(0)
    document.before.digest.pluginId = 'a'.repeat(
      CHANGE_LOG_DIGEST_PLUGIN_ID_MAX_LENGTH + 1
    )
    expect(() => normalizeChangeLogDocument(document)).toThrowError(
      expect.objectContaining({ code: 'CHANGE_LOG_INVALID_FINGERPRINT' })
    )

    document.before.digest.pluginId = 'omega.example.digest'
    document.before.digest.algorithm = 'a'.repeat(
      CHANGE_LOG_DIGEST_ALGORITHM_MAX_LENGTH + 1
    )
    expect(() => normalizeChangeLogDocument(document)).toThrowError(
      expect.objectContaining({ code: 'CHANGE_LOG_INVALID_FINGERPRINT' })
    )

    document.before.digest.algorithm = 'sha256'
    document.before.digest.value = 'a'.repeat(
      CHANGE_LOG_DIGEST_VALUE_MAX_LENGTH + 1
    )
    expect(() => normalizeChangeLogDocument(document)).toThrowError(
      expect.objectContaining({ code: 'CHANGE_LOG_INVALID_FINGERPRINT' })
    )

    document.before.digest.value = 'not-hex'
    expect(() => normalizeChangeLogDocument(document)).toThrowError(
      expect.objectContaining({ code: 'CHANGE_LOG_INVALID_FINGERPRINT' })
    )
  })

  it('normalizes inline and streamed v2 documents identically', async () => {
    const document = documentWithEntries(3)
    const inline = normalizeChangeLogDocument(document)
    const inlineEntries: NormalizedChangeLogEntry[] = []
    for await (const entry of inline.entries()) {
      inlineEntries.push(entry)
    }

    const streamed = await streamedEntries(JSON.stringify(document))
    expect(streamed).toEqual(inlineEntries)
    expect(inline.changeCount).toBe('3')
    expect(inline.primitiveCounts).toMatchObject({ total: 3, insert: 3 })
  })

  it('normalizes first-class transform descriptors from data', async () => {
    const descriptor = Buffer.from(
      JSON.stringify({
        transformId: 'omega.test.transform',
        args: { case: 'upper', nested: { value: 1 } },
      })
    ).toString('hex')
    const document = documentWithEntries(1)
    document.changes = [
      {
        serial: '1',
        kind: 'TRANSFORM',
        offset: '0',
        length: '1',
        data: descriptor,
      },
    ]
    const prepared = normalizeChangeLogDocument(document)
    const entries: NormalizedChangeLogEntry[] = []
    for await (const entry of prepared.entries()) {
      entries.push(entry)
    }
    expect(entries[0].transformDescriptor).toEqual({
      transformId: 'omega.test.transform',
      optionsJson: '{"case":"upper","nested":{"value":1}}',
    })
    expect(prepared.requiredPlugins).toEqual(['omega.test.transform'])
    expect(prepared.transformDescriptors).toHaveLength(1)

    expect(() =>
      normalizeChangeLogDocument(document, {
        limits: { maxTransformIdBytes: 3 },
      })
    ).toThrow(/transformId exceeds 3 UTF-8 bytes/)
  })

  it('decodes mixed-case transform descriptor hex without per-byte parsing', async () => {
    const descriptor = Buffer.from(
      JSON.stringify({
        transformId: 'ωmega.transform',
        args: { mode: 'ω' },
      })
    )
      .toString('hex')
      .replace(/[a-f]/g, (digit, index) =>
        index % 2 === 0 ? digit.toUpperCase() : digit
      )
    const document = documentWithEntries(1)
    document.changes = [
      {
        serial: '1',
        kind: 'TRANSFORM',
        offset: '0',
        length: '1',
        data: descriptor,
      },
    ]

    const prepared = normalizeChangeLogDocument(document)
    const entries: NormalizedChangeLogEntry[] = []
    for await (const entry of prepared.entries()) {
      entries.push(entry)
    }

    expect(entries[0].transformDescriptor).toEqual({
      transformId: 'ωmega.transform',
      optionsJson: '{"mode":"ω"}',
    })
  })

  it('rejects duplicate headers, trailing data, malformed UTF-8, and unsafe integers', async () => {
    const valid = documentWithEntries(0)
    const duplicate = JSON.stringify(valid).replace(
      '"version":2',
      '"version":2,"version":2'
    )
    await expect(streamedEntries(duplicate)).rejects.toMatchObject({
      code: 'CHANGE_LOG_DUPLICATE_PROPERTY',
    })
    const nestedDuplicate = JSON.stringify(valid).replace(
      '"algorithm":"sha256"',
      '"algorithm":"sha256","algorithm":"sha256"'
    )
    await expect(streamedEntries(nestedDuplicate)).rejects.toMatchObject({
      code: 'CHANGE_LOG_DUPLICATE_PROPERTY',
    })
    await expect(
      streamedEntries(`${JSON.stringify(valid)} false`)
    ).rejects.toMatchObject({ code: 'CHANGE_LOG_TRAILING_DATA' })

    async function* invalidUtf8() {
      yield new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d])
    }
    await expect(async () => {
      for await (const _event of scanChangeLogJson(invalidUtf8())) {
        // Consume the parser.
      }
    }).rejects.toMatchObject({ code: 'CHANGE_LOG_INVALID_UNICODE' })

    expect(() =>
      normalizeChangeLogDocument({
        ...valid,
        before: { ...valid.before, byteLength: Number.MAX_SAFE_INTEGER + 1 },
      })
    ).toThrow(/safe integer or decimal int64 string/)
  })

  it('enforces nesting, entry, string, group, and cancellation limits', async () => {
    const document = documentWithEntries(2)
    expect(() =>
      normalizeChangeLogDocument(document, {
        limits: { maxEntryCount: 1 },
      })
    ).toThrow(/entry count exceeds 1/)
    expect(() =>
      normalizeChangeLogDocument(documentWithEntries(21), {
        limits: { maxGroupCount: 1 },
      })
    ).toThrow(/closed group count exceeds 1/)
    expect(() =>
      normalizeChangeLogDocument(document, {
        limits: { maxStringChars: 2 },
      })
    ).toThrow(/string exceeds 2/)
    expect(() =>
      normalizeChangeLogDocument(document, {
        signal: { aborted: true },
      })
    ).toThrow(ChangeLogCancelledError)

    const controller = new AbortController()
    async function* cancelledChunks() {
      const encoded = Buffer.from(JSON.stringify(document))
      yield encoded.subarray(0, 16)
      controller.abort()
      yield encoded.subarray(16)
    }
    await expect(async () => {
      for await (const _event of scanChangeLogJson(cancelledChunks(), {
        signal: controller.signal,
      })) {
        // Consume until cancellation is observed.
      }
    }).rejects.toBeInstanceOf(ChangeLogCancelledError)
  })

  it('streams a large file with memory bounded by one entry and one input chunk', async () => {
    const directory = await tempDirectory()
    const file = path.join(directory, 'large.json')
    const document = documentWithEntries(20_000)
    await fs.writeFile(file, JSON.stringify(document))

    const source = await openChangeLogFile(file)
    expect(source.entryCount).toBe(20_000)
    expect(source.diagnostics.maxValueChars).toBeLessThan(1024)
    expect(source.diagnostics.maxBufferedChars).toBeLessThan(70_000)
    let count = 0
    for await (const _entry of source.entries()) {
      count += 1
    }
    expect(count).toBe(20_000)
  })

  it('writes atomically, fsyncs before commit, and reports exact checksum', async () => {
    const directory = await tempDirectory()
    const file = path.join(directory, 'change-log.json')
    const document = documentWithEntries(3)
    const result = await writeChangeLogFileAtomic(
      file,
      headerFor(document),
      async (sink) => {
        for (const entry of document.changes) {
          await sink.writeEntry(entry)
        }
      }
    )
    const bytes = await fs.readFile(file)
    expect(result.byteLength).toBe(bytes.byteLength)
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect((await openChangeLogFile(file)).changeCount).toBe('3')

    const original = await fs.readFile(file, 'utf8')
    await expect(
      writeChangeLogFileAtomic(file, headerFor(document), async (sink) => {
        for (const entry of document.changes) {
          await sink.writeEntry(entry)
        }
      })
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it('detects replacement between preflight and replay before yielding entries', async () => {
    const directory = await tempDirectory()
    const file = path.join(directory, 'change-log.json')
    const document = documentWithEntries(2)
    await fs.writeFile(file, JSON.stringify(document))
    const source = await openChangeLogFile(file)
    await fs.appendFile(file, ' ')
    await expect(async () => {
      for await (const _entry of source.entries()) {
        // The identity check runs before the first yield.
      }
    }).rejects.toMatchObject({ code: 'CHANGE_LOG_FILE_CHANGED' })
  })

  it('removes temporary output after cancellation, validation failure, and output limits', async () => {
    const directory = await tempDirectory()
    const file = path.join(directory, 'change-log.json')
    const document = documentWithEntries(1)
    await expect(
      writeChangeLogFileAtomic(
        file,
        headerFor(document),
        async (sink) => sink.writeEntry(document.changes[0]),
        { signal: { aborted: true } }
      )
    ).rejects.toBeInstanceOf(ChangeLogCancelledError)
    await expect(
      writeChangeLogFileAtomic(
        file,
        headerFor(document),
        async (sink) => sink.writeEntry(document.changes[0]),
        { maxBytes: 16 }
      )
    ).rejects.toMatchObject({ code: 'CHANGE_LOG_OUTPUT_LIMIT' })
    await expect(
      writeChangeLogFileAtomic(
        file,
        headerFor(document),
        async (sink) => sink.writeEntry(document.changes[0]),
        { beforeCommit: async () => Promise.reject(new Error('injected')) }
      )
    ).rejects.toThrow('injected')
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('uses a stable codec error shape', () => {
    const error = new ChangeLogCodecError('TEST', 'message')
    expect(error).toMatchObject({ name: 'ChangeLogCodecError', code: 'TEST' })
  })
})

class FakeExportStream extends EventEmitter {
  readonly frames: ExportChangeLogResponse[]
  pauseCount = 0
  resumeCount = 0
  cancelled = false
  private paused = false

  constructor(frames: ExportChangeLogResponse[]) {
    super()
    this.frames = [...frames]
  }

  start(): void {
    setTimeout(() => this.drain(), 0)
  }

  pause(): this {
    this.paused = true
    this.pauseCount += 1
    return this
  }

  resume(): this {
    this.paused = false
    this.resumeCount += 1
    queueMicrotask(() => this.drain())
    return this
  }

  cancel(): void {
    this.cancelled = true
  }

  private drain(): void {
    while (!this.paused && this.frames.length > 0) {
      this.emit('data', this.frames.shift())
    }
    if (!this.paused && this.frames.length === 0) {
      this.emit('end')
    }
  }
}

describe('bounded change-log RPC iterator', () => {
  it('cancels a stream with oversized fingerprint metadata', async () => {
    const fake = new FakeExportStream([
      {
        frame: {
          oneofKind: 'header',
          header: {
            formatVersion: 3,
            resolvedFirstSerialDecimal: '0',
            resolvedLastSerialDecimal: '0',
            sourceChangeCountDecimal: '0',
            before: {
              byteLengthDecimal: '0',
              digestPluginId: 'omega.example.digest',
              digestAlgorithm: 'sha256',
              digestValue: 'a'.repeat(CHANGE_LOG_DIGEST_VALUE_MAX_LENGTH + 1),
            },
            after: {
              byteLengthDecimal: '0',
              digestPluginId: 'omega.example.digest',
              digestAlgorithm: 'sha256',
              digestValue: 'b'.repeat(64),
            },
            optimized: true,
          },
        },
      },
    ])
    await expect(async () => {
      for await (const _frame of streamChangeLogExport({
        sessionId: 'test',
        subscribe: () => {
          fake.start()
          return fake
        },
      })) {
        // Consume until validation fails.
      }
    }).rejects.toMatchObject({ code: 'CHANGE_LOG_RPC_FRAMING' })
    expect(fake.cancelled).toBe(true)
  })

  it('validates framing and applies backpressure at four queued frames', async () => {
    const data = Buffer.from('hello')
    const frames: ExportChangeLogResponse[] = [
      {
        frame: {
          oneofKind: 'header',
          header: {
            formatVersion: 3,
            resolvedFirstSerialDecimal: '1',
            resolvedLastSerialDecimal: '1',
            sourceChangeCountDecimal: '1',
            before: {
              byteLengthDecimal: '0',
              digestPluginId: 'omega.example.custom_digest',
              digestAlgorithm: 'sha512',
              digestValue: 'a'.repeat(128),
            },
            after: {
              byteLengthDecimal: '5',
              digestPluginId: 'omega.example.custom_digest',
              digestAlgorithm: 'sha512',
              digestValue: 'b'.repeat(128),
            },
            optimized: true,
          },
        },
      },
      {
        frame: {
          oneofKind: 'entry',
          entry: {
            entryIndexDecimal: '0',
            kind: ChangeLogEntryKind.INSERT,
            offsetDecimal: '0',
            lengthDecimal: '0',
            payloadLengthDecimal: '5',
          },
        },
      },
      {
        frame: {
          oneofKind: 'payload',
          payload: {
            entryIndexDecimal: '0',
            chunkOffsetDecimal: '0',
            data,
            finalChunk: true,
          },
        },
      },
      {
        frame: {
          oneofKind: 'complete',
          complete: {
            emittedChangeCountDecimal: '1',
            payloadByteCountDecimal: '5',
          },
        },
      },
    ]
    const fake = new FakeExportStream(frames)
    const types: string[] = []
    for await (const frame of streamChangeLogExport({
      sessionId: 'test',
      optimize: true,
      digestPluginId: 'omega.example.custom_digest',
      digestAlgorithm: 'sha512',
      subscribe: (request) => {
        expect(request.digestPluginId).toBe('omega.example.custom_digest')
        expect(request.digestAlgorithm).toBe('sha512')
        fake.start()
        return fake
      },
    })) {
      types.push(frame.type)
    }
    expect(types).toEqual(['header', 'entry', 'payload', 'complete'])
    expect(fake.pauseCount).toBe(1)
    expect(fake.resumeCount).toBe(1)
    expect(fake.cancelled).toBe(false)

    const directory = await tempDirectory()
    const output = path.join(directory, 'rpc.json')
    const writerFake = new FakeExportStream(frames)
    const written = await writeChangeLogRpcExportAtomic(output, {
      sessionId: 'test',
      optimize: true,
      subscribe: () => {
        writerFake.start()
        return writerFake
      },
    })
    expect(written.entryCount).toBe(1)
    const prepared = await openChangeLogFile(output)
    expect(prepared.changeCount).toBe('1')
    expect(prepared.before.digest).toMatchObject({
      pluginId: 'omega.example.custom_digest',
      algorithm: 'sha512',
    })
    const entries: NormalizedChangeLogEntry[] = []
    for await (const entry of prepared.entries()) {
      entries.push(entry)
    }
    expect(entries[0]).toMatchObject({ kind: 'INSERT', data: '68656c6c6f' })
  })

  it('cancels a stream with non-contiguous payload frames', async () => {
    const data = Buffer.from('x')
    const fake = new FakeExportStream([
      {
        frame: {
          oneofKind: 'header',
          header: {
            formatVersion: 3,
            resolvedFirstSerialDecimal: '1',
            resolvedLastSerialDecimal: '1',
            sourceChangeCountDecimal: '1',
            before: {
              byteLengthDecimal: '0',
              digestPluginId: 'omega.example.openssl_digests',
              digestAlgorithm: 'sha256',
              digestValue: 'a'.repeat(64),
            },
            after: {
              byteLengthDecimal: '1',
              digestPluginId: 'omega.example.openssl_digests',
              digestAlgorithm: 'sha256',
              digestValue: 'b'.repeat(64),
            },
            optimized: true,
          },
        },
      },
      {
        frame: {
          oneofKind: 'entry',
          entry: {
            entryIndexDecimal: '0',
            kind: ChangeLogEntryKind.INSERT,
            offsetDecimal: '0',
            lengthDecimal: '0',
            payloadLengthDecimal: '1',
          },
        },
      },
      {
        frame: {
          oneofKind: 'payload',
          payload: {
            entryIndexDecimal: '0',
            chunkOffsetDecimal: '1',
            data,
            finalChunk: true,
          },
        },
      },
    ])
    await expect(async () => {
      for await (const _frame of streamChangeLogExport({
        sessionId: 'test',
        subscribe: () => {
          fake.start()
          return fake
        },
      })) {
        // Consume until validation fails.
      }
    }).rejects.toMatchObject({ code: 'CHANGE_LOG_RPC_FRAMING' })
    expect(fake.cancelled).toBe(true)
  })

  it('cancels the underlying RPC when its abort signal fires', async () => {
    const fake = new FakeExportStream([
      {
        frame: {
          oneofKind: 'header',
          header: {
            formatVersion: 3,
            resolvedFirstSerialDecimal: '1',
            resolvedLastSerialDecimal: '1',
            sourceChangeCountDecimal: '1',
            before: {
              byteLengthDecimal: '0',
              digestPluginId: 'omega.example.openssl_digests',
              digestAlgorithm: 'sha256',
              digestValue: 'a'.repeat(64),
            },
            after: {
              byteLengthDecimal: '0',
              digestPluginId: 'omega.example.openssl_digests',
              digestAlgorithm: 'sha256',
              digestValue: 'b'.repeat(64),
            },
            optimized: true,
          },
        },
      },
      {
        frame: {
          oneofKind: 'complete',
          complete: {
            emittedChangeCountDecimal: '0',
            payloadByteCountDecimal: '0',
          },
        },
      },
    ])
    const controller = new AbortController()
    await expect(async () => {
      for await (const frame of streamChangeLogExport({
        sessionId: 'test',
        signal: controller.signal,
        subscribe: () => {
          fake.start()
          return fake
        },
      })) {
        if (frame.type === 'header') {
          controller.abort()
        }
      }
    }).rejects.toBeInstanceOf(ChangeLogCancelledError)
    expect(fake.cancelled).toBe(true)
  })
})
