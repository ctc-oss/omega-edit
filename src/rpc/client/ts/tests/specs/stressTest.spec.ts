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
  del,
  getChangeCount,
  insert,
  overwrite,
  redo,
  undo,
} from '../../src/change'
import {
  getComputedFileSize,
  pauseSessionChanges,
  resumeSessionChanges,
} from '../../src/session'
import {
  createViewport,
  destroyViewport,
  getViewportData,
} from '../../src/viewport'
import { decode, encode } from 'fastestsmallesttextencoderdecoder'
import { cleanup, custom_setup } from './common'

const deadline = new Date()
deadline.setSeconds(deadline.getSeconds() + 10)

describe('StressTest', () => {
  const full_rotations = 10
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await custom_setup()
  })

  afterEach('Destroy session', async () => {
    await cleanup(session_id)
  })

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
      await insert(session_id, 0, data).catch((e) =>
        expect(e).to.be.an('error').with.property('message', 'insert failed')
      )
      await resumeSessionChanges(session_id)
      expect(data.length).to.equal(await getComputedFileSize(session_id))

      const viewport_id = await createViewport(
        'last_byte_vpt',
        session_id,
        file_size - 1,
        1,
        false
      )
      const viewport_2_id = await createViewport(
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
      }

      expect(await getChangeCount(session_id)).to.equal(change_id)
      expect(expected_num_changes).to.equal(change_id)

      viewport_data = await getViewportData(viewport_2_id)

      expect(data).to.deep.equal(viewport_data.getData_asU8())
      expect(viewport_id).to.equal(await destroyViewport(viewport_id))
      expect(viewport_2_id).to.equal(await destroyViewport(viewport_2_id))
      expect(file_size).to.equal(await getComputedFileSize(session_id))
    }
  ).timeout(10000 * full_rotations)
})
