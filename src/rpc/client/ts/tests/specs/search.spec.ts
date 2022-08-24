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
  searchSession,
} from '../../src/session'
import { clear, getChangeCount, overwrite, rep } from '../../src/change'
import { encode } from 'fastestsmallesttextencoderdecoder'
import { cleanup, custom_setup } from './common'

describe('Searching', () => {
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await custom_setup()
  })

  afterEach('Destroy session', async () => {
    cleanup(session_id)
  })

  it('Should search sessions', async () => {
    let change_id = await overwrite(
      session_id,
      0,
      'haystackneedleNEEDLENeEdLeneedhay'
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
      'needle',
      true,
      3,
      file_size - 3,
      undefined
    )
    expect([8, 14, 20]).deep.equals(needles)
    needles = await searchSession(
      session_id,
      'needle',
      true,
      3,
      file_size - 3,
      0
    )
    expect([8, 14, 20]).deep.equals(needles)
    needles = await searchSession(
      session_id,
      'needle',
      true,
      3,
      file_size - 3,
      2
    )
    expect([8, 14]).deep.equals(needles)
    needles = await searchSession(session_id, 'NEEDLE', false, 0, 0, 1)
    expect([14]).deep.equals(needles)
    needles = await searchSession(session_id, 'NEEDLE', false, 0, 20, undefined)
    expect([14]).deep.equals(needles)
    needles = await searchSession(session_id, 'NEEDLE', false, 14, 6, undefined)
    expect([14]).deep.equals(needles)
    needles = await searchSession(session_id, 'NEEDLE', false, 14, 5, undefined)
    expect([]).deep.equals(needles)
    needles = await searchSession(session_id, 'NEEDLE', false, 0, 19, undefined)
    expect([]).deep.equals(needles)

    // try searching an empty session
    await clear(session_id)
    expect(0).to.equal(await getChangeCount(session_id))
    needles = await searchSession(session_id, 'needle', true, 0, 0, undefined)
    expect([]).deep.equals(needles)
  })

  it('Should work with replace on binary data', async () => {
    let change_id = await overwrite(
      session_id,
      0,
      new Uint8Array([123, 6, 5, 4, 7, 8, 9, 0, 254, 255])
    )
    expect(change_id).to.equal(1)
    let file_size = await getComputedFileSize(session_id)
    expect(10).to.equal(file_size)
    let segment = await getSegment(session_id, 0, file_size)
    expect(new Uint8Array([123, 6, 5, 4, 7, 8, 9, 0, 254, 255])).deep.equals(
      segment
    )
    let pattern_bytes = new Uint8Array([6, 5, 4])
    let replace_bytes = new Uint8Array([4, 5, 6])
    let needles = await searchSession(
      session_id,
      pattern_bytes,
      false,
      0,
      0,
      undefined
    )
    expect([1]).deep.equals(needles)
    await rep(session_id, 1, pattern_bytes.length, replace_bytes)
    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(new Uint8Array([123, 4, 5, 6, 7, 8, 9, 0, 254, 255])).deep.equals(
      segment
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
    expect([0]).deep.equals(needles)
    await rep(session_id, 0, pattern_bytes.length, replace_bytes)
    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 254, 255])
    ).deep.equals(segment)
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
    expect([9]).deep.equals(needles)
    await rep(session_id, 9, pattern_bytes.length, replace_bytes)
    file_size = await getComputedFileSize(session_id)
    segment = await getSegment(session_id, 0, file_size)
    expect(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).deep.equals(segment)
  })

  it('Should work with replace on character data', async () => {
    let change_id = await overwrite(
      session_id,
      0,
      'Hey there is hay in my Needles'
    )
    expect(change_id).to.equal(1)
    expect(30).to.equal(await getComputedFileSize(session_id))
    let pattern = 'is hay'
    let replace = 'are needles'
    let needles = await searchSession(
      session_id,
      pattern,
      false,
      0,
      0,
      undefined
    )
    expect([10]).deep.equals(needles)
    await rep(session_id, 10, pattern.length, replace)
    pattern = 'needles'
    replace = 'hay'
    needles = await searchSession(session_id, pattern, true, 0, 0, undefined)
    expect([14, 28]).deep.equals(needles)
    await rep(session_id, 28, pattern.length, replace)
    let file_size = await getComputedFileSize(session_id)
    let segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('Hey there are needles in my hay'))
  })
})
