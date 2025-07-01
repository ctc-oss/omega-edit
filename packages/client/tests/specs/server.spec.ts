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

import {
  createSession,
  createSimpleFileLogger,
  delay,
  destroySession,
  getClient,
  getSessionCount,
  pidIsRunning,
  setLogger,
  startServer,
  stopProcessUsingPID,
  stopServerGraceful,
  stopServerImmediate,
  stopServiceOnPort,
} from '@omega-edit/client'
import { expect } from 'chai'
import { testPort } from './common'

const path = require('path')
const rootPath = path.resolve(__dirname, '../..')

describe('Server', () => {
  let pid: number | undefined
  let session_id: string
  const serverTestPort = testPort + 1
  const logFile = path.join(rootPath, 'server-lifecycle-tests.log')
  const level = process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL || 'info'
  const logger = createSimpleFileLogger(logFile, level)

  beforeEach(
    `create on port ${serverTestPort} with a single session`,
    async () => {
      setLogger(logger)
      expect(await stopServiceOnPort(serverTestPort)).to.be.true
      pid = await startServer(serverTestPort)
      expect(pid).to.be.a('number').greaterThan(0)
      expect(pidIsRunning(pid as number)).to.be.true
      expect(await getClient(serverTestPort)).to.not.be.undefined
      expect(await getSessionCount()).to.equal(0)
      session_id = (await createSession()).getSessionId()
      expect(session_id.length).to.equal(36)
      expect(await getSessionCount()).to.equal(1)
    }
  )

  afterEach(`on port ${serverTestPort} should no longer exist`, async () => {
    // after each test, the server should be stopped
    expect(await stopServiceOnPort(serverTestPort)).to.be.true
    expect(pidIsRunning(pid as number)).to.be.false
  })

  it(`on port ${serverTestPort} should stop immediately via stopServiceOnPort using 'SIGTERM'`, async () => {
    expect(pid).to.be.a('number').greaterThan(0)
    // stop the server using its PID should stop the server immediately using the operating system
    expect(await stopServiceOnPort(serverTestPort, 'SIGTERM')).to.be.true
    expect(pidIsRunning(pid as number)).to.be.false
  })

  it(`on port ${serverTestPort} should stop immediately via PID using 'SIGTERM'`, async () => {
    expect(pid).to.be.a('number').greaterThan(0)
    // stop the server using its PID should stop the server immediately using the operating system
    expect(await stopProcessUsingPID(pid as number, 'SIGTERM')).to.be.true
    expect(pidIsRunning(pid as number)).to.be.false
  })

  it(`on port ${serverTestPort} should stop immediately via stopServiceOnPort using 'SIGKILL'`, async () => {
    expect(pid).to.be.a('number').greaterThan(0)
    // stop the server using its PID should stop the server immediately using the operating system
    expect(await stopServiceOnPort(serverTestPort, 'SIGKILL')).to.be.true
    expect(pidIsRunning(pid as number)).to.be.false
  })

  it(`on port ${serverTestPort} should stop immediately via PID using 'SIGKILL'`, async () => {
    expect(pid).to.be.a('number').greaterThan(0)
    // stop the server using its PID should stop the server immediately using the operating system
    expect(await stopProcessUsingPID(pid as number, 'SIGKILL')).to.be.true
    expect(pidIsRunning(pid as number)).to.be.false
  })

  it(`on port ${serverTestPort} should stop gracefully via API`, async () => {
    // stop the server gracefully
    await stopServerGraceful()

    // for graceful shutdown, the server should still be running until the session count drops to 0
    expect(pidIsRunning(pid as number)).to.be.true

    // once the server is stopping gracefully, no new sessions should be allowed
    expect((await createSession()).getSessionId()).to.be.empty
    expect(await getSessionCount()).to.equal(1)

    // destroy the session, dropping the count to 0, then the server should stop
    expect(await destroySession(session_id)).to.equal(session_id)

    // pause for up to 2 seconds to allow server some time to stop
    for (let i = 0; i < 20; ++i) {
      await delay(100) // 0.1 second
      if (!pidIsRunning(pid as number)) {
        break
      }
    }
    expect(pidIsRunning(pid as number)).to.be.false
  })

  it(`on port ${serverTestPort} should stop immediately via API`, async () => {
    // stop the server immediately should stop the server immediately without waiting for sessions to end
    await stopServerImmediate()
    // pause for up to 3 seconds to allow server some time to stop
    for (let i = 0; i < 30; ++i) {
      await delay(100) // 0.1 second
      if (!pidIsRunning(pid as number)) {
        break
      }
    }
    expect(pidIsRunning(pid as number)).to.be.false
  })
})

// Tests involving running the server
// Created for investigating https://github.com/apache/daffodil-vscode/pull/1277 and https://github.com/apache/daffodil-vscode/issues/1075

const fs = require('fs').promises

async function createDirectory(folder_name: string) {
  const dirPath = path.join(__dirname, folder_name)

  try {
    await fs.mkdir(dirPath, { recursive: true })
    console.log(`Directory created at: ${dirPath}`)
  } catch (err: any) {
    console.error(`Error creating directory: ${err.message}`)
  }
}

describe('Directory with Spaces Test', () => {
  createDirectory('space test')
  const originalDir = process.cwd()
  const newDir = path.join(__dirname, 'space test')

  before(() => {
    process.chdir(newDir)
  })

  after(() => {
    // Change back to the original directory
    process.chdir(originalDir)
  })

  it(`should be in the new directory: ${newDir}`, () => {
    expect(process.cwd()).to.equal(newDir)
  })

  const serverTestPort = testPort + 1

  it(`Create on port ${serverTestPort} with a single session and is able to be closed`, async () => {
    // Logging stuff
    const logFile = path.join(
      newDir,
      `server-lifecycle-tests-with-space-${serverTestPort}.log`
    )
    const level = process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL || 'info'
    const logger = createSimpleFileLogger(logFile, level)

    // Create the session on the server test port
    setLogger(logger)
    expect(await stopServiceOnPort(serverTestPort)).to.be.true
    const pid = await startServer(serverTestPort)
    expect(pid).to.be.a('number').greaterThan(0)
    expect(pidIsRunning(pid as number)).to.be.true
    expect(await getClient(serverTestPort)).to.not.be.undefined
    expect(await getSessionCount()).to.equal(0)
    const session_id = (await createSession()).getSessionId()
    expect(session_id.length).to.equal(36)
    expect(await getSessionCount()).to.equal(1)

    //Close the session
    expect(await stopServiceOnPort(serverTestPort)).to.be.true
    expect(pidIsRunning(pid as number)).to.be.false
  })
})
