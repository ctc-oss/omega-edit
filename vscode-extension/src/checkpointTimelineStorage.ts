// Copyright 2026 Concurrent Technologies Corporation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import {
  type ChangeLogFileReadResult,
  type ChangeLogFingerprint,
  openChangeLogFile,
  writeChangeLogFileAtomic,
} from '@omega-edit/client'

const SESSION_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/
const INTERVAL_FILE_PATTERN = /^\d{8}\.json$/
const MANIFEST_FORMAT = 'omega-edit.checkpoint-timeline' as const
const INDEX_FORMAT = 'omega-edit.checkpoint-timeline-index' as const
const MANIFEST_VERSION = 1 as const
const INDEX_VERSION = 1 as const
const LOCK_STALE_MS = 2 * 60 * 1000
const DEFAULT_LOCK_WAIT_MS = 5000
const HEARTBEAT_INTERVAL_MS = 60 * 1000
const MAX_METADATA_BYTES = 4 * 1024 * 1024
const RESERVATION_CHUNK_BYTES = 16 * 1024 * 1024

export const CHECKPOINT_HISTORY_DEFAULTS = {
  maxBytesPerSession: 1_073_741_824,
  maxBytesTotal: 5_368_709_120,
  maxCheckpoints: 1000,
  staleRetentionDays: 7,
} as const

export interface CheckpointHistoryLimits {
  maxBytesPerSession: number
  maxBytesTotal: number
  maxCheckpoints: number
  staleRetentionDays: number
}

export type CheckpointBoundaryKind = 'plain' | 'transform'

export interface NormalizedTimelineFingerprint {
  byteLength: string
  digest: { algorithm: string; value: string }
}

export interface CheckpointIntervalManifestEntryV1 {
  checkpoint: number
  generation: number
  before: NormalizedTimelineFingerprint
  after: NormalizedTimelineFingerprint
  sourceChangeCount: string
  createdAt: string
  boundaryKind: CheckpointBoundaryKind
  transformPluginIds: string[]
  state: 'ready' | 'unavailable'
  archive?: {
    file: string
    byteLength: string
    sha256: string
    emittedChangeCount: string
    optimized: boolean
  }
  error?: { code: string; message: string }
}

export interface CheckpointTimelineManifestV1 {
  format: typeof MANIFEST_FORMAT
  version: typeof MANIFEST_VERSION
  sessionKey: string
  document: { uriSha256: string; displayName?: string }
  openedAt: string
  updatedAt: string
  original: { fingerprint: NormalizedTimelineFingerprint }
  saved: {
    fingerprint: NormalizedTimelineFingerprint
    checkpoint?: number
    offBranch: boolean
  }
  cursor: number
  tip: number
  nextGeneration: number
  intervals: CheckpointIntervalManifestEntryV1[]
}

interface CheckpointTimelineIndexV1 {
  format: typeof INDEX_FORMAT
  version: typeof INDEX_VERSION
  updatedAt: string
  sessions: Record<
    string,
    {
      instanceId: string
      lastHeartbeatAt: string
      state: 'active' | 'pendingDelete'
      byteLength: string
      reservedBytes: string
    }
  >
}

export type TimelineStorageFaultPoint =
  | 'lockAcquired'
  | 'lockRelease'
  | 'quotaReserved'
  | 'rawFileCreate'
  | 'rawHeaderWrite'
  | 'rawEntryWrite'
  | 'rawFlushClose'
  | 'rawValidated'
  | 'optimizedFileCreate'
  | 'optimizedWritten'
  | 'optimizedValidated'
  | 'winnerRename'
  | 'loserRemoval'
  | 'manifestTemporaryWrite'
  | 'manifestRename'
  | 'branchManifestCommit'
  | 'cursorManifestCommit'
  | 'savedManifestCommit'
  | 'unavailableManifestCommit'
  | 'orphanCleanup'
  | 'heartbeatRefresh'
  | 'cleanCloseDelete'

export interface TimelineStorageFaultInjector {
  hit(point: TimelineStorageFaultPoint): void | Promise<void>
}

export class TimelineStorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, string>
  ) {
    super(message)
    this.name = 'TimelineStorageError'
  }
}

export interface TimelineArchiveWriterResult {
  byteLength: number
}

export type TimelineArchiveWriter = (
  path: string,
  maxBytes: number,
  onBytesWritten: (byteLength: number) => Promise<void>
) => Promise<TimelineArchiveWriterResult>

export interface CaptureCheckpointIntervalOptions {
  checkpoint: number
  expectedGeneration: number
  sourceChangeCount: string | number | bigint
  before: ChangeLogFingerprint
  after: ChangeLogFingerprint
  boundaryKind: CheckpointBoundaryKind
  transformPluginIds?: string[]
  writeRaw: TimelineArchiveWriter
  writeOptimized?: TimelineArchiveWriter
}

export interface TimelineCleanupReport {
  scanned: number
  removed: number
  quarantined: number
  failed: number
  reclaimedBytes: string
}

export interface CheckpointTimelineStorageOptions {
  limits?: Partial<CheckpointHistoryLimits>
  instanceId?: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  lockWaitMs?: number
  faultInjector?: TimelineStorageFaultInjector
}

function decimal(value: string | number | bigint, name: string): string {
  const text = typeof value === 'bigint' ? value.toString() : String(value)
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_METADATA',
      `${name} must be a canonical unsigned decimal`
    )
  }
  const parsed = BigInt(text)
  if (parsed > BigInt('9223372036854775807')) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_METADATA',
      `${name} exceeds signed int64 range`
    )
  }
  return text
}

function normalizeFingerprint(
  value: ChangeLogFingerprint
): NormalizedTimelineFingerprint {
  const byteLength = decimal(value.byteLength, 'fingerprint.byteLength')
  if (
    value.digest.algorithm !== 'sha256' ||
    !/^[0-9a-f]{64}$/.test(value.digest.value)
  ) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_FINGERPRINT',
      'Timeline fingerprints must use lowercase SHA-256'
    )
  }
  return {
    byteLength,
    digest: { algorithm: 'sha256', value: value.digest.value },
  }
}

