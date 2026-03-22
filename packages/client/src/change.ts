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

import { ChangeKind as ProtoChangeKind } from './protobuf_ts/generated/omega_edit/v1/omega_edit'
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
import {
  beginSessionTransaction,
  endSessionTransaction,
  notifyChangedViewports,
} from './session'
import { pauseViewportEvents, resumeViewportEvents } from './viewport'

export const ChangeKind = {
  CHANGE_DELETE: ProtoChangeKind.DELETE,
  CHANGE_INSERT: ProtoChangeKind.INSERT,
  CHANGE_OVERWRITE: ProtoChangeKind.OVERWRITE,
  ...ProtoChangeKind,
}

export { EditStats }
export type { IEditStats }

export function del(
  session_id: string,
  offset: number,
  len: number,
  stats?: IEditStats
): Promise<number> {
  return rawDel(session_id, offset, len, stats)
}

export function insert(
  session_id: string,
  offset: number,
  data: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return rawInsert(session_id, offset, data, stats)
}

export function overwrite(
  session_id: string,
  offset: number,
  data: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return rawOverwrite(session_id, offset, data, stats)
}

export function replace(
  session_id: string,
  offset: number,
  remove_bytes_count: number,
  replacement: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  if (remove_bytes_count === 0) {
    return insert(session_id, offset, replacement, stats)
  } else if (replacement.length === 0) {
    return del(session_id, offset, remove_bytes_count, stats)
  } else if (replacement.length === remove_bytes_count) {
    return overwrite(session_id, offset, replacement, stats)
  }
  return replaceWithTransaction(
    session_id,
    offset,
    remove_bytes_count,
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
  await beginSessionTransaction(session_id)
  try {
    await del(session_id, offset, remove_bytes_count, stats)
    return await insert(session_id, offset, replacement, stats)
  } finally {
    await endSessionTransaction(session_id)
  }
}

export function editOptimizer(
  original_segment: Uint8Array,
  edited_segment: Uint8Array,
  offset: number = 0
):
  | [{ offset: number; remove_bytes_count: number; replacement: Uint8Array }]
  | null {
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
      offset: offset + first_difference,
      remove_bytes_count:
        original_segment.length - first_difference - last_difference,
      replacement: edited_segment.slice(
        first_difference,
        edited_segment.length - last_difference
      ),
    },
  ]
}

export async function editSimple(
  session_id: string,
  offset: number,
  original_segment: Uint8Array,
  edited_segment: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  const optimized_replacements = editOptimizer(
    original_segment,
    edited_segment,
    offset
  )
  let result = 0
  if (optimized_replacements) {
    const useTransaction = 1 < optimized_replacements.length
    if (useTransaction) {
      await beginSessionTransaction(session_id)
    }
    try {
      for (let i = 0; i < optimized_replacements.length; ++i) {
        result = await replace(
          session_id,
          optimized_replacements[i].offset,
          optimized_replacements[i].remove_bytes_count,
          optimized_replacements[i].replacement,
          stats
        )
      }
    } finally {
      if (useTransaction) {
        await endSessionTransaction(session_id)
      }
    }
  }
  return result
}

export function undo(session_id: string, stats?: IEditStats): Promise<number> {
  return rawUndo(session_id, stats)
}

export function redo(session_id: string, stats?: IEditStats): Promise<number> {
  return rawRedo(session_id, stats)
}

export function clear(session_id: string, stats?: IEditStats): Promise<string> {
  return rawClear(session_id, stats)
}

export async function getLastChange(
  session_id: string
): Promise<ChangeDetailsResponse> {
  return wrapChangeDetailsResponse(await rawGetLastChange(session_id))
}

export async function getLastUndo(
  session_id: string
): Promise<ChangeDetailsResponse> {
  return wrapChangeDetailsResponse(await rawGetLastUndo(session_id))
}

export function getChangeCount(session_id: string): Promise<number> {
  return rawGetChangeCount(session_id)
}

export function getUndoCount(session_id: string): Promise<number> {
  return rawGetUndoCount(session_id)
}

export function getChangeTransactionCount(session_id: string): Promise<number> {
  return rawGetChangeTransactionCount(session_id)
}

