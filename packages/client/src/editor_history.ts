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

import type { SearchCaseFolding } from './session'

export type EditorChangeRecordKind =
  | 'INSERT'
  | 'DELETE'
  | 'OVERWRITE'
  | 'REPLACE'
  | 'TRANSFORM'

export interface EditorChangeRecord {
  serial: number
  kind: EditorChangeRecordKind
  offset: number
  length: number
  data: string
  groupId?: string
}

export interface EditorCheckpointReplaceAllTransaction {
  kind: 'CHECKPOINT_REPLACE_ALL'
  query: string
  isHex: boolean
  caseFolding: SearchCaseFolding
  data: string
}

export type EditorTransactionRecord =
  | { kind: 'LOCAL'; changeCount: number }
  | { kind: 'LOCAL_UNTRACKED' }
  | EditorCheckpointReplaceAllTransaction

export interface EditorEditState {
  canUndo: boolean
  canRedo: boolean
  undoCount: number
  redoCount: number
  isDirty: boolean
  savedChangeDepth: number
}

export interface EditorHistorySnapshot {
  version: 1
  savedChangeDepth: number
  changeLog: EditorChangeRecord[]
  undoneChangeLog: EditorChangeRecord[]
  transactionLog: EditorTransactionRecord[]
  undoneTransactionLog: EditorTransactionRecord[]
  nextSyntheticGroupId: number
  milestoneDepths: number[]
}

export interface EditorHistoryExecutor {
  undoLocal(): Promise<void>
  redoLocal(): Promise<void>
  undoCheckpoint(
    transaction: EditorCheckpointReplaceAllTransaction
  ): Promise<void>
  redoCheckpoint(
    transaction: EditorCheckpointReplaceAllTransaction
  ): Promise<void>
  undoMilestone?(): Promise<void>
  redoMilestone?(): Promise<void>
}

function moveLastChanges(
  source: EditorChangeRecord[],
  target: EditorChangeRecord[],
  count: number
): void {
  if (source.length === 0 || count <= 0) {
    return
  }

  const startIndex = Math.max(0, source.length - count)
  target.push(...source.splice(startIndex))
}

export class EditorHistoryController {
  private savedChangeDepth = 0
  private readonly changeLog: EditorChangeRecord[] = []
  private readonly undoneChangeLog: EditorChangeRecord[] = []
  private readonly transactionLog: EditorTransactionRecord[] = []
  private readonly undoneTransactionLog: EditorTransactionRecord[] = []
  private nextSyntheticGroupId = 1
  private readonly milestoneDepths: number[] = []

  public getEditState(): EditorEditState {
    const undoCount = this.transactionLog.length
    const redoCount = this.undoneTransactionLog.length

    return {
      canUndo: undoCount > 0,
      canRedo: redoCount > 0,
      undoCount,
      redoCount,
      isDirty: undoCount !== this.savedChangeDepth,
      savedChangeDepth: this.savedChangeDepth,
    }
  }

  public getChangeLog(): readonly EditorChangeRecord[] {
    return [...this.changeLog]
  }

  public willUndoCrossMilestone(): boolean {
    return this.milestoneDepths.includes(this.transactionLog.length)
  }

  public willRedoCrossMilestone(): boolean {
    return this.milestoneDepths.includes(this.transactionLog.length + 1)
  }

  public snapshot(): EditorHistorySnapshot {
    return {
      version: 1,
      savedChangeDepth: this.savedChangeDepth,
      changeLog: this.changeLog.map((change) => ({ ...change })),
      undoneChangeLog: this.undoneChangeLog.map((change) => ({ ...change })),
      transactionLog: this.transactionLog.map((transaction) => ({
        ...transaction,
      })),
      undoneTransactionLog: this.undoneTransactionLog.map((transaction) => ({
        ...transaction,
      })),
      nextSyntheticGroupId: this.nextSyntheticGroupId,
      milestoneDepths: [...this.milestoneDepths],
    }
  }

  public static fromSnapshot(
    snapshot: EditorHistorySnapshot
  ): EditorHistoryController {
    validateHistorySnapshot(snapshot)
    const history = new EditorHistoryController()
    history.savedChangeDepth = snapshot.savedChangeDepth
    history.changeLog.push(
      ...snapshot.changeLog.map((change) => ({ ...change }))
    )
    history.undoneChangeLog.push(
      ...snapshot.undoneChangeLog.map((change) => ({ ...change }))
    )
    history.transactionLog.push(
      ...snapshot.transactionLog.map((transaction) => ({ ...transaction }))
    )
    history.undoneTransactionLog.push(
      ...snapshot.undoneTransactionLog.map((transaction) => ({
        ...transaction,
      }))
    )
    history.nextSyntheticGroupId = snapshot.nextSyntheticGroupId
    history.milestoneDepths.push(...snapshot.milestoneDepths)
    return history
  }