function fingerprintsEqual(
  left: NormalizedTimelineFingerprint,
  right: NormalizedTimelineFingerprint
): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.digest.algorithm === right.digest.algorithm &&
    left.digest.value === right.digest.value
  )
}

function randomKey(): string {
  return randomBytes(16).toString('base64url')
}

function validateLimits(
  input: Partial<CheckpointHistoryLimits> = {}
): CheckpointHistoryLimits {
  const limits = { ...CHECKPOINT_HISTORY_DEFAULTS, ...input }
  const validBytes = (value: number) =>
    Number.isSafeInteger(value) && value >= 1024 * 1024
  if (!validBytes(limits.maxBytesPerSession)) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_SETTINGS',
      'checkpointHistory.maxBytesPerSession must be a safe integer of at least 1 MiB'
    )
  }
  if (
    !validBytes(limits.maxBytesTotal) ||
    limits.maxBytesTotal < limits.maxBytesPerSession
  ) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_SETTINGS',
      'checkpointHistory.maxBytesTotal must be a safe integer at least as large as maxBytesPerSession'
    )
  }
  if (
    !Number.isInteger(limits.maxCheckpoints) ||
    limits.maxCheckpoints < 1 ||
    limits.maxCheckpoints > 1_000_000
  ) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_SETTINGS',
      'checkpointHistory.maxCheckpoints must be in 1..1000000'
    )
  }
  if (
    !Number.isInteger(limits.staleRetentionDays) ||
    limits.staleRetentionDays < 1 ||
    limits.staleRetentionDays > 365
  ) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_SETTINGS',
      'checkpointHistory.staleRetentionDays must be in 1..365'
    )
  }
  return limits
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(path, 'r')
    await handle.sync()
  } catch {
    // Some Node/filesystem combinations do not permit directory fsync. File
    // fsync and atomic rename remain in force; startup recovery handles debris.
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function readSmallJson(path: string): Promise<unknown> {
  const stat = await fs.lstat(path)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > MAX_METADATA_BYTES
  ) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_METADATA',
      `Unsafe or oversized metadata file: ${path}`
    )
  }
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function ownedTreeBytes(path: string): Promise<bigint> {
  let total = BigInt(0)
  const entries = await fs
    .readdir(path, { withFileTypes: true })
    .catch((error) => {
      if (isMissing(error)) return []
      throw error
    })
  for (const entry of entries) {
    const child = join(path, entry.name)
    const stat = await fs.lstat(child)
    if (stat.isSymbolicLink()) {
      throw new TimelineStorageError(
        'TIMELINE_UNSAFE_PATH',
        `Refusing to follow symbolic link ${child}`
      )
    }
    if (stat.isDirectory()) total += await ownedTreeBytes(child)
    else if (stat.isFile()) total += BigInt(stat.size)
  }
  return total
}

function assertBelow(root: string, candidate: string): void {
  const relation = relative(resolve(root), resolve(candidate))
  if (
    relation === '' ||
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    relation.startsWith(sep)
  ) {
    throw new TimelineStorageError(
      'TIMELINE_UNSAFE_PATH',
      `Path escapes checkpoint history root: ${candidate}`
    )
  }
}

function emptyIndex(now: string): CheckpointTimelineIndexV1 {
  return {
    format: INDEX_FORMAT,
    version: INDEX_VERSION,
    updatedAt: now,
    sessions: {},
  }
}

function parseIndex(value: unknown): CheckpointTimelineIndexV1 {
  if (!value || typeof value !== 'object')
    throw new TimelineStorageError(
      'TIMELINE_INVALID_INDEX',
      'Timeline index must be an object'
    )
  const input = value as Partial<CheckpointTimelineIndexV1>
  if (
    input.format !== INDEX_FORMAT ||
    input.version !== INDEX_VERSION ||
    typeof input.updatedAt !== 'string' ||
    !input.sessions ||
    typeof input.sessions !== 'object' ||
    Array.isArray(input.sessions)
  ) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_INDEX',
      'Unsupported or malformed timeline index'
    )
  }
  const sessions: CheckpointTimelineIndexV1['sessions'] = {}
  for (const [key, record] of Object.entries(input.sessions)) {
    if (
      !SESSION_KEY_PATTERN.test(key) ||
      !record ||
      typeof record !== 'object'
    ) {
      throw new TimelineStorageError(
        'TIMELINE_INVALID_INDEX',
        'Timeline index contains an invalid session key'
      )
    }
    const item = record as CheckpointTimelineIndexV1['sessions'][string]
    if (
      typeof item.instanceId !== 'string' ||
      typeof item.lastHeartbeatAt !== 'string' ||
      (item.state !== 'active' && item.state !== 'pendingDelete')
    ) {
      throw new TimelineStorageError(
        'TIMELINE_INVALID_INDEX',
        `Timeline index entry ${key} is malformed`
      )
    }
    sessions[key] = {
      instanceId: item.instanceId,
      lastHeartbeatAt: item.lastHeartbeatAt,
      state: item.state,
      byteLength: decimal(item.byteLength, 'index.byteLength'),
      reservedBytes: decimal(item.reservedBytes, 'index.reservedBytes'),
    }
  }
  return {
    format: INDEX_FORMAT,
    version: INDEX_VERSION,
    updatedAt: input.updatedAt,
    sessions,
  }
}

