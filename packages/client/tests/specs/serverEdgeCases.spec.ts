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

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, initChai } from './common.js'
import { overrideProperty, silenceClientLogger } from './mockHelpers.js'
import { getModuleCompat } from './moduleCompat.js'

const { require } = getModuleCompat(import.meta.url)
const clientPackage =
  require('../../dist/cjs/index.js') as typeof import('../../src/index')
let clientModule: typeof import('../../src/client')
let serverModule: typeof import('../../src/server')
const {
  delay,
  findFirstAvailablePort,
  getServerHeartbeat,
  getServerInfo,
  pidIsRunning,
  resetClient,
  startServer,
  startServerUnixSocket,
  stopProcessUsingPID,
  stopServiceOnPort,
  stopServerImmediate,
} = clientPackage

describe('Server Edge Cases', () => {
  let restoreLogger = () => {}
  let originalServerUri: string | undefined
  let originalServerSocket: string | undefined

  before(async () => {
    await initChai()
    delete require.cache[require.resolve('../../dist/cjs/logger.js')]
    delete require.cache[require.resolve('../../dist/cjs/client.js')]
    delete require.cache[require.resolve('../../dist/cjs/server.js')]
    restoreLogger = silenceClientLogger(require)
    clientModule =
      require('../../dist/cjs/client.js') as typeof import('../../src/client')
    serverModule =
      require('../../dist/cjs/server.js') as typeof import('../../src/server')
  })

  beforeEach(() => {
    originalServerUri = process.env.OMEGA_EDIT_SERVER_URI
    originalServerSocket = process.env.OMEGA_EDIT_SERVER_SOCKET
  })

  afterEach(() => {
    resetClient()
    if (originalServerUri === undefined) {
      delete process.env.OMEGA_EDIT_SERVER_URI
    } else {
      process.env.OMEGA_EDIT_SERVER_URI = originalServerUri
    }
    if (originalServerSocket === undefined) {
      delete process.env.OMEGA_EDIT_SERVER_SOCKET
    } else {
      process.env.OMEGA_EDIT_SERVER_SOCKET = originalServerSocket
    }
  })

  after(() => {
    restoreLogger()
  })

  it('should start a source server with a stale pid file and query info endpoints', async () => {
    delete process.env.OMEGA_EDIT_SERVER_URI
    delete process.env.OMEGA_EDIT_SERVER_SOCKET
    resetClient()

    const port = await findFirstAvailablePort(9200, 9300)
    expect(port).to.not.equal(null)

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-src-'))
    const pidFile = path.join(tempDir, 'omega-edit.pid')
    fs.writeFileSync(pidFile, '999999')

    let pid: number | undefined
    let pidFromFile: number | undefined
    let serverInfoPid: number | undefined
    try {
      pid = await startServer(port as number, '127.0.0.1', pidFile)
      expect(pid).to.be.a('number').greaterThan(0)
      expect(pidIsRunning(pid as number)).to.be.true
      expect(fs.existsSync(pidFile)).to.be.true

      pidFromFile = Number(fs.readFileSync(pidFile, 'utf8').trim())
      expect(pidFromFile).to.be.greaterThan(0)

      if (process.platform === 'win32') {
        expect(pidIsRunning(pidFromFile)).to.be.true
      } else {
        expect(pidFromFile).to.equal(pid)
      }

      const serverInfo = await getServerInfo()
      expect(serverInfo.serverHostname).to.be.a('string').and.not.be.empty
      serverInfoPid = serverInfo.serverProcessId
      expect(serverInfo.serverProcessId).to.be.greaterThan(0)

      if (process.platform === 'win32') {
        expect(pidIsRunning(serverInfo.serverProcessId)).to.be.true
      } else {
        expect(serverInfo.serverProcessId).to.equal(pidFromFile)
      }

      expect(serverInfo.serverVersion).to.be.a('string').and.not.be.empty
      expect(serverInfo.runtimeKind).to.equal('native')
      expect(serverInfo.runtimeName).to.be.a('string').and.not.be.empty
      expect(serverInfo.platform).to.be.a('string').and.not.be.empty
      expect(serverInfo.availableProcessors).to.be.greaterThan(0)
      expect(serverInfo.compiler).to.be.a('string').and.not.be.empty
      expect(serverInfo.buildType).to.be.a('string').and.not.be.empty
      expect(serverInfo.cppStandard).to.be.a('string').and.not.be.empty

      const heartbeat = await getServerHeartbeat([], 250)
      expect(heartbeat.latency).to.be.greaterThanOrEqual(0)
      expect(heartbeat.sessionCount).to.equal(0)
      expect(heartbeat.serverCpuCount).to.be.greaterThanOrEqual(0)
      if (heartbeat.serverCpuLoadAverage !== undefined) {
        expect(heartbeat.serverCpuLoadAverage).to.be.a('number')
      }
      if (heartbeat.serverResidentMemoryBytes !== undefined) {
        expect(heartbeat.serverResidentMemoryBytes).to.be.greaterThanOrEqual(0)
      }
      if (heartbeat.serverVirtualMemoryBytes !== undefined) {
        expect(heartbeat.serverVirtualMemoryBytes).to.be.greaterThanOrEqual(0)
      }
      if (heartbeat.serverPeakResidentMemoryBytes !== undefined) {
        expect(
          heartbeat.serverPeakResidentMemoryBytes
        ).to.be.greaterThanOrEqual(0)
      }
      if (process.platform === 'win32') {
        expect(heartbeat.serverVirtualMemoryBytes).to.equal(undefined)
      }

      expect((await stopServerImmediate()).responseCode).to.equal(0)
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await delay(100)
        if (await stopServiceOnPort(port as number)) {
          break
        }
      }
    } finally {
      await stopServiceOnPort(port as number, 'SIGKILL')

      const cleanupCandidates = [pidFromFile, serverInfoPid]
      for (const cleanupPid of cleanupCandidates) {
        if (cleanupPid && pidIsRunning(cleanupPid)) {
          await stopProcessUsingPID(cleanupPid, 'SIGKILL')
        }
      }

      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }).timeout(15000)

  it('should leave deprecated native server health fields at protobuf defaults', async () => {
    const port = await findFirstAvailablePort(9200, 9300)
    expect(port).to.not.equal(null)

    let pid: number | undefined
    try {
      resetClient()
      pid = await startServer(port as number, '127.0.0.1')
      expect(pid).to.be.a('number').greaterThan(0)
      expect(pidIsRunning(pid as number)).to.be.true

      const client = await clientModule.getClient(port as number, '127.0.0.1')
      const serverInfo = await new Promise<Record<string, any>>(
        (resolve, reject) => {
          client.getServerInfo({}, (err, response) => {
            if (err) {
              reject(err)
              return
            }
            resolve(response as Record<string, any>)
          })
        }
      )

      expect(serverInfo.jvmVersion).to.equal('')
      expect(serverInfo.jvmVendor).to.equal('')
      expect(serverInfo.jvmPath).to.equal('')

      const heartbeat = await new Promise<Record<string, any>>(
        (resolve, reject) => {
          client.getHeartbeat(
            {
              hostname: os.hostname(),
              processId: process.pid,
              heartbeatInterval: 250,
              sessionIds: [],
            },
            (err, response) => {
              if (err) {
                reject(err)
                return
              }
              resolve(response as Record<string, any>)
            }
          )
        }
      )
      const wrappedHeartbeat = await getServerHeartbeat([], 250)

      expect(heartbeat.maxMemory).to.equal(0)
      expect(heartbeat.committedMemory).to.equal(0)
      expect(heartbeat.usedMemory).to.equal(0)
      if (heartbeat.loadAverage === undefined) {
        expect(heartbeat.cpuLoadAverage).to.equal(0)
        expect(wrappedHeartbeat.serverCpuLoadAverage).to.equal(undefined)
      } else {
        expect(heartbeat.cpuLoadAverage).to.equal(heartbeat.loadAverage)
        expect(wrappedHeartbeat.serverCpuLoadAverage).to.not.equal(undefined)
        expect(wrappedHeartbeat.serverCpuLoadAverage).to.be.a('number')
      }
    } finally {
      await stopServiceOnPort(port as number, 'SIGKILL')
      if (pid && pidIsRunning(pid)) {
        await stopProcessUsingPID(pid, 'SIGKILL')
      }
    }
  }).timeout(15000)

  it('should start a UDS-only server after removing a stale socket file', async function () {
    if (process.platform === 'win32') {
      this.skip()
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-uds-'))
    const socketPath = path.join(tempDir, 'omega-edit.sock')
    const pidFile = path.join(tempDir, 'omega-edit.pid')
    fs.writeFileSync(socketPath, 'stale')

    let pid: number | undefined
    try {
      process.env.OMEGA_EDIT_SERVER_SOCKET = socketPath
      delete process.env.OMEGA_EDIT_SERVER_URI

      resetClient()
      pid = await startServerUnixSocket(socketPath, pidFile, true)
      expect(pid).to.be.a('number').greaterThan(0)
      expect(pidIsRunning(pid as number)).to.be.true
      expect(fs.existsSync(socketPath)).to.be.true
      expect(fs.lstatSync(socketPath).isSocket()).to.be.true
      expect(fs.readFileSync(pidFile, 'utf8').trim()).to.equal(String(pid))

      const serverInfo = await getServerInfo()
      expect(serverInfo.serverProcessId).to.equal(pid)

      expect((await stopServerImmediate()).responseCode).to.equal(0)
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await delay(100)
        if (!pidIsRunning(pid as number)) {
          break
        }
      }
      expect(pidIsRunning(pid as number)).to.be.false
    } finally {
      if (pid && pidIsRunning(pid)) {
        await stopProcessUsingPID(pid, 'SIGKILL')
      }
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }).timeout(20000)

  it('should verify UDS startup against the launched socket endpoint', async function () {
    if (process.platform === 'win32') {
      this.skip()
    }

    const tcpPort = await findFirstAvailablePort(9401, 9500)
    expect(tcpPort).to.not.equal(null)

    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'omega-edit-uds-target-')
    )
    const tcpPidFile = path.join(tempDir, 'omega-edit-tcp.pid')
    const socketPath = path.join(tempDir, 'omega-edit.sock')
    const udsPidFile = path.join(tempDir, 'omega-edit-uds.pid')

    let tcpPid: number | undefined
    let udsPid: number | undefined
    try {
      delete process.env.OMEGA_EDIT_SERVER_SOCKET
      delete process.env.OMEGA_EDIT_SERVER_URI
      resetClient()

      tcpPid = await startServer(tcpPort as number, '127.0.0.1', tcpPidFile)
      expect(tcpPid).to.be.a('number').greaterThan(0)
      expect((await getServerInfo()).serverProcessId).to.equal(tcpPid)

      process.env.OMEGA_EDIT_SERVER_SOCKET = socketPath
      delete process.env.OMEGA_EDIT_SERVER_URI

      udsPid = await startServerUnixSocket(socketPath, udsPidFile, true)
      expect(udsPid).to.be.a('number').greaterThan(0)
      expect((await getServerInfo()).serverProcessId).to.equal(udsPid)

      expect(await stopServerImmediate()).to.equal(0)
    } finally {
      delete process.env.OMEGA_EDIT_SERVER_SOCKET
      delete process.env.OMEGA_EDIT_SERVER_URI
      resetClient()

      if (udsPid && pidIsRunning(udsPid)) {
        await stopProcessUsingPID(udsPid, 'SIGKILL')
      }
      if (tcpPid && pidIsRunning(tcpPid)) {
        await stopProcessUsingPID(tcpPid, 'SIGKILL')
      }

      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }).timeout(25000)

  it('should reject server info failures from the RPC client', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        getServerInfo(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('boom'), {
              details: 'rpc failed',
              code: 13,
            })
          )
        },
      })
    )

    try {
      await serverModule.getServerInfo()
      expect.fail('getServerInfo should reject when the RPC returns an error')
    } catch (err) {
      expect(err).to.equal('getServerInfo error: boom')
    } finally {
      restoreGetClient()
    }
  })

  it('should reject undefined server info responses', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        getServerInfo(
          _request: unknown,
          callback: (err: null, response?: unknown) => void
        ) {
          callback(null, undefined)
        },
      })
    )

    try {
      await serverModule.getServerInfo()
      expect.fail('getServerInfo should reject when the RPC response is empty')
    } catch (err) {
      expect(err).to.equal('undefined server info')
    } finally {
      restoreGetClient()
    }
  })

  it('should reject heartbeat failures and empty heartbeat responses', async () => {
    let mode: 'error' | 'empty' = 'error'
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        getHeartbeat(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          if (mode === 'error') {
            callback(
              Object.assign(new Error('heartbeat failed'), {
                details: 'rpc failed',
                code: 14,
              })
            )
            return
          }

          callback(null, undefined)
        },
      })
    )

    try {
      await serverModule.getServerHeartbeat([], 100)
      expect.fail(
        'getServerHeartbeat should reject when the RPC returns an error'
      )
    } catch (err) {
      expect(err).to.equal('getServerHeartbeat error: heartbeat failed')
    }

    mode = 'empty'

    try {
      await serverModule.getServerHeartbeat([], 100)
      expect.fail(
        'getServerHeartbeat should reject when the RPC response is empty'
      )
    } catch (err) {
      expect(err).to.equal('undefined heartbeat')
    } finally {
      restoreGetClient()
    }
  })

  it('should return an error code when server shutdown RPCs fail', async () => {
    let errorMessage = 'Call cancelled'
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        serverControl(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error(errorMessage), {
              code: 13,
            })
          )
        },
      })
    )

    try {
      expect((await serverModule.stopServerImmediate()).responseCode).to.equal(
        -1
      )
      errorMessage = 'INTERNAL: unavailable'
      expect((await serverModule.stopServerImmediate()).responseCode).to.equal(
        -1
      )
    } finally {
      restoreGetClient()
    }
  })

  it('should return nonzero shutdown response codes from the RPC client', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        serverControl(
          _request: unknown,
          callback: (
            err: null,
            response: { getResponseCode(): number; getStatus(): number }
          ) => void
        ) {
          callback(null, {
            getResponseCode() {
              return 7
            },
            getStatus() {
              return 0
            },
          })
        },
      })
    )

    try {
      const response = await serverModule.stopServerImmediate()
      expect(response.responseCode).to.equal(7)
      expect(response.status).to.equal('unknown')
    } finally {
      restoreGetClient()
    }
  })

  it('should return an error code for generic shutdown exceptions', async () => {
    let mode: 'error' | 'string' = 'error'
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        serverControl(
          _request: unknown,
          callback: (err: unknown, response?: unknown) => void
        ) {
          if (mode === 'error') {
            callback(new Error('plain shutdown failure'))
            return
          }

          callback('plain string failure')
        },
      })
    )

    try {
      expect((await serverModule.stopServerImmediate()).responseCode).to.equal(
        -1
      )
      mode = 'string'
      expect((await serverModule.stopServerImmediate()).responseCode).to.equal(
        -1
      )
    } finally {
      restoreGetClient()
    }
  })

  it('should surface unix socket cleanup failures before startup', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'omega-edit-uds-fail-')
    )
    const socketPath = path.join(tempDir, 'omega-edit.sock')
    const fsModule = require('fs') as typeof import('fs')
    const originalUnlinkSync = fsModule.unlinkSync
    fs.writeFileSync(socketPath, 'stale')

    const restoreUnlinkSync = overrideProperty(
      fsModule as Record<string, any>,
      'unlinkSync',
      ((filePath: fs.PathLike) => {
        if (String(filePath) === socketPath) {
          throw Object.assign(new Error('blocked unlink'), {
            code: 'EACCES',
            errno: -13,
            syscall: 'unlink',
            path: socketPath,
          })
        }

        return originalUnlinkSync(filePath)
      }) as typeof fs.unlinkSync
    )

    try {
      await serverModule.startServerUnixSocket(socketPath)
      expect.fail(
        'startServerUnixSocket should reject when stale socket cleanup fails'
      )
    } catch (err) {
      expect((err as Error).message).to.equal('blocked unlink')
    } finally {
      restoreUnlinkSync()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }).timeout(7000)
})
