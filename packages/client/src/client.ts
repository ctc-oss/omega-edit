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

import { EditorClient } from './omega_edit_grpc_pb'
import * as grpc from '@grpc/grpc-js'
import { getLogger } from './logger'

// client instance
let clientInstance_: EditorClient | undefined = undefined

// subscription events
export const NO_EVENTS = 0 // subscribe to no events
export const ALL_EVENTS = ~NO_EVENTS // subscribe to all events

const DEFAULT_PORT = 9000
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_DEADLINE_SECONDS = 10

/**
 * Reset the client back to undefined.
 */
export function resetClient() {
  clientInstance_ = undefined
}

/**
 * Returns true when the client is connected and ready to handle requests
 * @param client editor client to wait until its ready
 * @param deadline limit on the amount of time to wait (current time plus 10 seconds by default)
 * @return true of the client is ready to handle requests, and false if it is not ready
 */
export function waitForReady(
  client: EditorClient,
  deadline: grpc.Deadline = new Date(
    Date.now() + DEFAULT_DEADLINE_SECONDS * 1000
  )
): Promise<void> {
  const log = getLogger()
  return new Promise<void>((resolve, reject) => {
    client.waitForReady(deadline, (err: Error | undefined) => {
      if (err) {
        log.error({
          fn: 'waitForReady',
          state: 'not ready',
          err: {
            name: err.name,
            msg: err.message,
            stack: err.stack,
          },
        })
        return reject(err)
      }
      log.debug({ fn: 'waitForReady', state: 'ready' })
      return resolve()
    })
  })
}

/**
 * Gets the connected editor client. Initializes the client if not already
 * @param port port to bind to
 * @param host interface to connect to
 * @return connected editor client
 */
export async function getClient(
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST
): Promise<EditorClient> {
  const log = getLogger()

  if (!clientInstance_) {
    log.debug({
      fn: 'getClient',
      port: port,
      host: host,
      state: 'initializing',
    })

    const uri = process.env.OMEGA_EDIT_SERVER_URI || `${host}:${port}`
    clientInstance_ = new EditorClient(uri, grpc.credentials.createInsecure())

    try {
      await waitForReady(clientInstance_) // awaiting the Promise instead of providing a callback

      log.debug({
        fn: 'getClient',
        port: port,
        host: host,
        state: 'ready',
      })

      return clientInstance_
    } catch (err) {
      if (err instanceof Error) {
        // Ensure that we caught an Error object
        log.error({
          fn: 'getClient',
          host: host,
          port: port,
          state: 'not ready',
          err: {
            name: err.name,
            msg: err.message,
            stack: err.stack,
          },
        })
      } else {
        // handle non-Error type, and log the error as a string.
        log.error({
          fn: 'getClient',
          host: host,
          port: port,
          state: 'not ready',
          err: {
            msg: String(err),
          },
        })
      }
      resetClient()
      throw err // Rethrow the caught error after logging it and resetting the client
    }
  }

  return clientInstance_
}
