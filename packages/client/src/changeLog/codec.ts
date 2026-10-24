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
  CHANGE_LOG_DEFAULT_DIGEST_PLUGIN_ID,
  CHANGE_LOG_DIGEST_ALGORITHM_MAX_LENGTH,
  CHANGE_LOG_DIGEST_PLUGIN_ID_MAX_LENGTH,
  CHANGE_LOG_DIGEST_VALUE_MAX_LENGTH,
  CHANGE_LOG_FORMAT,
  CHANGE_LOG_VERSION,
  type ChangeLogCodecLimits,
  type ChangeLogCodecOptions,
  type ChangeLogDocument,
  type ChangeLogEntry,
  type ChangeLogFingerprint,
  type ChangeLogHeader,
  type ChangeLogPrimitiveCounts,
  type ChangeLogScanDiagnostics,
  type ChangeLogScanResult,
  type ChangeLogTransformDescriptor,
  type ChangeLogTransformDescriptorSummary,
  type NormalizedChangeLogEntry,
  type NormalizedChangeLogFingerprint,
  type PreparedChangeLog,
} from './types'

const ZERO = BigInt(0)
const MAX_INT64 = BigInt('9223372036854775807')

export const DEFAULT_CHANGE_LOG_CODEC_LIMITS: Readonly<ChangeLogCodecLimits> = {
  maxNesting: 256,
  maxEntryCount: 1_000_000,
  maxEntryChars: 134_221_824,
  maxHeaderValueChars: 16_777_216,
  maxStringChars: 134_217_728,
  maxGroupIdChars: 256,
  maxGroupCount: 65_536,
  maxTransformCount: 65_536,
  maxTransformIdBytes: 4096,
  maxTransformOptionsBytes: 1_048_576,
  maxRequiredPluginCount: 4096,
  maxUnavailableSerialCount: 65_536,
}

export class ChangeLogCodecError extends Error {
  readonly code: string

  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'ChangeLogCodecError'
    this.code = code
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

export class ChangeLogCancelledError extends ChangeLogCodecError {
  constructor() {
    super('CHANGE_LOG_CANCELLED', 'Change log operation was cancelled')
    this.name = 'ChangeLogCancelledError'
  }
}

export function resolveChangeLogCodecLimits(
  overrides?: Partial<ChangeLogCodecLimits>
): ChangeLogCodecLimits {
  const limits = { ...DEFAULT_CHANGE_LOG_CODEC_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_LIMIT',
        `${name} must be a positive safe integer`
      )
    }
  }
  return limits
}

export function throwIfChangeLogCancelled(
  signal: ChangeLogCodecOptions['signal']
): void {
  if (signal?.aborted) {
    throw new ChangeLogCancelledError()
  }
}

export function isChangeLogRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseChangeLogNonNegativeInt64(
  value: unknown,
  name: string
): bigint {
  let parsed: bigint
  if (typeof value === 'bigint') {
    parsed = value
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_INT64',
        `${name} must be a non-negative safe integer or decimal int64 string`
      )
    }
    parsed = BigInt(value)
  } else if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    parsed = BigInt(value)
  } else {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_INT64',
      `${name} must be a non-negative int64`
    )
  }

  if (parsed < ZERO || parsed > MAX_INT64) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_INT64',
      `${name} must be in the non-negative int64 range`
    )
  }
  return parsed
}

export function parseChangeLogPositiveInt64(
  value: unknown,
  name: string
): bigint {
  const parsed = parseChangeLogNonNegativeInt64(value, name)
  if (parsed === ZERO) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_INT64',
      `${name} must be a positive int64`
    )
  }
  return parsed
}

export function changeLogInt64ToDecimal(
  value: number | string | bigint,
  name = 'change log integer'
): string {
  return parseChangeLogNonNegativeInt64(value, name).toString()
}

function assertValidUnicodeString(value: string, name: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new ChangeLogCodecError(
          'CHANGE_LOG_INVALID_UNICODE',
          `${name} contains an unpaired high surrogate`
        )
      }
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_UNICODE',
        `${name} contains an unpaired low surrogate`
      )
    }
  }
}