  public static fromSnapshotAtDepth(
    snapshot: EditorHistorySnapshot,
    transactionDepth: number
  ): EditorHistoryController {
    const history = EditorHistoryController.fromSnapshot(snapshot)
    const totalDepth =
      history.transactionLog.length + history.undoneTransactionLog.length
    if (
      !Number.isSafeInteger(transactionDepth) ||
      transactionDepth < 0 ||
      transactionDepth > totalDepth
    ) {
      throw new RangeError('Editor history depth is outside the timeline')
    }
    while (history.transactionLog.length > transactionDepth) {
      const transaction = history.transactionLog.pop()
      if (!transaction) break
      if (transaction.kind === 'LOCAL') {
        moveLastChanges(
          history.changeLog,
          history.undoneChangeLog,
          transaction.changeCount
        )
      }
      history.undoneTransactionLog.push(transaction)
    }
    while (history.transactionLog.length < transactionDepth) {
      const transaction = history.undoneTransactionLog.pop()
      if (!transaction) break
      if (transaction.kind === 'LOCAL') {
        moveLastChanges(
          history.undoneChangeLog,
          history.changeLog,
          transaction.changeCount
        )
      }
      history.transactionLog.push(transaction)
    }
    return history
  }

  public reconcileNativeTransactionCounts(
    activeTransactionCount: number,
    undoneTransactionCount: number,
    currentStateIsSaved: boolean
  ): boolean {
    if (
      !Number.isSafeInteger(activeTransactionCount) ||
      activeTransactionCount < 0 ||
      !Number.isSafeInteger(undoneTransactionCount) ||
      undoneTransactionCount < 0
    ) {
      throw new RangeError(
        'Native transaction counts must be non-negative safe integers'
      )
    }
    let nativeBackedActiveCount = 0
    let nativeBackedUndoneCount = 0
    let hasCheckpointReplaceAll = false
    for (const transaction of this.transactionLog) {
      if (transaction.kind === 'CHECKPOINT_REPLACE_ALL') {
        hasCheckpointReplaceAll = true
      } else {
        nativeBackedActiveCount += 1
      }
    }
    for (const transaction of this.undoneTransactionLog) {
      if (transaction.kind === 'CHECKPOINT_REPLACE_ALL') {
        hasCheckpointReplaceAll = true
      } else {
        nativeBackedUndoneCount += 1
      }
    }
    if (
      nativeBackedActiveCount === activeTransactionCount &&
      nativeBackedUndoneCount === undoneTransactionCount
    ) {
      return false
    }
    if (hasCheckpointReplaceAll) {
      return false
    }

    // Another client can attach to the same native file session and mutate it
    // without contributing records to this controller. Once the native stack
    // depths diverge, retaining typed local records would associate them with
    // the wrong native transactions. Preserve correct undo/redo ordering by
    // rebuilding both stacks as opaque transactions.
    this.changeLog.length = 0
    this.undoneChangeLog.length = 0
    this.transactionLog.length = 0
    this.undoneTransactionLog.length = 0
    for (let index = 0; index < activeTransactionCount; index += 1) {
      this.transactionLog.push({ kind: 'LOCAL_UNTRACKED' })
    }
    for (let index = 0; index < undoneTransactionCount; index += 1) {
      this.undoneTransactionLog.push({ kind: 'LOCAL_UNTRACKED' })
    }
    this.savedChangeDepth = currentStateIsSaved ? activeTransactionCount : 0
    this.milestoneDepths.length = 0
    return true
  }

  public recordLocalChange(change: EditorChangeRecord): void {
    this.recordLocalChanges([change])
  }

  public recordMilestone(): void {
    const depth = this.transactionLog.length
    if (depth > 0 && this.milestoneDepths.at(-1) !== depth) {
      this.milestoneDepths.push(depth)
    }
  }

  public recordLocalMutation(): void {
    this.discardRedoBranch()
    this.transactionLog.push({ kind: 'LOCAL_UNTRACKED' })
  }

  public recordLocalChanges(changes: EditorChangeRecord[]): void {
    if (changes.length === 0) {
      return
    }

    this.discardRedoBranch()
    this.changeLog.push(...changes)
    this.transactionLog.push({ kind: 'LOCAL', changeCount: changes.length })
  }

