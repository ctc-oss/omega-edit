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

import { expect, initExpect } from './common.js'
import { getModuleCompat } from './moduleCompat.js'

const { require } = getModuleCompat(import.meta.url)
const clientPackage =
  require('../../dist/cjs/index.js') as typeof import('../../src/index')
const { EditorHistoryController, EditorSearchController, SearchCaseFolding } =
  clientPackage

describe('Editor Patterns', () => {
  beforeAll(async () => {
    await initExpect()
  })

  it('should track mixed local and checkpoint history with save-state semantics', async () => {
    const history = new EditorHistoryController()
    const calls: string[] = []

    history.recordLocalChange({
      serial: 1,
      kind: 'INSERT',
      offset: 0,
      length: 0,
      data: '41',
    })
    history.recordCheckpointReplaceAll({
      kind: 'CHECKPOINT_REPLACE_ALL',
      query: 'PD',
      isHex: false,
      caseFolding: SearchCaseFolding.NONE,
      data: '504446',
    })
    history.markSaved()
    history.recordLocalReplaceAll([10, 20], 2, '4242')

    expect(history.getEditState()).to.deep.equal({
      canUndo: true,
      canRedo: false,
      undoCount: 3,
      redoCount: 0,
      isDirty: true,
      savedChangeDepth: 2,
    })

    await history.undo({
      async undoLocal() {
        calls.push('undoLocal')
      },
      async redoLocal() {
        calls.push('redoLocal')
      },
      async undoCheckpoint(transaction) {
        calls.push(`undoCheckpoint:${transaction.query}`)
      },
      async redoCheckpoint(transaction) {
        calls.push(`redoCheckpoint:${transaction.query}`)
      },
    })
    expect(history.getEditState()).to.deep.equal({
      canUndo: true,
      canRedo: true,
      undoCount: 2,
      redoCount: 1,
      isDirty: false,
      savedChangeDepth: 2,
    })

    await history.undo({
      async undoLocal() {
        calls.push('undoLocal')
      },
      async redoLocal() {
        calls.push('redoLocal')
      },
      async undoCheckpoint(transaction) {
        calls.push(`undoCheckpoint:${transaction.query}`)
      },
      async redoCheckpoint(transaction) {
        calls.push(`redoCheckpoint:${transaction.query}`)
      },
    })
    expect(history.getEditState()).to.deep.equal({
      canUndo: true,
      canRedo: true,
      undoCount: 1,
      redoCount: 2,
      isDirty: true,
      savedChangeDepth: 2,
    })

    await history.redo({
      async undoLocal() {
        calls.push('undoLocal')
      },
      async redoLocal() {
        calls.push('redoLocal')
      },
      async undoCheckpoint(transaction) {
        calls.push(`undoCheckpoint:${transaction.query}`)
      },
      async redoCheckpoint(transaction) {
        calls.push(`redoCheckpoint:${transaction.query}`)
      },
    })

    expect(calls).to.deep.equal([
      'undoLocal',
      'undoCheckpoint:PD',
      'redoCheckpoint:PD',
    ])
    expect(history.getEditState()).to.deep.equal({
      canUndo: true,
      canRedo: true,
      undoCount: 2,
      redoCount: 1,
      isDirty: false,
      savedChangeDepth: 2,
    })
  })

  it('should keep untracked local mutations out of the change log', async () => {
    const history = new EditorHistoryController()
    const calls: string[] = []
    const executor = {
      async undoLocal() {
        calls.push('undoLocal')
      },
      async redoLocal() {
        calls.push('redoLocal')
      },
      async undoCheckpoint() {
        calls.push('undoCheckpoint')
      },
      async redoCheckpoint() {
        calls.push('redoCheckpoint')
      },
    }

    history.recordLocalChange({
      serial: 1,
      kind: 'INSERT',
      offset: 0,
      length: 0,
      data: '41',
    })
    history.recordLocalMutation()

    expect(history.getChangeLog()).to.deep.equal([
      {
        serial: 1,
        kind: 'INSERT',
        offset: 0,
        length: 0,
        data: '41',
      },
    ])
    expect(history.getEditState()).to.deep.include({
      canUndo: true,
      canRedo: false,
      undoCount: 2,
      redoCount: 0,
    })

    await history.undo(executor)
    expect(calls).to.deep.equal(['undoLocal'])
    expect(history.getChangeLog()).to.have.length(1)
    expect(history.getEditState()).to.deep.include({
      canUndo: true,
      canRedo: true,
      undoCount: 1,
      redoCount: 1,
    })

    await history.redo(executor)
    expect(calls).to.deep.equal(['undoLocal', 'redoLocal'])
    expect(history.getChangeLog()).to.have.length(1)
    expect(history.getEditState()).to.deep.include({
      canUndo: true,
      canRedo: false,
      undoCount: 2,
      redoCount: 0,
    })
  })

  it('should round-trip complete undo and redo state snapshots', async () => {
    const history = new EditorHistoryController()
    history.recordLocalChange({
      serial: 1,
      kind: 'DELETE',
      offset: 2,
      length: 2,
      data: '4344',
    })
    history.recordLocalReplaceAll([5, 9], 1, '41')
    history.markSaved()
    await history.undo({
      async undoLocal() {},
      async redoLocal() {},
      async undoCheckpoint() {},
      async redoCheckpoint() {},
    })

    const restored = EditorHistoryController.fromSnapshot(history.snapshot())
    expect(restored.snapshot()).to.deep.equal(history.snapshot())
    expect(restored.getEditState()).to.deep.equal(history.getEditState())

    restored.recordLocalReplaceAll([12], 1, '42')
    expect(restored.getChangeLog().at(-1)?.groupId).to.equal('replace-all-2')
  })

  it('should cross milestone anchors without adding visible undo steps', async () => {
    const history = new EditorHistoryController()
    const calls: string[] = []
    history.recordLocalChange({
      serial: 1,
      kind: 'INSERT',
      offset: 0,
      length: 0,
      data: '41',
    })
    history.recordMilestone()
    const executor = {
      async undoLocal() {
        calls.push('undoLocal')
      },
      async redoLocal() {
        calls.push('redoLocal')
      },
      async undoCheckpoint() {},
      async redoCheckpoint() {},
      async undoMilestone() {
        calls.push('undoMilestone')
      },
      async redoMilestone() {
        calls.push('redoMilestone')
      },
    }

    expect(history.willUndoCrossMilestone()).to.be.true
    expect(history.willRedoCrossMilestone()).to.be.false
    await history.undo(executor)
    expect(history.willUndoCrossMilestone()).to.be.false
    expect(history.willRedoCrossMilestone()).to.be.true
    await history.redo(executor)
    expect(history.willUndoCrossMilestone()).to.be.true
    expect(history.willRedoCrossMilestone()).to.be.false
    expect(calls).to.deep.equal([
      'undoMilestone',
      'undoLocal',
      'redoLocal',
      'redoMilestone',
    ])
    expect(history.getEditState()).to.deep.include({
      undoCount: 1,
      redoCount: 0,
    })
  })

  it('should preserve the complete future when restored at the original depth', () => {
    const history = new EditorHistoryController()
    history.recordLocalChange({
      serial: 1,
      kind: 'DELETE',
      offset: 2,
      length: 2,
      data: '4344',
    })
    history.recordMilestone()
    history.recordLocalChange({
      serial: 2,
      kind: 'INSERT',
      offset: 2,
      length: 0,
      data: '4546',
    })
    history.recordMilestone()

    const original = EditorHistoryController.fromSnapshotAtDepth(
      history.snapshot(),
      0
    )
    expect(original.getEditState()).to.deep.include({
      undoCount: 0,
      redoCount: 2,
    })
    expect(original.snapshot().undoneTransactionLog).to.deep.equal([
      { kind: 'LOCAL', changeCount: 1 },
      { kind: 'LOCAL', changeCount: 1 },
    ])
    expect(
      original.snapshot().undoneChangeLog.map((change) => change.data)
    ).to.deep.equal(['4546', '4344'])
  })

  it('should discard future milestones when branching from the original depth', async () => {
    const history = new EditorHistoryController()
    history.recordLocalChange({
      serial: 1,
      kind: 'INSERT',
      offset: 0,
      length: 0,
      data: '41',
    })
    history.recordMilestone()
    history.recordLocalChange({
      serial: 2,
      kind: 'INSERT',
      offset: 1,
      length: 0,
      data: '42',
    })
    history.recordMilestone()

    const branch = EditorHistoryController.fromSnapshotAtDepth(
      history.snapshot(),
      0
    )
    branch.recordLocalChange({
      serial: 1,
      kind: 'INSERT',
      offset: 0,
      length: 0,
      data: '58',
    })

    expect(branch.snapshot().milestoneDepths).to.deep.equal([])
    expect(branch.getChangeLog().map((change) => change.serial)).to.deep.equal([
      1,
    ])

    const calls: string[] = []
    await branch.undo({
      async undoLocal() {
        calls.push('undoLocal')
      },
      async redoLocal() {
        calls.push('redoLocal')
      },
      async undoCheckpoint() {},
      async redoCheckpoint() {},
      async undoMilestone() {
        calls.push('undoMilestone')
      },
    })
    expect(calls).to.deep.equal(['undoLocal'])
    expect(branch.getEditState()).to.deep.include({
      undoCount: 0,
      redoCount: 1,
    })
  })

  it('should clamp the saved depth when discarding a saved future branch', () => {
    const history = new EditorHistoryController()
    history.recordLocalChange({
      serial: 1,
      kind: 'INSERT',
      offset: 0,
      length: 0,
      data: '41',
    })
    history.recordLocalChange({
      serial: 2,
      kind: 'INSERT',
      offset: 1,
      length: 0,
      data: '42',
    })
    history.markSaved()

    const branch = EditorHistoryController.fromSnapshotAtDepth(
      history.snapshot(),
      0
    )
    branch.recordLocalChange({
      serial: 1,
      kind: 'INSERT',
      offset: 0,
      length: 0,
      data: '58',
    })

    expect(branch.getEditState()).to.deep.equal({
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
      isDirty: true,
      savedChangeDepth: 0,
    })

    const snapshot = branch.snapshot()
    const restored = EditorHistoryController.fromSnapshot(snapshot)
    expect(restored.snapshot()).to.deep.equal(snapshot)
  })

  it('should reconcile history when another client changes native transaction stacks', async () => {
    const history = new EditorHistoryController()
    history.recordLocalChange({
      serial: 17,
      kind: 'INSERT',
      offset: 649,
      length: 0,
      data: '42',
    })

    expect(history.reconcileNativeTransactionCounts(16, 1, true)).to.be.true
    expect(history.getChangeLog()).to.deep.equal([])
    expect(history.getEditState()).to.deep.equal({
      canUndo: true,
      canRedo: true,
      undoCount: 16,
      redoCount: 1,
      isDirty: false,
      savedChangeDepth: 16,
    })
    expect(history.reconcileNativeTransactionCounts(16, 1, true)).to.be.false

    const calls: string[] = []
    const executor = {
      async undoLocal() {
        calls.push('undoLocal')
      },
      async redoLocal() {
        calls.push('redoLocal')
      },
      async undoCheckpoint() {
        calls.push('undoCheckpoint')
      },
      async redoCheckpoint() {
        calls.push('redoCheckpoint')
      },
    }
    await history.undo(executor)
    await history.redo(executor)
    expect(calls).to.deep.equal(['undoLocal', 'redoLocal'])
  })

  it('should reject invalid native transaction counts', () => {
    const history = new EditorHistoryController()
    expect(() =>
      history.reconcileNativeTransactionCounts(-1, 0, false)
    ).to.throw(RangeError)
    expect(() =>
      history.reconcileNativeTransactionCounts(
        0,
        Number.MAX_SAFE_INTEGER + 1,
        false
      )
    ).to.throw(RangeError)
  })

  it('should reconcile native transaction counts above argument limits', () => {
    const history = new EditorHistoryController()
    const activeTransactionCount = 200_000

    expect(
      history.reconcileNativeTransactionCounts(activeTransactionCount, 0, false)
    ).to.be.true
    expect(history.getEditState()).to.deep.include({
      undoCount: activeTransactionCount,
      redoCount: 0,
    })
  })

  it('should not mistake checkpoint-backed steps for native transactions', () => {
    const history = new EditorHistoryController()
    history.recordCheckpointReplaceAll({
      kind: 'CHECKPOINT_REPLACE_ALL',
      query: 'PD',
      isHex: false,
      caseFolding: SearchCaseFolding.NONE,
      data: '504446',
    })

    expect(history.reconcileNativeTransactionCounts(0, 0, false)).to.be.false
    expect(history.getEditState()).to.deep.include({
      canUndo: true,
      undoCount: 1,
    })
  })

  it('should undo multi-record local transactions as a single unit', async () => {
    const history = new EditorHistoryController()
    const calls: string[] = []
    const executor = {
      async undoLocal() {
        calls.push('undoLocal')
      },
      async redoLocal() {
        calls.push('redoLocal')
      },
      async undoCheckpoint() {
        calls.push('undoCheckpoint')
      },
      async redoCheckpoint() {
        calls.push('redoCheckpoint')
      },
    }
    const entries = [
      {
        serial: 1,
        kind: 'INSERT' as const,
        offset: 0,
        length: 0,
        data: '41',
        groupId: 'import-a',
      },
      {
        serial: 2,
        kind: 'OVERWRITE' as const,
        offset: 4,
        length: 1,
        data: '42',
        groupId: 'import-b',
      },
    ]

    history.recordLocalChanges(entries)

    expect(history.getEditState()).to.deep.include({
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
    })
    expect(history.getChangeLog()).to.deep.equal(entries)

    await history.undo(executor)
    expect(calls).to.deep.equal(['undoLocal'])
    expect(history.getEditState()).to.deep.include({
      canUndo: false,
      canRedo: true,
      undoCount: 0,
      redoCount: 1,
    })
    expect(history.getChangeLog()).to.deep.equal([])

    await history.redo(executor)
    expect(calls).to.deep.equal(['undoLocal', 'redoLocal'])
    expect(history.getChangeLog()).to.deep.equal(entries)
    expect(history.getEditState()).to.deep.include({
      canUndo: true,
      canRedo: false,
      undoCount: 1,
      redoCount: 0,
    })
  })

  it('should preserve large-search mode until the next explicit search and choose bounded vs checkpointed replace-all on demand', async () => {
    const searchCalls: Array<{
      offset: number
      length: number
      limit: number
      isReverse: boolean
    }> = []
    let nextMatches = [0, 10, 20, 30]

    const controller = new EditorSearchController('session-id', {
      windowLimit: 3,
      async searchSession(
        _sessionId: string,
        _pattern: string | Uint8Array,
        _caseFolding: number = SearchCaseFolding.NONE,
        isReverse: boolean = false,
        offset: number = 0,
        length: number = 0,
        limit: number = 0
      ) {
        searchCalls.push({ offset, length, limit, isReverse })
        return nextMatches
      },
      async replaceSession() {
        return 3
      },
      async replaceSessionCheckpointed() {
        return 4
      },
    })

    const searchResult = await controller.search({
      query: 'PD',
      isHex: false,
    })
    expect(searchResult.mode).to.equal('large')

    const boundedReplace = await controller.preserveState(async () => {
      nextMatches = [0, 10, 20]
      return await controller.replaceAll({
        query: 'PD',
        isHex: false,
        length: 2,
        replacement: Buffer.from('PDF'),
        replacementData: Buffer.from('PDF').toString('hex'),
      })
    })

    expect(controller.shouldClearAfterExternalEdit()).to.equal(true)
    expect(boundedReplace).to.deep.equal({
      strategy: 'bounded',
      replacedCount: 3,
      selectionOffset: 0,
      orderedOffsets: [0, 10, 20],
    })

    const nextSearchResult = await controller.search({
      query: 'PD',
      isHex: false,
    })
    expect(nextSearchResult.mode).to.equal('bounded')
    expect(searchCalls).to.have.length.greaterThan(0)
    expect(searchCalls[0]!).to.deep.include({
      offset: 0,
      length: 0,
      limit: 4,
      isReverse: false,
    })
  })

  it('should collect viewport neighbors with a boundary-padded bounded search', async () => {
    const searchCalls: Array<{
      offset: number
      length: number
      limit: number
      isReverse: boolean
    }> = []

    const controller = new EditorSearchController('session-id', {
      windowLimit: 1,
      async searchSession(
        _sessionId: string,
        _pattern: string | Uint8Array,
        _caseFolding: number = SearchCaseFolding.NONE,
        isReverse: boolean = false,
        offset: number = 0,
        length: number = 0,
        limit: number = 0
      ) {
        searchCalls.push({ offset, length, limit, isReverse })
        return searchCalls.length === 1 ? [12] : [9, 10, 12, 18, 19, 22]
      },
      async replaceSession() {
        return 0
      },
      async replaceSessionCheckpointed() {
        return 0
      },
    })

    const result = await controller.findAdjacent({
      query: 'abc',
      isHex: false,
      direction: 'forward',
      anchorOffset: 0,
      fileSize: 50,
      viewportOffset: 10,
      viewportLength: 8,
    })

    expect(result.offset).to.equal(12)
    expect(result.viewport).to.deep.equal({
      offset: 10,
      length: 8,
      matches: [9, 10, 12],
      hasMore: false,
    })
    expect(searchCalls).to.deep.equal([
      { offset: 1, length: 0, limit: 1, isReverse: false },
      { offset: 8, length: 12, limit: 12, isReverse: false },
    ])
  })
})
