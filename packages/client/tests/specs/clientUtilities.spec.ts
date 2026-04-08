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
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { expect, initChai } from './common.js'
import { overrideProperty, silenceClientLogger } from './mockHelpers.js'
import { getModuleCompat } from './moduleCompat.js'

const { require } = getModuleCompat(import.meta.url)
const clientPackage =
  require('../../dist/cjs/index.js') as typeof import('../../src/index')
const clientModule =
  require('../../dist/cjs/client.js') as typeof import('../../src/client')
const grpcModule = require('@grpc/grpc-js') as typeof import('@grpc/grpc-js')
const grpcClientModule = require('../../dist/cjs/omega_edit_grpc_pb.js') as {
  EditorClient: new (...args: any[]) => any
}
const {
  delay,
  findFirstAvailablePort,
  pidIsRunning,
  resetClient,
  stopProcessUsingPID,
  waitForFileToExist,
  waitForReady,
} = clientPackage

describe('Client Utilities', () => {
  let restoreLogger = () => {}
  let originalServerUri: string | undefined
  let originalServerSocket: string | undefined

  before(async () => {
    await initChai()
  })

  beforeEach(() => {
    restoreLogger = silenceClientLogger(require)
    originalServerUri = process.env.OMEGA_EDIT_SERVER_URI
    originalServerSocket = process.env.OMEGA_EDIT_SERVER_SOCKET
  })

  afterEach(() => {
    restoreLogger()
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

  const removeDirWithRetry = async (dirPath: string) => {
    // Temp directory cleanup is best-effort on Windows where logger handles can lag.
    const lockCodes = new Set(['ENOTEMPTY', 'EPERM', 'EBUSY', 'EACCES'])

    for (let attempts = 0; attempts < 20; attempts += 1) {
      try {
        fs.rmSync(dirPath, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        })
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (lockCodes.has(code ?? '')) {
          await delay(200)
          continue
        }
        throw error
      }
    }
  }

  it('should find available ports and detect occupied ranges', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) =>
      server.listen(0, '0.0.0.0', () => resolve())
    )

    const address = server.address()
    expect(address).to.not.be.null
    expect(typeof address).to.not.equal('string')
    const occupiedPort = (address as net.AddressInfo).port

    expect(await findFirstAvailablePort(occupiedPort, occupiedPort)).to.equal(
      null
    )

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err)
        resolve()
      })
    })

    const freePort = await findFirstAvailablePort(occupiedPort, occupiedPort)
    expect(freePort).to.equal(occupiedPort)
  })

  it('should wait for files to appear and time out for missing files', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-file-'))
    const targetFile = path.join(tempDir, 'delayed.txt')
    const missingFile = path.join(tempDir, 'missing.txt')

    const writer = setTimeout(() => {
      fs.writeFileSync(targetFile, 'ready')
    }, 50)

    try {
      expect(await waitForFileToExist(targetFile, 1000)).to.equal(true)

      try {
        await waitForFileToExist(missingFile, 50)
        expect.fail('waitForFileToExist should time out for missing files')
      } catch (err) {
        expect((err as Error).message).to.equal(
          'File does not exist after 50 milliseconds'
        )
      }
    } finally {
      clearTimeout(writer)
      await removeDirWithRetry(tempDir)
    }
  })

  it('should treat missing processes as already stopped', async () => {
    expect(await stopProcessUsingPID(999999, 'SIGTERM', 1, false)).to.be.true
    expect(pidIsRunning(process.pid)).to.be.true
    expect(pidIsRunning(999999)).to.be.false
  })

  it('should fall back to SIGKILL when SIGTERM does not stop a process', async () => {
    const originalKill = process.kill
    let alive = true

    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid !== 424242) {
        return originalKill(pid, signal as NodeJS.Signals)
      }

      if (signal === 0 || signal === undefined) {
        if (alive) {
          return true
        }

        throw Object.assign(new Error('missing'), { code: 'ESRCH' })
      }

      if (signal === 'SIGKILL') {
        alive = false
      }

      return true
    }) as typeof process.kill

    try {
      expect(await stopProcessUsingPID(424242, 'SIGTERM', 2, true)).to.be.true
    } finally {
      process.kill = originalKill
    }
  })

  it('should surface unexpected process stop errors', async () => {
    const originalKill = process.kill

    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid !== 434343) {
        return originalKill(pid, signal as NodeJS.Signals)
      }

      throw Object.assign(new Error('permission denied'), { code: 'EPERM' })
    }) as typeof process.kill

    try {
      expect(await stopProcessUsingPID(434343, 'SIGTERM', 1, false)).to.be.false
    } finally {
      process.kill = originalKill
    }
  })

  it('should wait for client readiness and surface readiness failures', async () => {
    let readyCalls = 0
    const readyClient = {
      waitForReady(_deadline: unknown, callback: (err?: Error) => void) {
        readyCalls += 1
        callback()
      },
    }

    await waitForReady(readyClient as any)
    expect(readyCalls).to.equal(1)

    const failingClient = {
      waitForReady(_deadline: unknown, callback: (err?: Error) => void) {
        callback(new Error('not ready'))
      },
    }

    try {
      await waitForReady(failingClient as any)
      expect.fail('waitForReady should reject when the client is not ready')
    } catch (err) {
      expect((err as Error).message).to.equal('not ready')
    }
  })

  it('should fall back from a unix socket candidate to TCP client creation', async () => {
    resetClient()
    const uris: string[] = []
    const closedUris: string[] = []

    class FakeEditorClient {
      uri: string

      constructor(uri: string) {
        this.uri = uri
        uris.push(uri)
      }

      waitForReady(_deadline: unknown, callback: (err?: Error) => void) {
        if (this.uri.startsWith('unix:')) {
          callback(new Error('uds unavailable'))
          return
        }

        callback()
      }

      close() {
        closedUris.push(this.uri)
      }
    }

    const restoreEditorClient = overrideProperty(
      grpcClientModule as Record<string, any>,
      'EditorClient',
      FakeEditorClient
    )
    const restoreCreateInsecure = overrideProperty(
      grpcModule.credentials as Record<string, any>,
      'createInsecure',
      () => ({})
    )

    try {
      process.env.OMEGA_EDIT_SERVER_SOCKET = 'relative.sock'
      delete process.env.OMEGA_EDIT_SERVER_URI

      const client = await clientModule.getClient(9310, '127.0.0.1')
      expect(client).to.be.instanceOf(FakeEditorClient)
      expect(uris).to.deep.equal(['unix:relative.sock', '127.0.0.1:9310'])
      expect(closedUris).to.deep.equal(['unix:relative.sock'])
    } finally {
      resetClient()
      restoreCreateInsecure()
      restoreEditorClient()
    }
  })

  it('should close the cached client when resetClient is called', async () => {
    resetClient()
    let closeCalls = 0

    class FakeEditorClient {
      constructor(_uri: string) {}

      waitForReady(_deadline: unknown, callback: (err?: Error) => void) {
        callback()
      }

      close() {
        closeCalls += 1
      }
    }

    const restoreEditorClient = overrideProperty(
      grpcClientModule as Record<string, any>,
      'EditorClient',
      FakeEditorClient
    )
    const restoreCreateInsecure = overrideProperty(
      grpcModule.credentials as Record<string, any>,
      'createInsecure',
      () => ({})
    )

    try {
      await clientModule.getClient(9312, '127.0.0.1')
      expect(closeCalls).to.equal(0)

      resetClient()
      expect(closeCalls).to.equal(1)

      resetClient()
      expect(closeCalls).to.equal(1)
    } finally {
      restoreCreateInsecure()
      restoreEditorClient()
    }
  })

  it('should keep separate cached clients per endpoint and close them on reset', async () => {
    resetClient()
    delete process.env.OMEGA_EDIT_SERVER_URI
    delete process.env.OMEGA_EDIT_SERVER_SOCKET
    const uris: string[] = []
    const closedUris: string[] = []

    class FakeEditorClient {
      uri: string

      constructor(uri: string) {
        this.uri = uri
        uris.push(uri)
      }

      waitForReady(_deadline: unknown, callback: (err?: Error) => void) {
        callback()
      }

      close() {
        closedUris.push(this.uri)
      }
    }

    const restoreEditorClient = overrideProperty(
      grpcClientModule as Record<string, any>,
      'EditorClient',
      FakeEditorClient
    )
    const restoreCreateInsecure = overrideProperty(
      grpcModule.credentials as Record<string, any>,
      'createInsecure',
      () => ({})
    )

    try {
      const tcpClient = await clientModule.getClient(9314, '127.0.0.1')
      const socketClient = await clientModule.getClient(9314, '127.0.0.1', {
        socketPath: 'relative.sock',
      })

      expect(socketClient).to.not.equal(tcpClient)
      expect(await clientModule.getClient(9314, '127.0.0.1')).to.equal(
        tcpClient
      )
      expect(
        await clientModule.getClient(9314, '127.0.0.1', {
          socketPath: 'relative.sock',
        })
      ).to.equal(socketClient)
      expect(uris).to.deep.equal(['127.0.0.1:9314', 'unix:relative.sock'])

      resetClient()
      expect(closedUris.sort()).to.deep.equal([
        '127.0.0.1:9314',
        'unix:relative.sock',
      ])
    } finally {
      resetClient()
      restoreCreateInsecure()
      restoreEditorClient()
    }
  })

  it('should reuse the explicit current shared client for default getClient calls', async () => {
    resetClient()
    delete process.env.OMEGA_EDIT_SERVER_URI
    delete process.env.OMEGA_EDIT_SERVER_SOCKET
    const uris: string[] = []

    class FakeEditorClient {
      readonly uri: string

      constructor(uri: string) {
        this.uri = uri
        uris.push(uri)
      }

      waitForReady(_deadline: unknown, callback: (err?: Error) => void) {
        callback()
      }

      close() {}
    }

    const restoreEditorClient = overrideProperty(
      grpcClientModule as Record<string, any>,
      'EditorClient',
      FakeEditorClient
    )
    const restoreCreateInsecure = overrideProperty(
      grpcModule.credentials as Record<string, any>,
      'createInsecure',
      () => ({})
    )

    try {
      const currentClient = await clientModule.getClient(9316, '127.0.0.1')
      const defaultClient = await clientModule.getClient()

      expect(defaultClient).to.equal(currentClient)
      expect(uris).to.deep.equal(['127.0.0.1:9316'])
    } finally {
      resetClient()
      restoreCreateInsecure()
      restoreEditorClient()
    }
  })

  it('should switch the current shared client when a new explicit endpoint is chosen', async () => {
    resetClient()
    delete process.env.OMEGA_EDIT_SERVER_URI
    delete process.env.OMEGA_EDIT_SERVER_SOCKET
    const uris: string[] = []

    class FakeEditorClient {
      readonly uri: string

      constructor(uri: string) {
        this.uri = uri
        uris.push(uri)
      }

      waitForReady(_deadline: unknown, callback: (err?: Error) => void) {
        callback()
      }

      close() {}
    }

    const restoreEditorClient = overrideProperty(
      grpcClientModule as Record<string, any>,
      'EditorClient',
      FakeEditorClient
    )
    const restoreCreateInsecure = overrideProperty(
      grpcModule.credentials as Record<string, any>,
      'createInsecure',
      () => ({})
    )

    try {
      const firstClient = await clientModule.getClient(9316, '127.0.0.1')
      expect(await clientModule.getClient()).to.equal(firstClient)

      const secondClient = await clientModule.getClient(9317, '127.0.0.1')
      expect(secondClient).to.not.equal(firstClient)
      expect(await clientModule.getClient()).to.equal(secondClient)
      expect(uris).to.deep.equal(['127.0.0.1:9316', '127.0.0.1:9317'])
    } finally {
      resetClient()
      restoreCreateInsecure()
      restoreEditorClient()
    }
  })

  it('should reset the client when all connection candidates fail', async () => {
    resetClient()
    const uris: string[] = []
    const closedUris: string[] = []

    class FakeEditorClient {
      uri: string

      constructor(uri: string) {
        this.uri = uri
        uris.push(uri)
      }

      waitForReady(_deadline: unknown, callback: (err?: Error) => void) {
        callback(new Error(`${this.uri} unavailable`))
      }

      close() {
        closedUris.push(this.uri)
      }
    }

    const restoreEditorClient = overrideProperty(
      grpcClientModule as Record<string, any>,
      'EditorClient',
      FakeEditorClient
    )
    const restoreCreateInsecure = overrideProperty(
      grpcModule.credentials as Record<string, any>,
      'createInsecure',
      () => ({})
    )

    try {
      process.env.OMEGA_EDIT_SERVER_SOCKET = '/tmp/omega-edit.sock'
      delete process.env.OMEGA_EDIT_SERVER_URI

      await clientModule.getClient(9311, '127.0.0.1')
      expect.fail('getClient should reject when every candidate fails')
    } catch (err) {
      expect((err as Error).message).to.equal('127.0.0.1:9311 unavailable')
      expect(uris).to.deep.equal([
        'unix:///tmp/omega-edit.sock',
        '127.0.0.1:9311',
      ])
      expect(closedUris).to.deep.equal([
        'unix:///tmp/omega-edit.sock',
        '127.0.0.1:9311',
      ])
    } finally {
      resetClient()
      restoreCreateInsecure()
      restoreEditorClient()
    }
  })

  it('should share a single in-flight client initialization', async () => {
    resetClient()
    delete process.env.OMEGA_EDIT_SERVER_URI
    delete process.env.OMEGA_EDIT_SERVER_SOCKET
    const uris: string[] = []
    const readyCallbacks: Array<(err?: Error) => void> = []

    class FakeEditorClient {
      readonly uri: string

      constructor(uri: string) {
        this.uri = uri
        uris.push(uri)
      }

      waitForReady(_deadline: unknown, callback: (err?: Error) => void) {
        readyCallbacks.push(callback)
      }

      close() {}
    }

    const restoreEditorClient = overrideProperty(
      grpcClientModule as Record<string, any>,
      'EditorClient',
      FakeEditorClient
    )
    const restoreCreateInsecure = overrideProperty(
      grpcModule.credentials as Record<string, any>,
      'createInsecure',
      () => ({})
    )

    try {
      const firstClientPromise = clientModule.getClient(9313, '127.0.0.1')
      const secondClientPromise = clientModule.getClient(9313, '127.0.0.1')

      expect(uris).to.deep.equal(['127.0.0.1:9313'])
      expect(readyCallbacks).to.have.length(1)

      readyCallbacks[0]()

      const [firstClient, secondClient] = await Promise.all([
        firstClientPromise,
        secondClientPromise,
      ])

      expect(firstClient).to.equal(secondClient)
    } finally {
      resetClient()
      restoreCreateInsecure()
      restoreEditorClient()
    }
  })

  it('should initialize and replace the logger singleton', async () => {
    const loggerModulePath = require.resolve('../../dist/cjs/logger.js')
    delete require.cache[loggerModulePath]
    const loggerModule =
      require('../../dist/cjs/logger.js') as typeof import('../../src/logger')

    const defaultLogger = loggerModule.getLogger()
    expect(defaultLogger).to.not.equal(undefined)

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-edit-log-'))
    const logFile = path.join(tempDir, 'client.log')

    try {
      const fileLogger = loggerModule.createSimpleFileLogger(logFile, 'debug')
      loggerModule.setLogger(fileLogger)
      loggerModule.getLogger().info({ msg: 'source coverage logger test' })
      await delay(100)
      expect(fs.readFileSync(logFile, 'utf8')).to.contain(
        'source coverage logger test'
      )
    } finally {
      await removeDirWithRetry(tempDir)
    }
  })
})