export function validateChangeLogJsonValue(
  value: unknown,
  limits: ChangeLogCodecLimits,
  name: string,
  depth = 0
): void {
  if (depth > limits.maxNesting) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_NESTING_LIMIT',
      `Change log JSON nesting exceeds ${limits.maxNesting} levels (${name})`
    )
  }
  if (typeof value === 'string') {
    if (value.length > limits.maxStringChars) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_STRING_LIMIT',
        `${name} string exceeds ${limits.maxStringChars} characters`
      )
    }
    assertValidUnicodeString(value, name)
    return
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateChangeLogJsonValue(
        value[index],
        limits,
        `${name}[${index}]`,
        depth + 1
      )
    }
    return
  }
  if (isChangeLogRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      assertValidUnicodeString(key, `${name} property`)
      validateChangeLogJsonValue(nested, limits, `${name}.${key}`, depth + 1)
    }
  }
}

function normalizeHex(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length % 2 !== 0 ||
    !/^[0-9a-f]*$/i.test(value)
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_HEX',
      `${name} must be an even-length hexadecimal string`
    )
  }
  return value.toLowerCase()
}

function decodeHexUtf8(value: string, name: string): string {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    const offset = index * 2
    bytes[index] =
      (hexCodeUnitToNibble(value.charCodeAt(offset)) << 4) |
      hexCodeUnitToNibble(value.charCodeAt(offset + 1))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_UNICODE',
      `${name} must contain valid UTF-8`,
      error
    )
  }
}

function hexCodeUnitToNibble(codeUnit: number): number {
  return codeUnit <= 57 ? codeUnit - 48 : (codeUnit & 0xdf) - 55
}

function parseTransformDescriptor(
  data: string,
  name: string,
  limits: ChangeLogCodecLimits
): ChangeLogTransformDescriptor {
  if (data.length === 0) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_TRANSFORM',
      `${name} requires data`
    )
  }
  const text = decodeHexUtf8(data, name)
  let descriptor: unknown
  try {
    descriptor = JSON.parse(text)
  } catch (error) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_TRANSFORM',
      `${name} must contain a JSON object`,
      error
    )
  }
  validateChangeLogJsonValue(descriptor, limits, name)
  if (!isChangeLogRecord(descriptor)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_TRANSFORM',
      `${name} must contain a JSON object`
    )
  }
  const transformId = descriptor.transformId
  if (typeof transformId !== 'string' || !transformId.trim()) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_TRANSFORM',
      `${name} requires transformId`
    )
  }
  const args = descriptor.args === undefined ? {} : descriptor.args
  if (!isChangeLogRecord(args)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_TRANSFORM',
      `${name} args must be a JSON object`
    )
  }
  const normalizedTransformId = transformId.trim()
  const optionsJson =
    Object.keys(args).length > 0 ? JSON.stringify(args) : undefined
  const encoder = new TextEncoder()
  if (
    encoder.encode(normalizedTransformId).byteLength >
    limits.maxTransformIdBytes
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_TRANSFORM_METADATA_LIMIT',
      `${name} transformId exceeds ${limits.maxTransformIdBytes} UTF-8 bytes`
    )
  }
  if (
    optionsJson &&
    encoder.encode(optionsJson).byteLength > limits.maxTransformOptionsBytes
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_TRANSFORM_METADATA_LIMIT',
      `${name} options exceed ${limits.maxTransformOptionsBytes} UTF-8 bytes`
    )
  }
  return {
    transformId: normalizedTransformId,
    ...(optionsJson ? { optionsJson } : {}),
  }
}

