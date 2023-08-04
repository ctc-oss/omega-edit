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
  createViewport,
  destroySession,
  getClient,
  getComputedFileSize,
  getSegment,
  getServerHeartbeat,
  getSessionCount,
  getViewportCount,
  insert,
  IOFlags,
  notifyChangedViewports,
  profileSession,
  saveSession,
  SaveStatus,
  waitForReady,
} from '@omega-edit/client'
// @ts-ignore
import { testPort } from './common'
import * as fs from 'fs'
import * as path from 'path'

function base64Encode(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64')
}

function countMatchingFilesInDir(
  dirPath: string,
  pattern: string
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    fs.readdir(dirPath, (err, files) => {
      if (err) {
        reject(err)
      } else {
        const matchingFiles = files.filter((file) => file.match(pattern))
        resolve(matchingFiles.length)
      }
    })
  })
}

function removeDirectory(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath)
    for (const file of files) {
      const filePath = path.join(dirPath, file)
      const stats = fs.statSync(filePath)
      if (stats.isDirectory()) {
        removeDirectory(filePath)
      } else {
        fs.unlinkSync(filePath)
      }
    }
    fs.rmdirSync(dirPath)
  }
}

function touch(filePath: string) {
  const time = new Date()
  fs.utimesSync(filePath, time, time)
}

