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
 * viewports.ts — Demonstrates Ωedit™ viewports:
 *   1. Create multiple viewports into the same session
 *   2. Make edits and observe how viewports reflect changes
 *   3. Use floating viewports that auto-adjust their offset
 *   4. Modify viewport offset and capacity
 *
 * Viewports are a core Ωedit™ primitive. Each viewport is a window into
 * the session data at a given offset and capacity. When edits occur, the
 * server evaluates each viewport and updates it if affected. Floating
 * viewports automatically adjust their offset when inserts or deletes
 * occur before them.
 *
 * Usage:
 *   npx ts-node viewports.ts [input-file]
 */

import {
  startServer,
  getClient,
  createSession,
  destroySession,
  getComputedFileSize,
  insert,
  del,
  createViewport,
  modifyViewport,
  getViewportData,
  destroyViewport,
  getViewportCount,
  stopServerGraceful,
  resetClient,
} from '@omega-edit/client'

const PORT = 9000

/** Helper: print viewport content as text and hex */
async function printViewport(label: string, viewportId: string) {
  const vpt = await getViewportData(viewportId)
  const bytes = vpt.getData_asU8()
  const text = Buffer.from(bytes).toString()
  const hex = Buffer.from(bytes).toString('hex')
  console.log(
    `  [${label}] offset=${vpt.getOffset()}, ` +
      `length=${bytes.length}, following=${vpt.getFollowingByteCount()}`
  )
  console.log(`    text: "${text}"`)
  console.log(`    hex:  ${hex}`)
}

async function main() {
  const inputFile = process.argv[2] || ''

  console.log('Starting Ωedit™ server...')
  const pid = await startServer(PORT)

  try {
    await getClient(PORT)

    // Create a session
    const sessionResp = await createSession(inputFile)
    const sessionId = sessionResp.getSessionId()

    // If starting empty, insert some initial content
    if (!inputFile) {
      await insert(sessionId, 0, Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'))
    }

    const fileSize = await getComputedFileSize(sessionId)
    console.log(`Session created (${fileSize} bytes)\n`)

    // --- Create two viewports ---
    // Viewport 1: fixed, viewing the first 10 bytes
    const vpt1Resp = await createViewport('head', sessionId, 0, 10, false)
    const vpt1Id = vpt1Resp.getViewportId()

    // Viewport 2: floating, viewing bytes 10-19
    // Floating viewports auto-adjust their offset when inserts/deletes happen before them
    const vpt2Resp = await createViewport('tail', sessionId, 10, 10, true)
    const vpt2Id = vpt2Resp.getViewportId()

    console.log(`Created ${await getViewportCount(sessionId)} viewports`)
    console.log('--- Initial state ---')
    await printViewport('head (fixed)', vpt1Id)
    await printViewport('tail (floating)', vpt2Id)

    // --- Insert 5 bytes at offset 0 ---
    console.log('\n--- After inserting "12345" at offset 0 ---')
    await insert(sessionId, 0, Buffer.from('12345'))

    // The fixed viewport still starts at offset 0, but now shows the inserted content
    // The floating viewport auto-adjusted its offset from 10 to 15
    await printViewport('head (fixed)', vpt1Id)
    await printViewport('tail (floating)', vpt2Id)

    // --- Delete 3 bytes at offset 2 ---
    console.log('\n--- After deleting 3 bytes at offset 2 ---')
    await del(sessionId, 2, 3)
    await printViewport('head (fixed)', vpt1Id)
    await printViewport('tail (floating)', vpt2Id)

    // --- Modify viewport 1: move it to offset 5 with capacity 8 ---
    console.log('\n--- After moving head viewport to offset=5, capacity=8 ---')
    await modifyViewport(vpt1Id, 5, 8)
    await printViewport('head (moved)', vpt1Id)

    // --- Clean up ---
    await destroyViewport(vpt1Id)
    await destroyViewport(vpt2Id)
    console.log(`\nViewports remaining: ${await getViewportCount(sessionId)}`)

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
