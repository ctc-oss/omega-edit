/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0.
 */

import { getClient } from './client'
import {
  ActionJournalDirection,
  ActionJournalPayloadStorage,
  type ActionJournalEntry as ProtoActionJournalEntry,
  ChangeLogEntryKind,
  type GetActionJournalViewportRequest,
  type GetActionJournalViewportResponse,
} from './protobuf_ts/generated/omega_edit/v1/omega_edit'
import {
  ChangeLogCodecError,
  parseChangeLogNonNegativeInt64,
} from './changeLog/codec'
import type {
  ChangeLogEntryKind as JournalEntryKind,
  ChangeLogInt64,
} from './changeLog/types'
import { SessionEventKind } from './session'
import {
  subscribeSessionEvents,
  type ManagedEventSubscription,
  type SessionEventSubscriptionOptions,
} from './subscriptions'
import { callUnary } from './protobuf_ts/utils'

export const ACTION_JOURNAL_DEFAULT_CAPACITY = 256
export const ACTION_JOURNAL_MAX_CAPACITY = 1000

export type ActionJournalPayloadHint =
  | 'none'
  | 'inline'
  | 'file-backed'
  | 'checkpoint-backed'

export interface ActionJournalTransformDescriptor {
  transformId: string
  optionsJson?: string
  replacementLength: string
  computedFileSizeBefore: string
  computedFileSizeAfter: string
}

export interface ActionJournalEntry {
  index: string
  firstSerial: string
  lastSerial: string
  kind: JournalEntryKind
  offset: string
  length: string
  dataLength: string
  sizeDelta: string
  changeCountBefore: string
  changeCountAfter: string
  checkpointBefore?: string
  checkpointAfter?: string
  transactionId?: string
  payloadHint: ActionJournalPayloadHint
  transform?: ActionJournalTransformDescriptor
}

export type ActionJournalViewportDirection = 'older' | 'newer'

export interface ActionJournalViewportOptions {
  sessionId: string
  anchorSerial?: ChangeLogInt64
  capacity?: number
  direction?: ActionJournalViewportDirection
  kinds?: JournalEntryKind[]
  transactionId?: string
  /** Test/embedding hook; normal callers use the shared gRPC client. */
  fetch?: (
    request: GetActionJournalViewportRequest
  ) => Promise<GetActionJournalViewportResponse>
}

export interface ActionJournalViewport {
  version: 1
  sessionId: string
  activeTipSerial: string
  changeCount: string
  undoCount: string
  checkpointCount: string
  anchorSerial: string
  capacity: number
  direction: ActionJournalViewportDirection
  entries: ActionJournalEntry[]
  hasMore: boolean
  nextAnchorSerial?: string
}

export interface ActionJournalLiveUpdate {
  /** Live updates invalidate cached journal windows; fetch a new viewport for exact int64 metadata. */
  sessionId: string
  eventKind: number
}

export interface SubscribeActionJournalOptions {
  sessionId: string
  onUpdate(update: ActionJournalLiveUpdate): void | Promise<void>
  onError?(error: Error): void | Promise<void>
  subscribe?: SessionEventSubscriptionOptions['subscribe']
}

function fail(message: string): never {
  throw new ChangeLogCodecError('ACTION_JOURNAL_FRAMING', message)
}

const MIN_INT64 = BigInt('-9223372036854775808')
const MAX_INT64 = BigInt('9223372036854775807')

function nonNegativeDecimal(value: string, name: string): string {
  return parseChangeLogNonNegativeInt64(value, name).toString()
}

function signedDecimal(value: string, name: string): string {
  if (value.length > 20 || !/^-?(0|[1-9]\d*)$/.test(value) || value === '-0') {
    fail(`${name} must be a canonical signed decimal integer`)
  }
  const parsed = BigInt(value)
  if (parsed < MIN_INT64 || parsed > MAX_INT64) {
    fail(`${name} must be in the signed int64 range`)
  }
  return parsed.toString()
}

function requestDecimal(value: ChangeLogInt64 | undefined): string | undefined {
  return value === undefined
    ? undefined
    : parseChangeLogNonNegativeInt64(value, 'action-journal anchor').toString()
}