describe('Sessions', () => {
  const iterations = 500
  const testFile = require('path').join(__dirname, 'data', 'csstest.html')
  const save1 = require('path').join(__dirname, 'data', 'csstest-1.html')
  const checkpointDir = require('path').join(__dirname, 'data', 'checkpoint')
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
      const session = await createSession(testFile)
      const session_id = session.getSessionId()
      expect(session_id).to.equal(expected_session_id)
      expect(session.hasContentType()).to.be.true
      expect(session.getContentType()).to.equal('text/html')
      expect(session.hasFileSize()).to.be.true
      expect(session.getFileSize()).to.equal(fileData.length)
      expect(await getSessionCount()).to.equal(1)
      expect(fileData.length).to.equal(await getComputedFileSize(session_id))
      const vpt_response = await createViewport(
        undefined,
        session_id,
        0,
        1000,
        false
      )
      expect(await getViewportCount(session_id)).to.equal(1)
      expect(vpt_response.getData_asU8()).to.deep.equal(fileBuffer)
      const serverHeartbeat = await getServerHeartbeat([session_id])
      expect(serverHeartbeat.latency).to.be.greaterThanOrEqual(0)
      expect(await profileSession(session_id)).to.deep.equal(expected_profile)
      expect(await notifyChangedViewports(session_id)).to.equal(0)
      await destroySession(session_id)
      expect(await getSessionCount()).to.equal(0)
    }
  })

  it('Should fail to create session with invalid file', async () => {
    expect(await waitForReady(getClient(testPort))).to.be.true
    try {
      await createSession('-invalid-')
      expect.fail('Should have thrown')
    } catch (e) {
      // expected
    }
  })

  it('Should be able to use a different checkpoint directory', async () => {
    removeDirectory(checkpointDir)
    expect(fs.existsSync(checkpointDir)).to.be.false
    expect(await waitForReady(getClient(testPort))).to.be.true
    const session = await createSession(
      testFile,
      'checkpoint_test',
      checkpointDir
    )
    const session_id = session.getSessionId()
    expect(session_id).to.equal('checkpoint_test')
    expect(session.getCheckpointDirectory()).to.equal(checkpointDir)
    expect(await getSessionCount()).to.equal(1)
    expect(fileData.length).to.equal(await getComputedFileSize(session_id))
    expect(fs.existsSync(checkpointDir)).to.be.true
    expect(
      await countMatchingFilesInDir(checkpointDir, '.OmegaEdit-orig.*')
    ).to.equal(1)
    await destroySession(session_id)
    expect(await getSessionCount()).to.equal(0)
    expect(fs.existsSync(checkpointDir)).to.be.true
    expect(
      await countMatchingFilesInDir(checkpointDir, '.OmegaEdit-orig.*')
    ).to.equal(0)
    removeDirectory(checkpointDir)
    expect(fs.existsSync(checkpointDir)).to.be.false
  })

  it('Should be able to handle different save flags', async () => {
    const session = await createSession(testFile, 'save_flags_test')
    const session_id = session.getSessionId()
    expect(session_id).to.equal('save_flags_test')
    if (fs.existsSync(save1)) fs.unlinkSync(save1)
    const save_session_response = await saveSession(
      session_id,
      testFile,
      IOFlags.IO_FLG_NONE
    )
    // No flags will succeed because the file will be saved to a new file
    // created by the server
    expect(save_session_response.getSaveStatus()).to.equal(SaveStatus.SUCCESS)
    expect(save_session_response.getFilePath()).to.equal(save1)
    fs.unlinkSync(save_session_response.getFilePath())

    // touch the original file to simulate an out-of-band change
    touch(testFile)

    const save_session_response2 = await saveSession(
      session_id,
      testFile,
      IOFlags.IO_FLG_OVERWRITE
    )
    // Overwrite alone should fail because the file was modified out-of-band
    expect(save_session_response2.getSaveStatus()).to.equal(SaveStatus.MODIFIED)
    expect(save_session_response2.getFilePath().length).to.equal(0)

    const save_session_response3 = await saveSession(
      session_id,
      testFile,
      IOFlags.IO_FLG_FORCE_OVERWRITE
    )
    // Force overwrite should succeed even if the original file was modified
    // out-of-band
    expect(save_session_response3.getSaveStatus()).to.equal(SaveStatus.SUCCESS)
    expect(save_session_response3.getFilePath()).to.equal(testFile)

    // test 2 back-to-back overwrites
    const save_session_response4 = await saveSession(
      session_id,
      testFile,
      IOFlags.IO_FLG_OVERWRITE
    )
    expect(save_session_response4.getSaveStatus()).to.equal(SaveStatus.SUCCESS)
    expect(save_session_response4.getFilePath()).to.equal(testFile)

    const save_session_response5 = await saveSession(
      session_id,
      testFile,
      IOFlags.IO_FLG_OVERWRITE
    )
    expect(save_session_response5.getSaveStatus()).to.equal(SaveStatus.SUCCESS)
    expect(save_session_response5.getFilePath()).to.equal(testFile)

    await destroySession(session_id)
    expect(await getSessionCount()).to.equal(0)
  })

  it('Should be able to handle multiple simultaneous sessions', async () => {
    const session1 = await createSession()
    const session_id1 = session1.getSessionId()
    const session2 = await createSession()
    const session_id2 = session2.getSessionId()
    expect(session_id1).to.not.equal(session_id2)
    expect(session1.hasContentType()).to.be.false
    expect(session1.hasFileSize()).to.be.false

    let change_id = await insert(session_id1, 0, Buffer.from('a'))
    expect(change_id).to.equal(1)
    change_id = await insert(session_id2, 0, Buffer.from('1'))
    expect(change_id).to.equal(1)

    change_id = await insert(session_id1, 0, Buffer.from('b'))
    expect(change_id).to.equal(2)
    change_id = await insert(session_id2, 0, Buffer.from('2'))
    expect(change_id).to.equal(2)

    change_id = await insert(session_id1, 0, Buffer.from('c'))
    expect(change_id).to.equal(3)
    change_id = await insert(session_id2, 0, Buffer.from('3'))
    expect(change_id).to.equal(3)

    expect(
      await getSegment(session_id1, 0, await getComputedFileSize(session_id1))
    ).to.deep.equal(Buffer.from('cba'))
    expect(
      await getSegment(session_id2, 0, await getComputedFileSize(session_id2))
    ).to.deep.equal(Buffer.from('321'))

    expect(await getSessionCount()).to.equal(2)
    await destroySession(session_id1)
    expect(await getSessionCount()).to.equal(1)
    await destroySession(session_id2)
    expect(await getSessionCount()).to.equal(0)
  })
})
