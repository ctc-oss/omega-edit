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

import type { ChildProcess } from 'child_process'

/**
 * Local compile-time contract for `@omega-edit/server`.
 *
 * The published package exposes generated declarations from `packages/server/out`,
 * but a fresh monorepo checkout does not have those build artifacts yet. The
 * client only needs a small surface from the server package at compile time, so
 * we provide that contract here and keep the runtime import pointing at the real
 * package name.
 */
export interface HeartbeatOptions {
  sessionTimeoutMs?: number
  cleanupIntervalMs?: number
  shutdownWhenNoSessions?: boolean
  sessionEventQueueCapacity?: number
  viewportEventQueueCapacity?: number
  maxChangeBytes?: number
  maxViewportsPerSession?: number
}

export declare function runServer(
  port: number,
  host?: string,
  pidfile?: string,
  heartbeat?: HeartbeatOptions
): Promise<ChildProcess>

export declare function runServerWithArgs(
  args: string[],
  heartbeat?: HeartbeatOptions
): Promise<ChildProcess>

declare const omegaEditServer: {
  runServer: typeof runServer
  runServerWithArgs: typeof runServerWithArgs
}

export default omegaEditServer
