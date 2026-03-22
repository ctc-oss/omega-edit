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
  type CreateSessionRequest,
  type CreateSessionResponse,
  type GetByteFrequencyProfileResponse,
  type GetByteOrderMarkResponse,
  type GetCharacterCountsResponse,
  type GetComputedFileSizeResponse,
  type GetContentTypeResponse,
  type GetCountResponse,
  type GetLanguageResponse,
  type GetSegmentResponse,
  type GetSessionCountResponse,
  type NotifyChangedViewportsResponse,
  type SaveSessionRequest,
  type SaveSessionResponse,
  type SearchSessionRequest,
  type SearchSessionResponse,
  type SingleCount,
} from './generated/omega_edit/v1/omega_edit'
import { debugLog, getLogger } from '../logger'
import { getClient } from '../client'

function getSingleId(
  response: { id: string } | { getId(): string } | undefined,
  fn: string
): string {
  if (!response) {
    throw new Error(`${fn} error: empty response`)
  }
  if ('id' in response && typeof response.id === 'string') {
    return response.id
  }
  return (response as { getId(): string }).getId()
}

function requireResponse<T>(response: T | undefined, fn: string): T {
  if (!response) {
    throw new Error(`${fn} error: empty response`)
  }
  return response
}

export async function createSession(
  filePath: string = '',
  sessionIdDesired: string = '',
  checkpointDirectory: string = ''
): Promise<CreateSessionResponse> {
  const log = getLogger()
  const request: CreateSessionRequest = {}

  if (filePath.length > 0) request.filePath = filePath
  if (sessionIdDesired.length > 0) request.sessionIdDesired = sessionIdDesired
  if (checkpointDirectory.length > 0) {
    request.checkpointDirectory = checkpointDirectory
  }

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

      try {
        const required = requireResponse(response, 'createSession')
        debugLog(log, () => ({
          fn: 'protobufTs.createSession',
          resp: required,
        }))
        return resolve(required)
      } catch (error) {
        return reject((error as Error).message)
      }
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

      try {
        const id = getSingleId(response, 'destroySession')
        debugLog(log, () => ({
          fn: 'protobufTs.destroySession',
          resp: response,
        }))
        return resolve(id)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function saveSession(
  sessionId: string,
  filePath: string,
  flags: number,
  offset: number = 0,
  length: number = 0
): Promise<SaveSessionResponse> {
  const log = getLogger()
  const request: SaveSessionRequest = {
    sessionId: sessionId,
    filePath: filePath,
    ioFlags: flags,
  }
  if (offset > 0) request.offset = offset
  if (length > 0) request.length = length

  debugLog(log, () => ({ fn: 'protobufTs.saveSession', rqst: request }))
  const client = await getClient()

  return new Promise<SaveSessionResponse>((resolve, reject) => {
    client.saveSession(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.saveSession',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('saveSession error: ' + err.message)
      }

      try {
        const required = requireResponse(response, 'saveSession')
        debugLog(log, () => ({ fn: 'protobufTs.saveSession', resp: required }))
        return resolve(required)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function getComputedFileSize(sessionId: string): Promise<number> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.getComputedFileSize',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.getComputedFileSize(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getComputedFileSize',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('getComputedFileSize error: ' + err.message)
      }

      try {
        const required = requireResponse(
          response as GetComputedFileSizeResponse | undefined,
          'getComputedFileSize'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.getComputedFileSize',
          resp: required,
        }))
        return resolve(required.computedFileSize)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function getCounts(
  sessionId: string,
  kinds: number[]
): Promise<SingleCount[]> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    kind: kinds as GetCountResponse['counts'][number]['kind'][],
  }
  debugLog(log, () => ({ fn: 'protobufTs.getCounts', rqst: request }))
  const client = await getClient()

  return new Promise<SingleCount[]>((resolve, reject) => {
    client.getCount(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getCounts',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('getCounts error: ' + err.message)
      }

      try {
        const required = requireResponse(
          response as GetCountResponse | undefined,
          'getCounts'
        )
        debugLog(log, () => ({ fn: 'protobufTs.getCounts', resp: required }))
        return resolve(required.counts)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function pauseSessionChanges(sessionId: string): Promise<string> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.pauseSessionChanges',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    client.pauseSessionChanges(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.pauseSessionChanges',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('pauseSessionChanges error: ' + err.message)
      }

      try {
        const id = getSingleId(response, 'pauseSessionChanges')
        debugLog(log, () => ({
          fn: 'protobufTs.pauseSessionChanges',
          resp: response,
        }))
        return resolve(id)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function beginSessionTransaction(
  sessionId: string
): Promise<string> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.beginSessionTransaction',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    client.sessionBeginTransaction(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.beginSessionTransaction',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('beginSessionTransaction error: ' + err.message)
      }

      try {
        const id = getSingleId(response, 'beginSessionTransaction')
        debugLog(log, () => ({
          fn: 'protobufTs.beginSessionTransaction',
          resp: response,
        }))
        return resolve(id)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function endSessionTransaction(
  sessionId: string
): Promise<string> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.endSessionTransaction',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    client.sessionEndTransaction(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.endSessionTransaction',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('endSessionTransaction error: ' + err.message)
      }

      try {
        const id = getSingleId(response, 'endSessionTransaction')
        debugLog(log, () => ({
          fn: 'protobufTs.endSessionTransaction',
          resp: response,
        }))
        return resolve(id)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function resumeSessionChanges(sessionId: string): Promise<string> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.resumeSessionChanges',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    client.resumeSessionChanges(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.resumeSessionChanges',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('resumeSessionChanges error: ' + err.message)
      }

      try {
        const id = getSingleId(response, 'resumeSessionChanges')
        debugLog(log, () => ({
          fn: 'protobufTs.resumeSessionChanges',
          resp: response,
        }))
        return resolve(id)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function unsubscribeSession(sessionId: string): Promise<string> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.unsubscribeSession',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const settleResolve = (value: string) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const settleReject = (reason: unknown) => {
      if (settled) return
      settled = true
      reject(reason)
    }

    const call = client.unsubscribeToSessionEvents(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.unsubscribeSession',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return settleReject('unsubscribeSession error: ' + err.message)
      }

      try {
        const id = getSingleId(response, 'unsubscribeSession')
        debugLog(log, () => ({
          fn: 'protobufTs.unsubscribeSession',
          resp: response,
        }))
        return settleResolve(id)
      } catch (error) {
        return settleReject((error as Error).message)
      }
    })

    call.on('error', (err) => {
      if (!err.message.includes('Call cancelled')) {
        settleReject(err)
      }
    })
  })
}

