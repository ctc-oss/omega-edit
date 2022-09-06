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
import { getComputedFileSize, getSegment } from '../../src/session'
import { del, getLastChange, insert, overwrite } from '../../src/change'
import { ChangeKind } from '../../src/omega_edit_pb'
import { decode, encode } from 'fastestsmallesttextencoderdecoder'
import { cleanup, custom_setup } from './common'

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
      change_id = await insert(session_id, 3, encode('def'))
      expect(change_id).to.be.a('number').that.equals(2)
      let file_size = await getComputedFileSize(session_id)
      expect(data.length + 3).equals(file_size)
      let segment = await getSegment(session_id, 0, file_size)
      expect(encode('abcdefghijklmnopqrstuvwxyz')).deep.equals(segment)
    })
  })

  describe('Delete', () => {
    it('Should delete some data', async () => {
      expect(0).to.equal(await getComputedFileSize(session_id))
      const data = encode('abcdefghijklmnopqrstuvwxyz')
      let change_id = await insert(session_id, 0, data)
      expect(change_id).to.be.a('number').that.equals(1)
      let segment = await getSegment(session_id, 0, data.length)
      expect(data).deep.equals(segment)
      let file_size = await getComputedFileSize(session_id)
      expect(data.length).equals(file_size)
      let del_change_id = await del(session_id, 13, 10)
      expect(del_change_id)
        .to.be.a('number')
        .that.equals(change_id + 1)
      file_size = await getComputedFileSize(session_id)
      expect(data.length - 10).equals(file_size)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmxyz'))
    })
  })

  describe('Overwrite', () => {
    it('Should overwrite some data', async () => {
      expect(0).to.equal(await getComputedFileSize(session_id))
      const data = encode('abcdefghijklmnopqrstuvwxyz')
      let change_id = await insert(session_id, 0, data)
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
      expect(26).to.equal(last_change.getLength())
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
      overwrite_change_id = await overwrite(session_id, 15, 'PQRSTU') // overwriting: 123456 (len: 6), using a string
      expect(overwrite_change_id).to.be.a('number').that.equals(3)
      file_size = await getComputedFileSize(session_id)
      expect(data.length).equals(file_size)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('abcdefghijklmNOPQRSTUVWxyz'))
    })
  })
})
