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
  CountKind,
  type CreateViewportRequest,
  type CreateViewportResponse,
  type GetCountResponse,
  type GetViewportDataResponse,
  type ModifyViewportRequest,
} from './generated/omega_edit/v1/omega_edit'
import { debugLog, getLogger } from '../logger'
import { getClient } from '../client'
import { getSingleId, getUnsubscribeTimeoutMs, makeWrappedError } from './utils'

function getFirstCount(response: GetCountResponse, fn: string): number {
  const count = response.counts[0]?.count
  if (count === undefined) {
    throw new Error(`${fn} failed: empty count response`)
  }
  return count
}

export async function createViewport(
  desiredViewportId: string | undefined,
  sessionId: string,
  offset: number,
  capacity: number,
  isFloating: boolean = false
): Promise<CreateViewportResponse> {
  const log = getLogger()
  const request: CreateViewportRequest = {
    sessionId: sessionId,
    offset: offset,
    capacity: capacity,
    isFloating: isFloating,
  }

  if (desiredViewportId !== undefined && desiredViewportId.length > 0) {
    request.viewportIdDesired = desiredViewportId
  }

  debugLog(log, () => ({ fn: 'protobufTs.createViewport', rqst: request }))
  const client = await getClient()

  return new Promise<CreateViewportResponse>((resolve, reject) => {
    client.createViewport(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.createViewport',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('createViewport', err))
      }

      if (!response) {
        return reject(makeWrappedError('createViewport', 'empty response'))
      }

      debugLog(log, () => ({ fn: 'protobufTs.createViewport', resp: response }))
      return resolve(response)
    })
  })
}

export async function modifyViewport(
  viewportId: string,
  offset: number,
  capacity: number,
  isFloating: boolean = false
): Promise<GetViewportDataResponse> {
  const log = getLogger()
  const request: ModifyViewportRequest = {
    viewportId: viewportId,
    offset: offset,
    capacity: capacity,
    isFloating: isFloating,
  }

  debugLog(log, () => ({ fn: 'protobufTs.modifyViewport', rqst: request }))
  const client = await getClient()

  return new Promise<GetViewportDataResponse>((resolve, reject) => {
    client.modifyViewport(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.modifyViewport',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('modifyViewport', err))
      }

      if (!response) {
        return reject(makeWrappedError('modifyViewport', 'empty response'))
      }

      debugLog(log, () => ({ fn: 'protobufTs.modifyViewport', resp: response }))
      return resolve(response)
    })
  })
}

export async function destroyViewport(viewportId: string): Promise<string> {
  const log = getLogger()
  const request = { id: viewportId }
  debugLog(log, () => ({ fn: 'protobufTs.destroyViewport', rqst: request }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    client.destroyViewport(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.destroyViewport',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('destroyViewport', err))
      }

      if (!response) {
        return reject(makeWrappedError('destroyViewport', 'empty response'))
      }

      debugLog(log, () => ({
        fn: 'protobufTs.destroyViewport',
        resp: response,
      }))
      return resolve(getSingleId(response, 'destroyViewport'))
    })
  })
}

export async function getViewportCount(sessionId: string): Promise<number> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    kind: [CountKind.VIEWPORTS],
  }
  debugLog(log, () => ({ fn: 'protobufTs.getViewportCount', rqst: request }))
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.getCount(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getViewportCount',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('getViewportCount', err))
      }

      if (!response) {
        return reject(makeWrappedError('getViewportCount', 'empty response'))
      }

      debugLog(log, () => ({
        fn: 'protobufTs.getViewportCount',
        resp: response,
      }))
      return resolve(getFirstCount(response, 'getViewportCount'))
    })
  })
}

export async function getViewportData(
  viewportId: string
): Promise<GetViewportDataResponse> {
  const log = getLogger()
  const request = { viewportId: viewportId }
  debugLog(log, () => ({ fn: 'protobufTs.getViewportData', rqst: request }))
  const client = await getClient()

  return new Promise<GetViewportDataResponse>((resolve, reject) => {
    client.getViewportData(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getViewportData',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('getViewportData', err))
      }

      if (!response) {
        return reject(makeWrappedError('getViewportData', 'empty response'))
      }

      debugLog(log, () => ({
        fn: 'protobufTs.getViewportData',
        resp: response,
      }))
      return resolve(response)
    })
  })
}

export async function viewportHasChanges(viewportId: string): Promise<boolean> {
  const log = getLogger()
  const request = { id: viewportId }
  debugLog(log, () => ({
    fn: 'protobufTs.viewportHasChanges',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<boolean>((resolve, reject) => {
    client.viewportHasChanges(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.viewportHasChanges',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('viewportHasChanges', err))
      }

      if (!response) {
        return reject(makeWrappedError('viewportHasChanges', 'empty response'))
      }

      debugLog(log, () => ({
        fn: 'protobufTs.viewportHasChanges',
        resp: response,
      }))
      return resolve(response.result)
    })
  })
}

export async function pauseViewportEvents(sessionId: string): Promise<string> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.pauseViewportEvents',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    client.pauseViewportEvents(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.pauseViewportEvents',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('pauseViewportEvents', err))
      }

      if (!response) {
        return reject(makeWrappedError('pauseViewportEvents', 'empty response'))
      }

      debugLog(log, () => ({
        fn: 'protobufTs.pauseViewportEvents',
        resp: response,
      }))
      return resolve(getSingleId(response, 'pauseViewportEvents'))
    })
  })
}

export async function resumeViewportEvents(sessionId: string): Promise<string> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.resumeViewportEvents',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    client.resumeViewportEvents(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.resumeViewportEvents',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('resumeViewportEvents', err))
      }

      if (!response) {
        return reject(makeWrappedError('resumeViewportEvents', 'empty response'))
      }

      debugLog(log, () => ({
        fn: 'protobufTs.resumeViewportEvents',
        resp: response,
      }))
      return resolve(getSingleId(response, 'resumeViewportEvents'))
    })
  })
}

export async function unsubscribeViewport(viewportId: string): Promise<string> {
  const log = getLogger()
  const request = { id: viewportId }
  debugLog(log, () => ({
    fn: 'protobufTs.unsubscribeViewport',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    const timeoutMs = getUnsubscribeTimeoutMs()
    let settled = false
    const timeout = setTimeout(() => {
      settleReject(makeWrappedError('unsubscribeViewport', `timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const settleResolve = (value: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }
    const settleReject = (reason: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(reason)
    }

    const call = client.unsubscribeToViewportEvents(
      request,
      (err, response) => {
        if (err) {
          log.error({
            fn: 'protobufTs.unsubscribeViewport',
            rqst: request,
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return settleReject(makeWrappedError('unsubscribeViewport', err))
        }

        if (!response) {
          return settleReject(makeWrappedError('unsubscribeViewport', 'empty response'))
        }

        debugLog(log, () => ({
          fn: 'protobufTs.unsubscribeViewport',
          resp: response,
        }))
        return settleResolve(getSingleId(response, 'unsubscribeViewport'))
      }
    )

    call.on('error', (err) => {
      if (!err.message.includes('Call cancelled')) {
        log.error(
          'protobufTs.unsubscribeViewport critical error: ' + err.message
        )
        settleReject(err)
        return
      }
      log.info('protobufTs.unsubscribeViewport error: ' + err.message)
    })
  })
}
