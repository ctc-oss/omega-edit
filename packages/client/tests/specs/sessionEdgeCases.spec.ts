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

import { expect } from './common.js'
import {
  expectErrorMessage,
  makeObjectIdResponse,
  overrideProperty,
  silenceClientLogger,
} from './mockHelpers.js'
import { getModuleCompat } from './moduleCompat.js'

const { require } = getModuleCompat(import.meta.url)
let clientModule: typeof import('../../src/client')
let changeModule: typeof import('../../src/change')
let sessionModule: typeof import('../../src/session')

describe('Session Edge Cases', () => {
  let restoreLogger = () => {}

  before(() => {
    delete require.cache[require.resolve('../../dist/cjs/logger.js')]
    delete require.cache[require.resolve('../../dist/cjs/client.js')]
    delete require.cache[require.resolve('../../dist/cjs/change.js')]
    delete require.cache[require.resolve('../../dist/cjs/session.js')]
    delete require.cache[
      require.resolve('../../dist/cjs/protobuf_ts/change.js')
    ]
    delete require.cache[
      require.resolve('../../dist/cjs/protobuf_ts/session.js')
    ]
    restoreLogger = silenceClientLogger(require)
    clientModule =
      require('../../dist/cjs/client.js') as typeof import('../../src/client')
    changeModule =
      require('../../dist/cjs/change.js') as typeof import('../../src/change')
    sessionModule =
      require('../../dist/cjs/session.js') as typeof import('../../src/session')
  })

  after(() => {
    restoreLogger()
  })

  it('should reject createSession and saveSession failures', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        createSession(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('create session failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        saveSession(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('save session failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        destroySession(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('destroy session failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        getComputedFileSize(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('file size failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        getCount(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('count failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
      })
    )

    try {
      await sessionModule.createSession()
      expect.fail('createSession should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'createSession error: create session failed'
      )
    }

    try {
      await sessionModule.saveSession('sid', '/tmp/test.txt')
      expect.fail('saveSession should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'saveSession error: save session failed')
    }

    try {
      await sessionModule.destroySession('sid')
      expect.fail('destroySession should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'destroySession error: destroy session failed'
      )
    }

    try {
      await sessionModule.getComputedFileSize('sid')
      expect.fail('getComputedFileSize should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'getComputedFileSize error: file size failed'
      )
    }

    try {
      await sessionModule.getCounts('sid', [])
      expect.fail('getCounts should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'getCounts error: count failed')
    } finally {
      restoreGetClient()
    }
  })

  it('should serialize low-level transaction helpers through the mutation queue', async () => {
    const calls: string[] = []
    let nextSerial = 1
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        sessionBeginTransaction(
          _request: unknown,
          callback: (
            err: Error | null,
            response?: { getId(): string; toObject(): { id: string } }
          ) => void
        ) {
          calls.push('begin:start')
          setTimeout(() => {
            calls.push('begin:end')
            callback(null, makeObjectIdResponse('session-id'))
          }, 25)
        },
        submitChange(
          _request: unknown,
          callback: (err: Error | null, response?: { serial: number }) => void
        ) {
          calls.push('edit')
          callback(null, { serial: nextSerial++ })
        },
        sessionEndTransaction(
          _request: unknown,
          callback: (
            err: Error | null,
            response?: { getId(): string; toObject(): { id: string } }
          ) => void
        ) {
          calls.push('end:start')
          setTimeout(() => {
            calls.push('end:end')
            callback(null, makeObjectIdResponse('session-id'))
          }, 25)
        },
      })
    )

    try {
      await Promise.all([
        sessionModule.beginSessionTransaction('session-id'),
        changeModule.insert('session-id', 0, new Uint8Array([0x41])),
      ])

      await Promise.all([
        sessionModule.endSessionTransaction('session-id'),
        changeModule.insert('session-id', 1, new Uint8Array([0x42])),
      ])

      expect(calls).to.deep.equal([
        'begin:start',
        'begin:end',
        'edit',
        'end:start',
        'end:end',
        'edit',
      ])
    } finally {
      restoreGetClient()
    }
  })

  it('should reject session pause, transaction, and resume failures', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        pauseSessionChanges(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('pause session failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        sessionBeginTransaction(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('begin transaction failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        sessionEndTransaction(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('end transaction failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        resumeSessionChanges(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('resume session failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
      })
    )

    try {
      await sessionModule.pauseSessionChanges('session-id')
      expect.fail('pauseSessionChanges should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'pauseSessionChanges error: pause session failed'
      )
    }

    try {
      await sessionModule.beginSessionTransaction('session-id')
      expect.fail('beginSessionTransaction should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'beginSessionTransaction error: begin transaction failed'
      )
    }

    try {
      await sessionModule.endSessionTransaction('session-id')
      expect.fail('endSessionTransaction should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'endSessionTransaction error: end transaction failed'
      )
    }

    try {
      await sessionModule.resumeSessionChanges('session-id')
      expect.fail('resumeSessionChanges should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'resumeSessionChanges error: resume session failed'
      )
    } finally {
      restoreGetClient()
    }
  })

  it('should handle unsubscribe session callback, timeout, and stream errors', async () => {
    let mode: 'callback-error' | 'cancelled' | 'critical' | 'timeout' =
      'callback-error'
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        unsubscribeToSessionEvents(
          _request: unknown,
          callback: (
            err: Error | null,
            response?: { getId(): string; toObject(): { id: string } }
          ) => void
        ) {
          if (mode === 'callback-error') {
            callback(
              Object.assign(new Error('unsubscribe session failed'), {
                code: 13,
                details: 'rpc failed',
              })
            )
          }

          return {
            on(_eventName: string, handler: (err: Error) => void) {
              if (mode === 'cancelled') {
                callback(null, makeObjectIdResponse('session-id'))
                handler(new Error('Call cancelled'))
              }
              if (mode === 'critical') {
                handler(new Error('session stream exploded'))
              }
              return this
            },
          }
        },
      })
    )
    const originalTimeout = process.env.OMEGA_EDIT_UNSUBSCRIBE_TIMEOUT_MS

    try {
      await sessionModule.unsubscribeSession('session-id')
      expect.fail(
        'unsubscribeSession should reject when the callback returns an error'
      )
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'unsubscribeSession error: unsubscribe session failed'
      )
    }

    mode = 'cancelled'
    expect(await sessionModule.unsubscribeSession('session-id')).to.equal(
      'session-id'
    )

    mode = 'critical'
    try {
      await sessionModule.unsubscribeSession('session-id')
      expect.fail('unsubscribeSession should reject critical stream failures')
    } catch (err) {
      expect((err as Error).message).to.equal('session stream exploded')
    }

    mode = 'timeout'
    process.env.OMEGA_EDIT_UNSUBSCRIBE_TIMEOUT_MS = '1'

    try {
      await sessionModule.unsubscribeSession('session-id')
      expect.fail('unsubscribeSession should reject when the RPC never settles')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'unsubscribeSession error: timed out after 1ms'
      )
    } finally {
      if (originalTimeout === undefined) {
        delete process.env.OMEGA_EDIT_UNSUBSCRIBE_TIMEOUT_MS
      } else {
        process.env.OMEGA_EDIT_UNSUBSCRIBE_TIMEOUT_MS = originalTimeout
      }
      restoreGetClient()
    }
  })

  it('should reject session metadata wrapper failures', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        getByteOrderMark(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('bom failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        getContentType(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('content type failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        getLanguage(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('language failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        getCharacterCounts(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('character count failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
      })
    )

    try {
      await sessionModule.getByteOrderMark('session-id')
      expect.fail('getByteOrderMark should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'getByteOrderMark error: bom failed')
    }

    try {
      await sessionModule.getContentType('session-id', 0, 1)
      expect.fail('getContentType should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'getContentType error: content type failed'
      )
    }

    try {
      await sessionModule.getLanguage('session-id', 0, 1, 'none')
      expect.fail('getLanguage should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'getLanguage error: language failed')
    }

    try {
      await sessionModule.countCharacters('session-id')
      expect.fail('countCharacters should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'countCharacters error: character count failed'
      )
    } finally {
      restoreGetClient()
    }
  })

  it('should reject session segment, count, notify, and profile wrapper failures', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        searchSession(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('search failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        getSegment(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('segment failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        getSessionCount(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('session count failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        notifyChangedViewports(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('notify failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
        getByteFrequencyProfile(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('profile failed'), {
              code: 13,
              details: 'rpc failed',
            })
          )
        },
      })
    )

    try {
      await sessionModule.searchSession('session-id', 'needle')
      expect.fail('searchSession should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'searchSession error: search failed')
    }

    try {
      await sessionModule.getSegment('session-id', 0, 1)
      expect.fail('getSegment should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'getSegment error: segment failed')
    }

    try {
      await sessionModule.getSessionCount()
      expect.fail('getSessionCount should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'getSessionCount error: session count failed'
      )
    }

    try {
      await sessionModule.notifyChangedViewports('session-id')
      expect.fail('notifyChangedViewports should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'notifyChangedViewports error: notify failed'
      )
    }

    try {
      await sessionModule.profileSession('session-id')
      expect.fail('profileSession should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'profileSession error: profile failed')
    } finally {
      restoreGetClient()
    }
  })

  it('should reject unsafe integer session values from the public API', async () => {
    const unsafeInteger = Number.MAX_SAFE_INTEGER + 1
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        getComputedFileSize(
          _request: unknown,
          callback: (err: Error | null, response?: { count: number }) => void
        ) {
          callback(null, { count: unsafeInteger })
        },
      })
    )

    try {
      await sessionModule.getComputedFileSize('session-id')
      expect.fail('getComputedFileSize should reject unsafe integers')
    } catch (err) {
      expect((err as Error).message).to.equal(
        "computed file size exceeds the OmegaEdit TypeScript client's safe integer range"
      )
    } finally {
      restoreGetClient()
    }
  })

  it('should reject unsafe integer inputs before issuing session RPCs', async () => {
    let getSegmentCalls = 0
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        getSegment() {
          getSegmentCalls += 1
        },
      })
    )

    try {
      await sessionModule.getSegment(
        'session-id',
        Number.MAX_SAFE_INTEGER + 1,
        1
      )
      expect.fail('getSegment should reject unsafe integer inputs')
    } catch (err) {
      expect((err as Error).message).to.equal(
        'getSegment offset must be a safe integer in the OmegaEdit TypeScript client'
      )
      expect(getSegmentCalls).to.equal(0)
    } finally {
      restoreGetClient()
    }
  })
})
