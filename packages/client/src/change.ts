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
  ChangeDetailsResponse,
  ChangeKind,
  ChangeRequest,
  ChangeResponse,
  CountKind,
  CountRequest,
  CountResponse,
  ObjectId,
} from './omega_edit_pb'
import { getClient } from './client'
import { getLogger } from './logger'
import {
  beginSessionTransaction,
  endSessionTransaction,
  notifyChangedViewports,
} from './session'
import { pauseViewportEvents, resumeViewportEvents } from './viewport'
export { ChangeKind } from './omega_edit_pb'

/**
 * IEditStats is an interface to keep track of the number of different kinds of edits
 */
export interface IEditStats {
  delete_count: number //number of deletes
  insert_count: number //number of inserts
  overwrite_count: number //number of overwrites
  undo_count: number //number of undos
  redo_count: number //number of redos
  clear_count: number //number of clears
  error_count: number //number of errors
}

/**
 * EditStats is a simple class to keep track of the number of different kinds of edits
 */
export class EditStats implements IEditStats {
  delete_count: number //number of deletes
  insert_count: number //number of inserts
  overwrite_count: number //number of overwrites
  undo_count: number //number of undos
  redo_count: number //number of redos
  clear_count: number //number of clears
  error_count: number //number of errors

  /**
   * Create a new EditStats object
   */
  constructor() {
    this.delete_count = 0
    this.insert_count = 0
    this.overwrite_count = 0
    this.undo_count = 0
    this.redo_count = 0
    this.clear_count = 0
    this.error_count = 0
  }

  /**
   * Reset all the counters to zero
   */
  reset(): void {
    this.delete_count = 0
    this.insert_count = 0
    this.overwrite_count = 0
    this.undo_count = 0
    this.redo_count = 0
    this.clear_count = 0
    this.error_count = 0
  }
}

/**
 * Delete a number of bytes at the given offset
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param len number of bytes to delete
 * @param stats optional edit stats to update
 * @return positive change serial number
 * @remarks function is named del because delete is a keyword
 */
export function del(
  session_id: string,
  offset: number,
  len: number,
  stats?: IEditStats
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = new ChangeRequest()
      .setSessionId(session_id)
      .setKind(ChangeKind.CHANGE_DELETE)
      .setOffset(offset)
      .setLength(len)
    getLogger().debug({ fn: 'del', rqst: request.toObject() })
    getClient().submitChange(request, (err, r: ChangeResponse) => {
      if (err) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'del',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('del failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'del',
          err: { resp: r.toObject() },
        })
        return reject(new Error('del failed'))
      }
      if (stats) {
        ++stats.delete_count
      }
      getLogger().debug({ fn: 'del', resp: r.toObject() })
      return resolve(serial)
    })
  })
}

/**
 * Insert a number of bytes at the given offset
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param data bytes to insert at the given offset
 * @param stats optional edit stats to update
 * @return positive change serial number on success
 */
export function insert(
  session_id: string,
  offset: number,
  data: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = new ChangeRequest()
      .setSessionId(session_id)
      .setKind(ChangeKind.CHANGE_INSERT)
      .setOffset(offset)
      .setData(data)
      .setLength(data.length)
    getLogger().debug({ fn: 'insert', rqst: request.toObject() })
    getClient().submitChange(request, (err, r: ChangeResponse) => {
      if (err) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'insert',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('insert failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'insert',
          err: { resp: r.toObject() },
        })
        return reject(new Error('insert failed'))
      }
      if (stats) {
        ++stats.insert_count
      }
      getLogger().debug({ fn: 'insert', resp: r.toObject() })
      return resolve(serial)
    })
  })
}

/**
 * Overwrite bytes at the given offset with the given new bytes
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param data new bytes to overwrite the old bytes with
 * @param stats optional edit stats to update
 * @return positive change serial number on success, zero otherwise
 */
export function overwrite(
  session_id: string,
  offset: number,
  data: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = new ChangeRequest()
      .setSessionId(session_id)
      .setKind(ChangeKind.CHANGE_OVERWRITE)
      .setOffset(offset)
      .setData(data)
      .setLength(data.length)
    getLogger().debug({ fn: 'overwrite', rqst: request.toObject() })
    getClient().submitChange(request, (err, r: ChangeResponse) => {
      if (err) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'overwrite',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('overwrite failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'overwrite',
          err: { resp: r.toObject() },
        })
        return reject(new Error('overwrite failed'))
      }
      if (stats) {
        ++stats.overwrite_count
      }
      getLogger().debug({ fn: 'overwrite', resp: r.toObject() })
      return resolve(serial)
    })
  })
}

