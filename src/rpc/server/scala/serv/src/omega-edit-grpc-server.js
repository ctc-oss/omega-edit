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

const path = require('path')
const os = require('os')
const child_process = require('child_process')

function runServer(scriptDir, args) {
  const scriptName =
    os.platform() === 'win32'
      ? 'omega-edit-grpc-server.bat'
      : 'omega-edit-grpc-server'
  const scriptPath = path.join(scriptDir, scriptName)

  if (os.platform() !== 'win32') {
    child_process.execFileSync('chmod', ['+x', scriptPath])
  }

  return child_process.spawn(scriptPath, args, {
    cwd: scriptDir,
    stdio: 'ignore',
    detached: true,
  })
}

var args = []
var scriptDir = __dirname

process.argv.forEach(function (val, index, array) {
  if (val.includes('--script-dir=')) {
    scriptDir = val.replace('--script-dir=', '')
  } else if (index > 1) {
    args.push(val)
  }
})

const server = runServer(`${scriptDir}/bin`, args)

server.on('error', (err) => {
  // Call cancelled thrown when server is shutdown
  if (!err.message.includes('Call cancelled')) {
    throw err
  }
})

console.log(`${server.pid}`)
process.exit(0)
