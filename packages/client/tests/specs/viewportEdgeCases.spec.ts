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
let viewportModule: typeof import('../../src/viewport')

describe('Viewport Edge Cases', () => {
  let restoreLogger = () => {}

  before(() => {
    delete require.cache[require.resolve('../../dist/cjs/logger.js')]
    delete require.cache[require.resolve('../../dist/cjs/client.js')]
    delete require.cache[require.resolve('../../dist/cjs/viewport.js')]
    delete require.cache[
      require.resolve('../../dist/cjs/protobuf_ts/viewport.js')
    ]
    restoreLogger = silenceClientLogger(require)
    clientModule =
      require('../../dist/cjs/client.js') as typeof import('../../src/client')
    viewportModule =
      require('../../dist/cjs/viewport.js') as typeof import('../../src/viewport')
  })

  after(() => {
    restoreLogger()
  })

  it('should reject createViewport, modifyViewport, and destroyViewport failures', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        createViewport(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('create failed'), {
              details: 'rpc failed',
              code: 13,
            })
          )
        },
        modifyViewport(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('modify failed'), {
              details: 'rpc failed',
              code: 13,
            })
          )
        },
        destroyViewport(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('destroy failed'), {
              details: 'rpc failed',
              code: 13,
            })
          )
        },
      })
    )

    try {
      await viewportModule.createViewport(undefined, 'sid', 0, 100)
      expect.fail('createViewport should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'createViewport error: create failed')
    }

    try {
      await viewportModule.modifyViewport('vid', 0, 100)
      expect.fail('modifyViewport should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'modifyViewport error: modify failed')
    }

    try {
      await viewportModule.destroyViewport('vid')
      expect.fail('destroyViewport should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'destroyViewport error: destroy failed')
    } finally {
      restoreGetClient()
    }
  })

  it('should reject getViewportCount, getViewportData, and viewportHasChanges failures', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        getCount(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('count failed'), {
              details: 'rpc failed',
              code: 13,
            })
          )
        },
        getViewportData(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('data failed'), {
              details: 'rpc failed',
              code: 13,
            })
          )
        },
        viewportHasChanges(_request: unknown, callback: (err: Error) => void) {
          callback(
            Object.assign(new Error('changes failed'), {
              details: 'rpc failed',
              code: 13,
            })
          )
        },
      })
    )

    try {
      await viewportModule.getViewportCount('sid')
      expect.fail('getViewportCount should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'getViewportCount error: count failed')
    }

    try {
      await viewportModule.getViewportData('vid')
      expect.fail('getViewportData should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'getViewportData error: data failed')
    }

    try {
      await viewportModule.viewportHasChanges('vid')
      expect.fail('viewportHasChanges should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'viewportHasChanges error: changes failed'
      )
    } finally {
      restoreGetClient()
    }
  })

  it('should reject viewport pause and resume failures', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        pauseViewportEvents(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('pause failed'), {
              details: 'rpc failed',
              code: 13,
            })
          )
        },
        resumeViewportEvents(
          _request: unknown,
          callback: (err: Error | null, response?: unknown) => void
        ) {
          callback(
            Object.assign(new Error('resume failed'), {
              details: 'rpc failed',
              code: 13,
            })
          )
        },
      })
    )

    try {
      await viewportModule.pauseViewportEvents('session-id')
      expect.fail('pauseViewportEvents should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(expect, err, 'pauseViewportEvents error: pause failed')
    }

    try {
      await viewportModule.resumeViewportEvents('session-id')
      expect.fail('resumeViewportEvents should reject when the RPC fails')
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'resumeViewportEvents error: resume failed'
      )
    } finally {
      restoreGetClient()
    }
  })

  it('should handle unsubscribe callback errors, timeouts, and call-cancelled stream errors', async () => {
    let mode: 'callback-error' | 'cancelled' | 'timeout' = 'callback-error'
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        unsubscribeToViewportEvents(
          _request: unknown,
          callback: (
            err: Error | null,
            response?: { getId(): string; toObject(): { id: string } }
          ) => void
        ) {
          if (mode === 'callback-error') {
            callback(
              Object.assign(new Error('unsubscribe failed'), {
                details: 'rpc failed',
                code: 13,
              })
            )
          }

          return {
            on(_eventName: string, handler: (err: Error) => void) {
              if (mode === 'cancelled') {
                callback(null, makeObjectIdResponse('viewport-id'))
                handler(new Error('Call cancelled'))
              }
              return this
            },
          }
        },
      })
    )
    const originalTimeout = process.env.OMEGA_EDIT_UNSUBSCRIBE_TIMEOUT_MS

    try {
      await viewportModule.unsubscribeViewport('viewport-id')
      expect.fail(
        'unsubscribeViewport should reject when the callback returns an error'
      )
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'unsubscribeViewport error: unsubscribe failed'
      )
    }

    mode = 'cancelled'
    try {
      expect(await viewportModule.unsubscribeViewport('viewport-id')).to.equal(
        'viewport-id'
      )
    } finally {
      // continue into the timeout path with the same mocked client
    }

    mode = 'timeout'
    process.env.OMEGA_EDIT_UNSUBSCRIBE_TIMEOUT_MS = '1'

    try {
      await viewportModule.unsubscribeViewport('viewport-id')
      expect.fail(
        'unsubscribeViewport should reject when the RPC never settles'
      )
    } catch (err) {
      expectErrorMessage(
        expect,
        err,
        'unsubscribeViewport error: timed out after 1ms'
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

  it('should reject critical unsubscribe stream errors', async () => {
    const restoreGetClient = overrideProperty(
      clientModule as Record<string, any>,
      'getClient',
      async () => ({
        unsubscribeToViewportEvents(
          _request: unknown,
          _callback: (
            err: Error | null,
            response?: { getId(): string; toObject(): { id: string } }
          ) => void
        ) {
          return {
            on(_eventName: string, handler: (err: Error) => void) {
              handler(new Error('stream exploded'))
              return this
            },
          }
        },
      })
    )

    try {
      await viewportModule.unsubscribeViewport('viewport-id')
      expect.fail('unsubscribeViewport should reject critical stream failures')
    } catch (err) {
      expect((err as Error).message).to.equal('stream exploded')
    } finally {
      restoreGetClient()
    }
  })
})
