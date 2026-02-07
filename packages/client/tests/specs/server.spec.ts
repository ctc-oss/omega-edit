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
  getComputedFileSize,
  getClient,
  getServerHeartbeat,
  getSessionCount,
  pidIsRunning,
  resetClient,
  setLogger,
  startServer,
  startServerUnixSocket,
  stopProcessUsingPID,
  stopServerGraceful,
  stopServerImmediate,
  stopServiceOnPort,
} from '@omega-edit/client'
import { expect, initChai, testHost, testPort, testTransport } from './common'
import * as fs from 'fs'
import * as os from 'os'

const path = require('path')
const rootPath = path.resolve(__dirname, '../..')

describe('Server', () => {
  let pid: number | undefined
  let session_id: string
  const serverTestPort = testPort + 1
  const isUds = testTransport === 'uds'
  const socketPath = path.join(
    rootPath,
    `.server-lifecycle-${serverTestPort}.sock`
  )
  const logFile = path.join(rootPath, 'server-lifecycle-tests.log')
  const level = process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL || 'info'
  const logger = createSimpleFileLogger(logFile, level)

  before(async () => {
    await initChai()
  })

  beforeEach(
    `create on port ${serverTestPort} with a single session`,
    async () => {
      setLogger(logger)
      if (isUds) {
        const udsJavaHome = process.env.OMEGA_EDIT_TEST_JAVA_HOME
        if (udsJavaHome) {
          process.env.JAVA_HOME = udsJavaHome
          const currentPath = process.env.PATH || ''
          if (!currentPath.includes(`${udsJavaHome}/bin`)) {
            process.env.PATH = `${udsJavaHome}/bin:${currentPath}`
          }
        }

        process.env.OMEGA_EDIT_SERVER_SOCKET = socketPath
        delete process.env.OMEGA_EDIT_SERVER_URI
        pid = await startServerUnixSocket(
          socketPath,
          undefined,
          undefined,
          false,
          serverTestPort,
          testHost
        )
      } else {
        delete process.env.OMEGA_EDIT_SERVER_SOCKET
        delete process.env.OMEGA_EDIT_SERVER_URI
        expect(await stopServiceOnPort(serverTestPort)).to.be.true
        pid = await startServer(serverTestPort)
      }
      expect(pid).to.be.a('number').greaterThan(0)
      expect(pidIsRunning(pid as number)).to.be.true
      resetClient()
      expect(await getClient(serverTestPort)).to.not.be.undefined
      expect(await getSessionCount()).to.equal(0)
      session_id = (await createSession()).getSessionId()
      expect(session_id.length).to.equal(36)
      expect(await getSessionCount()).to.equal(1)
    }
  )

  afterEach(`on port ${serverTestPort} should no longer exist`, async () => {
    // after each test, the server should be stopped
    if (isUds) {
      expect(await stopProcessUsingPID(pid as number)).to.be.true
      try {
        fs.unlinkSync(socketPath)
      } catch {
        // ignore
      }
    } else {
      expect(await stopServiceOnPort(serverTestPort)).to.be.true
    }
    expect(pidIsRunning(pid as number)).to.be.false
  })

  it(`on port ${serverTestPort} should stop immediately via stopServiceOnPort using 'SIGTERM'`, async () => {
    expect(pid).to.be.a('number').greaterThan(0)
    // stop the server using its PID should stop the server immediately using the operating system
    if (isUds) {
      expect(await stopProcessUsingPID(pid as number, 'SIGTERM')).to.be.true
    } else {
      expect(await stopServiceOnPort(serverTestPort, 'SIGTERM')).to.be.true
    }
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
    if (isUds) {
      expect(await stopProcessUsingPID(pid as number, 'SIGKILL')).to.be.true
    } else {
      expect(await stopServiceOnPort(serverTestPort, 'SIGKILL')).to.be.true
    }
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

describe('Server Heartbeat Timeout', () => {
  let pid: number | undefined
  const serverTestPort = testPort + 1
  const isUds = testTransport === 'uds'
  const socketPath = path.join(
    rootPath,
    `.server-heartbeat-${serverTestPort}.sock`
  )

  const originalJavaOpts = process.env.JAVA_OPTS
  const heartbeatJavaOpts = [
    '-Domega-edit.grpc.heartbeat.session-timeout=200ms',
    '-Domega-edit.grpc.heartbeat.cleanup-interval=50ms',
    '-Domega-edit.grpc.heartbeat.shutdown-when-no-sessions=false',
  ].join(' ')

  const waitForSessionCount = async (
    expected: number,
    timeoutMs: number
  ): Promise<void> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if ((await getSessionCount()) === expected) return
      await delay(50)
    }
    expect(await getSessionCount()).to.equal(expected)
  }

  beforeEach(`start server on port ${serverTestPort}`, async () => {
    // Override JAVA_OPTS so this server instance uses a short heartbeat timeout.
    process.env.JAVA_OPTS = originalJavaOpts
      ? `${originalJavaOpts} ${heartbeatJavaOpts}`
      : heartbeatJavaOpts

    if (isUds) {
      const udsJavaHome = process.env.OMEGA_EDIT_TEST_JAVA_HOME
      if (udsJavaHome) {
        process.env.JAVA_HOME = udsJavaHome
        const currentPath = process.env.PATH || ''
        if (!currentPath.includes(`${udsJavaHome}/bin`)) {
          process.env.PATH = `${udsJavaHome}/bin:${currentPath}`
        }
      }

      process.env.OMEGA_EDIT_SERVER_SOCKET = socketPath
      delete process.env.OMEGA_EDIT_SERVER_URI
      pid = await startServerUnixSocket(
        socketPath,
        undefined,
        undefined,
        false,
        serverTestPort,
        testHost
      )
    } else {
      delete process.env.OMEGA_EDIT_SERVER_SOCKET
      delete process.env.OMEGA_EDIT_SERVER_URI
      expect(await stopServiceOnPort(serverTestPort)).to.be.true
      pid = await startServer(serverTestPort)
    }
    expect(pid).to.be.a('number').greaterThan(0)
    expect(pidIsRunning(pid as number)).to.be.true
    resetClient()
    expect(await getClient(serverTestPort)).to.not.be.undefined
    expect(await getSessionCount()).to.equal(0)
  })

  afterEach(`stop server on port ${serverTestPort}`, async () => {
    if (originalJavaOpts === undefined) {
      delete process.env.JAVA_OPTS
    } else {
      process.env.JAVA_OPTS = originalJavaOpts
    }
    if (isUds) {
      expect(await stopProcessUsingPID(pid as number)).to.be.true
      try {
        fs.unlinkSync(socketPath)
      } catch {
        // ignore
      }
    } else {
      expect(await stopServiceOnPort(serverTestPort)).to.be.true
    }
    expect(pidIsRunning(pid as number)).to.be.false
  })

  it(`on port ${serverTestPort} should reap idle sessions`, async () => {
    const session_id = (await createSession()).getSessionId()
    expect(session_id.length).to.equal(36)
    expect(await getSessionCount()).to.equal(1)

    // Send a heartbeat to keep it alive.
    await delay(75)
    await getServerHeartbeat([session_id], 50)
    await delay(150)
    expect(await getSessionCount()).to.equal(1)

    // Stop heartbeating and wait for the server to reap it.
    await delay(600)
    expect(await getSessionCount()).to.equal(0)
  })

  it(`on port ${serverTestPort} should keep sessions alive via normal session RPCs (no heartbeat)`, async () => {
    const session_id = (await createSession()).getSessionId()
    expect(session_id.length).to.equal(36)
    expect(await getSessionCount()).to.equal(1)

    // Keep the session active beyond the 200ms timeout using a regular session RPC.
    for (let i = 0; i < 8; ++i) {
      await getComputedFileSize(session_id)
      await delay(100)
    }
    expect(await getSessionCount()).to.equal(1)

    // Stop activity and verify it eventually expires.
    await waitForSessionCount(0, 2000)
  })
})

// Tests involving running the server
// Created for investigating https://github.com/apache/daffodil-vscode/pull/1277 and https://github.com/apache/daffodil-vscode/issues/1075

const fsPromises = require('fs').promises

describe('Directory with Spaces Test', () => {
  const originalDir = process.cwd()
  const newDir = path.join(__dirname, 'space test')
  const serverTestPort = testPort + 1
  const isUds = testTransport === 'uds'
  const socketPath = isUds
    ? path.join(os.tmpdir(), `.server-space-${serverTestPort}.sock`)
    : path.join(newDir, `.server-space-${serverTestPort}.sock`)

  let pid: number | undefined

  before(async () => {
    await fsPromises.mkdir(newDir, { recursive: true })
  })

  beforeEach(async () => {
    process.chdir(newDir)

    if (isUds) {
      const udsJavaHome = process.env.OMEGA_EDIT_TEST_JAVA_HOME
      if (udsJavaHome) {
        process.env.JAVA_HOME = udsJavaHome
        const currentPath = process.env.PATH || ''
        if (!currentPath.includes(`${udsJavaHome}/bin`)) {
          process.env.PATH = `${udsJavaHome}/bin:${currentPath}`
        }
      }
      process.env.OMEGA_EDIT_SERVER_SOCKET = socketPath
      delete process.env.OMEGA_EDIT_SERVER_URI
    }

    const logFile = path.join(
      newDir,
      `server-lifecycle-tests-with-space-${serverTestPort}.log`
    )
    const level = process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL || 'info'
    const logger = createSimpleFileLogger(logFile, level)

    setLogger(logger)
    expect(process.cwd()).to.equal(newDir)

    if (isUds) {
      pid = await startServerUnixSocket(
        socketPath,
        undefined,
        undefined,
        false,
        serverTestPort,
        testHost
      )
    } else {
      expect(await stopServiceOnPort(serverTestPort)).to.be.true
      pid = await startServer(serverTestPort)
    }
    expect(pid).to.be.a('number').greaterThan(0)
    expect(pidIsRunning(pid as number)).to.be.true

    resetClient()
    expect(await getClient(serverTestPort)).to.not.be.undefined
    expect(await getSessionCount()).to.equal(0)
  })

  afterEach(async () => {
    if (isUds) {
      expect(await stopProcessUsingPID(pid as number)).to.be.true
      try {
        fs.unlinkSync(socketPath)
      } catch {
        // ignore
      }
    } else {
      expect(await stopServiceOnPort(serverTestPort)).to.be.true
    }
    if (pid !== undefined) {
      expect(pidIsRunning(pid)).to.be.false
    }
    process.chdir(originalDir)
    pid = undefined
  })

  it(`should be in the new directory: ${newDir}`, () => {
    expect(process.cwd()).to.equal(newDir)
  })

  it(`Create on port ${serverTestPort} with a single session and is able to be closed`, async () => {
    const session_id = (await createSession()).getSessionId()
    expect(session_id.length).to.equal(36)
    expect(await getSessionCount()).to.equal(1)
  })
})
