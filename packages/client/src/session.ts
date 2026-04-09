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
  IOFlags as ProtoIOFlags,
  SessionEventKind as RawProtoSessionEventKind,
  ViewportEventKind as RawProtoViewportEventKind,
} from './protobuf_ts/generated/omega_edit/v1/omega_edit'
import {
  beginSessionTransaction as rawBeginSessionTransaction,
  countCharacters as rawCountCharacters,
  createSession as rawCreateSession,
  destroySession as rawDestroySession,
  getByteOrderMark as rawGetByteOrderMark,
  getComputedFileSize as rawGetComputedFileSize,
  getContentType as rawGetContentType,
  getCounts as rawGetCounts,
  getLanguage as rawGetLanguage,
  getSegment as rawGetSegment,
  getSessionCount as rawGetSessionCount,
  notifyChangedViewports as rawNotifyChangedViewports,
  pauseSessionChanges as rawPauseSessionChanges,
  profileSession as rawProfileSession,
  resumeSessionChanges as rawResumeSessionChanges,
  saveSession as rawSaveSession,
  searchSession as rawSearchSession,
  unsubscribeSession as rawUnsubscribeSession,
  endSessionTransaction as rawEndSessionTransaction,
} from './protobuf_ts/session'
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
  limit: number = 0
): Promise<number[]> {
  return rawSearchSession(
    session_id,
    pattern,
    is_case_insensitive,
    is_reverse,
    requireSafeIntegerInput('searchSession offset', offset),
    requireSafeIntegerInput('searchSession length', length),
    requireSafeIntegerInput('searchSession limit', limit)
  ).then((matches) => requireSafeIntegerArrayOutput('match offsets', matches))
}

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
  stats?: IEditStats
): Promise<number> {
  return await enqueueSessionMutation(session_id, async () => {
    const safeOffset = requireSafeIntegerInput('replaceSession offset', offset)
    const safeLength = requireSafeIntegerInput('replaceSession length', length)
    const safeLimit = requireSafeIntegerInput('replaceSession limit', limit)
    const foundLocations = await searchSession(
      session_id,
      pattern,
      is_case_insensitive,
      is_reverse,
      safeOffset,
      safeLength,
      safeLimit
    )
    const patternArray =
      typeof pattern == 'string' ? Buffer.from(pattern) : pattern
    const replacementArray =
      typeof replacement == 'string' ? Buffer.from(replacement) : replacement
    if (foundLocations.length === 0) {
      return 0
    }

    const orderedLocations = [...foundLocations].sort((a, b) =>
      front_to_back ? a - b : b - a
    )

    let viewportEventsPaused = false
    try {
      await runSessionTransaction(session_id, async () => {
        await pauseViewportEvents(session_id)
        viewportEventsPaused = true

        if (front_to_back) {
          if (overwrite_only) {
            for (const foundLocation of orderedLocations) {
              await overwrite(
                session_id,
                foundLocation,
                replacementArray,
                stats
              )
            }
          } else {
            const adjustment = replacementArray.length - patternArray.length
            for (let i = 0; i < orderedLocations.length; ++i) {
              await editSimple(
                session_id,
                requireSafeIntegerOutput(
                  'replaceSession offset',
                  adjustment * i + orderedLocations[i]
                ),
                patternArray,
                replacementArray,
                stats,
                false
              )
            }
          }
        } else {
          for (const foundLocation of orderedLocations) {
            if (overwrite_only) {
              await overwrite(
                session_id,
                foundLocation,
                replacementArray,
                stats
              )
            } else {
              await editSimple(
                session_id,
                foundLocation,
                patternArray,
                replacementArray,
                stats,
                false
              )
            }
          }
        }
      })
    } finally {
      if (viewportEventsPaused) {
        await resumeViewportEvents(session_id)
        await notifyChangedViewports(session_id)
      }
    }

    return requireSafeIntegerOutput('replacement count', foundLocations.length)
  })
}

export async function replaceOneSession(
  session_id: string,
  pattern: string | Uint8Array,
  replacement: string | Uint8Array,
  is_case_insensitive: boolean = false,
  is_reverse: boolean = false,
  offset: number = 0,
  length: number = 0,
  overwrite_only: boolean = false,
  stats?: IEditStats
): Promise<number> {
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
      1
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
