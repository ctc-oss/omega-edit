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
 * Delete a number of bytes at the given offset
 * @param session_id session to make the change in
 * @param offset location offset to make the change
 * @param len number of bytes to delete
 * @return positive change serial number
 * @remarks function is named del because delete is a keyword
 */
export function del(
  session_id: string,
  offset: number,
  len: number
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let request = new ChangeRequest().setSessionId(session_id).setOffset(offset)
    request.setKind(ChangeKind.CHANGE_DELETE)
    request.setLength(len)
    getClient().submitChange(request, (err, r) => {
      if (err) {
        console.error(err)
        return reject(new Error('del failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        return reject(new Error('del failed'))
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
  data: string | Uint8Array
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let request = new ChangeRequest().setSessionId(session_id).setOffset(offset)
    request.setKind(ChangeKind.CHANGE_INSERT)
    request.setData(typeof data === 'string' ? Buffer.from(data) : data)
    getClient().submitChange(request, (err, r) => {
      if (err) {
        console.error(err)
        return reject(new Error('insert failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        return reject(new Error('insert failed'))
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
  data: string | Uint8Array
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let request = new ChangeRequest().setSessionId(session_id).setOffset(offset)
    request.setKind(ChangeKind.CHANGE_OVERWRITE)
    request.setData(typeof data === 'string' ? Buffer.from(data) : data)
    getClient().submitChange(request, (err, r) => {
      if (err) {
        console.error(err)
        return reject(new Error('overwrite failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        return reject(new Error('overwrite failed'))
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
 * @param replacement replacement bytes
 * @return positive change serial number of the insert on success
 */
export function replace(
  session_id: string,
  offset: number,
  remove_bytes_count: number,
  replacement: string | Uint8Array
): Promise<number> {
  // if no bytes are being removed, this is an insert
  if (remove_bytes_count === 0) {
    return insert(session_id, offset, replacement)
  }
  // if no bytes are being inserted, this is a delete
  else if (replacement.length === 0) {
    return del(session_id, offset, remove_bytes_count)
  }
  // if the number of bytes being removed is the same as the number of
  // replacement bytes, this is an overwrite
  else if (replacement.length === remove_bytes_count) {
    return overwrite(session_id, offset, replacement)
  }
  // otherwise, this is a replace (delete and insert)
  return new Promise<number>(async (resolve) => {
    await del(session_id, offset, remove_bytes_count)
    return resolve(await insert(session_id, offset, replacement))
  })
}

/**
 * Undo the last change made in the given session
 * @param session_id session to undo the last change for
 * @return negative serial number of the undone change if successful
 */
export function undo(session_id: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    getClient().undoLastChange(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.error(err)
        return reject(new Error('undo failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        return reject(new Error('undo failed'))
      }
      return resolve(serial)
    })
  })
}

/**
 * Redoes the last undo (if available)
 * @param session_id session to redo the last undo for
 * @return positive serial number of the redone change if successful
 */
export function redo(session_id: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    getClient().redoLastUndo(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.error(err)
        return reject(new Error('redo failed: ' + err))
      }
      const serial = r.getSerial()
      if (0 === serial) {
        return reject(new Error('redo failed'))
      }
      return resolve(serial)
    })
  })
}

/**
 * Clear all active changes in the given session
 * @param session_id session to clear all changes for
 * @return cleared session ID on success
 */
export function clear(session_id: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    getClient().clearChanges(new ObjectId().setId(session_id), (err, r) => {
      if (err) {
        console.error(err)
        return reject(new Error('clear failed: ' + err))
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
