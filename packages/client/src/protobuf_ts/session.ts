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

import type {
  CreateSessionRequest as CreateSessionRequestMessage,
  CreateSessionResponse,
  GetSegmentRequest as GetSegmentRequestMessage,
  SearchSessionRequest as SearchSessionRequestMessage,
} from './generated/omega_edit/v1/omega_edit'
import { debugLog, getLogger } from '../logger'
import { getClient } from './client'

export async function createSession(
  filePath: string = '',
  sessionIdDesired: string = '',
  checkpointDirectory: string = ''
): Promise<CreateSessionResponse> {
  const log = getLogger()
  const request: CreateSessionRequestMessage = {}

  if (filePath.length > 0) request.filePath = filePath
  if (sessionIdDesired.length > 0) request.sessionIdDesired = sessionIdDesired
  if (checkpointDirectory.length > 0)
    request.checkpointDirectory = checkpointDirectory

  debugLog(log, () => ({ fn: 'protobufTs.createSession', rqst: request }))
  const client = await getClient()

  return new Promise<CreateSessionResponse>((resolve, reject) => {
    client.createSession(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.createSession',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('createSession error: ' + err.message)
      }

      if (!response) {
        return reject('createSession error: empty response')
      }

      debugLog(log, () => ({
        fn: 'protobufTs.createSession',
        resp: response,
      }))
      return resolve(response)
    })
  })
}

export async function destroySession(sessionId: string): Promise<string> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({ fn: 'protobufTs.destroySession', rqst: request }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    client.destroySession(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.destroySession',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('destroySession error: ' + err.message)
      }

      if (!response) {
        return reject('destroySession error: empty response')
      }

      debugLog(log, () => ({
        fn: 'protobufTs.destroySession',
        resp: response,
      }))
      return resolve(response.id)
    })
  })
}

export async function getSessionCount(): Promise<number> {
  const log = getLogger()
  log.debug({ fn: 'protobufTs.getSessionCount' })
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.getSessionCount({}, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getSessionCount',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('getSessionCount error: ' + err.message)
      }

      if (!response) {
        return reject('getSessionCount error: empty response')
      }

      debugLog(log, () => ({
        fn: 'protobufTs.getSessionCount',
        resp: response,
      }))
      return resolve(response.count)
    })
  })
}

export async function getSegment(
  sessionId: string,
  offset: number,
  length: number
): Promise<Uint8Array> {
  const log = getLogger()
  const request: GetSegmentRequestMessage = {
    sessionId: sessionId,
    offset: offset,
    length: length,
  }

  debugLog(log, () => ({ fn: 'protobufTs.getSegment', rqst: request }))
  const client = await getClient()

  return new Promise<Uint8Array>((resolve, reject) => {
    client.getSegment(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getSegment',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('getSegment error: ' + err.message)
      }

      if (!response) {
        return reject('getSegment error: empty response')
      }

      debugLog(log, () => ({ fn: 'protobufTs.getSegment', resp: response }))
      return resolve(response.data)
    })
  })
}

export async function searchSession(
  sessionId: string,
  pattern: string | Uint8Array,
  isCaseInsensitive: boolean = false,
  isReverse: boolean = false,
  offset: number = 0,
  length: number = 0,
  limit: number = 0
): Promise<number[]> {
  const log = getLogger()

  if (pattern.length === 0) {
    log.warn({
      fn: 'protobufTs.searchSession',
      err: { msg: 'empty pattern given' },
    })
    return []
  }

  const request: SearchSessionRequestMessage = {
    sessionId: sessionId,
    pattern: typeof pattern === 'string' ? Buffer.from(pattern) : pattern,
  }

  if (isCaseInsensitive) request.isCaseInsensitive = true
  if (isReverse) request.isReverse = true
  if (offset > 0) request.offset = offset
  if (length > 0) request.length = length
  if (limit > 0) request.limit = limit

  debugLog(log, () => ({ fn: 'protobufTs.searchSession', rqst: request }))
  const client = await getClient()

  return new Promise<number[]>((resolve, reject) => {
    client.searchSession(request, (err, response) => {
      if (err) {
        return reject('searchSession error: ' + err.message)
      }

      if (!response) {
        return reject('searchSession error: empty response')
      }

      debugLog(log, () => ({
        fn: 'protobufTs.searchSession',
        resp: response,
      }))
      return resolve(response.matchOffset)
    })
  })
}