export function getUndoTransactionCount(session_id: string): Promise<number> {
  return rawGetUndoTransactionCount(session_id)
}

export function concatUint8Arrays(
  arr1: Uint8Array,
  arr2: Uint8Array
): Uint8Array {
  const result = new Uint8Array(arr1.length + arr2.length)
  result.set(arr1)
  result.set(arr2, arr1.length)
  return result
}

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

export enum EditOperationType {
  Delete = 'delete',
  Insert = 'insert',
  Overwrite = 'overwrite',
}

export interface EditOperation {
  type: EditOperationType
  start: number
  length?: number
  data?: Uint8Array
}

export function editOperations(
  originalSegment: Uint8Array,
  editedSegment: Uint8Array,
  offset: number = 0
): EditOperation[] {
  if (originalSegment.length === 0) {
    if (editedSegment.length === 0) {
      return []
    }
    return [
      {
        type: EditOperationType.Insert,
        start: offset,
        data: editedSegment,
      },
    ]
  }
  if (editedSegment.length === 0) {
    return [
      {
        type: EditOperationType.Delete,
        start: offset,
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

  let previousOp: EditOperation | undefined

  for (let i = 0; i < maxLen; i++) {
    if (i < len1 && i < len2) {
      if (originalSegment[i] !== editedSegment[i]) {
        if (
          previousOp &&
          previousOp.type === EditOperationType.Overwrite &&
          previousOp.start + previousOp.data!.length === i
        ) {
          previousOp.data = concatUint8Arrays(
            previousOp.data!,
            new Uint8Array([editedSegment[i]])
          )
        } else {
          operations.push({
            type: EditOperationType.Overwrite,
            start: offset + i,
            data: new Uint8Array([editedSegment[i]]),
          })
          previousOp = operations[operations.length - 1]
        }
      }
    } else if (i < len1) {
      const deleteStart =
        previousOp && previousOp.type === EditOperationType.Delete
          ? previousOp.start
          : i
      operations.push({
        type: EditOperationType.Delete,
        start: offset + deleteStart,
        length: len1 - deleteStart,
      })
      previousOp = operations[operations.length - 1]
      break
    } else {
      operations.push({
        type: EditOperationType.Insert,
        start: offset + i,
        data: editedSegment.subarray(i),
      })
      previousOp = operations[operations.length - 1]
      break
    }
  }

  for (let k = 0; k < operations.length - 1; k++) {
    const op = operations[k]
    const nextOp = operations[k + 1]

    if (
      op.type === nextOp.type &&
      op.start + (op.length ?? op.data!.length) === nextOp.start
    ) {
      if (op.type === EditOperationType.Overwrite) {
        op.data = concatUint8Arrays(op.data!, nextOp.data!)
        op.length = undefined
      } else {
        op.length =
          (op.length ?? op.data!.length) +
          (nextOp.length ?? nextOp.data!.length)
      }
      operations.splice(k + 1, 1)
      k--
    } else if (
      op.type === EditOperationType.Delete &&
      nextOp.type === EditOperationType.Delete &&
      op.start + (op.length ?? 0) === nextOp.start
    ) {
      op.length = (op.length ?? 0) + nextOp.length!
      operations.splice(k + 1, 1)
      k--
    } else if (
      op.type === EditOperationType.Insert &&
      nextOp.type === EditOperationType.Insert &&
      op.start + (op.data?.length ?? 0) === nextOp.start
    ) {
      op.data = concatUint8Arrays(op.data!, nextOp.data!)
      operations.splice(k + 1, 1)
      k--
    }
  }

  return operations
}

export async function edit(
  session_id: string,
  offset: number,
  original_segment: Uint8Array,
  edited_segment: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  const optimized_edits = editOperations(
    original_segment,
    edited_segment,
    offset
  )
  let result = 0
  if (optimized_edits) {
    const useTransaction = 1 < optimized_edits.length
    if (useTransaction) {
      await beginSessionTransaction(session_id)
      await pauseViewportEvents(session_id)
    }

    try {
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
    } finally {
      if (useTransaction) {
        await resumeViewportEvents(session_id)
        await endSessionTransaction(session_id)
      }
    }
    if (useTransaction) {
      await notifyChangedViewports(session_id)
    }
  }
  return result
}
