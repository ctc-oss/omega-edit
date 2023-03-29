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
  SessionEventKind,
  unsubscribeSession,
  ChangeKind,
  clear,
  del,
  edit,
  EditOperation,
  editOperations,
  EditOperationType,
  EditStats,
  getChangeCount,
  getChangeTransactionCount,
  getLastChange,
  insert,
  overwrite,
  removeCommonSuffix,
  ALL_EVENTS,
} from 'omega-edit'

// prettier-ignore
// @ts-ignore
import { checkCallbackCount, createTestSession, destroyTestSession, session_callbacks, subscribeSession, testPort} from "./common";

describe('Editing', () => {
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await createTestSession(testPort)
  })

  afterEach('Destroy session', async () => {
    await destroyTestSession(session_id)
  })

  describe('Insert', () => {
    it('Should insert a string', async () => {
      expect(await getComputedFileSize(session_id)).to.equal(0)
      const data: Uint8Array = Buffer.from('abcghijklmnopqrstuvwxyz')
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
      await checkCallbackCount(session_callbacks, session_id, 0)
      // Subscribe to all events
      await subscribeSession(session_id)
      change_id = await insert(session_id, 3, Buffer.from('def'), stats)
      expect(change_id).to.be.a('number').that.equals(2)
      expect(stats.insert_count).to.equal(2)
      const file_size = await getComputedFileSize(session_id)
      expect(file_size).to.equal(data.length + 3)
      const segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(Buffer.from('abcdefghijklmnopqrstuvwxyz'))
      await checkCallbackCount(session_callbacks, session_id, 1)
      expect(stats.error_count).to.equal(0)
    })
  })

  describe('Delete', () => {
    it('Should delete some data', async () => {
      expect(0).to.equal(await getComputedFileSize(session_id))
      const data: Uint8Array = Buffer.from('abcdefghijklmnopqrstuvwxyz')
      await subscribeSession(session_id)
      await checkCallbackCount(session_callbacks, session_id, 0)
      const stats = new EditStats()
      let change_id = await insert(session_id, 0, data, stats)
      expect(change_id).to.be.a('number').that.equals(1)
      expect(stats.insert_count).to.equal(1)
      let segment = await getSegment(session_id, 0, data.length)
      expect(segment).deep.equals(data)
      let file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length)
      await checkCallbackCount(session_callbacks, session_id, 1)
      await unsubscribeSession(session_id)
      const del_change_id = await del(session_id, 13, 10, stats)
      expect(stats.delete_count).to.equal(1)
      expect(del_change_id)
        .to.be.a('number')
        .that.equals(change_id + 1)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length - 10)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(Buffer.from('abcdefghijklmxyz'))
      await checkCallbackCount(session_callbacks, session_id, 1) // unsubscribed before the second event
      expect(stats.error_count).to.equal(0)
    })
  })

  describe('Overwrite', () => {
    it('Should overwrite some data', async () => {
      expect(await getComputedFileSize(session_id)).to.equal(0)
      const data: Uint8Array = Buffer.from('abcdefghijklmnopqrstuvwxyΩ') // Note: Ω is a 2-byte character
      const stats = new EditStats()
      let change_id = await overwrite(session_id, 0, data, stats)
      expect(stats.overwrite_count).to.equal(1)
      await subscribeSession(session_id)
      await checkCallbackCount(session_callbacks, session_id, 0)
      expect(change_id).to.be.a('number').that.equals(1)
      let segment = await getSegment(session_id, 0, data.length)
      expect(segment).deep.equals(data)
      let file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length)
      let last_change = await getLastChange(session_id)
      expect(last_change.getData_asU8()).deep.equals(data)
      expect(last_change.getOffset()).to.equal(0)
      expect(last_change.getKind()).to.equal(ChangeKind.CHANGE_OVERWRITE)
      expect(last_change.getSerial()).to.equal(1)
      expect(last_change.getLength()).to.equal(27)
      expect(last_change.getSessionId()).to.equal(session_id)
      let overwrite_change_id = await overwrite(
        session_id,
        13,
        Buffer.from('NO123456VW'),
        stats
      ) // overwriting: nopqrstuvw (len: 10)
      expect(overwrite_change_id).to.be.a('number').that.equals(2)
      expect(stats.overwrite_count).to.equal(2)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).to.equal(data.length)
      last_change = await getLastChange(session_id)
      expect(last_change.getData_asU8()).deep.equals(Buffer.from('NO123456VW'))
      expect(last_change.getOffset()).to.equal(13)
      expect(last_change.getKind()).to.equal(ChangeKind.CHANGE_OVERWRITE)
      expect(last_change.getSerial()).to.equal(2)
      expect(last_change.getLength()).to.equal(10)
      expect(last_change.getSessionId()).to.equal(session_id)
      await checkCallbackCount(session_callbacks, session_id, 1)
      overwrite_change_id = await overwrite(
        session_id,
        15,
        Buffer.from('PQRSTU'),
        stats
      ) // overwriting: 123456 (len: 6), using a string
      expect(overwrite_change_id).to.be.a('number').that.equals(3)
      expect(stats.overwrite_count).to.equal(3)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(Buffer.from('abcdefghijklmNOPQRSTUVWxyΩ'))
      await checkCallbackCount(session_callbacks, session_id, 2)
      await unsubscribeSession(session_id)
      // To overwrite a 2-byte character with a single-byte character, we need to delete the 2-byte character and insert the single-byte character
      change_id = await del(session_id, 25, 2, stats)
      expect(change_id).to.be.a('number').that.equals(4)
      expect(stats.delete_count).to.equal(1)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length - 2)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(Buffer.from('abcdefghijklmNOPQRSTUVWxy'))
      await checkCallbackCount(session_callbacks, session_id, 2)
      await subscribeSession(session_id)
      change_id = await insert(session_id, 25, Buffer.from('z'), stats)
      expect(change_id).to.equal(5)
      expect(stats.insert_count).to.equal(1)
      file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(data.length - 1)
      segment = await getSegment(session_id, 0, file_size)
      expect(segment).deep.equals(Buffer.from('abcdefghijklmNOPQRSTUVWxyz'))
      await checkCallbackCount(session_callbacks, session_id, 3)
      expect(stats.error_count).to.equal(0)
    })
  })

  describe('Edit', () => {
    it('should optimize edit operations', async () => {
      let originalSegment = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      let editedSegment = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      const stats = new EditStats()
      // load the original data into the session
      let change_serial = await overwrite(session_id, 0, originalSegment, stats)
      expect(change_serial).to.equal(1)
      expect(
        await getSegment(session_id, 0, await getComputedFileSize(session_id))
      ).deep.equals(originalSegment)
      change_serial = await edit(
        session_id,
        0,
        originalSegment,
        editedSegment,
        stats
      )
      expect(
        await getSegment(session_id, 0, await getComputedFileSize(session_id))
      ).deep.equals(editedSegment)
      expect(change_serial).to.equal(0)
      expect(stats.clear_count).to.equal(0)
      expect(stats.undo_count).to.equal(0)
      expect(stats.redo_count).to.equal(0)
      expect(stats.delete_count).to.equal(0)
      expect(stats.insert_count).to.equal(0)
      expect(stats.overwrite_count).to.equal(1)
      expect(stats.error_count).to.equal(0)
      originalSegment = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      editedSegment = new Uint8Array([1, 2, 3, 8, 9, 10])
      expect(editOperations(originalSegment, editedSegment)).to.deep.equal([
        { type: 'delete', start: 3, length: 4 },
      ])
      stats.reset()
      change_serial = await edit(
        session_id,
        0,
        originalSegment,
        editedSegment,
        stats
      )
      expect(
        await getSegment(session_id, 0, await getComputedFileSize(session_id))
      ).deep.equals(editedSegment)
      expect(change_serial).to.equal(2)
      expect(stats.clear_count).to.equal(0)
      expect(stats.undo_count).to.equal(0)
      expect(stats.redo_count).to.equal(0)
      expect(stats.delete_count).to.equal(1)
      expect(stats.insert_count).to.equal(0)
      expect(stats.overwrite_count).to.equal(0)
      expect(stats.error_count).to.equal(0)
      stats.reset()
      await clear(session_id)
      originalSegment = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      editedSegment = new Uint8Array([2, 3, 8, 9, 10, 11, 12, 13])
      change_serial = await overwrite(session_id, 0, originalSegment)
      expect(change_serial).to.equal(1)
      expect(editOperations(originalSegment, editedSegment)).to.deep.equal([
        {
          type: 'overwrite',
          start: 0,
          data: new Uint8Array([2, 3, 8, 9, 10, 11, 12, 13]),
        },
        { type: 'delete', start: 8, length: 2 },
      ])
      change_serial = await edit(
        session_id,
        0,
        originalSegment,
        editedSegment,
        stats
      )
      expect(change_serial).to.equal(3)
      expect(await getChangeCount(session_id)).to.equal(3)
      expect(await getChangeTransactionCount(session_id)).to.equal(2)
      expect(stats.clear_count).to.equal(0)
      expect(stats.undo_count).to.equal(0)
      expect(stats.redo_count).to.equal(0)
      expect(stats.delete_count).to.equal(1)
      expect(stats.insert_count).to.equal(0)
      expect(stats.overwrite_count).to.equal(1)
      expect(stats.error_count).to.equal(0)
      expect(
        await getSegment(session_id, 0, await getComputedFileSize(session_id))
      ).deep.equals(editedSegment)
    })
  })
})

