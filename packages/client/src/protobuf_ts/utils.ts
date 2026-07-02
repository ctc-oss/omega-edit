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

const DEFAULT_UNARY_RPC_TIMEOUT_MS = 300_000
const DEFAULT_UNSUBSCRIBE_TIMEOUT_MS = 10_000

export type UnaryCallback<Response> = (
  err: grpc.ServiceError | null,
  response?: Response
) => void

export interface CancellationSignal {
  readonly aborted: boolean
  addEventListener?(
    type: string,
    listener: (...args: any[]) => void,
    options?: unknown
  ): void
  removeEventListener?(type: string, listener: (...args: any[]) => void): void
}

export interface CancellableCallOptions {
  signal?: CancellationSignal
}

type UnaryMethod<Request, Response> = {
  (
    request: Request,
    options: grpc.CallOptions,
    callback: UnaryCallback<Response>
  ): grpc.ClientUnaryCall
  (request: Request, callback: UnaryCallback<Response>): grpc.ClientUnaryCall
  length: number
}

type UnaryInvoker<Request, Response> = {
  call(
    client: object,
    request: Request,
    options: grpc.CallOptions,
    callback: UnaryCallback<Response>
  ): grpc.ClientUnaryCall
  call(
    client: object,
    request: Request,
    callback: UnaryCallback<Response>
  ): grpc.ClientUnaryCall
}

function getNonNegativeEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }

  return parsed
}

export function getUnaryCallOptions(): grpc.CallOptions {
  const timeoutMs = getNonNegativeEnvNumber(
    'OMEGA_EDIT_UNARY_RPC_TIMEOUT_MS',
    DEFAULT_UNARY_RPC_TIMEOUT_MS
  )
  if (timeoutMs === 0) {
    return {}
  }
  return {
    deadline: new Date(Date.now() + timeoutMs),
  }
}

export function callUnary<Request, Response>(
  client: object,
  method: UnaryMethod<Request, Response>,
  request: Request,
  callback: UnaryCallback<Response>
): grpc.ClientUnaryCall {
  const invoker = method as unknown as UnaryInvoker<Request, Response>
  if (method.length <= 2) {
    return invoker.call(client, request, callback)
  }
  return invoker.call(client, request, getUnaryCallOptions(), callback)
}

export function makeCancellationError(fn: string): Error {
  const error = new Error(`${fn} error: cancelled`)
  error.name = 'AbortError'
  return error
}

export function cancelUnaryOnSignal(
  call: grpc.ClientUnaryCall,
  signal?: CancellationSignal
): () => void {
  if (!signal) {
    return () => undefined
  }

  const abort = () => call.cancel()
  if (signal.aborted) {
    abort()
    return () => undefined
  }

  signal.addEventListener?.('abort', abort, { once: true })
  return () => signal.removeEventListener?.('abort', abort)
}

export function getUnsubscribeTimeoutMs(): number {
  return getNonNegativeEnvNumber(
    'OMEGA_EDIT_UNSUBSCRIBE_TIMEOUT_MS',
    DEFAULT_UNSUBSCRIBE_TIMEOUT_MS
  )
}

export function getSingleId(
  response: { id: string } | { getId(): string } | undefined,
  fn: string
): string {
  if (!response) {
    throw new Error(`${fn} error: empty response`)
  }
  if ('id' in response && typeof response.id === 'string') {
    return response.id
  }
  return (response as { getId(): string }).getId()
}

export function requireResponse<T>(response: T | undefined, fn: string): T {
  if (!response) {
    throw new Error(`${fn} error: empty response`)
  }
  return response
}

export function makeWrappedError(fn: string, error: unknown): Error {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error)
  const wrapped = new Error(`${fn} error: ${message}`)
  if (error instanceof Error) {
    ;(wrapped as Error & { cause?: unknown }).cause = error
  }
  return wrapped
}
