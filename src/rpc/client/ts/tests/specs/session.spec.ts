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
  getSessionCount,
} from '../../src/session'
// @ts-ignore
import { testPort } from './common'
import * as fs from 'fs'
import { createViewport, getViewportData } from '../../src/viewport'
import { getClient, waitForReady } from '../../src/client'
import { getViewportCount } from '../../src/viewport'
import { profileSession } from '../../src/session'

function base64Encode(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64')
}

describe('Sessions', () => {
  const iterations = 500
  const testFile = require('path').join(__dirname, 'data', 'csstest.html')
  const fileData = fs.readFileSync(testFile)
  const fileBuffer = new Uint8Array(
    fileData.buffer,
    fileData.byteOffset,
    fileData.byteLength
  )
  const expected_session_id = base64Encode(testFile)
  const expected_profile = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 125, 0, 8, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 5, 0, 12, 4,
    5, 4, 3, 0, 0, 0, 0, 0, 0, 5, 5, 23, 6, 23, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 6,
    11, 18, 18, 1, 1, 8, 21, 0, 1, 17, 4, 11, 17, 9, 0, 7, 14, 20, 2, 8, 2, 4,
    6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]

  it(`Should read test file ${testFile} (${iterations} times)`, async () => {
    expect(fileData.length).to.equal(464)
    expect(fileBuffer.length).to.equal(464)
    expect(await waitForReady(getClient(testPort))).to.be.true
    expect(await getSessionCount()).to.equal(0)
    for (let i = 0; i < iterations; ++i) {
      const session_id = await createSession(testFile)
      expect(session_id).to.equal(expected_session_id)
      expect(await getSessionCount()).to.equal(1)
      expect(fileData.length).to.equal(await getComputedFileSize(session_id))
      const vpt_id = await createViewport(undefined, session_id, 0, 1000, false)
      expect(await getViewportCount(session_id)).to.equal(1)
      const dataResponse = await getViewportData(vpt_id)
      expect(dataResponse.getData_asU8()).to.deep.equal(fileBuffer)
      expect(await profileSession(session_id)).to.deep.equal(expected_profile)
      await destroySession(session_id)
      expect(await getSessionCount()).to.equal(0)
    }
  })
})
