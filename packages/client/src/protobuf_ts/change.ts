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
  ChangeKind as ProtoChangeKind,
  CountKind,
  type GetCountResponse,
  type GetLastChangeResponse,
  type GetLastUndoResponse,
  type SubmitChangeRequest,
} from './generated/omega_edit/v1/omega_edit'
import { debugLog, getLogger } from '../logger'
import { getClient } from '../client'

export const ChangeKind = {
  UNSPECIFIED: ProtoChangeKind.UNSPECIFIED,
  DELETE: ProtoChangeKind.DELETE,
  INSERT: ProtoChangeKind.INSERT,
  OVERWRITE: ProtoChangeKind.OVERWRITE,
} as const

export interface IEditStats {
  delete_count: number
  insert_count: number
  overwrite_count: number
  undo_count: number
  redo_count: number
  clear_count: number
  error_count: number
}

export class EditStats implements IEditStats {
  delete_count = 0
  insert_count = 0
  overwrite_count = 0
  undo_count = 0
  redo_count = 0
  clear_count = 0
  error_count = 0

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

function getFirstCount(response: GetCountResponse, fn: string): number {
  const count = response.counts[0]?.count
  if (count === undefined) {
    throw new Error(`${fn} failed: empty count response`)
  }
  return count
}

async function submitChange(
  request: SubmitChangeRequest,
  fn: string,
  statKey: keyof Pick<
    IEditStats,
    'delete_count' | 'insert_count' | 'overwrite_count'
  >,
  stats?: IEditStats
): Promise<number> {
  const log = getLogger()
  debugLog(log, () => ({ fn: `protobufTs.${fn}`, rqst: request }))
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.submitChange(request, (err, response) => {
      if (err) {
        if (stats) {
          ++stats.error_count
        }
        log.error({
          fn: `protobufTs.${fn}`,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error(`${fn} failed: ${err}`))
      }

      if (!response) {
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error(`${fn} failed: empty response`))
      }

      const serial = response.serial
      if (serial === 0) {
        if (stats) {
          ++stats.error_count
        }
        log.error({
          fn: `protobufTs.${fn}`,
          err: { resp: response },
        })
        return reject(new Error(`${fn} failed`))
      }

      if (stats) {
        ++stats[statKey]
      }
      debugLog(log, () => ({ fn: `protobufTs.${fn}`, resp: response }))
      return resolve(serial)
    })
  })
}

export async function del(
  sessionId: string,
  offset: number,
  len: number,
  stats?: IEditStats
): Promise<number> {
  return submitChange(
    {
      sessionId: sessionId,
      kind: ProtoChangeKind.DELETE,
      offset: offset,
      length: len,
    },
    'del',
    'delete_count',
    stats
  )
}

export async function insert(
  sessionId: string,
  offset: number,
  data: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return submitChange(
    {
      sessionId: sessionId,
      kind: ProtoChangeKind.INSERT,
      offset: offset,
      data: data,
      length: data.length,
    },
    'insert',
    'insert_count',
    stats
  )
}

export async function overwrite(
  sessionId: string,
  offset: number,
  data: Uint8Array,
  stats?: IEditStats
): Promise<number> {
  return submitChange(
    {
      sessionId: sessionId,
      kind: ProtoChangeKind.OVERWRITE,
      offset: offset,
      data: data,
      length: data.length,
    },
    'overwrite',
    'overwrite_count',
    stats
  )
}

export async function undo(
  sessionId: string,
  stats?: IEditStats
): Promise<number> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({ fn: 'protobufTs.undo', rqst: request }))
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.undoLastChange(request, (err, response) => {
      if (err) {
        if (stats) {
          ++stats.error_count
        }
        log.error({
          fn: 'protobufTs.undo',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('undo failed: ' + err))
      }

      if (!response) {
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('undo failed: empty response'))
      }

      if (response.serial === 0) {
        if (stats) {
          ++stats.error_count
        }
        log.error({
          fn: 'protobufTs.undo',
          err: { resp: response },
        })
        return reject(new Error('undo failed'))
      }

      if (stats) {
        ++stats.undo_count
      }
      debugLog(log, () => ({ fn: 'protobufTs.undo', resp: response }))
      return resolve(response.serial)
    })
  })
}

export async function redo(
  sessionId: string,
  stats?: IEditStats
): Promise<number> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({ fn: 'protobufTs.redo', rqst: request }))
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.redoLastUndo(request, (err, response) => {
      if (err) {
        if (stats) {
          ++stats.error_count
        }
        log.error({
          fn: 'protobufTs.redo',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('redo failed: ' + err))
      }

      if (!response) {
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('redo failed: empty response'))
      }

      if (response.serial === 0) {
        if (stats) {
          ++stats.error_count
        }
        log.error({
          fn: 'protobufTs.redo',
          err: { resp: response },
        })
        return reject(new Error('redo failed'))
      }

      if (stats) {
        ++stats.redo_count
      }
      debugLog(log, () => ({ fn: 'protobufTs.redo', resp: response }))
      return resolve(response.serial)
    })
  })
}