function parseManifest(
  value: unknown,
  expectedKey: string
): CheckpointTimelineManifestV1 {
  if (!value || typeof value !== 'object')
    throw new TimelineStorageError(
      'TIMELINE_INVALID_MANIFEST',
      'Timeline manifest must be an object'
    )
  const input = value as CheckpointTimelineManifestV1
  if (
    input.format !== MANIFEST_FORMAT ||
    input.version !== MANIFEST_VERSION ||
    input.sessionKey !== expectedKey ||
    !Array.isArray(input.intervals)
  ) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_MANIFEST',
      'Unsupported or malformed timeline manifest'
    )
  }
  if (
    !Number.isInteger(input.cursor) ||
    !Number.isInteger(input.tip) ||
    input.cursor < 0 ||
    input.cursor > input.tip ||
    input.tip !== input.intervals.length ||
    !Number.isInteger(input.nextGeneration) ||
    input.nextGeneration < 1
  ) {
    throw new TimelineStorageError(
      'TIMELINE_INVALID_MANIFEST',
      'Timeline cursor, tip, or generation is invalid'
    )
  }
  let previous = normalizeFingerprint(input.original.fingerprint)
  const intervals = input.intervals.map((entry, index) => {
    if (
      entry.checkpoint !== index + 1 ||
      !Number.isInteger(entry.generation) ||
      entry.generation < 1
    ) {
      throw new TimelineStorageError(
        'TIMELINE_INVALID_MANIFEST',
        'Timeline checkpoints are not contiguous'
      )
    }
    const before = normalizeFingerprint(entry.before)
    const after = normalizeFingerprint(entry.after)
    if (!fingerprintsEqual(previous, before)) {
      throw new TimelineStorageError(
        'TIMELINE_INVALID_MANIFEST',
        `Checkpoint ${entry.checkpoint} breaks the fingerprint chain`
      )
    }
    previous = after
    const plugins = [...entry.transformPluginIds]
    if (
      plugins.some((id) => typeof id !== 'string') ||
      JSON.stringify(plugins) !== JSON.stringify([...new Set(plugins)].sort())
    ) {
      throw new TimelineStorageError(
        'TIMELINE_INVALID_MANIFEST',
        `Checkpoint ${entry.checkpoint} has invalid plugin metadata`
      )
    }
    if (entry.state === 'ready') {
      if (
        !entry.archive ||
        entry.error ||
        !INTERVAL_FILE_PATTERN.test(entry.archive.file)
      ) {
        throw new TimelineStorageError(
          'TIMELINE_INVALID_MANIFEST',
          `Checkpoint ${entry.checkpoint} has an invalid ready archive`
        )
      }
      decimal(entry.archive.byteLength, 'archive.byteLength')
      decimal(entry.archive.emittedChangeCount, 'archive.emittedChangeCount')
      if (!/^[0-9a-f]{64}$/.test(entry.archive.sha256))
        throw new TimelineStorageError(
          'TIMELINE_INVALID_MANIFEST',
          'Archive SHA-256 is invalid'
        )
    } else if (entry.state === 'unavailable') {
      if (!entry.error || entry.archive)
        throw new TimelineStorageError(
          'TIMELINE_INVALID_MANIFEST',
          `Checkpoint ${entry.checkpoint} has invalid unavailable metadata`
        )
    } else {
      throw new TimelineStorageError(
        'TIMELINE_INVALID_MANIFEST',
        `Checkpoint ${entry.checkpoint} has an unknown state`
      )
    }
    return {
      ...entry,
      before,
      after,
      sourceChangeCount: decimal(entry.sourceChangeCount, 'sourceChangeCount'),
      transformPluginIds: plugins,
    }
  })
  return {
    ...input,
    original: { fingerprint: normalizeFingerprint(input.original.fingerprint) },
    saved: {
      ...input.saved,
      fingerprint: normalizeFingerprint(input.saved.fingerprint),
    },
    intervals,
  }
}

export class CheckpointTimelineStorageManager {
  readonly historyRoot: string
  readonly instanceId: string
  readonly limits: CheckpointHistoryLimits
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly lockWaitMs: number
  private readonly fault?: TimelineStorageFaultInjector

  constructor(
    storageRoot: string,
    options: CheckpointTimelineStorageOptions = {}
  ) {
    if (!storageRoot)
      throw new TimelineStorageError(
        'TIMELINE_INVALID_ROOT',
        'Timeline storage root is required'
      )
    this.historyRoot = join(storageRoot, 'checkpoint-history')
    this.instanceId = options.instanceId ?? randomUUID()
    this.limits = validateLimits(options.limits)
    this.now = options.now ?? Date.now
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.lockWaitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS
    this.fault = options.faultInjector
  }

  async initialize(): Promise<TimelineCleanupReport> {
    await fs.mkdir(this.historyRoot, { recursive: true, mode: 0o700 })
    return await this.cleanupExpired()
  }

  async createSession(
    documentUri: string,
    original: ChangeLogFingerprint,
    displayName?: string
  ): Promise<CheckpointTimelineStorageSession> {
    await fs.mkdir(this.historyRoot, { recursive: true, mode: 0o700 })
    const key = randomKey()
    const sessionRoot = this.sessionRoot(key)
    await fs.mkdir(join(sessionRoot, 'intervals'), {
      recursive: true,
      mode: 0o700,
    })
    await fs.mkdir(join(sessionRoot, 'temp'), { recursive: true, mode: 0o700 })
    const timestamp = new Date(this.now()).toISOString()
    const fingerprint = normalizeFingerprint(original)
    const manifest: CheckpointTimelineManifestV1 = {
      format: MANIFEST_FORMAT,
      version: MANIFEST_VERSION,
      sessionKey: key,
      document: {
        uriSha256: createHash('sha256')
          .update(documentUri.normalize('NFC'))
          .digest('hex'),
        ...(displayName ? { displayName: basename(displayName) } : {}),
      },
      openedAt: timestamp,
      updatedAt: timestamp,
      original: { fingerprint },
      saved: { fingerprint, checkpoint: 0, offBranch: false },
      cursor: 0,
      tip: 0,
      nextGeneration: 1,
      intervals: [],
    }
    try {
      await this.commitManifest(sessionRoot, manifest)
      await this.withIndexLock(async (index) => {
        const byteLength = await ownedTreeBytes(sessionRoot)
        this.assertQuota(index, key, byteLength, BigInt(0))
        index.sessions[key] = {
          instanceId: this.instanceId,
          lastHeartbeatAt: timestamp,
          state: 'active',
          byteLength: byteLength.toString(),
          reservedBytes: '0',
        }
      })
      return new CheckpointTimelineStorageSession(this, sessionRoot, manifest)
    } catch (error) {
      await fs
        .rm(sessionRoot, { recursive: true, force: true })
        .catch(() => undefined)
      throw error
    }
  }