const protoKinds: Record<JournalEntryKind, ChangeLogEntryKind> = {
  DELETE: ChangeLogEntryKind.DELETE,
  INSERT: ChangeLogEntryKind.INSERT,
  OVERWRITE: ChangeLogEntryKind.OVERWRITE,
  REPLACE: ChangeLogEntryKind.REPLACE,
  TRANSFORM: ChangeLogEntryKind.TRANSFORM,
}

function journalKind(kind: ChangeLogEntryKind): JournalEntryKind {
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
      return fail('entry kind is invalid')
  }
}

function payloadHint(
  storage: ActionJournalPayloadStorage
): ActionJournalPayloadHint {
  switch (storage) {
    case ActionJournalPayloadStorage.NONE:
      return 'none'
    case ActionJournalPayloadStorage.INLINE:
      return 'inline'
    case ActionJournalPayloadStorage.FILE_BACKED:
      return 'file-backed'
    case ActionJournalPayloadStorage.CHECKPOINT_BACKED:
      return 'checkpoint-backed'
    default:
      return fail('entry payload storage is invalid')
  }
}

function normalizeEntry(entry: ProtoActionJournalEntry): ActionJournalEntry {
  const kind = journalKind(entry.kind)
  const transform = entry.transform
  if ((kind === 'TRANSFORM') !== (transform !== undefined)) {
    fail('transform metadata does not match entry kind')
  }
  return {
    index: nonNegativeDecimal(entry.entryIndexDecimal, 'entry.index'),
    firstSerial: nonNegativeDecimal(
      entry.firstSerialDecimal,
      'entry.firstSerial'
    ),
    lastSerial: nonNegativeDecimal(entry.lastSerialDecimal, 'entry.lastSerial'),
    kind,
    offset: nonNegativeDecimal(entry.offsetDecimal, 'entry.offset'),
    length: nonNegativeDecimal(entry.lengthDecimal, 'entry.length'),
    dataLength: nonNegativeDecimal(entry.dataLengthDecimal, 'entry.dataLength'),
    sizeDelta: signedDecimal(entry.sizeDeltaDecimal, 'entry.sizeDelta'),
    changeCountBefore: nonNegativeDecimal(
      entry.changeCountBeforeDecimal,
      'entry.changeCountBefore'
    ),
    changeCountAfter: nonNegativeDecimal(
      entry.changeCountAfterDecimal,
      'entry.changeCountAfter'
    ),
    ...(entry.checkpointBeforeDecimal
      ? {
          checkpointBefore: nonNegativeDecimal(
            entry.checkpointBeforeDecimal,
            'entry.checkpointBefore'
          ),
        }
      : {}),
    ...(entry.checkpointAfterDecimal
      ? {
          checkpointAfter: nonNegativeDecimal(
            entry.checkpointAfterDecimal,
            'entry.checkpointAfter'
          ),
        }
      : {}),
    ...(entry.transactionId ? { transactionId: entry.transactionId } : {}),
    payloadHint: payloadHint(entry.payloadStorage),
    ...(transform
      ? {
          transform: {
            transformId: transform.transformId,
            ...(transform.optionsJson
              ? { optionsJson: transform.optionsJson }
              : {}),
            replacementLength: nonNegativeDecimal(
              transform.replacementLengthDecimal,
              'entry.transform.replacementLength'
            ),
            computedFileSizeBefore: nonNegativeDecimal(
              transform.computedFileSizeBeforeDecimal,
              'entry.transform.computedFileSizeBefore'
            ),
            computedFileSizeAfter: nonNegativeDecimal(
              transform.computedFileSizeAfterDecimal,
              'entry.transform.computedFileSizeAfter'
            ),
          },
        }
      : {}),
  }
}

/**
 * Reads one bounded metadata-only viewport over authoritative native history.
 * Use nextAnchorSerial with the same direction and filters for infinite scroll.
 */
