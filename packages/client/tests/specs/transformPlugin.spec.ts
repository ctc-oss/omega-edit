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
  beginSessionTransaction,
  createCheckpoint,
  createSessionFromBytes,
  destroySession,
  endSessionTransaction,
  findFirstAvailablePort,
  getClient,
  getChangeCount,
  getComputedFileSize,
  getSegment,
  getSessionContentInfo,
  inspectSessionContent,
  listTransformPlugins,
  resetClient,
  SessionContentSource,
  stopProcessUsingPID,
  stopServiceOnPort,
} from '@omega-edit/client'
import omegaEditServer from '@omega-edit/server'
import { status as GrpcStatus } from '@grpc/grpc-js'
import * as fs from 'fs'
import * as path from 'path'
import waitPort from 'wait-port'
import { expect, initExpect, testHost } from './common.js'
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
    path.join(repoRoot, '_build_core', 'core', 'src', 'tests', 'plugins'),
    path.join(repoRoot, '_build_core', 'plugins', 'plugins'),
    path.join(repoRoot, '_build', 'plugins', 'plugins'),
    path.join(repoRoot, 'build', 'core', 'src', 'tests', 'plugins'),
    path.join(repoRoot, 'build-coverage', 'core', 'src', 'tests', 'plugins'),
  ].filter(Boolean)

  return candidates.find(directoryHasTransformPlugin)
}

