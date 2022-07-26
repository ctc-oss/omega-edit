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

import { assert, expect } from 'chai'
import { getVersion } from '../../src/version'
import {
  createSession,
  destroySession,
  getComputedFileSize,
  getSegment,
  getSessionCount,
  pauseSessionChanges,
  resumeSessionChanges,
  saveSession,
  searchSession,
} from '../../src/session'
import {
  clear,
  del,
  getChangeCount,
  getLastChange,
  getLastUndo,
  getUndoCount,
  insert,
  overwrite,
  redo,
  undo,
} from '../../src/change'
import {
  createViewport,
  destroyViewport,
  getViewportCount,
  getViewportData,
} from '../../src/viewport'
import { unlinkSync } from 'node:fs'
import { ChangeKind } from '../../src/omega_edit_pb'
import { decode, encode } from 'fastestsmallesttextencoderdecoder'

describe('Version', () => {
  const expected_version = 'v0.9.11'
  it('Should return version ' + expected_version, async () => {
    const result = await getVersion()
    expect(result).to.equal(expected_version)
  })
})

describe('Encode/Decode', () => {
  it('Should encode string into Uint8Array', () => {
    expect(new Uint8Array([97, 98, 99, 49, 50, 51])).deep.equals(
      encode('abc123')
    )
    expect(new Uint8Array([97, 98, 99, 49, 50, 51])).deep.equals(
      Buffer.from('abc123')
    )
  })
  it('Should decode Uint8Array into string', () => {
    expect('abc123').to.equal(decode(new Uint8Array([97, 98, 99, 49, 50, 51])))
  })
})

