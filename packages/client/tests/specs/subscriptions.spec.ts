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

import { EventEmitter } from 'events'
import { expect, initChai } from './common.js'
import { getModuleCompat } from './moduleCompat.js'

const { require } = getModuleCompat(import.meta.url)
const clientPackage =
  require('../../dist/cjs/index.js') as typeof import('../../src/index')
const { SessionEvent, ViewportEvent, subscribeSessionEvents, subscribeViewportEvents } =
  clientPackage

class FakeReadableStream<TEvent> extends EventEmitter {
  cancelCount = 0
  private readonly _eventType: TEvent | undefined = undefined

  cancel(): void {
    void this._eventType
    this.cancelCount += 1
  }
}

function flushAsyncCallbacks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Managed Subscriptions', () => {
  before(async () => {
    await initChai()
  })

  it('should subscribe session events, ignore benign errors, and cancel idempotently', async () => {
    const stream = new FakeReadableStream<InstanceType<typeof SessionEvent>>()
    const serials: number[] = []
    const errors: string[] = []

    const subscription = await subscribeSessionEvents({
      sessionId: 'session-id',
      interest: 7,
      onEvent: (event) => {
        serials.push(event.getSerial())
      },
      onError: (error) => {
        errors.push(error.message)
      },
      subscribe: async (request) => {
        expect(request.getId()).to.equal('session-id')
        expect(request.getInterest()).to.equal(7)
        return stream
      },
    })

    stream.emit(
      'data',
      new SessionEvent({
        sessionId: 'session-id',
        sessionEventKind: 2,
        computedFileSize: 10,
        changeCount: 1,
        undoCount: 0,
        serial: 4,
      })
    )
    await flushAsyncCallbacks()

    stream.emit('error', new Error('Call cancelled'))
    stream.emit('error', new Error('read ECONNRESET'))
    await flushAsyncCallbacks()

    subscription.cancel()
    subscription.cancel()

    expect(serials).to.deep.equal([4])
    expect(errors).to.deep.equal([])
    expect(stream.cancelCount).to.equal(1)
  })

  it('should route viewport callback failures and critical stream errors to onError', async () => {
    const stream = new FakeReadableStream<InstanceType<typeof ViewportEvent>>()
    const errors: string[] = []

    await subscribeViewportEvents({
      viewportId: 'viewport-id',
      onEvent: () => {
        throw new Error('handler failed')
      },
      onError: (error) => {
        errors.push(error.message)
      },
      subscribe: async (request) => {
        expect(request.getId()).to.equal('viewport-id')
        expect(request.getInterest()).to.equal(undefined)
        return stream
      },
    })

    stream.emit(
      'data',
      new ViewportEvent({
        sessionId: 'session-id',
        viewportId: 'viewport-id',
        viewportEventKind: 2,
        serial: 6,
        offset: 12,
        length: 2,
        data: new Uint8Array([0x41, 0x42]),
      })
    )
    await flushAsyncCallbacks()

    stream.emit('error', new Error('viewport stream failed'))
    await flushAsyncCallbacks()

    expect(errors).to.deep.equal([
      'handler failed',
      'viewport stream failed',
    ])
  })
})
