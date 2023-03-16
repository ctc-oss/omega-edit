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
import { ALL_EVENTS } from '../../src/client'
import { del, getChangeCount, insert, overwrite } from '../../src/change'
import {
  getComputedFileSize,
  getSegment,
  notifyChangedViewports,
} from '../../src/session'
import {
  createViewport,
  destroyViewport,
  getViewportCount,
  getViewportData,
  modifyViewport,
  pauseViewportEvents,
  resumeViewportEvents,
  unsubscribeViewport,
  viewportHasChanges,
  ViewportEventKind,
} from '../../src/viewport'

// prettier-ignore
// @ts-ignore
import { checkCallbackCount, createTestSession, destroyTestSession, log_info, subscribeViewport, viewport_callbacks, testPort } from './common'

describe('Viewports', () => {
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await createTestSession(testPort)
  })

  afterEach('Destroy session', async () => {
    await destroyTestSession(session_id)
  })

  it('Should create and destroy viewports', async () => {
    expect(await notifyChangedViewports(session_id)).to.equal(0)
    const viewport_1_response = await createViewport(
      'test_vpt_1',
      session_id,
      0,
      10,
      false
    )
    const viewport_1_id = viewport_1_response.getViewportId()
    expect(viewport_1_id).to.equal(session_id + ':test_vpt_1')
    expect(await getViewportCount(session_id)).to.equal(1)
    expect(await viewportHasChanges(viewport_1_id)).to.be.false
    expect(await notifyChangedViewports(session_id)).to.equal(0)

    const viewport_2_response = await createViewport(
      undefined,
      session_id,
      10,
      10,
      false
    )
    const viewport_2_id = viewport_2_response.getViewportId()
    expect(viewport_2_id).to.be.a('string').with.length(73) // viewport_id is the session ID, colon, then a random UUID
    expect(await subscribeViewport(viewport_2_id)).to.equal(viewport_2_id)
    expect(await viewportHasChanges(viewport_2_id)).to.be.false
    expect(await getViewportCount(session_id)).to.equal(2)
    log_info(viewport_callbacks)
    await checkCallbackCount(viewport_callbacks, viewport_2_id, 0)

    let change_id = await insert(session_id, 0, Buffer.from('0123456789ABC'))
    expect(change_id).to.equal(1)

    let file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(13)
    expect(await viewportHasChanges(viewport_1_id)).to.be.true
    let viewport_data = await getViewportData(viewport_1_id)
    expect(await viewportHasChanges(viewport_1_id)).to.be.false
    expect(viewport_data.getData_asU8()).to.deep.equal(
      Buffer.from('0123456789')
    )
    expect(viewport_data.getFollowingByteCount()).to.equal(3)
    viewport_data = await getViewportData(viewport_2_id)
    expect(viewport_data.getData_asU8()).to.deep.equal(Buffer.from('ABC'))
    expect(viewport_data.getFollowingByteCount()).to.equal(0)

    await checkCallbackCount(viewport_callbacks, viewport_2_id, 1)

    change_id = await del(session_id, 0, 1) // Event 2
    expect(change_id).to.equal(2)

    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(12)
    expect(await viewportHasChanges(viewport_1_id)).to.be.true
    expect(await viewportHasChanges(viewport_2_id)).to.be.false
    expect(await notifyChangedViewports(session_id)).to.equal(0)
    viewport_data = await getViewportData(viewport_1_id)
    expect(viewport_data.getData_asU8()).to.deep.equal(
      Buffer.from('123456789A')
    )
    expect(await viewportHasChanges(viewport_1_id)).to.be.false
    expect(viewport_data.getFollowingByteCount()).to.equal(2)

    viewport_data = await getViewportData(viewport_2_id)
    expect(viewport_data.getData_asU8()).to.deep.equal(Buffer.from('BC'))
    expect(viewport_data.getFollowingByteCount()).to.equal(0)

    await checkCallbackCount(viewport_callbacks, viewport_2_id, 2)

    // Toggle off interest in edit events
    await subscribeViewport(
      viewport_2_id,
      ALL_EVENTS & ~ViewportEventKind.VIEWPORT_EVT_EDIT
    )
    change_id = await overwrite(session_id, 8, Buffer.from('!@#'))
    expect(change_id).to.equal(3)

    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(12)

    let segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(Buffer.from('12345678!@#C'))

    viewport_data = await getViewportData(viewport_1_id)
    expect(viewport_data.getData_asU8()).to.deep.equal(
      Buffer.from('12345678!@')
    )
    expect(viewport_data.getFollowingByteCount()).to.equal(2)

    viewport_data = await getViewportData(viewport_2_id)
    expect(viewport_data.getData_asU8()).to.deep.equal(Buffer.from('#C'))
    expect(viewport_data.getFollowingByteCount()).to.equal(0)
    await checkCallbackCount(viewport_callbacks, viewport_2_id, 2)

    // Toggle on interest in all events
    await subscribeViewport(viewport_1_id)
    await subscribeViewport(viewport_2_id)
    await pauseViewportEvents(session_id)
    change_id = await del(session_id, 0, 2)
    expect(change_id).to.equal(4)
    await resumeViewportEvents(session_id)
    expect(await notifyChangedViewports(session_id)).to.equal(2)
    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(Buffer.from('345678!@#C'))

    expect(await getViewportCount(session_id)).to.equal(2)
    const destroyed_viewport_id = await destroyViewport(viewport_2_id)
    expect(destroyed_viewport_id).to.equal(viewport_2_id)
    log_info('destroyed viewport: ' + destroyed_viewport_id)
    expect(await getViewportCount(session_id)).to.equal(1)
    log_info('num changes: ' + (await getChangeCount(session_id)))
    expect(await getChangeCount(session_id)).to.equal(4)
    log_info(viewport_callbacks)
    await checkCallbackCount(viewport_callbacks, viewport_1_id, 1)
    await checkCallbackCount(viewport_callbacks, viewport_2_id, 3)
    log_info(viewport_callbacks)
  }).timeout(8000)

  it('Should handle floating viewports', async () => {
    let change_id = await insert(
      session_id,
      0,
      Buffer.from('0123456789LABEL01234567890')
    )
    expect(change_id).to.equal(1)

    const viewport_response = await createViewport(
      'test_vpt_no_float',
      session_id,
      10,
      5
    )
    const viewport_id = viewport_response.getViewportId()
    expect(await subscribeViewport(viewport_id)).to.equal(viewport_id)
    const viewport_floating_response = await createViewport(
      'test_vpt_label',
      session_id,
      10,
      5,
      true
    )
    const viewport_floating_id = viewport_floating_response.getViewportId()
    expect(await subscribeViewport(viewport_floating_id)).to.equal(
      viewport_floating_id
    )
    expect(await viewportHasChanges(viewport_floating_id)).to.be.false
    expect(viewport_floating_response.getData_asU8()).to.deep.equal(
      Buffer.from('LABEL')
    )
    expect(viewport_floating_response.getOffset()).to.equal(10)
    expect(viewport_floating_response.getFollowingByteCount()).to.equal(11)

    expect(viewport_response.getData_asU8()).to.deep.equal(Buffer.from('LABEL'))
    expect(viewport_response.getOffset()).to.equal(10)
    expect(viewport_response.getFollowingByteCount()).to.equal(11)

    change_id = await del(session_id, 0, 5)
    expect(change_id).to.equal(2)

    // data was fetched in the subscription callback
    expect(await viewportHasChanges(viewport_id)).to.be.false
    expect(await viewportHasChanges(viewport_floating_id)).to.be.false

    let viewport_data = await getViewportData(viewport_floating_id)
    expect(viewport_data.getData_asU8()).to.deep.equal(Buffer.from('LABEL'))
    expect(viewport_data.getOffset()).to.equal(5)
    expect(viewport_data.getFollowingByteCount()).to.equal(11)

    viewport_data = await getViewportData(viewport_id)
    expect(viewport_data.getOffset()).to.equal(10)
    expect(viewport_data.getData_asU8()).to.deep.equal(Buffer.from('01234'))
    expect(viewport_data.getFollowingByteCount()).to.equal(6)

    let file_size = await getComputedFileSize(session_id)
    let segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(Buffer.from('56789LABEL01234567890'))

    await unsubscribeViewport(viewport_id)
    change_id = await insert(session_id, 0, Buffer.from('01234'))
    expect(change_id).to.equal(3)

    expect(await viewportHasChanges(viewport_id)).to.be.true
    expect(await viewportHasChanges(viewport_floating_id)).to.be.false

    viewport_data = await getViewportData(viewport_floating_id)
    expect(viewport_data.getData_asU8()).to.deep.equal(Buffer.from('LABEL'))
    expect(viewport_data.getOffset()).to.equal(10)
    expect(viewport_data.getFollowingByteCount()).to.equal(11)

    viewport_data = await getViewportData(viewport_id)
    expect(viewport_data.getData_asU8()).to.deep.equal(Buffer.from('LABEL'))
    expect(viewport_data.getOffset()).to.equal(10)
    expect(viewport_data.getFollowingByteCount()).to.equal(11)

    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(Buffer.from('0123456789LABEL01234567890'))
    await checkCallbackCount(viewport_callbacks, viewport_id, 1)
    await checkCallbackCount(viewport_callbacks, viewport_floating_id, 2)

    // Test viewport with offset > computed file size
    const viewport_off_response = await createViewport(
      'test_vpt_off_end',
      session_id,
      100,
      5
    )
    const viewport_off_id = viewport_off_response.getViewportId()
    viewport_data = await getViewportData(viewport_off_id)
    expect(viewport_data.getData_asU8()).to.deep.equal(Buffer.from(''))
    expect(viewport_data.getLength()).to.equal(0)
    expect(viewport_data.getOffset()).to.equal(100)
    expect(viewport_data.getFollowingByteCount()).to.equal(-74)
  }).timeout(8000)

  it('Should be able to scroll through an editing session', async () => {
    const capacity = 100
    let viewport_response = await createViewport(
      'scroller',
      session_id,
      0,
      capacity,
      false
    )
    const viewport_id = viewport_response.getViewportId()
    expect(await viewportHasChanges(viewport_id)).to.be.false
    expect(viewport_response.getData_asU8()).to.deep.equal(Buffer.from(''))
    expect(viewport_response.getLength()).to.equal(0)
    expect(viewport_response.getOffset()).to.equal(0)
    expect(viewport_response.getFollowingByteCount()).to.equal(0)
    const pattern =
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ/*-+' // 62 bytes
    const patternLen = pattern.length
    await insert(session_id, 0, Buffer.from(pattern))
    expect(await viewportHasChanges(viewport_id)).to.be.true
    let viewport_data = await getViewportData(viewport_id)
    expect(viewport_data.getData_asU8()).to.deep.equal(Buffer.from(pattern))
    expect(viewport_data.getLength()).to.equal(patternLen)
    expect(viewport_data.getOffset()).to.equal(0)
    expect(viewport_data.getFollowingByteCount()).to.equal(0)
    await insert(session_id, 0, Buffer.from(pattern))
    viewport_data = await getViewportData(viewport_id)
    expect(viewport_data.getData_asU8().length).to.equal(capacity)
    expect(viewport_data.getLength()).to.equal(capacity)
    expect(viewport_data.getOffset()).to.equal(0)
    expect(viewport_data.getFollowingByteCount()).to.equal(2 * patternLen - 100)
    await insert(session_id, 0, Buffer.from(pattern))
    viewport_response = await modifyViewport(viewport_id, 10, 20)
    expect(viewport_response.getLength()).to.equal(20)
    expect(viewport_response.getOffset()).to.equal(10)
    expect(viewport_response.getFollowingByteCount()).to.equal(168)
    expect(viewport_response.getData_asU8()).to.deep.equal(
      Buffer.from('abcdefghijklmnopqrst')
    )
    viewport_response = await modifyViewport(viewport_id, 20, 20)
    expect(viewport_response.getLength()).to.equal(20)
    expect(viewport_response.getOffset()).to.equal(20)
    expect(viewport_response.getFollowingByteCount()).to.equal(158)
    expect(viewport_response.getData_asU8()).to.deep.equal(
      Buffer.from('klmnopqrstuvwxyzABCD')
    )
    viewport_response = await modifyViewport(viewport_id, 30, 20)
    expect(viewport_response.getLength()).to.equal(20)
    expect(viewport_response.getOffset()).to.equal(30)
    expect(viewport_response.getFollowingByteCount()).to.equal(148)
    expect(viewport_response.getData_asU8()).to.deep.equal(
      Buffer.from('uvwxyzABCDEFGHIJKLMN')
    )
    viewport_response = await modifyViewport(viewport_id, 170, 20)
    expect(viewport_response.getLength()).to.equal(20)
    expect(viewport_response.getOffset()).to.equal(170)
    expect(viewport_response.getFollowingByteCount()).to.equal(8)
    expect(viewport_response.getData_asU8()).to.deep.equal(
      Buffer.from('CDEFGHIJKLMNOPQRSTUV')
    )

    // Test the last in-range viewport
    expect(await getComputedFileSize(session_id)).to.equal(198)
    viewport_response = await modifyViewport(viewport_id, 190, 20)
    expect(viewport_response.getLength()).to.equal(8)
    expect(viewport_response.getOffset()).to.equal(190)
    expect(viewport_response.getFollowingByteCount()).to.equal(0)
    expect(viewport_response.getData_asU8()).to.deep.equal(
      Buffer.from('WXYZ/*-+')
    )

    // Test viewport with offset > computed file size
    viewport_response = await modifyViewport(viewport_id, 200, 20)
    expect(viewport_response.getLength()).to.equal(0)
    expect(viewport_response.getOffset()).to.equal(200)
    expect(viewport_response.getFollowingByteCount()).to.equal(-2)
    expect(viewport_response.getData_asU8()).to.deep.equal(Buffer.from(''))

    viewport_response = await modifyViewport(viewport_id, 10, 20)
    expect(viewport_response.getLength()).to.equal(20)
    expect(viewport_response.getOffset()).to.equal(10)
    expect(viewport_response.getFollowingByteCount()).to.equal(168)
    expect(viewport_response.getData_asU8()).to.deep.equal(
      Buffer.from('abcdefghijklmnopqrst')
    )

    expect(await viewportHasChanges(viewport_id)).to.be.false

    // delete all but the last 8 bytes
    await del(session_id, 0, 190)

    expect(await viewportHasChanges(viewport_id)).to.be.true

    // Test a viewport that has fallen off the edge of the file
    let dataResponse = await getViewportData(viewport_id)
    expect(dataResponse.getLength()).to.equal(0)
    expect(dataResponse.getOffset()).to.equal(10)
    expect(dataResponse.getFollowingByteCount()).to.equal(-2)
    expect(dataResponse.getData_asU8()).to.deep.equal(Buffer.from(''))

    // Scroll back to the top of the file
    viewport_response = await modifyViewport(viewport_id, 0, 20)
    expect(viewport_response.getLength()).to.equal(8)
    expect(viewport_response.getOffset()).to.equal(0)
    expect(viewport_response.getFollowingByteCount()).to.equal(0)
    expect(viewport_response.getData_asU8()).to.deep.equal(
      Buffer.from('WXYZ/*-+')
    )

    await insert(session_id, 5, Buffer.from(pattern))
    expect(await viewportHasChanges(viewport_id)).to.be.true
    dataResponse = await getViewportData(viewport_id)
    expect(dataResponse.getLength()).to.equal(20)
    expect(dataResponse.getOffset()).to.equal(0)
    expect(dataResponse.getFollowingByteCount()).to.equal(54)
    expect(dataResponse.getData_asU8()).to.deep.equal(
      Buffer.from('WXYZ/0123456789abcde')
    )
  }).timeout(8000)
})
