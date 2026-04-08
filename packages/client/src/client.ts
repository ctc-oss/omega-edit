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

import type * as grpc from '@grpc/grpc-js'
import {
  type ClientConnectionOptions,
  getClient as getSharedClient,
  resetClient as resetSharedClient,
  waitForReady as waitForReadySharedClient,
} from './protobuf_ts/client'

export type { ClientConnectionOptions }

// subscription events
export const NO_EVENTS = 0 // subscribe to no events
export const ALL_EVENTS = ~NO_EVENTS // subscribe to all events

/**
 * Reset the client back to undefined.
 */
export function resetClient() {
  resetSharedClient()
}

/**
 * Returns true when the client is connected and ready to handle requests
 * @param client editor client to wait until its ready
 * @param deadline limit on the amount of time to wait (current time plus 10 seconds by default)
 * @return true of the client is ready to handle requests, and false if it is not ready
 */
export function waitForReady(
  client: grpc.Client,
  deadline?: grpc.Deadline
): Promise<void> {
  return waitForReadySharedClient(client, deadline)
}

/**
 * Gets the connected editor client. Initializes the client if not already
 * @param port port to bind to
 * @param host interface to connect to
 * @return connected editor client
 */
export async function getClient(
  port?: number,
  host?: string,
  options?: ClientConnectionOptions
) {
  return getSharedClient(port, host, options)
}