describe('Transform plugin gRPC integration', () => {
  beforeAll(async () => {
    await initExpect()
  })

  it('Should list and apply exemplar transform plugins through gRPC', async () => {
    const pluginDirectory = findTransformPluginDirectory()
    if (!pluginDirectory) {
      return
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
        'omega.example.base64',
        'omega.example.bitwise',
        'omega.example.case_change',
        'omega.example.character_transcode',
        'omega.example.common_checksums',
        'omega.example.decimal_codecs',
        'omega.example.endian_swap',
        'omega.example.format_inspectors',
        'omega.example.openssl_ciphers',
        'omega.example.openssl_digests',
        'omega.example.record_text_helpers',
        'omega.example.text_codecs',
        'omega.example.zlib',
        'omega.example.repeat',
      ])
      const bitwisePlugin = plugins.find(
        (plugin) => plugin.id === 'omega.example.bitwise'
      )
      expect(bitwisePlugin?.help).to.include('logical operator')
      expect(bitwisePlugin?.example).to.equal(
        '{"operator":"xor","mask":["0x42","0x24"]}'
      )
      expect(bitwisePlugin?.defaultArgs).to.equal(
        '{"operator":"xor","byte":"0xFF"}'
      )
      expect(bitwisePlugin?.argsSchema).to.include('"operator"')
      const caseChangePlugin = plugins.find(
        (plugin) => plugin.id === 'omega.example.case_change'
      )
      expect(caseChangePlugin?.help).to.include('ASCII alphabetic bytes')
      expect(caseChangePlugin?.example).to.equal('{"case":"lower"}')
      expect(caseChangePlugin?.defaultArgs).to.equal('{"case":"upper"}')
      expect(caseChangePlugin?.argsSchema).to.include('"upper"')
      const base64Plugin = plugins.find(
        (plugin) => plugin.id === 'omega.example.base64'
      )
      expect(base64Plugin?.defaultArgs).to.equal('{"direction":"encode"}')
      expect(base64Plugin?.argsSchema).to.include('"direction"')
      const zlibPlugin = plugins.find(
        (plugin) => plugin.id === 'omega.example.zlib'
      )
      expect(zlibPlugin?.help).to.include('Compression level')
      expect(zlibPlugin?.example).to.equal('{"action":"compress","level":9}')
      expect(zlibPlugin?.defaultArgs).to.equal(
        '{"action":"compress","level":-1}'
      )
      expect(zlibPlugin?.argsSchema).to.include('"maximum":9')
      const digestPlugin = plugins.find(
        (plugin) => plugin.id === 'omega.example.openssl_digests'
      )
      expect(digestPlugin?.defaultArgs).to.equal('{"algorithm":"sha256"}')
      expect(digestPlugin?.argsSchema).to.include('"x-omega-enumGroups"')
      const cipherPlugin = plugins.find(
        (plugin) => plugin.id === 'omega.example.openssl_ciphers'
      )
      expect(cipherPlugin?.defaultArgs).to.include('"aes-256-ctr"')
      expect(cipherPlugin?.argsSchema).to.include('"keyHex"')
      expect(
        JSON.parse(cipherPlugin?.argsSchema ?? '{}').required
      ).to.include.members(['action', 'algorithm', 'keyHex', 'ivHex'])
      const repeatPlugin = plugins.find(
        (plugin) => plugin.id === 'omega.example.repeat'
      )
      expect(repeatPlugin?.defaultArgs).to.equal('')
      expect(repeatPlugin?.argsSchema).to.include(
        '"additionalProperties":false'
      )
      expect(
        plugins.every(
          (plugin) => JSON.parse(plugin.argsSchema).type === 'object'
        )
      ).to.equal(true)

      const ownedContentSession = await createSessionFromBytes(
        Buffer.from('abc', 'utf8')
      )
      const ownedContentSessionId = ownedContentSession.getSessionId()
      try {
        const initialInfo = await getSessionContentInfo(ownedContentSessionId)
        expect(
          initialInfo.info.find(
            (entry) => entry.content === SessionContentSource.ORIGINAL
          )
        ).to.deep.include({ available: true, byteLength: 3 })
        expect(
          initialInfo.info.find(
            (entry) => entry.content === SessionContentSource.COMPUTED
          )
        ).to.deep.include({ available: true, byteLength: 3 })
        expect(
          initialInfo.info.find(
            (entry) => entry.content === SessionContentSource.LATEST_CHECKPOINT
          )
        ).to.deep.include({ available: false, byteLength: 0 })

        const originalDigest = await inspectSessionContent(
          ownedContentSessionId,
          SessionContentSource.ORIGINAL,
          'omega.example.openssl_digests',
          0,
          3,
          JSON.stringify({ algorithm: 'sha256' })
        )
        expect(originalDigest.resultLabel).to.equal('sha256')
        expect(Buffer.from(originalDigest.result).toString('utf8')).to.equal(
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        )

        await applyTransformPlugin(
          ownedContentSessionId,
          'omega.example.case_change',
          0,
          3,
          JSON.stringify({ case: 'upper' })
        )
        await createCheckpoint(ownedContentSessionId)

        const checkpointInfo = await getSessionContentInfo(
          ownedContentSessionId
        )
        expect(
          checkpointInfo.info.find(
            (entry) => entry.content === SessionContentSource.LATEST_CHECKPOINT
          )
        ).to.deep.include({ available: true, byteLength: 3 })

        const computedDigest = await inspectSessionContent(
          ownedContentSessionId,
          SessionContentSource.COMPUTED,
          'omega.example.openssl_digests',
          0,
          3,
          JSON.stringify({ algorithm: 'sha256' })
        )
        expect(Buffer.from(computedDigest.result).toString('utf8')).to.equal(
          'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78'
        )

        const checkpointDigest = await inspectSessionContent(
          ownedContentSessionId,
          SessionContentSource.LATEST_CHECKPOINT,
          'omega.example.openssl_digests',
          0,
          3,
          JSON.stringify({ algorithm: 'sha256' })
        )
        expect(Buffer.from(checkpointDigest.result).toString('utf8')).to.equal(
          'b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78'
        )
      } finally {
        await destroySession(ownedContentSessionId).catch(() => undefined)
      }

      const session = await createSessionFromBytes(Buffer.from('abc', 'utf8'))
      sessionId = session.getSessionId()

      try {
        await applyTransformPlugin(
          sessionId,
          'omega.example.base64',
          0,
          3,
          JSON.stringify({ level: 9 })
        )
        expect.fail('unknown base64 options should be rejected')
      } catch (err) {
        expect((err as Error).message).to.include('INVALID_ARGUMENT')
      }

      try {
        await applyTransformPlugin(
          sessionId,
          'omega.example.common_checksums',
          0,
          3
        )
        expect.fail('missing checksum options should be rejected')
      } catch (err) {
        expect((err as Error).message).to.include('INVALID_ARGUMENT')
      }

      let transactionOpen = false
      try {
        await beginSessionTransaction(sessionId)
        transactionOpen = true
        await applyTransformPlugin(
          sessionId,
          'omega.example.bitwise',
          0,
          3,
          JSON.stringify({ operator: 'xor', byte: '0x01' })
        )
        expect.fail(
          'applyTransformPlugin should reject while a transaction is open'
        )
      } catch (err) {
        const wrapped = err as Error & {
          cause?: { code?: number; details?: string }
        }
        expect(wrapped.message).to.include('FAILED_PRECONDITION')
        expect(wrapped.cause?.code).to.equal(GrpcStatus.FAILED_PRECONDITION)
        expect(wrapped.message).to.include(
          'transform cannot run while a session transaction is open'
        )
      } finally {
        if (transactionOpen) {
          await endSessionTransaction(sessionId)
        }
      }

      const identityBitwiseChangeCount = await getChangeCount(sessionId)
      const xorIdentityResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.bitwise',
        0,
        3,
        JSON.stringify({ operator: 'xor', byte: '0x00' })
      )
      expect(xorIdentityResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(xorIdentityResponse.contentChanged).to.equal(false)
      expect(xorIdentityResponse.replacementLength).to.equal(0)
      expect(xorIdentityResponse.computedFileSize).to.equal(3)
      expect(await getChangeCount(sessionId)).to.equal(
        identityBitwiseChangeCount
      )
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('utf8')
      ).to.equal('abc')

      const andIdentityResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.bitwise',
        0,
        3,
        JSON.stringify({ operator: 'and', byte: '0xFF' })
      )
      expect(andIdentityResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(andIdentityResponse.contentChanged).to.equal(false)
      expect(andIdentityResponse.replacementLength).to.equal(0)
      expect(await getChangeCount(sessionId)).to.equal(
        identityBitwiseChangeCount
      )
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('utf8')
      ).to.equal('abc')

      const orIdentityResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.bitwise',
        0,
        3,
        JSON.stringify({ operator: 'or', mask: ['0x00', '0x00'] })
      )
      expect(orIdentityResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(orIdentityResponse.contentChanged).to.equal(false)
      expect(orIdentityResponse.replacementLength).to.equal(0)
      expect(await getChangeCount(sessionId)).to.equal(
        identityBitwiseChangeCount
      )
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('utf8')
      ).to.equal('abc')

      const upperResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.case_change',
        0,
        3,
        JSON.stringify({ case: 'upper' })
      )
      expect(upperResponse.operation).to.equal(TransformPluginOperation.REPLACE)
      expect(upperResponse.contentChanged).to.equal(true)
      expect(upperResponse.replacementLength).to.equal(3)
      expect(upperResponse.computedFileSize).to.equal(3)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('utf8')
      ).to.equal('ABC')

      const uppercaseChangeCount = await getChangeCount(sessionId)
      const upperNoopResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.case_change',
        0,
        3,
        JSON.stringify({ case: 'upper' })
      )
      expect(upperNoopResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(upperNoopResponse.contentChanged).to.equal(false)
      expect(upperNoopResponse.replacementLength).to.equal(0)
      expect(await getChangeCount(sessionId)).to.equal(uppercaseChangeCount)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('utf8')
      ).to.equal('ABC')

      const lowerResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.case_change',
        0,
        3,
        JSON.stringify({ case: 'lower' })
      )
      expect(lowerResponse.operation).to.equal(TransformPluginOperation.REPLACE)
      expect(lowerResponse.contentChanged).to.equal(true)
      expect(lowerResponse.replacementLength).to.equal(3)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('utf8')
      ).to.equal('abc')

      const encodeResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.base64',
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
        'omega.example.base64',
        0,
        4,
        JSON.stringify({ direction: 'decode' })
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

      const aesIvHex = '000102030405060708090a0b0c0d0e0f'
      const aes256CtrOptions = {
        action: 'encrypt',
        algorithm: 'aes-256-ctr',
        keyHex:
          '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
        ivHex: aesIvHex,
      }
      const cipherSchemaPlugin = plugins.find(
        (plugin) => plugin.id === 'omega.example.openssl_ciphers'
      )
      expect(cipherSchemaPlugin?.argsSchema).to.include('oneOf')
      expect(cipherSchemaPlugin?.argsSchema).to.include('^[0-9A-Fa-f]{64}$')
      const invalidCipherOptions = [
        [
          'short AES-128 key',
          {
            action: 'encrypt',
            algorithm: 'aes-128-ctr',
            keyHex: '00',
            ivHex: aesIvHex,
          },
        ],
        [
          'odd-length AES key',
          {
            action: 'encrypt',
            algorithm: 'aes-128-ctr',
            keyHex: '0',
            ivHex: aesIvHex,
          },
        ],
        [
          'AES-256 option with AES-128 key length',
          {
            action: 'encrypt',
            algorithm: 'aes-256-ctr',
            keyHex: '000102030405060708090a0b0c0d0e0f',
            ivHex: aesIvHex,
          },
        ],
        [
          'short AES IV',
          {
            action: 'encrypt',
            algorithm: 'aes-256-ctr',
            keyHex: aes256CtrOptions.keyHex,
            ivHex: '00',
          },
        ],
      ] as const
      for (const [label, options] of invalidCipherOptions) {
        try {
          await applyTransformPlugin(
            sessionId,
            'omega.example.openssl_ciphers',
            0,
            3,
            JSON.stringify(options)
          )
          expect.fail(`${label} should be rejected by the cipher schema`)
        } catch (err) {
          expect((err as Error).message).to.include('INVALID_ARGUMENT')
        }
      }

      const aesCtrEncryptResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.openssl_ciphers',
        0,
        3,
        JSON.stringify(aes256CtrOptions)
      )
      expect(aesCtrEncryptResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(aesCtrEncryptResponse.contentChanged).to.equal(true)
      expect(aesCtrEncryptResponse.replacementLength).to.equal(3)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('hex')
      ).to.equal('3b0c67')

      const aesCtrDecryptResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.openssl_ciphers',
        0,
        3,
        JSON.stringify({ ...aes256CtrOptions, action: 'decrypt' })
      )
      expect(aesCtrDecryptResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(aesCtrDecryptResponse.contentChanged).to.equal(true)
      expect(aesCtrDecryptResponse.replacementLength).to.equal(3)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('utf8')
      ).to.equal('abc')

      const aes128CbcOptions = {
        action: 'encrypt',
        algorithm: 'aes-128-cbc',
        keyHex: '2b7e151628aed2a6abf7158809cf4f3c',
        ivHex: aesIvHex,
      }
      const aesCbcEncryptResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.openssl_ciphers',
        0,
        3,
        JSON.stringify(aes128CbcOptions)
      )
      expect(aesCbcEncryptResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(aesCbcEncryptResponse.contentChanged).to.equal(true)
      expect(aesCbcEncryptResponse.replacementLength).to.equal(16)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 16)).toString('hex')
      ).to.equal('f327e7290b9b923d29d949db2c9f75cc')

      const aesCbcDecryptResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.openssl_ciphers',
        0,
        16,
        JSON.stringify({ ...aes128CbcOptions, action: 'decrypt' })
      )
      expect(aesCbcDecryptResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(aesCbcDecryptResponse.contentChanged).to.equal(true)
      expect(aesCbcDecryptResponse.replacementLength).to.equal(3)
      expect(
        Buffer.from(await getSegment(sessionId, 0, 3)).toString('utf8')
      ).to.equal('abc')

      try {
        await applyTransformPlugin(
          sessionId,
          'omega.example.zlib',
          0,
          3,
          JSON.stringify({ action: 'compress', level: 10 })
        )
        expect.fail(
          'level 10 should be rejected by the advertised transform schema'
        )
      } catch (err) {
        expect((err as Error).message).to.include('INVALID_ARGUMENT')
      }

      const compressResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.zlib',
        0,
        3,
        JSON.stringify({ action: 'compress', level: 9 })
      )
      expect(compressResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(compressResponse.contentChanged).to.equal(true)
      expect(compressResponse.replacementLength).to.be.greaterThan(0)
      expect(compressResponse.computedFileSize).to.equal(
        compressResponse.replacementLength
      )
      const compressedHeader = await getSegment(sessionId, 0, 2)
      expect(compressedHeader[0] & 0x0f).to.equal(8)

      const decompressResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.zlib',
        0,
        compressResponse.replacementLength,
        JSON.stringify({ action: 'decompress' })
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

      const checksumChangeCount = await getChangeCount(sessionId)
      const checksumResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.common_checksums',
        0,
        5,
        JSON.stringify({ algorithm: 'sum8' })
      )
      expect(checksumResponse.operation).to.equal(
        TransformPluginOperation.INSPECT
      )
      expect(checksumResponse.contentChanged).to.equal(false)
      expect(checksumResponse.resultLabel).to.equal('sum8')
      expect(checksumResponse.resultMimeType).to.equal('text/plain')
      expect(Buffer.from(checksumResponse.result).toString('utf8')).to.equal(
        '0xEB'
      )
      expect(await getComputedFileSize(sessionId)).to.equal(5)
      expect(await getChangeCount(sessionId)).to.equal(checksumChangeCount)

      const hashResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.common_checksums',
        0,
        5,
        JSON.stringify({ algorithm: 'fnv1a64' })
      )
      expect(hashResponse.operation).to.equal(TransformPluginOperation.INSPECT)
      expect(hashResponse.contentChanged).to.equal(false)
      expect(hashResponse.resultLabel).to.equal('fnv1a64')
      expect(hashResponse.resultMimeType).to.equal('text/plain')
      expect(Buffer.from(hashResponse.result).toString('utf8')).to.equal(
        '0x6334A32D761281D8'
      )
      expect(await getComputedFileSize(sessionId)).to.equal(5)

      const sha256Response = await applyTransformPlugin(
        sessionId,
        'omega.example.openssl_digests',
        0,
        5,
        JSON.stringify({ algorithm: 'sha256' })
      )
      expect(sha256Response.operation).to.equal(
        TransformPluginOperation.INSPECT
      )
      expect(sha256Response.contentChanged).to.equal(false)
      expect(sha256Response.resultLabel).to.equal('sha256')
      expect(sha256Response.resultMimeType).to.equal('text/plain')
      expect(Buffer.from(sha256Response.result).toString('utf8')).to.equal(
        'c490aea7e19cad1b8b49dac9c2e02c023c6f21f1379fdd70335f461273f84cc7'
      )
      expect(await getComputedFileSize(sessionId)).to.equal(5)

      const xorResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.bitwise',
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
        'omega.example.bitwise',
        1,
        1,
        JSON.stringify({ operator: 'xor', byte: '0x42' })
      )
      expect(xorOptionsResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(xorOptionsResponse.contentChanged).to.equal(true)
      expect(xorOptionsResponse.replacementLength).to.equal(1)
      expect(Array.from(await getSegment(sessionId, 1, 1))).to.deep.equal([
        'b'.charCodeAt(0) ^ 0x42,
      ])

      try {
        await applyTransformPlugin(
          sessionId,
          'omega.example.bitwise',
          2,
          2,
          JSON.stringify({ operator: 'xor', bytes: ['0x01', '0x02'] })
        )
        expect.fail(
          'bytes should be rejected by the advertised transform schema'
        )
      } catch (err) {
        expect((err as Error).message).to.include('INVALID_ARGUMENT')
      }

      const xorMaskResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.bitwise',
        2,
        2,
        JSON.stringify({ operator: 'xor', mask: ['0x01', '0x02'] })
      )
      expect(xorMaskResponse.operation).to.equal(
        TransformPluginOperation.REPLACE
      )
      expect(xorMaskResponse.contentChanged).to.equal(true)
      expect(xorMaskResponse.replacementLength).to.equal(2)
      expect(Array.from(await getSegment(sessionId, 2, 2))).to.deep.equal([
        'c'.charCodeAt(0) ^ 0x01,
        'b'.charCodeAt(0) ^ 0x02,
      ])

      const andResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.bitwise',
        2,
        2,
        JSON.stringify({ operator: 'and', mask: ['0x0F', '0xF0'] })
      )
      expect(andResponse.operation).to.equal(TransformPluginOperation.REPLACE)
      expect(andResponse.contentChanged).to.equal(true)
      expect(andResponse.replacementLength).to.equal(2)
      expect(Array.from(await getSegment(sessionId, 2, 2))).to.deep.equal([
        ('c'.charCodeAt(0) ^ 0x01) & 0x0f,
        ('b'.charCodeAt(0) ^ 0x02) & 0xf0,
      ])

      const orResponse = await applyTransformPlugin(
        sessionId,
        'omega.example.bitwise',
        3,
        2,
        JSON.stringify({ operator: 'or', mask: ['0x01', '0x04'] })
      )
      expect(orResponse.operation).to.equal(TransformPluginOperation.REPLACE)
      expect(orResponse.contentChanged).to.equal(true)
      expect(orResponse.replacementLength).to.equal(2)
      expect(Array.from(await getSegment(sessionId, 3, 2))).to.deep.equal([
        (('b'.charCodeAt(0) ^ 0x02) & 0xf0) | 0x01,
        'c'.charCodeAt(0) | 0x04,
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
