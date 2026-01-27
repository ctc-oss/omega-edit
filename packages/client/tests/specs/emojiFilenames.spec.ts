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

import { expect, testPort } from './common'
import {
  createSession,
  destroySession,
  getClient,
  getComputedFileSize,
  getSegment,
  getSessionCount,
  insert,
  IOFlags,
  saveSession,
} from '@omega-edit/client'
import * as fs from 'fs'
import * as path from 'path'

describe('Emoji Filename Handling', () => {
  const testDataDir = path.join(__dirname, 'data')

  // Ensure the test data directory exists
  before(() => {
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true })
    }
  })

  // Array of emoji filenames to test
  const emojiFilenames = [
    'test_😀.txt',
    'test_👍.txt',
    'test_🔥.txt',
    'test 💩.txt', // Space in filename as well
    'test_🚀.txt',
    'test_👨‍👩‍👧‍👦.txt', // Family emoji with zero-width joiners
  ]

  // Helper function to clean up test files
  const cleanupTestFiles = () => {
    emojiFilenames.forEach((filename) => {
      const filePath = path.join(testDataDir, filename)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }

      const copyFilePath = path.join(testDataDir, `copy_${filename}`)
      if (fs.existsSync(copyFilePath)) {
        fs.unlinkSync(copyFilePath)
      }
    })
  }

  // Skip test on Windows due to omega-edit limitations with emoji filenames on windows
  ;(process.platform === 'win32' ? it.skip : it)(
    'Should handle files with emoji in filenames',
    async () => {
      // Ensure client is connected
      expect(await getClient(testPort)).to.not.be.undefined

      // Test each emoji filename
      for (const emojiFilename of emojiFilenames) {
        const filePath = path.join(testDataDir, emojiFilename)

        // Create a test file with emoji in filename
        fs.writeFileSync(filePath, 'Test content with emoji filename')
        expect(fs.existsSync(filePath)).to.be.true

        // Create a session with the emoji filename
        const session = await createSession(filePath)
        const session_id = session.getSessionId()

        // Verify session was created successfully
        expect(session_id).to.be.a('string')
        expect(await getSessionCount()).to.equal(1)

        // Verify file size is correct
        const expectedSize = fs.statSync(filePath).size
        expect(await getComputedFileSize(session_id)).to.equal(expectedSize)

        // Add some content
        const data = Buffer.from('Added content')
        await insert(session_id, 0, data)
        const newSize = await getComputedFileSize(session_id)
        expect(newSize).to.equal(expectedSize + data.length)

        // Use getSegment to retrieve session data
        const sessionDataAfterInsert = await getSegment(session_id, 0, newSize)

        // Compare session data using Buffer.from and deep.equals
        expect(sessionDataAfterInsert).to.deep.contains(
          Buffer.from('Added content')
        )

        // Save to another emoji filename
        const copyFilePath = path.join(testDataDir, `copy_${emojiFilename}`)
        const saveResult = await saveSession(
          session_id,
          copyFilePath,
          IOFlags.IO_FLG_OVERWRITE
        )

        // Verify save was successful
        expect(saveResult).to.not.be.undefined
        expect(fs.existsSync(copyFilePath)).to.be.true

        // Clean up
        await destroySession(session_id)
        expect(await getSessionCount()).to.equal(0)
      }
    }
  )

  // Clean up test files after all tests
  after(() => {
    cleanupTestFiles()
  })
})
