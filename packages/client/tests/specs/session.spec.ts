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

import { expect, testPort } from './common.js'
import {
  del,
  countCharacters,
  createSession,
  createSessionFromBytes,
  createViewport,
  destroySession,
  getByteOrderMark,
  getClient,
  getChangeCount,
  getComputedFileSize,
  getContentType,
  getLanguage,
  getSegment,
  getSessionBytes,
  getServerHeartbeat,
  getSessionCount,
  getViewportData,
  getViewportCount,
  insert,
  IOFlags,
  notifyChangedViewports,
  profileSession,
  saveSession,
  SaveStatus,
} from '@omega-edit/client'
import * as fs from 'fs'
import * as path from 'path'
import { getModuleCompat } from './moduleCompat.js'

const { __dirname } = getModuleCompat(import.meta.url)

function base64Encode(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url')
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
  const emptyFile = path.join(__dirname, 'data', 'empty.txt')
  const oneByteFile = path.join(__dirname, 'data', '1-byte.txt')
  const twoByteFile = path.join(__dirname, 'data', '2-bytes.txt')
  const testFile = path.join(__dirname, 'data', 'csstest.html')
  const save1 = path.join(__dirname, 'data', 'csstest-1.html')
  const checkpointDir = path.join(__dirname, 'data', 'checkpoint')
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
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]

  it(`Should read an empty file ${emptyFile}`, async () => {
    expect(await getClient(testPort)).to.not.be.undefined
    expect(await getSessionCount()).to.equal(0)
    const session = await createSession(emptyFile)
    const session_id = session.getSessionId()
    expect(session_id).to.equal(base64Encode(emptyFile))
    expect(await getSessionCount()).to.equal(1)
    expect(session.getFileSize()).to.equal(0)
    expect(await getComputedFileSize(session_id)).to.equal(0)
    expect(await getViewportCount(session_id)).to.equal(0)
    const viewportResponse = await createViewport(
      undefined,
      session_id,
      0,
      10,
      false
    )
    expect(await getViewportCount(session_id)).to.equal(1)
    expect(viewportResponse.getData_asU8().length).to.equal(0)
    expect(await destroySession(session_id)).to.equal(session_id)
    expect(await getSessionCount()).to.equal(0)
  })

  it(`Should read a one-byte file ${oneByteFile}`, async () => {
    expect(await getClient(testPort)).to.not.be.undefined
    expect(await getSessionCount()).to.equal(0)
    const session = await createSession(oneByteFile)
    const session_id = session.getSessionId()
    expect(session_id).to.equal(base64Encode(oneByteFile))
    expect(await getSessionCount()).to.equal(1)
    expect(session.getFileSize()).to.equal(1)
    expect(await getComputedFileSize(session_id)).to.equal(1)
    expect(await getViewportCount(session_id)).to.equal(0)
    const viewportResponse = await createViewport(
      undefined,
      session_id,
      0,
      10,
      false
    )
    expect(await getViewportCount(session_id)).to.equal(1)
    expect(viewportResponse.getData_asU8()).to.deep.equal(Buffer.from('1'))
    expect(await destroySession(session_id)).to.equal(session_id)
    expect(await getSessionCount()).to.equal(0)
  })

  it(`Should read a two-byte file ${twoByteFile}`, async () => {
    expect(await getClient(testPort)).to.not.be.undefined
    expect(await getSessionCount()).to.equal(0)
    const session = await createSession(twoByteFile)
    const session_id = session.getSessionId()
    expect(session_id).to.equal(base64Encode(twoByteFile))
    expect(await getSessionCount()).to.equal(1)
    expect(session.getFileSize()).to.equal(2)
    expect(await getComputedFileSize(session_id)).to.equal(2)
    expect(await getViewportCount(session_id)).to.equal(0)
    const viewportResponse = await createViewport(
      undefined,
      session_id,
      0,
      10,
      false
    )
    expect(await getViewportCount(session_id)).to.equal(1)
    expect(viewportResponse.getData_asU8()).to.deep.equal(Buffer.from('12'))
    expect(await destroySession(session_id)).to.equal(session_id)
    expect(await getSessionCount()).to.equal(0)
  })

  it(`Should read test file ${testFile} (${iterations} times)`, async () => {
    expect(fileData.length).to.equal(464)
    expect(fileBuffer.length).to.equal(464)
    expect(await getClient(testPort)).to.not.be.undefined
    expect(await getSessionCount()).to.equal(0)
    for (let i = 0; i < iterations; ++i) {
      const session = await createSession(testFile)
      const session_id = session.getSessionId()
      expect(session_id).to.equal(expected_session_id)
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

  it('Should allow multiple authors to share a file-backed session', async () => {
    expect(await getSessionCount()).to.equal(0)

    const author1 = await createSession(testFile)
    const author2 = await createSession(testFile)
    const author1SessionId = author1.getSessionId()
    const author2SessionId = author2.getSessionId()
    const expectedSharedData = Buffer.concat([fileBuffer, Buffer.from('A2A1')])

    expect(author1SessionId).to.equal(expected_session_id)
    expect(author2SessionId).to.equal(author1SessionId)
    expect(author1.getFileSize()).to.equal(fileData.length)
    expect(author2.getFileSize()).to.equal(fileData.length)
    expect(await getSessionCount()).to.equal(1)

    const viewport1 = await createViewport(
      'shared-author-1',
      author1SessionId,
      0,
      1000,
      false
    )
    const viewport2 = await createViewport(
      'shared-author-2',
      author2SessionId,
      0,
      1000,
      false
    )

    expect(await getViewportCount(author1SessionId)).to.equal(2)
    expect(viewport1.getData_asU8()).to.deep.equal(fileBuffer)
    expect(viewport2.getData_asU8()).to.deep.equal(fileBuffer)

    await insert(author1SessionId, fileData.length, Buffer.from('A1'))
    await insert(author2SessionId, fileData.length, Buffer.from('A2'))

    expect(await getChangeCount(author1SessionId)).to.equal(2)
    expect(await getComputedFileSize(author1SessionId)).to.equal(
      fileData.length + 4
    )
    expect(
      (await getViewportData(viewport1.getViewportId())).getData_asU8()
    ).to.deep.equal(expectedSharedData)
    expect(
      (await getViewportData(viewport2.getViewportId())).getData_asU8()
    ).to.deep.equal(expectedSharedData)

    expect(await destroySession(author1SessionId)).to.equal(author1SessionId)
    expect(await getSessionCount()).to.equal(1)
    expect(await getViewportCount(author2SessionId)).to.equal(2)
    expect(await getComputedFileSize(author2SessionId)).to.equal(
      fileData.length + 4
    )
    expect(
      (await getViewportData(viewport2.getViewportId())).getData_asU8()
    ).to.deep.equal(expectedSharedData)

    expect(await destroySession(author2SessionId)).to.equal(author2SessionId)
    expect(await getSessionCount()).to.equal(0)
  })

  it('Should be able to save segments from a session', async () => {
    const session = await createSession()
    const session_id = session.getSessionId()

    await insert(session_id, 0, Buffer.from('0123456789'))
    expect(await getComputedFileSize(session_id)).to.equal(10)
    expect(await getSegment(session_id, 0, 10)).to.deep.equal(
      Buffer.from('0123456789')
    )

    // save various segments of the session to different files
    let saveFile = path.join(__dirname, 'data', 'save-seg.1.dat')
    await saveSession(session_id, saveFile, IOFlags.IO_FLG_OVERWRITE, 1, 8)
    let verify_session = await createSession(saveFile)
    let expected = Buffer.from('12345678')
    let verify_session_id = verify_session.getSessionId()
    expect(await getComputedFileSize(verify_session_id)).to.equal(
      expected.length
    )
    expect(
      await getSegment(verify_session_id, 0, expected.length)
    ).to.deep.equal(expected)
    await destroySession(verify_session_id)
    fs.unlinkSync(saveFile)

    saveFile = path.join(__dirname, 'data', 'save-seg.2.dat')
    await saveSession(session_id, saveFile, IOFlags.IO_FLG_OVERWRITE, 2, 6)
    verify_session = await createSession(saveFile)
    expected = Buffer.from('234567')
    verify_session_id = verify_session.getSessionId()
    expect(await getComputedFileSize(verify_session_id)).to.equal(
      expected.length
    )
    expect(
      await getSegment(verify_session_id, 0, expected.length)
    ).to.deep.equal(expected)
    await destroySession(verify_session_id)
    fs.unlinkSync(saveFile)

    saveFile = path.join(__dirname, 'data', 'save-seg.3.dat')
    await saveSession(session_id, saveFile, IOFlags.IO_FLG_OVERWRITE, 3, 0)
    verify_session = await createSession(saveFile)
    expected = Buffer.from('3456789')
    verify_session_id = verify_session.getSessionId()
    expect(await getComputedFileSize(verify_session_id)).to.equal(
      expected.length
    )
    expect(
      await getSegment(verify_session_id, 0, expected.length)
    ).to.deep.equal(expected)
    await destroySession(verify_session_id)
    fs.unlinkSync(saveFile)

    saveFile = path.join(__dirname, 'data', 'save-seg.4.dat')
    await saveSession(session_id, saveFile, IOFlags.IO_FLG_OVERWRITE, 0, 100)
    verify_session = await createSession(saveFile)
    expected = Buffer.from('0123456789')
    verify_session_id = verify_session.getSessionId()
    expect(await getComputedFileSize(verify_session_id)).to.equal(
      expected.length
    )
    expect(
      await getSegment(verify_session_id, 0, expected.length)
    ).to.deep.equal(expected)
    await destroySession(verify_session_id)
    fs.unlinkSync(saveFile)

    saveFile = path.join(__dirname, 'data', 'save-seg.5.dat')
    await saveSession(session_id, saveFile, IOFlags.IO_FLG_OVERWRITE)
    verify_session = await createSession(saveFile)
    expected = Buffer.from('0123456789')
    verify_session_id = verify_session.getSessionId()
    expect(await getComputedFileSize(verify_session_id)).to.equal(
      expected.length
    )
    expect(
      await getSegment(verify_session_id, 0, expected.length)
    ).to.deep.equal(expected)
    await destroySession(verify_session_id)
    fs.unlinkSync(saveFile)

    await destroySession(session_id)
    expect(await getSessionCount()).to.equal(0)
  })

  it('Should be able to detect byte order marks', async () => {
    let testFile = path.join(__dirname, 'data', 'empty.txt')
    let session = await createSession(testFile)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek.txt')
    session = await createSession(testFile)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek-UTF8BOM.txt')
    session = await createSession(testFile)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek-UTF16BE.txt')
    session = await createSession(testFile)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek-UTF16LE.txt')
    session = await createSession(testFile)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek-UTF32BE.txt')
    session = await createSession(testFile)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek-UTF32LE.txt')
    session = await createSession(testFile)
    await destroySession(session.getSessionId())

    expect(await getSessionCount()).to.equal(0)
  })

  it('Should be able to detect various languages', async () => {
    let testFile = path.join(__dirname, 'data', 'arabic.txt')
    let session = await createSession(testFile)
    let fileSize = await getComputedFileSize(session.getSessionId())
    let byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    let charCounts = await countCharacters(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(charCounts.getByteOrderMark()).to.equal('none')
    expect(charCounts.getSessionId()).to.equal(session.getSessionId())
    expect(charCounts.getOffset()).to.equal(0)
    expect(charCounts.getLength()).to.equal(fileSize)
    expect(charCounts.getByteOrderMarkBytes()).to.equal(0)
    expect(charCounts.getSingleByteChars()).to.equal(7)
    expect(charCounts.getDoubleByteChars()).to.equal(35)
    expect(charCounts.getTripleByteChars()).to.equal(0)
    expect(charCounts.getQuadByteChars()).to.equal(0)
    expect(charCounts.getInvalidBytes()).to.equal(0)
    let languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('ar')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'chinese.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('zh-CN')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'dutch.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('nl')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'english.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('en')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'french.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('fr')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'german.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('de')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('el')
    charCounts = await countCharacters(
      session.getSessionId(),
      0,
      await getComputedFileSize(session.getSessionId())
    )
    expect(charCounts.getByteOrderMark()).to.equal('none')
    expect(charCounts.getSessionId()).to.equal(session.getSessionId())
    expect(charCounts.getOffset()).to.equal(0)
    expect(charCounts.getLength()).to.equal(fileSize)
    expect(charCounts.getByteOrderMarkBytes()).to.equal(0)
    expect(charCounts.getSingleByteChars()).to.equal(10)
    expect(charCounts.getDoubleByteChars()).to.equal(46)
    expect(charCounts.getTripleByteChars()).to.equal(0)
    expect(charCounts.getQuadByteChars()).to.equal(0)
    expect(charCounts.getInvalidBytes()).to.equal(0)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek-UTF8BOM.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('UTF-8')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('el')
    charCounts = await countCharacters(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(charCounts.getByteOrderMark()).to.equal('UTF-8')
    expect(charCounts.getByteOrderMarkBytes()).to.equal(3)
    expect(charCounts.getSessionId()).to.equal(session.getSessionId())
    expect(charCounts.getOffset()).to.equal(0)
    expect(charCounts.getLength()).to.equal(fileSize)
    expect(charCounts.getSingleByteChars()).to.equal(10)
    expect(charCounts.getDoubleByteChars()).to.equal(46)
    expect(charCounts.getTripleByteChars()).to.equal(0)
    expect(charCounts.getQuadByteChars()).to.equal(0)
    expect(charCounts.getInvalidBytes()).to.equal(0)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek-UTF16LE.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('UTF-16LE')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('el')
    charCounts = await countCharacters(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(charCounts.getByteOrderMark()).to.equal('UTF-16LE')
    expect(charCounts.getSessionId()).to.equal(session.getSessionId())
    expect(charCounts.getOffset()).to.equal(0)
    expect(charCounts.getLength()).to.equal(fileSize)
    expect(charCounts.getByteOrderMarkBytes()).to.equal(2)
    expect(charCounts.getSingleByteChars()).to.equal(10)
    expect(charCounts.getDoubleByteChars()).to.equal(46)
    expect(charCounts.getTripleByteChars()).to.equal(0)
    expect(charCounts.getQuadByteChars()).to.equal(0)
    expect(charCounts.getInvalidBytes()).to.equal(0)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek-UTF16BE.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('UTF-16BE')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('el')
    charCounts = await countCharacters(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(charCounts.getByteOrderMark()).to.equal('UTF-16BE')
    expect(charCounts.getSessionId()).to.equal(session.getSessionId())
    expect(charCounts.getOffset()).to.equal(0)
    expect(charCounts.getLength()).to.equal(fileSize)
    expect(charCounts.getByteOrderMarkBytes()).to.equal(2)
    expect(charCounts.getSingleByteChars()).to.equal(10)
    expect(charCounts.getDoubleByteChars()).to.equal(46)
    expect(charCounts.getTripleByteChars()).to.equal(0)
    expect(charCounts.getQuadByteChars()).to.equal(0)
    expect(charCounts.getInvalidBytes()).to.equal(0)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek-UTF32LE.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('UTF-32LE')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('el')
    charCounts = await countCharacters(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(charCounts.getByteOrderMark()).to.equal('UTF-32LE')
    expect(charCounts.getSessionId()).to.equal(session.getSessionId())
    expect(charCounts.getOffset()).to.equal(0)
    expect(charCounts.getByteOrderMarkBytes()).to.equal(4)
    expect(charCounts.getLength()).to.equal(fileSize)
    expect(charCounts.getSingleByteChars()).to.equal(10)
    expect(charCounts.getDoubleByteChars()).to.equal(0)
    expect(charCounts.getTripleByteChars()).to.equal(0)
    expect(charCounts.getQuadByteChars()).to.equal(46)
    expect(charCounts.getInvalidBytes()).to.equal(0)

    // force character frame misalignment by starting at an offset not divisible
    // by four and force invalid bytes by requesting a partial character
    charCounts = await countCharacters(
      session.getSessionId(),
      2,
      fileSize - 4,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(charCounts.getByteOrderMark()).to.equal('UTF-32LE')
    expect(charCounts.getSessionId()).to.equal(session.getSessionId())
    expect(charCounts.getOffset()).to.equal(2)
    expect(charCounts.getByteOrderMarkBytes()).to.equal(0)
    expect(charCounts.getLength()).to.equal(fileSize - 4)
    expect(charCounts.getSingleByteChars()).to.equal(0)
    expect(charCounts.getDoubleByteChars()).to.equal(0)
    expect(charCounts.getTripleByteChars()).to.equal(0)
    expect(charCounts.getQuadByteChars()).to.equal(55)
    expect(charCounts.getInvalidBytes()).to.equal(4) // two at the beginning and two at the end
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'greek-UTF32BE.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('UTF-32BE')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('el')
    charCounts = await countCharacters(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(charCounts.getByteOrderMark()).to.equal('UTF-32BE')
    expect(charCounts.getSessionId()).to.equal(session.getSessionId())
    expect(charCounts.getOffset()).to.equal(0)
    expect(charCounts.getLength()).to.equal(fileSize)
    expect(charCounts.getByteOrderMarkBytes()).to.equal(4)
    expect(charCounts.getSingleByteChars()).to.equal(10)
    expect(charCounts.getDoubleByteChars()).to.equal(0)
    expect(charCounts.getTripleByteChars()).to.equal(0)
    expect(charCounts.getQuadByteChars()).to.equal(46)
    expect(charCounts.getInvalidBytes()).to.equal(0)
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'hindi.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('hi')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'italian.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('it')
    await destroySession(session.getSessionId())

    // The short Japanese file is not long enough to be detected as Japanese
    testFile = path.join(__dirname, 'data', 'japanese-short.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('unknown')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'japanese.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('ja')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'korean.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('ko')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'portuguese.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('pt')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'russian.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('ru')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'spanish.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('es')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'swedish.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('sv')
    await destroySession(session.getSessionId())

    testFile = path.join(__dirname, 'data', 'empty.txt')
    session = await createSession(testFile)
    fileSize = await getComputedFileSize(session.getSessionId())
    byteOrderMarkResponse = await getByteOrderMark(session.getSessionId())
    expect(byteOrderMarkResponse.getByteOrderMark()).to.equal('none')
    languageResponse = await getLanguage(
      session.getSessionId(),
      0,
      fileSize,
      byteOrderMarkResponse.getByteOrderMark()
    )
    expect(languageResponse.getLanguage()).to.equal('unknown')
    await destroySession(session.getSessionId())

    expect(await getSessionCount()).to.equal(0)
  })

  it('Should be able to use a different checkpoint directory', async () => {
    removeDirectory(checkpointDir)
    expect(fs.existsSync(checkpointDir)).to.be.false
    expect(await getClient(testPort)).to.not.be.undefined
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

  it('Should only share file-backed sessions when checkpoint directories are compatible', async () => {
    const sharedCheckpointDir = path.join(
      __dirname,
      'data',
      'shared-checkpoint'
    )
    const conflictingCheckpointDir = path.join(
      __dirname,
      'data',
      'conflicting-checkpoint'
    )
    let sharedSessionId = ''

    removeDirectory(sharedCheckpointDir)
    removeDirectory(conflictingCheckpointDir)

    try {
      const author1 = await createSession(testFile, '', sharedCheckpointDir)
      const author2 = await createSession(testFile, '', sharedCheckpointDir)
      sharedSessionId = author1.getSessionId()

      expect(author2.getSessionId()).to.equal(sharedSessionId)
      expect(author1.getCheckpointDirectory()).to.equal(sharedCheckpointDir)
      expect(author2.getCheckpointDirectory()).to.equal(sharedCheckpointDir)
      expect(await getSessionCount()).to.equal(1)
      expect(fs.existsSync(sharedCheckpointDir)).to.be.true
      expect(
        await countMatchingFilesInDir(sharedCheckpointDir, '.OmegaEdit-orig.*')
      ).to.equal(1)

      let conflictingCreateError: Error | undefined
      try {
        await createSession(testFile, '', conflictingCheckpointDir)
        expect.fail(
          'createSession should reject when a shared file-backed session requests a different checkpoint directory'
        )
      } catch (error) {
        conflictingCreateError = error as Error
      }

      expect(conflictingCreateError).to.exist
      expect(conflictingCreateError?.message).to.include('ALREADY_EXISTS')
      expect(await getSessionCount()).to.equal(1)
      expect(fs.existsSync(conflictingCheckpointDir)).to.be.false
    } finally {
      while (sharedSessionId && (await getSessionCount()) > 0) {
        expect(await destroySession(sharedSessionId)).to.equal(sharedSessionId)
      }

      if (fs.existsSync(sharedCheckpointDir)) {
        expect(
          await countMatchingFilesInDir(
            sharedCheckpointDir,
            '.OmegaEdit-orig.*'
          )
        ).to.equal(0)
        removeDirectory(sharedCheckpointDir)
      }
      if (fs.existsSync(conflictingCheckpointDir)) {
        removeDirectory(conflictingCheckpointDir)
      }
    }

    expect(fs.existsSync(sharedCheckpointDir)).to.be.false
    expect(fs.existsSync(conflictingCheckpointDir)).to.be.false
  })

  it('Should create a clean baseline session from bytes', async () => {
    const memoryCheckpointDir = path.join(
      __dirname,
      'data',
      'memory-checkpoint'
    )
    const seed = Buffer.from('memory seed')
    let session_id = ''

    removeDirectory(memoryCheckpointDir)
    expect(fs.existsSync(memoryCheckpointDir)).to.be.false

    try {
      const session = await createSessionFromBytes(
        seed,
        'memory_seed_test',
        memoryCheckpointDir
      )
      session_id = session.getSessionId()

      expect(session_id).to.equal('memory_seed_test')
      expect(session.getCheckpointDirectory()).to.equal(memoryCheckpointDir)
      expect(session.getFileSize()).to.equal(seed.length)
      expect(await getComputedFileSize(session_id)).to.equal(seed.length)
      expect(await getChangeCount(session_id)).to.equal(0)
      expect(await getSessionBytes(session_id)).to.deep.equal(seed)
      expect(await getSessionBytes(session_id, 7, 4)).to.deep.equal(
        Buffer.from('seed')
      )
      expect(
        await countMatchingFilesInDir(memoryCheckpointDir, '.OmegaEdit-bytes.*')
      ).to.equal(1)

      await insert(session_id, seed.length, Buffer.from('!'))
      expect(await getChangeCount(session_id)).to.equal(1)
      expect(await getSessionBytes(session_id)).to.deep.equal(
        Buffer.from('memory seed!')
      )
    } finally {
      if (session_id) {
        await destroySession(session_id)
      }
      if (fs.existsSync(memoryCheckpointDir)) {
        expect(
          await countMatchingFilesInDir(
            memoryCheckpointDir,
            '.OmegaEdit-bytes.*'
          )
        ).to.equal(0)
        removeDirectory(memoryCheckpointDir)
      }
      expect(fs.existsSync(memoryCheckpointDir)).to.be.false
    }
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

    // pause for 1 second because that's the highest resolution supported by
    // Windows file timestamps
    await new Promise((resolve) => setTimeout(resolve, 1000))

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

  it('Should detect text and binary content types', async () => {
    let session = await createSession()
    let session_id = session.getSessionId()

    await insert(session_id, 0, Buffer.from('Hello, World!\n'))
    let fileSize = await getComputedFileSize(session_id)
    expect(fileSize).to.equal(14)

    let contentTypeResponse = await getContentType(session_id, 0, fileSize)
    expect(contentTypeResponse.getContentType()).to.be.a('string').and.not.be
      .empty

    await destroySession(session_id)

    session = await createSession()
    session_id = session.getSessionId()
    await insert(
      session_id,
      0,
      Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
    )

    contentTypeResponse = await getContentType(session_id, 0, 6)
    expect(contentTypeResponse.getContentType()).to.be.a('string').and.not.be
      .empty

    await destroySession(session_id)
  })

  it('Should overwrite existing files when saving edited sessions', async () => {
    const savePath = path.join(__dirname, 'data', 'coverage_save_overwrite.txt')
    if (fs.existsSync(savePath)) fs.unlinkSync(savePath)

    const session = await createSession()
    const session_id = session.getSessionId()

    try {
      await insert(session_id, 0, Buffer.from('save test data'))

      const resp1 = await saveSession(session_id, savePath)
      expect(resp1.getFilePath()).to.be.a('string')

      await insert(session_id, 0, Buffer.from('PREFIX_'))
      const resp2 = await saveSession(
        session_id,
        savePath,
        IOFlags.IO_FLG_OVERWRITE
      )
      expect(resp2.getFilePath()).to.include('coverage_save_overwrite')
      expect(fs.readFileSync(resp2.getFilePath(), 'utf-8')).to.equal(
        'PREFIX_save test data'
      )
    } finally {
      if (fs.existsSync(savePath)) fs.unlinkSync(savePath)
      await destroySession(session_id)
    }
  })

  it('Should be able to handle multiple simultaneous sessions', async () => {
    expect(await getSessionCount()).to.equal(0)
    const session1 = await createSession()
    expect(await getSessionCount()).to.equal(1)
    const session2 = await createSession()
    expect(await getSessionCount()).to.equal(2)

    const session_id1 = session1.getSessionId()
    const session_id2 = session2.getSessionId()
    expect(session_id1).to.not.equal(session_id2)
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

  it('Should isolate edits and change counts across concurrent sessions', async () => {
    const initialCount = await getSessionCount()
    const session1 = await createSession()
    const session1_id = session1.getSessionId()
    const session2 = await createSession()
    const session2_id = session2.getSessionId()

    expect(await getSessionCount()).to.equal(initialCount + 2)

    await insert(session1_id, 0, Buffer.from('Session ONE'))
    await insert(session2_id, 0, Buffer.from('Session TWO'))

    expect(await getComputedFileSize(session1_id)).to.equal(11)
    expect(await getComputedFileSize(session2_id)).to.equal(11)

    const seg1 = await getSegment(session1_id, 0, 11)
    const seg2 = await getSegment(session2_id, 0, 11)
    expect(Buffer.from(seg1).toString('utf-8')).to.equal('Session ONE')
    expect(Buffer.from(seg2).toString('utf-8')).to.equal('Session TWO')

    await del(session1_id, 8, 3)
    expect(await getComputedFileSize(session1_id)).to.equal(8)
    expect(await getComputedFileSize(session2_id)).to.equal(11)

    await insert(session1_id, 8, Buffer.from('ONE'))
    await insert(session1_id, 11, Buffer.from('!'))
    await insert(session2_id, 11, Buffer.from('!'))

    expect(await getChangeCount(session1_id)).to.equal(4)
    expect(await getChangeCount(session2_id)).to.equal(2)

    await destroySession(session1_id)
    await destroySession(session2_id)
    expect(await getSessionCount()).to.equal(initialCount)
  })

  it('Should reject invalid and nonexistent sessions', async () => {
    try {
      await getComputedFileSize('nonexistent-session-id-12345')
      expect.fail('Should have thrown an error')
    } catch (err: any) {
      expect(err).to.exist
    }

    try {
      await destroySession('does-not-exist-99999')
      expect.fail('Should have thrown an error')
    } catch (err: any) {
      expect(err).to.exist
    }
  })

  it('Should fail to create session with invalid file', async () => {
    expect(await getClient(testPort)).to.not.be.undefined
    try {
      await createSession('-invalid-')
      expect.fail('Should have thrown')
    } catch (e) {
      // expected
    }
  })
})