export function normalizeChangeLogEntry(
  value: unknown,
  index: number,
  limits: ChangeLogCodecLimits = resolveChangeLogCodecLimits()
): NormalizedChangeLogEntry {
  validateChangeLogJsonValue(value, limits, `Change log entry ${index}`)
  if (!isChangeLogRecord(value)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_ENTRY',
      `Change log entry ${index} must be an object`
    )
  }
  const { kind, offset, length, serial, groupId } = value
  if (
    kind !== 'INSERT' &&
    kind !== 'DELETE' &&
    kind !== 'OVERWRITE' &&
    kind !== 'REPLACE' &&
    kind !== 'TRANSFORM'
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_ENTRY',
      `Change log entry ${index} has an unsupported kind`
    )
  }

  const normalizedOffset = parseChangeLogNonNegativeInt64(
    offset,
    `Change log entry ${index} offset`
  ).toString()
  const normalizedLength = parseChangeLogNonNegativeInt64(
    length,
    `Change log entry ${index} length`
  ).toString()
  const data = normalizeHex(value.data, `Change log entry ${index} data`)
  const dataLength = BigInt(data.length / 2)
  if (
    (kind === 'INSERT' || kind === 'DELETE' || kind === 'OVERWRITE') &&
    dataLength === ZERO
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_ENTRY',
      `Change log entry ${index} ${kind} requires data`
    )
  }
  if (kind === 'DELETE' && dataLength !== BigInt(normalizedLength)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_ENTRY',
      `Change log entry ${index} DELETE data length mismatch`
    )
  }

  const normalized: NormalizedChangeLogEntry = {
    kind,
    offset: normalizedOffset,
    length: normalizedLength,
    data,
  }
  if (serial !== undefined) {
    normalized.serial = parseChangeLogPositiveInt64(
      serial,
      `Change log entry ${index} serial`
    ).toString()
  }
  if (groupId !== undefined) {
    if (typeof groupId !== 'string' || !groupId.trim()) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_ENTRY',
        `Change log entry ${index} groupId must be a string`
      )
    }
    const normalizedGroupId = groupId.trim()
    if (normalizedGroupId.length > limits.maxGroupIdChars) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_GROUP_LIMIT',
        `Change log entry ${index} groupId exceeds ${limits.maxGroupIdChars} characters`
      )
    }
    normalized.groupId = normalizedGroupId
  }
  if (kind === 'TRANSFORM') {
    const legacyFields = [
      'transformId',
      'optionsJson',
      'replacementLength',
      'computedFileSizeBefore',
      'computedFileSizeAfter',
    ].filter((field) => Object.prototype.hasOwnProperty.call(value, field))
    if (legacyFields.length > 0) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_TRANSFORM',
        `Change log entry ${index} TRANSFORM metadata must be carried in data`
      )
    }
    normalized.transformDescriptor = parseTransformDescriptor(
      data,
      `Change log entry ${index} TRANSFORM data`,
      limits
    )
  }
  return normalized
}

export function normalizeChangeLogFingerprint(
  value: unknown,
  key: 'before' | 'after'
): NormalizedChangeLogFingerprint {
  if (!isChangeLogRecord(value)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_FINGERPRINT',
      `Change log ${key} fingerprint must be an object`
    )
  }
  const byteLength = parseChangeLogNonNegativeInt64(
    value.byteLength,
    `Change log ${key}.byteLength`
  ).toString()
  if (!isChangeLogRecord(value.digest)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_FINGERPRINT',
      `Change log ${key}.digest must be an object`
    )
  }
  const algorithm = value.digest.algorithm
  const pluginId = value.digest.pluginId ?? CHANGE_LOG_DEFAULT_DIGEST_PLUGIN_ID
  const digestValue = value.digest.value
  const normalizedPluginId = typeof pluginId === 'string' ? pluginId.trim() : ''
  const normalizedAlgorithm =
    typeof algorithm === 'string' ? algorithm.trim().toLowerCase() : ''
  const normalizedDigestValue =
    typeof digestValue === 'string' ? digestValue.trim().toLowerCase() : ''
  if (
    !/^[A-Za-z0-9._-]+$/.test(normalizedPluginId) ||
    normalizedPluginId.length > CHANGE_LOG_DIGEST_PLUGIN_ID_MAX_LENGTH
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_FINGERPRINT',
      `Change log ${key}.digest.pluginId must contain 1-${CHANGE_LOG_DIGEST_PLUGIN_ID_MAX_LENGTH} ASCII letters, digits, dots, underscores, or hyphens`
    )
  }
  if (
    !/^[a-z0-9-]+$/.test(normalizedAlgorithm) ||
    normalizedAlgorithm.length > CHANGE_LOG_DIGEST_ALGORITHM_MAX_LENGTH
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_FINGERPRINT',
      `Change log ${key}.digest.algorithm must normalize to 1-${CHANGE_LOG_DIGEST_ALGORITHM_MAX_LENGTH} lowercase ASCII letters, digits, or hyphens`
    )
  }
  if (
    !/^[0-9a-f]+$/.test(normalizedDigestValue) ||
    normalizedDigestValue.length > CHANGE_LOG_DIGEST_VALUE_MAX_LENGTH
  ) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_FINGERPRINT',
      `Change log ${key}.digest.value must normalize to 1-${CHANGE_LOG_DIGEST_VALUE_MAX_LENGTH} lowercase hexadecimal characters`
    )
  }
  return {
    byteLength,
    digest: {
      pluginId: normalizedPluginId,
      algorithm: normalizedAlgorithm,
      value: normalizedDigestValue,
    },
  }
}

