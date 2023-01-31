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

let client: EditorClient | undefined = undefined
export const NO_EVENTS = 0
export const ALL_EVENTS = ~NO_EVENTS

/**
 * Gets the connected editor client. Initializes the client if not already
 * @param host interface to connect to
 * @param port port to bind to
 * @return connected editor client
 */
export function getClient(host: string = '127.0.0.1', port: string = '9000'): EditorClient {
  if (!client) {
    const uri = process.env.OMEGA_EDIT_SERVER_URI || `${host}:${port}`
    let creds = grpc.credentials.createInsecure()
    client = new EditorClient(uri, creds)
  }

  return client
}

/**
 * Returns true when the client is connected and ready to handle requests
 * @param client editor client to wait until its ready
 * @param deadline limit on the amount of time to wait
 * @return true of the client is ready to handle requests, and false if it is not ready
 */
export function waitForReady(
  client: EditorClient,
  deadline: grpc.Deadline
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    client.waitForReady(deadline, (err) => {
      if (err) {
        console.log(err.message)
        return reject(false)
      }
      return resolve(true)
    })
  })
}