  async cleanupExpired(): Promise<TimelineCleanupReport> {
    const report: TimelineCleanupReport = {
      scanned: 0,
      removed: 0,
      quarantined: 0,
      failed: 0,
      reclaimedBytes: '0',
    }
    await this.withIndexLock(async (index) => {
      const cutoff = this.now() - this.limits.staleRetentionDays * 86_400_000
      let reclaimed = BigInt(0)
      for (const [key, record] of Object.entries(index.sessions)) {
        report.scanned += 1
        const heartbeat = Date.parse(record.lastHeartbeatAt)
        if (
          Number.isFinite(heartbeat) &&
          heartbeat >= cutoff &&
          record.state === 'active'
        )
          continue
        const root = this.sessionRoot(key)
        try {
          const bytes = await ownedTreeBytes(root)
          try {
            parseManifest(await readSmallJson(join(root, 'manifest.json')), key)
          } catch (error) {
            if (isMissing(error)) throw error
            const quarantine = join(
              this.historyRoot,
              `${key}.quarantine.${this.now()}`
            )
            assertBelow(this.historyRoot, quarantine)
            await fs.rename(root, quarantine)
            delete index.sessions[key]
            report.quarantined += 1
            continue
          }
          await this.fault?.hit('orphanCleanup')
          await this.removeOwnedTree(root)
          delete index.sessions[key]
          reclaimed += bytes
          report.removed += 1
        } catch (error) {
          if (isMissing(error)) {
            delete index.sessions[key]
            continue
          }
          report.failed += 1
        }
      }
      const rootEntries = await fs.readdir(this.historyRoot, {
        withFileTypes: true,
      })
      for (const entry of rootEntries) {
        const match = entry.name.match(/^[A-Za-z0-9_-]{22}\.quarantine\.(\d+)$/)
        if (!match || !entry.isDirectory() || Number(match[1]) >= cutoff) {
          continue
        }
        const quarantine = join(this.historyRoot, entry.name)
        try {
          const bytes = await ownedTreeBytes(quarantine)
          await this.removeOwnedTree(quarantine)
          reclaimed += bytes
          report.removed += 1
        } catch {
          report.failed += 1
        }
      }
      report.reclaimedBytes = reclaimed.toString()
    })
    return report
  }

  private sessionRoot(key: string): string {
    if (!SESSION_KEY_PATTERN.test(key))
      throw new TimelineStorageError(
        'TIMELINE_UNSAFE_PATH',
        'Invalid timeline session key'
      )
    const path = join(this.historyRoot, key)
    assertBelow(this.historyRoot, path)
    return path
  }

  private async hit(point: TimelineStorageFaultPoint): Promise<void> {
    await this.fault?.hit(point)
  }

