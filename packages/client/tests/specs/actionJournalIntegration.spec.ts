/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0.
 */

import {
  checkoutCheckpoint,
  createCheckpoint,
  del,
  getActionJournalViewport,
  insert,
  overwrite,
  redo,
  runSessionTransaction,
  undo,
} from '@omega-edit/client'
import {
  createTestSession,
  destroyTestSession,
  expect,
  testPort,
} from './common.js'

describe('Action journal integration', () => {
  let sessionId = ''

  beforeEach(async () => {
    sessionId = await createTestSession(testPort)
  })

  afterEach(async () => {
    await destroyTestSession(sessionId)
  })

  it('returns an empty viewport when the session has no changes', async () => {
    const viewport = await getActionJournalViewport({
      sessionId,
      capacity: 256,
      direction: 'older',
    })

    expect(viewport).toMatchObject({
      activeTipSerial: '0',
      changeCount: '0',
      undoCount: '0',
      checkpointCount: '0',
      anchorSerial: '0',
      capacity: 256,
      direction: 'older',
      entries: [],
      hasMore: false,
    })
  })

  it('walks bounded native windows and canonicalizes transactional replace', async () => {
    await insert(sessionId, 0, Buffer.from('abcdef'))
    await runSessionTransaction(sessionId, async () => {
      await del(sessionId, 2, 2)
      await insert(sessionId, 2, Buffer.from('XYZ'))
    })
    await createCheckpoint(sessionId)
    await overwrite(sessionId, 0, Buffer.from('Q'))

    const newest = await getActionJournalViewport({
      sessionId,
      capacity: 2,
      direction: 'older',
    })
    expect(newest.entries.map((entry) => entry.kind)).toEqual([
      'OVERWRITE',
      'REPLACE',
    ])
    expect(newest.entries[1]).toMatchObject({
      firstSerial: '2',
      lastSerial: '3',
      offset: '2',
      length: '2',
      dataLength: '3',
      sizeDelta: '1',
      changeCountBefore: '1',
      changeCountAfter: '3',
      checkpointAfter: '1',
      payloadHint: 'inline',
    })
    expect(newest.hasMore).toBe(true)
    expect(newest.nextAnchorSerial).toBe('1')

    const oldest = await getActionJournalViewport({
      sessionId,
      anchorSerial: newest.nextAnchorSerial,
      capacity: 2,
      direction: 'older',
    })
    expect(oldest.entries.map((entry) => entry.kind)).toEqual(['INSERT'])
    expect(oldest.entries[0].checkpointBefore).toBe('0')
    expect(oldest.hasMore).toBe(false)

    const transactionId = newest.entries[1].transactionId
    expect(transactionId).toBe('transaction:2')
    const transaction = await getActionJournalViewport({
      sessionId,
      capacity: 10,
      direction: 'newer',
      transactionId,
    })
    expect(transaction.entries).toHaveLength(1)
    expect(transaction.entries[0].kind).toBe('REPLACE')

    const olderFromDelete = await getActionJournalViewport({
      sessionId,
      anchorSerial: '2',
      capacity: 1,
      direction: 'older',
    })
    expect(olderFromDelete.anchorSerial).toBe('3')
    expect(olderFromDelete.entries[0]).toMatchObject({
      firstSerial: '2',
      lastSerial: '3',
      kind: 'REPLACE',
    })

    const newerFromInsert = await getActionJournalViewport({
      sessionId,
      anchorSerial: '3',
      capacity: 1,
      direction: 'newer',
    })
    expect(newerFromInsert.anchorSerial).toBe('2')
    expect(newerFromInsert.entries[0]).toMatchObject({
      firstSerial: '2',
      lastSerial: '3',
      kind: 'REPLACE',
    })
  })

  it('keeps redo history readable across undo and checkpoint checkout', async () => {
    await insert(sessionId, 0, Buffer.from('abc'))
    await createCheckpoint(sessionId)
    await overwrite(sessionId, 0, Buffer.from('X'))
    await createCheckpoint(sessionId)

    await checkoutCheckpoint(sessionId, 1)
    const rewound = await getActionJournalViewport({
      sessionId,
      capacity: 10,
      direction: 'older',
    })
    expect(rewound).toMatchObject({
      activeTipSerial: '1',
      changeCount: '1',
      undoCount: '1',
    })
    expect(rewound.entries.map((entry) => entry.firstSerial)).toEqual([
      '2',
      '1',
    ])

    await checkoutCheckpoint(sessionId, 2)
    const forwarded = await getActionJournalViewport({
      sessionId,
      capacity: 10,
      direction: 'older',
    })
    expect(forwarded.entries.map((entry) => entry.firstSerial)).toEqual([
      '2',
      '1',
    ])

    await overwrite(sessionId, 1, Buffer.from('Y'))
    await undo(sessionId)
    const undone = await getActionJournalViewport({
      sessionId,
      capacity: 10,
      direction: 'older',
    })
    expect(undone.undoCount).toBe('1')
    expect(undone.entries.map((entry) => entry.firstSerial)).toEqual([
      '3',
      '2',
      '1',
    ])
    await redo(sessionId)
  })
})
