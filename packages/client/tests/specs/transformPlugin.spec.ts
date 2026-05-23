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
  TransformPluginOperation,
  applyTransformPlugin,
  createSessionFromBytes,
  destroySession,
  findFirstAvailablePort,
  getClient,
  getComputedFileSize,
  getSegment,
  listTransformPlugins,
  resetClient,
  stopProcessUsingPID,
  stopServiceOnPort,
} from '@omega-edit/client'
import omegaEditServer from '@omega-edit/server'
import * as fs from 'fs'
import * as path from 'path'
import waitPort from 'wait-port'
import { expect, initChai, testHost } from './common.js'
import { getModuleCompat } from './moduleCompat.js'

const { __dirname } = getModuleCompat(import.meta.url)
const repoRoot = path.resolve(__dirname, '../../../..')
const { runServerWithArgs } =
  omegaEditServer as typeof import('@omega-edit/server')

function directoryHasTransformPlugin(directory: string): boolean {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return false
  }

  return fs.readdirSync(directory).some((file) => {
    return (
      file.startsWith('omega_transform_') &&
      (file.endsWith('.dll') || file.endsWith('.so') || file.endsWith('.dylib'))
    )
  })
}

function findTransformPluginDirectory(): string | undefined {
  const candidates = [
    process.env.OMEGA_EDIT_TEST_PLUGIN_DIR || '',
    path.join(
      repoRoot,
      '_build_core',
      'packages',
      'core',
      'src',
      'tests',
      'plugins'
    ),
    path.join(repoRoot, 'build', 'core', 'src', 'tests', 'plugins'),
    path.join(repoRoot, 'build-coverage', 'core', 'src', 'tests', 'plugins'),
  ].filter(Boolean)

  return candidates.find(directoryHasTransformPlugin)
}

