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

const DEFAULT_UNSUBSCRIBE_TIMEOUT_MS = 10_000

export function getUnsubscribeTimeoutMs(): number {
  const raw = process.env.OMEGA_EDIT_UNSUBSCRIBE_TIMEOUT_MS
  if (!raw) {
    return DEFAULT_UNSUBSCRIBE_TIMEOUT_MS
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_UNSUBSCRIBE_TIMEOUT_MS
  }

  return parsed
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