  public recordLocalReplaceAll(
    offsets: number[],
    length: number,
    data: string
  ): void {
    if (offsets.length === 0) {
      return
    }

    const groupId = `replace-all-${this.nextSyntheticGroupId++}`
    this.recordLocalChanges(
      offsets.map((offset, index) => ({
        // serial is a within-group 1-based index, not a server-assigned change serial.
        serial: index + 1,
        kind: 'REPLACE' as const,
        offset,
        length,
        data,
        groupId,
      }))
    )
  }

  public recordCheckpointReplaceAll(
    transaction: EditorCheckpointReplaceAllTransaction
  ): void {
    this.discardRedoBranch()
    this.transactionLog.push(transaction)
  }

  public markSaved(): void {
    this.savedChangeDepth = this.transactionLog.length
  }

  public async undo(executor: EditorHistoryExecutor): Promise<boolean> {
    if (this.transactionLog.length === 0) {
      return false
    }

    const crossesMilestone = this.milestoneDepths.includes(
      this.transactionLog.length
    )
    if (crossesMilestone) {
      if (!executor.undoMilestone) {
        throw new Error('History executor cannot cross a checkpoint milestone')
      }
      await executor.undoMilestone()
    }

    const transaction = this.transactionLog[this.transactionLog.length - 1]
    if (transaction.kind === 'LOCAL') {
      await executor.undoLocal()
      moveLastChanges(
        this.changeLog,
        this.undoneChangeLog,
        transaction.changeCount
      )
    } else if (transaction.kind === 'LOCAL_UNTRACKED') {
      await executor.undoLocal()
    } else {
      await executor.undoCheckpoint(transaction)
    }

    const undoneTransaction = this.transactionLog.pop()
    if (!undoneTransaction) {
      return false
    }

    this.undoneTransactionLog.push(undoneTransaction)
    return true
  }

  public async redo(executor: EditorHistoryExecutor): Promise<boolean> {
    if (this.undoneTransactionLog.length === 0) {
      return false
    }

    const transaction =
      this.undoneTransactionLog[this.undoneTransactionLog.length - 1]
    if (transaction.kind === 'LOCAL') {
      await executor.redoLocal()
      moveLastChanges(
        this.undoneChangeLog,
        this.changeLog,
        transaction.changeCount
      )
    } else if (transaction.kind === 'LOCAL_UNTRACKED') {
      await executor.redoLocal()
    } else {
      await executor.redoCheckpoint(transaction)
    }

    const redoneTransaction = this.undoneTransactionLog.pop()
    if (!redoneTransaction) {
      return false
    }

    this.transactionLog.push(redoneTransaction)
    if (this.milestoneDepths.includes(this.transactionLog.length)) {
      if (!executor.redoMilestone) {
        throw new Error('History executor cannot cross a checkpoint milestone')
      }
      await executor.redoMilestone()
    }
    return true
  }

  private discardRedoBranch(): void {
    this.undoneChangeLog.length = 0
    this.undoneTransactionLog.length = 0

    const branchDepth = this.transactionLog.length
    this.savedChangeDepth = Math.min(this.savedChangeDepth, branchDepth)
    for (let index = this.milestoneDepths.length - 1; index >= 0; index -= 1) {
      if (this.milestoneDepths[index] > branchDepth) {
        this.milestoneDepths.splice(index, 1)
      }
    }
  }
}

function validateHistorySnapshot(snapshot: EditorHistorySnapshot): void {
  if (
    snapshot?.version !== 1 ||
    !Number.isSafeInteger(snapshot.savedChangeDepth) ||
    snapshot.savedChangeDepth < 0 ||
    !Number.isSafeInteger(snapshot.nextSyntheticGroupId) ||
    snapshot.nextSyntheticGroupId < 1 ||
    !Array.isArray(snapshot.changeLog) ||
    !Array.isArray(snapshot.undoneChangeLog) ||
    !Array.isArray(snapshot.transactionLog) ||
    !Array.isArray(snapshot.undoneTransactionLog) ||
    !Array.isArray(snapshot.milestoneDepths) ||
    snapshot.savedChangeDepth >
      snapshot.transactionLog.length + snapshot.undoneTransactionLog.length
  ) {
    throw new TypeError('Invalid editor history snapshot')
  }
  const totalDepth =
    snapshot.transactionLog.length + snapshot.undoneTransactionLog.length
  // Milestone depths are advisory (used for undo/redo milestone crossing).
  // Filter out any that are out of range rather than crashing — a stale
  // snapshot after history truncation should not be fatal.
  snapshot.milestoneDepths = snapshot.milestoneDepths.filter(
    (depth) => Number.isSafeInteger(depth) && depth >= 0 && depth <= totalDepth
  )
}