describe('Transform plugin gRPC integration', () => {
  before(async () => {
    await initChai()
  })

  it('Should list and apply exemplar transform plugins through gRPC', async function () {
    const pluginDirectory = findTransformPluginDirectory()
    if (!pluginDirectory) {
      this.skip()
    }

    const port = await findFirstAvailablePort(21000, 21999)
    if (port === null) {
      throw new Error('No available port found for transform plugin test')
    }

    const previousServerUri = process.env.OMEGA_EDIT_SERVER_URI
    const previousServerSocket = process.env.OMEGA_EDIT_SERVER_SOCKET
    let pid: number | undefined
    let sessionId = ''

    try {
      delete process.env.OMEGA_EDIT_SERVER_URI
      delete process.env.OMEGA_EDIT_SERVER_SOCKET

      await stopServiceOnPort(port)
      const serverProcess = await runServerWithArgs([
        `--interface=${testHost}`,
        `--port=${port}`,
        `--transform-plugin-dir=${pluginDirectory}`,
      ])
      pid = serverProcess.pid
      expect(pid).to.be.a('number').greaterThan(0)
      await waitPort({
        host: testHost,
        port,
        output: 'silent',
        timeout: 20000,
      })

      resetClient()
      expect(await getClient(port, testHost)).to.not.be.undefined

      const plugins = await listTransformPlugins()
      expect(plugins.map((plugin) => plugin.id)).to.include.members([
        'omega.example.base64_decode',
        'omega.example.base64_encode',
        'omega.example.fnv1a64',
        'omega.example.zlib_compress',
        'omega.example.zlib_decompress',
        'omega.example.xor',
        'omega.example.repeat',
        'omega.example.checksum8',
      ])

      const session = await createSessionFromBytes(Buffer.from('abc', 'utf8'))
      sessionId = session.getSessionId()

      const encodeResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.base64_encode',
        0,
        3
      )
      expect(encodeResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(encodeResponse.contentChanged).to.equal(true)
      expect(encodeResponse.replacementLength).to.equal(4)
      expect(encodeResponse.computedFileSize).to.equal(4)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 4)).toString('utf8')
      ).to.equal('YWJj')

      const decodeResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.base64_decode',
        0,
        4
      )
      expect(decodeResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(decodeResponse.contentChanged).to.equal(true)
      expect(decodeResponse.replacementLength).to.equal(3)
      expect(decodeResponse.computedFileSize).to.equal(3)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('utf8')
      ).to.equal('abc')

      const compressResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.zlib_compress',
        0,
        3
      )
      expect(compressResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(compressResponse.contentChanged).to.equal(true)
      expect(compressResponse.replacementLength).to.equal(14)
      expect(compressResponse.computedFileSize).to.equal(14)
      expect(Array.from(await getSegment(sessionId, 0, 2))).to.deep.equal([
        0x78, 0x01,
      ])

      const decompressResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.zlib_decompress',
        0,
        14
      )
      expect(decompressResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(decompressResponse.contentChanged).to.equal(true)
      expect(decompressResponse.replacementLength).to.equal(3)
      expect(decompressResponse.computedFileSize).to.equal(3)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('utf8')
      ).to.equal('abc')

      const repeatResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.repeat',
        1,
        2
      )
      expect(repeatResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(repeatResponse.contentChanged).to.equal(true)
      expect(repeatResponse.replacementLength).to.equal(4)
      expect(repeatResponse.computedFileSize).to.equal(5)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 5)).toString('utf8')
      ).to.equal('abcbc')

      const checksumResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.checksum8',
        0,
        5
      )
      expect(checksumResponse.operation).to.equal(
        TransformPluginOperation.INSPECT
      )
      expect(checksumResponse.contentChanged).to.equal(false)
      expect(checksumResponse.resultLabel).to.equal('checksum8')
      expect(checksumResponse.resultMimeType).to.equal('text/plain')
      expect(Buffer.from(checksumResponse.result).toString('utf8')).to.equal(
        '0xEB'
      )
      expect(await getComputedFileSize(sessionId)).to.equal(5)

      const hashResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.fnv1a64',
        0,
        5
      )
      expect(hashResponse.operation).to.equal(TransformPluginOperation.INSPECT)
      expect(hashResponse.contentChanged).to.equal(false)
      expect(hashResponse.resultLabel).to.equal('fnv1a64')
      expect(hashResponse.resultMimeType).to.equal('text/plain')
      expect(Buffer.from(hashResponse.result).toString('utf8')).to.equal(
        '0x6334A32D761281D8'
      )
      expect(await getComputedFileSize(sessionId)).to.equal(5)

      const xorResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.xor',
        0,
        1
      )
      expect(xorResponse.operation).to.equal(TransformPluginOperation.REPLACE)
      expect(xorResponse.contentChanged).to.equal(true)
      expect(xorResponse.replacementLength).to.equal(1)
      expect(Array.from(await getSegment(sessionId, 0, 1))).to.deep.equal([
        'a'.charCodeAt(0) ^ 0xff,
      ])

      const xorOptionsResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.xor',
        1,
        1,
        JSON.stringify({ byte: '0x42' })
      )
      expect(xorOptionsResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(xorOptionsResponse.contentChanged).to.equal(true)
      expect(xorOptionsResponse.replacementLength).to.equal(1)
      expect(Array.from(await getSegment(sessionId, 1, 1))).to.deep.equal([
        'b'.charCodeAt(0) ^ 0x42,
      ])
    } finally {
      if (sessionId) {
        await destroySession(sessionId).catch(() => undefined)
      }
      if (pid) {
        await stopProcessUsingPID(pid).catch(() => false)
      }
      await stopServiceOnPort(port)
      resetClient()

      if (previousServerUri === undefined) {
        delete process.env.OMEGA_EDIT_SERVER_URI
      } else {
        process.env.OMEGA_EDIT_SERVER_URI = previousServerUri
      }

      if (previousServerSocket === undefined) {
        delete process.env.OMEGA_EDIT_SERVER_SOCKET
      } else {
        process.env.OMEGA_EDIT_SERVER_SOCKET = previousServerSocket
      }
    }
  })
})
