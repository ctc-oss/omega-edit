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
// @ts-ignore
import { cleanup, custom_setup } from './common'
import { EventSubscriptionRequest } from '../../src/omega_edit_pb'
import { ALL_EVENTS, getClient } from '../../src/settings'

let session_callbacks = new Map()

async function subscribeSession(
  session_id: string,
  interest?: number
): Promise<string> {
  let subscriptionRequest = new EventSubscriptionRequest().setId(session_id)
  if (interest) {
    subscriptionRequest.setInterest(interest)
  }
  getClient()
    .subscribeToSessionEvents(subscriptionRequest)
    .on('data', () => {
      session_callbacks.set(
        session_id,
        session_callbacks.has(session_id)
          ? 1 + session_callbacks.get(session_id)
          : 1
      )
    })
  return session_id
}

let viewport_callbacks = new Map()

async function subscribeViewport(
  viewport_id: string,
  interest?: number
): Promise<string> {
  let subscriptionRequest = new EventSubscriptionRequest().setId(viewport_id)
  if (interest) {
    subscriptionRequest.setInterest(interest)
  }
  getClient()
    .subscribeToViewportEvents(subscriptionRequest)
    .on('data', () => {
      viewport_callbacks.set(
        viewport_id,
        viewport_callbacks.has(viewport_id)
          ? 1 + viewport_callbacks.get(viewport_id)
          : 1
      )
    })
  return viewport_id
}

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
      await subscribeSession(session_id, ALL_EVENTS)
      let change_id = await insert(session_id, 0, data)

      expect(change_id).to.equal(1)
      const file_size = await getComputedFileSize(session_id)
      expect(file_size).to.equal(data.length)

      await pauseSessionChanges(session_id)
      await insert(session_id, 0, data).catch((e) =>
        expect(e).to.be.an('error').with.property('message', 'insert failed')
      )
      await resumeSessionChanges(session_id)
      expect(await getComputedFileSize(session_id)).to.equal(data.length)

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
      await subscribeViewport(viewport_id, ALL_EVENTS)
      await subscribeViewport(viewport_2_id, ALL_EVENTS)
      let viewport_data = await getViewportData(viewport_id)

      expect(decode(viewport_data.getData_asU8())).to.equal('~')

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

      expect(change_id)
        .to.equal(await getChangeCount(session_id))
        .and.to.equal(expected_num_changes)

      viewport_data = await getViewportData(viewport_2_id)

      expect(viewport_data.getData_asU8()).to.deep.equal(data)
      expect(await destroyViewport(viewport_id)).to.equal(viewport_id)
      expect(await destroyViewport(viewport_2_id)).to.equal(viewport_2_id)
      expect(await getComputedFileSize(session_id)).to.equal(file_size)

      // TODO: Create tests for these counts
      console.log(session_callbacks)
      console.log(viewport_callbacks)
    }
  ).timeout(10000 * full_rotations)
})
