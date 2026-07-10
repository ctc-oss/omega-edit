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

import {
  ChangeLogCodecError,
  ChangeLogScanAccumulator,
  normalizeChangeLogEntry,
  resolveChangeLogCodecLimits,
  throwIfChangeLogCancelled,
  validateChangeLogJsonValue,
} from './codec'
import type {
  ChangeLogCodecLimits,
  ChangeLogCodecOptions,
  ChangeLogScanDiagnostics,
  ChangeLogScanResult,
  NormalizedChangeLogEntry,
} from './types'

export type ChangeLogStreamEvent =
  | { type: 'entry'; entry: NormalizedChangeLogEntry; index: number }
  | { type: 'complete'; result: ChangeLogScanResult }

class StreamingJsonCursor {
  private readonly iterator: AsyncIterator<Uint8Array | string>
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })
  private readonly encoder = new TextEncoder()
  private buffer = ''
  private position = 0
  private ended = false
  private decoderFlushed = false
  private bytesRead = 0
  private maxBufferedChars = 0
  private maxValueChars = 0

  constructor(
    source: AsyncIterable<Uint8Array | string>,
    private readonly options: ChangeLogCodecOptions
  ) {
    this.iterator = source[Symbol.asyncIterator]()
  }

  diagnostics(): ChangeLogScanDiagnostics {
    return {
      bytesRead: this.bytesRead,
      maxBufferedChars: this.maxBufferedChars,
      maxValueChars: this.maxValueChars,
    }
  }

  private async fill(): Promise<boolean> {
    while (this.position >= this.buffer.length && !this.ended) {
      throwIfChangeLogCancelled(this.options.signal)
      const next = await this.iterator.next()
      if (next.done) {
        this.ended = true
        if (!this.decoderFlushed) {
          this.decoderFlushed = true
          try {
            this.buffer = this.decoder.decode()
          } catch (error) {
            throw new ChangeLogCodecError(
              'CHANGE_LOG_INVALID_UNICODE',
              'Change log contains invalid UTF-8',
              error
            )
          }
          this.position = 0
          this.maxBufferedChars = Math.max(
            this.maxBufferedChars,
            this.buffer.length
          )
          if (this.buffer.length > 0) {
            return true
          }
        }
        return false
      }

      try {
        if (typeof next.value === 'string') {
          this.bytesRead += this.encoder.encode(next.value).length
          this.buffer = next.value
        } else {
          this.bytesRead += next.value.byteLength
          this.buffer = this.decoder.decode(next.value, { stream: true })
        }
      } catch (error) {
        throw new ChangeLogCodecError(
          'CHANGE_LOG_INVALID_UNICODE',
          'Change log contains invalid UTF-8',
          error
        )
      }
      this.position = 0
      this.maxBufferedChars = Math.max(
        this.maxBufferedChars,
        this.buffer.length
      )
    }
    return this.position < this.buffer.length
  }

  async peek(): Promise<string | undefined> {
    return (await this.fill()) ? this.buffer[this.position] : undefined
  }

  async take(): Promise<string | undefined> {
    if (!(await this.fill())) {
      return undefined
    }
    return this.buffer[this.position++]
  }

  async skipWhitespace(): Promise<void> {
    while (true) {
      const char = await this.peek()
      if (char !== ' ' && char !== '\n' && char !== '\r' && char !== '\t') {
        return
      }
      this.position += 1
    }
  }

  async expect(expected: string, context: string): Promise<void> {
    await this.skipWhitespace()
    const actual = await this.take()
    if (actual !== expected) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_JSON',
        `${context}: expected ${JSON.stringify(expected)}, found ${
          actual === undefined ? 'end of input' : JSON.stringify(actual)
        }`
      )
    }
  }

  async readRawValue(
    maxChars: number,
    maxNesting: number,
    context: string
  ): Promise<string> {
    await this.skipWhitespace()
    const first = await this.peek()
    if (first === undefined) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_JSON',
        `${context}: expected a JSON value, found end of input`
      )
    }

    const parts: string[] = []
    let total = 0
    let inString = false
    let escaped = false
    let nesting = 0
    let mode: 'string' | 'container' | 'primitive'
    if (first === '"') {
      mode = 'string'
    } else if (first === '{' || first === '[') {
      mode = 'container'
    } else {
      mode = 'primitive'
    }

    while (true) {
      throwIfChangeLogCancelled(this.options.signal)
      if (!(await this.fill())) {
        if (mode === 'primitive' && total > 0) {
          break
        }
        throw new ChangeLogCodecError(
          'CHANGE_LOG_INVALID_JSON',
          `${context}: unterminated JSON value`
        )
      }
      const start = this.position
      let complete = false
      while (this.position < this.buffer.length) {
        const char = this.buffer[this.position]
        if (mode === 'primitive' && !inString && nesting === 0) {
          if (
            char === ',' ||
            char === '}' ||
            char === ']' ||
            char === ' ' ||
            char === '\n' ||
            char === '\r' ||
            char === '\t'
          ) {
            complete = true
            break
          }
        }

        this.position += 1
        if (inString) {
          if (escaped) {
            escaped = false
          } else if (char === '\\') {
            escaped = true
          } else if (char === '"') {
            inString = false
            if (mode === 'string' && nesting === 0) {
              complete = true
              break
            }
          }
        } else if (char === '"') {
          inString = true
        } else if (char === '{' || char === '[') {
          nesting += 1
          if (nesting > maxNesting) {
            throw new ChangeLogCodecError(
              'CHANGE_LOG_NESTING_LIMIT',
              `Change log JSON nesting exceeds ${maxNesting} levels (${context})`
            )
          }
        } else if (char === '}' || char === ']') {
          nesting -= 1
          if (nesting < 0) {
            throw new ChangeLogCodecError(
              'CHANGE_LOG_INVALID_JSON',
              `${context}: unexpected ${JSON.stringify(char)}`
            )
          }
          if (mode === 'container' && nesting === 0) {
            complete = true
            break
          }
        }
      }

      const piece = this.buffer.slice(start, this.position)
      if (piece.length > 0) {
        parts.push(piece)
        total += piece.length
        this.maxValueChars = Math.max(this.maxValueChars, total)
        this.maxBufferedChars = Math.max(
          this.maxBufferedChars,
          total + this.buffer.length - this.position
        )
        if (total > maxChars) {
          throw new ChangeLogCodecError(
            'CHANGE_LOG_VALUE_LIMIT',
            `${context} exceeds ${maxChars} characters`
          )
        }
      }
      if (complete) {
        break
      }
    }

    const raw = parts.join('')
    if (!raw) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_JSON',
        `${context}: empty JSON value`
      )
    }
    return raw
  }
}

