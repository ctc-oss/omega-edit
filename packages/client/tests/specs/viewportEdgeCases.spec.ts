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

import { expect } from './common'
import { overrideProperty } from './mockHelpers'

const clientModule =
  require('../../dist/cjs/client.js') as typeof import('../../src/client')
const viewportModule =
  require('../../dist/cjs/viewport.js') as typeof import('../../src/viewport')

describe('Viewport Edge Cases', () => {
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
      expect(err).to.equal('pauseViewportEvents error: pause failed')
    }

    try {
      await viewportModule.resumeViewportEvents('session-id')
      expect.fail('resumeViewportEvents should reject when the RPC fails')
    } catch (err) {
      expect(err).to.equal('resumeViewportEvents error: resume failed')
    } finally {
      restoreGetClient()
    }
  })

  it('should handle unsubscribe callback errors and call-cancelled stream errors', async () => {
    let mode: 'callback-error' | 'cancelled' = 'callback-error'
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
                callback(null, {
                  getId() {
                    return 'viewport-id'
                  },
                  toObject() {
                    return { id: 'viewport-id' }
                  },
                })
                handler(new Error('Call cancelled'))
              }
              return this
            },
          }
        },
      })
    )

    try {
      await viewportModule.unsubscribeViewport('viewport-id')
      expect.fail(
        'unsubscribeViewport should reject when the callback returns an error'
      )
    } catch (err) {
      expect(err).to.equal('unsubscribeViewport error: unsubscribe failed')
    }

    mode = 'cancelled'
    try {
      expect(await viewportModule.unsubscribeViewport('viewport-id')).to.equal(
        'viewport-id'
      )
    } finally {
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
