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

export const CHANGE_LOG_FORMAT = 'omega-edit.change-log' as const
export const CHANGE_LOG_VERSION = 2 as const
export const CHANGE_LOG_DEFAULT_DIGEST_ALGORITHM = 'sha256'

export type ChangeLogInt64 = number | string | bigint
export type ChangeLogEntryKind =
  | 'INSERT'
  | 'DELETE'
  | 'OVERWRITE'
  | 'REPLACE'
  | 'TRANSFORM'

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
  format: typeof CHANGE_LOG_FORMAT
  version: typeof CHANGE_LOG_VERSION
  complete: boolean
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  changeCount: ChangeLogInt64
  /**
   * Number of source operations represented by this document. Optimized
   * native exports count native changes; synthetic replay archives count the
   * replay primitives supplied by their producer.
   */
  sourceChangeCount: ChangeLogInt64
  unavailableChangeCount: ChangeLogInt64
  unavailableChangeSerials: ChangeLogInt64[]
  changes: ChangeLogEntry[]
}

export interface NormalizedChangeLogFingerprint {
  byteLength: string
  digest: ChangeLogDigest
}

export interface ChangeLogTransformDescriptor {
  transformId: string
  optionsJson?: string
}

export interface NormalizedChangeLogEntry {
  serial?: string
  kind: ChangeLogEntryKind
  offset: string
  length: string
  data: string
  groupId?: string
  transformDescriptor?: ChangeLogTransformDescriptor
}

export interface ChangeLogPrimitiveCounts {
  total: number
  insert: number
  delete: number
  overwrite: number
  replace: number
  transform: number
}

export interface ChangeLogTransformDescriptorSummary {
  index: number
  serial?: string
  offset: string
  length: string
  transformId: string
  optionsJson?: string
}

export interface ChangeLogHeader {
  format: typeof CHANGE_LOG_FORMAT
  version: typeof CHANGE_LOG_VERSION
  complete: boolean
  before: NormalizedChangeLogFingerprint
  after: NormalizedChangeLogFingerprint
  changeCount: string
  sourceChangeCount: string
  unavailableChangeCount: string
  unavailableChangeSerials: string[]
}

export interface ChangeLogScanDiagnostics {
  bytesRead: number
  maxBufferedChars: number
  maxValueChars: number
}

export interface ChangeLogScanResult extends ChangeLogHeader {
  entryCount: number
  primitiveCounts: ChangeLogPrimitiveCounts
  transformDescriptors: ChangeLogTransformDescriptorSummary[]
  requiredPlugins: string[]
  diagnostics: ChangeLogScanDiagnostics
}

export interface PreparedChangeLog extends ChangeLogScanResult {
  entries(): AsyncIterable<NormalizedChangeLogEntry>
}

export interface ChangeLogCodecLimits {
  maxNesting: number
  maxEntryCount: number
  maxEntryChars: number
  maxHeaderValueChars: number
  maxStringChars: number
  maxGroupIdChars: number
  maxGroupCount: number
  maxTransformCount: number
  maxTransformIdBytes: number
  maxTransformOptionsBytes: number
  maxRequiredPluginCount: number
  maxUnavailableSerialCount: number
}

export interface ChangeLogCancellationSignal {
  readonly aborted: boolean
  addEventListener?(
    type: 'abort',
    listener: () => void,
    options?: { once?: boolean }
  ): void
  removeEventListener?(type: 'abort', listener: () => void): void
}

export interface ChangeLogCodecOptions {
  limits?: Partial<ChangeLogCodecLimits>
  signal?: ChangeLogCancellationSignal
}

export interface ChangeLogWriteResult {
  path: string
  byteLength: number
  sha256: string
  entryCount: number
}

export interface ChangeLogFileReadResult extends PreparedChangeLog {
  path: string
  byteLength: string
  sha256: string
}