export async function clear(
  sessionId: string,
  stats?: IEditStats
): Promise<string> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({ fn: 'protobufTs.clear', rqst: request }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    client.clearChanges(request, (err, response) => {
      if (err) {
        if (stats) {
          ++stats.error_count
        }
        log.error({
          fn: 'protobufTs.clear',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('clear failed: ' + err))
      }

      if (!response) {
        if (stats) {
          ++stats.error_count
        }
        return reject(new Error('clear failed: empty response'))
      }

      if (stats) {
        ++stats.clear_count
      }
      debugLog(log, () => ({ fn: 'protobufTs.clear', resp: response }))
      return resolve(response.id)
    })
  })
}

export async function getLastChange(
  sessionId: string
): Promise<GetLastChangeResponse> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({ fn: 'protobufTs.getLastChange', rqst: request }))
  const client = await getClient()

  return new Promise<GetLastChangeResponse>((resolve, reject) => {
    client.getLastChange(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getLastChange',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getLastChange failed: ' + err))
      }

      if (!response) {
        return reject(new Error('getLastChange failed: empty response'))
      }

      debugLog(log, () => ({
        fn: 'protobufTs.getLastChange',
        resp: response,
      }))
      return resolve(response)
    })
  })
}

export async function getLastUndo(
  sessionId: string
): Promise<GetLastUndoResponse> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({ fn: 'protobufTs.getLastUndo', rqst: request }))
  const client = await getClient()

  return new Promise<GetLastUndoResponse>((resolve, reject) => {
    client.getLastUndo(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getLastUndo',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getLastUndo failed: ' + err))
      }

      if (!response) {
        return reject(new Error('getLastUndo failed: empty response'))
      }

      debugLog(log, () => ({
        fn: 'protobufTs.getLastUndo',
        resp: response,
      }))
      return resolve(response)
    })
  })
}

export async function getChangeCount(sessionId: string): Promise<number> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    kind: [CountKind.CHANGES],
  }
  debugLog(log, () => ({ fn: 'protobufTs.getChangeCount', rqst: request }))
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.getCount(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getChangeCount',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getChangeCount failed: ' + err))
      }

      if (!response) {
        return reject(new Error('getChangeCount failed: empty response'))
      }

      debugLog(log, () => ({
        fn: 'protobufTs.getChangeCount',
        resp: response,
      }))
      return resolve(getFirstCount(response, 'getChangeCount'))
    })
  })
}

export async function getUndoCount(sessionId: string): Promise<number> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    kind: [CountKind.UNDOS],
  }
  debugLog(log, () => ({ fn: 'protobufTs.getUndoCount', rqst: request }))
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.getCount(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getUndoCount',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getUndoCount failed: ' + err))
      }

      if (!response) {
        return reject(new Error('getUndoCount failed: empty response'))
      }

      debugLog(log, () => ({
        fn: 'protobufTs.getUndoCount',
        resp: response,
      }))
      return resolve(getFirstCount(response, 'getUndoCount'))
    })
  })
}

export async function getChangeTransactionCount(
  sessionId: string
): Promise<number> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    kind: [CountKind.CHANGE_TRANSACTIONS],
  }
  debugLog(log, () => ({
    fn: 'protobufTs.getChangeTransactionCount',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.getCount(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getChangeTransactionCount',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getChangeTransactionCount failed: ' + err))
      }

      if (!response) {
        return reject(
          new Error('getChangeTransactionCount failed: empty response')
        )
      }

      debugLog(log, () => ({
        fn: 'protobufTs.getChangeTransactionCount',
        resp: response,
      }))
      return resolve(getFirstCount(response, 'getChangeTransactionCount'))
    })
  })
}

export async function getUndoTransactionCount(
  sessionId: string
): Promise<number> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    kind: [CountKind.UNDO_TRANSACTIONS],
  }
  debugLog(log, () => ({
    fn: 'protobufTs.getUndoTransactionCount',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.getCount(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getUndoTransactionCount',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(new Error('getUndoTransactionCount failed: ' + err))
      }

      if (!response) {
        return reject(
          new Error('getUndoTransactionCount failed: empty response')
        )
      }

      debugLog(log, () => ({
        fn: 'protobufTs.getUndoTransactionCount',
        resp: response,
      }))
      return resolve(getFirstCount(response, 'getUndoTransactionCount'))
    })
  })
}