function normalizeUnavailableChangeSerials(
  value: unknown,
  sourceChangeCount: bigint,
  limits: ChangeLogCodecLimits
): string[] {
  if (!Array.isArray(value)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_METADATA',
      'Change log unavailableChangeSerials must be an array'
    )
  }
  if (value.length > limits.maxUnavailableSerialCount) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_UNAVAILABLE_SERIAL_LIMIT',
      `Change log unavailableChangeSerials exceeds ${limits.maxUnavailableSerialCount} entries`
    )
  }
  const seen = new Set<string>()
  return value.map((serial, index) => {
    const parsed = parseChangeLogPositiveInt64(
      serial,
      `Change log unavailableChangeSerials[${index}]`
    )
    if (parsed > sourceChangeCount) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_METADATA',
        `Change log unavailableChangeSerials[${index}] exceeds sourceChangeCount`
      )
    }
    const decimal = parsed.toString()
    if (seen.has(decimal)) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_METADATA',
        `Change log unavailableChangeSerials[${index}] duplicates serial ${decimal}`
      )
    }
    seen.add(decimal)
    return decimal
  })
}

export function normalizeChangeLogHeader(
  document: Record<string, unknown>,
  actualEntryCount: number,
  limits: ChangeLogCodecLimits = resolveChangeLogCodecLimits()
): ChangeLogHeader {
  if (document.format !== CHANGE_LOG_FORMAT) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_UNSUPPORTED_FORMAT',
      'Unsupported change log format'
    )
  }
  if (document.version !== CHANGE_LOG_VERSION) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_UNSUPPORTED_VERSION',
      'Unsupported change log version'
    )
  }
  if (typeof document.complete !== 'boolean') {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_METADATA',
      'Change log complete must be a boolean'
    )
  }
  const changeCount = parseChangeLogNonNegativeInt64(
    document.changeCount,
    'Change log changeCount'
  )
  const sourceChangeCount = parseChangeLogNonNegativeInt64(
    document.sourceChangeCount,
    'Change log sourceChangeCount'
  )
  const unavailableChangeCount = parseChangeLogNonNegativeInt64(
    document.unavailableChangeCount,
    'Change log unavailableChangeCount'
  )
  if (changeCount !== BigInt(actualEntryCount)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_METADATA',
      'Change log changeCount must match changes length'
    )
  }
  if (sourceChangeCount < changeCount) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_METADATA',
      'Change log sourceChangeCount must cover changeCount'
    )
  }
  const unavailableChangeSerials = normalizeUnavailableChangeSerials(
    document.unavailableChangeSerials,
    sourceChangeCount,
    limits
  )
  if (unavailableChangeCount !== BigInt(unavailableChangeSerials.length)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_METADATA',
      'Change log unavailableChangeCount must match unavailableChangeSerials length'
    )
  }
  if (document.complete !== (unavailableChangeCount === ZERO)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_METADATA',
      'Change log complete must match unavailable change metadata'
    )
  }
  return {
    format: CHANGE_LOG_FORMAT,
    version: CHANGE_LOG_VERSION,
    complete: document.complete,
    before: normalizeChangeLogFingerprint(document.before, 'before'),
    after: normalizeChangeLogFingerprint(document.after, 'after'),
    changeCount: changeCount.toString(),
    sourceChangeCount: sourceChangeCount.toString(),
    unavailableChangeCount: unavailableChangeCount.toString(),
    unavailableChangeSerials,
  }
}

