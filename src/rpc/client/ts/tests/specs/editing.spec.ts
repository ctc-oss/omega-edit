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
import {
  del,
  editOperations,
  EditStats,
  getLastChange,
  insert,
  overwrite,
} from '../../src/change'
import {
  ChangeKind,
  EventSubscriptionRequest,
  SessionEventKind,
} from '../../src/omega_edit_pb'
import { decode, encode } from 'fastestsmallesttextencoderdecoder'
// @ts-ignore
import { check_callback_count, cleanup, custom_setup, log_info } from './common'
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
        log_info(
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
        log_info(
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
      const stats = new EditStats()
      expect(stats.delete_count).to.equal(0)
      expect(stats.insert_count).to.equal(0)
      expect(stats.overwrite_count).to.equal(0)
      expect(stats.error_count).to.equal(0)

      let change_id = await insert(session_id, 0, data, stats)
      expect(change_id).to.be.a('number').that.equals(1)
      expect(stats.delete_count).to.equal(0)
      expect(stats.insert_count).to.equal(1)
      expect(stats.overwrite_count).to.equal(0)
      expect(stats.error_count).to.equal(0)
      await check_callback_count(session_callbacks, session_id, 0)
      // Subscribe to all events
      await subscribeSession(session_id)
      change_id = await insert(session_id, 3, encode('def'), stats)
      expect(change_id).to.be.a('number').that.equals(2)
      expect(stats.insert_count).to.equal(2)
      const file_size = await getComputedFileSize(session_id)
      expect(file_size).to.equal(data.length + 3)
      const segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmnopqrstuvwxyz'))
      await check_callback_count(session_callbacks, session_id, 1)
      expect(stats.error_count).to.equal(0)
    })
  })

  describe('Delete', () => {
    it('Should delete some data', async () => {
      expect(0).to.equal(await getComputedFileSize(session_id))
      const data = encode('abcdefghijklmnopqrstuvwxyz')
      await subscribeSession(session_id)
      await check_callback_count(session_callbacks, session_id, 0)
      const stats = new EditStats()
      let change_id = await insert(session_id, 0, data, stats)
      expect(change_id).to.be.a('number').that.equals(1)
      expect(stats.insert_count).to.equal(1)
      let segment = await getSegment(session_id, 0, data.length)
      expect(segment).deep.equals(data)
      let file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length)
      await check_callback_count(session_callbacks, session_id, 1)
      await unsubscribeSession(session_id)
      const del_change_id = await del(session_id, 13, 10, stats)
      expect(stats.delete_count).to.equal(1)
      expect(del_change_id)
        .to.be.a('number')
        .that.equals(change_id + 1)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length - 10)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmxyz'))
      await check_callback_count(session_callbacks, session_id, 1) // unsubscribed before the second event
      expect(stats.error_count).to.equal(0)
    })
  })

  describe('Overwrite', () => {
    it('Should overwrite some data', async () => {
      expect(await getComputedFileSize(session_id)).to.equal(0)
      const data = encode('abcdefghijklmnopqrstuvwxyΩ') // Note: Ω is a 2-byte character
      const stats = new EditStats()
      let change_id = await insert(session_id, 0, data, stats)
      expect(stats.insert_count).to.equal(1)
      await subscribeSession(session_id)
      await check_callback_count(session_callbacks, session_id, 0)
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
        encode('NO123456VW'),
        stats
      ) // overwriting: nopqrstuvw (len: 10)
      expect(overwrite_change_id).to.be.a('number').that.equals(2)
      expect(stats.overwrite_count).to.equal(1)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).to.equal(data.length)
      last_change = await getLastChange(session_id)
      expect(decode(last_change.getData_asU8())).deep.equals('NO123456VW')
      expect(last_change.getOffset()).to.equal(13)
      expect(last_change.getKind()).to.equal(ChangeKind.CHANGE_OVERWRITE)
      expect(last_change.getSerial()).to.equal(2)
      expect(last_change.getLength()).to.equal(10)
      expect(last_change.getSessionId()).to.equal(session_id)
      await check_callback_count(session_callbacks, session_id, 1)
      overwrite_change_id = await overwrite(session_id, 15, 'PQRSTU', stats) // overwriting: 123456 (len: 6), using a string
      expect(overwrite_change_id).to.be.a('number').that.equals(3)
      expect(stats.overwrite_count).to.equal(2)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmNOPQRSTUVWxyΩ'))
      await check_callback_count(session_callbacks, session_id, 2)
      await unsubscribeSession(session_id)
      // To overwrite a 2-byte character with a single-byte character, we need to delete the 2-byte character and insert the single-byte character
      change_id = await del(session_id, 25, 2, stats)
      expect(change_id).to.be.a('number').that.equals(4)
      expect(stats.delete_count).to.equal(1)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length - 2)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmNOPQRSTUVWxy'))
      await check_callback_count(session_callbacks, session_id, 2)
      await subscribeSession(session_id)
      change_id = await insert(session_id, 25, 'z', stats)
      expect(change_id).to.equal(5)
      expect(stats.insert_count).to.equal(2)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length - 1)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmNOPQRSTUVWxyz'))
      await check_callback_count(session_callbacks, session_id, 3)
      expect(stats.error_count).to.equal(0)
    })
  })
})

describe('editOperations function', function () {
  it('should return an empty array for identical arrays', function () {
    const arr = new Uint8Array([1, 2, 3, 4, 5])
    const ops = editOperations(arr, arr)
    expect(ops).to.deep.equal([])
  })

  it('should return a delete operation for a shorter array', function () {
    const arr1 = new Uint8Array([1, 2, 3, 4, 5])
    const arr2 = new Uint8Array([1, 2, 3])
    const ops = editOperations(arr1, arr2)
    expect(ops).to.deep.equal([{ type: 'delete', start: 3, length: 2 }])
  })

  it('should return an insert operation for a longer array', function () {
    const arr1 = new Uint8Array([1, 2, 3])
    const arr2 = new Uint8Array([1, 2, 3, 4, 5])
    const ops = editOperations(arr1, arr2)
    expect(ops).to.deep.equal([
      { type: 'insert', start: 3, data: new Uint8Array([4, 5]) },
    ])
  })

  it('should return an overwrite operation for a partially different array', function () {
    const arr1 = new Uint8Array([1, 2, 3, 4, 5])
    const arr2 = new Uint8Array([1, 2, 6, 7, 5])
    const ops = editOperations(arr1, arr2)
    expect(ops).to.deep.equal([
      { type: 'overwrite', start: 2, data: new Uint8Array([6, 7]) },
    ])
  })

  it('should return a single overwrite operation for a fully different array', function () {
    const arr1 = new Uint8Array([1, 2, 3, 4, 5])
    const arr2 = new Uint8Array([6, 7, 8, 9, 10])
    const ops = editOperations(arr1, arr2)
    expect(ops).to.deep.equal([
      { type: 'overwrite', start: 0, data: new Uint8Array([6, 7, 8, 9, 10]) },
    ])
  })

  it('should coalesce adjacent operations of the same type', function () {
    const arr1 = new Uint8Array([1, 2, 3, 4, 5])
    const arr2 = new Uint8Array([1, 2, 6, 7, 8, 9, 5])
    const ops = editOperations(arr1, arr2)
    expect(ops).to.deep.equal([
      { type: 'delete', start: 2, length: 2 },
      { type: 'insert', start: 2, data: new Uint8Array([6, 7, 8, 9]) },
    ])
  })
})