/**
 * Convenience function for doing replace operations
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param remove_bytes_count number of bytes to remove
 * @param stats optional edit stats to update
 * @param replacement replacement bytes
 * @return positive change serial number of the insert on success
 */
export function replace(
  session_id: string,
  offset: number,
  remove_bytes_count: number,
  replacement: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  // if no bytes are being removed, this is an insert
  if (remove_bytes_count === 0) {
    return insert(session_id, offset, replacement, stats)
  }
  // if no bytes are being inserted, this is a delete
  else if (replacement.length === 0) {
    return del(session_id, offset, remove_bytes_count, stats)
  }
  // if the number of bytes being removed is the same as the number of
  // replacement bytes, this is an overwrite
  else if (replacement.length === remove_bytes_count) {
    return overwrite(session_id, offset, replacement, stats)
  }
  // otherwise, this is a replace (delete and insert)
  return new Promise<number>(async (resolve) => {
    // wrap the delete and insert in a transaction
    await beginSessionTransaction(session_id)
    await del(session_id, offset, remove_bytes_count, stats)
    const result = await insert(session_id, offset, replacement, stats)
    await endSessionTransaction(session_id)
    resolve(result)
  })
}

/**
 * Optimizes edit operations by removing common prefix and suffix
 * @param original_segment original segment
 * @param edited_segment replacement segment
 * @param offset start offset of the segments in the file
 * @returns [{offset: number, remove_bytes_count: number, replacement: Uint8Array}] or null if no change is needed
 */
export function editOptimizer(
  original_segment: Uint8Array,
  edited_segment: Uint8Array,
  offset: number = 0
):
  | [{ offset: number; remove_bytes_count: number; replacement: Uint8Array }]
  | null {
  let first_difference = 0 // offset of first difference
  let last_difference = 0 // offset of last difference

  // find offset of first difference
  while (
    first_difference < original_segment.length &&
    first_difference < edited_segment.length &&
    original_segment[first_difference] === edited_segment[first_difference]
  ) {
    ++first_difference
  }

  // no change if no difference
  if (
    first_difference === original_segment.length &&
    first_difference === edited_segment.length
  ) {
    return null
  }

  // find offset of last difference
  while (
    last_difference < original_segment.length - first_difference &&
    last_difference < edited_segment.length - first_difference &&
    original_segment[original_segment.length - 1 - last_difference] ===
      edited_segment[edited_segment.length - 1 - last_difference]
  ) {
    ++last_difference
  }

  // return optimized replacements
  return [
    {
      // original offset plus the length of the common prefix
      offset: offset + first_difference,
      // original length minus the length of the common prefix and suffix
      remove_bytes_count:
        original_segment.length - first_difference - last_difference,
      // edited segment without the common prefix and suffix
      replacement: edited_segment.slice(
        first_difference,
        edited_segment.length - last_difference
      ),
    },
  ]
}

/**
 * Convenience function for doing edit operations that uses a simple edit optimizer
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param original_segment original segment
 * @param edited_segment replacement segment
 * @param stats optional edit stats to update
 * @return positive change serial number of the edit operation on success
 * @remarks Does not disable/enable viewport events, so this is suitable for bulk edit operations where events are
 * controlled by the caller
 */
export async function editSimple(
  session_id: string,
  offset: number,
  original_segment: Uint8Array,
  edited_segment: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  // optimize the replace operation
  const optimized_replacements = editOptimizer(
    original_segment,
    edited_segment,
    offset
  )
  let result = 0
  if (optimized_replacements) {
    // if there are multiple optimized replacements, begin a transaction
    if (1 < optimized_replacements.length) {
      await beginSessionTransaction(session_id)
    }
    for (let i = 0; i < optimized_replacements.length; ++i) {
      result = await replace(
        session_id,
        optimized_replacements[i].offset,
        optimized_replacements[i].remove_bytes_count,
        optimized_replacements[i].replacement,
        stats
      )
    }
    // if there were multiple optimized replacements, end the transaction
    if (1 < optimized_replacements.length) {
      await endSessionTransaction(session_id)
    }
  }
  return Promise.resolve(result)
}

/**
 * Undo the last change made in the given session
 * @param session_id session to undo the last change for
 * @param stats optional edit stats to update
 * @return negative serial number of the undone change if successful
 */
export function undo(session_id: string, stats?: IEditStats): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = new ObjectId().setId(session_id)
    getLogger().debug({ fn: 'undo', rqst: request.toObject() })
    getClient().undoLastChange(request, (err, r: ChangeResponse) => {
      if (err) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'undo',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('undo failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'undo',
          err: { resp: r.toObject() },
        })
        return reject(new Error('undo failed'))
      }
      if (stats) {
        ++stats.undo_count
      }
      getLogger().debug({ fn: 'undo', resp: r.toObject() })
      return resolve(serial)
    })
  })
}

