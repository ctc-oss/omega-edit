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
 * profile.ts — Demonstrates Ωedit™ data profiling:
 *   1. Byte frequency profiling over any segment of the session
 *   2. ASCII vs non-ASCII byte analysis
 *   3. BOM (byte order mark) detection
 *
 * This is the TypeScript equivalent of core/src/examples/profile.c.
 *
 * Usage:
 *   npx ts-node profile.ts <input-file>
 */

import {
  startServer,
  getClient,
  createSession,
  destroySession,
  getComputedFileSize,
  profileSession,
  numAscii,
  getByteOrderMark,
  PROFILE_DOS_EOL,
  stopServerGraceful,
  resetClient,
} from '@omega-edit/client'

const PORT = 9000

async function main() {
  if (process.argv.length < 3) {
    console.error('Usage: npx ts-node profile.ts <input-file>')
    process.exit(1)
  }

  const inputFile = process.argv[2]

  console.log('Starting Ωedit™ server...')
  const pid = await startServer(PORT)

  try {
    await getClient(PORT)

    const sessionResp = await createSession(inputFile)
    const sessionId = sessionResp.getSessionId()
    const fileSize = await getComputedFileSize(sessionId)
    console.log(`Opened "${inputFile}" (${fileSize} bytes)\n`)

    // --- Byte frequency profile (entire file) ---
    const profile = await profileSession(sessionId)
    const totalAscii = numAscii(profile)
    const totalBytes = profile.reduce((sum, count) => sum + count, 0)

    console.log('=== Byte Frequency Profile ===')
    console.log(`Total bytes profiled: ${totalBytes}`)
    console.log(`ASCII bytes (0x00-0x7F): ${totalAscii} (${((totalAscii / totalBytes) * 100).toFixed(1)}%)`)
    console.log(`Non-ASCII bytes (0x80-0xFF): ${totalBytes - totalAscii} (${(((totalBytes - totalAscii) / totalBytes) * 100).toFixed(1)}%)`)
    console.log(`DOS line endings (CR+LF): ${profile[PROFILE_DOS_EOL]}`)

    // Print the top 10 most frequent byte values
    const indexed = profile.slice(0, 256).map((count, byte) => ({ byte, count }))
    indexed.sort((a, b) => b.count - a.count)

    console.log('\nTop 10 most frequent bytes:')
    for (const { byte, count } of indexed.slice(0, 10)) {
      if (count === 0) break
      const char = byte >= 32 && byte < 127 ? `'${String.fromCharCode(byte)}'` : '   '
      const pct = ((count / totalBytes) * 100).toFixed(1)
      console.log(`  0x${byte.toString(16).padStart(2, '0')} ${char}  ${count.toString().padStart(8)} (${pct}%)`)
    }

    // --- Profile a segment (first 100 bytes only) ---
    if (fileSize > 100) {
      console.log('\n=== Partial Profile (first 100 bytes) ===')
      const partial = await profileSession(sessionId, 0, 100)
      const partialTotal = partial.reduce((sum, c) => sum + c, 0)
      const partialAscii = numAscii(partial)
      console.log(`Bytes profiled: ${partialTotal}, ASCII: ${partialAscii}`)
    }

    // --- BOM detection ---
    console.log('\n=== Byte Order Mark Detection ===')
    const bom = await getByteOrderMark(sessionId)
    const bomKind = bom.getByteOrderMark()
    if (bomKind === 0) {
      console.log('No BOM detected')
    } else {
      console.log(`BOM detected: ${bomKind} (offset ${bom.getOffset()}, length ${bom.getByteOrderMarkSize()})`)
    }

    await destroySession(sessionId)
  } finally {
    await stopServerGraceful()
    resetClient()
    console.log('\nServer stopped')
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