describe('Remove Common Suffix', function () {
  it('should return the same arrays if there is no common suffix', () => {
    const arr1 = new Uint8Array([1, 2, 3, 4, 5])
    const arr2 = new Uint8Array([6, 7, 8, 9, 10])
    const expected = [
      new Uint8Array([1, 2, 3, 4, 5]),
      new Uint8Array([6, 7, 8, 9, 10]),
    ]
    const actual = removeCommonSuffix(arr1, arr2)
    expect(actual).to.deep.equal(expected)
  })

  it('should return the same arrays if either one is empty', () => {
    const arr1 = new Uint8Array([1, 2, 3, 4, 5])
    const arr2 = new Uint8Array([])
    const expected = [new Uint8Array([1, 2, 3, 4, 5]), new Uint8Array([])]
    const actual = removeCommonSuffix(arr1, arr2)
    expect(actual).to.deep.equal(expected)
  })

  it('should remove the common suffix from both arrays', () => {
    const arr1 = new Uint8Array([1, 2, 3, 4, 5])
    const arr2 = new Uint8Array([0, 1, 2, 3, 4, 5])
    const expected = [new Uint8Array(), new Uint8Array([0])]
    const actual = removeCommonSuffix(arr1, arr2)
    expect(actual).to.deep.equal(expected)
  })
})

