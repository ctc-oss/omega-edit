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
  SearchCaseFolding,
  SessionContentSource,
  SessionFingerprintContent,
  type ApplyTransformPluginResponse,
  type CheckSessionModelResponse,
  type CreateCheckpointResponse,
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
  type GetSessionContentInfoResponse,
  type GetSessionFingerprintResponse,
  type GetSessionCountResponse,
  type InspectSessionContentResponse,
  type ListTransformPluginsResponse,
  type NotifyChangedViewportsResponse,
  type DestroyLastCheckpointResponse,
  type ReplaceSessionRequest,
  type ReplaceSessionResponse,
  type ReplaceSessionCheckpointedRequest,
  type ReplaceSessionCheckpointedResponse,
  type RestoreLastCheckpointResponse,
  type RestoreToChangeCountResponse,
  type SaveSessionRequest,
  type SaveSessionResponse,
  type SearchSessionRequest,
  type SearchSessionResponse,
  type SingleCount,
  type TransformPluginInfo,
} from './generated/omega_edit/v1/omega_edit'
import { debugLog, getLogger } from '../logger'
import { getClient } from '../client'
import {
  type CancellableCallOptions,
  cancelUnaryOnSignal,
  getSingleId,
  getUnsubscribeTimeoutMs,
  callUnary,
  makeCancellationError,
  makeWrappedError,
  requireResponse,
} from './utils'

export async function createSession(
  filePath: string = '',
  sessionIdDesired: string = '',
  checkpointDirectory: string = '',
  initialData?: Uint8Array
): Promise<CreateSessionResponse> {
  const log = getLogger()
  const request: CreateSessionRequest = {}

  if (filePath.length > 0) request.filePath = filePath
  if (sessionIdDesired.length > 0) request.sessionIdDesired = sessionIdDesired
  if (checkpointDirectory.length > 0) {
    request.checkpointDirectory = checkpointDirectory
  }
  if (initialData !== undefined) request.initialData = initialData

  debugLog(log, () => ({ fn: 'protobufTs.createSession', rqst: request }))
  const client = await getClient()

  return new Promise<CreateSessionResponse>((resolve, reject) => {
    callUnary(client, client.createSession, request, (err, response) => {
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
        return reject(makeWrappedError('createSession', err))
      }

      try {
        const required = requireResponse(response, 'createSession')
        debugLog(log, () => ({
          fn: 'protobufTs.createSession',
          resp: required,
        }))
        return resolve(required)
      } catch (error) {
        return reject(makeWrappedError('createSession', error))
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
    callUnary(client, client.destroySession, request, (err, response) => {
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
        return reject(makeWrappedError('destroySession', err))
      }

      try {
        const id = getSingleId(response, 'destroySession')
        debugLog(log, () => ({
          fn: 'protobufTs.destroySession',
          resp: response,
        }))
        return resolve(id)
      } catch (error) {
        return reject(makeWrappedError('destroySession', error))
      }
    })
  })
}

export async function checkSessionModel(
  sessionId: string
): Promise<CheckSessionModelResponse> {
  const log = getLogger()
  const request = { sessionId }
  debugLog(log, () => ({ fn: 'protobufTs.checkSessionModel', rqst: request }))
  const client = await getClient()

  return new Promise<CheckSessionModelResponse>((resolve, reject) => {
    callUnary(client, client.checkSessionModel, request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.checkSessionModel',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('checkSessionModel', err))
      }

      try {
        const required = requireResponse(
          response as CheckSessionModelResponse | undefined,
          'checkSessionModel'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.checkSessionModel',
          resp: required,
        }))
        return resolve(required)
      } catch (error) {
        return reject(makeWrappedError('checkSessionModel', error))
      }
    })
  })
}