  private async atomicJson(
    path: string,
    value: unknown,
    kind: 'manifest' | 'index'
  ): Promise<void> {
    const operationId = randomKey()
    const tempPath = join(dirname(path), `${basename(path)}.${operationId}.tmp`)
    assertBelow(this.historyRoot, tempPath)
    let handle: fs.FileHandle | undefined
    try {
      if (kind === 'manifest') await this.hit('manifestTemporaryWrite')
      handle = await fs.open(tempPath, 'wx', 0o600)
      await handle.writeFile(jsonText(value), 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      if (kind === 'manifest') await this.hit('manifestRename')
      await fs.rename(tempPath, path)
      await syncDirectory(dirname(path))
    } finally {
      await handle?.close().catch(() => undefined)
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
  }

  private async readIndex(): Promise<CheckpointTimelineIndexV1> {
    try {
      return parseIndex(
        await readSmallJson(join(this.historyRoot, 'index.json'))
      )
    } catch (error) {
      if (isMissing(error))
        return emptyIndex(new Date(this.now()).toISOString())
      throw error
    }
  }

  private async withIndexLock<T>(
    operation: (index: CheckpointTimelineIndexV1) => Promise<T>
  ): Promise<T> {
    const lockPath = join(this.historyRoot, '.lock')
    const started = this.now()
    const token = randomKey()
    await fs.mkdir(this.historyRoot, { recursive: true, mode: 0o700 })
    while (true) {
      try {
        const handle = await fs.open(lockPath, 'wx', 0o600)
        try {
          await handle.writeFile(
            jsonText({
              instanceId: this.instanceId,
              token,
              acquiredAt: new Date(this.now()).toISOString(),
            })
          )
          await handle.sync()
        } finally {
          await handle.close()
        }
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await this.recoverStaleLock(lockPath).catch(() => undefined)
        if (this.now() - started >= this.lockWaitMs) {
          throw new TimelineStorageError(
            'TIMELINE_STORAGE_BUSY',
            'Checkpoint history metadata is busy; retry the operation'
          )
        }
        await this.sleep(Math.min(50, 5 + Math.floor(Math.random() * 20)))
      }
    }
    let outcome: { ok: true; value: T } | { ok: false; error: unknown }
    try {
      await this.hit('lockAcquired')
      const index = await this.readIndex()
      const result = await operation(index)
      index.updatedAt = new Date(this.now()).toISOString()
      await this.atomicJson(
        join(this.historyRoot, 'index.json'),
        index,
        'index'
      )
      outcome = { ok: true, value: result }
    } catch (error) {
      outcome = { ok: false, error }
    }
    try {
      await this.hit('lockRelease')
      const value = (await readSmallJson(lockPath)) as { token?: string }
      if (value.token === token) await fs.rm(lockPath, { force: true })
    } catch (error) {
      if (!isMissing(error) && outcome.ok) throw error
    }
    if (!outcome.ok) throw outcome.error
    return outcome.value
  }

  private async recoverStaleLock(lockPath: string): Promise<void> {
    const stat = await fs.lstat(lockPath)
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new TimelineStorageError(
        'TIMELINE_UNSAFE_PATH',
        'Timeline lock is not a regular file'
      )
    const value = (await readSmallJson(lockPath)) as { acquiredAt?: string }
    const acquired = Date.parse(value.acquiredAt ?? '')
    if (!Number.isFinite(acquired) || this.now() - acquired <= LOCK_STALE_MS)
      return
    const stale = join(this.historyRoot, `.stale-lock.${randomKey()}`)
    await fs.rename(lockPath, stale)
    await fs.rm(stale, { force: true })
  }

  private assertQuota(
    index: CheckpointTimelineIndexV1,
    key: string,
    actual: bigint,
    reservation: bigint
  ): void {
    const sessionTotal = actual + reservation
    let all = BigInt(0)
    for (const [candidate, record] of Object.entries(index.sessions)) {
      if (candidate === key) continue
      all += BigInt(record.byteLength) + BigInt(record.reservedBytes)
    }
    all += sessionTotal
    if (
      sessionTotal > BigInt(this.limits.maxBytesPerSession) ||
      all > BigInt(this.limits.maxBytesTotal)
    ) {
      throw new TimelineStorageError(
        'TIMELINE_QUOTA_EXCEEDED',
        'Checkpoint archive does not fit configured history storage quotas',
        {
          requiredBytes: sessionTotal.toString(),
          sessionLimitBytes: String(this.limits.maxBytesPerSession),
          totalLimitBytes: String(this.limits.maxBytesTotal),
        }
      )
    }
  }

  private async reserve(key: string, requested: bigint): Promise<number> {
    return await this.withIndexLock(async (index) => {
      const record = index.sessions[key]
      if (
        !record ||
        record.instanceId !== this.instanceId ||
        record.state !== 'active'
      )
        throw new TimelineStorageError(
          'TIMELINE_SESSION_CLOSED',
          'Timeline session is not active'
        )
      const root = this.sessionRoot(key)
      const actual = await ownedTreeBytes(root)
      const rootActual = await ownedTreeBytes(this.historyRoot)
      let otherReservations = BigInt(0)
      for (const [candidate, other] of Object.entries(index.sessions)) {
        if (candidate !== key) {
          otherReservations += BigInt(other.reservedBytes)
        }
      }
      const sessionHeadroom = BigInt(this.limits.maxBytesPerSession) - actual
      const totalHeadroom =
        BigInt(this.limits.maxBytesTotal) - rootActual - otherReservations
      const available = [requested, sessionHeadroom, totalHeadroom].reduce(
        (least, value) => (value < least ? value : least)
      )
      if (available <= BigInt(0)) {
        throw new TimelineStorageError(
          'TIMELINE_QUOTA_EXCEEDED',
          'No checkpoint history quota remains for this interval'
        )
      }
      const granted =
        available < BigInt(RESERVATION_CHUNK_BYTES)
          ? available
          : BigInt(RESERVATION_CHUNK_BYTES)
      this.assertQuota(index, key, actual, granted)
      record.byteLength = actual.toString()
      record.reservedBytes = granted.toString()
      record.lastHeartbeatAt = new Date(this.now()).toISOString()
      await this.hit('quotaReserved')
      return Number(available)
    })
  }

  private async extendReservation(
    key: string,
    baselineBytes: bigint,
    operationBytes: number
  ): Promise<void> {
    if (!Number.isSafeInteger(operationBytes) || operationBytes < 0) {
      throw new TimelineStorageError(
        'TIMELINE_INVALID_METADATA',
        'Archive writer reported an invalid byte count'
      )
    }
    await this.withIndexLock(async (index) => {
      const record = index.sessions[key]
      if (!record || record.instanceId !== this.instanceId) {
        throw new TimelineStorageError(
          'TIMELINE_SESSION_CLOSED',
          'Timeline session is not active'
        )
      }
      const actual = await ownedTreeBytes(this.sessionRoot(key))
      const operationActual =
        actual > baselineBytes ? actual - baselineBytes : BigInt(0)
      const rounded = BigInt(
        Math.ceil(operationBytes / RESERVATION_CHUNK_BYTES) *
          RESERVATION_CHUNK_BYTES
      )
      const reservation =
        rounded > operationActual ? rounded - operationActual : BigInt(0)
      const rootActual = await ownedTreeBytes(this.historyRoot)
      const otherReservations = Object.entries(index.sessions).reduce(
        (total, [candidate, item]) =>
          candidate === key ? total : total + BigInt(item.reservedBytes),
        BigInt(0)
      )
      if (
        rootActual + reservation + otherReservations >
        BigInt(this.limits.maxBytesTotal)
      ) {
        throw new TimelineStorageError(
          'TIMELINE_QUOTA_EXCEEDED',
          'Checkpoint archive exceeds the total history storage quota'
        )
      }
      this.assertQuota(index, key, actual, reservation)
      record.byteLength = actual.toString()
      record.reservedBytes = reservation.toString()
      record.lastHeartbeatAt = new Date(this.now()).toISOString()
      await this.hit('quotaReserved')
    })
  }

  private async reconcile(key: string, reservation = BigInt(0)): Promise<void> {
    await this.withIndexLock(async (index) => {
      const record = index.sessions[key]
      if (!record) return
      const actual = await ownedTreeBytes(this.sessionRoot(key))
      this.assertQuota(index, key, actual, reservation)
      record.byteLength = actual.toString()
      record.reservedBytes = reservation.toString()
      record.lastHeartbeatAt = new Date(this.now()).toISOString()
    })
  }

  private async commitManifest(
    sessionRoot: string,
    manifest: CheckpointTimelineManifestV1
  ): Promise<void> {
    parseManifest(manifest, manifest.sessionKey)
    await this.atomicJson(
      join(sessionRoot, 'manifest.json'),
      manifest,
      'manifest'
    )
  }

  private async removeOwnedTree(path: string): Promise<void> {
    assertBelow(this.historyRoot, path)
    const stat = await fs.lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new TimelineStorageError(
        'TIMELINE_UNSAFE_PATH',
        `Refusing to remove unsafe timeline path ${path}`
      )
    await fs.rm(path, { recursive: true, force: false })
  }

  // These methods are intentionally private to consumers but accessible to
  // the paired session class without exposing raw filesystem mutation APIs.
  async _reserve(key: string, requested: bigint): Promise<number> {
    return await this.reserve(key, requested)
  }
  async _extend(
    key: string,
    baselineBytes: bigint,
    operationBytes: number
  ): Promise<void> {
    await this.extendReservation(key, baselineBytes, operationBytes)
  }
  async _reconcile(key: string, reservation = BigInt(0)): Promise<void> {
    await this.reconcile(key, reservation)
  }
  async _commit(
    root: string,
    manifest: CheckpointTimelineManifestV1
  ): Promise<void> {
    await this.commitManifest(root, manifest)
  }
  async _hit(point: TimelineStorageFaultPoint): Promise<void> {
    await this.hit(point)
  }
  async _close(key: string, root: string): Promise<void> {
    let deleted = false
    try {
      await this.hit('cleanCloseDelete')
      await this.removeOwnedTree(root)
      deleted = true
    } finally {
      await this.withIndexLock(async (index) => {
        const record = index.sessions[key]
        if (!record) return
        if (deleted) delete index.sessions[key]
        else {
          record.state = 'pendingDelete'
          record.reservedBytes = '0'
          record.lastHeartbeatAt = new Date(this.now()).toISOString()
        }
      })
    }
  }
}

export class CheckpointTimelineStorageSession {
  private closed = false
  private lastHeartbeat = 0

  constructor(
    private readonly manager: CheckpointTimelineStorageManager,
    readonly root: string,
    private value: CheckpointTimelineManifestV1
  ) {}

  get manifest(): CheckpointTimelineManifestV1 {
    return structuredClone(this.value)
  }

  get sessionKey(): string {
    return this.value.sessionKey
  }

  async captureInterval(
    options: CaptureCheckpointIntervalOptions
  ): Promise<CheckpointIntervalManifestEntryV1> {
    this.assertOpen()
    if (
      options.checkpoint !== this.value.tip + 1 ||
      options.checkpoint > this.manager.limits.maxCheckpoints
    ) {
      throw new TimelineStorageError(
        'TIMELINE_CHECKPOINT_LIMIT',
        `Checkpoint ${options.checkpoint} is not the next storable boundary`
      )
    }
    if (options.expectedGeneration !== this.value.nextGeneration) {
      throw new TimelineStorageError(
        'TIMELINE_STALE_GENERATION',
        'Checkpoint capture belongs to a stale timeline generation'
      )
    }
    const before = normalizeFingerprint(options.before)
    const after = normalizeFingerprint(options.after)
    const expectedBefore =
      this.value.intervals.at(-1)?.after ?? this.value.original.fingerprint
    if (!fingerprintsEqual(before, expectedBefore))
      throw new TimelineStorageError(
        'TIMELINE_FINGERPRINT_MISMATCH',
        'Interval before fingerprint does not continue the manifest chain'
      )
    const operationId = randomKey()
    const rawPath = join(this.root, 'temp', `${operationId}.raw.tmp`)
    const optimizedPath = join(
      this.root,
      'temp',
      `${operationId}.optimized.tmp`
    )
    const finalName = `${String(options.checkpoint).padStart(8, '0')}.json`
    const finalPath = join(this.root, 'intervals', finalName)
    const currentBytes = await ownedTreeBytes(this.root)
    const remainingSession =
      BigInt(this.manager.limits.maxBytesPerSession) - currentBytes
    const reserveBytes =
      remainingSession > BigInt(Number.MAX_SAFE_INTEGER)
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : remainingSession
    if (reserveBytes <= BigInt(0))
      throw new TimelineStorageError(
        'TIMELINE_QUOTA_EXCEEDED',
        'No checkpoint history quota remains'
      )
    const maxRawBytes = await this.manager._reserve(
      this.sessionKey,
      reserveBytes
    )
    let raw: ChangeLogFileReadResult | undefined
    let optimized: ChangeLogFileReadResult | undefined
    let committed = false
    try {
      await this.manager._hit('rawFileCreate')
      await this.manager._hit('rawHeaderWrite')
      await this.manager._hit('rawEntryWrite')
      await options.writeRaw(rawPath, maxRawBytes, async (byteLength) => {
        await this.manager._extend(this.sessionKey, currentBytes, byteLength)
      })
      await this.manager._hit('rawFlushClose')
      raw = await this.validateCandidate(
        rawPath,
        before,
        after,
        options.sourceChangeCount
      )
      await this.manager._hit('rawValidated')

      if (options.writeOptimized && Number(raw.byteLength) > 1) {
        try {
          const optimizedBaseline = await ownedTreeBytes(this.root)
          const maxOptimizedBytes = await this.manager._reserve(
            this.sessionKey,
            BigInt(raw.byteLength) - BigInt(1)
          )
          await this.manager._hit('optimizedFileCreate')
          await options.writeOptimized(
            optimizedPath,
            maxOptimizedBytes,
            async (byteLength) => {
              await this.manager._extend(
                this.sessionKey,
                optimizedBaseline,
                byteLength
              )
            }
          )
          await this.manager._hit('optimizedWritten')
          optimized = await this.validateCandidate(
            optimizedPath,
            before,
            after,
            options.sourceChangeCount
          )
          await this.manager._hit('optimizedValidated')
          if (BigInt(optimized.byteLength) >= BigInt(raw.byteLength))
            optimized = undefined
        } catch {
          optimized = undefined
        }
      }
      const winner = optimized ?? raw
      const loser = optimized ? rawPath : optimizedPath
      const winnerPath = optimized ? optimizedPath : rawPath
      if (options.expectedGeneration !== this.value.nextGeneration)
        throw new TimelineStorageError(
          'TIMELINE_STALE_GENERATION',
          'Timeline changed while checkpoint capture was running'
        )
      await this.manager._hit('winnerRename')
      await fs.rename(winnerPath, finalPath)
      await syncDirectory(dirname(finalPath))
      await this.manager._hit('loserRemoval')
      await fs.rm(loser, { force: true })
      const entry: CheckpointIntervalManifestEntryV1 = {
        checkpoint: options.checkpoint,
        generation: options.expectedGeneration,
        before,
        after,
        sourceChangeCount: decimal(
          options.sourceChangeCount,
          'sourceChangeCount'
        ),
        createdAt: new Date(Date.now()).toISOString(),
        boundaryKind: options.boundaryKind,
        transformPluginIds: [
          ...new Set(options.transformPluginIds ?? winner.requiredPlugins),
        ].sort(),
        state: 'ready',
        archive: {
          file: finalName,
          byteLength: String(winner.byteLength),
          sha256: winner.sha256,
          emittedChangeCount: winner.changeCount,
          optimized: !!optimized,
        },
      }
      const candidate: CheckpointTimelineManifestV1 = {
        ...this.value,
        updatedAt: new Date(Date.now()).toISOString(),
        cursor: options.checkpoint,
        tip: options.checkpoint,
        nextGeneration: this.value.nextGeneration + 1,
        intervals: [...this.value.intervals, entry],
        saved: fingerprintsEqual(after, this.value.saved.fingerprint)
          ? {
              ...this.value.saved,
              checkpoint: options.checkpoint,
              offBranch: false,
            }
          : this.value.saved,
      }
      await this.manager._commit(this.root, candidate)
      this.value = candidate
      committed = true
      await this.manager._reconcile(this.sessionKey)
      return structuredClone(entry)
    } finally {
      await fs.rm(rawPath, { force: true }).catch(() => undefined)
      await fs.rm(optimizedPath, { force: true }).catch(() => undefined)
      if (!committed)
        await fs.rm(finalPath, { force: true }).catch(() => undefined)
      await this.manager._reconcile(this.sessionKey).catch(() => undefined)
    }
  }

  async recordUnavailable(
    input: Omit<
      CaptureCheckpointIntervalOptions,
      'writeRaw' | 'writeOptimized'
    >,
    code: string,
    message: string
  ): Promise<CheckpointIntervalManifestEntryV1> {
    this.assertOpen()
    if (
      input.checkpoint !== this.value.tip + 1 ||
      input.expectedGeneration !== this.value.nextGeneration
    ) {
      throw new TimelineStorageError(
        'TIMELINE_STALE_GENERATION',
        'Unavailable checkpoint belongs to a stale timeline generation'
      )
    }
    const before = normalizeFingerprint(input.before)
    const after = normalizeFingerprint(input.after)
    const expectedBefore =
      this.value.intervals.at(-1)?.after ?? this.value.original.fingerprint
    if (!fingerprintsEqual(before, expectedBefore)) {
      throw new TimelineStorageError(
        'TIMELINE_FINGERPRINT_MISMATCH',
        'Unavailable interval does not continue the manifest chain'
      )
    }
    const entry: CheckpointIntervalManifestEntryV1 = {
      checkpoint: input.checkpoint,
      generation: input.expectedGeneration,
      before,
      after,
      sourceChangeCount: decimal(input.sourceChangeCount, 'sourceChangeCount'),
      createdAt: new Date(Date.now()).toISOString(),
      boundaryKind: input.boundaryKind,
      transformPluginIds: [...new Set(input.transformPluginIds ?? [])].sort(),
      state: 'unavailable',
      error: { code, message },
    }
    const candidate = {
      ...this.value,
      updatedAt: new Date(Date.now()).toISOString(),
      cursor: input.checkpoint,
      tip: input.checkpoint,
      nextGeneration: this.value.nextGeneration + 1,
      intervals: [...this.value.intervals, entry],
      saved: fingerprintsEqual(after, this.value.saved.fingerprint)
        ? {
            ...this.value.saved,
            checkpoint: input.checkpoint,
            offBranch: false,
          }
        : this.value.saved,
    }
    await this.manager._commit(this.root, candidate)
    this.value = candidate
    await this.manager._reconcile(this.sessionKey)
    return structuredClone(entry)
  }

  async openInterval(checkpoint: number): Promise<ChangeLogFileReadResult> {
    this.assertOpen()
    const entry = this.value.intervals[checkpoint - 1]
    if (!entry || entry.state !== 'ready' || !entry.archive)
      throw new TimelineStorageError(
        'TIMELINE_INTERVAL_UNAVAILABLE',
        `Checkpoint ${checkpoint} is unavailable`
      )
    if (!INTERVAL_FILE_PATTERN.test(entry.archive.file))
      throw new TimelineStorageError(
        'TIMELINE_UNSAFE_PATH',
        'Archive filename is invalid'
      )
    const path = join(this.root, 'intervals', entry.archive.file)
    assertBelow(this.manager.historyRoot, path)
    const stat = await fs.lstat(path)
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      String(stat.size) !== entry.archive.byteLength
    )
      throw new TimelineStorageError(
        'TIMELINE_ARCHIVE_CHANGED',
        `Checkpoint ${checkpoint} archive length changed`
      )
    const opened = await openChangeLogFile(path)
    if (
      opened.sha256 !== entry.archive.sha256 ||
      !fingerprintsEqual(opened.before, entry.before) ||
      !fingerprintsEqual(opened.after, entry.after)
    )
      throw new TimelineStorageError(
        'TIMELINE_ARCHIVE_CHANGED',
        `Checkpoint ${checkpoint} archive verification failed`
      )
    return opened
  }

  async markIntervalUnavailable(
    checkpoint: number,
    code: string,
    message: string
  ): Promise<CheckpointIntervalManifestEntryV1> {
    this.assertOpen()
    const entry = this.value.intervals[checkpoint - 1]
    if (!entry || entry.checkpoint !== checkpoint) {
      throw new TimelineStorageError(
        'TIMELINE_INTERVAL_UNAVAILABLE',
        `Checkpoint ${checkpoint} is missing from the timeline`
      )
    }
    const { archive: _archive, ...entryWithoutArchive } = entry
    const unavailable: CheckpointIntervalManifestEntryV1 = {
      ...entryWithoutArchive,
      state: 'unavailable',
      error: { code, message },
    }
    const candidate: CheckpointTimelineManifestV1 = {
      ...this.value,
      updatedAt: new Date(Date.now()).toISOString(),
      intervals: this.value.intervals.map((candidateEntry) =>
        candidateEntry.checkpoint === checkpoint ? unavailable : candidateEntry
      ),
    }
    await this.manager._hit('unavailableManifestCommit')
    await this.manager._commit(this.root, candidate)
    this.value = candidate
    return structuredClone(unavailable)
  }

  async truncateFuture(cursor: number): Promise<string[]> {
    this.assertOpen()
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.value.tip)
      throw new TimelineStorageError(
        'TIMELINE_INVALID_CURSOR',
        'Timeline cursor is invalid'
      )
    const removed = this.value.intervals.slice(cursor)
    const candidate: CheckpointTimelineManifestV1 = {
      ...this.value,
      updatedAt: new Date(Date.now()).toISOString(),
      cursor,
      tip: cursor,
      nextGeneration: this.value.nextGeneration + 1,
      intervals: this.value.intervals.slice(0, cursor),
      saved: {
        ...this.value.saved,
        checkpoint:
          this.value.saved.checkpoint !== undefined &&
          this.value.saved.checkpoint <= cursor
            ? this.value.saved.checkpoint
            : undefined,
        offBranch:
          this.value.saved.checkpoint !== undefined &&
          this.value.saved.checkpoint > cursor
            ? true
            : this.value.saved.offBranch,
      },
    }
    await this.manager._hit('branchManifestCommit')
    await this.manager._commit(this.root, candidate)
    this.value = candidate
    const removedFiles = removed.flatMap((entry) =>
      entry.archive ? [entry.archive.file] : []
    )
    for (const file of removedFiles)
      await fs
        .rm(join(this.root, 'intervals', file), { force: true })
        .catch(() => undefined)
    await this.manager._reconcile(this.sessionKey)
    return removedFiles
  }

