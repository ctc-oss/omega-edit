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

import { SessionEventKind } from './session'

interface SessionSyncWaiter {
  minimumVersion: number
  resolve(): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

export interface EditorSessionModelOptions {
  sessionId: string
  viewportId: string
  fileSize: number
  changeCount?: number
}

export interface EditorSessionStateSnapshot {
  sessionId: string
  viewportId: string
  fileSize: number
  changeCount: number
  syncVersion: number
}

export interface EditorSessionEventLike {
  getSessionEventKind(): number
  getComputedFileSize(): number
  getChangeCount(): number
}

export class EditorSessionModel {
  private _viewportId: string
  private _fileSize: number
  private _changeCount: number
  private _syncVersion = 0
  private waiters: SessionSyncWaiter[] = []

  constructor(private readonly options: EditorSessionModelOptions) {
    this._viewportId = options.viewportId
    this._fileSize = options.fileSize
    this._changeCount = options.changeCount ?? 0
  }

  public get sessionId(): string {
    return this.options.sessionId
  }

  public get viewportId(): string {
    return this._viewportId
  }

  public get fileSize(): number {
    return this._fileSize
  }

  public get changeCount(): number {
    return this._changeCount
  }

  public get syncVersion(): number {
    return this._syncVersion
  }

  public getSnapshot(): EditorSessionStateSnapshot {
    return {
      sessionId: this.sessionId,
      viewportId: this.viewportId,
      fileSize: this.fileSize,
      changeCount: this.changeCount,
      syncVersion: this.syncVersion,
    }
  }

  public updateViewportId(viewportId: string): void {
    this._viewportId = viewportId
  }

  public applySessionStateUpdate(
    nextFileSize: number,
    nextChangeCount: number
  ): void {
    this._fileSize = nextFileSize
    this._changeCount = nextChangeCount
    this._syncVersion += 1
    this.resolveSyncWaiters()
  }

  public trackSessionEvent(event: EditorSessionEventLike): boolean {
    const kind = event.getSessionEventKind()
    if (
      kind !== SessionEventKind.EDIT &&
      kind !== SessionEventKind.UNDO &&
      kind !== SessionEventKind.CLEAR &&
      kind !== SessionEventKind.TRANSFORM
    ) {
      return false
    }

    this.applySessionStateUpdate(
      event.getComputedFileSize(),
      event.getChangeCount()
    )
    return true
  }

  public async waitForSync(
    minimumVersion: number,
    timeoutMs: number
  ): Promise<void> {
    if (this._syncVersion > minimumVersion) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      let waiter: SessionSyncWaiter
      const removeWaiter = () => {
        this.waiters = this.waiters.filter(
          (pendingWaiter) => pendingWaiter !== waiter
        )
      }

      waiter = {
        minimumVersion,
        resolve: () => {
          removeWaiter()
          resolve()
        },
        reject: (error) => {
          removeWaiter()
          reject(error)
        },
        timeout: setTimeout(() => {
          waiter.reject(
            new Error(
              `Timed out waiting for session sync; version=${this.syncVersion} changeCount=${this.changeCount} fileSize=${this.fileSize}`
            )
          )
        }, timeoutMs),
      }

      this.waiters.push(waiter)
    })
  }

  public rejectSyncWaiters(error: Error): void {
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout)
      waiter.reject(error)
    }
  }

  public dispose(
    error: Error = new Error('Session disposed before sync completed')
  ): void {
    this.rejectSyncWaiters(error)
  }

  private resolveSyncWaiters(): void {
    const remainingWaiters: SessionSyncWaiter[] = []

    for (const waiter of this.waiters) {
      if (this._syncVersion > waiter.minimumVersion) {
        clearTimeout(waiter.timeout)
        waiter.resolve()
        continue
      }

      remainingWaiters.push(waiter)
    }

    this.waiters = remainingWaiters
  }
}
