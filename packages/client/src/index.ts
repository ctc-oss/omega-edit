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

import * as path from 'path'

export * from './change'
export * from './client'
export * from './logger'
export * from './server'
export * from './session'
export * from './version'
export * from './viewport'

// generated files from protoc
export * from './omega_edit_grpc_pb'
export * from './omega_edit_pb'

// ---------------------------------------------------------------------------
// Ensure worker files are resolved properly in bundlers (VS Code, Webpack, etc.)
// ---------------------------------------------------------------------------
if (typeof globalThis !== 'undefined') {
  globalThis.__bundlerPathsOverrides = {
    ...((globalThis as any).__bundlerPathsOverrides || {}),

    // Resolve all required worker files dynamically
    'thread-stream-worker': path.resolve(__dirname, 'thread-stream-worker.js'),
    'pino-worker': path.resolve(__dirname, 'pino-worker.js'),
    'pino-pipeline-worker': path.resolve(__dirname, 'pino-pipeline-worker.js'),
    'pino-file': path.resolve(__dirname, 'pino-file.js'),
  }
}
