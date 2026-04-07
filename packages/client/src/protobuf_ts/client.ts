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

import * as grpc from '@grpc/grpc-js'
import { EditorClient } from '../omega_edit_grpc_pb'
import { getLogger } from '../logger'

export interface ClientConnectionOptions {
  serverUri?: string
  socketPath?: string
  allowTcpFallback?: boolean
}

const clientInstances_ = new Map<string, EditorClient>()
const pendingInit_ = new Map<string, Promise<EditorClient>>()

const DEFAULT_PORT = 9000
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_DEADLINE_SECONDS = 10

export function resetClient() {
  const clients = Array.from(new Set(clientInstances_.values()))
  clientInstances_.clear()
  pendingInit_.clear()

  for (const client of clients) {
    try {
      client.close()
    } catch (err) {
      const log = getLogger()
      log.warn({
        fn: 'protobufTs.resetClient',
        state: 'close failed',
        err: {
          msg: err instanceof Error ? err.message : String(err),
        },
      })
    }
  }
}

export function waitForReady(
  client: grpc.Client,
  deadline: grpc.Deadline = new Date(
    Date.now() + DEFAULT_DEADLINE_SECONDS * 1000
  )
): Promise<void> {
  const log = getLogger()
  return new Promise<void>((resolve, reject) => {
    client.waitForReady(deadline, (err: Error | undefined) => {
      if (err) {
        log.error({
          fn: 'protobufTs.waitForReady',
          state: 'not ready',
          err: {
            name: err.name,
            msg: err.message,
            stack: err.stack,
          },
        })
        return reject(err)
      }

      log.debug({ fn: 'protobufTs.waitForReady', state: 'ready' })
      return resolve()
    })
  })
}

function normalizeUnixSocketTarget(socket: string): string {
  if (socket.startsWith('unix:')) return socket
  if (socket.startsWith('/')) return `unix:///${socket.slice(1)}`
  return `unix:${socket}`
}

function resolveCandidates(
  port: number,
  host: string,
  options?: ClientConnectionOptions
): { requestKey: string; candidates: string[] } {
  if (options?.serverUri && options?.socketPath) {
    throw new Error(
      'getClient accepts either serverUri or socketPath, not both'
    )
  }

  const tcpUri = `${host}:${port}`

  if (options?.serverUri) {
    return {
      requestKey: options.serverUri,
      candidates: [options.serverUri],
    }
  }

  if (options?.socketPath) {
    const socketUri = normalizeUnixSocketTarget(options.socketPath)
    const candidates = options.allowTcpFallback
      ? [socketUri, tcpUri]
      : [socketUri]

    return {
      requestKey: candidates.join('|'),
      candidates,
    }
  }

  const serverUri = process.env.OMEGA_EDIT_SERVER_URI
  const serverSocket = process.env.OMEGA_EDIT_SERVER_SOCKET

  if (serverUri) {
    return {
      requestKey: serverUri,
      candidates: [serverUri],
    }
  }

  if (serverSocket) {
    const socketUri = normalizeUnixSocketTarget(serverSocket)
    const candidates = [socketUri, tcpUri]
    return {
      requestKey: candidates.join('|'),
      candidates,
    }
  }

  return {
    requestKey: tcpUri,
    candidates: [tcpUri],
  }
}

async function initClient(
  port: number,
  host: string,
  candidates: string[]
): Promise<EditorClient> {
  const log = getLogger()

  log.debug({
    fn: 'protobufTs.getClient',
    port,
    host,
    candidates,
    state: 'initializing',
  })

  let lastError: unknown

  for (const uri of candidates) {
    const cachedClient = clientInstances_.get(uri)
    if (cachedClient) {
      log.debug({
        fn: 'protobufTs.getClient',
        port,
        host,
        uri,
        state: 'reused cached endpoint',
      })
      return cachedClient
    }

    const client = new EditorClient(uri, grpc.credentials.createInsecure())

    try {
      await waitForReady(client)

      clientInstances_.set(uri, client)
      log.debug({
        fn: 'protobufTs.getClient',
        port,
        host,
        uri,
        state: 'ready',
      })

      return client
    } catch (err) {
      lastError = err
      try {
        client.close()
      } catch {
        // ignore close errors
      }

      if (err instanceof Error) {
        log.error({
          fn: 'protobufTs.getClient',
          host,
          port,
          uri,
          state: 'not ready',
          err: {
            name: err.name,
            msg: err.message,
            stack: err.stack,
          },
        })
      } else {
        log.error({
          fn: 'protobufTs.getClient',
          host,
          port,
          uri,
          state: 'not ready',
          err: {
            msg: String(err),
          },
        })
      }
    }
  }

  throw lastError
}

export async function getClient(
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
  options?: ClientConnectionOptions
): Promise<EditorClient> {
  const hasExplicitTarget =
    !!options?.serverUri ||
    !!options?.socketPath ||
    !!process.env.OMEGA_EDIT_SERVER_URI ||
    !!process.env.OMEGA_EDIT_SERVER_SOCKET

  if (
    !hasExplicitTarget &&
    port === DEFAULT_PORT &&
    host === DEFAULT_HOST &&
    clientInstances_.size === 1
  ) {
    return clientInstances_.values().next().value as EditorClient
  }

  const { requestKey, candidates } = resolveCandidates(port, host, options)

  const primaryCandidate = candidates[0]
  const cachedClient = primaryCandidate
    ? clientInstances_.get(primaryCandidate)
    : undefined
  if (cachedClient) {
    return cachedClient
  }

  const pending = pendingInit_.get(requestKey)
  if (pending) {
    return pending
  }

  const initPromise = initClient(port, host, candidates).finally(() => {
    pendingInit_.delete(requestKey)
  })
  pendingInit_.set(requestKey, initPromise)

  return initPromise
}