function assertNoDuplicateJsonProperties(raw: string, context: string): void {
  const stack: Array<
    { kind: 'array' } | { kind: 'object'; keys: Set<string> }
  > = []
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (char === '{') {
      stack.push({ kind: 'object', keys: new Set<string>() })
      continue
    }
    if (char === '[') {
      stack.push({ kind: 'array' })
      continue
    }
    if (char === '}' || char === ']') {
      stack.pop()
      continue
    }
    if (char !== '"') {
      continue
    }

    const start = index
    let escaped = false
    index += 1
    while (index < raw.length) {
      const stringChar = raw[index]
      if (escaped) {
        escaped = false
      } else if (stringChar === '\\') {
        escaped = true
      } else if (stringChar === '"') {
        break
      }
      index += 1
    }
    let next = index + 1
    while (
      next < raw.length &&
      (raw[next] === ' ' ||
        raw[next] === '\n' ||
        raw[next] === '\r' ||
        raw[next] === '\t')
    ) {
      next += 1
    }
    const container = stack[stack.length - 1]
    if (raw[next] !== ':' || container?.kind !== 'object') {
      continue
    }
    let key: string
    try {
      key = JSON.parse(raw.slice(start, index + 1)) as string
    } catch {
      continue
    }
    if (container.keys.has(key)) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_DUPLICATE_PROPERTY',
        `${context} property ${JSON.stringify(key)} is duplicated`
      )
    }
    container.keys.add(key)
  }
}

function parseRawJson(raw: string, context: string): unknown {
  assertNoDuplicateJsonProperties(raw, context)
  try {
    return JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_JSON',
      `${context}: ${message}`,
      error
    )
  }
}

async function readPropertyName(
  cursor: StreamingJsonCursor,
  limits: ChangeLogCodecLimits
): Promise<string> {
  const raw = await cursor.readRawValue(
    Math.min(limits.maxHeaderValueChars, 65_536),
    limits.maxNesting,
    'Change log property name'
  )
  const value = parseRawJson(raw, 'Invalid change log property name')
  if (typeof value !== 'string') {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_JSON',
      'Change log property name must be a string'
    )
  }
  return value
}

