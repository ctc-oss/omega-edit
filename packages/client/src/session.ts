/*
 * Copyright (c) 2021 Concurrent Technologies Corporation.
 *
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
  TransformPluginOperation as RawProtoTransformPluginOperation,
  TransformPluginSupport as RawProtoTransformPluginSupport,
  IOFlags as ProtoIOFlags,
  SearchCaseFolding as RawProtoSearchCaseFolding,
  SessionContentSource as RawProtoSessionContentSource,
  SessionFingerprintContent as RawProtoSessionFingerprintContent,
  SessionEventKind as RawProtoSessionEventKind,
  ViewportEventKind as RawProtoViewportEventKind,
  type ApplyTransformPluginResponse as RawApplyTransformPluginResponse,
  type CheckSessionModelResponse as RawCheckSessionModelResponse,
  type GetSessionContentInfoResponse as RawGetSessionContentInfoResponse,
  type GetSessionFingerprintResponse as RawGetSessionFingerprintResponse,
  type InspectSessionContentResponse as RawInspectSessionContentResponse,
  type RestoreLastCheckpointResponse as RawRestoreLastCheckpointResponse,
  type RestoreToChangeCountResponse as RawRestoreToChangeCountResponse,
  type SessionContentInfo as RawSessionContentInfo,
  type SessionContentFingerprint as RawSessionContentFingerprint,
  type TransformProgress,
  type TransformPluginInfo as RawTransformPluginInfo,
} from './protobuf_ts/generated/omega_edit/v1/omega_edit'
import {
  applyTransformPlugin as rawApplyTransformPlugin,
  beginSessionTransaction as rawBeginSessionTransaction,
  checkSessionModel as rawCheckSessionModel,
  countCharacters as rawCountCharacters,
  createCheckpoint as rawCreateCheckpoint,
  createSession as rawCreateSession,
  destroyLastCheckpoint as rawDestroyLastCheckpoint,
  destroySession as rawDestroySession,
  getByteOrderMark as rawGetByteOrderMark,
  getComputedFileSize as rawGetComputedFileSize,
  getContentType as rawGetContentType,
  getCounts as rawGetCounts,
  getLanguage as rawGetLanguage,
  getSegment as rawGetSegment,
  getSessionContentInfo as rawGetSessionContentInfo,
  getSessionFingerprint as rawGetSessionFingerprint,
  getSessionCount as rawGetSessionCount,
  inspectSessionContent as rawInspectSessionContent,
  listTransformPlugins as rawListTransformPlugins,
  notifyChangedViewports as rawNotifyChangedViewports,
  pauseSessionChanges as rawPauseSessionChanges,
  profileSession as rawProfileSession,
  replaceSession as rawReplaceSession,
  replaceSessionCheckpointed as rawReplaceSessionCheckpointed,
  restoreLastCheckpoint as rawRestoreLastCheckpoint,
  restoreToChangeCount as rawRestoreToChangeCount,
  resumeSessionChanges as rawResumeSessionChanges,
  saveSession as rawSaveSession,
  searchSession as rawSearchSession,
  unsubscribeSession as rawUnsubscribeSession,
  endSessionTransaction as rawEndSessionTransaction,
} from './protobuf_ts/session'
import {
  makeCancellationError,
  type CancellableCallOptions,
} from './protobuf_ts/utils'
import {
  wrapByteOrderMarkResponse,
  wrapCharacterCountResponse,
  wrapContentTypeResponse,
  wrapCreateSessionResponse,
  wrapLanguageResponse,
  wrapSaveSessionResponse,
  wrapSingleCount,
  type ByteOrderMarkResponse,
  type CharacterCountResponse,
  type ContentTypeResponse,
  type CreateSessionResponse,
  type LanguageResponse,
  type SaveSessionResponse,
  type SingleCount,
} from './omega_edit_pb'
import { editSimple, type IEditStats, overwrite } from './change'
import {
  requireSafeIntegerArrayOutput,
  requireSafeIntegerInput,
  requireSafeIntegerOutput,
} from './safe_int'
import { enqueueSessionMutation } from './mutation_queue'
import { pauseViewportEvents, resumeViewportEvents } from './viewport'

export type {
  CancellationSignal,
  CancellableCallOptions,
} from './protobuf_ts/utils'

export enum SaveStatus {
  SUCCESS = 0,
  MODIFIED = -100,
}

export const IOFlags = {
  UNSPECIFIED: ProtoIOFlags.IO_FLAGS_UNSPECIFIED,
  OVERWRITE: ProtoIOFlags.IO_FLAGS_OVERWRITE,
  FORCE_OVERWRITE: ProtoIOFlags.IO_FLAGS_FORCE_OVERWRITE,
} as const
export type IOFlags = (typeof IOFlags)[keyof typeof IOFlags]

export const SearchCaseFolding = {
  ASCII: RawProtoSearchCaseFolding.ASCII,
  WINDOWS_1252: RawProtoSearchCaseFolding.WINDOWS_1252,
  CP437: RawProtoSearchCaseFolding.CP437,
  EBCDIC_037: RawProtoSearchCaseFolding.EBCDIC_037,
  MAC_ROMAN: RawProtoSearchCaseFolding.MAC_ROMAN,
} as const
export type SearchCaseFolding =
  (typeof SearchCaseFolding)[keyof typeof SearchCaseFolding]

type ReplaceStatsOrCaseFolding = IEditStats | SearchCaseFolding

function resolveReplaceStatsAndFolding(
  statsOrCaseFolding?: ReplaceStatsOrCaseFolding,
  case_folding: SearchCaseFolding = SearchCaseFolding.ASCII
): { stats?: IEditStats; caseFolding: SearchCaseFolding } {
  return typeof statsOrCaseFolding === 'number'
    ? { caseFolding: statsOrCaseFolding }
    : { stats: statsOrCaseFolding, caseFolding: case_folding }
}

export const SessionEventKind = {
  UNSPECIFIED: RawProtoSessionEventKind.UNSPECIFIED,
  CREATE: RawProtoSessionEventKind.CREATE,
  EDIT: RawProtoSessionEventKind.EDIT,
  UNDO: RawProtoSessionEventKind.UNDO,
  CLEAR: RawProtoSessionEventKind.CLEAR,
  TRANSFORM: RawProtoSessionEventKind.TRANSFORM,
  CREATE_CHECKPOINT: RawProtoSessionEventKind.CREATE_CHECKPOINT,
  DESTROY_CHECKPOINT: RawProtoSessionEventKind.DESTROY_CHECKPOINT,
  SAVE: RawProtoSessionEventKind.SAVE,
  CHANGES_PAUSED: RawProtoSessionEventKind.CHANGES_PAUSED,
  CHANGES_RESUMED: RawProtoSessionEventKind.CHANGES_RESUMED,
  CREATE_VIEWPORT: RawProtoSessionEventKind.CREATE_VIEWPORT,
  DESTROY_VIEWPORT: RawProtoSessionEventKind.DESTROY_VIEWPORT,
  TRANSACTION_STARTED: RawProtoSessionEventKind.TRANSACTION_STARTED,
  TRANSACTION_ENDED: RawProtoSessionEventKind.TRANSACTION_ENDED,
  TRANSFORM_STARTED: RawProtoSessionEventKind.TRANSFORM_STARTED,
  TRANSFORM_PROGRESS: RawProtoSessionEventKind.TRANSFORM_PROGRESS,
  TRANSFORM_COMPLETED: RawProtoSessionEventKind.TRANSFORM_COMPLETED,
  TRANSFORM_FAILED: RawProtoSessionEventKind.TRANSFORM_FAILED,
  RESTORE_CHECKPOINT: RawProtoSessionEventKind.RESTORE_CHECKPOINT,
} as const
export type SessionEventKind =
  (typeof SessionEventKind)[keyof typeof SessionEventKind]

export const ViewportEventKind = {
  UNSPECIFIED: RawProtoViewportEventKind.UNSPECIFIED,
  CREATE: RawProtoViewportEventKind.CREATE,
  EDIT: RawProtoViewportEventKind.EDIT,
  UNDO: RawProtoViewportEventKind.UNDO,
  CLEAR: RawProtoViewportEventKind.CLEAR,
  TRANSFORM: RawProtoViewportEventKind.TRANSFORM,
  MODIFY: RawProtoViewportEventKind.MODIFY,
  CHANGES: RawProtoViewportEventKind.CHANGES,
} as const
export type ViewportEventKind =
  (typeof ViewportEventKind)[keyof typeof ViewportEventKind]

export const SessionFingerprintContent = {
  UNSPECIFIED: RawProtoSessionFingerprintContent.UNSPECIFIED,
  ORIGINAL: RawProtoSessionFingerprintContent.ORIGINAL,
  COMPUTED: RawProtoSessionFingerprintContent.COMPUTED,
} as const
export type SessionFingerprintContent =
  (typeof SessionFingerprintContent)[keyof typeof SessionFingerprintContent]

export const SessionContentSource = {
  UNSPECIFIED: RawProtoSessionContentSource.UNSPECIFIED,
  ORIGINAL: RawProtoSessionContentSource.ORIGINAL,
  COMPUTED: RawProtoSessionContentSource.COMPUTED,
  LATEST_CHECKPOINT: RawProtoSessionContentSource.LATEST_CHECKPOINT,
} as const
export type SessionContentSource =
  (typeof SessionContentSource)[keyof typeof SessionContentSource]

export const TransformPluginOperation = {
  UNSPECIFIED: RawProtoTransformPluginOperation.UNSPECIFIED,
  REPLACE: RawProtoTransformPluginOperation.REPLACE,
  INSPECT: RawProtoTransformPluginOperation.INSPECT,
  REPLACE_AND_INSPECT: RawProtoTransformPluginOperation.REPLACE_AND_INSPECT,
} as const
export type TransformPluginOperation =
  (typeof TransformPluginOperation)[keyof typeof TransformPluginOperation]

export const TransformPluginSupport = {
  UNSPECIFIED: RawProtoTransformPluginSupport.UNSPECIFIED,
  PRODUCTION: RawProtoTransformPluginSupport.PRODUCTION,
  EXPERIMENTAL: RawProtoTransformPluginSupport.EXPERIMENTAL,
  TEST: RawProtoTransformPluginSupport.TEST,
} as const
export type TransformPluginSupport =
  (typeof TransformPluginSupport)[keyof typeof TransformPluginSupport]

export type TransformPluginInfo = RawTransformPluginInfo
export type ApplyTransformPluginResponse = RawApplyTransformPluginResponse
export type RestoreLastCheckpointResponse = RawRestoreLastCheckpointResponse
export type RestoreToChangeCountResponse = RawRestoreToChangeCountResponse
export type CheckSessionModelResponse = RawCheckSessionModelResponse
export type SessionContentInfo = RawSessionContentInfo
export type GetSessionContentInfoResponse = RawGetSessionContentInfoResponse
export type SessionContentFingerprint = RawSessionContentFingerprint
export type GetSessionFingerprintResponse = RawGetSessionFingerprintResponse
export type InspectSessionContentResponse = RawInspectSessionContentResponse
export type { TransformProgress }

export const PROFILE_DOS_EOL = 256

export async function createSession(
  file_path: string = '',
  session_id_desired: string = '',
  checkpoint_directory: string = ''
): Promise<CreateSessionResponse> {
  return wrapCreateSessionResponse(
    await rawCreateSession(file_path, session_id_desired, checkpoint_directory)
  )
}

export async function createSessionFromBytes(
  initial_data: Uint8Array,
  session_id_desired: string = '',
  checkpoint_directory: string = ''
): Promise<CreateSessionResponse> {
  return wrapCreateSessionResponse(
    await rawCreateSession(
      '',
      session_id_desired,
      checkpoint_directory,
      initial_data
    )
  )
}

export function destroySession(session_id: string): Promise<string> {
  return rawDestroySession(session_id)
}

export async function checkSessionModel(
  session_id: string
): Promise<CheckSessionModelResponse> {
  const response = await rawCheckSessionModel(session_id)
  return {
    sessionId: response.sessionId,
    valid: response.valid,
    status: requireSafeIntegerOutput(
      'checkSessionModel status',
      response.status
    ),
  }
}

export async function getSessionFingerprint(
  session_id: string,
  content: SessionFingerprintContent,
  algorithm = 'sha256'
): Promise<GetSessionFingerprintResponse> {
  const response = await rawGetSessionFingerprint(
    session_id,
    content,
    algorithm
  )
  if (!response.fingerprint?.digest) {
    throw new Error('getSessionFingerprint response missing fingerprint digest')
  }

  return {
    sessionId: response.sessionId,
    content: response.content,
    fingerprint: {
      byteLength: requireSafeIntegerOutput(
        'session fingerprint byte length',
        response.fingerprint.byteLength
      ),
      digest: {
        algorithm: response.fingerprint.digest.algorithm,
        value: response.fingerprint.digest.value,
      },
    },
  }
}

export async function getSessionContentInfo(
  session_id: string,
  content: SessionContentSource[] = []
): Promise<GetSessionContentInfoResponse> {
  const response = await rawGetSessionContentInfo(session_id, content)
  return {
    sessionId: response.sessionId,
    info: response.info.map((entry) => ({
      content: entry.content,
      available: entry.available,
      byteLength: requireSafeIntegerOutput(
        'session content byte length',
        entry.byteLength
      ),
      label: entry.label,
    })),
  }
}

export async function createCheckpoint(session_id: string): Promise<number> {
  return await enqueueSessionMutation(session_id, async () => {
    const response = await rawCreateCheckpoint(session_id)
    return requireSafeIntegerOutput(
      'checkpoint count',
      response.checkpointCount
    )
  })
}

export async function destroyLastCheckpoint(
  session_id: string
): Promise<number> {
  return await enqueueSessionMutation(session_id, async () => {
    const response = await rawDestroyLastCheckpoint(session_id)
    return requireSafeIntegerOutput(
      'remaining checkpoints',
      response.remainingCheckpoints
    )
  })
}

export async function restoreLastCheckpoint(
  session_id: string
): Promise<RestoreLastCheckpointResponse> {
  return await enqueueSessionMutation(session_id, async () => {
    const response = await rawRestoreLastCheckpoint(session_id)
    requireSafeIntegerOutput('checkpoint count', response.checkpointCount)
    requireSafeIntegerOutput('change count', response.changeCount)
    requireSafeIntegerOutput(
      'discarded change count',
      response.discardedChangeCount
    )
    return response
  })
}

export async function restoreToChangeCount(
  session_id: string,
  change_count: number
): Promise<RestoreToChangeCountResponse> {
  return await enqueueSessionMutation(session_id, async () => {
    const response = await rawRestoreToChangeCount(
      session_id,
      requireSafeIntegerInput('restore change count', change_count)
    )
    requireSafeIntegerOutput('change count', response.changeCount)
    requireSafeIntegerOutput(
      'discarded change count',
      response.discardedChangeCount
    )
    requireSafeIntegerOutput(
      'discarded undo count',
      response.discardedUndoCount
    )
    requireSafeIntegerOutput(
      'remaining checkpoint count',
      response.remainingCheckpointCount
    )
    return response
  })
}

export async function saveSession(
  session_id: string,
  file_path: string,
  flags: number = IOFlags.UNSPECIFIED,
  offset: number = 0,
  length: number = 0
): Promise<SaveSessionResponse> {
  return await enqueueSessionMutation(session_id, async () => {
    return wrapSaveSessionResponse(
      await rawSaveSession(
        session_id,
        file_path,
        flags,
        requireSafeIntegerInput('saveSession offset', offset),
        requireSafeIntegerInput('saveSession length', length)
      )
    )
  })
}

export function getComputedFileSize(session_id: string): Promise<number> {
  return rawGetComputedFileSize(session_id).then((size) =>
    requireSafeIntegerOutput('computed file size', size)
  )
}

export async function getCounts(
  session_id: string,
  kinds: number[]
): Promise<SingleCount[]> {
  return (await rawGetCounts(session_id, kinds)).map(wrapSingleCount)
}

export function pauseSessionChanges(session_id: string): Promise<string> {
  return rawPauseSessionChanges(session_id)
}

export function beginSessionTransaction(session_id: string): Promise<string> {
  return enqueueSessionMutation(session_id, async () => {
    return await rawBeginSessionTransaction(session_id)
  })
}

export function endSessionTransaction(session_id: string): Promise<string> {
  return enqueueSessionMutation(session_id, async () => {
    return await rawEndSessionTransaction(session_id)
  })
}

export async function runSessionTransaction<T>(
  session_id: string,
  work: () => Promise<T>
): Promise<T> {
  return await enqueueSessionMutation(session_id, async () => {
    await rawBeginSessionTransaction(session_id)
    try {
      return await work()
    } finally {
      await rawEndSessionTransaction(session_id)
    }
  })
}

export async function withViewportBatch<T>(
  session_id: string,
  work: () => Promise<T>,
  options: {
    transactional?: boolean
    notifyChangedViewports?: boolean
  } = {}
): Promise<T> {
  return await enqueueSessionMutation(session_id, async () => {
    let viewportEventsPaused = false
    await pauseViewportEvents(session_id)
    viewportEventsPaused = true

    try {
      if (options.transactional ?? true) {
        return await runSessionTransaction(session_id, work)
      }
      return await work()
    } finally {
      if (viewportEventsPaused) {
        await resumeViewportEvents(session_id)
        if (options.notifyChangedViewports ?? true) {
          await notifyChangedViewports(session_id)
        }
      }
    }
  })
}

export function resumeSessionChanges(session_id: string): Promise<string> {
  return rawResumeSessionChanges(session_id)
}

export function unsubscribeSession(session_id: string): Promise<string> {
  return rawUnsubscribeSession(session_id)
}

export function getSegment(
  session_id: string,
  offset: number,
  length: number
): Promise<Uint8Array> {
  return rawGetSegment(
    session_id,
    requireSafeIntegerInput('getSegment offset', offset),
    requireSafeIntegerInput('getSegment length', length)
  )
}

export async function getSessionBytes(
  session_id: string,
  offset: number = 0,
  length: number = 0
): Promise<Uint8Array> {
  const safeOffset = requireSafeIntegerInput('getSessionBytes offset', offset)
  const safeLength = requireSafeIntegerInput('getSessionBytes length', length)
  // This helper issues separate size and segment RPCs, so callers should treat
  // it as a convenience snapshot read when the session is not being
  // concurrently modified.
  const computedSize = await getComputedFileSize(session_id)
  const remaining = Math.max(0, computedSize - safeOffset)
  const effectiveLength =
    safeLength > 0 ? Math.min(safeLength, remaining) : remaining
  return rawGetSegment(session_id, safeOffset, effectiveLength)
}

export function getSessionCount(): Promise<number> {
  return rawGetSessionCount().then((count) =>
    requireSafeIntegerOutput('session count', count)
  )
}

export function notifyChangedViewports(session_id: string): Promise<number> {
  return rawNotifyChangedViewports(session_id).then((count) =>
    requireSafeIntegerOutput('changed viewport count', count)
  )
}

export function listTransformPlugins(): Promise<TransformPluginInfo[]> {
  return rawListTransformPlugins()
}

export async function applyTransformPlugin(
  session_id: string,
  plugin_id: string,
  offset: number = 0,
  length: number = 0,
  options_json?: string,
  options: CancellableCallOptions = {}
): Promise<ApplyTransformPluginResponse> {
  return await enqueueSessionMutation(session_id, async () => {
    if (options.signal?.aborted) {
      throw makeCancellationError('applyTransformPlugin')
    }
    const response = await rawApplyTransformPlugin(
      session_id,
      plugin_id,
      requireSafeIntegerInput('applyTransformPlugin offset', offset),
      requireSafeIntegerInput('applyTransformPlugin length', length),
      options_json,
      options
    )
    requireSafeIntegerOutput('applyTransformPlugin offset', response.offset)
    requireSafeIntegerOutput('applyTransformPlugin length', response.length)
    requireSafeIntegerOutput(
      'applyTransformPlugin computed file size',
      response.computedFileSize
    )
    requireSafeIntegerOutput(
      'applyTransformPlugin replacement length',
      response.replacementLength
    )
    if (response.serial !== undefined) {
      requireSafeIntegerOutput('applyTransformPlugin serial', response.serial)
    }
    return response
  })
}

export async function inspectSessionContent(
  session_id: string,
  content: SessionContentSource,
  plugin_id: string,
  offset: number = 0,
  length: number = 0,
  options_json?: string,
  options: CancellableCallOptions = {}
): Promise<InspectSessionContentResponse> {
  if (options.signal?.aborted) {
    throw makeCancellationError('inspectSessionContent')
  }
  const response = await rawInspectSessionContent(
    session_id,
    content,
    plugin_id,
    requireSafeIntegerInput('inspectSessionContent offset', offset),
    requireSafeIntegerInput('inspectSessionContent length', length),
    options_json,
    options
  )
  requireSafeIntegerOutput('inspectSessionContent offset', response.offset)
  requireSafeIntegerOutput('inspectSessionContent length', response.length)
  requireSafeIntegerOutput(
    'inspectSessionContent content byte length',
    response.contentByteLength
  )
  return response
}

export function profileSession(
  session_id: string,
  offset: number = 0,
  length: number = 0
): Promise<number[]> {
  return rawProfileSession(
    session_id,
    requireSafeIntegerInput('profileSession offset', offset),
    requireSafeIntegerInput('profileSession length', length)
  ).then((profile) => requireSafeIntegerArrayOutput('byte profile', profile))
}

export function numAscii(profile: number[]): number {
  return requireSafeIntegerOutput(
    'ASCII character count',
    profile.slice(0, 128).reduce((accumulator, current) => {
      return accumulator + current
    }, 0)
  )
}

export async function getByteOrderMark(
  session_id: string,
  offset: number = 0
): Promise<ByteOrderMarkResponse> {
  return wrapByteOrderMarkResponse(
    await rawGetByteOrderMark(
      session_id,
      requireSafeIntegerInput('getByteOrderMark offset', offset)
    )
  )
}

export async function getContentType(
  session_id: string,
  offset: number,
  length: number
): Promise<ContentTypeResponse> {
  return wrapContentTypeResponse(
    await rawGetContentType(
      session_id,
      requireSafeIntegerInput('getContentType offset', offset),
      requireSafeIntegerInput('getContentType length', length)
    )
  )
}

export async function getLanguage(
  session_id: string,
  offset: number,
  length: number,
  bom: string
): Promise<LanguageResponse> {
  return wrapLanguageResponse(
    await rawGetLanguage(
      session_id,
      requireSafeIntegerInput('getLanguage offset', offset),
      requireSafeIntegerInput('getLanguage length', length),
      bom
    )
  )
}

export async function countCharacters(
  session_id: string,
  offset: number = 0,
  length: number = 0,
  bom: string = 'none'
): Promise<CharacterCountResponse> {
  return wrapCharacterCountResponse(
    await rawCountCharacters(
      session_id,
      requireSafeIntegerInput('countCharacters offset', offset),
      requireSafeIntegerInput('countCharacters length', length),
      bom
    )
  )
}

export function searchSession(
  session_id: string,
  pattern: string | Uint8Array,
  is_case_insensitive: boolean = false,
  is_reverse: boolean = false,
  offset: number = 0,
  length: number = 0,
  limit: number = 0,
  case_folding: SearchCaseFolding = SearchCaseFolding.ASCII
): Promise<number[]> {
  return rawSearchSession(
    session_id,
    pattern,
    is_case_insensitive,
    is_reverse,
    requireSafeIntegerInput('searchSession offset', offset),
    requireSafeIntegerInput('searchSession length', length),
    requireSafeIntegerInput('searchSession limit', limit),
    case_folding
  ).then((matches) => requireSafeIntegerArrayOutput('match offsets', matches))
}

export async function replaceSession(
  session_id: string,
  pattern: string | Uint8Array,
  replacement: string | Uint8Array,
  is_case_insensitive?: boolean,
  is_reverse?: boolean,
  offset?: number,
  length?: number,
  limit?: number,
  front_to_back?: boolean,
  overwrite_only?: boolean,
  stats?: IEditStats
): Promise<number>
export async function replaceSession(
  session_id: string,
  pattern: string | Uint8Array,
  replacement: string | Uint8Array,
  is_case_insensitive: boolean | undefined,
  is_reverse: boolean | undefined,
  offset: number | undefined,
  length: number | undefined,
  limit: number | undefined,
  front_to_back: boolean | undefined,
  overwrite_only: boolean | undefined,
  stats: IEditStats | undefined,
  case_folding: SearchCaseFolding
): Promise<number>
export async function replaceSession(
  session_id: string,
  pattern: string | Uint8Array,
  replacement: string | Uint8Array,
  is_case_insensitive: boolean = false,
  is_reverse: boolean = false,
  offset: number = 0,
  length: number = 0,
  limit: number = 0,
  front_to_back: boolean = true,
  overwrite_only: boolean = false,
  statsOrCaseFolding?: ReplaceStatsOrCaseFolding,
  case_folding: SearchCaseFolding = SearchCaseFolding.ASCII
): Promise<number> {
  const { stats, caseFolding } = resolveReplaceStatsAndFolding(
    statsOrCaseFolding,
    case_folding
  )
  // Use withViewportBatch (transactional:false) so that the N individual viewport events fired by
  // omega_edit_apply_script are coalesced into a single viewport refresh on the client side.
  return await withViewportBatch(
    session_id,
    async () => {
      const response = await rawReplaceSession(
        session_id,
        pattern,
        replacement,
        is_case_insensitive,
        is_reverse,
        requireSafeIntegerInput('replaceSession offset', offset),
        requireSafeIntegerInput('replaceSession length', length),
        requireSafeIntegerInput('replaceSession limit', limit),
        front_to_back,
        overwrite_only,
        caseFolding
      )
      if (stats) {
        stats.delete_count += requireSafeIntegerOutput(
          'replaceSession delete_count',
          response.deleteCount
        )
        stats.insert_count += requireSafeIntegerOutput(
          'replaceSession insert_count',
          response.insertCount
        )
        stats.overwrite_count += requireSafeIntegerOutput(
          'replaceSession overwrite_count',
          response.overwriteCount
        )
      }
      return requireSafeIntegerOutput(
        'replacement count',
        response.replacementCount
      )
    },
    { transactional: false }
  )
}

export async function replaceSessionCheckpointed(
  session_id: string,
  pattern: string | Uint8Array,
  replacement: string | Uint8Array,
  is_case_insensitive: boolean = false,
  offset: number = 0,
  length: number = 0,
  case_folding: SearchCaseFolding = SearchCaseFolding.ASCII
): Promise<number> {
  return await enqueueSessionMutation(session_id, async () => {
    const response = await rawReplaceSessionCheckpointed(
      session_id,
      pattern,
      replacement,
      is_case_insensitive,
      requireSafeIntegerInput('replaceSessionCheckpointed offset', offset),
      requireSafeIntegerInput('replaceSessionCheckpointed length', length),
      case_folding
    )
    return requireSafeIntegerOutput(
      'replacement count',
      response.replacementCount
    )
  })
}

export async function replaceOneSession(
  session_id: string,
  pattern: string | Uint8Array,
  replacement: string | Uint8Array,
  is_case_insensitive?: boolean,
  is_reverse?: boolean,
  offset?: number,
  length?: number,
  overwrite_only?: boolean,
  stats?: IEditStats
): Promise<number>
export async function replaceOneSession(
  session_id: string,
  pattern: string | Uint8Array,
  replacement: string | Uint8Array,
  is_case_insensitive: boolean | undefined,
  is_reverse: boolean | undefined,
  offset: number | undefined,
  length: number | undefined,
  overwrite_only: boolean | undefined,
  stats: IEditStats | undefined,
  case_folding: SearchCaseFolding
): Promise<number>
export async function replaceOneSession(
  session_id: string,
  pattern: string | Uint8Array,
  replacement: string | Uint8Array,
  is_case_insensitive: boolean = false,
  is_reverse: boolean = false,
  offset: number = 0,
  length: number = 0,
  overwrite_only: boolean = false,
  statsOrCaseFolding?: ReplaceStatsOrCaseFolding,
  case_folding: SearchCaseFolding = SearchCaseFolding.ASCII
): Promise<number> {
  const { stats, caseFolding } = resolveReplaceStatsAndFolding(
    statsOrCaseFolding,
    case_folding
  )
  return await enqueueSessionMutation(session_id, async () => {
    const safeOffset = requireSafeIntegerInput(
      'replaceOneSession offset',
      offset
    )
    const safeLength = requireSafeIntegerInput(
      'replaceOneSession length',
      length
    )
    const patternArray =
      typeof pattern == 'string' ? Buffer.from(pattern) : pattern
    const replacementArray =
      typeof replacement == 'string' ? Buffer.from(replacement) : replacement
    const foundLocations = await searchSession(
      session_id,
      patternArray,
      is_case_insensitive,
      is_reverse,
      safeOffset,
      safeLength,
      1,
      caseFolding
    )
    if (foundLocations.length > 0) {
      if (overwrite_only) {
        await overwrite(session_id, foundLocations[0], replacementArray, stats)
      } else {
        await editSimple(
          session_id,
          foundLocations[0],
          patternArray,
          replacementArray,
          stats
        )
      }
      return requireSafeIntegerOutput(
        'replacement end offset',
        foundLocations[0] + replacementArray.length
      )
    }
    return -1
  })
}