export class ChangeLogEntrySequenceValidator {
  private serialMode: boolean | undefined
  private activeGroup: string | undefined
  private readonly closedGroups = new Set<string>()

  constructor(private readonly limits: ChangeLogCodecLimits) {}

  accept(entry: NormalizedChangeLogEntry, index: number): void {
    const hasSerial = entry.serial !== undefined
    if (this.serialMode === undefined) {
      this.serialMode = hasSerial
    } else if (this.serialMode !== hasSerial) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_SERIALS',
        'Change log serial metadata must be present on every entry'
      )
    }
    if (
      entry.serial !== undefined &&
      BigInt(entry.serial) !== BigInt(index + 1)
    ) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_SERIALS',
        `Change log serial metadata must be contiguous; entry ${index} has serial ${entry.serial}, expected ${index + 1}`
      )
    }

    const groupId = entry.groupId
    if (!groupId) {
      if (this.activeGroup) {
        this.closeActiveGroup()
      }
      return
    }
    if (groupId === this.activeGroup) {
      return
    }
    if (this.closedGroups.has(groupId)) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_GROUPS',
        `Change log groupId "${groupId}" is not contiguous at entry ${index}`
      )
    }
    if (this.activeGroup) {
      this.closeActiveGroup()
    }
    this.activeGroup = groupId
  }

  private closeActiveGroup(): void {
    if (!this.activeGroup) {
      return
    }
    if (this.closedGroups.size >= this.limits.maxGroupCount) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_GROUP_LIMIT',
        `Change log closed group count exceeds ${this.limits.maxGroupCount}`
      )
    }
    this.closedGroups.add(this.activeGroup)
    this.activeGroup = undefined
  }
}

function emptyPrimitiveCounts(): ChangeLogPrimitiveCounts {
  return {
    total: 0,
    insert: 0,
    delete: 0,
    overwrite: 0,
    replace: 0,
    transform: 0,
  }
}

export class ChangeLogScanAccumulator {
  readonly primitiveCounts = emptyPrimitiveCounts()
  readonly transformDescriptors: ChangeLogTransformDescriptorSummary[] = []
  private readonly requiredPluginIds = new Set<string>()
  private readonly sequence: ChangeLogEntrySequenceValidator

  constructor(private readonly limits: ChangeLogCodecLimits) {
    this.sequence = new ChangeLogEntrySequenceValidator(limits)
  }

