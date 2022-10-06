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
import { ALL_EVENTS, getClient } from '../../src/settings'
import { del, getChangeCount, insert, overwrite } from '../../src/change'
import { getComputedFileSize, getSegment } from '../../src/session'
import {
  createViewport,
  destroyViewport,
  getViewportCount,
  getViewportData,
  unsubscribeViewport,
} from '../../src/viewport'
import { decode, encode } from 'fastestsmallesttextencoderdecoder'
import {
  EventSubscriptionRequest,
  ViewportEventKind,
} from '../../src/omega_edit_pb'
// @ts-ignore
import { check_callback_count, cleanup, custom_setup, delay } from './common'

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

describe('Viewports', () => {
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await custom_setup()
  })

  afterEach('Destroy session', async () => {
    await cleanup(session_id)
  })

  it('Should create and destroy viewports', async () => {
    const viewport_1_id = await createViewport(
      'test_vpt_1',
      session_id,
      0,
      10,
      false
    )
    if (viewport_1_id.includes(':')) {
      /* The Scala RPC server always prepends the session ID and colon to viewport IDs */
      expect(viewport_1_id).to.equal(session_id + ':test_vpt_1')
    } else {
      /* The C++ RPC server uses the desired viewport ID as given */
      expect(viewport_1_id).to.equal('test_vpt_1')
    }
    expect(await getViewportCount(session_id)).to.equal(1)

    const viewport_2_id = await createViewport(
      undefined,
      session_id,
      10,
      10,
      false
    )

    expect(viewport_2_id).to.be.a('string').with.length(73) // viewport_id is the session ID, colon, then a random UUID
    expect(await subscribeViewport(viewport_2_id)).to.equal(viewport_2_id)
    expect(await getViewportCount(session_id)).to.equal(2)
    console.log(viewport_callbacks)
    await check_callback_count(viewport_callbacks, viewport_2_id, 0, 500)

    let change_id = await insert(session_id, 0, '0123456789ABC')
    expect(change_id).to.equal(1)

    let file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(13)

    let viewport_data = await getViewportData(viewport_1_id)
    expect(decode(viewport_data.getData_asU8())).to.equal('0123456789')

    viewport_data = await getViewportData(viewport_2_id)
    expect(decode(viewport_data.getData_asU8())).to.equal('ABC')

    await check_callback_count(viewport_callbacks, viewport_2_id, 1, 500)

    change_id = await del(session_id, 0, 1) // Event 2
    expect(change_id).to.equal(2)

    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(12)

    viewport_data = await getViewportData(viewport_1_id)
    expect(decode(viewport_data.getData_asU8())).to.equal('123456789A')

    viewport_data = await getViewportData(viewport_2_id)
    expect(decode(viewport_data.getData_asU8())).to.equal('BC')

    await check_callback_count(viewport_callbacks, viewport_2_id, 2, 500)

    // Toggle off interest in edit events
    await subscribeViewport(
      viewport_2_id,
      ALL_EVENTS & ~ViewportEventKind.VIEWPORT_EVT_EDIT
    )
    await delay(100)
    change_id = await overwrite(session_id, 8, '!@#')
    expect(change_id).to.equal(3)

    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(12)

    let segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('12345678!@#C'))

    viewport_data = await getViewportData(viewport_1_id)
    expect(decode(viewport_data.getData_asU8())).to.equal('12345678!@')

    viewport_data = await getViewportData(viewport_2_id)
    expect(decode(viewport_data.getData_asU8())).to.equal('#C')
    await check_callback_count(viewport_callbacks, viewport_2_id, 2, 500)

    // Toggle on interest in all events
    await subscribeViewport(viewport_1_id)
    await subscribeViewport(viewport_2_id)
    await delay(500)
    change_id = await del(session_id, 0, 2)
    expect(change_id).to.equal(4)

    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('345678!@#C'))

    expect(await getViewportCount(session_id)).to.equal(2)
    const destroyed_viewport_id = await destroyViewport(viewport_2_id)
    expect(destroyed_viewport_id).to.equal(viewport_2_id)
    console.log('destroyed viewport: ' + destroyed_viewport_id)
    expect(await getViewportCount(session_id)).to.equal(1)
    console.log('num changes: ' + (await getChangeCount(session_id)))
    expect(await getChangeCount(session_id)).to.equal(4)
    console.log(viewport_callbacks)
    await check_callback_count(viewport_callbacks, viewport_1_id, 1, 500)
    await check_callback_count(viewport_callbacks, viewport_2_id, 3)
    console.log(viewport_callbacks)
  }).timeout(5000)

  it('Should handle floating viewports', async () => {
    let change_id = await insert(session_id, 0, '0123456789LABEL01234567890')
    expect(change_id).to.equal(1)

    const viewport_id = await createViewport(
      'test_vpt_no_float',
      session_id,
      10,
      5,
      false
    )
    expect(await subscribeViewport(viewport_id)).to.equal(viewport_id)
    const viewport_floating_id = await createViewport(
      'test_vpt_label',
      session_id,
      10,
      5,
      true
    )
    expect(await subscribeViewport(viewport_floating_id)).to.equal(
      viewport_floating_id
    )
    let viewport_data = await getViewportData(viewport_floating_id)

    expect(decode(viewport_data.getData_asU8())).to.equal('LABEL')
    expect(viewport_data.getOffset()).to.equal(10)

    viewport_data = await getViewportData(viewport_id)
    expect(decode(viewport_data.getData_asU8())).to.equal('LABEL')
    expect(viewport_data.getOffset()).to.equal(10)

    change_id = await del(session_id, 0, 5)
    expect(change_id).to.equal(2)

    viewport_data = await getViewportData(viewport_floating_id)
    expect(decode(viewport_data.getData_asU8())).to.equal('LABEL')
    expect(viewport_data.getOffset()).to.equal(5)

    viewport_data = await getViewportData(viewport_id)
    expect(viewport_data.getOffset()).to.equal(10)
    expect(decode(viewport_data.getData_asU8())).to.equal('01234')

    let file_size = await getComputedFileSize(session_id)
    let segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('56789LABEL01234567890'))

    await unsubscribeViewport(viewport_id)
    change_id = await insert(session_id, 0, '01234')
    expect(change_id).to.equal(3)

    viewport_data = await getViewportData(viewport_floating_id)
    expect(decode(viewport_data.getData_asU8())).to.equal('LABEL')
    expect(viewport_data.getOffset()).to.equal(10)

    viewport_data = await getViewportData(viewport_id)
    expect(decode(viewport_data.getData_asU8())).to.equal('LABEL')
    expect(viewport_data.getOffset()).to.equal(10)

    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('0123456789LABEL01234567890'))
    await delay(500)
    await check_callback_count(viewport_callbacks, viewport_id, 1)
    await check_callback_count(viewport_callbacks, viewport_floating_id, 2)
  }).timeout(5000)
})