describe('Edit Optimizer', function () {
  it('should handle empty arrays', () => {
    const originalSegment = new Uint8Array([])
    const editedSegment = new Uint8Array([])
    const expected: EditOperation[] = []
    const actual = editOperations(originalSegment, editedSegment)
    expect(actual).to.deep.equal(expected)
  })

  it('should return an empty array for identical arrays', () => {
    const arr = new Uint8Array([1, 2, 3, 4, 5])
    const result = editOperations(arr, arr)
    expect(result).to.be.an('array')
    expect(result).to.be.empty
  })

  it('should handle inserting everything in the array', () => {
    const originalSegment = new Uint8Array([])
    const editedSegment = new Uint8Array([1, 2, 3])
    const expected: EditOperation[] = [
      {
        type: EditOperationType.Insert,
        start: 0,
        data: new Uint8Array([1, 2, 3]),
      },
    ]
    const actual = editOperations(originalSegment, editedSegment)
    expect(actual).to.deep.equal(expected)
  })

  it('should handle inserting at the beginning of the array', () => {
    const originalSegment = new Uint8Array([3, 4, 5])
    const editedSegment = new Uint8Array([1, 2, 3, 4, 5])
    const expected: EditOperation[] = [
      {
        type: EditOperationType.Insert,
        start: 0,
        data: new Uint8Array([1, 2]),
      },
    ]
    const actual = editOperations(originalSegment, editedSegment)
    expect(actual).to.deep.equal(expected)
  })

  it('should handle inserting at the end of the array', () => {
    const originalSegment = new Uint8Array([1, 2, 3])
    const editedSegment = new Uint8Array([1, 2, 3, 4, 5])
    const expected: EditOperation[] = [
      {
        type: EditOperationType.Insert,
        start: 3,
        data: new Uint8Array([4, 5]),
      },
    ]
    const actual = editOperations(originalSegment, editedSegment)
    expect(actual).to.deep.equal(expected)
  })

  it('should handle overwriting everything in the array', () => {
    const originalSegment = new Uint8Array([1, 2, 3])
    const editedSegment = new Uint8Array([4, 5, 6])
    const expected: EditOperation[] = [
      {
        type: EditOperationType.Overwrite,
        start: 0,
        data: new Uint8Array([4, 5, 6]),
      },
    ]
    const actual = editOperations(originalSegment, editedSegment)
    expect(actual).to.deep.equal(expected)
  })

  it('should return a delete operation for a shorter array', () => {
    const originalSegment = new Uint8Array([1, 2, 3, 4, 5])
    const editedSegment = new Uint8Array([1, 2, 3])
    const result = editOperations(originalSegment, editedSegment)
    expect(result).to.be.an('array')
    expect(result).to.deep.equal([
      { type: EditOperationType.Delete, start: 3, length: 2 },
    ])
  })

  it('should return an insert operation for a longer array', function () {
    const originalSegment = new Uint8Array([1, 2, 3])
    const editedSegment = new Uint8Array([1, 2, 3, 4, 5])
    const ops = editOperations(originalSegment, editedSegment)
    expect(ops).to.deep.equal([
      {
        type: EditOperationType.Insert,
        start: 3,
        data: new Uint8Array([4, 5]),
      },
    ])
  })

  it('should return an overwrite operation for a partially different array', () => {
    const originalSegment = new Uint8Array([1, 2, 3, 4, 5])
    const editedSegment = new Uint8Array([1, 2, 6, 7, 5])
    const expected = [
      {
        type: EditOperationType.Overwrite,
        start: 2,
        data: new Uint8Array([6, 7]),
      },
    ]
    const actual = editOperations(originalSegment, editedSegment)
    expect(actual).to.deep.equal(expected)
  })

  it('should return a single overwrite operation for a fully different array', function () {
    const originalSegment = new Uint8Array([1, 2, 3, 4, 5])
    const editedSegment = new Uint8Array([6, 7, 8, 9, 10])
    const ops = editOperations(originalSegment, editedSegment)
    expect(ops).to.deep.equal([
      {
        type: EditOperationType.Overwrite,
        start: 0,
        data: new Uint8Array([6, 7, 8, 9, 10]),
      },
    ])
  })

  it('should coalesce adjacent operations of the same type', () => {
    const originalSegment = new Uint8Array([1, 2, 3, 4, 5])
    const editedSegment = new Uint8Array([1, 5, 6, 7, 8, 9])
    const expected: EditOperation[] = [
      {
        type: EditOperationType.Overwrite,
        start: 1,
        data: new Uint8Array([5, 6, 7, 8]),
      },
      { type: EditOperationType.Insert, start: 5, data: new Uint8Array([9]) },
    ]
    const actual = editOperations(originalSegment, editedSegment)
    expect(actual).to.deep.equal(expected)
  })

  it('should return an array of operations for a large and complex diff', () => {
    const originalSegment = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const editedSegment = new Uint8Array([
      1, 3, 4, 6, 8, 10, 11, 13, 15, 17, 19, 21, 23, 25, 27,
    ])
    const expected: EditOperation[] = [
      {
        data: new Uint8Array([3, 4, 6, 8, 10, 11, 13, 15, 17]),
        start: 1,
        type: EditOperationType.Overwrite,
      },
      {
        data: new Uint8Array([19, 21, 23, 25, 27]),
        start: 10,
        type: EditOperationType.Insert,
      },
    ]
    const actual = editOperations(originalSegment, editedSegment)
    expect(actual).to.deep.equal(expected)
  })
})