export async function getSegment(
  sessionId: string,
  offset: number,
  length: number
): Promise<Uint8Array> {
  const log = getLogger()
  const request = {
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

      try {
        const required = requireResponse(
          response as GetSegmentResponse | undefined,
          'getSegment'
        )
        debugLog(log, () => ({ fn: 'protobufTs.getSegment', resp: required }))
        return resolve(required.data)
      } catch (error) {
        return reject((error as Error).message)
      }
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

      try {
        const required = requireResponse(
          response as GetSessionCountResponse | undefined,
          'getSessionCount'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.getSessionCount',
          resp: required,
        }))
        return resolve(required.count)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function notifyChangedViewports(
  sessionId: string
): Promise<number> {
  const log = getLogger()
  const request = { id: sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.notifyChangedViewports',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<number>((resolve, reject) => {
    client.notifyChangedViewports(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.notifyChangedViewports',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('notifyChangedViewports error: ' + err.message)
      }

      try {
        const required = requireResponse(
          response as NotifyChangedViewportsResponse | undefined,
          'notifyChangedViewports'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.notifyChangedViewports',
          resp: required,
        }))
        return resolve(required.count)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function profileSession(
  sessionId: string,
  offset: number = 0,
  length: number = 0
): Promise<number[]> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    offset: offset,
    length: length,
  }
  debugLog(log, () => ({ fn: 'protobufTs.profileSession', rqst: request }))
  const client = await getClient()

  return new Promise<number[]>((resolve, reject) => {
    client.getByteFrequencyProfile(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.profileSession',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('profileSession error: ' + err.message)
      }

      try {
        const required = requireResponse(
          response as GetByteFrequencyProfileResponse | undefined,
          'profileSession'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.profileSession',
          resp: required,
        }))
        return resolve(required.frequency)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function getByteOrderMark(
  sessionId: string,
  offset: number = 0
): Promise<GetByteOrderMarkResponse> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    offset: offset,
    length: 4,
  }
  debugLog(log, () => ({
    fn: 'protobufTs.getByteOrderMark',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<GetByteOrderMarkResponse>((resolve, reject) => {
    client.getByteOrderMark(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getByteOrderMark',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('getByteOrderMark error: ' + err.message)
      }

      try {
        const required = requireResponse(
          response as GetByteOrderMarkResponse | undefined,
          'getByteOrderMark'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.getByteOrderMark',
          resp: required,
        }))
        return resolve(required)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function getContentType(
  sessionId: string,
  offset: number,
  length: number
): Promise<GetContentTypeResponse> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    offset: offset,
    length: length,
  }
  debugLog(log, () => ({ fn: 'protobufTs.getContentType', rqst: request }))
  const client = await getClient()

  return new Promise<GetContentTypeResponse>((resolve, reject) => {
    client.getContentType(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getContentType',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('getContentType error: ' + err.message)
      }

      try {
        const required = requireResponse(
          response as GetContentTypeResponse | undefined,
          'getContentType'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.getContentType',
          resp: required,
        }))
        return resolve(required)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function getLanguage(
  sessionId: string,
  offset: number,
  length: number,
  bom: string
): Promise<GetLanguageResponse> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    offset: offset,
    length: length,
    byteOrderMark: bom,
  }
  debugLog(log, () => ({ fn: 'protobufTs.getLanguage', rqst: request }))
  const client = await getClient()

  return new Promise<GetLanguageResponse>((resolve, reject) => {
    client.getLanguage(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.getLanguage',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('getLanguage error: ' + err.message)
      }

      try {
        const required = requireResponse(
          response as GetLanguageResponse | undefined,
          'getLanguage'
        )
        debugLog(log, () => ({ fn: 'protobufTs.getLanguage', resp: required }))
        return resolve(required)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}

export async function countCharacters(
  sessionId: string,
  offset: number = 0,
  length: number = 0,
  bom: string = 'none'
): Promise<GetCharacterCountsResponse> {
  const log = getLogger()
  const request = {
    sessionId: sessionId,
    offset: offset,
    length: length,
    byteOrderMark: bom,
  }
  debugLog(log, () => ({
    fn: 'protobufTs.countCharacters',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<GetCharacterCountsResponse>((resolve, reject) => {
    client.getCharacterCounts(request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.countCharacters',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject('countCharacters error: ' + err.message)
      }

      try {
        const required = requireResponse(
          response as GetCharacterCountsResponse | undefined,
          'countCharacters'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.countCharacters',
          resp: required,
        }))
        return resolve(required)
      } catch (error) {
        return reject((error as Error).message)
      }
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

  const request: SearchSessionRequest = {
    sessionId: sessionId,
    pattern: typeof pattern === 'string' ? Buffer.from(pattern) : pattern,
    offset: offset,
  }

  if (isCaseInsensitive) request.isCaseInsensitive = true
  if (isReverse) request.isReverse = true
  if (length > 0) request.length = length
  if (limit > 0) request.limit = limit

  debugLog(log, () => ({ fn: 'protobufTs.searchSession', rqst: request }))
  const client = await getClient()

  return new Promise<number[]>((resolve, reject) => {
    client.searchSession(request, (err, response) => {
      if (err) {
        return reject('searchSession error: ' + err.message)
      }

      try {
        const required = requireResponse(
          response as SearchSessionResponse | undefined,
          'searchSession'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.searchSession',
          resp: required,
        }))
        return resolve(required.matchOffset)
      } catch (error) {
        return reject((error as Error).message)
      }
    })
  })
}
