export * from './omega_edit/v1/omega_edit_grpc_pb'

import { EditorServiceClient } from './omega_edit/v1/omega_edit_grpc_pb'
import {
  EventSubscriptionRequest,
  SubscribeToSessionEventsRequest,
  SubscribeToViewportEventsRequest,
} from './omega_edit_pb'

type SubscriptionRequest = EventSubscriptionRequest | {
  getId(): string
  getInterest?: () => number | undefined
  hasInterest?: () => boolean
}

function normalizeSubscriptionRequest<T extends {
  setId(value: string): T
  setInterest(value: number): T
}>(
  request: SubscriptionRequest,
  ctor: new () => T
): T {
  if (request instanceof ctor) {
    return request
  }

  const normalized = new ctor().setId(request.getId())
  const hasInterest = request.hasInterest?.()
  const interest = request.getInterest?.()
  if (hasInterest === true && interest !== undefined) {
    normalized.setInterest(interest)
  } else if (hasInterest === undefined && interest !== undefined) {
    normalized.setInterest(interest)
  }
  return normalized
}

export class EditorClient extends EditorServiceClient {
  subscribeToSessionEvents(
    request: SubscriptionRequest,
    ...args: any[]
  ) {
    const normalized = normalizeSubscriptionRequest(
      request,
      SubscribeToSessionEventsRequest
    )
    return super.subscribeToSessionEvents(normalized, ...args)
  }

  subscribeToViewportEvents(
    request: SubscriptionRequest,
    ...args: any[]
  ) {
    const normalized = normalizeSubscriptionRequest(
      request,
      SubscribeToViewportEventsRequest
    )
    return super.subscribeToViewportEvents(normalized, ...args)
  }
}
