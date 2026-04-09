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

import { createSession, destroySession, getComputedFileSize } from './session'
import { createViewport, destroyViewport } from './viewport'
import {
  manageSessionViewportSubscriptions,
  type ManagedSessionViewportSubscriptions,
} from './subscriptions'
import {
  EditorSessionModel,
  type EditorSessionModelOptions,
} from './editor_session_model'
import { type SessionEvent, type ViewportEvent } from './omega_edit_pb'

interface CreateSessionResponseLike {
  getSessionId(): string
}

interface CreateViewportResponseLike {
  getViewportId(): string
}

interface ScopedEditorSessionOpenDependencies {
  createSession?: typeof createSession
  createViewport?: typeof createViewport
  destroySession?: typeof destroySession
  destroyViewport?: typeof destroyViewport
  getComputedFileSize?: typeof getComputedFileSize
}

export interface ScopedEditorSessionOpenOptions
  extends ScopedEditorSessionOpenDependencies {
  capacity: number
  initialOffset?: number
  filePath?: string
}

interface ScopedEditorSessionSubscriptionDependencies {
  manageSubscriptions?: typeof manageSessionViewportSubscriptions
}

export interface ScopedEditorSessionSubscriptionContext {
  model: EditorSessionModel
  stateChanged: boolean
}

export interface ScopedEditorSessionViewportContext {
  model: EditorSessionModel
}

export interface ScopedEditorSessionSubscriptionOptions
  extends ScopedEditorSessionSubscriptionDependencies {
  sessionInterest?: number
  viewportInterest?: number
  onSessionEvent?(
    event: SessionEvent,
    context: ScopedEditorSessionSubscriptionContext
  ): void | Promise<void>
  onViewportEvent?(
    event: ViewportEvent,
    context: ScopedEditorSessionViewportContext
  ): void | Promise<void>
  onSessionError?(error: Error, model: EditorSessionModel): void | Promise<void>
  onViewportError?(
    error: Error,
    model: EditorSessionModel
  ): void | Promise<void>
}

export class ScopedEditorSessionHandle {
  private readonly destroySessionFn: typeof destroySession
  private readonly destroyViewportFn: typeof destroyViewport
  private readonly createViewportFn: typeof createViewport
  private subscriptions: ManagedSessionViewportSubscriptions | undefined
  private disposed = false

  private constructor(
    public readonly model: EditorSessionModel,
    deps: {
      destroySession: typeof destroySession
      destroyViewport: typeof destroyViewport
      createViewport: typeof createViewport
    }
  ) {
    this.destroySessionFn = deps.destroySession
    this.destroyViewportFn = deps.destroyViewport
    this.createViewportFn = deps.createViewport
  }

  public get sessionId(): string {
    return this.model.sessionId
  }

  public get viewportId(): string {
    return this.model.viewportId
  }

  public get isDisposed(): boolean {
    return this.disposed
  }

  public static async openFile(
    filePath: string,
    options: ScopedEditorSessionOpenOptions
  ): Promise<ScopedEditorSessionHandle> {
    const createSessionFn = options.createSession ?? createSession
    const createViewportFn = options.createViewport ?? createViewport
    const destroySessionFn = options.destroySession ?? destroySession
    const destroyViewportFn = options.destroyViewport ?? destroyViewport
    const getComputedFileSizeFn =
      options.getComputedFileSize ?? getComputedFileSize
    const initialOffset = options.initialOffset ?? 0

    const sessionResp = (await createSessionFn(
      options.filePath ?? filePath
    )) as CreateSessionResponseLike
    const sessionId = sessionResp.getSessionId()

    let viewportId = ''
    try {
      const fileSize = await getComputedFileSizeFn(sessionId)
      const viewportResp = (await createViewportFn(
        undefined,
        sessionId,
        initialOffset,
        options.capacity,
        false
      )) as CreateViewportResponseLike
      viewportId = viewportResp.getViewportId()

      return new ScopedEditorSessionHandle(
        new EditorSessionModel({
          sessionId,
          viewportId,
          fileSize,
          changeCount: 0,
        } satisfies EditorSessionModelOptions),
        {
          destroySession: destroySessionFn,
          destroyViewport: destroyViewportFn,
          createViewport: createViewportFn,
        }
      )
    } catch (error) {
      if (viewportId.length > 0) {
        await destroyViewportFn(viewportId).catch(() => {
          // Best-effort cleanup after a failed open.
        })
      }
      await destroySessionFn(sessionId).catch(() => {
        // Best-effort cleanup after a failed open.
      })
      throw error
    }
  }

  public async startSubscriptions(
    options: ScopedEditorSessionSubscriptionOptions
  ): Promise<void> {
    if (this.disposed) {
      throw new Error('Cannot subscribe a disposed scoped session')
    }

    this.subscriptions?.cancel()
    const manageSubscriptionsFn =
      options.manageSubscriptions ?? manageSessionViewportSubscriptions

    this.subscriptions = await manageSubscriptionsFn({
      sessionId: this.sessionId,
      viewportId: this.viewportId,
      sessionInterest: options.sessionInterest,
      viewportInterest: options.viewportInterest,
      onSessionEvent: async (event) => {
        const stateChanged = this.model.trackSessionEvent(event)
        await options.onSessionEvent?.(event, {
          model: this.model,
          stateChanged,
        })
      },
      onViewportEvent: async (event) => {
        await options.onViewportEvent?.(event, { model: this.model })
      },
      onSessionError: async (error) => {
        if (!this.disposed) {
          this.model.rejectSyncWaiters(
            new Error('Session event stream closed before sync completed')
          )
        }
        await options.onSessionError?.(error, this.model)
      },
      onViewportError: async (error) => {
        await options.onViewportError?.(error, this.model)
      },
    })
  }

  public async recreateViewport(
    offset: number,
    capacity: number
  ): Promise<string> {
    if (this.disposed) {
      return this.viewportId
    }

    const previousViewportId = this.viewportId
    const viewportResp = (await this.createViewportFn(
      undefined,
      this.sessionId,
      offset,
      capacity,
      false
    )) as CreateViewportResponseLike
    const nextViewportId = viewportResp.getViewportId()

    try {
      await this.subscriptions?.setViewportId(nextViewportId)
    } catch (error) {
      await this.destroyViewportFn(nextViewportId).catch(() => {
        // Best-effort cleanup for a failed viewport swap.
      })
      throw error
    }

    this.model.updateViewportId(nextViewportId)

    try {
      await this.destroyViewportFn(previousViewportId)
    } catch {
      // Ignore stale viewport cleanup errors.
    }

    return nextViewportId
  }

  public async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.model.dispose()
    this.subscriptions?.cancel()
    this.subscriptions = undefined

    try {
      await this.destroyViewportFn(this.viewportId)
    } catch {
      // Ignore stale viewport cleanup errors.
    }

    try {
      await this.destroySessionFn(this.sessionId)
    } catch {
      // Ignore stale session cleanup errors.
    }
  }
}
