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
  getComputedFileSize,
  getSegment,
  unsubscribeSession,
} from '../../src/session'
import { del, getLastChange, insert, overwrite } from '../../src/change'
import { ChangeKind, EventSubscriptionRequest } from '../../src/omega_edit_pb'
import { decode, encode } from 'fastestsmallesttextencoderdecoder'
import { cleanup, custom_setup } from './common'
import { getClient } from '../../src/settings'

let session_callbacks = new Map()

async function subscribeSession(session_id: string): Promise<string> {
  await getClient()
    .subscribeToSessionEvents(new EventSubscriptionRequest().setId(session_id))
    .on('data', (sessionEvent) => {
      session_callbacks.set(
        session_id,
        session_callbacks.has(session_id)
          ? 1 + session_callbacks.get(session_id)
          : 1
      )
      const event = sessionEvent.getSessionEventKind()
      console.log(
        'session: ' +
          session_id +
          ', event: ' +
          event +
          ', count: ' +
          session_callbacks.get(session_id)
      )
    })
  return session_id
}

describe('Editing', () => {
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await custom_setup()
  })

  afterEach('Destroy session', async () => {
    await cleanup(session_id)
  })

  describe('Insert', () => {
    it('Should insert a string', async () => {
      expect(0).to.equal(await getComputedFileSize(session_id))
      const data = encode('abcghijklmnopqrstuvwxyz')
      let change_id = await insert(session_id, 0, data)
      expect(change_id).to.be.a('number').that.equals(1)
      const subscribed_session_id = await subscribeSession(session_id)
      expect(session_id).to.equal(subscribed_session_id)
      change_id = await insert(session_id, 3, encode('def'))
      expect(change_id).to.be.a('number').that.equals(2)
      const file_size = await getComputedFileSize(session_id)
      expect(data.length + 3).equals(file_size)
      const segment = await getSegment(session_id, 0, file_size)
      expect(encode('abcdefghijklmnopqrstuvwxyz')).deep.equals(segment)
      console.log(session_callbacks)
      expect(1).to.equal(session_callbacks.get(session_id)) // session subscribed for 1 event
    })
  })

  describe('Delete', () => {
    it('Should delete some data', async () => {
      expect(0).to.equal(await getComputedFileSize(session_id))
      const data = encode('abcdefghijklmnopqrstuvwxyz')
      await subscribeSession(session_id)
      expect(false).to.equal(session_callbacks.has(session_id))
      let change_id = await insert(session_id, 0, data)
      expect(change_id).to.be.a('number').that.equals(1)
      let segment = await getSegment(session_id, 0, data.length)
      expect(data).deep.equals(segment)
      let file_size = await getComputedFileSize(session_id)
      expect(data.length).equals(file_size)
      expect(1).to.equal(session_callbacks.get(session_id))
      await unsubscribeSession(session_id)
      const del_change_id = await del(session_id, 13, 10)
      expect(del_change_id)
        .to.be.a('number')
        .that.equals(change_id + 1)
      file_size = await getComputedFileSize(session_id)
      expect(data.length - 10).equals(file_size)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmxyz'))
      expect(1).to.equal(session_callbacks.get(session_id)) // unsubscribed before the second event
    })
  })

  describe('Overwrite', () => {
    it('Should overwrite some data', async () => {
      expect(0).to.equal(await getComputedFileSize(session_id))
      const data = encode('abcdefghijklmnopqrstuvwxyΩ') // Note: Ω is a 2-byte character
      let change_id = await insert(session_id, 0, data)
      await subscribeSession(session_id)
      expect(false).to.equal(session_callbacks.has(session_id))
      expect(change_id).to.be.a('number').that.equals(1)
      let segment = await getSegment(session_id, 0, data.length)
      expect(data).deep.equals(segment)
      let file_size = await getComputedFileSize(session_id)
      expect(data.length).equals(file_size)
      let last_change = await getLastChange(session_id)
      expect(data).deep.equals(last_change.getData_asU8())
      expect(0).to.equal(last_change.getOffset())
      expect(ChangeKind.CHANGE_INSERT).to.equal(last_change.getKind())
      expect(1).to.equal(last_change.getSerial())
      expect(27).to.equal(last_change.getLength())
      expect(session_id).to.equal(last_change.getSessionId())
      let overwrite_change_id = await overwrite(
        session_id,
        13,
        encode('NO123456VW')
      ) // overwriting: nopqrstuvw (len: 10)
      expect(overwrite_change_id).to.be.a('number').that.equals(2)
      file_size = await getComputedFileSize(session_id)
      expect(data.length).equals(file_size)
      last_change = await getLastChange(session_id)
      expect('NO123456VW').deep.equals(decode(last_change.getData_asU8()))
      expect(13).to.equal(last_change.getOffset())
      expect(ChangeKind.CHANGE_OVERWRITE).to.equal(last_change.getKind())
      expect(2).to.equal(last_change.getSerial())
      expect(10).to.equal(last_change.getLength())
      expect(session_id).to.equal(last_change.getSessionId())
      expect(1).to.equal(session_callbacks.get(session_id))
      overwrite_change_id = await overwrite(session_id, 15, 'PQRSTU') // overwriting: 123456 (len: 6), using a string
      expect(overwrite_change_id).to.be.a('number').that.equals(3)
      file_size = await getComputedFileSize(session_id)
      expect(data.length).equals(file_size)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmNOPQRSTUVWxyΩ'))
      expect(2).to.equal(session_callbacks.get(session_id))
      await unsubscribeSession(session_id)
      // To overwrite a 2-byte character with a single-byte character, we need to delete the 2-byte character and insert the single-byte character
      change_id = await del(session_id, 25, 2)
      expect(4).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(data.length - 2).equals(file_size)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmNOPQRSTUVWxy'))
      expect(2).to.equal(session_callbacks.get(session_id))
      await subscribeSession(session_id)
      change_id = await insert(session_id, 25, 'z')
      expect(5).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(data.length - 1).equals(file_size)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmNOPQRSTUVWxyz'))
      expect(3).to.equal(session_callbacks.get(session_id))
    })
  })
})
