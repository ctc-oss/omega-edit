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

import { AsyncLocalStorage } from 'node:async_hooks'

const activeSessionMutation = new AsyncLocalStorage<string>()
const sessionMutationTails = new Map<string, Promise<void>>()

export async function enqueueSessionMutation<T>(
  sessionId: string,
  task: () => Promise<T>
): Promise<T> {
  if (activeSessionMutation.getStore() === sessionId) {
    return await task()
  }

  const priorTail = sessionMutationTails.get(sessionId) ?? Promise.resolve()
  let releaseTail!: () => void
  const tailSignal = new Promise<void>((resolve) => {
    releaseTail = resolve
  })
  const nextTail = priorTail.catch(() => undefined).then(() => tailSignal)
  sessionMutationTails.set(sessionId, nextTail)

  await priorTail.catch(() => undefined)

  try {
    return await activeSessionMutation.run(sessionId, task)
  } finally {
    releaseTail()
    if (sessionMutationTails.get(sessionId) === nextTail) {
      sessionMutationTails.delete(sessionId)
    }
  }
}