/**
 * Redoes the last undo (if available)
 * @param session_id session to redo the last undo for
 * @param stats optional edit stats to update
 * @return positive serial number of the redone change if successful
 */
export function redo(session_id: string, stats?: IEditStats): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = new ObjectId().setId(session_id)
    getLogger().debug({ fn: 'redo', rqst: request.toObject() })
    getClient().redoLastUndo(request, (err, r: ChangeResponse) => {
      if (err) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'redo',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('redo failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'redo',
          err: { resp: r.toObject() },
        })
        return reject(new Error('redo failed'))
      }
      if (stats) {
        ++stats.redo_count
      }
      getLogger().debug({ fn: 'redo', resp: r.toObject() })
      return resolve(serial)
    })
  })
}

/**
 * Clear all active changes in the given session
 * @param session_id session to clear all changes for
 * @param stats optional edit stats to update
 * @return cleared session ID on success
 */
export function clear(session_id: string, stats?: IEditStats): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const request = new ObjectId().setId(session_id)
    getLogger().debug({ fn: 'clear', rqst: request.toObject() })
    getClient().clearChanges(request, (err, r: ObjectId) => {
      if (err) {
        if (stats) {
          ++stats.error_count
        }
        getLogger().error({
          fn: 'clear',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('clear failed: ' + err))
      }
      if (stats) {
        ++stats.clear_count
      }
      getLogger().debug({ fn: 'clear', resp: r.toObject() })
      return resolve(r.getId())
    })
  })
}

/**
 * Get the last change (if any) from a session
 * @param session_id session to get the last change from
 * @return last change details
 */
