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
  createSession,
  destroySession,
  getComputedFileSize,
  getSegment,
  getSessionCount,
  saveSession,
} from '../../src/session'
import {
  clear,
  EditStats,
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

// prettier-ignore
// @ts-ignore
import { destroyTestSession, createTestSession, startTestServer, stopTestServer, testPort } from './common'

describe('Undo/Redo', () => {
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await createTestSession(testPort)
  })

  afterEach('Destroy session', async () => {
    await destroyTestSession(session_id)
  })

  it('Should undo and redo changes', async () => {
    expect(decode(encode('0123456789'))).to.equal('0123456789')
    expect(await getChangeCount(session_id)).to.equal(0)

    let change_id = await insert(session_id, 0, encode('9'))
    expect(change_id).to.equal(1)
    expect(await getChangeCount(session_id)).to.equal(1)
    let file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(1)

    change_id = await insert(session_id, 0, encode('78'))
    expect(change_id).to.equal(2)
    expect(await getChangeCount(session_id)).to.equal(2)
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(3)

    change_id = await insert(session_id, 0, '456') // test sending in a string
    expect(change_id).to.equal(3)
    expect(await getChangeCount(session_id)).to.equal(3)
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(6)

    change_id = await insert(session_id, 0, '0123')
    expect(change_id).to.equal(4)
    expect(await getChangeCount(session_id)).to.equal(4)
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(10)
    let segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('0123456789'))
    expect(decode(segment)).equals('0123456789')
    expect(0).to.equal(await getUndoCount(session_id))
    const stats = new EditStats()
    change_id = await undo(session_id, stats)
    expect(change_id).to.equal(-4)
    expect(stats.undo_count).to.equal(1)
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(6)
    expect(await getSegment(session_id, 0, file_size)).deep.equals(
      encode('456789')
    )
    expect(await getChangeCount(session_id)).to.equal(3)
    expect(await getUndoCount(session_id)).to.equal(1)

    change_id = await undo(session_id, stats)
    expect(change_id).to.equal(-3)
    expect(stats.undo_count).to.equal(2)
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(3)
    expect(await getSegment(session_id, 0, file_size)).deep.equals(
      encode('789')
    )
    expect(await getChangeCount(session_id)).to.equal(2)
    expect(await getUndoCount(session_id))
      .to.equal(2)
      .and.to.equal(stats.undo_count)

    const last_undo = await getLastUndo(session_id)
    expect(decode(last_undo.getData_asU8())).to.equal('456')
    expect(last_undo.getOffset()).to.equal(0)
    expect(last_undo.getKind()).to.equal(ChangeKind.CHANGE_INSERT)
    expect(last_undo.getSerial()).to.equal(-3)
    expect(last_undo.getLength()).to.equal(3)
    expect(last_undo.getSessionId()).to.equal(session_id)

    change_id = await undo(session_id, stats)
    expect(change_id).to.equal(-2)
    expect(stats.undo_count).to.equal(3)
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(1)
    expect(await getSegment(session_id, 0, file_size)).deep.equals(encode('9'))
    expect(await getChangeCount(session_id)).to.equal(1)
    expect(await getUndoCount(session_id)).to.equal(3)

    change_id = await undo(session_id, stats)
    expect(change_id).to.equal(-1)
    expect(stats.undo_count).to.equal(4)
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(0)
    expect(await getSegment(session_id, 0, file_size)).to.be.empty
    expect(await getChangeCount(session_id)).to.equal(0)
    expect(await getUndoCount(session_id)).to.equal(4)

    // Try undo when there is nothing left to undo
    undo(session_id, stats).catch((e) => {
      expect(e).to.be.an('error').with.property('message', 'Error: undo failed')
      expect(stats.undo_count).to.equal(4)
      expect(stats.error_count).to.equal(1)
    })
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(0)
    expect(await getSegment(session_id, 0, file_size)).to.be.empty
    expect(await getChangeCount(session_id)).to.equal(0)
    expect(await getUndoCount(session_id))
      .to.equal(4)
      .and.to.equal(stats.undo_count)

    change_id = await redo(session_id, stats)
    expect(change_id).to.equal(1)
    expect(stats.redo_count).to.equal(1)
    expect(stats.undo_count).to.equal(4)
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(1)
    expect(await getSegment(session_id, 0, file_size)).deep.equals(encode('9'))
    expect(await getChangeCount(session_id)).to.equal(1)
    expect(await getUndoCount(session_id)).to.equal(3)

    change_id = await redo(session_id, stats)
    expect(change_id).to.equal(2)
    expect(stats.redo_count).to.equal(2)
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(3)
    expect(await getSegment(session_id, 0, file_size)).deep.equals(
      encode('789')
    )
    expect(await getChangeCount(session_id)).to.equal(2)
    expect(await getUndoCount(session_id)).to.equal(2)

    change_id = await insert(session_id, 0, '0123456')
    expect(change_id).to.equal(3)
    expect(await getChangeCount(session_id)).to.equal(3)
    expect(await getUndoCount(session_id)).to.equal(0)
    file_size = await getComputedFileSize(session_id)
    expect(file_size).to.equal(10)
    segment = await getSegment(session_id, 0, file_size)
    expect(segment).deep.equals(encode('0123456789'))

    // Try redo when there is noting left to redo
    redo(session_id, stats).catch((e) => {
      expect(e).to.be.an('error').with.property('message', 'Error: redo failed')
      expect(stats.redo_count).to.equal(2)
      expect(stats.error_count).to.equal(2)
    })
    expect(await getChangeCount(session_id)).to.equal(3)
    expect(await getUndoCount(session_id)).to.equal(0)

    // Test file saving and reading into a new session
    const save_file_name = await saveSession(
      session_id,
      'save_session_test',
      true
    )
    expect(save_file_name.endsWith('save_session_test'))
    expect(await getSessionCount()).to.equal(1)
    const session_id_2 = await createSession(
      save_file_name,
      'verify_save_session'
    )
    expect(await getSessionCount()).to.equal(2)
    expect(session_id_2).to.equal('verify_save_session')
    file_size = await getComputedFileSize(session_id_2)
    expect(file_size).to.equal(10)
    segment = await getSegment(session_id_2, 0, file_size)
    expect(segment).deep.equals(encode('0123456789'))
    const destroyed_session = await destroySession(session_id_2)
    expect(destroyed_session).to.equal(session_id_2)
    expect(await getSessionCount()).to.equal(1)

    // remove test file
    unlinkSync(save_file_name)

    // test clearing changes from a session
    expect(await getChangeCount(session_id)).to.equal(3)
    expect(await getUndoCount(session_id)).to.equal(0)
    change_id = await undo(session_id)
    expect(change_id).to.equal(-3)
    expect(await getChangeCount(session_id)).to.equal(2)
    expect(await getUndoCount(session_id)).to.equal(1)
    const cleared_session_id = await clear(session_id, stats)
    expect(cleared_session_id).to.equal(session_id)
    expect(stats.clear_count).to.equal(1)
    expect(await getChangeCount(session_id)).to.equal(0)
    expect(await getUndoCount(session_id)).to.equal(0)
  })
})
