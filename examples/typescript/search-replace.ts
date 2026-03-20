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
 * search-replace.ts — Demonstrates search and replace using Ωedit™:
 *   1. Search for all occurrences of a pattern (forward and reverse)
 *   2. Perform a search-and-replace across the session
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
  startServer,
  getClient,
  createSession,
  destroySession,
  saveSession,
  getComputedFileSize,
  searchSession,
  replaceSession,
  pauseViewportEvents,
  resumeViewportEvents,
  stopServerGraceful,
  resetClient,
  IOFlags,
  EditStats,
} from '@omega-edit/client'

const PORT = 9000

async function main() {
  if (process.argv.length < 6) {
    console.error('Usage: npx ts-node search-replace.ts <input-file> <output-file> <search> <replace>')
    process.exit(1)
  }

  const [, , inputFile, outputFile, searchPattern, replacement] = process.argv

  console.log('Starting Ωedit™ server...')
  const pid = await startServer(PORT)
  console.log(`Server started (PID: ${pid})`)

  try {
    await getClient(PORT)

    // Create a session from the input file
    const sessionResp = await createSession(inputFile)
    const sessionId = sessionResp.getSessionId()
    const initialSize = await getComputedFileSize(sessionId)
    console.log(`Opened "${inputFile}" (${initialSize} bytes)`)

    // --- Forward search: find all occurrences ---
    const forwardMatches = await searchSession(sessionId, searchPattern)
    console.log(`Forward search for "${searchPattern}": ${forwardMatches.length} match(es)`)
    if (forwardMatches.length > 0) {
      console.log(`  Offsets: ${forwardMatches.join(', ')}`)
    }

    // --- Reverse search: same pattern, searched backward ---
    const reverseMatches = await searchSession(sessionId, searchPattern, false, true)
    console.log(`Reverse search for "${searchPattern}": ${reverseMatches.length} match(es)`)
    if (reverseMatches.length > 0) {
      console.log(`  Offsets: ${reverseMatches.join(', ')}`)
    }

    // --- Case-insensitive search ---
    const caseInsensitiveMatches = await searchSession(sessionId, searchPattern, true)
    console.log(`Case-insensitive search for "${searchPattern}": ${caseInsensitiveMatches.length} match(es)`)

    // --- Limited search: find at most 3 matches ---
    const limitedMatches = await searchSession(sessionId, searchPattern, false, false, 0, 0, 3)
    console.log(`Limited search (max 3): ${limitedMatches.length} match(es)`)

    // --- Search-and-replace ---
    // Pause viewport events for efficiency during bulk replacements
    await pauseViewportEvents(sessionId)

    const stats = new EditStats()
    const replacementCount = await replaceSession(
      sessionId,
      searchPattern,
      replacement,
      false, // case-sensitive
      false, // forward
      0, // from start
      0, // to end
      0, // no limit
      true, // front-to-back
      false, // not overwrite-only
      stats
    )

    // Resume viewport events
    await resumeViewportEvents(sessionId)

    console.log(`Replaced ${replacementCount} occurrence(s) of "${searchPattern}" with "${replacement}"`)
    console.log(`New file size: ${await getComputedFileSize(sessionId)} bytes`)

    // Save the result
    await saveSession(sessionId, outputFile, IOFlags.IO_FLG_OVERWRITE)
    console.log(`Saved to "${outputFile}"`)

    await destroySession(sessionId)
  } finally {
    await stopServerGraceful()
    resetClient()
    console.log('Server stopped')
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
