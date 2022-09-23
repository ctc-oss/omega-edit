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
  clear,
  del,
  getChangeCount,
  insert,
  overwrite,
  redo,
  undo,
} from '../../src/change'
import {
  getComputedFileSize,
  getSegment,
  pauseSessionChanges,
  resumeSessionChanges,
} from '../../src/session'
import {
  createViewport,
  destroyViewport,
  getViewportData,
} from '../../src/viewport'
import { decode, encode } from 'fastestsmallesttextencoderdecoder'
// @ts-ignore
import { check_callback_count, cleanup, custom_setup, delay } from './common'
import {
  EventSubscriptionRequest,
  SessionEventKind,
  ViewportEventKind,
} from '../../src/omega_edit_pb'
import { ALL_EVENTS, getClient } from '../../src/settings'

let session_callbacks = new Map()

async function subscribeSession(
  session_id: string,
  interest?: number
): Promise<string> {
  let subscriptionRequest = new EventSubscriptionRequest().setId(session_id)
  if (interest !== undefined) subscriptionRequest.setInterest(interest)
  getClient()
    .subscribeToSessionEvents(subscriptionRequest)
    .on('data', (sessionEvent) => {
      session_callbacks.set(
        session_id,
        session_callbacks.has(session_id)
          ? 1 + session_callbacks.get(session_id)
          : 1
      )
      const event = sessionEvent.getSessionEventKind()
      if (SessionEventKind.SESSION_EVT_EDIT == event) {
        console.log(
          'session: ' +
            session_id +
            ', event: ' +
            sessionEvent.getSessionEventKind() +
            ', serial: ' +
            sessionEvent.getSerial() +
            ', count: ' +
            session_callbacks.get(session_id)
        )
      } else {
        console.log(
          'session: ' +
            session_id +
            ', event: ' +
            sessionEvent.getSessionEventKind() +
            ', count: ' +
            session_callbacks.get(session_id)
        )
      }
    })
  return session_id
}

let viewport_callbacks = new Map()

async function subscribeViewport(
  viewport_id: string,
  interest?: number
): Promise<string> {
  let subscriptionRequest = new EventSubscriptionRequest().setId(viewport_id)
  if (interest) {
    subscriptionRequest.setInterest(interest)
  }
  getClient()
    .subscribeToViewportEvents(subscriptionRequest)
    .on('data', (viewportEvent) => {
      viewport_callbacks.set(
        viewport_id,
        viewport_callbacks.has(viewport_id)
          ? 1 + viewport_callbacks.get(viewport_id)
          : 1
      )
      const event = viewportEvent.getViewportEventKind()
      if (ViewportEventKind.VIEWPORT_EVT_EDIT == event) {
        console.log(
          'viewport_id: ' +
            viewport_id +
            ', event: ' +
            event +
            ', serial: ' +
            viewportEvent.getSerial() +
            ', offset: ' +
            viewportEvent.getOffset() +
            ', length: ' +
            viewportEvent.getLength() +
            ', data: "' +
            decode(viewportEvent.getData()) +
            '", callbacks: ' +
            viewport_callbacks.get(viewport_id)
        )
      } else {
        console.log(
          'viewport: ' +
            viewport_id +
            ', event: ' +
            event +
            ', count: ' +
            viewport_callbacks.get(viewport_id)
        )
      }
    })
  return viewport_id
}

