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
import {
  createSession,
  destroySession,
  getComputedFileSize,
  getSegment,
  getSessionCount,
  saveSession,
} from '../../src/session'
import {
  clear,
  getChangeCount,
  getLastUndo,
  getUndoCount,
  insert,
  redo,
  undo,
} from '../../src/change'
import { unlinkSync } from 'fs'
import { ChangeKind } from '../../src/omega_edit_pb'
import { decode, encode } from 'fastestsmallesttextencoderdecoder'
import { cleanup, custom_setup } from './common'

describe('Undo/Redo', () => {
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await custom_setup()
  })

  afterEach('Destroy session', async () => {
    await cleanup(session_id)
  })

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

    const last_undo = await getLastUndo(session_id)
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
    expect(encode('9')).deep.equals(await getSegment(session_id, 0, file_size))
    expect(1).to.equal(await getChangeCount(session_id))
    expect(3).to.equal(await getUndoCount(session_id))

    change_id = await undo(session_id)
    expect(-1).to.equal(change_id)
    file_size = await getComputedFileSize(session_id)
    expect(0).to.equal(file_size)
    expect(await getSegment(session_id, 0, file_size)).to.be.empty
    expect(0).to.equal(await getChangeCount(session_id))
    expect(4).to.equal(await getUndoCount(session_id))

    // Try undo when there is nothing left to undo
    undo(session_id).catch((e) =>
      expect(e).to.be.an('error').with.property('message', 'Error: undo failed')
    )
    file_size = await getComputedFileSize(session_id)
    expect(0).to.equal(file_size)
    expect(await getSegment(session_id, 0, file_size)).to.be.empty
    expect(0).to.equal(await getChangeCount(session_id))
    expect(4).to.equal(await getUndoCount(session_id))

    change_id = await redo(session_id)
    expect(1).to.equal(change_id)
    file_size = await getComputedFileSize(session_id)
    expect(1).to.equal(file_size)
    expect(encode('9')).deep.equals(await getSegment(session_id, 0, file_size))
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

    change_id = await insert(session_id, 0, '0123456')
    expect(3).to.equal(change_id)
    expect(3).to.equal(await getChangeCount(session_id))
    expect(0).to.equal(await getUndoCount(session_id))
    file_size = await getComputedFileSize(session_id)
    expect(10).to.equal(file_size)
    segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('0123456789'))

    // Try redo when there is noting left to redo
    redo(session_id).catch((e) =>
      expect(e).to.be.an('error').with.property('message', 'Error: redo failed')
    )
    expect(3).to.equal(await getChangeCount(session_id))
    expect(0).to.equal(await getUndoCount(session_id))

    // Test file saving and reading into a new session
    const save_file_name = await saveSession(
      session_id,
      'save_session_test',
      true
    )
    assert(save_file_name.endsWith('save_session_test'))
    expect(1).to.equal(await getSessionCount())
    const session_id_2 = await createSession(
      save_file_name,
      'verify_save_session'
    )
    expect(2).to.equal(await getSessionCount())
    expect('verify_save_session').to.equal(session_id_2)
    file_size = await getComputedFileSize(session_id_2)
    expect(10).to.equal(file_size)
    segment = await getSegment(session_id_2, 0, file_size)
    expect(segment).deep.equals(encode('0123456789'))
    const destroyed_session = await destroySession(session_id_2)
    expect(destroyed_session).to.equal(session_id_2)
    expect(1).to.equal(await getSessionCount())

    // remove test file
    unlinkSync(save_file_name)

    // test clearing changes from a session
    expect(3).to.equal(await getChangeCount(session_id))
    const cleared_session_id = await clear(session_id)
    expect(session_id).to.equal(cleared_session_id)
    expect(0).to.equal(await getChangeCount(session_id))
  })
})
