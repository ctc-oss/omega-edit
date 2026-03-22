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

let clientInstance_: EditorClient | undefined = undefined

const DEFAULT_PORT = 9000
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_DEADLINE_SECONDS = 10

export function resetClient() {
  const client = clientInstance_
  clientInstance_ = undefined
  if (client) {
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

export async function getClient(
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST
): Promise<EditorClient> {
  const log = getLogger()

  if (!clientInstance_) {
    log.debug({
      fn: 'protobufTs.getClient',
      port: port,
      host: host,
      state: 'initializing',
    })

    const serverUri = process.env.OMEGA_EDIT_SERVER_URI
    const serverSocket = process.env.OMEGA_EDIT_SERVER_SOCKET

    const normalizeUnixSocketTarget = (socket: string): string => {
      if (socket.startsWith('unix:')) return socket
      if (socket.startsWith('/')) return `unix:///${socket.slice(1)}`
      return `unix:${socket}`
    }

    const tcpUri = `${host}:${port}`
    const candidates = serverUri
      ? [serverUri]
      : serverSocket
        ? [normalizeUnixSocketTarget(serverSocket), tcpUri]
        : [tcpUri]

    let lastError: unknown

    for (const uri of candidates) {
      const client = new EditorClient(uri, grpc.credentials.createInsecure())

      try {
        await waitForReady(client)

        clientInstance_ = client
        log.debug({
          fn: 'protobufTs.getClient',
          port: port,
          host: host,
          uri: uri,
          state: 'ready',
        })

        return clientInstance_
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
            host: host,
            port: port,
            uri: uri,
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
            host: host,
            port: port,
            uri: uri,
            state: 'not ready',
            err: {
              msg: String(err),
            },
          })
        }
      }
    }

    resetClient()
    throw lastError
  }

  return clientInstance_
}
