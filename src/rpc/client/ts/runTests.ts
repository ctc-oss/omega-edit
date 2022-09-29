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

const { execFileSync, spawn } = require('child_process')
const { exit } = require('process')
const glob = require('glob')
const fs = require('fs')
const os = require('os')
const unzip = require('unzip-stream')

const port = process.env.OMEGA_EDIT_SERVER_PORT || '9000'
const host = process.env.OMEGA_EDIT_SERVER_HOST || '127.0.0.1'

// Extract server
async function extractServer(filePath) {
  await new Promise((res, rej) => {
    let stream = fs
      .createReadStream(`${filePath}.zip`)
      .pipe(unzip.Extract({ path: '.' }))
    stream.on('close', () => {
      try {
        res(`${filePath}.zip`)
      } catch (err) {
        rej(err)
      }
    })
  })
}

// Run Scala gRPC server
function startServer(filePath) {
  if (!os.platform().toLowerCase().startsWith('win')) {
    execFileSync('chmod', ['+x', `${filePath}/bin/omega-edit-grpc-server`])
  }

  let scriptName = os.platform().toLowerCase().startsWith('win')
    ? `./${filePath}/bin/omega-edit-grpc-server.bat`
    : `./${filePath}/bin/omega-edit-grpc-server`

  if (!fs.existsSync(scriptName)) {
    console.error(`${scriptName} is missing`)
    exit(1)
  }
  console.log(`Running: ${scriptName} --interface=${host} --port=${port}`)
  const server_process = spawn(
    scriptName,
    [`--interface=${host}`, `--port=${port}`],
    {
      stdio: 'ignore',
      detached: true,
    }
  )
  console.log(`Server PID: ${server_process.pid.toString()}`)
  fs.writeFileSync('.server_pid', server_process.pid.toString())
}

// Method to getFilePath based on the name of the server package
function getFilePath() {
  const serverFilePaths = glob.sync('omega-edit-grpc-server-*', {
    cwd: '.',
  })

  let serverFilePath = ''

  for (let i = 0; i < serverFilePaths.length; i++) {
    if (serverFilePaths[i].includes('.zip')) {
      serverFilePath = serverFilePaths[i].replace('.zip', '')
      break
    }
  }

  return serverFilePath !== '' && fs.existsSync(`${serverFilePath}.zip`)
    ? serverFilePath
    : ''
}

// Stop Scala gRPC server
function stopServer() {
  const serverFilePath = getFilePath()
  if (serverFilePath === '') {
    console.error('server file path not found')
    exit(1)
  }

  if (fs.existsSync('.server_pid')) {
    const pid = fs.readFileSync('.server_pid').toString()
    process.kill(pid)
    fs.rmSync('.server_pid')
    console.log(`Server with PID ${pid} has been shutdown`)
  }

  fs.rmdirSync(serverFilePath, { recursive: true })
}

// Run server by first extracting server then starting it
async function runScalaServer() {
  const filePath = getFilePath()
  if (filePath === '') {
    console.error('server file path not found')
    exit(1)
  }
  extractServer(filePath)
    .then(() => startServer(filePath))
    .catch((err) => console.error(err))
}

module.exports = {
  stopScalaServer: stopServer,
  runScalaServer: runScalaServer,
}

if (process.argv.includes('runScalaServer')) {
  runScalaServer().then(() => exit(0))
} else if (process.argv.includes('stopScalaServer')) {
  stopServer()
}
