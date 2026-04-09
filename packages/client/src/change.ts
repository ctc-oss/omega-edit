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

import { ChangeKind as RawProtoChangeKind } from './protobuf_ts/generated/omega_edit/v1/omega_edit'
import {
  clear as rawClear,
  del as rawDel,
  EditStats,
  getChangeCount as rawGetChangeCount,
  getChangeTransactionCount as rawGetChangeTransactionCount,
  getLastChange as rawGetLastChange,
  getLastUndo as rawGetLastUndo,
  getUndoCount as rawGetUndoCount,
  getUndoTransactionCount as rawGetUndoTransactionCount,
  insert as rawInsert,
  overwrite as rawOverwrite,
  redo as rawRedo,
  type IEditStats,
  undo as rawUndo,
} from './protobuf_ts/change'
import {
  wrapChangeDetailsResponse,
  type ChangeDetailsResponse,
} from './omega_edit_pb'
import { enqueueSessionMutation } from './mutation_queue'
import { notifyChangedViewports, runSessionTransaction } from './session'
import { requireSafeIntegerInput, requireSafeIntegerOutput } from './safe_int'
import { pauseViewportEvents, resumeViewportEvents } from './viewport'

export const ChangeKind = {
  UNSPECIFIED: RawProtoChangeKind.UNSPECIFIED,
  DELETE: RawProtoChangeKind.DELETE,
  INSERT: RawProtoChangeKind.INSERT,
  OVERWRITE: RawProtoChangeKind.OVERWRITE,
}

export { EditStats }
export type { IEditStats }

/**
 * Delete a number of bytes at the given offset.
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param len number of bytes to delete
 * @param stats optional edit stats to update
 * @returns positive change serial number
 * @remarks Function is named `del` because `delete` is a reserved keyword.
 */
export function del(
  session_id: string,
  offset: number,
  len: number,
  stats?: IEditStats
): Promise<number> {
  return enqueueSessionMutation(session_id, async () => {
    return await rawDel(
      session_id,
      requireSafeIntegerInput('delete offset', offset),
      requireSafeIntegerInput('delete length', len),
      stats
    ).then((serial) => requireSafeIntegerOutput('change serial', serial))
  })
}

/**
 * Insert bytes at the given offset.
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param data bytes to insert at the given offset
 * @param stats optional edit stats to update
 * @returns positive change serial number on success
 */
export function insert(
  session_id: string,
  offset: number,
  data: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return enqueueSessionMutation(session_id, async () => {
    return await rawInsert(
      session_id,
      requireSafeIntegerInput('insert offset', offset),
      data,
      stats
    ).then((serial) => requireSafeIntegerOutput('change serial', serial))
  })
}

/**
 * Overwrite bytes at the given offset.
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param data replacement bytes
 * @param stats optional edit stats to update
 * @returns positive change serial number on success
 */
export function overwrite(
  session_id: string,
  offset: number,
  data: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return enqueueSessionMutation(session_id, async () => {
    return await rawOverwrite(
      session_id,
      requireSafeIntegerInput('overwrite offset', offset),
      data,
      stats
    ).then((serial) => requireSafeIntegerOutput('change serial', serial))
  })
}

/**
 * Replace a byte range with new content.
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param remove_bytes_count number of bytes to remove
 * @param replacement replacement bytes
 * @param stats optional edit stats to update
 * @returns positive change serial number on success
 */
export function replace(
  session_id: string,
  offset: number,
  remove_bytes_count: number,
  replacement: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return replaceInternal(
    session_id,
    offset,
    remove_bytes_count,
    replacement,
    stats,
    true
  )
}

function replaceInternal(
  session_id: string,
  offset: number,
  remove_bytes_count: number,
  replacement: Uint8Array,
  stats: IEditStats | undefined,
  transactional: boolean
): Promise<number> {
  const safeOffset = requireSafeIntegerInput('replace offset', offset)
  const safeRemoveBytesCount = requireSafeIntegerInput(
    'replace length',
    remove_bytes_count
  )
  if (remove_bytes_count === 0) {
    return insert(session_id, safeOffset, replacement, stats)
  } else if (replacement.length === 0) {
    return del(session_id, safeOffset, safeRemoveBytesCount, stats)
  } else if (replacement.length === remove_bytes_count) {
    return overwrite(session_id, safeOffset, replacement, stats)
  }
  return transactional
    ? replaceWithTransaction(
        session_id,
        safeOffset,
        safeRemoveBytesCount,
        replacement,
        stats
      )
    : replaceWithoutTransaction(
        session_id,
        safeOffset,
        safeRemoveBytesCount,
        replacement,
        stats
      )
}