export async function getActionJournalViewport(
  options: ActionJournalViewportOptions
): Promise<ActionJournalViewport> {
  const capacity = options.capacity ?? ACTION_JOURNAL_DEFAULT_CAPACITY
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > ACTION_JOURNAL_MAX_CAPACITY
  ) {
    throw new RangeError(
      `action journal capacity must be from 1 to ${ACTION_JOURNAL_MAX_CAPACITY}`
    )
  }
  const direction = options.direction ?? 'older'
  if (direction !== 'older' && direction !== 'newer') {
    throw new TypeError('action journal direction must be older or newer')
  }
  const kinds = options.kinds ?? []
  if (kinds.some((kind) => protoKinds[kind] === undefined)) {
    throw new TypeError('action journal kind filter is invalid')
  }
  const request: GetActionJournalViewportRequest = {
    sessionId: options.sessionId,
    anchorSerialDecimal: requestDecimal(options.anchorSerial),
    capacity,
    direction:
      direction === 'older'
        ? ActionJournalDirection.OLDER
        : ActionJournalDirection.NEWER,
    kinds: kinds.map((kind) => protoKinds[kind]),
    transactionId: options.transactionId?.trim() || undefined,
  }
  const response = options.fetch
    ? await options.fetch(request)
    : await (async () => {
        const client = await getClient()
        return await new Promise<GetActionJournalViewportResponse>(
          (resolve, reject) => {
            callUnary(
              client,
              client.getActionJournalViewport,
              request,
              (error, value) => {
                if (error) return reject(error)
                if (!value) {
                  return reject(new Error('empty action journal response'))
                }
                resolve(value)
              }
            )
          }
        )
      })()
  if (response.formatVersion !== 1) fail('unsupported journal version')
  if (response.sessionId !== options.sessionId) {
    fail('journal response session does not match the request')
  }
  if (response.capacity !== capacity || response.entries.length > capacity) {
    fail('journal response exceeds the requested viewport capacity')
  }
  const responseDirection =
    response.direction === ActionJournalDirection.OLDER
      ? 'older'
      : response.direction === ActionJournalDirection.NEWER
        ? 'newer'
        : fail('response direction is invalid')
  if (responseDirection !== direction) {
    fail('journal response direction does not match the request')
  }
  const hasNextAnchor = response.nextAnchorSerialDecimal !== undefined
  if (response.hasMore !== hasNextAnchor) {
    fail('journal response continuation metadata is inconsistent')
  }
  return {
    version: 1,
    sessionId: response.sessionId,
    activeTipSerial: nonNegativeDecimal(
      response.activeTipSerialDecimal,
      'viewport.activeTipSerial'
    ),
    changeCount: nonNegativeDecimal(
      response.changeCountDecimal,
      'viewport.changeCount'
    ),
    undoCount: nonNegativeDecimal(
      response.undoCountDecimal,
      'viewport.undoCount'
    ),
    checkpointCount: nonNegativeDecimal(
      response.checkpointCountDecimal,
      'viewport.checkpointCount'
    ),
    anchorSerial: nonNegativeDecimal(
      response.resolvedAnchorSerialDecimal,
      'viewport.anchorSerial'
    ),
    capacity: response.capacity,
    direction: responseDirection,
    entries: response.entries.map(normalizeEntry),
    hasMore: response.hasMore,
    ...(response.nextAnchorSerialDecimal !== undefined
      ? {
          nextAnchorSerial: nonNegativeDecimal(
            response.nextAnchorSerialDecimal,
            'viewport.nextAnchorSerial'
          ),
        }
      : {}),
  }
}

/**
 * Subscribes to history-invalidating session events. Consumers can live-tail
 * the newest viewport or invalidate cached windows without polling.
 */
export async function subscribeActionJournalUpdates(
  options: SubscribeActionJournalOptions
): Promise<ManagedEventSubscription> {
  const interest =
    SessionEventKind.EDIT |
    SessionEventKind.UNDO |
    SessionEventKind.CLEAR |
    SessionEventKind.TRANSFORM |
    SessionEventKind.CREATE_CHECKPOINT |
    SessionEventKind.DESTROY_CHECKPOINT |
    SessionEventKind.RESTORE_CHECKPOINT
  return await subscribeSessionEvents({
    sessionId: options.sessionId,
    interest,
    subscribe: options.subscribe,
    onError: options.onError,
    async onEvent(event) {
      await options.onUpdate({
        sessionId: event.getSessionId(),
        eventKind: event.getSessionEventKind(),
      })
    },
  })
}
