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

import { getClient } from './client'
import { getLogger } from './logger'
import {
  EventSubscriptionRequest,
  type SessionEvent,
  type ViewportEvent,
} from './omega_edit_pb'

type SubscribableEvent = SessionEvent | ViewportEvent

interface SubscriptionStream<TEvent extends SubscribableEvent> {
  on(event: 'data', listener: (event: TEvent) => void): SubscriptionStream<TEvent>
  on(event: 'error', listener: (error: Error) => void): SubscriptionStream<TEvent>
  cancel(): void
}

interface BaseSubscriptionOptions<TEvent extends SubscribableEvent> {
  interest?: number
  onError?(error: Error): void | Promise<void>
  subscribe?:
    | ((
        request: EventSubscriptionRequest
      ) => SubscriptionStream<TEvent> | Promise<SubscriptionStream<TEvent>>)
    | undefined
}

export interface SessionEventSubscriptionOptions
  extends BaseSubscriptionOptions<SessionEvent> {
  sessionId: string
  onEvent(event: SessionEvent): void | Promise<void>
}

export interface ViewportEventSubscriptionOptions
  extends BaseSubscriptionOptions<ViewportEvent> {
  viewportId: string
  onEvent(event: ViewportEvent): void | Promise<void>
}

export interface ManagedEventSubscription {
  cancel(): void
}

export interface SessionViewportSubscriptionManagerOptions {
  sessionId: string
  viewportId: string
  sessionInterest?: number
  viewportInterest?: number
  onSessionEvent(event: SessionEvent): void | Promise<void>
  onViewportEvent(event: ViewportEvent): void | Promise<void>
  onSessionError?(error: Error): void | Promise<void>
  onViewportError?(error: Error): void | Promise<void>
  subscribeSession?: SessionEventSubscriptionOptions['subscribe']
  subscribeViewport?: ViewportEventSubscriptionOptions['subscribe']
}

export interface ManagedSessionViewportSubscriptions {
  cancel(): void
  setViewportId(viewportId: string): Promise<void>
}

function isBenignSubscriptionError(error: Error): boolean {
  return (
    error.message.includes('Call cancelled') ||
    error.message.includes('ECONNRESET')
  )
}

async function invokeSubscriptionErrorHandler(
  errorHandler: ((error: Error) => void | Promise<void>) | undefined,
  error: Error,
  fn: string
): Promise<void> {
  const log = getLogger()
  if (!errorHandler) {
    log.warn({
      fn,
      err: {
        msg: error.message,
        stack: error.stack,
      },
    })
    return
  }

  try {
    await errorHandler(error)
  } catch (callbackError) {
    log.error({
      fn,
      err: {
        msg:
          callbackError instanceof Error
            ? callbackError.message
            : String(callbackError),
        stack: callbackError instanceof Error ? callbackError.stack : undefined,
      },
    })
  }
}

async function subscribeToEvents<TEvent extends SubscribableEvent>(
  requestId: string,
  options: BaseSubscriptionOptions<TEvent> & {
    onEvent(event: TEvent): void | Promise<void>
    subscribeWithClient(
      request: EventSubscriptionRequest
    ): Promise<SubscriptionStream<TEvent>>
    fn: string
  }
): Promise<ManagedEventSubscription> {
  const request = new EventSubscriptionRequest().setId(requestId)
  if (options.interest !== undefined) {
    request.setInterest(options.interest)
  }

  const stream = options.subscribe
    ? await options.subscribe(request)
    : await options.subscribeWithClient(request)

  let cancelled = false

  stream.on('data', (event: TEvent) => {
    void Promise.resolve()
      .then(async () => await options.onEvent(event))
      .catch(async (error) => {
        await invokeSubscriptionErrorHandler(
          options.onError,
          error instanceof Error ? error : new Error(String(error)),
          options.fn
        )
      })
  })

  stream.on('error', (error: Error) => {
    if (cancelled || isBenignSubscriptionError(error)) {
      return
    }

    void invokeSubscriptionErrorHandler(options.onError, error, options.fn)
  })

  return {
    cancel() {
      if (cancelled) {
        return
      }
      cancelled = true
      stream.cancel()
    },
  }
}

export async function subscribeSessionEvents(
  options: SessionEventSubscriptionOptions
): Promise<ManagedEventSubscription> {
  return await subscribeToEvents(options.sessionId, {
    ...options,
    fn: 'subscribeSessionEvents',
    async subscribeWithClient(request) {
      const client = await getClient()
      return client.subscribeToSessionEvents(request)
    },
  })
}

export async function subscribeViewportEvents(
  options: ViewportEventSubscriptionOptions
): Promise<ManagedEventSubscription> {
  return await subscribeToEvents(options.viewportId, {
    ...options,
    fn: 'subscribeViewportEvents',
    async subscribeWithClient(request) {
      const client = await getClient()
      return client.subscribeToViewportEvents(request)
    },
  })
}

export async function manageSessionViewportSubscriptions(
  options: SessionViewportSubscriptionManagerOptions
): Promise<ManagedSessionViewportSubscriptions> {
  let cancelled = false
  let activeViewportId = ''
  let viewportSubscription: ManagedEventSubscription | undefined
  let viewportUpdateTask = Promise.resolve()

  const sessionSubscription = await subscribeSessionEvents({
    sessionId: options.sessionId,
    interest: options.sessionInterest,
    onEvent: options.onSessionEvent,
    onError: options.onSessionError,
    subscribe: options.subscribeSession,
  })

  const applyViewportId = async (viewportId: string): Promise<void> => {
    activeViewportId = viewportId
    viewportSubscription?.cancel()
    viewportSubscription = undefined

    if (cancelled) {
      return
    }

    const nextViewportSubscription = await subscribeViewportEvents({
      viewportId,
      interest: options.viewportInterest,
      onEvent: options.onViewportEvent,
      onError: options.onViewportError,
      subscribe: options.subscribeViewport,
    })

    if (cancelled || activeViewportId !== viewportId) {
      nextViewportSubscription.cancel()
      return
    }

    viewportSubscription = nextViewportSubscription
  }

  const queueViewportUpdate = async (viewportId: string): Promise<void> => {
    if (!cancelled && viewportSubscription && activeViewportId === viewportId) {
      return await viewportUpdateTask
    }

    const nextViewportTask = viewportUpdateTask
      .catch(() => {
        // Allow later viewport updates to recover from a failed subscribe.
      })
      .then(async () => {
        await applyViewportId(viewportId)
      })

    viewportUpdateTask = nextViewportTask
    return await nextViewportTask
  }

  try {
    await queueViewportUpdate(options.viewportId)
  } catch (error) {
    sessionSubscription.cancel()
    throw error
  }

  return {
    cancel() {
      if (cancelled) {
        return
      }

      cancelled = true
      sessionSubscription.cancel()
      viewportSubscription?.cancel()
    },
    async setViewportId(viewportId: string) {
      await queueViewportUpdate(viewportId)
    },
  }
}