async function replaceWithTransaction(
  session_id: string,
  offset: number,
  remove_bytes_count: number,
  replacement: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return await enqueueSessionMutation(session_id, async () => {
    return await runSessionTransaction(session_id, async () => {
      await del(session_id, offset, remove_bytes_count, stats)
      return await insert(session_id, offset, replacement, stats)
    })
  })
}

async function replaceWithoutTransaction(
  session_id: string,
  offset: number,
  remove_bytes_count: number,
  replacement: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  await del(session_id, offset, remove_bytes_count, stats)
  return await insert(session_id, offset, replacement, stats)
}

/**
 * Optimize a simple replace operation by trimming the common prefix and suffix.
 * @param original_segment original segment
 * @param edited_segment replacement segment
 * @param offset start offset of the segments in the file
 * @returns a single optimized replacement descriptor, or `null` if no edit is needed
 */
export function editOptimizer(
  original_segment: Uint8Array,
  edited_segment: Uint8Array,
  offset: number = 0
):
  | [{ offset: number; remove_bytes_count: number; replacement: Uint8Array }]
  | null {
  const safeOffset = requireSafeIntegerInput('edit offset', offset)
  let first_difference = 0
  let last_difference = 0

  while (
    first_difference < original_segment.length &&
    first_difference < edited_segment.length &&
    original_segment[first_difference] === edited_segment[first_difference]
  ) {
    ++first_difference
  }

  if (
    first_difference === original_segment.length &&
    first_difference === edited_segment.length
  ) {
    return null
  }

  while (
    last_difference < original_segment.length - first_difference &&
    last_difference < edited_segment.length - first_difference &&
    original_segment[original_segment.length - 1 - last_difference] ===
      edited_segment[edited_segment.length - 1 - last_difference]
  ) {
    ++last_difference
  }

  return [
    {
      offset: requireSafeIntegerOutput(
        'edit offset',
        safeOffset + first_difference
      ),
      remove_bytes_count:
        original_segment.length - first_difference - last_difference,
      replacement: edited_segment.slice(
        first_difference,
        edited_segment.length - last_difference
      ),
    },
  ]
}

/**
 * Apply an optimized edit without pausing viewport notifications.
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param original_segment original segment
 * @param edited_segment replacement segment
 * @param stats optional edit stats to update
 * @returns positive change serial number of the last edit operation on success
 * @remarks Suitable for bulk edit flows where the caller manages viewport events.
 */
export async function editSimple(
  session_id: string,
  offset: number,
  original_segment: Uint8Array,
  edited_segment: Uint8Array,
  stats?: IEditStats,
  transactional: boolean = true
): Promise<number> {
  return await enqueueSessionMutation(session_id, async () => {
    const optimized_replacements = editOptimizer(
      original_segment,
      edited_segment,
      offset
    )
    let result = 0
    if (optimized_replacements) {
      const useTransaction = transactional && 1 < optimized_replacements.length
      const replaceTransactionally = transactional && !useTransaction
      const applyReplacements = async () => {
        for (let i = 0; i < optimized_replacements.length; ++i) {
          result = await replaceInternal(
            session_id,
            optimized_replacements[i].offset,
            optimized_replacements[i].remove_bytes_count,
            optimized_replacements[i].replacement,
            stats,
            replaceTransactionally
          )
        }
      }

      if (useTransaction) {
        await runSessionTransaction(session_id, applyReplacements)
      } else {
        await applyReplacements()
      }
    }
    return result
  })
}

/**
 * Undo the last change made in the given session.
 * @param session_id session to undo the last change for
 * @param stats optional edit stats to update
 * @returns negative serial number of the undone change if successful
 */
