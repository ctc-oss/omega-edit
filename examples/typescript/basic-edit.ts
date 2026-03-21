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
 * basic-edit.ts — Demonstrates the core Ωedit™ workflow:
 *   1. Start the server
 *   2. Connect the client
 *   3. Create a session (empty or from a file)
 *   4. Insert, overwrite, and delete bytes
 *   5. Undo and redo changes
 *   6. Save the session to a file
 *   7. Clean up
 *
 * Usage:
 *   npx ts-node basic-edit.ts [input-file] [output-file]
 *
 * If no input file is given, the session starts empty.
 * If no output file is given, the result is saved to "basic-edit-output.dat".
 */

import {
  startServer,
  getClient,
  createSession,
  destroySession,
  saveSession,
  getComputedFileSize,
  getSegment,
  insert,
  overwrite,
  del,
  undo,
  redo,
  getClientVersion,
  stopServerGraceful,
  resetClient,
  IOFlags,
  EditStats,
} from '@omega-edit/client'

const PORT = 9000

async function main() {
  const inputFile = process.argv[2] || ''
  const outputFile = process.argv[3] || 'basic-edit-output.dat'

  console.log(`Ωedit™ client version: ${getClientVersion()}`)

  // 1. Start the native gRPC server (bundled inside @omega-edit/client)
  console.log('Starting Ωedit™ server...')
  const pid = await startServer(PORT)
  console.log(`Server started (PID: ${pid})`)

  try {
    // 2. Connect the client
    await getClient(PORT)
    console.log('Client connected')

    // 3. Create a session — from a file or empty
    const sessionResp = await createSession(inputFile)
    const sessionId = sessionResp.getSessionId()
    const initialSize = await getComputedFileSize(sessionId)
    console.log(
      `Session "${sessionId}" created (initial size: ${initialSize} bytes)`
    )

    // 4. Track edit statistics
    const stats = new EditStats()

    // Insert "Hello, Ωedit™! " at the beginning
    const greeting = Buffer.from('Hello, Ωedit™! ')
    await insert(sessionId, 0, greeting, stats)
    console.log(`After insert: ${await getComputedFileSize(sessionId)} bytes`)

    // Overwrite "Ωedit" with "World" (use Buffer.byteLength for correct UTF-8 offsets)
    const overwriteOffset = Buffer.byteLength('Hello, ')
    await overwrite(sessionId, overwriteOffset, Buffer.from('World'), stats)
    console.log(
      `After overwrite: ${await getComputedFileSize(sessionId)} bytes`
    )

    // Delete the leftover byte + "™" to get "Hello, World! "
    const deleteOffset = overwriteOffset + Buffer.byteLength('World')
    const deleteLength =
      Buffer.byteLength('Ωedit') -
      Buffer.byteLength('World') +
      Buffer.byteLength('™')
    await del(sessionId, deleteOffset, deleteLength, stats)
    console.log(`After delete: ${await getComputedFileSize(sessionId)} bytes`)

    // Read the current content
    const size = await getComputedFileSize(sessionId)
    const segment = await getSegment(sessionId, 0, size)
    console.log(`Current content: "${Buffer.from(segment).toString()}"`)

    // 5. Undo the last change (the delete)
    await undo(sessionId, stats)
    const afterUndo = await getComputedFileSize(sessionId)
    console.log(`After undo: ${afterUndo} bytes`)

    // Redo it
    await redo(sessionId, stats)
    const afterRedo = await getComputedFileSize(sessionId)
    console.log(`After redo: ${afterRedo} bytes`)

    console.log(
      `Edit stats — inserts: ${stats.insert_count}, overwrites: ${stats.overwrite_count}, ` +
        `deletes: ${stats.delete_count}, undos: ${stats.undo_count}, redos: ${stats.redo_count}`
    )

    // 6. Save the session to a file
    await saveSession(sessionId, outputFile, IOFlags.IO_FLG_OVERWRITE)
    console.log(`Session saved to "${outputFile}"`)

    // 7. Destroy the session
    await destroySession(sessionId)
    console.log('Session destroyed')
  } finally {
    // Stop the server gracefully
    await stopServerGraceful()
    resetClient()
    console.log('Server stopped')
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
