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
  caseInsensitive: boolean
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

export interface EditorHistoryExecutor {
  undoLocal(): Promise<void>
  redoLocal(): Promise<void>
  undoCheckpoint(
    transaction: EditorCheckpointReplaceAllTransaction
  ): Promise<void>
  redoCheckpoint(
    transaction: EditorCheckpointReplaceAllTransaction
  ): Promise<void>
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

  public recordLocalChange(change: EditorChangeRecord): void {
    this.recordLocalChanges([change])
  }

  public recordLocalMutation(): void {
    this.undoneChangeLog.length = 0
    this.transactionLog.push({ kind: 'LOCAL_UNTRACKED' })
    this.undoneTransactionLog.length = 0
  }

  public recordLocalChanges(changes: EditorChangeRecord[]): void {
    if (changes.length === 0) {
      return
    }

    this.changeLog.push(...changes)
    this.undoneChangeLog.length = 0
    this.transactionLog.push({ kind: 'LOCAL', changeCount: changes.length })
    this.undoneTransactionLog.length = 0
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
    this.undoneChangeLog.length = 0
    this.transactionLog.push(transaction)
    this.undoneTransactionLog.length = 0
  }

  public markSaved(): void {
    this.savedChangeDepth = this.transactionLog.length
  }

  public async undo(executor: EditorHistoryExecutor): Promise<boolean> {
    if (this.transactionLog.length === 0) {
      return false
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
    return true
  }
}