export function undo(session_id: string, stats?: IEditStats): Promise<number> {
  return enqueueSessionMutation(session_id, async () => {
    return await rawUndo(session_id, stats).then((serial) =>
      requireSafeIntegerOutput('undo serial', serial)
    )
  })
}

/**
 * Redo the most recently undone change in the given session.
 * @param session_id session to redo the last undone change for
 * @param stats optional edit stats to update
 * @returns positive serial number of the redone change if successful
 */
export function redo(session_id: string, stats?: IEditStats): Promise<number> {
  return enqueueSessionMutation(session_id, async () => {
    return await rawRedo(session_id, stats).then((serial) =>
      requireSafeIntegerOutput('redo serial', serial)
    )
  })
}

/**
 * Clear all change and undo history for a session.
 * @param session_id session to clear change history for
 * @param stats optional edit stats to update
 * @returns session id on success
 */
export function clear(session_id: string, stats?: IEditStats): Promise<string> {
  return enqueueSessionMutation(session_id, async () => {
    return await rawClear(session_id, stats)
  })
}

/**
 * Get details about the most recent change in a session.
 * @param session_id session to inspect
 * @returns compatibility-wrapped change details
 */
export async function getLastChange(
  session_id: string
): Promise<ChangeDetailsResponse> {
  return wrapChangeDetailsResponse(await rawGetLastChange(session_id))
}

/**
 * Get details about the most recent undone change in a session.
 * @param session_id session to inspect
 * @returns compatibility-wrapped change details
 */
export async function getLastUndo(
  session_id: string
): Promise<ChangeDetailsResponse> {
  return wrapChangeDetailsResponse(await rawGetLastUndo(session_id))
}

/**
 * Count committed changes in the session.
 * @param session_id session to inspect
 * @returns number of changes
 */
export function getChangeCount(session_id: string): Promise<number> {
  return rawGetChangeCount(session_id).then((count) =>
    requireSafeIntegerOutput('change count', count)
  )
}

/**
 * Count undoable changes in the session.
 * @param session_id session to inspect
 * @returns number of undo entries
 */
export function getUndoCount(session_id: string): Promise<number> {
  return rawGetUndoCount(session_id).then((count) =>
    requireSafeIntegerOutput('undo count', count)
  )
}

/**
 * Count change transactions in the session.
 * @param session_id session to inspect
 * @returns number of change transactions
 */
export function getChangeTransactionCount(session_id: string): Promise<number> {
  return rawGetChangeTransactionCount(session_id).then((count) =>
    requireSafeIntegerOutput('change transaction count', count)
  )
}

/**
 * Count undo transactions in the session.
 * @param session_id session to inspect
 * @returns number of undo transactions
 */
export function getUndoTransactionCount(session_id: string): Promise<number> {
  return rawGetUndoTransactionCount(session_id).then((count) =>
    requireSafeIntegerOutput('undo transaction count', count)
  )
}

/**
 * Concatenate two Uint8Arrays.
 * @param arr1 first array
 * @param arr2 second array
 * @returns concatenated array
 */
export function concatUint8Arrays(
  arr1: Uint8Array,
  arr2: Uint8Array
): Uint8Array {
  const result = new Uint8Array(arr1.length + arr2.length)
  result.set(arr1)
  result.set(arr2, arr1.length)
  return result
}

/**
 * Remove the common suffix from two Uint8Arrays.
 * @param arr1 first array
 * @param arr2 second array
 * @returns both arrays with their shared suffix removed
 */
export function removeCommonSuffix(
  arr1: Uint8Array,
  arr2: Uint8Array
): [Uint8Array, Uint8Array] {
  let i = arr1.length - 1
  let j = arr2.length - 1

  while (i >= 0 && j >= 0 && arr1[i] === arr2[j]) {
    i--
    j--
  }

  return [arr1.subarray(0, i + 1), arr2.subarray(0, j + 1)]
}

/**
 * Edit operation kinds produced by `editOperations()`.
 */
export enum EditOperationType {
  Delete = 'delete',
  Insert = 'insert',
  Overwrite = 'overwrite',
}

/**
 * A normalized edit operation that can be replayed against a session.
 */
export interface EditOperation {
  type: EditOperationType
  start: number
  length?: number
  data?: Uint8Array
}

