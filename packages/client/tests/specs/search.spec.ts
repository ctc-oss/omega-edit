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
  EditStats,
  beginSessionTransaction,
  clear,
  edit,
  editOptimizer,
  endSessionTransaction,
  getChangeCount,
  getChangeTransactionCount,
  getComputedFileSize,
  getSegment,
  getUndoCount,
  getUndoTransactionCount,
  overwrite,
  redo,
  replace,
  replaceOneSession,
  replaceSession,
  searchSession,
  undo,
} from '@omega-edit/client'

// prettier-ignore
// @ts-ignore
import { createTestSession, destroyTestSession, testPort } from './common'

describe('Searching', () => {
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await createTestSession(testPort)
  })

  afterEach('Destroy session', async () => {
    await destroyTestSession(session_id)
  })

  it('Should search sessions', async () => {
    const change_id = await overwrite(
      session_id,
      0,
      Buffer.from('haystackneedleNEEDLENeEdLeneedhay')
    )
    expect(change_id).to.be.a('number').that.equals(1)
    const file_size = await getComputedFileSize(session_id)
    let needles = await searchSession(
      session_id,
      'needle',
      false,
      0,
      0,
      undefined
    )
    expect(needles).deep.equals([8])
    needles = await searchSession(session_id, 'needle', true, 3, file_size - 3)
    expect(needles).deep.equals([8, 14, 20])
    needles = await searchSession(
      session_id,
      'needle',
      true,
      3,
      file_size - 3,
      0
    )
    expect(needles).deep.equals([8, 14, 20])
    needles = await searchSession(
      session_id,
      'needle',
      true,
      3,
      file_size - 3,
      2
    )
    expect(needles).deep.equals([8, 14])
    needles = await searchSession(session_id, 'NEEDLE', false, 0, 0, 1)
    expect(needles).deep.equals([14])
    needles = await searchSession(session_id, 'NEEDLE', false, 0, 20, undefined)
    expect(needles).deep.equals([14])
    needles = await searchSession(session_id, 'NEEDLE', false, 14, 6, undefined)
    expect(needles).deep.equals([14])
    needles = await searchSession(session_id, 'NEEDLE', false, 14, 5, undefined)
    expect(needles).to.be.empty
    needles = await searchSession(session_id, 'NEEDLE', false, 0, 19, undefined)
    expect(needles).to.be.empty
    expect(await getChangeCount(session_id)).to.equal(1)

    // try single byte searches
    needles = await searchSession(session_id, 'n', false, 0, 0, undefined)
    expect(needles).deep.equals([8, 26])
    needles = await searchSession(session_id, 'N', false, 0, 0, undefined)
    expect(needles).deep.equals([14, 20])
    needles = await searchSession(session_id, 'n', true, 0, 0, undefined)
    expect(needles).deep.equals([8, 14, 20, 26])
    needles = await searchSession(session_id, 'F', false, 0, 0, undefined)
    expect(needles).to.be.empty

    // try searching an empty session
    await clear(session_id)
    expect(await getChangeCount(session_id)).to.equal(0)
    needles = await searchSession(session_id, 'needle', true, 0, 0, undefined)
    expect(needles).to.be.empty
  })

  it('Should be able to optimize replacement operations', () => {
    const optimizer_usecases = [
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('AAAAABAAAA'),
        expected: [
          { offset: 5, remove_bytes_count: 1, replacement: Buffer.from('B') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('BAAAAAAAAA'),
        expected: [
          { offset: 0, remove_bytes_count: 1, replacement: Buffer.from('B') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('AAAAAAAAAB'),
        expected: [
          { offset: 9, remove_bytes_count: 1, replacement: Buffer.from('B') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('AAABAABAAA'),
        expected: [
          {
            offset: 3,
            remove_bytes_count: 4,
            replacement: Buffer.from('BAAB'),
          },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('BAAAAAAAAB'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 10,
            replacement: Buffer.from('BAAAAAAAAB'),
          },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('BBBBBBBBBB'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 10,
            replacement: Buffer.from('BBBBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('BBBBBBBBBA'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 9,
            replacement: Buffer.from('BBBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('ABBBBBBBBB'),
        expected: [
          {
            offset: 1,
            remove_bytes_count: 9,
            replacement: Buffer.from('BBBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from('BAAAAAAAAA'),
        replacement: Buffer.from('BBBBBBBBBB'),
        expected: [
          {
            offset: 1,
            remove_bytes_count: 9,
            replacement: Buffer.from('BBBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from('BAAAAAAAAA'),
        replacement: Buffer.from('BBBBBBBBBA'),
        expected: [
          {
            offset: 1,
            remove_bytes_count: 8,
            replacement: Buffer.from('BBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from('BAAAAAAAAA'),
        replacement: Buffer.from('BBBBBBBBAB'),
        expected: [
          {
            offset: 1,
            remove_bytes_count: 9,
            replacement: Buffer.from('BBBBBBBAB'),
          },
        ],
      },
      {
        original: Buffer.from('BAAAAAAAAA'),
        replacement: Buffer.from('BBBBBBBABB'),
        expected: [
          {
            offset: 1,
            remove_bytes_count: 9,
            replacement: Buffer.from('BBBBBBABB'),
          },
        ],
      },
      {
        original: Buffer.from('BAAAAAAAAA'),
        replacement: Buffer.from('BBBBBBABBB'),
        expected: [
          {
            offset: 1,
            remove_bytes_count: 9,
            replacement: Buffer.from('BBBBBABBB'),
          },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('AAAAAAAAAA'),
        expected: null,
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from(''),
        expected: [
          { offset: 0, remove_bytes_count: 10, replacement: Buffer.from('') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('A'),
        expected: [
          { offset: 1, remove_bytes_count: 9, replacement: Buffer.from('') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('AA'),
        expected: [
          { offset: 2, remove_bytes_count: 8, replacement: Buffer.from('') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('AAA'),
        expected: [
          { offset: 3, remove_bytes_count: 7, replacement: Buffer.from('') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('AAAA'),
        expected: [
          { offset: 4, remove_bytes_count: 6, replacement: Buffer.from('') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('B'),
        expected: [
          { offset: 0, remove_bytes_count: 10, replacement: Buffer.from('B') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('BB'),
        expected: [
          { offset: 0, remove_bytes_count: 10, replacement: Buffer.from('BB') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAA'),
        replacement: Buffer.from('BBB'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 10,
            replacement: Buffer.from('BBB'),
          },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAB'),
        replacement: Buffer.from('B'),
        expected: [
          { offset: 0, remove_bytes_count: 9, replacement: Buffer.from('') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAB'),
        replacement: Buffer.from('BB'),
        expected: [
          { offset: 0, remove_bytes_count: 9, replacement: Buffer.from('B') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAAB'),
        replacement: Buffer.from('BBB'),
        expected: [
          { offset: 0, remove_bytes_count: 9, replacement: Buffer.from('BB') },
        ],
      },
      {
        original: Buffer.from('BAAAAAAAAA'),
        replacement: Buffer.from('B'),
        expected: [
          { offset: 1, remove_bytes_count: 9, replacement: Buffer.from('') },
        ],
      },
      {
        original: Buffer.from('BAAAAAAAAA'),
        replacement: Buffer.from('BB'),
        expected: [
          { offset: 1, remove_bytes_count: 9, replacement: Buffer.from('B') },
        ],
      },
      {
        original: Buffer.from('BAAAAAAAAA'),
        replacement: Buffer.from('BBB'),
        expected: [
          { offset: 1, remove_bytes_count: 9, replacement: Buffer.from('BB') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAA'),
        replacement: Buffer.from('AAAAAAAAAA'),
        expected: [
          { offset: 9, remove_bytes_count: 0, replacement: Buffer.from('A') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAA'),
        replacement: Buffer.from('AAAAAAAAAB'),
        expected: [
          { offset: 9, remove_bytes_count: 0, replacement: Buffer.from('B') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAA'),
        replacement: Buffer.from('BAAAAAAAAA'),
        expected: [
          { offset: 0, remove_bytes_count: 0, replacement: Buffer.from('B') },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAA'),
        replacement: Buffer.from('BAAAAAAAAAB'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 9,
            replacement: Buffer.from('BAAAAAAAAAB'),
          },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAA'),
        replacement: Buffer.from('BBBBBBBBBB'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 9,
            replacement: Buffer.from('BBBBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from(''),
        replacement: Buffer.from('BBBBBBBBBB'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 0,
            replacement: Buffer.from('BBBBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from('A'),
        replacement: Buffer.from('BBBBBBBBBB'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 1,
            replacement: Buffer.from('BBBBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from('AA'),
        replacement: Buffer.from('BBBBBBBBBB'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 2,
            replacement: Buffer.from('BBBBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from('AAA'),
        replacement: Buffer.from('BBBBBBBBBB'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 3,
            replacement: Buffer.from('BBBBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAA'),
        replacement: Buffer.from('BBBBBBBBBA'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 8,
            replacement: Buffer.from('BBBBBBBBB'),
          },
        ],
      },
      {
        original: Buffer.from('AAAAAAAAA'),
        replacement: Buffer.from('BBBBBBBBAB'),
        expected: [
          {
            offset: 0,
            remove_bytes_count: 9,
            replacement: Buffer.from('BBBBBBBBAB'),
          },
        ],
      },
    ]
    // run all test cases
    for (let i = 0; i < optimizer_usecases.length; ++i) {
      const result = editOptimizer(
        optimizer_usecases[i].original,
        optimizer_usecases[i].replacement,
        0
      )
      expect(
        result,
        `case ${i}: ${JSON.stringify(
          optimizer_usecases[i].expected
        )} -> ${JSON.stringify(result)}`
      ).deep.equals(optimizer_usecases[i].expected)
    }
  })

  it('Should iteratively replace patterns in a range', async () => {
    const change_id = await overwrite(
      session_id,
      0,
      Buffer.from('needle here needle there needleneedle everywhere')
    )
    expect(change_id).to.be.a('number').that.equals(1)
    let nextOffset = await replaceOneSession(
      session_id,
      'needle',
      'Item',
      false,
      0,
      0
    )
    expect(nextOffset).to.equal(4)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item here needle there needleneedle everywhere'))
    nextOffset = await replaceOneSession(
      session_id,
      'needle',
      'Item',
      false,
      nextOffset,
      0
    )
    expect(nextOffset).to.equal(14)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item here Item there needleneedle everywhere'))
    nextOffset = await replaceOneSession(
      session_id,
      'needle',
      'Item',
      false,
      nextOffset,
      0
    )
    expect(nextOffset).to.equal(25)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item here Item there Itemneedle everywhere'))
    nextOffset = await replaceOneSession(
      session_id,
      'needle',
      'Item',
      false,
      nextOffset,
      0
    )
    expect(nextOffset).to.equal(29)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item here Item there ItemItem everywhere'))
    nextOffset = await replaceOneSession(
      session_id,
      'needle',
      'Item',
      false,
      nextOffset,
      0
    )
    expect(nextOffset).to.equal(-1)
    // test against infinite recursion
    nextOffset = await replaceOneSession(
      session_id,
      'item',
      'Item-1',
      true,
      0,
      0
    )
    expect(nextOffset).to.equal(6)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item-1 here Item there ItemItem everywhere'))
    nextOffset = await replaceOneSession(
      session_id,
      'Item',
      'Item-1',
      false,
      nextOffset,
      0
    )
    expect(nextOffset).to.equal(18)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item-1 here Item-1 there ItemItem everywhere'))
    nextOffset = await replaceOneSession(
      session_id,
      'Item',
      'Item-1',
      false,
      nextOffset,
      0
    )
    expect(nextOffset).to.equal(31)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item-1 here Item-1 there Item-1Item everywhere'))
    nextOffset = await replaceOneSession(
      session_id,
      'Item',
      'Item-1',
      false,
      nextOffset,
      0
    )
    expect(nextOffset).to.equal(37)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(
      Buffer.from('Item-1 here Item-1 there Item-1Item-1 everywhere')
    )
    nextOffset = await replaceOneSession(
      session_id,
      'Item',
      'Item-1',
      false,
      nextOffset,
      0
    )
    expect(nextOffset).to.equal(-1)
    nextOffset = await replaceOneSession(
      session_id,
      'every',
      'no',
      true,
      0,
      0,
      true
    )
    expect(nextOffset).to.equal(40)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(
      Buffer.from('Item-1 here Item-1 there Item-1Item-1 noerywhere')
    )
  })

  it('Should replace patterns in a range', async () => {
    const stats = new EditStats()
    const change_id = await overwrite(
      session_id,
      0,
      Buffer.from('needle here needle there needleneedle everywhere'),
      stats
    )
    expect(change_id).to.be.a('number').that.equals(1)
    expect(stats.delete_count).to.equal(0)
    expect(stats.insert_count).to.equal(0)
    expect(stats.overwrite_count).to.equal(1)
    expect(stats.error_count).to.equal(0)
    stats.reset()
    expect(
      await replaceSession(
        session_id,
        'needle',
        'Item',
        false,
        0,
        await getComputedFileSize(session_id),
        0,
        true,
        false,
        stats
      )
    ).to.equal(4)
    // expect 4 deletes and 4 inserts
    expect(stats.delete_count).to.equal(4)
    expect(stats.insert_count).to.equal(4)
    expect(stats.overwrite_count).to.equal(0)
    expect(stats.error_count).to.equal(0)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item here Item there ItemItem everywhere'))
    expect(await getChangeCount(session_id)).to.equal(9)
    expect(await getChangeTransactionCount(session_id)).to.equal(5)
    expect(await beginSessionTransaction(session_id)).to.equal(session_id)
    stats.reset()
    expect(
      await replaceSession(
        session_id,
        'item',
        'needle',
        true,
        4,
        (await getComputedFileSize(session_id)) - 4,
        0,
        false,
        false,
        stats
      )
    ).to.equal(3)
    expect(await endSessionTransaction(session_id)).to.equal(session_id)
    expect(await getChangeCount(session_id)).to.equal(15)
    expect(await getChangeTransactionCount(session_id)).to.equal(8)
    expect(await undo(session_id))
      .to.be.a('number')
      .that.equals(-14)
    expect(await getChangeTransactionCount(session_id)).to.equal(7)
    expect(await getUndoTransactionCount(session_id)).to.equal(1)
    expect(await getUndoCount(session_id)).to.equal(2)
    expect(await getChangeCount(session_id)).to.equal(13)
    expect(await redo(session_id))
      .to.be.a('number')
      .that.equals(15)
    expect(await getChangeCount(session_id)).to.equal(15)
    expect(await getChangeTransactionCount(session_id)).to.equal(8)
    // expect 3 deletes and 3 inserts
    expect(stats.delete_count).to.equal(3)
    expect(stats.insert_count).to.equal(3)
    expect(stats.overwrite_count).to.equal(0)
    expect(stats.error_count).to.equal(0)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item here needle there needleneedle everywhere'))
    stats.reset()
    expect(
      await replaceSession(
        session_id,
        'Needle',
        'noodle',
        true,
        0,
        await getComputedFileSize(session_id),
        1,
        true,
        false,
        stats
      )
    ).to.equal(1)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item here noodle there needleneedle everywhere'))
    // expect a single overwrite
    expect(stats.delete_count).to.equal(0)
    expect(stats.insert_count).to.equal(0)
    expect(stats.overwrite_count).to.equal(1)
    expect(stats.error_count).to.equal(0)
    stats.reset()
    // test overwrite only
    expect(
      await replaceSession(
        session_id,
        'needleneedle',
        'noodle',
        true,
        0,
        await getComputedFileSize(session_id),
        1,
        true,
        true,
        stats
      )
    ).to.equal(1)
    expect(
      await getSegment(session_id, 0, await getComputedFileSize(session_id))
    ).deep.equals(Buffer.from('Item here noodle there noodleneedle everywhere'))
    // expect a single overwrite
    expect(stats.delete_count).to.equal(0)
    expect(stats.insert_count).to.equal(0)
    expect(stats.overwrite_count).to.equal(1)
    expect(stats.error_count).to.equal(0)
  })

  it('Should work with replace on binary data', async () => {
    const change_id = await overwrite(
      session_id,
      0,
      new Uint8Array([123, 6, 5, 4, 7, 8, 9, 0, 254, 255])
    )
    expect(change_id).to.equal(1)
    let file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(10)
    let segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(
      new Uint8Array([123, 6, 5, 4, 7, 8, 9, 0, 254, 255])
    )
    let pattern_bytes = new Uint8Array([6, 5, 4])
    let replace_bytes = new Uint8Array([4, 5, 6])
    let needles = await searchSession(session_id, pattern_bytes, false, 0, 0)
    expect(needles).deep.equals([1])
    const stats = new EditStats()
    await replace(session_id, 1, pattern_bytes.length, replace_bytes, stats)
    expect(stats.delete_count).to.equal(0)
    expect(stats.insert_count).to.equal(0)
    expect(stats.overwrite_count).to.equal(1)
    expect(stats.error_count).to.equal(0)
    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(
      new Uint8Array([123, 4, 5, 6, 7, 8, 9, 0, 254, 255])
    )
    pattern_bytes = new Uint8Array([123])
    replace_bytes = new Uint8Array([1, 2, 3])
    needles = await searchSession(
      session_id,
      pattern_bytes,
      false,
      0,
      0,
      undefined
    )
    expect(needles).deep.equals([0])
    stats.reset()
    await edit(session_id, 0, pattern_bytes, replace_bytes, stats)
    // this edit will do an insert and a delete
    expect(stats.delete_count).to.equal(0)
    expect(stats.insert_count).to.equal(1)
    expect(stats.overwrite_count).to.equal(1)
    expect(stats.error_count).to.equal(0)

    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 254, 255])
    )
    pattern_bytes = new Uint8Array([0, 254, 255])
    replace_bytes = new Uint8Array([10])
    needles = await searchSession(
      session_id,
      pattern_bytes,
      false,
      0,
      0,
      undefined
    )
    expect(needles).deep.equals([9])
    stats.reset()
    await edit(session_id, 9, pattern_bytes, replace_bytes, stats)
    // this edit will do an insert and a delete
    expect(stats.delete_count).to.equal(1)
    expect(stats.insert_count).to.equal(0)
    expect(stats.overwrite_count).to.equal(1)
    expect(stats.error_count).to.equal(0)

    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
  })

  it('Should work with replace on character data', async () => {
    const change_id = await overwrite(
      session_id,
      0,
      Buffer.from('Hey there is hay in my Needles')
    )
    expect(change_id).to.equal(1)
    expect(await getComputedFileSize(session_id)).to.equal(30)
    let pattern_chars = 'is hay'
    let replace_chars = 'are needles'
    let needles = await searchSession(session_id, pattern_chars, false, 0, 0)
    expect(needles).deep.equals([10])
    await edit(
      session_id,
      10,
      Buffer.from(pattern_chars),
      Buffer.from(replace_chars)
    )
    pattern_chars = 'needles'
    replace_chars = 'hay'
    needles = await searchSession(session_id, pattern_chars, true)
    expect(needles).deep.equals([14, 28])
    await edit(
      session_id,
      28,
      Buffer.from(pattern_chars),
      Buffer.from(replace_chars)
    )
    const file_size = await getComputedFileSize(session_id)
    const segment = await getSegment(session_id, 0, file_size)
    expect(segment.length).to.equal(file_size)
    expect(segment).deep.equals(Buffer.from('Hey there are needles in my hay'))
  })
})
