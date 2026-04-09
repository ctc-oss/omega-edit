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
  createViewport,
  createSession,
  createSimpleFileLogger,
  delay,
  destroySession,
  getComputedFileSize,
  getClient,
  getServerHeartbeat,
  getSessionCount,
  getViewportCount,
  HeartbeatOptions,
  insert,
  overwrite,
  pidIsRunning,
  replaceSessionCheckpointed,
  resetClient,
  setLogger,
  startServer,
  startServerUnixSocket,
  stopProcessUsingPID,
  stopServerGraceful,
  stopServerImmediate,
  stopServiceOnPort,
} from '@omega-edit/client'
import {
  expect,
  expectOpaqueId,
  initChai,
  testHost,
  testPort,
  testTransport,
} from './common.js'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as fsPromises from 'fs/promises'
import { getModuleCompat } from './moduleCompat.js'

const { __dirname } = getModuleCompat(import.meta.url)
const rootPath = path.resolve(__dirname, '../..')

function expectResourceExhausted(err: unknown, details: string) {
  expect(err).to.be.instanceOf(Error)
  expect((err as Error).message).to.include('RESOURCE_EXHAUSTED')
  expect((err as Error).message).to.include(details)
}

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
      expectOpaqueId(session_id, 'sess_')
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
    const response = await stopServerGraceful()
    expect(response.responseCode).to.equal(0)
    expect(response.status).to.equal('draining')
    expect(response.serverProcessId).to.equal(pid)

    // for graceful shutdown, the server should still be running until the session count drops to 0
    expect(pidIsRunning(pid as number)).to.be.true

    // once the server is stopping gracefully, no new sessions should be allowed
    try {
      await createSession()
      expect.fail('createSession should reject while graceful shutdown drains')
    } catch (err) {
      expect((err as Error).message).to.include('UNAVAILABLE')
      expect((err as Error).message).to.include('server is shutting down')
    }
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

  it(`on port ${serverTestPort} should stop gracefully via API when no sessions are active`, async () => {
    expect(await destroySession(session_id)).to.equal(session_id)
    expect(await getSessionCount()).to.equal(0)

    const response = await stopServerGraceful()
    expect(response.responseCode).to.equal(0)
    expect(response.status).to.equal('completed')
    expect(response.serverProcessId).to.equal(pid)

    for (let i = 0; i < 20; ++i) {
      await delay(100)
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

  const heartbeat: HeartbeatOptions = {
    sessionTimeoutMs: 500,
    cleanupIntervalMs: 50,
    shutdownWhenNoSessions: false,
  }

  const waitForSessionCount = async (
    expected: number,
    timeoutMs: number,
    allowUnavailable: boolean = false
  ): Promise<void> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        if ((await getSessionCount()) === expected) return
      } catch (err) {
        if (allowUnavailable) return
        throw err
      }
      await delay(50)
    }

    if (allowUnavailable) return
    expect(await getSessionCount()).to.equal(expected)
  }

  beforeEach(`start server on port ${serverTestPort}`, async () => {
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
        false,
        serverTestPort,
        testHost,
        heartbeat
      )
    } else {
      delete process.env.OMEGA_EDIT_SERVER_SOCKET
      delete process.env.OMEGA_EDIT_SERVER_URI
      expect(await stopServiceOnPort(serverTestPort)).to.be.true
      pid = await startServer(serverTestPort, undefined, undefined, heartbeat)
    }
    expect(pid).to.be.a('number').greaterThan(0)
    expect(pidIsRunning(pid as number)).to.be.true
    resetClient()
    expect(await getClient(serverTestPort)).to.not.be.undefined
    expect(await getSessionCount()).to.equal(0)
  })

  afterEach(`stop server on port ${serverTestPort}`, async () => {
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
    expectOpaqueId(session_id, 'sess_')
    expect(await getSessionCount()).to.equal(1)

    // Send a heartbeat to keep it alive.
    await delay(50)
    await getServerHeartbeat([session_id])
    await delay(100)
    await getServerHeartbeat([session_id])
    await delay(100)
    expect(await getSessionCount()).to.equal(1)

    // Stop heartbeating and wait for the server to reap it.
    await waitForSessionCount(0, 2000)
  })

  it(`on port ${serverTestPort} should keep sessions alive via normal session RPCs (no heartbeat)`, async () => {
    const session_id = (await createSession()).getSessionId()
    expectOpaqueId(session_id, 'sess_')
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

  it(`on port ${serverTestPort} should reap an idle shared session in a single timeout window`, async () => {
    const tempDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-heartbeat-shared-idle-')
    )
    const sharedFilePath = path.join(tempDir, 'shared-session.txt')

    try {
      await fsPromises.writeFile(sharedFilePath, 'shared heartbeat test')
      const authors = await Promise.all(
        Array.from({ length: 5 }, () => createSession(sharedFilePath))
      )

      for (const author of authors.slice(1)) {
        expect(author.getSessionId()).to.equal(authors[0].getSessionId())
      }
      expect(await getSessionCount()).to.equal(1)

      // A shared session should be fully reaped on the first cleanup pass
      // after the timeout, not one attachment per cleanup interval. Using
      // several attachments widens the regression gap on slower macOS runners:
      // a buggy detach-per-cycle implementation needs multiple extra reaper
      // ticks before teardown completes. Allow a wider observation window so
      // cleanup cadence and scheduler jitter do not make this assertion flaky.
      await delay(625)
      await waitForSessionCount(0, 250)
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true })
    }
  })

  it(`on port ${serverTestPort} should not extend shared session lifetime when one author detaches`, async () => {
    const tempDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'omega-edit-heartbeat-')
    )
    const sharedFilePath = path.join(tempDir, 'shared-session.txt')

    try {
      await fsPromises.writeFile(sharedFilePath, 'shared heartbeat test')
      const author1 = await createSession(sharedFilePath)
      const author2 = await createSession(sharedFilePath)
      const sharedSessionId = author1.getSessionId()

      expect(author2.getSessionId()).to.equal(sharedSessionId)
      expect(await getSessionCount()).to.equal(1)

      // Detaching one author should not count as activity for the shared
      // session, so the remaining idle attachment should still expire on the
      // original timeout schedule. Use a wider timeout window here so the
      // correct behavior and a detach-driven refresh stay far apart even on
      // slower macOS runners.
      await delay(425)
      expect(await destroySession(sharedSessionId)).to.equal(sharedSessionId)
      await waitForSessionCount(0, 250)
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('Server Shutdown When No Sessions', () => {
  let pid: number | undefined
  const serverTestPort = testPort + 2
  const isUds = testTransport === 'uds'
  const socketPath = path.join(
    rootPath,
    `.server-shutdown-when-idle-${serverTestPort}.sock`
  )

  const heartbeat: HeartbeatOptions = {
    sessionTimeoutMs: 200,
    cleanupIntervalMs: 50,
    shutdownWhenNoSessions: true,
  }

  const waitForSessionCount = async (
    expected: number,
    timeoutMs: number,
    allowUnavailable: boolean = false
  ): Promise<void> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        if ((await getSessionCount()) === expected) return
      } catch (err) {
        if (allowUnavailable) return
        throw err
      }
      await delay(50)
    }

    if (allowUnavailable) return
    expect(await getSessionCount()).to.equal(expected)
  }

  const waitForPidToExit = async (
    serverPid: number,
    timeoutMs: number
  ): Promise<void> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (!pidIsRunning(serverPid)) return
      await delay(100)
    }
    expect(pidIsRunning(serverPid)).to.be.false
  }

  beforeEach(`start server on port ${serverTestPort}`, async () => {
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
        false,
        serverTestPort,
        testHost,
        heartbeat
      )
    } else {
      delete process.env.OMEGA_EDIT_SERVER_SOCKET
      delete process.env.OMEGA_EDIT_SERVER_URI
      expect(await stopServiceOnPort(serverTestPort)).to.be.true
      pid = await startServer(serverTestPort, undefined, undefined, heartbeat)
    }

    expect(pid).to.be.a('number').greaterThan(0)
    expect(pidIsRunning(pid as number)).to.be.true
    resetClient()
    expect(await getClient(serverTestPort)).to.not.be.undefined
    expect(await getSessionCount()).to.equal(0)
  })

  afterEach(`cleanup server on port ${serverTestPort}`, async () => {
    if (pid !== undefined && pidIsRunning(pid)) {
      if (isUds) {
        await stopProcessUsingPID(pid)
      } else {
        await stopServiceOnPort(serverTestPort)
      }
    }

    if (isUds) {
      try {
        fs.unlinkSync(socketPath)
      } catch {
        // ignore
      }
    }

    if (pid !== undefined) {
      expect(pidIsRunning(pid)).to.be.false
    }
  })

  it(`on port ${serverTestPort} should exit after reaping the last session`, async () => {
    const session_id = (await createSession()).getSessionId()
    expectOpaqueId(session_id, 'sess_')

    await delay(50)
    await getServerHeartbeat([session_id])
    await delay(100)
    await getServerHeartbeat([session_id])

    await waitForSessionCount(0, 2000, true)
    await waitForPidToExit(pid as number, 15000)
  })
})