/**
 * Compute a minimal sequence of edit operations to transform one segment into another.
 * @param originalSegment original segment
 * @param editedSegment edited segment
 * @param offset offset of the segments
 * @returns edit operations necessary to transform the original segment into the edited segment
 */
export function editOperations(
  originalSegment: Uint8Array,
  editedSegment: Uint8Array,
  offset: number = 0
): EditOperation[] {
  const safeOffset = requireSafeIntegerInput('edit offset', offset)
  if (originalSegment.length === 0) {
    if (editedSegment.length === 0) {
      return []
    }
    return [
      {
        type: EditOperationType.Insert,
        start: requireSafeIntegerOutput('edit offset', safeOffset),
        data: editedSegment,
      },
    ]
  }
  if (editedSegment.length === 0) {
    return [
      {
        type: EditOperationType.Delete,
        start: requireSafeIntegerOutput('edit offset', safeOffset),
        length: originalSegment.length,
      },
    ]
  }

  ;[originalSegment, editedSegment] = removeCommonSuffix(
    originalSegment,
    editedSegment
  )
  const len1 = originalSegment.length
  const len2 = editedSegment.length
  const maxLen = Math.max(len1, len2)
  const operations: EditOperation[] = []
  let overwriteRunStart: number | undefined

  const flushOverwriteRun = (endExclusive: number) => {
    if (overwriteRunStart === undefined) {
      return
    }

    operations.push({
      type: EditOperationType.Overwrite,
      start: requireSafeIntegerOutput(
        'edit offset',
        safeOffset + overwriteRunStart
      ),
      data: editedSegment.subarray(overwriteRunStart, endExclusive),
    })
    overwriteRunStart = undefined
  }

  for (let i = 0; i < maxLen; i++) {
    if (i < len1 && i < len2) {
      if (originalSegment[i] !== editedSegment[i]) {
        if (overwriteRunStart === undefined) {
          overwriteRunStart = i
        }
      } else {
        flushOverwriteRun(i)
      }
    } else if (i < len1) {
      flushOverwriteRun(i)
      operations.push({
        type: EditOperationType.Delete,
        start: requireSafeIntegerOutput('edit offset', safeOffset + i),
        length: len1 - i,
      })
      break
    } else {
      flushOverwriteRun(i)
      operations.push({
        type: EditOperationType.Insert,
        start: requireSafeIntegerOutput('edit offset', safeOffset + i),
        data: editedSegment.subarray(i),
      })
      break
    }
  }

  flushOverwriteRun(maxLen)

  return operations
}

/**
 * Edit a segment in a session, pausing viewport notifications when multiple operations are needed.
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param original_segment original segment
 * @param edited_segment replacement segment
 * @param stats optional edit stats to update
 * @returns positive change serial number of the last edit operation on success
 */
export async function edit(
  session_id: string,
  offset: number,
  original_segment: Uint8Array,
  edited_segment: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return await enqueueSessionMutation(session_id, async () => {
    const optimized_edits = editOperations(
      original_segment,
      edited_segment,
      offset
    )
    let result = 0
    if (optimized_edits) {
      const useTransaction = 1 < optimized_edits.length
      const applyEdits = async () => {
        for (let i = 0; i < optimized_edits.length; ++i) {
          switch (optimized_edits[i].type) {
            case EditOperationType.Insert:
              result = await insert(
                session_id,
                optimized_edits[i].start,
                optimized_edits[i].data!,
                stats
              )
              break
            case EditOperationType.Delete:
              result = await del(
                session_id,
                optimized_edits[i].start,
                optimized_edits[i].length!,
                stats
              )
              break
            case EditOperationType.Overwrite:
              result = await overwrite(
                session_id,
                optimized_edits[i].start,
                optimized_edits[i].data!,
                stats
              )
              break
            default:
              throw new Error('Unknown edit operation type')
          }
        }
      }

      if (useTransaction) {
        await pauseViewportEvents(session_id)
        try {
          await runSessionTransaction(session_id, applyEdits)
        } finally {
          await resumeViewportEvents(session_id)
        }
      } else {
        await applyEdits()
      }
      if (useTransaction) {
        await notifyChangedViewports(session_id)
      }
    }
    return result
  })
}