describe('Editing', () => {
  let session_id = ''

  beforeEach('create a new session', async () => {
    expect(0).to.equal(await getSessionCount())
    let new_session_id = await createSession(undefined, undefined)
    expect(new_session_id).to.be.a('string').with.length(36)
    expect(new_session_id).to.not.equal(session_id)
    expect(1).to.equal(await getSessionCount())
    session_id = new_session_id
    //console.log("created session: "+session_id)
  })

  afterEach('destroy session', async () => {
    expect(1).to.equal(await getSessionCount())
    const destroyed_session_id = await destroySession(session_id)
    expect(destroyed_session_id).to.equal(session_id)
    expect(0).to.equal(await getSessionCount())
    //console.log("destroyed session: "+session_id)
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

  describe('Undo/Redo', () => {
    it('Should undo and redo changes', async () => {
      expect('0123456789').equals(decode(encode('0123456789')))
      expect(0).to.equal(await getChangeCount(session_id))

      let change_id = await insert(session_id, 0, encode('9'))
      expect(1).to.equal(change_id)
      expect(1).to.equal(await getChangeCount(session_id))
      let file_size = await getComputedFileSize(session_id)
      expect(1).to.equal(file_size)

      change_id = await insert(session_id, 0, encode('78'))
      expect(2).to.equal(change_id)
      expect(2).to.equal(await getChangeCount(session_id))
      file_size = await getComputedFileSize(session_id)
      expect(3).to.equal(file_size)

      change_id = await insert(session_id, 0, '456') // test sending in a string
      expect(3).to.equal(change_id)
      expect(3).to.equal(await getChangeCount(session_id))
      file_size = await getComputedFileSize(session_id)
      expect(6).to.equal(file_size)

      change_id = await insert(session_id, 0, '0123')
      expect(4).to.equal(change_id)
      expect(4).to.equal(await getChangeCount(session_id))
      file_size = await getComputedFileSize(session_id)
      expect(10).to.equal(file_size)

      file_size = await getComputedFileSize(session_id)
      expect(10).to.equal(file_size)
      let segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('0123456789'))
      expect(decode(segment)).equals('0123456789')
      expect(0).to.equal(await getUndoCount(session_id))

      change_id = await undo(session_id)
      expect(-4).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(6).to.equal(file_size)
      expect(encode('456789')).deep.equals(
        await getSegment(session_id, 0, file_size)
      )
      expect(3).to.equal(await getChangeCount(session_id))
      expect(1).to.equal(await getUndoCount(session_id))

      change_id = await undo(session_id)
      expect(-3).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(3).to.equal(file_size)
      expect(encode('789')).deep.equals(
        await getSegment(session_id, 0, file_size)
      )
      expect(2).to.equal(await getChangeCount(session_id))
      expect(2).to.equal(await getUndoCount(session_id))

      let last_undo = await getLastUndo(session_id)
      expect('456').to.equal(decode(last_undo.getData_asU8()))
      expect(0).to.equal(last_undo.getOffset())
      expect(ChangeKind.CHANGE_INSERT).to.equal(last_undo.getKind())
      expect(-3).to.equal(last_undo.getSerial())
      expect(3).to.equal(last_undo.getLength())
      expect(session_id).to.equal(last_undo.getSessionId())

      change_id = await undo(session_id)
      expect(-2).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(1).to.equal(file_size)
      expect(encode('9')).deep.equals(
        await getSegment(session_id, 0, file_size)
      )
      expect(1).to.equal(await getChangeCount(session_id))
      expect(3).to.equal(await getUndoCount(session_id))

      change_id = await undo(session_id)
      expect(-1).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(0).to.equal(file_size)
      expect(await getSegment(session_id, 0, file_size)).to.be.empty
      expect(0).to.equal(await getChangeCount(session_id))
      expect(4).to.equal(await getUndoCount(session_id))

      // Try undo when there is nothing left to undo (expect change_id to be zero)
      change_id = await undo(session_id)
      expect(0).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(0).to.equal(file_size)
      expect(await getSegment(session_id, 0, file_size)).to.be.empty
      expect(0).to.equal(await getChangeCount(session_id))
      expect(4).to.equal(await getUndoCount(session_id))

      change_id = await redo(session_id)
      expect(1).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(1).to.equal(file_size)
      expect(encode('9')).deep.equals(
        await getSegment(session_id, 0, file_size)
      )
      expect(1).to.equal(await getChangeCount(session_id))
      expect(3).to.equal(await getUndoCount(session_id))

      change_id = await redo(session_id)
      expect(2).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(3).to.equal(file_size)
      expect(encode('789')).deep.equals(
        await getSegment(session_id, 0, file_size)
      )
      expect(2).to.equal(await getChangeCount(session_id))
      expect(2).to.equal(await getUndoCount(session_id))

      change_id = await insert(session_id, 0, encode('0123456'))
      expect(3).to.equal(change_id)
      expect(3).to.equal(await getChangeCount(session_id))
      expect(0).to.equal(await getUndoCount(session_id))
      file_size = await getComputedFileSize(session_id)
      expect(10).to.equal(file_size)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('0123456789'))

      // Try redo when there is noting left to redo (expect change_id to be zero)
      change_id = await redo(session_id)
      expect(0).to.equal(change_id)
      expect(3).to.equal(await getChangeCount(session_id))
      expect(0).to.equal(await getUndoCount(session_id))

      // Test file saving and reading into a new session
      let save_file_name = await saveSession(
        session_id,
        'save_session_test',
        true
      )
      assert(save_file_name.endsWith('save_session_test'))
      expect(1).to.equal(await getSessionCount())
      let session_id_2 = await createSession(
        save_file_name,
        'verify_save_session'
      )
      expect(2).to.equal(await getSessionCount())
      expect('verify_save_session').to.equal(session_id_2)
      file_size = await getComputedFileSize(session_id_2)
      expect(10).to.equal(file_size)
      segment = await getSegment(session_id_2, 0, file_size)
      expect(segment).deep.equals(encode('0123456789'))
      let destroyed_session = await destroySession(session_id_2)
      expect(destroyed_session).to.equal(session_id_2)
      expect(1).to.equal(await getSessionCount())

      // remove test file
      unlinkSync(save_file_name)

      // test clearing changes from a session
      expect(3).to.equal(await getChangeCount(session_id))
      let cleared_session_id = await clear(session_id)
      expect(session_id).to.equal(cleared_session_id)
      expect(0).to.equal(await getChangeCount(session_id))
    })
  })

  describe('Search', () => {
    it('Should search sessions', async () => {
      let change_id = await overwrite(
        session_id,
        0,
        encode('haystackneedleNEEDLENeEdLeneedhay')
      )
      expect(1).to.equal(change_id)
      let file_size = await getComputedFileSize(session_id)
      let needles = await searchSession(
        session_id,
        'needle',
        false,
        0,
        0,
        undefined
      )
      expect([8]).deep.equals(needles)
      needles = await searchSession(
        session_id,
        encode('needle'),
        true,
        3,
        file_size - 3,
        undefined
      )
      expect([8, 14, 20]).deep.equals(needles)
      needles = await searchSession(
        session_id,
        encode('needle'),
        true,
        3,
        file_size - 3,
        0
      )
      expect([8, 14, 20]).deep.equals(needles)
      needles = await searchSession(
        session_id,
        encode('needle'),
        true,
        3,
        file_size - 3,
        2
      )
      expect([8, 14]).deep.equals(needles)
      needles = await searchSession(session_id, 'NEEDLE', false, 0, 0, 1)
      expect([14]).deep.equals(needles)
      needles = await searchSession(
        session_id,
        'NEEDLE',
        false,
        0,
        20,
        undefined
      )
      expect([14]).deep.equals(needles)
      needles = await searchSession(
        session_id,
        'NEEDLE',
        false,
        14,
        6,
        undefined
      )
      expect([14]).deep.equals(needles)
      needles = await searchSession(
        session_id,
        'NEEDLE',
        false,
        14,
        5,
        undefined
      )
      expect([]).deep.equals(needles)
      needles = await searchSession(
        session_id,
        'NEEDLE',
        false,
        0,
        19,
        undefined
      )
      expect([]).deep.equals(needles)

      // try searching an empty session
      await clear(session_id)
      expect(0).to.equal(await getChangeCount(session_id))
      needles = await searchSession(session_id, 'needle', true, 0, 0, undefined)
      expect([]).deep.equals(needles)
    })
  })

  describe('Viewports', () => {
    it('Should create and destroy viewports', async () => {
      let viewport_id = await createViewport(
        'test_vpt_1',
        session_id,
        0,
        10,
        false
      )
      expect('test_vpt_1').to.equal(viewport_id)
      expect(1).to.equal(await getViewportCount(session_id))
      viewport_id = await createViewport(undefined, session_id, 10, 10, false)
      expect(viewport_id).to.be.a('string').with.length(36) // viewport_id is a random UUID
      expect(2).to.equal(await getViewportCount(session_id))
      let change_id = await insert(session_id, 0, '0123456789ABC')
      expect(1).to.equal(change_id)
      let file_size = await getComputedFileSize(session_id)
      expect(13).to.equal(file_size)
      let viewport_data = await getViewportData('test_vpt_1')
      expect('0123456789').to.equal(decode(viewport_data.getData_asU8()))
      viewport_data = await getViewportData(viewport_id)
      expect('ABC').to.equal(decode(viewport_data.getData_asU8()))
      change_id = await del(session_id, 0, 1)
      expect(2).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(12).to.equal(file_size)
      viewport_data = await getViewportData('test_vpt_1')
      expect('123456789A').to.equal(decode(viewport_data.getData_asU8()))
      viewport_data = await getViewportData(viewport_id)
      expect('BC').to.equal(decode(viewport_data.getData_asU8()))
      change_id = await overwrite(session_id, 8, '!@#')
      expect(3).to.equal(change_id)
      file_size = await getComputedFileSize(session_id)
      expect(12).to.equal(file_size)
      let segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(encode('12345678!@#C'))
      viewport_data = await getViewportData('test_vpt_1')
      expect('12345678!@').to.equal(decode(viewport_data.getData_asU8()))
      viewport_data = await getViewportData(viewport_id)
      expect('#C').to.equal(decode(viewport_data.getData_asU8()))
      let deleted_viewport_id = await destroyViewport(viewport_id)
      expect(viewport_id).to.equal(deleted_viewport_id)
      expect(1).to.equal(await getViewportCount(session_id))
      // viewports are garbage collected when the session is destroyed, so no explicit destruction required
    })
    it('Should handle floating viewports', async () => {
      let change_id = await insert(session_id, 0, '0123456789LABEL01234567890')
      expect(1).to.equal(change_id)
      let viewport_id = await createViewport(
        'test_vpt_no_float',
        session_id,
        10,
        5,
        false
      )
      let viewport_floating_id = await createViewport(
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

  describe('StressTest', () => {
    const full_rotations = 10
    it(
      'Should stress test the editing capabilities (' +
        full_rotations +
        ' rotations)',
      async () => {
        expect(full_rotations).to.be.a('number').greaterThan(0)
        const data = encode(
          'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:",<.>/?`~'
        )
        let change_id = await insert(session_id, 0, data)
        expect(1).to.equal(change_id)
        const file_size = await getComputedFileSize(session_id)
        expect(data.length).to.equal(file_size)
        await pauseSessionChanges(session_id)
        change_id = await insert(session_id, 0, data)
        expect(0).to.equal(change_id)
        expect(data.length).to.equal(await getComputedFileSize(session_id))
        await resumeSessionChanges(session_id)
        let viewport_id = await createViewport(
          'last_byte_vpt',
          session_id,
          file_size - 1,
          1,
          false
        )
        let viewport_2_id = await createViewport(
          'all_data_vpt',
          session_id,
          0,
          file_size,
          false
        )
        let viewport_data = await getViewportData(viewport_id)
        expect('~').to.equal(decode(viewport_data.getData_asU8()))
        let rotations = file_size * full_rotations
        const expected_num_changes = 1 + 3 * file_size * full_rotations
        while (rotations--) {
          viewport_data = await getViewportData(viewport_id)
          expect(1 + (await insert(session_id, 0, ' '))).to.equal(
            await overwrite(session_id, 0, decode(viewport_data.getData_asU8()))
          )
          expect((await undo(session_id)) * -1).to.equal(await redo(session_id))
          change_id = await del(session_id, file_size, 1)
          viewport_data = await getViewportData(viewport_2_id)
          //console.log(decode(viewport_data.getData_asU8()))
          //console.log("Number of changes: " + await getChangeCount(session_id) + " of " + expected_num_changes)
        }
        expect(await getChangeCount(session_id)).to.equal(change_id)
        expect(expected_num_changes).to.equal(change_id)
        viewport_data = await getViewportData(viewport_2_id)
        expect(data).to.deep.equal(viewport_data.getData_asU8())
        expect(viewport_id).to.equal(await destroyViewport(viewport_id))
        expect(viewport_2_id).to.equal(await destroyViewport(viewport_2_id))
        //console.log("Number of changes: " + await getChangeCount(session_id))
      }
    ).timeout(10000 * full_rotations)
  })
})
