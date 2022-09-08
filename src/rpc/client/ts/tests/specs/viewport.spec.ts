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
import { getClient } from '../../src/settings'
import { del, insert, overwrite } from '../../src/change'
import { getComputedFileSize, getSegment } from '../../src/session'
import {
  createViewport,
  destroyViewport,
  getViewportCount,
  getViewportData,
} from '../../src/viewport'
import { decode, encode } from 'fastestsmallesttextencoderdecoder'
import { ObjectId } from '../../src/omega_edit_pb'
import { cleanup, custom_setup } from './common'

let vpt_callbacks = new Map()

function subscribeViewport(viewport_id: string) {
  getClient()
    .subscribeToViewportEvents(new ObjectId().setId(viewport_id))
    .on('data', (viewportEvent) => {
      vpt_callbacks.set(
        viewport_id,
        vpt_callbacks.has(viewport_id) ? 1 + vpt_callbacks.get(viewport_id) : 1
      )
      let event = viewportEvent.getViewportEventKind()
      // let viewport_id = viewportEvent.getViewportId()
      // console.log('viewport: ' + viewport_id + ', event: ' + event)
      if (2 == event) {
        console.log(
          'viewport_id: ' +
            viewport_id +
            ', serial: ' +
            viewportEvent.getSerial() +
            ', offset: ' +
            viewportEvent.getOffset() +
            ', length: ' +
            viewportEvent.getLength() +
            ', data: ' +
            decode(viewportEvent.getData()) +
            ', callbacks: ' + vpt_callbacks.get(viewport_id)
        )
      }
    })
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
    const viewport_id_1 = await createViewport(
      'test_vpt_1',
      session_id,
      0,
      10,
      false
    )
    if (viewport_id_1.includes(':')) {
      /* The Scala RPC server always prepends the session ID and colon to viewport IDs */
      expect(session_id + ':test_vpt_1').to.equal(viewport_id_1)
    } else {
      /* The C++ RPC server uses the desired viewport ID as given */
      expect('test_vpt_1').to.equal(viewport_id_1)
    }
    expect(1).to.equal(await getViewportCount(session_id))

    const viewport_id_2 = await createViewport(
      undefined,
      session_id,
      10,
      10,
      false
    )

    expect(viewport_id_2).to.be.a('string').with.length(73) // viewport_id is the session ID, colon, then a random UUID
    subscribeViewport(viewport_id_2)
    expect(2).to.equal(await getViewportCount(session_id))
    expect(false).to.equal(vpt_callbacks.has(viewport_id_2))

    let change_id = await insert(session_id, 0, '0123456789ABC')
    expect(1).to.equal(change_id)

    let file_size = await getComputedFileSize(session_id)
    expect(13).to.equal(file_size)

    let viewport_data = await getViewportData(viewport_id_1)
    expect('0123456789').to.equal(decode(viewport_data.getData_asU8()))

    viewport_data = await getViewportData(viewport_id_2)
    expect('ABC').to.equal(decode(viewport_data.getData_asU8()))

    expect(1).to.equal(vpt_callbacks.get(viewport_id_2))
    change_id = await del(session_id, 0, 1)
    expect(2).to.equal(change_id)

    file_size = await getComputedFileSize(session_id)
    expect(12).to.equal(file_size)

    viewport_data = await getViewportData(viewport_id_1)
    expect('123456789A').to.equal(decode(viewport_data.getData_asU8()))

    viewport_data = await getViewportData(viewport_id_2)
    expect('BC').to.equal(decode(viewport_data.getData_asU8()))

    expect(2).to.equal(vpt_callbacks.get(viewport_id_2))
    change_id = await overwrite(session_id, 8, '!@#')
    expect(3).to.equal(change_id)

    file_size = await getComputedFileSize(session_id)
    expect(12).to.equal(file_size)

    const segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('12345678!@#C'))

    viewport_data = await getViewportData(viewport_id_1)
    expect('12345678!@').to.equal(decode(viewport_data.getData_asU8()))

    viewport_data = await getViewportData(viewport_id_2)
    expect('#C').to.equal(decode(viewport_data.getData_asU8()))

    const deleted_viewport_id = await destroyViewport(viewport_id_2)
    expect(viewport_id_2).to.equal(deleted_viewport_id)
    expect(3).to.equal(vpt_callbacks.get(viewport_id_2))
    // expect(1).to.equal(await getViewportCount(session_id))
  })

  it('Should handle floating viewports', async () => {
    let change_id = await insert(session_id, 0, '0123456789LABEL01234567890')
    expect(1).to.equal(change_id)

    const viewport_id = await createViewport(
      'test_vpt_no_float',
      session_id,
      10,
      5,
      false
    )
    const viewport_floating_id = await createViewport(
      'test_vpt_label',
      session_id,
      10,
      5,
      true
    )
    let viewport_data = await getViewportData(viewport_floating_id)

    expect('LABEL').to.equal(decode(viewport_data.getData_asU8()))
    expect(10).to.equal(viewport_data.getOffset())

    viewport_data = await getViewportData(viewport_id)
    expect('LABEL').to.equal(decode(viewport_data.getData_asU8()))
    expect(10).to.equal(viewport_data.getOffset())

    change_id = await del(session_id, 0, 5)
    expect(2).to.equal(change_id)

    viewport_data = await getViewportData(viewport_floating_id)
    expect('LABEL').to.equal(decode(viewport_data.getData_asU8()))
    expect(5).to.equal(viewport_data.getOffset())

    viewport_data = await getViewportData(viewport_id)
    expect(10).to.equal(viewport_data.getOffset())
    expect('01234').to.equal(decode(viewport_data.getData_asU8()))

    let file_size = await getComputedFileSize(session_id)
    let segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('56789LABEL01234567890'))

    change_id = await insert(session_id, 0, '01234')
    expect(3).to.equal(change_id)

    viewport_data = await getViewportData(viewport_floating_id)
    expect('LABEL').to.equal(decode(viewport_data.getData_asU8()))
    expect(10).to.equal(viewport_data.getOffset())

    viewport_data = await getViewportData(viewport_id)
    expect('LABEL').to.equal(decode(viewport_data.getData_asU8()))
    expect(10).to.equal(viewport_data.getOffset())

    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('0123456789LABEL01234567890'))
  })
})
