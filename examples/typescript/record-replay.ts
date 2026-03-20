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
 * record-replay.ts — Demonstrates recording edits and replaying them:
 *   1. Open a file and apply a series of programmatic edits
 *   2. Record each edit to a JSON change log
 *   3. Open a second session and replay the recorded edits
 *   4. Save both files and verify they match
 *
 * This is the TypeScript equivalent of the C++ play.cpp / replay.cpp pair.
 * It shows how Ωedit™ can be used for patching: record edits against one
 * file, then replay the same edits against another copy (or many copies)
 * to keep them in sync.
 *
 * Usage:
 *   npx ts-node record-replay.ts <input-file>
 *
 * Creates two output files:
 *   - record-replay-edited.dat   (edited via original session)
 *   - record-replay-replayed.dat (edited via replayed changes)
 *   - record-replay-changes.json (the recorded change log)
 */

import * as fs from 'fs'
import {
  startServer,
  getClient,
  createSession,
  destroySession,
  saveSession,
  getComputedFileSize,
  insert,
  overwrite,
  del,
  getLastChange,
  getChangeCount,
  ChangeKind,
  stopServerGraceful,
  resetClient,
  IOFlags,
} from '@omega-edit/client'

const PORT = 9000

/** A serializable change record */
interface ChangeRecord {
  serial: number
  kind: 'INSERT' | 'DELETE' | 'OVERWRITE'
  offset: number
  length: number
  /** hex-encoded bytes (empty for DELETE) */
  data: string
}

const CHANGE_KIND_NAMES: Record<number, ChangeRecord['kind']> = {
  [ChangeKind.CHANGE_INSERT]: 'INSERT',
  [ChangeKind.CHANGE_DELETE]: 'DELETE',
  [ChangeKind.CHANGE_OVERWRITE]: 'OVERWRITE',
}

/** Record the last change from a session into the change log */
async function recordLastChange(sessionId: string, log: ChangeRecord[]) {
  const change = await getLastChange(sessionId)
  const record: ChangeRecord = {
    serial: change.getSerial(),
    kind: CHANGE_KIND_NAMES[change.getKind()] || 'INSERT',
    offset: change.getOffset(),
    length: change.getLength(),
    data: Buffer.from(change.getData_asU8()).toString('hex'),
  }
  log.push(record)
}

/** Replay a change log against a session */
async function replayChanges(sessionId: string, changes: ChangeRecord[]) {
  for (const change of changes) {
    const data = change.data ? Buffer.from(change.data, 'hex') : Buffer.alloc(0)
    switch (change.kind) {
      case 'INSERT':
        await insert(sessionId, change.offset, data)
        break
      case 'DELETE':
        await del(sessionId, change.offset, change.length)
        break
      case 'OVERWRITE':
        await overwrite(sessionId, change.offset, data)
        break
    }
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.error('Usage: npx ts-node record-replay.ts <input-file>')
    process.exit(1)
  }

  const inputFile = process.argv[2]
  const editedFile = 'record-replay-edited.dat'
  const replayedFile = 'record-replay-replayed.dat'
  const changeLogFile = 'record-replay-changes.json'

  console.log('Starting Ωedit™ server...')
  const pid = await startServer(PORT)

  try {
    await getClient(PORT)

    // ============================================================
    // PHASE 1: Edit a file and record the changes
    // ============================================================
    console.log('\n=== Phase 1: Record edits ===')
    const session1Resp = await createSession(inputFile)
    const session1Id = session1Resp.getSessionId()
    console.log(`Opened "${inputFile}" (${await getComputedFileSize(session1Id)} bytes)`)

    const changeLog: ChangeRecord[] = []

    // Apply a series of edits, recording each one
    await insert(session1Id, 0, Buffer.from('[PATCHED] '))
    await recordLastChange(session1Id, changeLog)

    await overwrite(session1Id, 10, Buffer.from('***'))
    await recordLastChange(session1Id, changeLog)

    await del(session1Id, 20, 5)
    await recordLastChange(session1Id, changeLog)

    await insert(session1Id, 15, Buffer.from(' INSERTED '))
    await recordLastChange(session1Id, changeLog)

    const editedSize = await getComputedFileSize(session1Id)
    console.log(`Applied ${await getChangeCount(session1Id)} changes (new size: ${editedSize} bytes)`)

    // Save the edited file
    await saveSession(session1Id, editedFile, IOFlags.IO_FLG_OVERWRITE)
    console.log(`Saved edited file to "${editedFile}"`)

    // Write the change log to disk
    fs.writeFileSync(changeLogFile, JSON.stringify(changeLog, null, 2))
    console.log(`Recorded ${changeLog.length} changes to "${changeLogFile}"`)

    await destroySession(session1Id)

    // ============================================================
    // PHASE 2: Replay the recorded changes against the same file
    // ============================================================
    console.log('\n=== Phase 2: Replay edits ===')

    // Read the change log (simulating a separate process or machine)
    const loadedChanges: ChangeRecord[] = JSON.parse(fs.readFileSync(changeLogFile, 'utf-8'))
    console.log(`Loaded ${loadedChanges.length} changes from "${changeLogFile}"`)

    // Open a fresh session on the original file
    const session2Resp = await createSession(inputFile)
    const session2Id = session2Resp.getSessionId()
    console.log(`Opened fresh session on "${inputFile}" (${await getComputedFileSize(session2Id)} bytes)`)

    // Replay all changes
    await replayChanges(session2Id, loadedChanges)
    const replayedSize = await getComputedFileSize(session2Id)
    console.log(`Replayed ${loadedChanges.length} changes (new size: ${replayedSize} bytes)`)

    // Save the replayed result
    await saveSession(session2Id, replayedFile, IOFlags.IO_FLG_OVERWRITE)
    console.log(`Saved replayed file to "${replayedFile}"`)

    await destroySession(session2Id)

    // ============================================================
    // PHASE 3: Verify both files match
    // ============================================================
    console.log('\n=== Verification ===')
    const editedContent = fs.readFileSync(editedFile)
    const replayedContent = fs.readFileSync(replayedFile)

    if (editedContent.equals(replayedContent)) {
      console.log('SUCCESS: Edited and replayed files are identical')
    } else {
      console.error('MISMATCH: Files differ — replay did not produce the same result')
      process.exit(1)
    }
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
