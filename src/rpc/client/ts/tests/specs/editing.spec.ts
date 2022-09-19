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
import {
  ChangeKind,
  EventSubscriptionRequest,
  SessionEventKind,
} from '../../src/omega_edit_pb'
import { decode, encode } from 'fastestsmallesttextencoderdecoder'
// @ts-ignore
import { cleanup, custom_setup } from './common'
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
      console.log(
        'session: ' +
          session_id +
          ', event: ' +
          sessionEvent.getSessionEventKind() +
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
      expect(await getComputedFileSize(session_id)).to.equal(0)
      const data = encode('abcghijklmnopqrstuvwxyz')
      // Subscribe to all events but edit events
      const subscribed_session_id = await subscribeSession(
        session_id,
        ALL_EVENTS & ~SessionEventKind.SESSION_EVT_EDIT
      )
      expect(subscribed_session_id).to.equal(session_id)
      let change_id = await insert(session_id, 0, data)
      expect(change_id).to.be.a('number').that.equals(1)
      expect(session_callbacks.has(session_id)).to.be.false
      // Subscribe to all events
      await subscribeSession(session_id)
      change_id = await insert(session_id, 3, encode('def'))
      expect(change_id).to.be.a('number').that.equals(2)
      const file_size = await getComputedFileSize(session_id)
      expect(file_size).to.equal(data.length + 3)
      const segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmnopqrstuvwxyz'))
      console.log(session_callbacks)
      expect(session_callbacks.get(session_id)).to.equal(1) // session subscribed for 1 event
    })
  })

  describe('Delete', () => {
    it('Should delete some data', async () => {
      expect(0).to.equal(await getComputedFileSize(session_id))
      const data = encode('abcdefghijklmnopqrstuvwxyz')
      await subscribeSession(session_id)
      expect(session_callbacks.has(session_id)).to.be.false
      let change_id = await insert(session_id, 0, data)
      expect(change_id).to.be.a('number').that.equals(1)
      let segment = await getSegment(session_id, 0, data.length)
      expect(segment).deep.equals(data)
      let file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length)
      expect(session_callbacks.get(session_id)).to.equal(1)
      await unsubscribeSession(session_id)
      const del_change_id = await del(session_id, 13, 10)
      expect(del_change_id)
        .to.be.a('number')
        .that.equals(change_id + 1)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length - 10)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmxyz'))
      expect(session_callbacks.get(session_id)).to.equal(1) // unsubscribed before the second event
    })
  })

  describe('Overwrite', () => {
    it('Should overwrite some data', async () => {
      expect(await getComputedFileSize(session_id)).to.equal(0)
      const data = encode('abcdefghijklmnopqrstuvwxyΩ') // Note: Ω is a 2-byte character
      let change_id = await insert(session_id, 0, data)
      await subscribeSession(session_id)
      expect(session_callbacks.has(session_id)).to.be.false
      expect(change_id).to.be.a('number').that.equals(1)
      let segment = await getSegment(session_id, 0, data.length)
      expect(segment).deep.equals(data)
      let file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length)
      let last_change = await getLastChange(session_id)
      expect(last_change.getData_asU8()).deep.equals(data)
      expect(last_change.getOffset()).to.equal(0)
      expect(last_change.getKind()).to.equal(ChangeKind.CHANGE_INSERT)
      expect(last_change.getSerial()).to.equal(1)
      expect(last_change.getLength()).to.equal(27)
      expect(last_change.getSessionId()).to.equal(session_id)
      let overwrite_change_id = await overwrite(
        session_id,
        13,
        encode('NO123456VW')
      ) // overwriting: nopqrstuvw (len: 10)
      expect(overwrite_change_id).to.be.a('number').that.equals(2)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).to.equal(data.length)
      last_change = await getLastChange(session_id)
      expect(decode(last_change.getData_asU8())).deep.equals('NO123456VW')
      expect(last_change.getOffset()).to.equal(13)
      expect(last_change.getKind()).to.equal(ChangeKind.CHANGE_OVERWRITE)
      expect(last_change.getSerial()).to.equal(2)
      expect(last_change.getLength()).to.equal(10)
      expect(last_change.getSessionId()).to.equal(session_id)
      expect(session_callbacks.get(session_id)).to.equal(1)
      overwrite_change_id = await overwrite(session_id, 15, 'PQRSTU') // overwriting: 123456 (len: 6), using a string
      expect(overwrite_change_id).to.be.a('number').that.equals(3)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmNOPQRSTUVWxyΩ'))
      expect(session_callbacks.get(session_id)).to.equal(2)
      await unsubscribeSession(session_id)
      // To overwrite a 2-byte character with a single-byte character, we need to delete the 2-byte character and insert the single-byte character
      change_id = await del(session_id, 25, 2)
      expect(change_id).to.be.a('number').that.equals(4)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length - 2)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmNOPQRSTUVWxy'))
      expect(session_callbacks.get(session_id)).to.equal(2)
      await subscribeSession(session_id)
      change_id = await insert(session_id, 25, 'z')
      expect(change_id).to.equal(5)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length - 1)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmNOPQRSTUVWxyz'))
      expect(session_callbacks.get(session_id)).to.equal(3)
    })
  })
})
