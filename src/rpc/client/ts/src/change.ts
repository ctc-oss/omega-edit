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
  CountKind,
  CountRequest,
  ObjectId,
} from './omega_edit_pb'
import { getClient } from './settings'

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
    let request = new ChangeRequest().setSessionId(session_id).setOffset(offset)
    request.setKind(ChangeKind.CHANGE_DELETE)
    request.setLength(len)
    getClient().submitChange(request, (err, r) => {
      if (err) {
        console.error(err)
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('del failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('del failed'))
      }
      if (stats) {
        ++stats.delete_count
      }
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
 * @remarks If editing data that could have embedded nulls, do not rely on
 * setting the length to 0 and have this function compute the length using
 * strlen, because it will be wrong.  Passing length 0 is a convenience for
 * testing and should not be used in production code.  In production code,
 * explicitly pass in the length.
 */
export function insert(
  session_id: string,
  offset: number,
  data: string | Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let request = new ChangeRequest().setSessionId(session_id).setOffset(offset)
    request.setKind(ChangeKind.CHANGE_INSERT)
    request.setData(typeof data === 'string' ? Buffer.from(data) : data)
    getClient().submitChange(request, (err, r) => {
      if (err) {
        console.error(err)
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('insert failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('insert failed'))
      }
      if (stats) {
        ++stats.insert_count
      }
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
 * @remarks If editing data that could have embedded nulls, do not rely on
 * setting the length to 0 and have this function compute the length using
 * strlen, because it will be wrong.  Passing length 0 is a convenience for
 * testing and should not be used in production code.  In production code,
 * explicitly pass in the length.
 */
export function overwrite(
  session_id: string,
  offset: number,
  data: string | Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let request = new ChangeRequest().setSessionId(session_id).setOffset(offset)
    request.setKind(ChangeKind.CHANGE_OVERWRITE)
    request.setData(typeof data === 'string' ? Buffer.from(data) : data)
    getClient().submitChange(request, (err, r) => {
      if (err) {
        console.error(err)
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('overwrite failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('overwrite failed'))
      }
      if (stats) {
        ++stats.overwrite_count
      }
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
  replacement: string | Uint8Array,
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
    await del(session_id, offset, remove_bytes_count, stats)
    return resolve(await insert(session_id, offset, replacement, stats))
  })
}

/**
 * Optimizes edit operations by removing common prefix and suffix
 * @param offset offset of original segment
 * @param original_segment original segment
 * @param edited_segment replacement segment
 * @returns [{offset: number, remove_bytes_count: number, replacement: string}] or null if no change is needed
 */
export function editOptimizer(
  offset: number,
  original_segment: Uint8Array,
  edited_segment: Uint8Array
):
  | [
      {
        offset: number
        remove_bytes_count: number
        replacement: Uint8Array
      }
    ]
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
      offset: offset + first_difference,
      // remove_bytes_count common suffix
      remove_bytes_count:
        original_segment.length - first_difference - last_difference,
      // remove_bytes_count common prefix
      replacement: edited_segment.slice(
        first_difference,
        edited_segment.length - last_difference
      ),
    },
  ]
}

/**
 * Convenience function for doing edit operations
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param original_segment original segment
 * @param edited_segment replacement segment
 * @param stats optional edit stats to update
 * @return positive change serial number of the edit operation on success
 */
export async function edit(
  session_id: string,
  offset: number,
  original_segment: Uint8Array,
  edited_segment: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  // optimize the replace operation
  const optimized_replacements = editOptimizer(
    offset,
    original_segment,
    edited_segment
  )
  let result = 0
  if (optimized_replacements) {
    for (let i = 0; i < optimized_replacements.length; ++i) {
      result = await replace(
        session_id,
        optimized_replacements[i].offset,
        optimized_replacements[i].remove_bytes_count,
        optimized_replacements[i].replacement,
        stats
      )
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
    getClient().undoLastChange(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.error(err)
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('undo failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('undo failed'))
      }
      if (stats) {
        ++stats.undo_count
      }
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
    getClient().redoLastUndo(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.error(err)
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('redo failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('redo failed'))
      }
      if (stats) {
        ++stats.redo_count
      }
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
    getClient().clearChanges(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.error(err)
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('clear failed: ' + err))
      }
      if (stats) {
        ++stats.clear_count
      }
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
    getClient().getLastChange(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.error(err)
        return reject(new Error('getLastChange failed: ' + err))
      }
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
    getClient().getLastUndo(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.error(err)
        return reject(new Error('getLastUndo failed: ' + err))
      }
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
    getClient().getCount(
      new CountRequest()
        .setSessionId(session_id)
        .setKind(CountKind.COUNT_CHANGES),
      (err, r) => {
        if (err) {
          console.error(err)
          return reject(new Error('getChangeCount failed: ' + err))
        }
        return resolve(r.getCount())
      }
    )
  })
}

/**
 * Get the number of undone changes for a session
 * @param session_id session to get number of undone changes from
 * @return number of undone changes for the session, on success
 */
export function getUndoCount(session_id: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    getClient().getCount(
      new CountRequest()
        .setSessionId(session_id)
        .setKind(CountKind.COUNT_UNDOS),
      (err, r) => {
        if (err) {
          console.error(err)
          return reject(new Error('getUndoCount failed: ' + err))
        }
        return resolve(r.getCount())
      }
    )
  })
}