describe('StressTest', () => {
  const full_rotations = 2
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await custom_setup()
  })

  afterEach('Destroy session', async () => {
    await cleanup(session_id)
  })

  it('Should handle fast inserting', async () => {
    const data = encode(
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:",<.>/?`~'.repeat(
        10
      )
    )
    const viewport_id = await createViewport(
      undefined,
      session_id,
      0,
      data.length,
      false
    )
    await subscribeViewport(viewport_id)
    await subscribeSession(session_id, ALL_EVENTS)
    await delay(50)
    for (let i = 0; i < data.length; ++i) {
      await insert(session_id, 0, new Uint8Array([data[i]]))
    }
    expect(await getSegment(session_id, 0, data.length)).deep.equals(
      data.reverse()
    )
    console.log(session_callbacks)
    console.log(viewport_callbacks)
    await delay(100)
    await check_callback_count(session_callbacks, session_id, data.length)
    await check_callback_count(viewport_callbacks, viewport_id, data.length)
    for (let i = 0; i < data.length; ++i) {
      // delete from the front
      await del(session_id, 0, 1)
    }
    expect(await getComputedFileSize(session_id)).to.equal(0)
    console.log(session_callbacks)
    console.log(viewport_callbacks)
    await delay(100)
    await check_callback_count(session_callbacks, session_id, data.length * 2)
    await check_callback_count(viewport_callbacks, viewport_id, data.length * 2)
  }).timeout(10000)

  it('Should handle fast appending', async () => {
    const data = encode(
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:",<.>/?`~'.repeat(
        10
      )
    )
    const viewport_id = await createViewport(
      undefined,
      session_id,
      0,
      data.length,
      false
    )
    await subscribeViewport(viewport_id)
    await subscribeSession(session_id, ALL_EVENTS)
    await delay(50)
    for (let i = 0; i < data.length; ++i) {
      await insert(session_id, i, new Uint8Array([data[i]]))
    }
    expect(await getSegment(session_id, 0, data.length)).deep.equals(data)
    await check_callback_count(session_callbacks, session_id, data.length)
    await check_callback_count(viewport_callbacks, viewport_id, data.length)
    for (let i = 0; i < data.length; ++i) {
      // delete from the back
      await del(session_id, data.length - i - 1, 1)
    }
    expect(await getComputedFileSize(session_id)).to.equal(0)
    console.log(session_callbacks)
    console.log(viewport_callbacks)
    await delay(100)
    await check_callback_count(session_callbacks, session_id, data.length * 2)
    await check_callback_count(viewport_callbacks, viewport_id, data.length * 2)
  }).timeout(10000)

  it(
    'Should stress test all the editing capabilities (' +
      full_rotations +
      ' rotations)',
    async () => {
      expect(full_rotations).to.be.a('number').greaterThan(0)

      const data = encode(
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:",<.>/?`~'
      )
      await subscribeSession(session_id, ALL_EVENTS)
      let change_id = await insert(session_id, 0, data)

      expect(change_id).to.equal(1)
      const file_size = await getComputedFileSize(session_id)
      expect(file_size).to.equal(data.length)

      await pauseSessionChanges(session_id)

      console.log(
        '\x1b[33m%s\x1b[0m',
        'Expect to see an "Error:" here, we are intentionally causing it'
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

      const viewport_id = await createViewport(
        'last_byte_vpt',
        session_id,
        file_size - 1,
        1,
        false
      )
      const viewport_2_id = await createViewport(
        'all_data_vpt',
        session_id,
        0,
        file_size,
        false
      )
      await subscribeViewport(viewport_id, ALL_EVENTS)
      await subscribeViewport(viewport_2_id, ALL_EVENTS)
      let viewport_data = await getViewportData(viewport_id)

      expect(decode(viewport_data.getData_asU8())).to.equal('~')

      let rotations = file_size * full_rotations
      const expected_num_changes = 1 + 3 * file_size * full_rotations

      while (rotations--) {
        console.log('\x1b[33m%s\x1b[0m', 'rotations remaining: ' + rotations)
        viewport_data = await getViewportData(viewport_id)

        change_id = await insert(session_id, 0, ' ')
        expect(
          await overwrite(session_id, 0, decode(viewport_data.getData_asU8()))
        ).to.equal(1 + change_id)

        expect((await undo(session_id)) * -1).to.equal(await redo(session_id))

        change_id = await del(session_id, file_size, 1)
        viewport_data = await getViewportData(viewport_2_id)
      }

      expect(change_id)
        .to.equal(await getChangeCount(session_id))
        .and.to.equal(expected_num_changes)

      viewport_data = await getViewportData(viewport_2_id)

      expect(viewport_data.getData_asU8()).to.deep.equal(data)
      expect(await getComputedFileSize(session_id)).to.equal(file_size)
      await delay(100)
      expect(await destroyViewport(viewport_2_id)).to.equal(viewport_2_id)
      await clear(session_id)
      expect(await getComputedFileSize(session_id)).to.equal(0)
      expect(await getChangeCount(session_id)).to.equal(0)

      expect(await destroyViewport(viewport_id)).to.equal(viewport_id)

      await check_callback_count(
        session_callbacks,
        session_id,
        465 * full_rotations + 1,
        500
      )
      await check_callback_count(
        viewport_callbacks,
        viewport_id,
        184 * full_rotations + 1
      )
      await check_callback_count(
        viewport_callbacks,
        viewport_2_id,
        460 * full_rotations
      )

      console.info('\x1b[32m%s\x1b[0m', session_callbacks)
      console.info('\x1b[32m%s\x1b[0m', viewport_callbacks)
    }
  ).timeout(10000 * full_rotations)
})