  accept(entry: NormalizedChangeLogEntry, index: number): void {
    if (index >= this.limits.maxEntryCount) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_ENTRY_LIMIT',
        `Change log entry count exceeds ${this.limits.maxEntryCount}`
      )
    }
    this.sequence.accept(entry, index)
    this.primitiveCounts.total += 1
    const key = entry.kind.toLowerCase() as Exclude<
      keyof ChangeLogPrimitiveCounts,
      'total'
    >
    this.primitiveCounts[key] += 1
    if (entry.kind !== 'TRANSFORM' || !entry.transformDescriptor) {
      return
    }
    if (this.transformDescriptors.length >= this.limits.maxTransformCount) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_TRANSFORM_LIMIT',
        `Change log transform count exceeds ${this.limits.maxTransformCount}`
      )
    }
    const descriptor = entry.transformDescriptor
    this.transformDescriptors.push({
      index,
      ...(entry.serial ? { serial: entry.serial } : {}),
      offset: entry.offset,
      length: entry.length,
      transformId: descriptor.transformId,
      ...(descriptor.optionsJson
        ? { optionsJson: descriptor.optionsJson }
        : {}),
    })
    this.requiredPluginIds.add(descriptor.transformId)
    if (this.requiredPluginIds.size > this.limits.maxRequiredPluginCount) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_PLUGIN_LIMIT',
        `Change log required plugin count exceeds ${this.limits.maxRequiredPluginCount}`
      )
    }
  }

  finish(
    document: Record<string, unknown>,
    diagnostics: ChangeLogScanDiagnostics
  ): ChangeLogScanResult {
    const header = normalizeChangeLogHeader(
      document,
      this.primitiveCounts.total,
      this.limits
    )
    return {
      ...header,
      entryCount: this.primitiveCounts.total,
      primitiveCounts: { ...this.primitiveCounts },
      transformDescriptors: this.transformDescriptors.map((entry) => ({
        ...entry,
      })),
      requiredPlugins: Array.from(this.requiredPluginIds).sort(),
      diagnostics,
    }
  }
}

export function serializeChangeLogEntry(entry: ChangeLogEntry): ChangeLogEntry {
  const serialized: ChangeLogEntry = {
    kind: entry.kind,
    offset: changeLogInt64ToDecimal(entry.offset, 'change log entry offset'),
    length: changeLogInt64ToDecimal(entry.length, 'change log entry length'),
    data: normalizeHex(entry.data, 'change log entry data'),
  }
  if (entry.serial !== undefined) {
    serialized.serial = parseChangeLogPositiveInt64(
      entry.serial,
      'change log entry serial'
    ).toString()
  }
  if (entry.groupId !== undefined) {
    if (!entry.groupId.trim()) {
      throw new ChangeLogCodecError(
        'CHANGE_LOG_INVALID_ENTRY',
        'change log entry groupId must not be empty'
      )
    }
    serialized.groupId = entry.groupId.trim()
  }
  return serialized
}

export function normalizeChangeLogDocument(
  value: unknown,
  options: ChangeLogCodecOptions = {}
): PreparedChangeLog {
  throwIfChangeLogCancelled(options.signal)
  const limits = resolveChangeLogCodecLimits(options.limits)
  validateChangeLogJsonValue(value, limits, 'Change log')
  if (!isChangeLogRecord(value) || !Array.isArray(value.changes)) {
    throw new ChangeLogCodecError(
      'CHANGE_LOG_INVALID_DOCUMENT',
      'Change log must be a versioned omega-edit.change-log document'
    )
  }
  const changes: NormalizedChangeLogEntry[] = []
  const accumulator = new ChangeLogScanAccumulator(limits)
  for (let index = 0; index < value.changes.length; index += 1) {
    throwIfChangeLogCancelled(options.signal)
    const entry = normalizeChangeLogEntry(value.changes[index], index, limits)
    accumulator.accept(entry, index)
    changes.push(entry)
  }
  const result = accumulator.finish(value, {
    bytesRead: 0,
    maxBufferedChars: 0,
    maxValueChars: 0,
  })
  return {
    ...result,
    async *entries(): AsyncIterable<NormalizedChangeLogEntry> {
      for (const entry of changes) {
        throwIfChangeLogCancelled(options.signal)
        yield { ...entry }
      }
    },
  }
}

export function createChangeLogDocument(
  header: Omit<ChangeLogDocument, 'changes'>,
  changes: ChangeLogEntry[]
): ChangeLogDocument {
  const document: ChangeLogDocument = {
    ...header,
    changes: changes.map(serializeChangeLogEntry),
  }
  normalizeChangeLogDocument(document)
  return document
}

export function normalizeFingerprintForChangeLog(
  fingerprint: ChangeLogFingerprint,
  key: 'before' | 'after'
): NormalizedChangeLogFingerprint {
  return normalizeChangeLogFingerprint(fingerprint, key)
}