export async function* scanChangeLogJson(
  source: AsyncIterable<Uint8Array | string>,
  options: ChangeLogCodecOptions = {}
): AsyncGenerator<ChangeLogStreamEvent> {
  const limits = resolveChangeLogCodecLimits(options.limits)
  const cursor = new StreamingJsonCursor(source, options)
  const accumulator = new ChangeLogScanAccumulator(limits)
  const document: Record<string, unknown> = {}
  const seenProperties = new Set<string>()
  let sawChanges = false

  await cursor.expect('{', 'Change log document')
  await cursor.skipWhitespace()
  if ((await cursor.peek()) === '}') {
    await cursor.take()
  } else {
    while (true) {
      throwIfChangeLogCancelled(options.signal)
      const property = await readPropertyName(cursor, limits)
      if (seenProperties.has(property)) {
        throw new ChangeLogCodecError(
          'CHANGE_LOG_DUPLICATE_PROPERTY',
          `Change log property ${JSON.stringify(property)} is duplicated`
        )
      }
      seenProperties.add(property)
      await cursor.expect(
        ':',
        `Change log property ${JSON.stringify(property)}`
      )

      if (property === 'changes') {
        sawChanges = true
        await cursor.expect('[', 'Change log changes')
        await cursor.skipWhitespace()
        let index = 0
        if ((await cursor.peek()) === ']') {
          await cursor.take()
        } else {
          while (true) {
            const raw = await cursor.readRawValue(
              limits.maxEntryChars,
              limits.maxNesting,
              `Change log entry ${index}`
            )
            const value = parseRawJson(raw, `Invalid change log entry ${index}`)
            validateChangeLogJsonValue(
              value,
              limits,
              `Change log entry ${index}`
            )
            const entry = normalizeChangeLogEntry(value, index, limits)
            accumulator.accept(entry, index)
            yield { type: 'entry', entry, index }
            index += 1
            await cursor.skipWhitespace()
            const delimiter = await cursor.take()
            if (delimiter === ']') {
              break
            }
            if (delimiter !== ',') {
              throw new ChangeLogCodecError(
                'CHANGE_LOG_INVALID_JSON',
                `Change log changes: expected comma or closing bracket, found ${
                  delimiter === undefined
                    ? 'end of input'
                    : JSON.stringify(delimiter)
                }`
              )
            }
            await cursor.skipWhitespace()
            if ((await cursor.peek()) === ']') {
              throw new ChangeLogCodecError(
                'CHANGE_LOG_INVALID_JSON',
                'Change log changes must not contain a trailing comma'
              )
            }
          }
        }
      } else {
        const raw = await cursor.readRawValue(
          limits.maxHeaderValueChars,
          limits.maxNesting,
          `Change log ${property}`
        )
        const value = parseRawJson(raw, `Invalid change log ${property}`)
        validateChangeLogJsonValue(value, limits, `Change log ${property}`)
        document[property] = value
      }

      await cursor.skipWhitespace()
      const delimiter = await cursor.take()
      if (delimiter === '}') {
        break
      }
      if (delimiter !== ',') {
        throw new ChangeLogCodecError(
          'CHANGE_LOG_INVALID_JSON',
          `Change log document: expected comma or closing brace, found ${
            delimiter === undefined ? 'end of input' : JSON.stringify(delimiter)
          }`
        )
      }
      await cursor.skipWhitespace()
      if ((await cursor.peek()) === '}') {
        throw new ChangeLogCodecError(
          'CHANGE_LOG_INVALID_JSON',
          'Change log document must not contain a trailing comma'
        )
      }
    }
  }

  if (!sawChanges) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_DOCUMENT',
      'Change log changes must be an array'
    )
  }
  await cursor.skipWhitespace()
  if ((await cursor.peek()) !== undefined) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_TRAILING_DATA',
      'Change log contains trailing data'
    )
  }
  const result = accumulator.finish(document, cursor.diagnostics())
  yield { type: 'complete', result }
}

export async function scanChangeLogJsonToResult(
  source: AsyncIterable<Uint8Array | string>,
  options: ChangeLogCodecOptions = {}
): Promise<ChangeLogScanResult> {
  let result: ChangeLogScanResult | undefined
  for await (const event of scanChangeLogJson(source, options)) {
    if (event.type === 'complete') {
      result = event.result
    }
  }
  if (!result) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INCOMPLETE_SCAN',
      'Change log scan did not complete'
    )
  }
  return result
}
