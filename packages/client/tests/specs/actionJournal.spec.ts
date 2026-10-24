/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0.
 */

import { expect, initExpect } from './common.js'
import { getModuleCompat } from './moduleCompat.js'

const { require } = getModuleCompat(import.meta.url)
const client = require('../../dist/cjs/index.js') as typeof import('../../src')
const proto =
  require('../../dist/cjs/protobuf_ts/generated/omega_edit/v1/omega_edit.js') as typeof import('../../src/protobuf_ts/generated/omega_edit/v1/omega_edit')

describe('action journal viewport', () => {
  beforeAll(async () => {
    await initExpect()
  })

  it('returns a bounded empty viewport for a session with no changes', async () => {
    const viewport = await client.getActionJournalViewport({
      sessionId: 'empty-session',
      async fetch(request) {
        return {
          formatVersion: 1,
          sessionId: request.sessionId,
          activeTipSerialDecimal: '0',
          changeCountDecimal: '0',
          undoCountDecimal: '0',
          checkpointCountDecimal: '0',
          resolvedAnchorSerialDecimal: '0',
          direction: request.direction,
          capacity: request.capacity,
          entries: [],
          hasMore: false,
        }
      },
    })

    expect(viewport).toMatchObject({
      activeTipSerial: '0',
      changeCount: '0',
      undoCount: '0',
      checkpointCount: '0',
      anchorSerial: '0',
      direction: 'older',
      entries: [],
      hasMore: false,
    })
  })

  it('requests a bounded newest-first viewport and preserves int64 metadata', async () => {
    let captured:
      | import('../../src/protobuf_ts/generated/omega_edit/v1/omega_edit').GetActionJournalViewportRequest
      | undefined
    const viewport = await client.getActionJournalViewport({
      sessionId: 'session-1',
      anchorSerial: '9007199254740993',
      capacity: 2,
      direction: 'older',
      kinds: ['REPLACE', 'TRANSFORM'],
      transactionId: 'transaction:7',
      async fetch(request) {
        captured = request
        return {
          formatVersion: 1,
          sessionId: request.sessionId,
          activeTipSerialDecimal: '9007199254740993',
          changeCountDecimal: '9007199254740993',
          undoCountDecimal: '0',
          checkpointCountDecimal: '1',
          resolvedAnchorSerialDecimal: '9007199254740993',
          direction: proto.ActionJournalDirection.OLDER,
          capacity: 2,
          entries: [
            {
              entryIndexDecimal: '0',
              firstSerialDecimal: '7',
              lastSerialDecimal: '8',
              kind: proto.ChangeLogEntryKind.REPLACE,
              offsetDecimal: '4294967296',
              lengthDecimal: '8',
              dataLengthDecimal: '12',
              sizeDeltaDecimal: '4',
              changeCountBeforeDecimal: '6',
              changeCountAfterDecimal: '8',
              checkpointBeforeDecimal: '0',
              checkpointAfterDecimal: '1',
              transactionId: 'transaction:7',
              payloadStorage: proto.ActionJournalPayloadStorage.FILE_BACKED,
            },
          ],
          hasMore: true,
          nextAnchorSerialDecimal: '6',
        }
      },
    })

    expect(captured).toMatchObject({
      sessionId: 'session-1',
      anchorSerialDecimal: '9007199254740993',
      capacity: 2,
      direction: proto.ActionJournalDirection.OLDER,
      kinds: [
        proto.ChangeLogEntryKind.REPLACE,
        proto.ChangeLogEntryKind.TRANSFORM,
      ],
      transactionId: 'transaction:7',
    })
    expect(viewport).toMatchObject({
      version: 1,
      direction: 'older',
      activeTipSerial: '9007199254740993',
      hasMore: true,
      nextAnchorSerial: '6',
      entries: [
        {
          firstSerial: '7',
          lastSerial: '8',
          kind: 'REPLACE',
          offset: '4294967296',
          length: '8',
          dataLength: '12',
          sizeDelta: '4',
          transactionId: 'transaction:7',
          payloadHint: 'file-backed',
          changeCountBefore: '6',
          changeCountAfter: '8',
          checkpointBefore: '0',
          checkpointAfter: '1',
        },
      ],
    })
  })

  it('normalizes checkpoint-backed transform descriptors', async () => {
    const viewport = await client.getActionJournalViewport({
      sessionId: 'session-2',
      direction: 'newer',
      async fetch(request) {
        return {
          formatVersion: 1,
          sessionId: request.sessionId,
          activeTipSerialDecimal: '1',
          changeCountDecimal: '1',
          undoCountDecimal: '0',
          checkpointCountDecimal: '1',
          resolvedAnchorSerialDecimal: '1',
          direction: proto.ActionJournalDirection.NEWER,
          capacity: request.capacity,
          entries: [
            {
              entryIndexDecimal: '0',
              firstSerialDecimal: '1',
              lastSerialDecimal: '1',
              kind: proto.ChangeLogEntryKind.TRANSFORM,
              offsetDecimal: '10',
              lengthDecimal: '20',
              dataLengthDecimal: '0',
              sizeDeltaDecimal: '-4',
              changeCountBeforeDecimal: '0',
              changeCountAfterDecimal: '1',
              checkpointBeforeDecimal: '0',
              checkpointAfterDecimal: '1',
              payloadStorage:
                proto.ActionJournalPayloadStorage.CHECKPOINT_BACKED,
              transform: {
                transformId: 'omega.example.transform',
                optionsJson: '{"mode":"fast"}',
                replacementLengthDecimal: '16',
                computedFileSizeBeforeDecimal: '100',
                computedFileSizeAfterDecimal: '96',
              },
            },
          ],
          hasMore: false,
        }
      },
    })

    expect(viewport.capacity).toBe(client.ACTION_JOURNAL_DEFAULT_CAPACITY)
    expect(viewport.entries[0]).toMatchObject({
      kind: 'TRANSFORM',
      sizeDelta: '-4',
      payloadHint: 'checkpoint-backed',
      transform: {
        transformId: 'omega.example.transform',
        optionsJson: '{"mode":"fast"}',
        replacementLength: '16',
        computedFileSizeBefore: '100',
        computedFileSizeAfter: '96',
      },
    })
  })

  it('rejects unbounded capacities before making an RPC', async () => {
    await expect(
      client.getActionJournalViewport({
        sessionId: 'session-3',
        capacity: client.ACTION_JOURNAL_MAX_CAPACITY + 1,
        async fetch() {
          throw new Error('must not run')
        },
      })
    ).rejects.toThrow('action journal capacity')
  })

  it('rejects invalid runtime filters before making an RPC', async () => {
    await expect(
      client.getActionJournalViewport({
        sessionId: 'session-4',
        direction: 'sideways' as never,
      })
    ).rejects.toThrow('action journal direction')
    await expect(
      client.getActionJournalViewport({
        sessionId: 'session-4',
        kinds: ['MERGE' as never],
      })
    ).rejects.toThrow('action journal kind')
  })

  it('rejects a response whose direction does not match the request', async () => {
    await expect(
      client.getActionJournalViewport({
        sessionId: 'session-5',
        direction: 'older',
        async fetch(request) {
          return {
            formatVersion: 1,
            sessionId: request.sessionId,
            activeTipSerialDecimal: '0',
            changeCountDecimal: '0',
            undoCountDecimal: '0',
            checkpointCountDecimal: '0',
            resolvedAnchorSerialDecimal: '0',
            direction: proto.ActionJournalDirection.NEWER,
            capacity: request.capacity,
            entries: [],
            hasMore: false,
          }
        },
      })
    ).rejects.toThrow('direction does not match')
  })

  it('rejects inconsistent continuation metadata', async () => {
    const fetch = async (
      request: import('../../src/protobuf_ts/generated/omega_edit/v1/omega_edit').GetActionJournalViewportRequest
    ) => ({
      formatVersion: 1,
      sessionId: request.sessionId,
      activeTipSerialDecimal: '1',
      changeCountDecimal: '1',
      undoCountDecimal: '0',
      checkpointCountDecimal: '0',
      resolvedAnchorSerialDecimal: '1',
      direction: request.direction,
      capacity: request.capacity,
      entries: [],
      hasMore: true,
    })
    await expect(
      client.getActionJournalViewport({ sessionId: 'session-6', fetch })
    ).rejects.toThrow('continuation metadata')
    await expect(
      client.getActionJournalViewport({
        sessionId: 'session-7',
        async fetch(request) {
          return {
            ...(await fetch(request)),
            hasMore: false,
            nextAnchorSerialDecimal: '0',
          }
        },
      })
    ).rejects.toThrow('continuation metadata')
  })

  it('rejects out-of-range and oversized signed decimal metadata', async () => {
    const fetchWithDelta = async (
      request: import('../../src/protobuf_ts/generated/omega_edit/v1/omega_edit').GetActionJournalViewportRequest,
      sizeDeltaDecimal: string
    ) => ({
      formatVersion: 1,
      sessionId: request.sessionId,
      activeTipSerialDecimal: '1',
      changeCountDecimal: '1',
      undoCountDecimal: '0',
      checkpointCountDecimal: '0',
      resolvedAnchorSerialDecimal: '1',
      direction: request.direction,
      capacity: request.capacity,
      entries: [
        {
          entryIndexDecimal: '0',
          firstSerialDecimal: '1',
          lastSerialDecimal: '1',
          kind: proto.ChangeLogEntryKind.INSERT,
          offsetDecimal: '0',
          lengthDecimal: '1',
          dataLengthDecimal: '1',
          sizeDeltaDecimal,
          changeCountBeforeDecimal: '0',
          changeCountAfterDecimal: '1',
          payloadStorage: proto.ActionJournalPayloadStorage.INLINE,
        },
      ],
      hasMore: false,
    })

    for (const sizeDeltaDecimal of [
      '9223372036854775808',
      '-9223372036854775809',
      '9'.repeat(10_000),
    ]) {
      await expect(
        client.getActionJournalViewport({
          sessionId: 'session-signed-int64',
          fetch: async (request) => fetchWithDelta(request, sizeDeltaDecimal),
        })
      ).rejects.toThrow(/signed (?:decimal integer|int64 range)/)
    }
  })
})