export function getLastChange(
  session_id: string
): Promise<ChangeDetailsResponse> {
  return new Promise<ChangeDetailsResponse>((resolve, reject) => {
    const request = new ObjectId().setId(session_id)
    getLogger().debug({ fn: 'getLastChange', rqst: request.toObject() })
    getClient().getLastChange(request, (err, r: ChangeDetailsResponse) => {
      if (err) {
        getLogger().error({
          fn: 'getLastChange',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getLastChange failed: ' + err))
      }
      getLogger().debug({ fn: 'getLastChange', resp: r.toObject() })
      return resolve(r)
    })
  })
}

/**
 * Get the last undone change (if any) from a session
 * @param session_id session to get the last undone change from
 * @return last undone change details
 */
export function getLastUndo(
  session_id: string
): Promise<ChangeDetailsResponse> {
  return new Promise<ChangeDetailsResponse>((resolve, reject) => {
    const request = new ObjectId().setId(session_id)
    getLogger().debug({ fn: 'getLastUndo', rqst: request.toObject() })
    getClient().getLastUndo(request, (err, r: ChangeDetailsResponse) => {
      if (err) {
        getLogger().error({
          fn: 'getLastUndo',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getLastUndo failed: ' + err))
      }
      getLogger().debug({ fn: 'getLastUndo', resp: r.toObject() })
      return resolve(r)
    })
  })
}

/**
 * Get the number of active changes for a session
 * @param session_id session to get number of active changes from
 * @return number of active changes for the session, on success
 */
export function getChangeCount(session_id: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request: CountRequest = new CountRequest()
      .setSessionId(session_id)
      .setKindList([CountKind.COUNT_CHANGES])
    getLogger().debug({ fn: 'getChangeCount', rqst: request.toObject() })
    getClient().getCount(request, (err, r: CountResponse) => {
      if (err) {
        getLogger().error({
          fn: 'getChangeCount',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getChangeCount failed: ' + err))
      }
      getLogger().debug({ fn: 'getChangeCount', resp: r.toObject() })
      return resolve(r.getCountsList()[0].getCount())
    })
  })
}

/**
 * Get the number of undone changes for a session
 * @param session_id session to get number of undone changes from
 * @return number of undone changes for the session, on success
 */
export function getUndoCount(session_id: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = new CountRequest()
      .setSessionId(session_id)
      .setKindList([CountKind.COUNT_UNDOS])
    getLogger().debug({ fn: 'getUndoCount', rqst: request.toObject() })
    getClient().getCount(request, (err, r: CountResponse) => {
      if (err) {
        getLogger().error({
          fn: 'getUndoCount',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getUndoCount failed: ' + err))
      }
      getLogger().debug({ fn: 'getUndoCount', resp: r.toObject() })
      return resolve(r.getCountsList()[0].getCount())
    })
  })
}

/**
 * Get the number of change transactions for a session
 * @param session_id session to get number of change transactions from
 * @return number of change transactions for the session, on success
 */
export function getChangeTransactionCount(session_id: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = new CountRequest()
      .setSessionId(session_id)
      .setKindList([CountKind.COUNT_CHANGE_TRANSACTIONS])
    getLogger().debug({
      fn: 'getChangeTransactionCount',
      rqst: request.toObject(),
    })
    getClient().getCount(request, (err, r: CountResponse) => {
      if (err) {
        getLogger().error({
          fn: 'getChangeTransactionCount',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getChangeTransactionCount failed: ' + err))
      }
      getLogger().debug({ fn: 'getChangeTransactionCount', resp: r.toObject() })
      return resolve(r.getCountsList()[0].getCount())
    })
  })
}

/**
 * Get the number of undo transactions for a session
 * @param session_id session to get number of undo transactions from
 * @return number of undo transactions for the session, on success
 */
export function getUndoTransactionCount(session_id: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = new CountRequest()
      .setSessionId(session_id)
      .setKindList([CountKind.COUNT_UNDO_TRANSACTIONS])
    getLogger().debug({
      fn: 'getUndoTransactionCount',
      rqst: request.toObject(),
    })
    getClient().getCount(request, (err, r: CountResponse) => {
      if (err) {
        getLogger().error({
          fn: 'getUndoTransactionCount',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getUndoTransactionCount failed: ' + err))
      }
      getLogger().debug({ fn: 'getUndoTransactionCount', resp: r.toObject() })
      return resolve(r.getCountsList()[0].getCount())
    })
  })
}

/**
 * Concatenate two Uint8Arrays
 * @param arr1 first array
 * @param arr2 second array
 * @return concatenated array
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
 * Remove the common suffix from two Uint8Arrays
 * @param arr1 first array
 * @param arr2 second array
 * @return an array containing the two arrays with the common suffix removed
 */
export function removeCommonSuffix(
  arr1: Uint8Array,
  arr2: Uint8Array
): [Uint8Array, Uint8Array] {
  let i = arr1.length - 1
  let j = arr2.length - 1

  // Iterate backwards over both arrays until a non-matching index is found
  while (i >= 0 && j >= 0 && arr1[i] === arr2[j]) {
    i--
    j--
  }

  // Return a subarray of edited that starts at the beginning and goes up to the non-matching index
  return [arr1.subarray(0, i + 1), arr2.subarray(0, j + 1)]
}

/**
 * Edit operation types
 */
export enum EditOperationType {
  Delete = 'delete', // delete operation
  Insert = 'insert', // insert operation
  Overwrite = 'overwrite', // overwrite operation
}

export interface EditOperation {
  type: EditOperationType // type of edit operation
  start: number // offset where the edit starts

  // additional fields depending on the type of operation
  // for delete operations, the length of bytes to be deleted is needed
  // for insert and overwrite operations, the data to be inserted or used for overwriting is needed
  length?: number // number of bytes to remove in the case of a delete operation
  data?: Uint8Array // data to be inserted or used for overwriting
}

/**
 * The algorithm used in this function is an implementation of the Levenshtein distance algorithm, also known as the
 * edit distance algorithm.
 *
 * Given two input arrays originalSegment and editedSegment, the function calculates the minimum number of "edit
 * operations" required to transform originalSegment into editedSegment, where an "edit operation" can be an insertion,
 * deletion, or overwrite of an element in originalSegment.
 *
 * The algorithm does this by iterating through each element in originalSegment and editedSegment, and checking if they
 * are the same. If they are different, the algorithm determines whether an overwrite or delete/insert operation is
 * needed.
 *
 * During the iteration, if an overwrite operation is needed, and the previous operation was also an overwrite operation
 * that can be merged with the current operation, the algorithm merges the two overwrite operations into a single one.
 * Similarly, if two adjacent operations are of the same type (i.e. both delete or both insert), the algorithm merges
 * them into a single operation to improve efficiency.
 *
 * The output of the function is an array of EditOperation objects, where each object represents an edit operation that
 * needs to be performed on originalSegment to transform it into editedSegment.
 *
 * The purpose of the editOperations function is to determine the minimal, most and efficient, set of edit operations
 * required to transform one Uint8Array into another. The function takes in two Uint8Arrays as input, and returns an
 * array of EditOperation objects, where each EditOperation represents an insertion, deletion, or overwrite of a range
 * of bytes in the input array. The returned set of edit operations is the smallest set possible to transform the input
 * array into the target array.
 * @param originalSegment original segment
 * @param editedSegment edited segment
 * @param offset offset of the segments
 * @return array of EditOperation objects necessary to transform  the originalSegment into the editedSegment
 */
export function editOperations(
  originalSegment: Uint8Array,
  editedSegment: Uint8Array,
  offset: number = 0
): EditOperation[] {
  if (originalSegment.length === 0) {
    // if both segments are empty, then there are no edit operations to perform
    if (editedSegment.length === 0) {
      return []
    }
    // if the original segment is empty, insert the entire edited segment at the given offset
    return [
      {
        type: EditOperationType.Insert,
        start: offset,
        data: editedSegment,
      },
    ]
  }
  if (editedSegment.length === 0) {
    // if the edited segment is empty, delete the entire original segment at the given offset
    return [
      {
        type: EditOperationType.Delete,
        start: offset,
        length: originalSegment.length,
      },
    ]
  }
  // remove the common suffix from the two arrays
  ;[originalSegment, editedSegment] = removeCommonSuffix(
    originalSegment,
    editedSegment
  )
  const len1 = originalSegment.length
  const len2 = editedSegment.length
  const maxLen = Math.max(len1, len2)
  const operations: EditOperation[] = [] // the array to hold the edit operations

  let previousOp: EditOperation | undefined // keep track of previous edit operation

  // iterate over the arrays, comparing elements
  for (let i = 0; i < maxLen; i++) {
    if (i < len1 && i < len2) {
      // if both arrays still have elements
      if (originalSegment[i] !== editedSegment[i]) {
        // if the elements differ
        if (
          previousOp &&
          previousOp.type === EditOperationType.Overwrite &&
          previousOp.start + previousOp.data!.length === i
        ) {
          // Coalesce adjacent overwrite operations
          previousOp.data = concatUint8Arrays(
            previousOp.data!,
            new Uint8Array([editedSegment[i]])
          )
        } else {
          // create a new overwrite operation
          operations.push({
            type: EditOperationType.Overwrite,
            start: offset + i,
            data: new Uint8Array([editedSegment[i]]),
          })
          previousOp = operations[operations.length - 1]
        }
      }
    } else if (i < len1) {
      // if originalSegment still has elements
      // create a delete operation
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
      break // break the loop as we've reached the end of the arrays
    } else {
      // if editedSegment still has elements
      // create an insert operation
      operations.push({
        type: EditOperationType.Insert,
        start: offset + i,
        data: editedSegment.subarray(i),
      })
      previousOp = operations[operations.length - 1]
      break // break the loop as we've reached the end of the arrays
    }
  }

  // Coalesce adjacent operations of the same type
  for (let k = 0; k < operations.length - 1; k++) {
    const op = operations[k]
    const nextOp = operations[k + 1]

    if (
      op.type === nextOp.type &&
      op.start + (op.length ?? op.data!.length) === nextOp.start
    ) {
      if (op.type === EditOperationType.Overwrite) {
        // coalesce overwrite operations
        op.data = concatUint8Arrays(op.data!, nextOp.data!)
        op.length = undefined
      } else {
        // coalesce delete or insert operations
        op.length =
          (op.length ?? op.data!.length) +
          (nextOp.length ?? nextOp.data!.length)
      }
      operations.splice(k + 1, 1) // remove the next operation from the array
      k-- // decrement k so we don't skip the next operation
    } else if (
      op.type === EditOperationType.Delete &&
      nextOp.type === EditOperationType.Delete &&
      op.start + (op.length ?? 0) === nextOp.start
    ) {
      // coalesce delete operations
      op.length = (op.length ?? 0) + nextOp.length!
      operations.splice(k + 1, 1)
      k--
    } else if (
      // coalesce insert operations
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

/**
 * Edit a segment in a session, efficiently turning the original segment into the edited segment.
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param original_segment original segment
 * @param edited_segment replacement segment
 * @param stats optional edit stats to update
 * @return positive change serial number of the last edit operation on success
 */
export async function edit(
  session_id: string,
  offset: number,
  original_segment: Uint8Array,
  edited_segment: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  // optimize the replace operation
  const optimized_edits = editOperations(
    original_segment,
    edited_segment,
    offset
  )
  let result = 0
  if (optimized_edits) {
    // if there are multiple optimized replacements, begin a transaction
    if (1 < optimized_edits.length) {
      await beginSessionTransaction(session_id)
      await pauseViewportEvents(session_id)
    }
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
    // if there were multiple optimized replacements, end the transaction
    if (1 < optimized_edits.length) {
      await resumeViewportEvents(session_id)
      await endSessionTransaction(session_id)
      await notifyChangedViewports(session_id)
    }
  }
  return Promise.resolve(result)
}
