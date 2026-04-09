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

import { expect, initChai } from './common.js'
import { getModuleCompat } from './moduleCompat.js'

const { require } = getModuleCompat(import.meta.url)
const clientPackage =
  require('../../dist/cjs/index.js') as typeof import('../../src/index')
const {
  EditorSessionModel,
  ScopedEditorSessionHandle,
  SessionEvent,
  SessionEventKind,
} = clientPackage

describe('Editor Session Abstractions', () => {
  before(async () => {
    await initChai()
  })

  it('should track session state, viewport identity, and sync waiters', async () => {
    const model = new EditorSessionModel({
      sessionId: 'session-id',
      viewportId: 'viewport-a',
      fileSize: 12,
      changeCount: 0,
    })

    const syncWait = model.waitForSync(0, 1000)
    model.applySessionStateUpdate(16, 1)
    await syncWait

    expect(model.getSnapshot()).to.deep.equal({
      sessionId: 'session-id',
      viewportId: 'viewport-a',
      fileSize: 16,
      changeCount: 1,
      syncVersion: 1,
    })

    model.updateViewportId('viewport-b')
    expect(model.viewportId).to.equal('viewport-b')

    const ignored = model.trackSessionEvent(
      new SessionEvent({
        sessionId: 'session-id',
        sessionEventKind: SessionEventKind.SAVE,
        computedFileSize: 99,
        changeCount: 99,
        undoCount: 0,
      })
    )
    expect(ignored).to.equal(false)
    expect(model.fileSize).to.equal(16)

    const rejectedSync = model.waitForSync(1, 1000)
    model.dispose(new Error('disposed for test'))

    await rejectedSync.then(
      () => expect.fail('Expected waitForSync to reject after dispose'),
      (error: Error) => {
        expect(error.message).to.equal('disposed for test')
      }
    )
  })

  it('should scope session creation, subscriptions, viewport swaps, and cleanup', async () => {
    const calls: string[] = []
    let nextViewportId = 1
    let managedOptions:
      | {
          onSessionEvent(
            event: InstanceType<typeof SessionEvent>
          ): void | Promise<void>
          onSessionError(error: Error): void | Promise<void>
        }
      | undefined
    let cancelled = 0
    const swappedViewportIds: string[] = []

    const handle = await ScopedEditorSessionHandle.openFile('sample.bin', {
      capacity: 128,
      createSession: async (filePath: string = '') => {
        calls.push(`createSession:${filePath}`)
        return {
          getSessionId() {
            return 'session-id'
          },
        } as never
      },
      getComputedFileSize: async (sessionId: string) => {
        calls.push(`getComputedFileSize:${sessionId}`)
        return 24
      },
      createViewport: async (
        _desiredViewportId: string | undefined,
        sessionId: string,
        offset: number,
        capacity: number
      ) => {
        const viewportId = `viewport-${nextViewportId++}`
        calls.push(
          `createViewport:${sessionId}:${offset}:${capacity}:${viewportId}`
        )
        return {
          getViewportId() {
            return viewportId
          },
        } as never
      },
      destroyViewport: async (viewportId: string) => {
        calls.push(`destroyViewport:${viewportId}`)
        return viewportId
      },
      destroySession: async (sessionId: string) => {
        calls.push(`destroySession:${sessionId}`)
        return sessionId
      },
    })

    expect(handle.sessionId).to.equal('session-id')
    expect(handle.viewportId).to.equal('viewport-1')
    expect(handle.model.fileSize).to.equal(24)

    const seenStateChanges: number[] = []
    await handle.startSubscriptions({
      sessionInterest: 7,
      viewportInterest: 11,
      manageSubscriptions: async (options) => {
        calls.push(
          `manageSubscriptions:${options.sessionId}:${options.viewportId}:${options.sessionInterest}:${options.viewportInterest}`
        )
        managedOptions = {
          onSessionEvent: options.onSessionEvent,
          onSessionError: options.onSessionError ?? (async () => {}),
        }
        return {
          cancel() {
            cancelled += 1
          },
          async setViewportId(viewportId: string) {
            swappedViewportIds.push(viewportId)
          },
        }
      },
      onSessionEvent: async (_event, context) => {
        if (context.stateChanged) {
          seenStateChanges.push(context.model.fileSize)
        }
      },
    })

    await managedOptions?.onSessionEvent(
      new SessionEvent({
        sessionId: 'session-id',
        sessionEventKind: SessionEventKind.EDIT,
        computedFileSize: 30,
        changeCount: 2,
        undoCount: 0,
      })
    )

    expect(handle.model.fileSize).to.equal(30)
    expect(handle.model.changeCount).to.equal(2)
    expect(seenStateChanges).to.deep.equal([30])

    const syncWait = handle.model.waitForSync(handle.model.syncVersion, 1000)
    await managedOptions?.onSessionError(new Error('stream failed'))
    await syncWait.then(
      () => expect.fail('Expected session error to reject pending waiters'),
      (error: Error) => {
        expect(error.message).to.equal(
          'Session event stream closed before sync completed'
        )
      }
    )

    await handle.recreateViewport(64, 256)
    expect(handle.viewportId).to.equal('viewport-2')
    expect(swappedViewportIds).to.deep.equal(['viewport-2'])

    await handle.dispose()

    expect(cancelled).to.equal(1)
    expect(calls).to.deep.equal([
      'createSession:sample.bin',
      'getComputedFileSize:session-id',
      'createViewport:session-id:0:128:viewport-1',
      'manageSubscriptions:session-id:viewport-1:7:11',
      'createViewport:session-id:64:256:viewport-2',
      'destroyViewport:viewport-1',
      'destroyViewport:viewport-2',
      'destroySession:session-id',
    ])
  })
})
