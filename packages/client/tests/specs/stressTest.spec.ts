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

import { expect } from 'chai'
import {
  ALL_EVENTS,
  clear,
  CountKind,
  createViewport,
  del,
  destroyViewport,
  getChangeCount,
  getComputedFileSize,
  getCounts,
  getSegment,
  getViewportData,
  insert,
  overwrite,
  pauseSessionChanges,
  redo,
  resumeSessionChanges,
  undo,
} from '@omega-edit/client'
import {
  checkCallbackCount,
  createTestSession,
  destroyTestSession,
  log_info,
  session_callbacks,
  subscribeSession,
  subscribeViewport,
  testPort,
  viewport_callbacks,
} from './common'

describe('StressTest', () => {
  const full_rotations = 12
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await createTestSession(testPort)
  })

  afterEach('Destroy session', async () => {
    await destroyTestSession(session_id)
  })

  it('Should handle fast inserting', async () => {
    const data = Buffer.from(
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:",<.>/?`~'.repeat(
        10
      )
    )
    const viewport_response = await createViewport(
      undefined,
      session_id,
      0,
      data.length,
      false
    )
    const viewport_id = viewport_response.getViewportId()
    await subscribeViewport(viewport_id)
    await subscribeSession(session_id, ALL_EVENTS)
    for (let i = 0; i < data.length; ++i) {
      await insert(session_id, 0, new Uint8Array([data[i]]))
    }
    expect(await getSegment(session_id, 0, data.length)).deep.equals(
      data.reverse()
    )
    log_info(session_callbacks)
    log_info(viewport_callbacks)
    await checkCallbackCount(session_callbacks, session_id, data.length)
    await checkCallbackCount(viewport_callbacks, viewport_id, data.length)
    for (let i = 0; i < data.length; ++i) {
      // delete from the front
      await del(session_id, 0, 1)
    }
    expect(await getComputedFileSize(session_id)).to.equal(0)
    log_info(session_callbacks)
    log_info(viewport_callbacks)
    await checkCallbackCount(session_callbacks, session_id, data.length * 2)
    await checkCallbackCount(viewport_callbacks, viewport_id, data.length * 2)
  }).timeout(10000)

  it('Should handle fast appending', async () => {
    const data = Buffer.from(
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:",<.>/?`~'.repeat(
        10
      )
    )
    const viewport_response = await createViewport(
      undefined,
      session_id,
      0,
      data.length,
      false
    )
    const viewport_id = viewport_response.getViewportId()
    await subscribeViewport(viewport_id)
    await subscribeSession(session_id, ALL_EVENTS)
    for (let i = 0; i < data.length; ++i) {
      await insert(session_id, i, new Uint8Array([data[i]]))
    }
    expect(await getSegment(session_id, 0, data.length)).deep.equals(data)
    await checkCallbackCount(session_callbacks, session_id, data.length)
    await checkCallbackCount(viewport_callbacks, viewport_id, data.length)
    for (let i = 0; i < data.length; ++i) {
      // delete from the back
      await del(session_id, data.length - i - 1, 1)
    }
    expect(await getComputedFileSize(session_id)).to.equal(0)
    log_info(session_callbacks)
    log_info(viewport_callbacks)
    await checkCallbackCount(session_callbacks, session_id, data.length * 2)
    await checkCallbackCount(viewport_callbacks, viewport_id, data.length * 2)
  }).timeout(10000)

  it(
    'Should stress test all the editing capabilities (' +
      full_rotations +
      ' rotations)',
    async () => {
      expect(full_rotations).to.be.a('number').greaterThan(0)

      const data = Buffer.from(
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:",<.>/?`~'
      )
      await subscribeSession(session_id, ALL_EVENTS)
      let change_id = await insert(session_id, 0, data)

      expect(change_id).to.equal(1)
      const file_size = await getComputedFileSize(session_id)
      expect(file_size).to.equal(data.length)

      await pauseSessionChanges(session_id)

      log_info(
        '\x1b[33m%s\x1b[0mExpect to see an "Error:" here, we are intentionally causing it'
      ) // yellow text
      await insert(session_id, 0, data).catch((e) => {
        expect(e)
          .to.be.an('error')
          .with.property('message')
          .to.be.a('string')
          .and.satisfy((msg) => msg.startsWith('insert failed'))
      })
      await resumeSessionChanges(session_id)
      expect(await getComputedFileSize(session_id)).to.equal(data.length)

      const viewport_response = await createViewport(
        'last_byte_vpt',
        session_id,
        file_size - 1,
        1,
        false
      )
      const viewport_id = viewport_response.getViewportId()
      const viewport_2_response = await createViewport(
        'all_data_vpt',
        session_id,
        0,
        file_size,
        false
      )
      const viewport_2_id = viewport_2_response.getViewportId()
      await subscribeViewport(viewport_id, ALL_EVENTS)
      await subscribeViewport(viewport_2_id, ALL_EVENTS)

      expect(viewport_response.getData_asU8()).to.deep.equal(Buffer.from('~'))

      let rotations = file_size * full_rotations
      const expected_num_changes = 1 + 3 * file_size * full_rotations

      while (rotations--) {
        log_info('\x1b[33m%s\x1b[0mrotations remaining: ' + rotations)
        let viewport_data = await getViewportData(viewport_id)

        change_id = await insert(session_id, 0, Buffer.from(' '))
        expect(
          await overwrite(session_id, 0, viewport_data.getData_asU8())
        ).to.equal(1 + change_id)

        expect((await undo(session_id)) * -1).to.equal(await redo(session_id))

        change_id = await del(session_id, file_size, 1)
        viewport_data = await getViewportData(viewport_2_id)
      }

      expect(change_id)
        .to.equal(await getChangeCount(session_id))
        .and.to.equal(expected_num_changes)

      let viewport_data = await getViewportData(viewport_2_id)

      expect(viewport_data.getData_asU8()).to.deep.equal(data)
      expect(await getComputedFileSize(session_id)).to.equal(file_size)
      expect(await destroyViewport(viewport_2_id)).to.equal(viewport_2_id)
      await undo(session_id)
      const countKinds = [
        CountKind.COUNT_COMPUTED_FILE_SIZE,
        CountKind.COUNT_CHANGES,
        CountKind.COUNT_UNDOS,
        CountKind.COUNT_VIEWPORTS,
        CountKind.COUNT_CHECKPOINTS,
        CountKind.COUNT_SEARCH_CONTEXTS,
        CountKind.COUNT_CHANGE_TRANSACTIONS,
        CountKind.COUNT_UNDO_TRANSACTIONS,
      ]
      let counts = await getCounts(session_id, countKinds)
      expect(counts).to.be.an('array').with.lengthOf(countKinds.length)
      const computedFileSize = await getComputedFileSize(session_id)
      counts.forEach((count) => {
        const c = count.getCount()
        switch (count.getKind()) {
          case CountKind.COUNT_COMPUTED_FILE_SIZE:
            expect(c).to.equal(computedFileSize)
            break
          case CountKind.COUNT_CHANGES:
            expect(c).to.equal(276 * full_rotations)
            break
          case CountKind.COUNT_UNDOS:
            expect(c).to.equal(1)
            break
          case CountKind.COUNT_VIEWPORTS:
            expect(c).to.equal(1)
            break
          case CountKind.COUNT_CHECKPOINTS:
            expect(c).to.equal(0)
            break
          case CountKind.COUNT_SEARCH_CONTEXTS:
            expect(c).to.equal(0)
            break
          case CountKind.COUNT_CHANGE_TRANSACTIONS:
            expect(c).to.equal(276 * full_rotations)
            break
          case CountKind.COUNT_UNDO_TRANSACTIONS:
            expect(c).to.equal(1)
            break
          default:
            throw new Error('Unknown count kind: ' + count.getKind())
        }
      })
      await clear(session_id)
      expect(await destroyViewport(viewport_id)).to.equal(viewport_id)
      counts = await getCounts(session_id, countKinds)
      expect(counts).to.be.an('array').with.lengthOf(countKinds.length)
      counts.forEach((count) => {
        const c = count.getCount()
        switch (count.getKind()) {
          case CountKind.COUNT_COMPUTED_FILE_SIZE:
            expect(c).to.equal(0)
            break
          case CountKind.COUNT_CHANGES:
            expect(c).to.equal(0)
            break
          case CountKind.COUNT_UNDOS:
            expect(c).to.equal(0)
            break
          case CountKind.COUNT_VIEWPORTS:
            expect(c).to.equal(0)
            break
          case CountKind.COUNT_CHECKPOINTS:
            expect(c).to.equal(0)
            break
          case CountKind.COUNT_SEARCH_CONTEXTS:
            expect(c).to.equal(0)
            break
          case CountKind.COUNT_CHANGE_TRANSACTIONS:
            expect(c).to.equal(0)
            break
          case CountKind.COUNT_UNDO_TRANSACTIONS:
            expect(c).to.equal(0)
            break
          default:
            throw new Error('Unknown count kind: ' + count.getKind())
        }
      })
      expect(await getComputedFileSize(session_id)).to.equal(0)
      expect(await getChangeCount(session_id)).to.equal(0)

      await checkCallbackCount(
        session_callbacks,
        session_id,
        465 * full_rotations + 1
      )
      await checkCallbackCount(
        viewport_callbacks,
        viewport_id,
        184 * full_rotations + 1
      )
      await checkCallbackCount(
        viewport_callbacks,
        viewport_2_id,
        460 * full_rotations
      )

      log_info('\x1b[32m%s\x1b[0m', session_callbacks)
      log_info('\x1b[32m%s\x1b[0m', viewport_callbacks)
    }
  ).timeout(10000 * full_rotations)
})
