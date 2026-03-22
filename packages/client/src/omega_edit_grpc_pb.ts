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

import type * as grpc from '@grpc/grpc-js'
import {
  EditorService as EditorServiceService,
  type SubscribeToSessionEventsRequest,
  type SubscribeToSessionEventsResponse,
  type SubscribeToViewportEventsRequest,
  type SubscribeToViewportEventsResponse,
} from './protobuf_ts/generated/omega_edit/v1/omega_edit'
import {
  EditorServiceClient,
  type IEditorServiceClient,
} from './protobuf_ts/generated/omega_edit/v1/omega_edit.grpc-client'
import {
  EventSubscriptionRequest,
  SessionEvent,
  ViewportEvent,
  wrapSessionEvent,
  wrapViewportEvent,
} from './omega_edit_pb'

type SubscriptionRequest =
  | EventSubscriptionRequest
  | SubscribeToSessionEventsRequest
  | SubscribeToViewportEventsRequest
  | {
      getId(): string
      getInterest?: () => number | undefined
      hasInterest?: () => boolean
    }

function normalizeSubscriptionRequest(
  request: SubscriptionRequest
): SubscribeToSessionEventsRequest {
  if (request instanceof EventSubscriptionRequest) {
    return request.toRaw()
  }

  if ('id' in request && typeof request.id === 'string') {
    return {
      id: request.id,
      interest:
        'interest' in request && typeof request.interest === 'number'
          ? request.interest
          : undefined,
    }
  }

  const requestWithGetters = request as {
    getId(): string
    getInterest?: () => number | undefined
    hasInterest?: () => boolean
  }
  const normalized: SubscribeToSessionEventsRequest = {
    id: requestWithGetters.getId(),
  }
  const hasInterest = requestWithGetters.hasInterest?.()
  const interest = requestWithGetters.getInterest?.()
  if (hasInterest === true && interest !== undefined) {
    normalized.interest = interest
  } else if (hasInterest === undefined && interest !== undefined) {
    normalized.interest = interest
  }
  return normalized
}

function wrapDataEvents<TIn, TOut>(
  stream: grpc.ClientReadableStream<TIn>,
  wrap: (message: TIn) => TOut
): grpc.ClientReadableStream<TOut> {
  const originalOn = stream.on.bind(stream)
  stream.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') {
      return originalOn(event, (message: TIn) => listener(wrap(message)))
    }
    return originalOn(event, listener as Parameters<typeof originalOn>[1])
  }) as typeof stream.on
  return stream as unknown as grpc.ClientReadableStream<TOut>
}

export { EditorServiceClient, EditorServiceService }
export type { IEditorServiceClient }

export class EditorClient extends EditorServiceClient {
  subscribeToSessionEvents(
    request: SubscriptionRequest,
    metadata?: grpc.Metadata | grpc.CallOptions,
    options?: grpc.CallOptions
  ):
    | (grpc.ClientReadableStream<SubscribeToSessionEventsResponse> &
        grpc.ClientReadableStream<SessionEvent>) {
    const normalized = normalizeSubscriptionRequest(request)
    const stream =
      options !== undefined
        ? super.subscribeToSessionEvents(normalized, metadata as grpc.Metadata, options)
        : metadata !== undefined
          ? super.subscribeToSessionEvents(normalized, metadata)
          : super.subscribeToSessionEvents(normalized)
    return wrapDataEvents(
      stream,
      wrapSessionEvent
    ) as unknown as grpc.ClientReadableStream<SubscribeToSessionEventsResponse> &
      grpc.ClientReadableStream<SessionEvent>
  }

  subscribeToViewportEvents(
    request: SubscriptionRequest,
    metadata?: grpc.Metadata | grpc.CallOptions,
    options?: grpc.CallOptions
  ):
    | (grpc.ClientReadableStream<SubscribeToViewportEventsResponse> &
        grpc.ClientReadableStream<ViewportEvent>) {
    const normalized = normalizeSubscriptionRequest(request)
    const stream =
      options !== undefined
        ? super.subscribeToViewportEvents(normalized, metadata as grpc.Metadata, options)
        : metadata !== undefined
          ? super.subscribeToViewportEvents(normalized, metadata)
          : super.subscribeToViewportEvents(normalized)
    return wrapDataEvents(
      stream,
      wrapViewportEvent
    ) as unknown as grpc.ClientReadableStream<SubscribeToViewportEventsResponse> &
      grpc.ClientReadableStream<ViewportEvent>
  }
}