  async setCursor(cursor: number): Promise<void> {
    this.assertOpen()
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.value.tip)
      throw new TimelineStorageError(
        'TIMELINE_INVALID_CURSOR',
        'Timeline cursor is invalid'
      )
    const candidate = {
      ...this.value,
      updatedAt: new Date(Date.now()).toISOString(),
      cursor,
    }
    await this.manager._hit('cursorManifestCommit')
    await this.manager._commit(this.root, candidate)
    this.value = candidate
  }

  async setSavedFingerprint(fingerprint: ChangeLogFingerprint): Promise<void> {
    this.assertOpen()
    const normalized = normalizeFingerprint(fingerprint)
    const checkpoint = fingerprintsEqual(
      normalized,
      this.value.original.fingerprint
    )
      ? 0
      : this.value.intervals.find((entry) =>
          fingerprintsEqual(normalized, entry.after)
        )?.checkpoint
    const candidate: CheckpointTimelineManifestV1 = {
      ...this.value,
      updatedAt: new Date(Date.now()).toISOString(),
      saved: {
        fingerprint: normalized,
        ...(checkpoint === undefined ? {} : { checkpoint }),
        offBranch: checkpoint === undefined,
      },
    }
    await this.manager._hit('savedManifestCommit')
    await this.manager._commit(this.root, candidate)
    this.value = candidate
  }

  async heartbeat(force = false): Promise<void> {
    this.assertOpen()
    const now = Date.now()
    if (!force && now - this.lastHeartbeat < HEARTBEAT_INTERVAL_MS) return
    await this.manager._hit('heartbeatRefresh')
    await this.manager._reconcile(this.sessionKey)
    this.lastHeartbeat = now
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.manager._close(this.sessionKey, this.root)
  }

  private async validateCandidate(
    path: string,
    before: NormalizedTimelineFingerprint,
    after: NormalizedTimelineFingerprint,
    sourceChangeCount: string | number | bigint
  ): Promise<ChangeLogFileReadResult> {
    const opened = await openChangeLogFile(path)
    if (
      !opened.complete ||
      opened.unavailableChangeCount !== '0' ||
      !fingerprintsEqual(opened.before, before) ||
      !fingerprintsEqual(opened.after, after) ||
      opened.sourceChangeCount !==
        decimal(sourceChangeCount, 'sourceChangeCount')
    ) {
      throw new TimelineStorageError(
        'TIMELINE_INVALID_ARCHIVE',
        'Checkpoint interval failed completeness or fingerprint validation'
      )
    }
    return opened
  }

  private assertOpen(): void {
    if (this.closed)
      throw new TimelineStorageError(
        'TIMELINE_SESSION_CLOSED',
        'Timeline storage session is closed'
      )
  }
}

export async function writeEmptyCheckpointInterval(
  path: string,
  before: ChangeLogFingerprint,
  after: ChangeLogFingerprint,
  maxBytes: number
): Promise<TimelineArchiveWriterResult> {
  const normalizedBefore = normalizeFingerprint(before)
  const normalizedAfter = normalizeFingerprint(after)
  const result = await writeChangeLogFileAtomic(
    path,
    {
      format: 'omega-edit.change-log',
      version: 2,
      complete: true,
      before: normalizedBefore,
      after: normalizedAfter,
      changeCount: '0',
      sourceChangeCount: '0',
      unavailableChangeCount: '0',
      unavailableChangeSerials: [],
    },
    async () => undefined,
    { maxBytes }
  )
  return { byteLength: result.byteLength }
}
