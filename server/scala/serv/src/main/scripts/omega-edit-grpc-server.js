#!/usr/bin/env node

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

// Format using: npx prettier --tab-width 2 --no-semi --single-quote

/**
 * @fileoverview
 * This file contains the main entry point for the Omega Edit gRPC server.
 * It is responsible for starting the gRPC server in a platform-agnostic way.
 */

const child_process = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * Run the server
 * @param serverScript server script to run
 * @param args arguments to pass to the server
 * @returns {ChildProcess}
 */
function runServer(serverScript, args) {
  fs.chmodSync(serverScript, '755')
  return child_process.spawn(serverScript, args, {
    cwd: path.dirname(serverScript),
    stdio: 'ignore',
    detached: true,
  })
}

// start the server
const server = runServer(
  path.join(
    path.resolve(__dirname),
    os.platform() === 'win32'
      ? 'omega-edit-grpc-server.bat'
      : 'omega-edit-grpc-server'
  ),
  // pass the arguments to the server without the first two (node and script)
  process.argv.slice(2)
)

server.on('error', (err) => {
  // call cancelled thrown when server is shutdown
  if (!err.message.includes('Call cancelled')) {
    throw err
  }
})

// emit the PID of the server
console.log(server.pid)

// exit the parent process
process.exit(0)