export async function getSessionFingerprint(
  sessionId: string,
  content: SessionFingerprintContent,
  algorithm = ''
): Promise<GetSessionFingerprintResponse> {
  const log = getLogger()
  const request =
    algorithm.length > 0
      ? { sessionId, content, algorithm }
      : { sessionId, content }
  debugLog(log, () => ({
    fn: 'protobufTs.getSessionFingerprint',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<GetSessionFingerprintResponse>((resolve, reject) => {
    callUnary(
      client,
      client.getSessionFingerprint,
      request,
      (err, response) => {
        if (err) {
          log.error({
            fn: 'protobufTs.getSessionFingerprint',
            rqst: request,
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return reject(makeWrappedError('getSessionFingerprint', err))
        }

        try {
          const required = requireResponse(
            response as GetSessionFingerprintResponse | undefined,
            'getSessionFingerprint'
          )
          debugLog(log, () => ({
            fn: 'protobufTs.getSessionFingerprint',
            resp: required,
          }))
          return resolve(required)
        } catch (error) {
          return reject(makeWrappedError('getSessionFingerprint', error))
        }
      }
    )
  })
}

export async function getSessionContentInfo(
  sessionId: string,
  content: SessionContentSource[] = []
): Promise<GetSessionContentInfoResponse> {
  const log = getLogger()
  const request = { sessionId, content }
  debugLog(log, () => ({
    fn: 'protobufTs.getSessionContentInfo',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<GetSessionContentInfoResponse>((resolve, reject) => {
    callUnary(
      client,
      client.getSessionContentInfo,
      request,
      (err, response) => {
        if (err) {
          log.error({
            fn: 'protobufTs.getSessionContentInfo',
            rqst: request,
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return reject(makeWrappedError('getSessionContentInfo', err))
        }

        try {
          const required = requireResponse(
            response as GetSessionContentInfoResponse | undefined,
            'getSessionContentInfo'
          )
          debugLog(log, () => ({
            fn: 'protobufTs.getSessionContentInfo',
            resp: required,
          }))
          return resolve(required)
        } catch (error) {
          return reject(makeWrappedError('getSessionContentInfo', error))
        }
      }
    )
  })
}

export async function createCheckpoint(
  sessionId: string
): Promise<CreateCheckpointResponse> {
  const log = getLogger()
  const request = { sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.createCheckpoint',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<CreateCheckpointResponse>((resolve, reject) => {
    callUnary(client, client.createCheckpoint, request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.createCheckpoint',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('createCheckpoint', err))
      }

      try {
        const required = requireResponse(
          response as CreateCheckpointResponse | undefined,
          'createCheckpoint'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.createCheckpoint',
          resp: required,
        }))
        return resolve(required)
      } catch (error) {
        return reject(makeWrappedError('createCheckpoint', error))
      }
    })
  })
}

export async function destroyLastCheckpoint(
  sessionId: string
): Promise<DestroyLastCheckpointResponse> {
  const log = getLogger()
  const request = { sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.destroyLastCheckpoint',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<DestroyLastCheckpointResponse>((resolve, reject) => {
    callUnary(
      client,
      client.destroyLastCheckpoint,
      request,
      (err, response) => {
        if (err) {
          log.error({
            fn: 'protobufTs.destroyLastCheckpoint',
            rqst: request,
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return reject(makeWrappedError('destroyLastCheckpoint', err))
        }

        try {
          const required = requireResponse(
            response as DestroyLastCheckpointResponse | undefined,
            'destroyLastCheckpoint'
          )
          debugLog(log, () => ({
            fn: 'protobufTs.destroyLastCheckpoint',
            resp: required,
          }))
          return resolve(required)
        } catch (error) {
          return reject(makeWrappedError('destroyLastCheckpoint', error))
        }
      }
    )
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
    callUnary(client, client.saveSession, request, (err, response) => {
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
        return reject(makeWrappedError('saveSession', err))
      }

      try {
        const required = requireResponse(response, 'saveSession')
        debugLog(log, () => ({ fn: 'protobufTs.saveSession', resp: required }))
        return resolve(required)
      } catch (error) {
        return reject(makeWrappedError('saveSession', error))
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
    callUnary(client, client.getComputedFileSize, request, (err, response) => {
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
        return reject(makeWrappedError('getComputedFileSize', err))
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
        return reject(makeWrappedError('getComputedFileSize', error))
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
    kind: kinds as CountKind[],
  }
  debugLog(log, () => ({ fn: 'protobufTs.getCounts', rqst: request }))
  const client = await getClient()

  return new Promise<SingleCount[]>((resolve, reject) => {
    callUnary(client, client.getCount, request, (err, response) => {
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
        return reject(makeWrappedError('getCounts', err))
      }

      try {
        const required = requireResponse(
          response as GetCountResponse | undefined,
          'getCounts'
        )
        debugLog(log, () => ({ fn: 'protobufTs.getCounts', resp: required }))
        return resolve(required.counts)
      } catch (error) {
        return reject(makeWrappedError('getCounts', error))
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
    callUnary(client, client.pauseSessionChanges, request, (err, response) => {
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
        return reject(makeWrappedError('pauseSessionChanges', err))
      }

      try {
        const id = getSingleId(response, 'pauseSessionChanges')
        debugLog(log, () => ({
          fn: 'protobufTs.pauseSessionChanges',
          resp: response,
        }))
        return resolve(id)
      } catch (error) {
        return reject(makeWrappedError('pauseSessionChanges', error))
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
    callUnary(
      client,
      client.sessionBeginTransaction,
      request,
      (err, response) => {
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
          return reject(makeWrappedError('beginSessionTransaction', err))
        }

        try {
          const id = getSingleId(response, 'beginSessionTransaction')
          debugLog(log, () => ({
            fn: 'protobufTs.beginSessionTransaction',
            resp: response,
          }))
          return resolve(id)
        } catch (error) {
          return reject(makeWrappedError('beginSessionTransaction', error))
        }
      }
    )
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
    callUnary(
      client,
      client.sessionEndTransaction,
      request,
      (err, response) => {
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
          return reject(makeWrappedError('endSessionTransaction', err))
        }

        try {
          const id = getSingleId(response, 'endSessionTransaction')
          debugLog(log, () => ({
            fn: 'protobufTs.endSessionTransaction',
            resp: response,
          }))
          return resolve(id)
        } catch (error) {
          return reject(makeWrappedError('endSessionTransaction', error))
        }
      }
    )
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
    callUnary(client, client.resumeSessionChanges, request, (err, response) => {
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
        return reject(makeWrappedError('resumeSessionChanges', err))
      }

      try {
        const id = getSingleId(response, 'resumeSessionChanges')
        debugLog(log, () => ({
          fn: 'protobufTs.resumeSessionChanges',
          resp: response,
        }))
        return resolve(id)
      } catch (error) {
        return reject(makeWrappedError('resumeSessionChanges', error))
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
    const timeoutMs = getUnsubscribeTimeoutMs()
    let settled = false
    const timeout = setTimeout(() => {
      settleReject(
        makeWrappedError('unsubscribeSession', `timed out after ${timeoutMs}ms`)
      )
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

    const call = callUnary(
      client,
      client.unsubscribeToSessionEvents,
      request,
      (err, response) => {
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
          return settleReject(makeWrappedError('unsubscribeSession', err))
        }

        try {
          const id = getSingleId(response, 'unsubscribeSession')
          debugLog(log, () => ({
            fn: 'protobufTs.unsubscribeSession',
            resp: response,
          }))
          return settleResolve(id)
        } catch (error) {
          return settleReject(makeWrappedError('unsubscribeSession', error))
        }
      }
    )

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
    callUnary(client, client.getSegment, request, (err, response) => {
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
        return reject(makeWrappedError('getSegment', err))
      }

      try {
        const required = requireResponse(
          response as GetSegmentResponse | undefined,
          'getSegment'
        )
        debugLog(log, () => ({ fn: 'protobufTs.getSegment', resp: required }))
        return resolve(required.data)
      } catch (error) {
        return reject(makeWrappedError('getSegment', error))
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
        return reject(makeWrappedError('getSessionCount', err))
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
        return reject(makeWrappedError('getSessionCount', error))
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
    callUnary(
      client,
      client.notifyChangedViewports,
      request,
      (err, response) => {
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
          return reject(makeWrappedError('notifyChangedViewports', err))
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
          return reject(makeWrappedError('notifyChangedViewports', error))
        }
      }
    )
  })
}

export async function listTransformPlugins(): Promise<TransformPluginInfo[]> {
  const log = getLogger()
  log.debug({ fn: 'protobufTs.listTransformPlugins' })
  const client = await getClient()

  return new Promise<TransformPluginInfo[]>((resolve, reject) => {
    client.listTransformPlugins({}, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.listTransformPlugins',
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('listTransformPlugins', err))
      }

      try {
        const required = requireResponse(
          response as ListTransformPluginsResponse | undefined,
          'listTransformPlugins'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.listTransformPlugins',
          resp: required,
        }))
        return resolve(required.plugins)
      } catch (error) {
        return reject(makeWrappedError('listTransformPlugins', error))
      }
    })
  })
}

export async function applyTransformPlugin(
  sessionId: string,
  pluginId: string,
  offset: number = 0,
  length: number = 0,
  optionsJson?: string,
  options: CancellableCallOptions = {}
): Promise<ApplyTransformPluginResponse> {
  const log = getLogger()
  const request = {
    sessionId,
    pluginId,
    offset,
    length,
    optionsJson,
  }
  debugLog(log, () => ({
    fn: 'protobufTs.applyTransformPlugin',
    rqst: request,
  }))
  if (options.signal?.aborted) {
    throw makeCancellationError('applyTransformPlugin')
  }
  const client = await getClient()
  if (options.signal?.aborted) {
    throw makeCancellationError('applyTransformPlugin')
  }

  return new Promise<ApplyTransformPluginResponse>((resolve, reject) => {
    let removeCancellationListener: () => void = () => undefined
    const call = callUnary(
      client,
      client.applyTransformPlugin,
      request,
      (err, response) => {
        removeCancellationListener()
        if (err) {
          log.error({
            fn: 'protobufTs.applyTransformPlugin',
            rqst: request,
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return reject(makeWrappedError('applyTransformPlugin', err))
        }

        try {
          const required = requireResponse(
            response as ApplyTransformPluginResponse | undefined,
            'applyTransformPlugin'
          )
          debugLog(log, () => ({
            fn: 'protobufTs.applyTransformPlugin',
            resp: required,
          }))
          return resolve(required)
        } catch (error) {
          return reject(makeWrappedError('applyTransformPlugin', error))
        }
      }
    )
    removeCancellationListener = cancelUnaryOnSignal(call, options.signal)
  })
}

export async function inspectSessionContent(
  sessionId: string,
  content: SessionContentSource,
  pluginId: string,
  offset: number = 0,
  length: number = 0,
  optionsJson?: string,
  options: CancellableCallOptions = {}
): Promise<InspectSessionContentResponse> {
  const log = getLogger()
  const request = {
    sessionId,
    content,
    pluginId,
    offset,
    length,
    optionsJson,
  }
  debugLog(log, () => ({
    fn: 'protobufTs.inspectSessionContent',
    rqst: request,
  }))
  if (options.signal?.aborted) {
    throw makeCancellationError('inspectSessionContent')
  }
  const client = await getClient()
  if (options.signal?.aborted) {
    throw makeCancellationError('inspectSessionContent')
  }

  return new Promise<InspectSessionContentResponse>((resolve, reject) => {
    let removeCancellationListener: () => void = () => undefined
    const call = callUnary(
      client,
      client.inspectSessionContent,
      request,
      (err, response) => {
        removeCancellationListener()
        if (err) {
          log.error({
            fn: 'protobufTs.inspectSessionContent',
            rqst: request,
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return reject(makeWrappedError('inspectSessionContent', err))
        }

        try {
          const required = requireResponse(
            response as InspectSessionContentResponse | undefined,
            'inspectSessionContent'
          )
          debugLog(log, () => ({
            fn: 'protobufTs.inspectSessionContent',
            resp: required,
          }))
          return resolve(required)
        } catch (error) {
          return reject(makeWrappedError('inspectSessionContent', error))
        }
      }
    )
    removeCancellationListener = cancelUnaryOnSignal(call, options.signal)
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
    callUnary(
      client,
      client.getByteFrequencyProfile,
      request,
      (err, response) => {
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
          return reject(makeWrappedError('profileSession', err))
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
          return reject(makeWrappedError('profileSession', error))
        }
      }
    )
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
    callUnary(client, client.getByteOrderMark, request, (err, response) => {
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
        return reject(makeWrappedError('getByteOrderMark', err))
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
        return reject(makeWrappedError('getByteOrderMark', error))
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
    callUnary(client, client.getContentType, request, (err, response) => {
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
        return reject(makeWrappedError('getContentType', err))
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
        return reject(makeWrappedError('getContentType', error))
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
    callUnary(client, client.getLanguage, request, (err, response) => {
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
        return reject(makeWrappedError('getLanguage', err))
      }

      try {
        const required = requireResponse(
          response as GetLanguageResponse | undefined,
          'getLanguage'
        )
        debugLog(log, () => ({ fn: 'protobufTs.getLanguage', resp: required }))
        return resolve(required)
      } catch (error) {
        return reject(makeWrappedError('getLanguage', error))
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
    callUnary(client, client.getCharacterCounts, request, (err, response) => {
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
        return reject(makeWrappedError('countCharacters', err))
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
        return reject(makeWrappedError('countCharacters', error))
      }
    })
  })
}

export async function searchSession(
  sessionId: string,
  pattern: string | Uint8Array,
  caseFolding: SearchCaseFolding = SearchCaseFolding.UNSPECIFIED,
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

  if (caseFolding !== SearchCaseFolding.UNSPECIFIED)
    request.caseFolding = caseFolding
  if (isReverse) request.isReverse = true
  if (length > 0) request.length = length
  if (limit > 0) request.limit = limit

  debugLog(log, () => ({ fn: 'protobufTs.searchSession', rqst: request }))
  const client = await getClient()

  return new Promise<number[]>((resolve, reject) => {
    callUnary(client, client.searchSession, request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.searchSession',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('searchSession', err))
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
        return reject(makeWrappedError('searchSession', error))
      }
    })
  })
}

export async function replaceSessionCheckpointed(
  sessionId: string,
  pattern: string | Uint8Array,
  replacement: string | Uint8Array,
  caseFolding: SearchCaseFolding = SearchCaseFolding.UNSPECIFIED,
  offset: number = 0,
  length: number = 0
): Promise<ReplaceSessionCheckpointedResponse> {
  const log = getLogger()

  if (pattern.length === 0) {
    log.warn({
      fn: 'protobufTs.replaceSessionCheckpointed',
      err: { msg: 'empty pattern given' },
    })
    return {
      sessionId,
      pattern: typeof pattern === 'string' ? Buffer.from(pattern) : pattern,
      replacement:
        typeof replacement === 'string'
          ? Buffer.from(replacement)
          : replacement,
      caseFolding,
      offset,
      length,
      replacementCount: 0,
    }
  }

  const request: ReplaceSessionCheckpointedRequest = {
    sessionId,
    pattern: typeof pattern === 'string' ? Buffer.from(pattern) : pattern,
    replacement:
      typeof replacement === 'string' ? Buffer.from(replacement) : replacement,
    offset,
  }

  if (caseFolding !== SearchCaseFolding.UNSPECIFIED)
    request.caseFolding = caseFolding
  if (length > 0) request.length = length

  debugLog(log, () => ({
    fn: 'protobufTs.replaceSessionCheckpointed',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<ReplaceSessionCheckpointedResponse>((resolve, reject) => {
    callUnary(
      client,
      client.replaceSessionCheckpointed,
      request,
      (err, response) => {
        if (err) {
          log.error({
            fn: 'protobufTs.replaceSessionCheckpointed',
            rqst: request,
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return reject(makeWrappedError('replaceSessionCheckpointed', err))
        }

        try {
          const required = requireResponse(
            response as ReplaceSessionCheckpointedResponse | undefined,
            'replaceSessionCheckpointed'
          )
          debugLog(log, () => ({
            fn: 'protobufTs.replaceSessionCheckpointed',
            resp: required,
          }))
          return resolve(required)
        } catch (error) {
          return reject(makeWrappedError('replaceSessionCheckpointed', error))
        }
      }
    )
  })
}

export async function restoreLastCheckpoint(
  sessionId: string
): Promise<RestoreLastCheckpointResponse> {
  const log = getLogger()
  const request = { sessionId }
  debugLog(log, () => ({
    fn: 'protobufTs.restoreLastCheckpoint',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<RestoreLastCheckpointResponse>((resolve, reject) => {
    callUnary(
      client,
      client.restoreLastCheckpoint,
      request,
      (err, response) => {
        if (err) {
          log.error({
            fn: 'protobufTs.restoreLastCheckpoint',
            rqst: request,
            err: {
              msg: err.message,
              details: err.details,
              code: err.code,
              stack: err.stack,
            },
          })
          return reject(makeWrappedError('restoreLastCheckpoint', err))
        }

        try {
          const required = requireResponse(
            response as RestoreLastCheckpointResponse | undefined,
            'restoreLastCheckpoint'
          )
          debugLog(log, () => ({
            fn: 'protobufTs.restoreLastCheckpoint',
            resp: required,
          }))
          return resolve(required)
        } catch (error) {
          return reject(makeWrappedError('restoreLastCheckpoint', error))
        }
      }
    )
  })
}

export async function restoreToChangeCount(
  sessionId: string,
  changeCount: number
): Promise<RestoreToChangeCountResponse> {
  const log = getLogger()
  const request = { sessionId, changeCount }
  debugLog(log, () => ({
    fn: 'protobufTs.restoreToChangeCount',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<RestoreToChangeCountResponse>((resolve, reject) => {
    callUnary(client, client.restoreToChangeCount, request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.restoreToChangeCount',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('restoreToChangeCount', err))
      }

      try {
        const required = requireResponse(
          response as RestoreToChangeCountResponse | undefined,
          'restoreToChangeCount'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.restoreToChangeCount',
          resp: required,
        }))
        return resolve(required)
      } catch (error) {
        return reject(makeWrappedError('restoreToChangeCount', error))
      }
    })
  })
}

export async function replaceSession(
  sessionId: string,
  pattern: string | Uint8Array,
  replacement: string | Uint8Array,
  caseFolding: SearchCaseFolding = SearchCaseFolding.UNSPECIFIED,
  isReverse: boolean = false,
  offset: number = 0,
  length: number = 0,
  limit: number = 0,
  frontToBack: boolean = true,
  overwriteOnly: boolean = false
): Promise<ReplaceSessionResponse> {
  const log = getLogger()

  if (pattern.length === 0) {
    log.warn({
      fn: 'protobufTs.replaceSession',
      err: { msg: 'empty pattern given' },
    })
    return {
      sessionId,
      pattern: typeof pattern === 'string' ? Buffer.from(pattern) : pattern,
      replacement:
        typeof replacement === 'string'
          ? Buffer.from(replacement)
          : replacement,
      caseFolding,
      isReverse,
      offset,
      length,
      limit,
      frontToBack,
      overwriteOnly,
      replacementCount: 0,
      deleteCount: 0,
      insertCount: 0,
      overwriteCount: 0,
    }
  }

  const request: ReplaceSessionRequest = {
    sessionId,
    pattern: typeof pattern === 'string' ? Buffer.from(pattern) : pattern,
    replacement:
      typeof replacement === 'string' ? Buffer.from(replacement) : replacement,
    offset,
  }

  if (caseFolding !== SearchCaseFolding.UNSPECIFIED)
    request.caseFolding = caseFolding
  if (isReverse) request.isReverse = true
  if (length > 0) request.length = length
  if (limit > 0) request.limit = limit
  if (!frontToBack) request.frontToBack = false
  if (overwriteOnly) request.overwriteOnly = true

  debugLog(log, () => ({
    fn: 'protobufTs.replaceSession',
    rqst: request,
  }))
  const client = await getClient()

  return new Promise<ReplaceSessionResponse>((resolve, reject) => {
    callUnary(client, client.replaceSession, request, (err, response) => {
      if (err) {
        log.error({
          fn: 'protobufTs.replaceSession',
          rqst: request,
          err: {
            msg: err.message,
            details: err.details,
            code: err.code,
            stack: err.stack,
          },
        })
        return reject(makeWrappedError('replaceSession', err))
      }

      try {
        const required = requireResponse(
          response as ReplaceSessionResponse | undefined,
          'replaceSession'
        )
        debugLog(log, () => ({
          fn: 'protobufTs.replaceSession',
          resp: required,
        }))
        return resolve(required)
      } catch (error) {
        return reject(makeWrappedError('replaceSession', error))
      }
    })
  })
}
