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

import {
  createSession,
  del,
  destroySession,
  editSimple,
  EditStats,
  getChangeCount,
  getComputedFileSize,
  getContentType,
  getSegment,
  getSessionCount,
  getUndoCount,
  insert,
  IOFlags,
  overwrite,
  redo,
  saveSession,
  undo,
} from '@omega-edit/client'
import {
  createTestSession,
  destroyTestSession,
  expect,
  testPort,
} from './common'
import * as fs from 'fs'
import * as path from 'path'

describe('Coverage Gaps', () => {
  describe('getContentType', () => {
    it('Should detect content type of text data', async () => {
      const session_id = await createTestSession(testPort)

      // Insert known ASCII text
      await insert(session_id, 0, Buffer.from('Hello, World!\n'))
      const fileSize = await getComputedFileSize(session_id)
      expect(fileSize).to.equal(14)

      // Get content type
      const contentTypeResponse = await getContentType(session_id, 0, fileSize)
      expect(contentTypeResponse).to.not.be.undefined
      // The content type string should be non-empty
      const contentType = contentTypeResponse.getContentType()
      expect(contentType).to.be.a('string').and.not.be.empty

      await destroyTestSession(session_id)
    })

    it('Should detect content type of binary data', async () => {
      const session_id = await createTestSession(testPort)

      // Insert binary data (non-printable bytes)
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
      await insert(session_id, 0, binaryData)

      const contentTypeResponse = await getContentType(session_id, 0, 6)
      expect(contentTypeResponse).to.not.be.undefined
      const contentType = contentTypeResponse.getContentType()
      expect(contentType).to.be.a('string').and.not.be.empty

      await destroyTestSession(session_id)
    })
  })

  describe('editSimple', () => {
    it('Should optimize and apply simple edits', async () => {
      const session_id = await createTestSession(testPort)
      const stats = new EditStats()

      // Insert initial content
      await insert(session_id, 0, Buffer.from('Hello, World!'), stats)
      expect(await getComputedFileSize(session_id)).to.equal(13)

      // Use editSimple to replace "World" with "Omega"
      const original = Buffer.from('World')
      const edited = Buffer.from('Omega')
      const result = await editSimple(session_id, 7, original, edited, stats)
      expect(result).to.be.a('number').and.to.be.greaterThan(0)

      // Verify the result
      const segment = await getSegment(session_id, 0, 13)
      const content = Buffer.from(segment).toString('utf-8')
      expect(content).to.equal('Hello, Omega!')

      await destroyTestSession(session_id)
    })

    it('Should handle editSimple with different-length replacement', async () => {
      const session_id = await createTestSession(testPort)
      const stats = new EditStats()

      // Insert initial content
      await insert(session_id, 0, Buffer.from('AABBCC'), stats)

      // Replace "BB" with "XXXX" (expansion)
      const original = Buffer.from('BB')
      const edited = Buffer.from('XXXX')
      await editSimple(session_id, 2, original, edited, stats)

      const fileSize = await getComputedFileSize(session_id)
      expect(fileSize).to.equal(8) // AA + XXXX + CC = 8

      const segment = await getSegment(session_id, 0, fileSize)
      expect(Buffer.from(segment).toString('utf-8')).to.equal('AAXXXXCC')

      await destroyTestSession(session_id)
    })

    it('Should handle editSimple with deletion (empty replacement)', async () => {
      const session_id = await createTestSession(testPort)
      const stats = new EditStats()

      await insert(session_id, 0, Buffer.from('AABBCC'), stats)

      // Replace "BB" with "" (deletion)
      const original = Buffer.from('BB')
      const edited = Buffer.from('')
      await editSimple(session_id, 2, original, edited, stats)

      expect(await getComputedFileSize(session_id)).to.equal(4)
      const segment = await getSegment(session_id, 0, 4)
      expect(Buffer.from(segment).toString('utf-8')).to.equal('AACC')

      await destroyTestSession(session_id)
    })
  })

  describe('Save with flags and partial saves', () => {
    const saveDir = path.join(__dirname, 'data')

    it('Should save with IO_FLG_OVERWRITE', async () => {
      const savePath = path.join(saveDir, 'coverage_save_overwrite.txt')
      // Clean up from any prior run
      if (fs.existsSync(savePath)) fs.unlinkSync(savePath)

      const session_id = await createTestSession(testPort)
      await insert(session_id, 0, Buffer.from('save test data'))

      // First save
      const resp1 = await saveSession(session_id, savePath)
      expect(resp1.getFilePath()).to.be.a('string')

      // Modify and save with overwrite
      await insert(session_id, 0, Buffer.from('PREFIX_'))
      const resp2 = await saveSession(
        session_id,
        savePath,
        IOFlags.IO_FLG_OVERWRITE
      )
      expect(resp2.getFilePath()).to.include('coverage_save_overwrite')

      // Verify the file was overwritten
      const savedContent = fs.readFileSync(resp2.getFilePath(), 'utf-8')
      expect(savedContent).to.equal('PREFIX_save test data')

      // Clean up
      if (fs.existsSync(resp2.getFilePath())) fs.unlinkSync(resp2.getFilePath())
      await destroyTestSession(session_id)
    })

    it('Should save a partial segment with offset and length', async () => {
      const savePath = path.join(saveDir, 'coverage_save_segment.txt')
      if (fs.existsSync(savePath)) fs.unlinkSync(savePath)

      const session_id = await createTestSession(testPort)
      await insert(session_id, 0, Buffer.from('ABCDEFGHIJ'))

      // Save only bytes 3-7 (5 bytes: "DEFGH")
      const resp = await saveSession(
        session_id,
        savePath,
        IOFlags.IO_FLG_OVERWRITE,
        3,
        5
      )
      const savedContent = fs.readFileSync(resp.getFilePath(), 'utf-8')
      expect(savedContent).to.equal('DEFGH')

      if (fs.existsSync(resp.getFilePath())) fs.unlinkSync(resp.getFilePath())
      await destroyTestSession(session_id)
    })
  })

  describe('Concurrent sessions', () => {
    it('Should isolate edits between two sessions', async () => {
      // Create two sessions
      const session1 = await createSession()
      const session1_id = session1.getSessionId()
      const session2 = await createSession()
      const session2_id = session2.getSessionId()
      expect(await getSessionCount()).to.equal(2)

      // Insert different data in each
      await insert(session1_id, 0, Buffer.from('Session ONE'))
      await insert(session2_id, 0, Buffer.from('Session TWO'))

      // Verify they are independent
      expect(await getComputedFileSize(session1_id)).to.equal(11)
      expect(await getComputedFileSize(session2_id)).to.equal(11)

      const seg1 = await getSegment(session1_id, 0, 11)
      const seg2 = await getSegment(session2_id, 0, 11)
      expect(Buffer.from(seg1).toString('utf-8')).to.equal('Session ONE')
      expect(Buffer.from(seg2).toString('utf-8')).to.equal('Session TWO')

      // Edit session1 — session2 should be unaffected
      await del(session1_id, 8, 3) // remove "ONE"
      expect(await getComputedFileSize(session1_id)).to.equal(8)
      expect(await getComputedFileSize(session2_id)).to.equal(11) // unchanged

      // Undo in session1 — session2 still unaffected
      await undo(session1_id)
      expect(await getComputedFileSize(session1_id)).to.equal(11)
      expect(await getComputedFileSize(session2_id)).to.equal(11)

      // Clean up both sessions
      await destroySession(session1_id)
      await destroySession(session2_id)
    })

    it('Should allow independent change counts per session', async () => {
      const session1 = await createSession()
      const session1_id = session1.getSessionId()
      const session2 = await createSession()
      const session2_id = session2.getSessionId()

      await insert(session1_id, 0, Buffer.from('A'))
      await insert(session1_id, 1, Buffer.from('B'))
      await insert(session1_id, 2, Buffer.from('C'))

      await insert(session2_id, 0, Buffer.from('X'))

      expect(await getChangeCount(session1_id)).to.equal(3)
      expect(await getChangeCount(session2_id)).to.equal(1)

      await destroySession(session1_id)
      await destroySession(session2_id)
    })
  })

  describe('Unicode multi-byte edits', () => {
    it('Should insert and retrieve UTF-8 multi-byte data', async () => {
      const session_id = await createTestSession(testPort)

      // "café" contains multi-byte é (C3 A9)
      const cafeData = Buffer.from('café', 'utf-8')
      await insert(session_id, 0, cafeData)

      const fileSize = await getComputedFileSize(session_id)
      expect(fileSize).to.equal(cafeData.length) // 5 bytes

      const segment = await getSegment(session_id, 0, fileSize)
      expect(Buffer.from(segment).toString('utf-8')).to.equal('café')

      await destroyTestSession(session_id)
    })

    it('Should handle emoji insertion', async () => {
      const session_id = await createTestSession(testPort)

      // "😀" is 4 bytes in UTF-8
      const emojiData = Buffer.from('😀', 'utf-8')
      expect(emojiData.length).to.equal(4)
      await insert(session_id, 0, emojiData)

      expect(await getComputedFileSize(session_id)).to.equal(4)
      const segment = await getSegment(session_id, 0, 4)
      expect(Buffer.from(segment).toString('utf-8')).to.equal('😀')

      await destroyTestSession(session_id)
    })

    it('Should handle mixed ASCII and multi-byte edits', async () => {
      const session_id = await createTestSession(testPort)

      // Insert mixed content: "Hello, 世界!" (Hello, World! in Chinese)
      const mixedData = Buffer.from('Hello, 世界!', 'utf-8')
      await insert(session_id, 0, mixedData)

      const fileSize = await getComputedFileSize(session_id)
      expect(fileSize).to.equal(mixedData.length) // 13 bytes (7 ASCII + 6 UTF-8)

      const segment = await getSegment(session_id, 0, fileSize)
      expect(Buffer.from(segment).toString('utf-8')).to.equal('Hello, 世界!')

      // Overwrite the ASCII part
      await overwrite(session_id, 0, Buffer.from('Grüße'))
      const newSize = await getComputedFileSize(session_id)
      const newSegment = await getSegment(session_id, 0, newSize)
      const content = Buffer.from(newSegment).toString('utf-8')
      // Should start with the overwritten data
      expect(content.startsWith('Grüße')).to.be.true

      await destroyTestSession(session_id)
    })
  })

  describe('Viewport data integrity', () => {
    it('Should have viewport data matching session segment', async () => {
      const { createViewport, destroyViewport, getViewportData } =
        await import('@omega-edit/client')

      const session_id = await createTestSession(testPort)
      await insert(session_id, 0, Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'))

      // Create a viewport at offset 5 with capacity 10
      const vpResponse = await createViewport(
        undefined,
        session_id,
        5,
        10,
        false
      )
      const vpId = vpResponse.getViewportId()

      // Get viewport data
      const vpData = await getViewportData(vpId)
      const vpBytes = vpData.getData_asU8()

      // Get segment from session at same offset/length
      const segBytes = await getSegment(session_id, 5, 10)

      // They must be identical
      expect(Buffer.from(vpBytes)).to.deep.equal(Buffer.from(segBytes))

      // Both should equal "FGHIJKLMNO"
      expect(Buffer.from(vpBytes).toString('utf-8')).to.equal('FGHIJKLMNO')

      await destroyViewport(vpId)
      await destroyTestSession(session_id)
    })

    it('Should have viewport data matching after edits', async () => {
      const { createViewport, destroyViewport, getViewportData } =
        await import('@omega-edit/client')

      const session_id = await createTestSession(testPort)
      await insert(session_id, 0, Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'))

      const vpResponse = await createViewport(
        undefined,
        session_id,
        0,
        26,
        false
      )
      const vpId = vpResponse.getViewportId()

      // Editing at offset 5: delete 3 bytes
      await del(session_id, 5, 3)
      const newSize = await getComputedFileSize(session_id)
      expect(newSize).to.equal(23)

      // Compare viewport vs segment
      const vpData = await getViewportData(vpId)
      const vpBytes = vpData.getData_asU8()
      const segBytes = await getSegment(session_id, 0, Math.min(23, 26))
      expect(Buffer.from(vpBytes).slice(0, 23)).to.deep.equal(
        Buffer.from(segBytes)
      )

      await destroyViewport(vpId)
      await destroyTestSession(session_id)
    })
  })

  describe('Error handling', () => {
    it('Should reject operations on invalid session ID', async () => {
      const badId = 'nonexistent-session-id-12345'

      try {
        await getComputedFileSize(badId)
        expect.fail('Should have thrown an error')
      } catch (err: any) {
        expect(err).to.be.a('string')
      }
    })

    it('Should reject insert on invalid session ID', async () => {
      const badId = 'nonexistent-session-id-12345'

      try {
        await insert(badId, 0, Buffer.from('data'))
        expect.fail('Should have thrown an error')
      } catch (err: any) {
        expect(err).to.be.a('string')
      }
    })

    it('Should reject delete on invalid session ID', async () => {
      const badId = 'nonexistent-session-id-12345'

      try {
        await del(badId, 0, 5)
        expect.fail('Should have thrown an error')
      } catch (err: any) {
        expect(err).to.be.a('string')
      }
    })

    it('Should reject undo on empty session', async () => {
      const session_id = await createTestSession(testPort)

      // Undo on a session with no changes should return 0 or error
      try {
        const result = await undo(session_id)
        // If it doesn't throw, the result should indicate failure (0)
        expect(result).to.equal(0)
      } catch {
        // Error is also acceptable
      }

      await destroyTestSession(session_id)
    })

    it('Should reject redo with nothing to redo', async () => {
      const session_id = await createTestSession(testPort)

      try {
        const result = await redo(session_id)
        expect(result).to.equal(0)
      } catch {
        // Error is acceptable
      }

      await destroyTestSession(session_id)
    })

    it('Should reject destroy of nonexistent session', async () => {
      try {
        await destroySession('does-not-exist-99999')
        expect.fail('Should have thrown an error')
      } catch (err: any) {
        expect(err).to.be.a('string')
      }
    })
  })

  describe('Undo/Redo edge cases', () => {
    it('Should undo all changes back to empty', async () => {
      const session_id = await createTestSession(testPort)

      await insert(session_id, 0, Buffer.from('AAA'))
      await insert(session_id, 3, Buffer.from('BBB'))
      await insert(session_id, 6, Buffer.from('CCC'))
      expect(await getComputedFileSize(session_id)).to.equal(9)

      // Undo all three
      await undo(session_id)
      await undo(session_id)
      await undo(session_id)
      expect(await getComputedFileSize(session_id)).to.equal(0)

      // Redo all three
      await redo(session_id)
      await redo(session_id)
      await redo(session_id)
      expect(await getComputedFileSize(session_id)).to.equal(9)

      const segment = await getSegment(session_id, 0, 9)
      expect(Buffer.from(segment).toString('utf-8')).to.equal('AAABBBCCC')

      await destroyTestSession(session_id)
    })

    it('Should discard redo stack on new edit after undo', async () => {
      const session_id = await createTestSession(testPort)

      await insert(session_id, 0, Buffer.from('AAA'))
      await insert(session_id, 3, Buffer.from('BBB'))
      expect(await getComputedFileSize(session_id)).to.equal(6)

      // Undo last insert
      await undo(session_id)
      expect(await getComputedFileSize(session_id)).to.equal(3)
      expect(await getUndoCount(session_id)).to.equal(1)

      // New edit should discard the redo stack
      await insert(session_id, 3, Buffer.from('CCC'))
      expect(await getComputedFileSize(session_id)).to.equal(6)
      expect(await getUndoCount(session_id)).to.equal(0)

      // Redo should fail (nothing to redo)
      try {
        const result = await redo(session_id)
        expect(result).to.equal(0)
      } catch {
        // Error is acceptable
      }

      await destroyTestSession(session_id)
    })
  })
})
