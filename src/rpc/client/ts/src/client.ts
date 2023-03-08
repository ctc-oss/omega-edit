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
let client_: EditorClient | undefined = undefined

// subscription events
export const NO_EVENTS = 0 // subscribe to no events
export const ALL_EVENTS = ~NO_EVENTS // subscribe to all events

/**
 * Reset the client back to undefined.
 */
export function resetClient() {
  client_ = undefined
}

/**
 * Gets the connected editor client. Initializes the client if not already
 * @param port port to bind to
 * @param host interface to connect to
 * @return connected editor client
 */
export function getClient(
  port: number = 9000,
  host: string = '127.0.0.1'
): EditorClient {
  if (!client_) {
    getLogger().debug({
      fn: 'getClient',
      port: port,
      host: host,
      state: 'initializing',
    })
    const uri = process.env.OMEGA_EDIT_SERVER_URI || `${host}:${port}`
    client_ = new EditorClient(uri, grpc.credentials.createInsecure())
    waitForReady(client_)
      .catch((err) => {
        getLogger().error({
          cmd: 'getClient',
          host: host,
          port: port,
          err: {
            name: err.name,
            msg: err.message,
            stack: err.stack,
          },
        })
      })
      .then((ready: boolean | void) => {
        if (!ready) {
          getLogger().error({
            cmd: 'getClient',
            host: host,
            port: port,
            msg: 'client not ready',
          })
        }
      })
  }
  return client_
}

/**
 * Returns true when the client is connected and ready to handle requests
 * @param client editor client to wait until its ready
 * @param deadline limit on the amount of time to wait (current time plus 10 seconds by default)
 * @return true of the client is ready to handle requests, and false if it is not ready
 */
export function waitForReady(
  client: EditorClient,
  deadline?: grpc.Deadline
): Promise<boolean> {
  if (!deadline) {
    deadline = new Date()
    deadline.setSeconds(deadline.getSeconds() + 10)
  }
  return new Promise<boolean>((resolve, reject) => {
    client.waitForReady(deadline as grpc.Deadline, (err: Error | undefined) => {
      if (err) {
        getLogger().error({
          cmd: 'waitForReady',
          err: {
            name: err.name,
            msg: err.message,
            stack: err.stack,
          },
        })
        return reject(false)
      }
      getLogger().debug({ cmd: 'waitForReady', msg: 'ready' })
      return resolve(true)
    })
  })
}
