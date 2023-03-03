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
  numAscii,
  profileSession,
} from '../../src/session'
import { overwrite } from '../../src/change'

// prettier-ignore
// @ts-ignore
import { createTestSession, destroyTestSession, testPort } from './common'

describe('Profiling', () => {
  let session_id = ''

  beforeEach('Create a new session', async () => {
    session_id = await createTestSession(testPort)
  })

  afterEach('Destroy session', async () => {
    await destroyTestSession(session_id)
  })

  describe('Profiler', () => {
    it('Should profile an empty session', async () => {
      expect(await getComputedFileSize(session_id)).to.equal(0)
      profileSession(session_id, 0, 0).then((profile) => {
        expect(profile.length).to.equal(256)
        expect(
          profile.reduce((accumulator, current) => {
            return accumulator + current
          }, 0)
        ).to.equal(0)
      })
    })

    it('Should profile character data', async () => {
      const content = 'abaabbbaaaabbbbc'
      const change_id = await overwrite(session_id, 0, Buffer.from(content))
      expect(change_id).to.be.a('number').that.equals(1)
      const file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(content.length)
      let profile = await profileSession(session_id, 0, 0)
      expect(profile.length).to.equal(256)
      expect(
        profile.reduce((accumulator, current) => {
          return accumulator + current
        }, 0)
      ).to.equal(file_size)
      expect(numAscii(profile)).to.equal(file_size)
      expect(profile['a'.charCodeAt(0)]).to.equal(7)
      expect(profile['b'.charCodeAt(0)]).to.equal(8)
      expect(profile['c'.charCodeAt(0)]).to.equal(1)
      expect(profile['d'.charCodeAt(0)]).to.equal(0)
      profile = await profileSession(session_id, 1, 10)
      expect(profile.length).to.equal(256)
      expect(
        profile.reduce((accumulator, current) => {
          return accumulator + current
        }, 0)
      ).to.equal(10)
      expect(profile['a'.charCodeAt(0)]).to.equal(6)
      expect(profile['b'.charCodeAt(0)]).to.equal(4)
      expect(profile['c'.charCodeAt(0)]).to.equal(0)
      expect(profile['d'.charCodeAt(0)]).to.equal(0)
    })
    it('Should profile binary data', async () => {
      const content = new Uint8Array([0, 0, 1, 1, 1, 2, 2, 1, 3, 0, 255])
      const change_id = await overwrite(session_id, 0, content)
      expect(change_id).to.be.a('number').that.equals(1)
      const file_size = await getComputedFileSize(session_id)
      expect(file_size).equals(content.length)
      let profile = await profileSession(session_id, 0, 0)
      expect(profile.length).to.equal(256)
      expect(
        profile.reduce((accumulator, current) => {
          return accumulator + current
        }, 0)
      ).to.equal(file_size)
      expect(numAscii(profile)).to.equal(file_size - 1)
      expect(profile[0]).to.equal(3)
      expect(profile[1]).to.equal(4)
      expect(profile[2]).to.equal(2)
      expect(profile[3]).to.equal(1)
      expect(profile[255]).to.equal(1)
      expect(profile[123]).to.equal(0)
      profile = await profileSession(session_id, 4, file_size - 8)
      expect(profile.length).to.equal(256)
      expect(
        profile.reduce((accumulator, current) => {
          return accumulator + current
        }, 0)
      ).to.equal(file_size - 8)
      expect(profile[0]).to.equal(0)
      expect(profile[1]).to.equal(1)
      expect(profile[2]).to.equal(2)
      expect(profile[3]).to.equal(0)
      expect(profile[255]).to.equal(0)
      expect(profile[123]).to.equal(0)
    })
  })
})
