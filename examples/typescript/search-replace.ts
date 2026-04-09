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

/**
 * search-replace.ts - Demonstrates search and replace using OmegaEdit:
 *   1. Search for all occurrences of a pattern (forward and reverse)
 *   2. Perform a transactional search-and-replace across the session
 *   3. Case-insensitive search
 *
 * This is the TypeScript equivalent of core/src/examples/replace.cpp.
 *
 * Usage:
 *   npx ts-node search-replace.ts <input-file> <output-file> <search> <replace>
 *
 * Example:
 *   npx ts-node search-replace.ts data.txt output.txt "foo" "bar"
 */

import {
  createSession,
  destroySession,
  EditStats,
  getClient,
  getComputedFileSize,
  IOFlags,
  pauseViewportEvents,
  replaceSession,
  resetClient,
  resumeViewportEvents,
  saveSession,
  searchSession,
  startServer,
  stopServerGraceful,
} from '@omega-edit/client'

const PORT = 9000

async function main() {
  if (process.argv.length < 6) {
    console.error(
      'Usage: npx ts-node search-replace.ts <input-file> <output-file> <search> <replace>'
    )
    process.exit(1)
  }

  const [, , inputFile, outputFile, searchPattern, replacement] = process.argv

  console.log('Starting OmegaEdit server...')
  const pid = await startServer(PORT)
  console.log(`Server started (PID: ${pid})`)

  let sessionId = ''

  try {
    await getClient(PORT)
    console.log('Client connected')

    const sessionResponse = await createSession(inputFile)
    sessionId = sessionResponse.getSessionId()
    console.log(`Session created: ${sessionId}`)

    const forwardMatches = await searchSession(sessionId, searchPattern)
    console.log(
      `Forward search for "${searchPattern}": ${forwardMatches.length} match(es)`
    )
    if (forwardMatches.length > 0) {
      console.log(`  Offsets: ${forwardMatches.join(', ')}`)
    }

    const reverseMatches = await searchSession(
      sessionId,
      searchPattern,
      false,
      true
    )
    console.log(
      `Reverse search for "${searchPattern}": ${reverseMatches.length} match(es)`
    )
    if (reverseMatches.length > 0) {
      console.log(`  Offsets: ${reverseMatches.join(', ')}`)
    }

    const caseInsensitiveMatches = await searchSession(
      sessionId,
      searchPattern,
      true
    )
    console.log(
      `Case-insensitive search for "${searchPattern}": ${caseInsensitiveMatches.length} match(es)`
    )

    const limitedMatches = await searchSession(
      sessionId,
      searchPattern,
      false,
      false,
      0,
      0,
      3
    )
    console.log(`Limited search (max 3): ${limitedMatches.length} match(es)`)

    await pauseViewportEvents(sessionId)
    try {
      const stats = new EditStats()
      const replacementCount = await replaceSession(
        sessionId,
        searchPattern,
        replacement,
        false,
        false,
        0,
        0,
        0,
        true,
        false,
        stats
      )

      console.log(
        `Replaced ${replacementCount} occurrence(s) of "${searchPattern}" with "${replacement}"`
      )
      console.log(
        `Edit stats - inserts: ${stats.insert_count}, overwrites: ${stats.overwrite_count}, deletes: ${stats.delete_count}`
      )
    } finally {
      await resumeViewportEvents(sessionId)
    }

    console.log(
      `New file size: ${await getComputedFileSize(sessionId)} bytes`
    )

    await saveSession(sessionId, outputFile, IOFlags.OVERWRITE)
    console.log(`Saved to "${outputFile}"`)

    await destroySession(sessionId)
    sessionId = ''
  } finally {
    if (sessionId) {
      await destroySession(sessionId).catch(() => undefined)
    }
    await stopServerGraceful().catch(() => undefined)
    resetClient()
    console.log('Server stopped')
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