describe('Server Resource Limits', () => {
  let pid: number | undefined
  let session_id: string
  const serverTestPort = testPort + 3
  const isUds = testTransport === 'uds'
  const socketPath = path.join(
    rootPath,
    `.server-resource-limits-${serverTestPort}.sock`
  )

  const heartbeat: HeartbeatOptions = {
    maxChangeBytes: 1,
    maxViewportsPerSession: 1,
    sessionEventQueueCapacity: 1,
    viewportEventQueueCapacity: 1,
  }

  beforeEach(`start limit-aware server on port ${serverTestPort}`, async () => {
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
        false,
        serverTestPort,
        testHost,
        heartbeat
      )
    } else {
      delete process.env.OMEGA_EDIT_SERVER_SOCKET
      delete process.env.OMEGA_EDIT_SERVER_URI
      expect(await stopServiceOnPort(serverTestPort)).to.be.true
      pid = await startServer(serverTestPort, undefined, undefined, heartbeat)
    }

    expect(pid).to.be.a('number').greaterThan(0)
    expect(pidIsRunning(pid as number)).to.be.true
    resetClient()
    expect(await getClient(serverTestPort)).to.not.be.undefined
    session_id = (await createSession()).getSessionId()
    expectOpaqueId(session_id, 'sess_')
  })

  afterEach(`stop limit-aware server on port ${serverTestPort}`, async () => {
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

  it(`on port ${serverTestPort} should reject insert payloads larger than the configured limit`, async () => {
    await insert(session_id, 0, Uint8Array.from([0x41]))

    try {
      await insert(session_id, 1, Uint8Array.from([0x42, 0x43]))
      expect.fail('insert should reject payloads larger than maxChangeBytes')
    } catch (err) {
      expectResourceExhausted(err, 'configured limit of 1 bytes')
    }
  })

  it(`on port ${serverTestPort} should reject overwrite payloads larger than the configured limit`, async () => {
    await insert(session_id, 0, Uint8Array.from([0x41]))

    try {
      await overwrite(session_id, 0, Uint8Array.from([0x42, 0x43]))
      expect.fail('overwrite should reject payloads larger than maxChangeBytes')
    } catch (err) {
      expectResourceExhausted(err, 'configured limit of 1 bytes')
    }
  })

  it(`on port ${serverTestPort} should reject checkpointed replace patterns larger than the configured limit`, async () => {
    await insert(session_id, 0, Uint8Array.from([0x41]))

    try {
      await replaceSessionCheckpointed(
        session_id,
        Uint8Array.from([0x41, 0x42]),
        Uint8Array.from([0x43]),
        false,
        0,
        0
      )
      expect.fail(
        'replaceSessionCheckpointed should reject patterns larger than maxChangeBytes'
      )
    } catch (err) {
      expectResourceExhausted(err, 'configured limit of 1 bytes')
    }
  })

  it(`on port ${serverTestPort} should reject checkpointed replace replacements larger than the configured limit`, async () => {
    await insert(session_id, 0, Uint8Array.from([0x41]))

    try {
      await replaceSessionCheckpointed(
        session_id,
        Uint8Array.from([0x41]),
        Uint8Array.from([0x42, 0x43]),
        false,
        0,
        0
      )
      expect.fail(
        'replaceSessionCheckpointed should reject replacements larger than maxChangeBytes'
      )
    } catch (err) {
      expectResourceExhausted(err, 'configured limit of 1 bytes')
    }
  })

  it(`on port ${serverTestPort} should reject opening more viewports than configured`, async () => {
    const firstViewport = await createViewport(undefined, session_id, 0, 8)
    expect(firstViewport.getViewportId()).to.match(
      new RegExp(
        `^${session_id}:vp_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`
      )
    )
    expect(await getViewportCount(session_id)).to.equal(1)

    try {
      await createViewport(undefined, session_id, 0, 8)
      expect.fail(
        'createViewport should reject once maxViewportsPerSession is reached'
      )
    } catch (err) {
      expectResourceExhausted(err, 'configured viewport limit of 1')
    }

    expect(await getViewportCount(session_id)).to.equal(1)
  })

  it(`on port ${serverTestPort} should generate opaque sess_ IDs for unmanaged sessions`, async () => {
    const session = await createSession()

    try {
      expectOpaqueId(session.getSessionId(), 'sess_')
    } finally {
      await destroySession(session.getSessionId())
    }
  })
})

// Tests involving running the server
// Created for investigating https://github.com/apache/daffodil-vscode/pull/1277 and https://github.com/apache/daffodil-vscode/issues/1075

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
    expectOpaqueId(session_id, 'sess_')
    expect(await getSessionCount()).to.equal(1)
  })
})
